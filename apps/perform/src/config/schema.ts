import * as v from "valibot";
import * as nodePath from "node:path";
import type { Result } from "@praha/byethrow";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { WorkflowConfig } from "../domain/workflow-config.js";
import { assertNever } from "../util/assert-never.js";
import { Sensitive } from "../util/sensitive.js";
import type {
  BackendConfig,
  ClaudeBackend,
  CodexBackend,
  MockBackend,
} from "../domain/backend-config.js";
import type {
  TrackerConfig,
  MemoryTrackerConfig,
  LinearTrackerConfig,
  GithubTrackerConfig,
} from "../domain/tracker-config.js";
import type { AgentConfig } from "../domain/agent-config.js";
import type { WorkspaceConfig } from "../domain/workspace-config.js";
import type { HooksConfig } from "../domain/hooks-config.js";
import { IssueId, IssueIdentifier, IssueStateName, type Issue } from "../domain/issue.js";
import { schemaResult } from "./schema-result.js";
import { resolveEnvRef } from "./env-resolve.js";
import { formatIssuePath } from "../util/schema-issue.js";
import {
  DEFAULT_DASHBOARD_ENABLED,
  DEFAULT_REFRESH_MS,
  DEFAULT_RENDER_INTERVAL_MS,
  DEFAULT_OBSERVABILITY_CONFIG,
  type ObservabilityConfig,
} from "../observability/runtime-config.js";
import type { PollingConfig } from "../domain/polling-config.js";
import type { LoggingConfig } from "../domain/logging-config.js";

/** Internal error from buildBackend / buildTracker. Parser (config/parser.ts)
 *  attaches the file path before wrapping into ConfigError.invariant-violation. */
export type WorkflowYamlInvariant = Readonly<{ kind: "invariant-violation"; cause: string }>;

export type WorkflowYamlError =
  | Readonly<{ kind: "schema-violation"; issues: ReadonlyArray<StandardSchemaV1.Issue> }>
  | Readonly<{ kind: "invariant-violation"; cause: string }>
  | Readonly<{ kind: "logging-path-not-absolute"; path: string }>;

// ──────────────────────────────────────────────────────────────────────────
// YAML-shape schemas (snake_case, matches what users write in WORKFLOW.md)
// ──────────────────────────────────────────────────────────────────────────

const AgentYamlSchema = v.object({
  type: v.picklist(["claude", "codex", "mock"]),
  max_concurrent_agents: v.pipe(v.number(), v.integer(), v.minValue(1)),
  max_turns: v.pipe(v.number(), v.integer(), v.minValue(1)),
  max_retry_backoff_ms: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  agent_session_stall_timeout_ms: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  max_concurrent_agents_by_state: v.optional(
    v.record(v.string(), v.pipe(v.number(), v.integer(), v.minValue(1))),
  ),
});

const ClaudeBlockYamlSchema = v.object({
  command: v.string(),
});

const CodexSandboxPolicyYamlSchema = v.variant("type", [
  v.object({ type: v.literal("workspaceWrite") }),
  v.object({ type: v.literal("readOnly") }),
  v.object({ type: v.literal("dangerFullAccess") }),
]);

const CodexBlockYamlSchema = v.object({
  command: v.string(),
  approval_policy: v.picklist(["never", "untrusted", "on-failure"]),
  thread_sandbox: v.picklist(["workspace-write", "read-only", "danger-full-access"]),
  turn_sandbox_policy: CodexSandboxPolicyYamlSchema,
});

const MockBlockYamlSchema = v.object({
  delay_ms: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  force_fail: v.optional(v.boolean()),
  exit_mid_turn: v.optional(v.boolean()),
});

const TrackerCommonYamlSchema = v.object({
  kind: v.picklist(["memory", "linear", "github"]),
  active_states: v.optional(v.array(v.string()), []),
  terminal_states: v.optional(v.array(v.string()), []),
  doing_state: v.optional(v.string()),
  done_state: v.optional(v.string()),
});

const IssueYamlSchema = v.object({
  id: IssueId.schema,
  identifier: IssueIdentifier.schema,
  title: v.string(),
  description: v.optional(v.string(), ""),
  state: IssueStateName.schema,
  // Phase 6 additions (all optional):
  priority: v.optional(v.union([v.literal(1), v.literal(2), v.literal(3), v.literal(4)])),
  created_at: v.optional(v.string()), // ISO-8601; transformed to Date in buildIssue
  assignee_id: v.optional(v.nullable(v.string())),
  assigned_to_worker: v.optional(v.boolean()),
  blocked_by: v.optional(
    v.array(
      v.object({
        id: IssueId.schema,
        state: IssueStateName.schema,
      }),
    ),
  ),
});

const MemoryBlockYamlSchema = v.object({
  issues: v.optional(v.array(IssueYamlSchema), []),
});

const LinearBlockYamlSchema = v.object({
  api_key: v.string(),
  endpoint: v.optional(v.string()),
  project_slug: v.string(),
  assignee: v.optional(v.string()),
});

const GithubBlockYamlSchema = v.object({
  api_key: v.string(),
  endpoint: v.optional(v.string()),
  project_owner: v.string(),
  project_number: v.pipe(v.number(), v.integer(), v.minValue(1)),
  assignee: v.optional(v.string()),
});

const WorkspaceYamlSchema = v.strictObject({
  root: v.string(),
});

const HooksYamlSchema = v.object({
  before_run: v.optional(v.string()),
  after_create: v.optional(v.string()),
  before_remove: v.optional(v.string()),
  after_run: v.optional(v.string()),
  timeout_ms: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
});

const ObservabilityYamlSchema = v.optional(
  v.object({
    dashboard_enabled: v.optional(v.boolean()),
    refresh_ms: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
    render_interval_ms: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  }),
);

const PollingYamlSchema = v.optional(
  v.object({
    interval_ms: v.optional(v.pipe(v.number(), v.integer(), v.minValue(100))),
  }),
);

const LoggingYamlSchema = v.optional(
  v.object({
    file: v.optional(
      v.object({
        path: v.optional(v.string()),
        max_size_mb: v.optional(v.pipe(v.number(), v.minValue(1))),
        max_files: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
      }),
    ),
  }),
);

export const WorkflowYamlSchema = v.object({
  agent: AgentYamlSchema,
  claude: v.optional(ClaudeBlockYamlSchema),
  codex: v.optional(CodexBlockYamlSchema),
  mock: v.optional(MockBlockYamlSchema),
  tracker: TrackerCommonYamlSchema,
  memory: v.optional(MemoryBlockYamlSchema),
  linear: v.optional(LinearBlockYamlSchema),
  github: v.optional(GithubBlockYamlSchema),
  workspace: v.optional(WorkspaceYamlSchema),
  hooks: v.optional(HooksYamlSchema),
  observability: ObservabilityYamlSchema,
  polling: PollingYamlSchema,
  logging: LoggingYamlSchema,
});

export type WorkflowYaml = v.InferOutput<typeof WorkflowYamlSchema>;

// ──────────────────────────────────────────────────────────────────────────
// YAML → TS (camelCase, discriminated unions) transform
// ──────────────────────────────────────────────────────────────────────────

const buildBackend = (yaml: WorkflowYaml): Result.Result<BackendConfig, WorkflowYamlInvariant> => {
  switch (yaml.agent.type) {
    case "claude": {
      if (!yaml.claude) {
        return {
          type: "Failure",
          error: {
            kind: "invariant-violation",
            cause: "agent.type=claude requires a claude: block",
          },
        };
      }
      const out: ClaudeBackend = { type: "claude", command: yaml.claude.command };
      return { type: "Success", value: out };
    }
    case "codex": {
      if (!yaml.codex) {
        return {
          type: "Failure",
          error: {
            kind: "invariant-violation",
            cause: "agent.type=codex requires a `codex:` block",
          },
        };
      }
      const out: CodexBackend = {
        type: "codex",
        command: yaml.codex.command,
        approvalPolicy: yaml.codex.approval_policy,
        threadSandbox: yaml.codex.thread_sandbox,
        turnSandboxPolicy: yaml.codex.turn_sandbox_policy,
      };
      return { type: "Success", value: out };
    }
    case "mock": {
      const block = yaml.mock ?? {};
      const out: MockBackend = {
        type: "mock",
        ...(block.delay_ms !== undefined ? { delayMs: block.delay_ms } : {}),
        ...(block.force_fail !== undefined ? { forceFail: block.force_fail } : {}),
        ...(block.exit_mid_turn !== undefined ? { exitMidTurn: block.exit_mid_turn } : {}),
      };
      return { type: "Success", value: out };
    }
    default:
      return assertNever(yaml.agent.type);
  }
};

const buildAgent = (yaml: WorkflowYaml): Result.Result<AgentConfig, WorkflowYamlInvariant> => {
  const backend = buildBackend(yaml);
  if (backend.type === "Failure") return backend;
  return {
    type: "Success",
    value: {
      backend: backend.value,
      maxConcurrentAgents: yaml.agent.max_concurrent_agents,
      maxTurns: yaml.agent.max_turns,
      maxRetryBackoffMs: yaml.agent.max_retry_backoff_ms ?? 300_000,
      agentSessionStallTimeoutMs: yaml.agent.agent_session_stall_timeout_ms ?? 1_800_000,
      maxConcurrentAgentsByState: yaml.agent.max_concurrent_agents_by_state ?? {},
    },
  };
};

/** Returns a default absolute path for the log file (cwd + log/perform.log). */
const defaultLoggingPath = (): string => nodePath.resolve(process.cwd(), "log/perform.log");

const buildPolling = (yaml: WorkflowYaml): PollingConfig => ({
  intervalMs: yaml.polling?.interval_ms ?? 5_000,
});

const buildLogging = (
  yaml: WorkflowYaml,
): Result.Result<
  LoggingConfig,
  WorkflowYamlInvariant | Readonly<{ kind: "logging-path-not-absolute"; path: string }>
> => {
  const loggingFile = yaml.logging?.file ?? {};
  const loggingPath = loggingFile.path ?? defaultLoggingPath();
  if (!nodePath.isAbsolute(loggingPath)) {
    return {
      type: "Failure",
      error: { kind: "logging-path-not-absolute", path: loggingPath },
    };
  }
  const logging: LoggingConfig = {
    file: {
      path: loggingPath,
      maxSizeMb: loggingFile.max_size_mb ?? 10,
      maxFiles: loggingFile.max_files ?? 5,
    },
  };
  return { type: "Success", value: logging };
};

const buildIssue = (raw: v.InferOutput<typeof IssueYamlSchema>): Issue => ({
  id: raw.id,
  identifier: raw.identifier,
  title: raw.title,
  description: raw.description,
  state: raw.state,
  priority: raw.priority ?? null,
  createdAt: raw.created_at ? new Date(raw.created_at) : null,
  assigneeId: raw.assignee_id ?? null,
  assignedToWorker: raw.assigned_to_worker ?? true,
  blockedBy: raw.blocked_by ?? [],
});

const buildTracker = (yaml: WorkflowYaml): Result.Result<TrackerConfig, WorkflowYamlInvariant> => {
  const common = {
    activeStates: yaml.tracker.active_states,
    terminalStates: yaml.tracker.terminal_states,
    ...(yaml.tracker.doing_state !== undefined ? { doingState: yaml.tracker.doing_state } : {}),
    ...(yaml.tracker.done_state !== undefined ? { doneState: yaml.tracker.done_state } : {}),
  };
  switch (yaml.tracker.kind) {
    case "memory": {
      const issues = (yaml.memory?.issues ?? []).map(buildIssue);
      const out: MemoryTrackerConfig = { kind: "memory", ...common, issues };
      return { type: "Success", value: out };
    }
    case "linear": {
      if (!yaml.linear) {
        return {
          type: "Failure",
          error: {
            kind: "invariant-violation",
            cause: "tracker.kind=linear requires a `linear:` block",
          },
        };
      }
      const apiKeyR = resolveEnvRef(yaml.linear.api_key);
      if (apiKeyR.type === "Failure") {
        return {
          type: "Failure",
          error: {
            kind: "invariant-violation",
            cause: `linear.api_key: ${apiKeyR.error.kind} ($${apiKeyR.error.var})`,
          },
        };
      }
      let assignee: string | undefined;
      if (yaml.linear.assignee !== undefined) {
        const r = resolveEnvRef(yaml.linear.assignee);
        if (r.type === "Failure") {
          return {
            type: "Failure",
            error: {
              kind: "invariant-violation",
              cause: `linear.assignee: ${r.error.kind} ($${r.error.var})`,
            },
          };
        }
        assignee = r.value;
      }
      const out: LinearTrackerConfig = {
        kind: "linear",
        ...common,
        apiKey: Sensitive.of(apiKeyR.value),
        ...(yaml.linear.endpoint !== undefined ? { endpoint: yaml.linear.endpoint } : {}),
        projectSlug: yaml.linear.project_slug,
        ...(assignee !== undefined ? { assignee } : {}),
      };
      return { type: "Success", value: out };
    }
    case "github": {
      if (!yaml.github) {
        return {
          type: "Failure",
          error: {
            kind: "invariant-violation",
            cause: "tracker.kind=github requires a `github:` block",
          },
        };
      }
      const apiKeyR = resolveEnvRef(yaml.github.api_key);
      if (apiKeyR.type === "Failure") {
        return {
          type: "Failure",
          error: {
            kind: "invariant-violation",
            cause: `github.api_key: ${apiKeyR.error.kind} ($${apiKeyR.error.var})`,
          },
        };
      }
      let assignee: string | undefined;
      if (yaml.github.assignee !== undefined) {
        const r = resolveEnvRef(yaml.github.assignee);
        if (r.type === "Failure") {
          return {
            type: "Failure",
            error: {
              kind: "invariant-violation",
              cause: `github.assignee: ${r.error.kind} ($${r.error.var})`,
            },
          };
        }
        assignee = r.value;
      }
      const out: GithubTrackerConfig = {
        kind: "github",
        ...common,
        apiKey: Sensitive.of(apiKeyR.value),
        ...(yaml.github.endpoint !== undefined ? { endpoint: yaml.github.endpoint } : {}),
        projectOwner: yaml.github.project_owner,
        projectNumber: yaml.github.project_number,
        ...(assignee !== undefined ? { assignee } : {}),
      };
      return { type: "Success", value: out };
    }
    default:
      return assertNever(yaml.tracker.kind);
  }
};

const buildWorkspace = (yaml: WorkflowYaml): WorkspaceConfig | undefined => {
  if (!yaml.workspace) return undefined;
  return { root: yaml.workspace.root };
};

const buildHooks = (yaml: WorkflowYaml): HooksConfig | undefined => {
  if (!yaml.hooks) return undefined;
  const h = yaml.hooks;
  return {
    ...(h.before_run !== undefined ? { beforeRun: h.before_run } : {}),
    ...(h.after_create !== undefined ? { afterCreate: h.after_create } : {}),
    ...(h.before_remove !== undefined ? { beforeRemove: h.before_remove } : {}),
    ...(h.after_run !== undefined ? { afterRun: h.after_run } : {}),
    ...(h.timeout_ms !== undefined ? { timeoutMs: h.timeout_ms } : {}),
  };
};

const buildObservability = (yaml: WorkflowYaml): ObservabilityConfig =>
  yaml.observability
    ? {
        dashboardEnabled: yaml.observability.dashboard_enabled ?? DEFAULT_DASHBOARD_ENABLED,
        refreshMs: yaml.observability.refresh_ms ?? DEFAULT_REFRESH_MS,
        renderIntervalMs: yaml.observability.render_interval_ms ?? DEFAULT_RENDER_INTERVAL_MS,
      }
    : DEFAULT_OBSERVABILITY_CONFIG;

/**
 * Parses a raw YAML object (already loaded by js-yaml) and transforms it into
 * the strongly-typed `WorkflowConfig`. Does NOT attach the markdown prompt
 * body — caller (config/parser.ts) does that.
 *
 * Returns a byethrow Result. Both schema violations and cross-block invariant
 * failures (e.g., agent.type=claude requires a claude: block) come back as
 * Failure; the caller in config/parser.ts maps them to ConfigError.
 */
export const parseWorkflowYaml = (
  raw: unknown,
): Result.Result<Omit<WorkflowConfig, "prompt">, WorkflowYamlError> => {
  // Note: WorkflowYamlError includes "logging-path-not-absolute" so the
  // buildLogging failure propagates through the union without any cast.
  const yamlResult = schemaResult(WorkflowYamlSchema)(raw);
  if (yamlResult.type === "Failure") {
    return {
      type: "Failure",
      error: { kind: "schema-violation", issues: yamlResult.error.issues },
    };
  }
  const yaml = yamlResult.value;
  const agentR = buildAgent(yaml);
  if (agentR.type === "Failure") return agentR;
  const trackerR = buildTracker(yaml);
  if (trackerR.type === "Failure") return trackerR;
  const loggingR = buildLogging(yaml);
  if (loggingR.type === "Failure") return loggingR;
  const workspace = buildWorkspace(yaml);
  const hooks = buildHooks(yaml);
  const observability = buildObservability(yaml);
  const polling = buildPolling(yaml);
  const out: Omit<WorkflowConfig, "prompt"> = {
    agent: agentR.value,
    tracker: trackerR.value,
    ...(workspace !== undefined ? { workspace } : {}),
    ...(hooks !== undefined ? { hooks } : {}),
    observability,
    polling,
    logging: loggingR.value,
  };
  return { type: "Success", value: out };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("config/schema", () => {
    it("parses a mock + memory minimal YAML object", () => {
      const raw = {
        agent: { type: "mock", max_concurrent_agents: 1, max_turns: 1 },
        mock: { delay_ms: 0 },
        tracker: {
          kind: "memory",
          active_states: ["Todo"],
          terminal_states: ["Done"],
          doing_state: "In Progress",
          done_state: "Done",
        },
        memory: {
          issues: [{ id: "M-1", identifier: "M-1", title: "t", description: "d", state: "Todo" }],
        },
      };
      const result = v.safeParse(WorkflowYamlSchema, raw);
      expect(result.success).toBe(true);
    });

    it("transforms YAML shape into WorkflowConfig (without prompt body)", () => {
      const raw = {
        agent: { type: "mock", max_concurrent_agents: 1, max_turns: 1 },
        mock: {},
        tracker: { kind: "memory", active_states: [], terminal_states: [] },
        memory: { issues: [] },
      };
      const result = parseWorkflowYaml(raw);
      if (result.type !== "Success") throw new Error("unexpected failure");
      expect(result.value.agent.backend.type).toBe("mock");
      expect(result.value.tracker.kind).toBe("memory");
    });

    it("rejects unknown agent.type", () => {
      const raw = {
        agent: { type: "bogus", max_concurrent_agents: 1, max_turns: 1 },
        tracker: { kind: "memory" },
      };
      const result = parseWorkflowYaml(raw);
      expect(result.type).toBe("Failure");
    });

    it("returns invariant-violation Failure when agent.type=claude has no claude: block", () => {
      const raw = {
        agent: { type: "claude", max_concurrent_agents: 1, max_turns: 1 },
        tracker: { kind: "memory" },
      };
      const r = parseWorkflowYaml(raw);
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("invariant-violation");
      if (r.error.kind === "invariant-violation") {
        expect(r.error.cause).toMatch(/claude: block/);
      }
    });

    it("parses top-level hooks block with all four hooks + timeout_ms", () => {
      const raw = {
        agent: { type: "mock", max_concurrent_agents: 1, max_turns: 1 },
        mock: {},
        tracker: { kind: "memory" },
        workspace: { root: "/tmp/ws" },
        hooks: {
          before_run: "echo before-run",
          after_create: "git init",
          before_remove: "echo before-remove",
          after_run: "echo after-run",
          timeout_ms: 30_000,
        },
      };
      const r = parseWorkflowYaml(raw);
      if (r.type !== "Success") throw new Error("expected success");
      expect(r.value.workspace?.root).toBe("/tmp/ws");
      expect(r.value.hooks?.afterCreate).toBe("git init");
      expect(r.value.hooks?.afterRun).toBe("echo after-run");
      expect(r.value.hooks?.timeoutMs).toBe(30_000);
    });

    it("rejects hooks nested under workspace (Phase 1 buggy shape)", () => {
      const raw = {
        agent: { type: "mock", max_concurrent_agents: 1, max_turns: 1 },
        mock: {},
        tracker: { kind: "memory" },
        workspace: { root: "/tmp/ws", hooks: { after_create: "git init" } },
      };
      const r = parseWorkflowYaml(raw);
      if (r.type !== "Failure") throw new Error("expected schema failure");
      if (r.error.kind !== "schema-violation") throw new Error("expected schema-violation");
      const paths = r.error.issues.map((i) => formatIssuePath(i));
      expect(paths.some((p) => /workspace/.test(p))).toBe(true);
    });

    it("expands linear.api_key from $LINEAR_API_KEY env var", () => {
      const prev = process.env.LINEAR_API_KEY;
      process.env.LINEAR_API_KEY = "lin_xxx_from_env";
      try {
        const raw = {
          agent: { type: "claude", max_concurrent_agents: 1, max_turns: 1 },
          claude: { command: "claude-app-server" },
          tracker: { kind: "linear", terminal_states: ["Done"] },
          linear: { api_key: "$LINEAR_API_KEY", project_slug: "studio-xxx" },
        };
        const r = parseWorkflowYaml(raw);
        if (r.type !== "Success") throw new Error("expected success");
        if (r.value.tracker.kind !== "linear") throw new Error("expected linear tracker");
        expect(r.value.tracker.apiKey.reveal()).toBe("lin_xxx_from_env");
      } finally {
        if (prev === undefined) delete process.env.LINEAR_API_KEY;
        else process.env.LINEAR_API_KEY = prev;
      }
    });

    it("returns invariant-violation when linear.api_key references missing env var", () => {
      const prev = process.env.LINEAR_NOTSET;
      delete process.env.LINEAR_NOTSET;
      try {
        const raw = {
          agent: { type: "claude", max_concurrent_agents: 1, max_turns: 1 },
          claude: { command: "claude-app-server" },
          tracker: { kind: "linear", terminal_states: ["Done"] },
          linear: { api_key: "$LINEAR_NOTSET", project_slug: "p" },
        };
        const r = parseWorkflowYaml(raw);
        if (r.type !== "Failure") throw new Error("expected failure");
        expect(r.error.kind).toBe("invariant-violation");
        if (r.error.kind === "invariant-violation") {
          expect(r.error.cause).toMatch(/linear\.api_key: missing-env \(\$LINEAR_NOTSET\)/);
        }
      } finally {
        if (prev !== undefined) process.env.LINEAR_NOTSET = prev;
      }
    });

    it("treats literal linear.api_key as-is (no $ prefix)", () => {
      const raw = {
        agent: { type: "claude", max_concurrent_agents: 1, max_turns: 1 },
        claude: { command: "claude-app-server" },
        tracker: { kind: "linear", terminal_states: ["Done"] },
        linear: { api_key: "lin_literal", project_slug: "p" },
      };
      const r = parseWorkflowYaml(raw);
      if (r.type !== "Success") throw new Error("expected success");
      if (r.value.tracker.kind !== "linear") throw new Error("expected linear tracker");
      expect(r.value.tracker.apiKey.reveal()).toBe("lin_literal");
    });

    it("expands github.api_key from $GITHUB_TOKEN env var", () => {
      const prev = process.env.GITHUB_TOKEN;
      process.env.GITHUB_TOKEN = "ghp_xxx_from_env";
      try {
        const raw = {
          agent: { type: "claude", max_concurrent_agents: 1, max_turns: 1 },
          claude: { command: "claude-app-server" },
          tracker: { kind: "github", terminal_states: ["Done"] },
          github: { api_key: "$GITHUB_TOKEN", project_owner: "babie", project_number: 3 },
        };
        const r = parseWorkflowYaml(raw);
        if (r.type !== "Success") throw new Error("expected success");
        if (r.value.tracker.kind !== "github") throw new Error("expected github tracker");
        expect(r.value.tracker.apiKey.reveal()).toBe("ghp_xxx_from_env");
      } finally {
        if (prev === undefined) delete process.env.GITHUB_TOKEN;
        else process.env.GITHUB_TOKEN = prev;
      }
    });

    it("returns invariant-violation when github.api_key references missing env var", () => {
      const prev = process.env.GH_NOTSET;
      delete process.env.GH_NOTSET;
      try {
        const raw = {
          agent: { type: "claude", max_concurrent_agents: 1, max_turns: 1 },
          claude: { command: "claude-app-server" },
          tracker: { kind: "github", terminal_states: ["Done"] },
          github: { api_key: "$GH_NOTSET", project_owner: "o", project_number: 1 },
        };
        const r = parseWorkflowYaml(raw);
        if (r.type !== "Failure") throw new Error("expected failure");
        expect(r.error.kind).toBe("invariant-violation");
      } finally {
        if (prev !== undefined) process.env.GH_NOTSET = prev;
      }
    });

    it("treats literal github.api_key as-is (no $ prefix)", () => {
      const raw = {
        agent: { type: "claude", max_concurrent_agents: 1, max_turns: 1 },
        claude: { command: "claude-app-server" },
        tracker: { kind: "github", terminal_states: ["Done"] },
        github: { api_key: "ghp_literal", project_owner: "o", project_number: 1 },
      };
      const r = parseWorkflowYaml(raw);
      if (r.type !== "Success") throw new Error("expected success");
      if (r.value.tracker.kind !== "github") throw new Error("expected github tracker");
      expect(r.value.tracker.apiKey.reveal()).toBe("ghp_literal");
    });

    it('treats github.assignee="me" as literal (no env expansion)', () => {
      const raw = {
        agent: { type: "claude", max_concurrent_agents: 1, max_turns: 1 },
        claude: { command: "claude-app-server" },
        tracker: { kind: "github", terminal_states: ["Done"] },
        github: { api_key: "ghp_x", project_owner: "o", project_number: 1, assignee: "me" },
      };
      const r = parseWorkflowYaml(raw);
      if (r.type !== "Success") throw new Error("expected success");
      if (r.value.tracker.kind !== "github") throw new Error("expected github tracker");
      expect(r.value.tracker.assignee).toBe("me");
    });

    it("no observability block → config.observability equals DEFAULT_OBSERVABILITY_CONFIG", () => {
      const raw = {
        agent: { type: "mock", max_concurrent_agents: 1, max_turns: 1 },
        mock: {},
        tracker: { kind: "memory", active_states: [], terminal_states: [] },
      };
      const r = parseWorkflowYaml(raw);
      if (r.type !== "Success") throw new Error("expected success");
      expect(r.value.observability).toEqual(DEFAULT_OBSERVABILITY_CONFIG);
    });

    it("full observability block → config.observability has specified values", () => {
      const raw = {
        agent: { type: "mock", max_concurrent_agents: 1, max_turns: 1 },
        mock: {},
        tracker: { kind: "memory", active_states: [], terminal_states: [] },
        observability: { dashboard_enabled: false, refresh_ms: 2000, render_interval_ms: 32 },
      };
      const r = parseWorkflowYaml(raw);
      if (r.type !== "Success") throw new Error("expected success");
      expect(r.value.observability.dashboardEnabled).toBe(false);
      expect(r.value.observability.refreshMs).toBe(2000);
      expect(r.value.observability.renderIntervalMs).toBe(32);
    });

    it("partial observability block → unset fields take defaults", () => {
      const raw = {
        agent: { type: "mock", max_concurrent_agents: 1, max_turns: 1 },
        mock: {},
        tracker: { kind: "memory", active_states: [], terminal_states: [] },
        observability: { refresh_ms: 2000 },
      };
      const r = parseWorkflowYaml(raw);
      if (r.type !== "Success") throw new Error("expected success");
      expect(r.value.observability.refreshMs).toBe(2000);
      expect(r.value.observability.dashboardEnabled).toBe(DEFAULT_DASHBOARD_ENABLED);
      expect(r.value.observability.renderIntervalMs).toBe(DEFAULT_RENDER_INTERVAL_MS);
    });

    it("Memory IssueYaml populates priority/createdAt/assigneeId/assignedToWorker/blockedBy from YAML", () => {
      const result = parseWorkflowYaml({
        agent: { type: "mock", max_concurrent_agents: 1, max_turns: 1 },
        tracker: { kind: "memory", active_states: ["Todo"], terminal_states: ["Done"] },
        memory: {
          issues: [
            {
              id: "M-1",
              identifier: "M-1",
              title: "t",
              state: "Todo",
              priority: 2,
              created_at: "2026-01-01T00:00:00Z",
              assignee_id: "u_42",
              assigned_to_worker: true,
              blocked_by: [{ id: "M-2", state: "In Progress" }],
            },
          ],
        },
        workspace: { root: "/tmp/ws" },
      });
      if (result.type !== "Success") throw new Error("expected ok");
      if (result.value.tracker.kind !== "memory") throw new Error("expected memory kind");
      const issue = result.value.tracker.issues[0];
      if (!issue) throw new Error("expected one issue");
      expect(issue.priority).toBe(2);
      expect(issue.createdAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(issue.assigneeId).toBe("u_42");
      expect(issue.assignedToWorker).toBe(true);
      expect(issue.blockedBy.length).toBe(1);
    });

    it("Memory IssueYaml defaults to null/true/[] when 5 fields omitted", () => {
      const result = parseWorkflowYaml({
        agent: { type: "mock", max_concurrent_agents: 1, max_turns: 1 },
        tracker: { kind: "memory", active_states: ["Todo"], terminal_states: ["Done"] },
        memory: {
          issues: [{ id: "M-1", identifier: "M-1", title: "t", state: "Todo" }],
        },
        workspace: { root: "/tmp/ws" },
      });
      if (result.type !== "Success") throw new Error("expected ok");
      if (result.value.tracker.kind !== "memory") throw new Error("expected memory kind");
      const issue = result.value.tracker.issues[0];
      if (!issue) throw new Error("expected one issue");
      expect(issue.priority).toBeNull();
      expect(issue.createdAt).toBeNull();
      expect(issue.assigneeId).toBeNull();
      expect(issue.assignedToWorker).toBe(true);
      expect(issue.blockedBy).toEqual([]);
    });

    it("parses default agent.max_retry_backoff_ms = 300000", () => {
      const r = parseWorkflowYaml({
        agent: { type: "mock", max_concurrent_agents: 1, max_turns: 1 },
        tracker: { kind: "memory", active_states: ["Todo"], terminal_states: ["Done"] },
        memory: { issues: [] },
        workspace: { root: "/tmp/ws" },
      });
      if (r.type !== "Success") throw new Error("expected ok: " + JSON.stringify(r.error));
      expect(r.value.agent.maxRetryBackoffMs).toBe(300_000);
      expect(r.value.agent.agentSessionStallTimeoutMs).toBe(1_800_000);
      expect(r.value.polling.intervalMs).toBe(5_000);
      expect(r.value.logging?.file.maxSizeMb).toBe(10);
    });

    it("rejects relative logging.file.path", () => {
      const r = parseWorkflowYaml({
        agent: { type: "mock", max_concurrent_agents: 1, max_turns: 1 },
        tracker: { kind: "memory", active_states: ["Todo"], terminal_states: ["Done"] },
        memory: { issues: [] },
        workspace: { root: "/tmp/ws" },
        logging: { file: { path: "./log/x.log" } },
      });
      expect(r.type).toBe("Failure");
      if (r.type === "Failure") expect(r.error.kind).toBe("logging-path-not-absolute");
    });

    it("honours custom max_concurrent_agents_by_state", () => {
      const r = parseWorkflowYaml({
        agent: {
          type: "mock",
          max_concurrent_agents: 5,
          max_turns: 1,
          max_concurrent_agents_by_state: { "In Progress": 2 },
        },
        tracker: { kind: "memory", active_states: ["Todo"], terminal_states: ["Done"] },
        memory: { issues: [] },
        workspace: { root: "/tmp/ws" },
      });
      if (r.type !== "Success") throw new Error("expected ok: " + JSON.stringify(r.error));
      expect(r.value.agent.maxConcurrentAgentsByState["In Progress"]).toBe(2);
    });
  });
}
