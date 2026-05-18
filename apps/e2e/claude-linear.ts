#!/usr/bin/env node
// apps/e2e/claude-linear.ts
//
// End-to-end test for the Linear tracker + Claude backend pipeline.
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
  LINEAR_API_KEY: v.pipe(v.string(), v.minLength(1, 'LINEAR_API_KEY is required')),
});
type Env = v.InferOutput<typeof EnvSchema>;

// =====================================================================
// Linear-specific error variants
// =====================================================================

type LinearE2EError =
  | { kind: 'LinearHttpError'; status: number; body: string }
  | { kind: 'LinearGraphQLError'; errors: ReadonlyArray<{ message: string }> }
  | { kind: 'LinearResponseInvalid'; issues: ReadonlyArray<string> }
  | { kind: 'StateNotFound'; want: string; available: ReadonlyArray<string> };

type E2EError = CommonE2EError | LinearE2EError;

// =====================================================================
// Linear GraphQL schemas
// =====================================================================

const GraphQLErrorEnvelopeSchema = v.object({
  errors: v.optional(v.array(v.object({ message: v.string() }))),
});

const StateNodeSchema = v.object({ id: v.string(), name: v.string() });

const IssueResponseSchema = v.object({
  data: v.object({
    issue: v.object({
      id: v.string(),
      identifier: v.string(),
      team: v.object({
        states: v.object({ nodes: v.array(StateNodeSchema) }),
      }),
    }),
  }),
});

const ResetResponseSchema = v.object({
  data: v.object({
    issueUpdate: v.object({
      success: v.boolean(),
      issue: v.object({ state: v.object({ name: v.string() }) }),
    }),
  }),
});

const StatusResponseSchema = v.object({
  data: v.object({
    issue: v.object({ state: v.object({ name: v.string() }) }),
  }),
});

type IssueWithStates = v.InferOutput<typeof IssueResponseSchema>['data']['issue'];

// =====================================================================
// Config (from apps/e2e/config.json's "linear" section)
// =====================================================================

const LinearConfigSchema = v.object({
  issueKey: v.pipe(v.string(), v.minLength(1)),
  resetStateName: v.pipe(v.string(), v.minLength(1)),
  workflowPath: v.pipe(v.string(), v.minLength(1)),
  timeoutSeconds: v.pipe(v.number(), v.minValue(1)),
});
type LinearConfig = v.InferOutput<typeof LinearConfigSchema>;

// =====================================================================
// Linear GraphQL helper
// =====================================================================

const LINEAR_ENDPOINT = 'https://api.linear.app/graphql';

async function linearGraphql<TOutput>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
  schema: v.GenericSchema<unknown, TOutput>,
): Promise<Result.Result<TOutput, LinearE2EError>> {
  let res: Response;
  try {
    res = await fetch(LINEAR_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    return Result.fail({
      kind: 'LinearHttpError',
      status: 0,
      body: err instanceof Error ? err.message : String(err),
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '<unreadable>');
    return Result.fail({ kind: 'LinearHttpError', status: res.status, body });
  }
  const json = (await res.json().catch(() => null)) as unknown;
  const envelope = v.safeParse(GraphQLErrorEnvelopeSchema, json);
  if (envelope.success && envelope.output.errors && envelope.output.errors.length > 0) {
    return Result.fail({ kind: 'LinearGraphQLError', errors: envelope.output.errors });
  }
  const parsed = v.safeParse(schema, json);
  if (!parsed.success) {
    const issues = parsed.issues.map(
      (i) => `${i.path?.map((p) => String(p.key)).join('.') ?? '<root>'}: ${i.message}`,
    );
    return Result.fail({ kind: 'LinearResponseInvalid', issues });
  }
  // byethrow Results are plain tagged-object unions by design (see the
  // Success<T> type docs in @praha/byethrow). Result.succeed auto-detects
  // Promise inputs and returns ResultFor<T, Awaited<T>, never>, which TS
  // cannot simplify when TOutput is itself a generic parameter. The plain
  // object form below is the canonical equivalent that sidesteps the
  // conditional type. Same pattern in apps/claude-app-server/src/jsonrpc/schema-result.ts.
  return { type: 'Success', value: parsed.output };
}

const FETCH_ISSUE_QUERY = `
  query GetIssue($id: String!) {
    issue(id: $id) {
      id
      identifier
      team {
        states {
          nodes { id name }
        }
      }
    }
  }
`;

const RESET_MUTATION = `
  mutation Reset($id: String!, $stateId: String!) {
    issueUpdate(id: $id, input: { stateId: $stateId }) {
      success
      issue { state { name } }
    }
  }
`;

const STATUS_QUERY = `
  query GetStatus($id: String!) {
    issue(id: $id) { state { name } }
  }
`;

async function fetchIssue(
  apiKey: string,
  issueKey: string,
): Promise<Result.Result<IssueWithStates, LinearE2EError>> {
  const r = await linearGraphql(apiKey, FETCH_ISSUE_QUERY, { id: issueKey }, IssueResponseSchema);
  if (Result.isFailure(r)) return r;
  return Result.succeed(r.value.data.issue);
}

async function resetIssueToTodo(
  apiKey: string,
  issue: IssueWithStates,
  resetStateName: string,
): Promise<Result.Result<void, LinearE2EError>> {
  const stateNode = issue.team.states.nodes.find((s) => s.name === resetStateName);
  if (!stateNode) {
    return Result.fail({
      kind: 'StateNotFound',
      want: resetStateName,
      available: issue.team.states.nodes.map((s) => s.name),
    });
  }
  const r = await linearGraphql(
    apiKey,
    RESET_MUTATION,
    { id: issue.id, stateId: stateNode.id },
    ResetResponseSchema,
  );
  if (Result.isFailure(r)) return r;
  if (!r.value.data.issueUpdate.success) {
    return Result.fail({
      kind: 'LinearGraphQLError',
      errors: [{ message: 'issueUpdate returned success=false' }],
    });
  }
  return Result.succeed(undefined);
}

function pollStatusFactory(
  apiKey: string,
  issueKey: string,
  terminalStates: ReadonlySet<string>,
): () => Promise<Result.Result<{ state: string; terminal: boolean }, LinearE2EError>> {
  return async () => {
    const r = await linearGraphql(apiKey, STATUS_QUERY, { id: issueKey }, StatusResponseSchema);
    if (Result.isFailure(r)) return r;
    const name = r.value.data.issue.state.name;
    return Result.succeed({ state: name, terminal: terminalStates.has(name) });
  };
}

// =====================================================================
// Linear-specific error rendering
// =====================================================================

function reportError(error: E2EError): number {
  switch (error.kind) {
    case 'LinearHttpError':
      console.error(`FAIL: Linear HTTP ${error.status}: ${error.body}`);
      return 1;
    case 'LinearGraphQLError':
      console.error('FAIL: Linear GraphQL errors:');
      for (const e of error.errors) console.error(`  - ${e.message}`);
      return 1;
    case 'LinearResponseInvalid':
      console.error('FAIL: Linear response did not match schema:');
      for (const i of error.issues) console.error(`  - ${i}`);
      return 1;
    case 'StateNotFound':
      console.error(`FAIL: state "${error.want}" not found in team`);
      console.error(`  available: ${error.available.join(', ')}`);
      return 1;
    default:
      return reportCommonError(error);
  }
}

// =====================================================================
// Config load
// =====================================================================

async function loadConfig(): Promise<Result.Result<LinearConfig, E2EError>> {
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
  const obj = parsed as { linear?: unknown };
  if (!obj || typeof obj !== 'object' || !('linear' in obj)) {
    return Result.fail({ kind: 'ConfigError', issues: ['apps/e2e/config.json must have a "linear" section'] });
  }
  const result = v.safeParse(LinearConfigSchema, obj.linear);
  if (result.success) return Result.succeed(result.output);
  const issues = result.issues.map(
    (i) => `linear.${i.path?.map((p) => String(p.key)).join('.') ?? '<root>'}: ${i.message}`,
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

  const workspacePath = path.join(workspaceRoot, cfg.issueKey);
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
      console.log(`→ fetch Linear issue ${cfg.issueKey}`);
      return fetchIssue(env.LINEAR_API_KEY, cfg.issueKey);
    }),
    Result.andThrough((issue) => {
      console.log(`→ reset issue ${issue.identifier} to "${cfg.resetStateName}"`);
      return resetIssueToTodo(env.LINEAR_API_KEY, issue, cfg.resetStateName);
    }),
    Result.andThen(() => {
      console.log('→ run backend until issue reaches terminal state');
      const spawnResult = spawnBackend({ workflowPath: cfg.workflowPath, tag: cfg.issueKey, backend: resolveBackendCommand() });
      if (Result.isFailure(spawnResult)) return Promise.resolve(spawnResult);
      const pollStatus = pollStatusFactory(env.LINEAR_API_KEY, cfg.issueKey, terminalStates);
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
