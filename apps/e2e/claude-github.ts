#!/usr/bin/env node
// apps/e2e/claude-github.ts
//
// End-to-end test for the GitHub Projects (v2) tracker + Claude backend pipeline.
// Imports tracker-agnostic helpers from ./lib/e2e-common.

import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { Result } from '@praha/byethrow';
import * as v from 'valibot';

import {
  cleanWorkspaceAt,
  parseWorkflowFrontmatter,
  preflight,
  REPO_ROOT,
  reportCommonError,
  resolveBackendCommand,
  runBackendUntilTerminal,
  spawnBackend,
  verifyWorkspaceHello,
  type CommonE2EError,
} from './lib/common.js';

// =====================================================================
// Env (secrets only)
// =====================================================================

const EnvSchema = v.object({
  GITHUB_TOKEN: v.pipe(v.string(), v.minLength(1, 'GITHUB_TOKEN is required')),
});
type Env = v.InferOutput<typeof EnvSchema>;

// =====================================================================
// GitHub-specific error variants
// =====================================================================

type GitHubE2EError =
  | { kind: 'GitHubHttpError'; status: number; body: string }
  | { kind: 'GitHubGraphQLError'; errors: ReadonlyArray<{ message: string }> }
  | { kind: 'GitHubResponseInvalid'; issues: ReadonlyArray<string> }
  | { kind: 'ProjectNotFound'; owner: string; number: number }
  | { kind: 'ProjectItemNotFound'; issueNumber: number }
  | { kind: 'StatusFieldNotFound'; fieldName: string }
  | { kind: 'StatusOptionNotFound'; optionName: string; available: ReadonlyArray<string> };

type E2EError = CommonE2EError | GitHubE2EError;

// =====================================================================
// Config
// =====================================================================

const GitHubConfigSchema = v.object({
  repo: v.pipe(v.string(), v.regex(/^[^/]+\/[^/]+$/, 'repo must be owner/name')),
  issueNumber: v.pipe(v.number(), v.minValue(1)),
  resetStateName: v.pipe(v.string(), v.minLength(1)),
  statusFieldName: v.pipe(v.string(), v.minLength(1)),
  workflowPath: v.pipe(v.string(), v.minLength(1)),
  timeoutSeconds: v.pipe(v.number(), v.minValue(1)),
});
type GitHubConfig = v.InferOutput<typeof GitHubConfigSchema>;

async function loadConfig(): Promise<Result.Result<GitHubConfig, E2EError>> {
  const cfgPath = path.join(REPO_ROOT, 'apps/e2e/config.json');
  let raw: string;
  try {
    raw = await readFile(cfgPath, 'utf8');
  } catch (err) {
    return Result.fail({
      kind: 'ConfigError',
      issues: [`failed to read ${cfgPath}: ${err instanceof Error ? err.message : String(err)}`],
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return Result.fail({
      kind: 'ConfigError',
      issues: [`invalid JSON in ${cfgPath}: ${err instanceof Error ? err.message : String(err)}`],
    });
  }
  const obj = parsed as { github?: unknown };
  if (!obj || typeof obj !== 'object' || !('github' in obj)) {
    return Result.fail({ kind: 'ConfigError', issues: ['apps/e2e/config.json must have a "github" section'] });
  }
  const result = v.safeParse(GitHubConfigSchema, obj.github);
  if (result.success) return Result.succeed(result.output);
  const issues = result.issues.map(
    (i) => `github.${i.path?.map((p) => String(p.key)).join('.') ?? '<root>'}: ${i.message}`,
  );
  return Result.fail({ kind: 'ConfigError', issues });
}

function parseEnv(): Result.Result<Env, E2EError> {
  const result = v.safeParse(EnvSchema, process.env);
  if (result.success) return Result.succeed(result.output);
  const issues = result.issues.map(
    (i) => `${i.path?.map((p) => p.key).join('.') ?? '<root>'}: ${i.message}`,
  );
  return Result.fail({ kind: 'ConfigError', issues });
}

// =====================================================================
// GitHub GraphQL
// =====================================================================

const GITHUB_ENDPOINT = 'https://api.github.com/graphql';

const GraphQLErrorEnvelopeSchema = v.object({
  errors: v.optional(v.array(v.object({ message: v.string() }))),
});

async function githubGraphql<TOutput>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  schema: v.GenericSchema<unknown, TOutput>,
): Promise<Result.Result<TOutput, GitHubE2EError>> {
  let res: Response;
  try {
    res = await fetch(GITHUB_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'studio-e2e',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    return Result.fail({
      kind: 'GitHubHttpError',
      status: 0,
      body: err instanceof Error ? err.message : String(err),
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '<unreadable>');
    return Result.fail({ kind: 'GitHubHttpError', status: res.status, body });
  }
  const json = (await res.json().catch(() => null)) as unknown;
  const envelope = v.safeParse(GraphQLErrorEnvelopeSchema, json);
  if (envelope.success && envelope.output.errors && envelope.output.errors.length > 0) {
    return Result.fail({ kind: 'GitHubGraphQLError', errors: envelope.output.errors });
  }
  const parsed = v.safeParse(schema, json);
  if (!parsed.success) {
    const issues = parsed.issues.map(
      (i) => `${i.path?.map((p) => String(p.key)).join('.') ?? '<root>'}: ${i.message}`,
    );
    return Result.fail({ kind: 'GitHubResponseInvalid', issues });
  }
  // byethrow Results are plain tagged-object unions by design (see the
  // Success<T> type docs in @praha/byethrow). Result.succeed auto-detects
  // Promise inputs and returns ResultFor<T, Awaited<T>, never>, which TS
  // cannot simplify when TOutput is itself a generic parameter. The plain
  // object form below is the canonical equivalent that sidesteps the
  // conditional type. Same pattern in apps/claude-app-server/src/jsonrpc/schema-result.ts.
  return { type: 'Success', value: parsed.output };
}

// ---------- discovery ----------

const StatusOptionSchema = v.object({ id: v.string(), name: v.string() });

// Branch 2 is a literal union of the other ProjectV2FieldConfiguration members
// (ProjectV2Field / ProjectV2IterationField) so TypeScript can discriminate
// the union by __typename. Using v.string() here would prevent narrowing
// because string includes the literal in branch 1.
const ProjectFieldSchema = v.union([
  v.object({
    __typename: v.literal('ProjectV2SingleSelectField'),
    id: v.string(),
    name: v.string(),
    options: v.array(StatusOptionSchema),
  }),
  v.object({
    __typename: v.union([v.literal('ProjectV2Field'), v.literal('ProjectV2IterationField')]),
  }),
]);

const ProjectItemSchema = v.object({
  id: v.string(),
  content: v.nullable(
    v.union([
      v.object({
        __typename: v.literal('Issue'),
        number: v.number(),
        title: v.string(),
        repository: v.object({ nameWithOwner: v.string() }),
      }),
      v.object({
        __typename: v.union([
          v.literal('PullRequest'),
          v.literal('DraftIssue'),
        ]),
      }),
    ]),
  ),
});

const DiscoveryResponseSchema = v.object({
  data: v.object({
    user: v.nullable(
      v.object({
        projectV2: v.nullable(
          v.object({
            id: v.string(),
            fields: v.object({ nodes: v.array(ProjectFieldSchema) }),
            items: v.object({ nodes: v.array(ProjectItemSchema) }),
          }),
        ),
      }),
    ),
  }),
});

const DISCOVERY_QUERY = `
  query Discover($owner: String!, $number: Int!) {
    user(login: $owner) {
      projectV2(number: $number) {
        id
        fields(first: 50) {
          nodes {
            __typename
            ... on ProjectV2SingleSelectField {
              id
              name
              options { id name }
            }
          }
        }
        items(first: 100) {
          nodes {
            id
            content {
              __typename
              ... on Issue {
                number
                title
                repository { nameWithOwner }
              }
            }
          }
        }
      }
    }
  }
`;

type Discovered = {
  projectId: string;
  fieldId: string;
  optionIdByName: ReadonlyMap<string, string>;
  itemId: string;
};

async function discover(
  token: string,
  args: {
    projectOwner: string;
    projectNumber: number;
    cfg: GitHubConfig;
    terminalStates: ReadonlyArray<string>;
  },
): Promise<Result.Result<Discovered, GitHubE2EError>> {
  const r = await githubGraphql(
    token,
    DISCOVERY_QUERY,
    { owner: args.projectOwner, number: args.projectNumber },
    DiscoveryResponseSchema,
  );
  if (Result.isFailure(r)) return r;
  const project = r.value.data.user?.projectV2 ?? null;
  if (!project) {
    return Result.fail({
      kind: 'ProjectNotFound',
      owner: args.projectOwner,
      number: args.projectNumber,
    });
  }
  const statusField = project.fields.nodes.find(
    (f) =>
      f.__typename === 'ProjectV2SingleSelectField' && f.name === args.cfg.statusFieldName,
  );
  if (!statusField || statusField.__typename !== 'ProjectV2SingleSelectField') {
    return Result.fail({ kind: 'StatusFieldNotFound', fieldName: args.cfg.statusFieldName });
  }
  const optionIdByName = new Map(statusField.options.map((o) => [o.name, o.id]));
  if (!optionIdByName.has(args.cfg.resetStateName)) {
    return Result.fail({
      kind: 'StatusOptionNotFound',
      optionName: args.cfg.resetStateName,
      available: [...optionIdByName.keys()],
    });
  }
  for (const term of args.terminalStates) {
    if (!optionIdByName.has(term)) {
      return Result.fail({
        kind: 'StatusOptionNotFound',
        optionName: term,
        available: [...optionIdByName.keys()],
      });
    }
  }
  const expectedRepo = args.cfg.repo;
  const item = project.items.nodes.find(
    (n) =>
      n.content !== null &&
      n.content.__typename === 'Issue' &&
      n.content.number === args.cfg.issueNumber &&
      n.content.repository.nameWithOwner === expectedRepo,
  );
  if (!item) {
    return Result.fail({ kind: 'ProjectItemNotFound', issueNumber: args.cfg.issueNumber });
  }
  return Result.succeed({
    projectId: project.id,
    fieldId: statusField.id,
    optionIdByName,
    itemId: item.id,
  });
}

// ---------- reset mutation ----------

const ResetResponseSchema = v.object({
  data: v.object({
    updateProjectV2ItemFieldValue: v.object({
      projectV2Item: v.object({ id: v.string() }),
    }),
  }),
});

const RESET_MUTATION = `
  mutation Reset($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(
      input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }
    ) {
      projectV2Item { id }
    }
  }
`;

async function resetIssueToTodo(
  token: string,
  disc: Discovered,
  resetStateName: string,
): Promise<Result.Result<void, GitHubE2EError>> {
  const optionId = disc.optionIdByName.get(resetStateName);
  if (!optionId) {
    return Result.fail({
      kind: 'StatusOptionNotFound',
      optionName: resetStateName,
      available: [...disc.optionIdByName.keys()],
    });
  }
  const r = await githubGraphql(
    token,
    RESET_MUTATION,
    {
      projectId: disc.projectId,
      itemId: disc.itemId,
      fieldId: disc.fieldId,
      optionId,
    },
    ResetResponseSchema,
  );
  if (Result.isFailure(r)) return r;
  return Result.succeed(undefined);
}

// ---------- polling ----------

const StatusResponseSchema = v.object({
  data: v.object({
    node: v.nullable(
      v.object({
        fieldValueByName: v.nullable(
          v.union([
            v.object({
              __typename: v.literal('ProjectV2ItemFieldSingleSelectValue'),
              name: v.nullable(v.string()),
            }),
            v.object({
              __typename: v.union([
                v.literal('ProjectV2ItemFieldTextValue'),
                v.literal('ProjectV2ItemFieldNumberValue'),
                v.literal('ProjectV2ItemFieldDateValue'),
                v.literal('ProjectV2ItemFieldIterationValue'),
              ]),
            }),
          ]),
        ),
      }),
    ),
  }),
});

const STATUS_QUERY = `
  query Status($itemId: ID!, $statusFieldName: String!) {
    node(id: $itemId) {
      ... on ProjectV2Item {
        fieldValueByName(name: $statusFieldName) {
          __typename
          ... on ProjectV2ItemFieldSingleSelectValue {
            name
          }
        }
      }
    }
  }
`;

function pollStatusFactory(
  token: string,
  itemId: string,
  statusFieldName: string,
  terminalStates: ReadonlySet<string>,
): () => Promise<Result.Result<{ state: string; terminal: boolean }, GitHubE2EError>> {
  return async () => {
    const r = await githubGraphql(
      token,
      STATUS_QUERY,
      { itemId, statusFieldName },
      StatusResponseSchema,
    );
    if (Result.isFailure(r)) return r;
    const fv = r.value.data.node?.fieldValueByName ?? null;
    if (!fv) {
      return Result.succeed({ state: '<unset>', terminal: false });
    }
    if (fv.__typename !== 'ProjectV2ItemFieldSingleSelectValue') {
      return Result.succeed({ state: `<${fv.__typename}>`, terminal: false });
    }
    const name = fv.name ?? '<null>';
    return Result.succeed({ state: name, terminal: terminalStates.has(name) });
  };
}

// =====================================================================
// Error rendering
// =====================================================================

function reportError(error: E2EError): number {
  switch (error.kind) {
    case 'GitHubHttpError':
      console.error(`FAIL: GitHub HTTP ${error.status}: ${error.body}`);
      return 1;
    case 'GitHubGraphQLError':
      console.error('FAIL: GitHub GraphQL errors:');
      for (const e of error.errors) console.error(`  - ${e.message}`);
      return 1;
    case 'GitHubResponseInvalid':
      console.error('FAIL: GitHub response did not match schema:');
      for (const i of error.issues) console.error(`  - ${i}`);
      return 1;
    case 'ProjectNotFound':
      console.error(`FAIL: project not found: owner=${error.owner} number=${error.number}`);
      return 1;
    case 'ProjectItemNotFound':
      console.error(`FAIL: project item for issue #${error.issueNumber} not found`);
      console.error('  (check that the issue is added to the project and assignee matches)');
      return 1;
    case 'StatusFieldNotFound':
      console.error(`FAIL: status field "${error.fieldName}" not found in project`);
      return 1;
    case 'StatusOptionNotFound':
      console.error(`FAIL: status option "${error.optionName}" not found`);
      console.error(`  available: ${error.available.join(', ')}`);
      return 1;
    default:
      return reportCommonError(error);
  }
}

// =====================================================================
// Main
// =====================================================================

async function main(): Promise<number> {
  const envResult = parseEnv();
  if (Result.isFailure(envResult)) return reportError(envResult.error);
  const env = envResult.value;

  const cfgResult = await loadConfig();
  if (Result.isFailure(cfgResult)) return reportError(cfgResult.error);
  const cfg = cfgResult.value;

  const fmResult = await parseWorkflowFrontmatter(cfg.workflowPath);
  if (Result.isFailure(fmResult)) return reportError(fmResult.error);
  const fm = fmResult.value;

  const projectOwner = fm.github?.project_owner;
  if (!projectOwner) {
    return reportError({
      kind: 'ConfigError',
      issues: [`workflow ${cfg.workflowPath} missing github.project_owner`],
    });
  }
  const projectNumber = fm.github?.project_number;
  if (typeof projectNumber !== 'number') {
    return reportError({
      kind: 'ConfigError',
      issues: [`workflow ${cfg.workflowPath} missing github.project_number`],
    });
  }
  const workspaceRoot = fm.workspace?.root;
  if (!workspaceRoot) {
    return reportError({
      kind: 'ConfigError',
      issues: [`workflow ${cfg.workflowPath} missing workspace.root`],
    });
  }
  const terminalStatesArray = fm.tracker?.terminal_states ?? [];
  if (terminalStatesArray.length === 0) {
    return reportError({
      kind: 'ConfigError',
      issues: [`workflow ${cfg.workflowPath} missing tracker.terminal_states`],
    });
  }

  // Perform's safeIdentifier (apps/perform/src/workspace/path.ts)
  // replaces non-[a-zA-Z0-9._-] in issue.identifier with `_`. For GitHub,
  // the identifier is `${repo}#${number}` (built in
  // apps/perform/src/tracker/github/adapter.ts), so the workspace dir
  // name ends up as e.g. `babie_studio_1`.
  const workspaceKey = `${cfg.repo}#${cfg.issueNumber}`.replace(/[^a-zA-Z0-9._-]/g, '_');
  const workspacePath = path.join(workspaceRoot, workspaceKey);
  const terminalStates = new Set(terminalStatesArray);

  const result = await Result.pipe(
    Result.succeed(undefined as void),
    Result.andThrough(() => {
      console.log('→ preflight');
      return preflight();
    }),
    Result.andThrough(() => {
      console.log(`→ clean workspace ${workspacePath}`);
      return cleanWorkspaceAt(workspacePath);
    }),
    Result.andThen(() => {
      console.log(
        `→ discover GitHub project (owner=${projectOwner} number=${projectNumber} issue=#${cfg.issueNumber})`,
      );
      return discover(env.GITHUB_TOKEN, { projectOwner, projectNumber, cfg, terminalStates: terminalStatesArray });
    }),
    Result.andThrough((disc) => {
      console.log(
        `  resolved: projectId=${disc.projectId} fieldId=${disc.fieldId} itemId=${disc.itemId}`,
      );
      console.log(`→ reset issue #${cfg.issueNumber} to "${cfg.resetStateName}"`);
      return resetIssueToTodo(env.GITHUB_TOKEN, disc, cfg.resetStateName);
    }),
    Result.andThen((disc) => {
      console.log('→ run backend until issue reaches terminal state');
      const spawnResult = spawnBackend({
        workflowPath: cfg.workflowPath,
        tag: `${cfg.repo}#${cfg.issueNumber}`,
        backend: resolveBackendCommand(),
      });
      if (Result.isFailure(spawnResult)) return Promise.resolve(spawnResult);
      const pollStatus = pollStatusFactory(
        env.GITHUB_TOKEN,
        disc.itemId,
        cfg.statusFieldName,
        terminalStates,
      );
      return runBackendUntilTerminal({
        child: spawnResult.value,
        pollIntervalMs: 10_000,
        initialDelayMs: 10_000,
        timeoutMs: cfg.timeoutSeconds * 1000,
        pollStatus,
      });
    }),
    Result.andThen(() => {
      console.log('→ verify workspace');
      return verifyWorkspaceHello(workspacePath);
    }),
  );

  if (Result.isFailure(result)) return reportError(result.error);

  console.log('→ cleanup workspace (success)');
  const cleanResult = await cleanWorkspaceAt(workspacePath);
  if (Result.isFailure(cleanResult)) {
    console.warn(`  (cleanup warning: ${cleanResult.error.kind} — workspace may remain)`);
  }
  console.log('PASS');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('FAIL: unexpected exception:', err);
    process.exit(1);
  },
);
