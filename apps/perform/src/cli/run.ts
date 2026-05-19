import { readFile } from "node:fs/promises";
import { parseWorkflow } from "../config/parser.js";
import { createTracker } from "../tracker/factory.js";
import { createBackend } from "../backend/factory.js";
import { runOrchestrator } from "../orchestrator/orchestrator.js";
import { createStdLogger, createNoopLogger } from "../util/logger.js";
import { assertNever } from "../util/assert-never.js";
import type { BackendError } from "../domain/backend-errors.js";
import type { ConfigError } from "../domain/config-errors.js";
import type { OrchestratorError } from "../domain/orchestrator-errors.js";
import type { TrackerError } from "../domain/tracker-errors.js";
import type { WorkspaceError } from "../domain/workspace-errors.js";
import type { PromptError } from "../domain/prompt-errors.js";
import { ObservabilityState } from "../observability/state.js";
import { EventBus } from "../observability/event-bus.js";
import { Dashboard } from "../observability/dashboard.js";
import { NULL_HOOKS, type ObservabilityHooks } from "../observability/instrumentation.js";
import type { FormatRuntimeContext } from "../observability/render/snapshot.js";
import type { ProjectLinkInput } from "../observability/render/project-link.js";

export const GUARDRAIL_FLAG =
  "--i-understand-that-this-will-be-running-without-the-usual-guardrails";

export type RunCliOptions = Readonly<{
  workflowPath: string;
  guardrailAccepted: boolean;
  noDashboard?: boolean;
}>;

const formatConfigError = (err: ConfigError): string => {
  switch (err.kind) {
    case "file-not-found":
      return `workflow file not found: ${err.path}`;
    case "frontmatter-missing":
      return `workflow frontmatter (--- ... ---) missing: ${err.path}`;
    case "yaml-parse-failed":
      return `YAML parse failed in ${err.path}: ${err.cause}`;
    case "schema-violation":
      return `schema violation in ${err.path}: ${err.issues.map((i) => i.message).join("; ")}`;
    case "invariant-violation":
      return `workflow invariant violated in ${err.path}: ${err.cause}`;
    case "logging-path-not-absolute":
      return `logging.file.path must be absolute: ${err.path}`;
    default:
      return assertNever(err);
  }
};

const formatBackendError = (err: BackendError): string => {
  switch (err.kind) {
    case "mock-forced-failure":
      return `mock-forced-failure: ${err.reason}`;
    case "spawn-failed":
      return `spawn-failed: command="${err.command}" cause=${err.cause}`;
    case "stdio-protocol-error":
      return `stdio-protocol-error: phase=${err.phase}`;
    case "jsonrpc-error":
      return `jsonrpc-error: code=${err.code} message="${err.message}"${err.method ? ` method=${err.method}` : ""}`;
    case "request-timeout":
      return `request-timeout: method=${err.method} timeout=${err.timeoutMs}ms`;
    case "subprocess-crashed":
      return `subprocess-crashed: exitCode=${err.exitCode} signal=${err.signal} stderrTail=${JSON.stringify(err.stderrTail.slice(-200))}`;
    case "turn-not-completed":
      return `turn-not-completed: thread=${err.threadId} reason=${err.reason}`;
    case "session-exited-mid-turn":
      return `session-exited-mid-turn: exitCode=${err.exitCode} signal=${err.signal}`;
    case "aborted":
      return `aborted`;
    default:
      return assertNever(err);
  }
};

const formatWorkspaceError = (err: WorkspaceError): string => {
  switch (err.kind) {
    case "path-unsafe":
      return `path-unsafe: ${err.path}`;
    case "create-failed":
      return `workspace-create-failed: ${err.path} cause=${err.cause}`;
    case "hook-failed":
      return `hook-failed: hook=${err.hook} exit=${err.exitCode} stderrTail=${JSON.stringify(err.stderrTail.slice(-200))}`;
    case "hook-timeout":
      return `hook-timeout: hook=${err.hook} timeout=${err.timeoutMs}ms`;
    default:
      return assertNever(err);
  }
};

const formatPromptError = (err: PromptError): string => {
  switch (err.kind) {
    case "template-parse-failed":
      return `template-parse-failed: ${err.cause}`;
    case "render-failed":
      return `render-failed: ${err.cause}${err.missingVariables ? ` missing=${err.missingVariables.join(",")}` : ""}`;
    default:
      return assertNever(err);
  }
};

const formatTrackerError = (err: TrackerError): string => {
  switch (err.kind) {
    case "unknown-state":
      return `unknown state name: "${err.state}"`;
    case "issue-not-found":
      return `issue not found: ${err.id}`;
    case "linear-http":
      return `Linear HTTP ${err.status}: ${err.bodyExcerpt}`;
    case "linear-graphql-errors":
      return `Linear GraphQL error(s): ${err.messages.join("; ")}`;
    case "linear-response-invalid":
      return `Linear response did not match schema: ${err.issues.join("; ")}`;
    case "linear-network":
      return `Linear network error: ${err.cause} (check LINEAR_API_KEY and connectivity)`;
    case "linear-state-not-found":
      return `Linear: workflow state "${err.stateName}" not found in the issue's team`;
    case "linear-config":
      return `Linear config error: ${err.cause}`;
    case "github-http":
      return `GitHub HTTP ${err.status}: ${err.bodyExcerpt}`;
    case "github-graphql-errors":
      return `GitHub GraphQL error(s): ${err.messages.join("; ")}`;
    case "github-response-invalid":
      return `GitHub response did not match schema: ${err.issues.join("; ")}`;
    case "github-network":
      return `GitHub network error: ${err.cause} (check GITHUB_TOKEN and connectivity)`;
    case "github-project-not-found":
      return `GitHub project not found: owner=${err.owner} number=${err.number} (check project_owner / project_number)`;
    case "github-status-field-not-found":
      return `GitHub project has no SingleSelect field named "${err.fieldName}"`;
    case "github-status-option-not-found":
      return `GitHub project Status option "${err.optionName}" not found (available: ${err.available.join(", ")})`;
    case "github-no-project-item":
      return `GitHub: issue ${err.issueIdentifier} has no resolved project item (was Issue.extra populated?)`;
    case "github-config":
      return `GitHub config error: ${err.cause}`;
    case "unsupported-tracker-kind":
      return `tracker.kind="${err.kind_}" is not supported in this build`;
    case "tracker-timeout":
      return `tracker-timeout: operation=${err.operation} timeout=${err.timeoutMs}ms`;
    default:
      return assertNever(err);
  }
};

const formatOrchestratorError = (err: OrchestratorError): string => {
  switch (err.kind) {
    case "config":
      return formatConfigError(err.error);
    case "tracker":
      return `tracker error: ${formatTrackerError(err.error)}`;
    case "backend":
      return `backend error: ${formatBackendError(err.error)}`;
    case "workspace":
      return `workspace error: ${formatWorkspaceError(err.error)}`;
    case "prompt":
      return `prompt error: ${formatPromptError(err.error)}`;
    case "guardrail-missing":
      return `guardrail flag ${err.flag} is required`;
    case "stall-restart":
      return `stall-restart: issue=${err.issueId} elapsed=${err.elapsedMs}ms`;
    default:
      return assertNever(err);
  }
};

export const runCli = async (opts: RunCliOptions): Promise<void> => {
  // We need a logger before config is parsed for early error messages.
  // We'll use a temporary std logger for pre-config errors and replace it
  // after we know whether dashboard mode is requested.
  const earlyLogger = createStdLogger();

  if (!opts.guardrailAccepted) {
    earlyLogger.error(
      `Refusing to start. Pass ${GUARDRAIL_FLAG} to acknowledge that perform runs agents without per-tool prompts.`,
    );
    process.exit(2);
  }

  const raw = await readFile(opts.workflowPath, "utf8").catch(() => null);
  if (raw === null) {
    earlyLogger.error(formatConfigError({ kind: "file-not-found", path: opts.workflowPath }));
    process.exit(1);
  }

  const parsed = parseWorkflow(opts.workflowPath, raw);
  if (parsed.type === "Failure") {
    earlyLogger.error(formatConfigError(parsed.error));
    process.exit(1);
  }
  const config = parsed.value;

  // Determine dashboard mode (requires config so observability settings are available)
  const dashboardRequested =
    config.observability.dashboardEnabled &&
    !opts.noDashboard &&
    !process.env.PERFORM_DEBUG &&
    Boolean(process.stdout.isTTY);

  const logger = dashboardRequested ? createNoopLogger() : createStdLogger();

  const trackerR = await createTracker(config.tracker, { logger });
  if (trackerR.type === "Failure") {
    logger.error(`tracker construction failed: ${formatTrackerError(trackerR.error)}`);
    logger.error(`config (apiKey auto-masked): ${JSON.stringify(config)}`);
    process.exit(1);
  }
  const tracker = trackerR.value;
  const backend = createBackend(config.agent.backend, logger);

  // Build ProjectLinkInput from tracker config
  const projectLink: ProjectLinkInput = (() => {
    switch (config.tracker.kind) {
      case "memory":
        return { kind: "memory" };
      case "linear":
        return { kind: "linear", projectSlug: config.tracker.projectSlug };
      case "github":
        return {
          kind: "github",
          projectOwner: config.tracker.projectOwner,
          projectNumber: config.tracker.projectNumber,
        };
    }
  })();
  const runtimeContext: FormatRuntimeContext = {
    projectLink,
    maxAgents: config.agent.maxConcurrentAgents,
  };

  // Start dashboard if requested
  let dashboard: Dashboard | null = null;
  let hooks: ObservabilityHooks = NULL_HOOKS;
  if (dashboardRequested) {
    const state = new ObservabilityState();
    const bus = new EventBus();
    state.attachBus(bus);
    dashboard = new Dashboard({
      state,
      bus,
      refreshMs: config.observability.refreshMs,
      renderIntervalMs: config.observability.renderIntervalMs,
      runtimeContext,
    });
    dashboard.start();
    hooks = state;
  }

  const controller = new AbortController();
  const sigintHandler = () => {
    logger.info("[orchestrator] SIGINT received, aborting...");
    controller.abort();
  };
  process.on("SIGINT", sigintHandler);
  process.on("SIGTERM", sigintHandler);

  try {
    const result = await runOrchestrator({
      tracker,
      backend,
      config,
      logger,
      hooks,
      signal: controller.signal,
    });
    if (result.type === "Failure") {
      dashboard?.stop();
      process.stderr.write(`[error] ${formatOrchestratorError(result.error)}\n`);
      process.exit(1);
    }
    if (!dashboardRequested) {
      logger.info(
        `[orchestrator] done: total=${result.value.total} completed=${result.value.completed} failed=${result.value.failed}`,
      );
    }
  } finally {
    process.off("SIGINT", sigintHandler);
    process.off("SIGTERM", sigintHandler);
    dashboard?.stop();
    if (dashboardRequested) {
      process.stderr.write(`[done] dashboard stopped\n`);
    }
  }
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("cli/run (Phase 2)", () => {
    it("exports GUARDRAIL_FLAG constant", () => {
      expect(GUARDRAIL_FLAG.startsWith("--i-understand-")).toBe(true);
    });
  });

  describe("cli/run — formatTrackerError github variants", () => {
    const cases: ReadonlyArray<[TrackerError, RegExp]> = [
      [{ kind: "github-http", status: 401, bodyExcerpt: "bad" }, /GitHub HTTP 401/],
      [{ kind: "github-graphql-errors", messages: ["x", "y"] }, /GitHub GraphQL error.*x; y/],
      [{ kind: "github-response-invalid", issues: ["a: b"] }, /did not match schema.*a: b/],
      [{ kind: "github-network", cause: "ECONN" }, /GitHub network error: ECONN/],
      [{ kind: "github-project-not-found", owner: "babie", number: 3 }, /owner=babie number=3/],
      [
        { kind: "github-status-field-not-found", fieldName: "Status" },
        /SingleSelect field named "Status"/,
      ],
      [
        { kind: "github-status-option-not-found", optionName: "Done", available: ["Todo"] },
        /option "Done" not found \(available: Todo\)/,
      ],
      [
        { kind: "github-no-project-item", issueIdentifier: "babie/studio#1" },
        /issue babie\/studio#1/,
      ],
      [{ kind: "github-config", cause: "warmup failed" }, /GitHub config error: warmup failed/],
    ];
    for (const [err, pattern] of cases) {
      it(`formats ${err.kind}`, () => {
        expect(formatTrackerError(err)).toMatch(pattern);
      });
    }
  });
}
