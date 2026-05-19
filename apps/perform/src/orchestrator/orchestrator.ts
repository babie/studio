import type { Result } from "@praha/byethrow";
import type { OrchestratorError } from "../domain/orchestrator-errors.js";
import type { Tracker } from "../tracker/types.js";
import type { Backend } from "../backend/types.js";
import type { WorkflowConfig } from "../domain/workflow-config.js";
import type { ObservabilityHooks } from "../observability/instrumentation.js";

export type Logger = Readonly<{
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (err: unknown) => void;
}>;

export type RunOrchestratorInput = Readonly<{
  tracker: Tracker;
  backend: Backend;
  config: WorkflowConfig;
  logger: Logger;
  signal: AbortSignal;
  hooks?: ObservabilityHooks;
}>;

export type RunSummary = Readonly<{
  total: number;
  completed: number;
  failed: number;
}>;

export const runOrchestrator = async (
  input: RunOrchestratorInput,
): Promise<Result.Result<RunSummary, OrchestratorError>> => {
  const { runScheduler } = await import("./scheduler.js");
  try {
    const summary = await runScheduler({
      tracker: input.tracker,
      backend: input.backend,
      config: input.config,
      logger: input.logger,
      signal: input.signal,
      ...(input.hooks ? { hooks: input.hooks } : {}),
    });
    return { type: "Success", value: summary };
  } catch (err) {
    // Map any unhandled async error to a known BackendError variant. The Scheduler's typed
    // Result paths are not propagated as exceptions — this catch is purely defensive.
    return {
      type: "Failure",
      error: {
        kind: "backend",
        error: {
          kind: "spawn-failed",
          command: "scheduler",
          cause: String(err),
        },
      },
    };
  }
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  const { createMockBackend } = await import("../backend/mock.js");
  const { createMemoryTracker } = await import("../tracker/memory.js");
  const v2 = await import("valibot");
  const { IssueId, IssueIdentifier, IssueStateName: ISN } = await import("../domain/issue.js");

  const { tmpdir } = await import("node:os");
  const { mkdtemp } = await import("node:fs/promises");
  const { join } = await import("node:path");

  // Shared tracker config: active=Todo, terminal=Done, doing=In Progress, done=Done.
  // The mock backend's turn returns success immediately; the agent-runner transitions
  // the issue to "In Progress" (doingState), which is not in activeStates, so completed=true,
  // then updates to "Done" (doneState). The Memory tracker persists the state mutation so
  // subsequent fetchCandidateIssues calls don't re-surface the same issue.
  const TRACKER_CFG = {
    kind: "memory" as const,
    activeStates: ["Todo"],
    terminalStates: ["Done"],
    doingState: "In Progress",
    doneState: "Done",
    issues: [
      {
        id: v2.parse(IssueId.schema, "M-1"),
        identifier: v2.parse(IssueIdentifier.schema, "M-1"),
        title: "one",
        description: "",
        state: v2.parse(ISN.schema, "Todo"),
        priority: null,
        createdAt: null,
        assigneeId: null,
        assignedToWorker: true,
        blockedBy: [],
      },
    ],
  };

  describe("orchestrator/orchestrator (Phase 2)", () => {
    it("drives every issue through Todo → Done with mock backend", async () => {
      const root = await mkdtemp(join(tmpdir(), "perform-orch-"));
      const tracker = createMemoryTracker(TRACKER_CFG);
      const backend = createMockBackend({ type: "mock" });
      const logger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
      const config: WorkflowConfig = {
        agent: {
          backend: { type: "mock" },
          maxConcurrentAgents: 1,
          maxTurns: 1,
          maxRetryBackoffMs: 300_000,
          agentSessionStallTimeoutMs: 1_800_000,
          maxConcurrentAgentsByState: {},
        },
        tracker: TRACKER_CFG,
        prompt: "{{ issue.identifier }}",
        workspace: { root },
        observability: { dashboardEnabled: true, refreshMs: 1000, renderIntervalMs: 16 },
        polling: { intervalMs: 50 },
        logging: null,
      };
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 2000);
      const res = await runOrchestrator({
        tracker,
        backend,
        config,
        logger,
        signal: ctrl.signal,
      });
      if (res.type !== "Success") throw new Error("expected success");
      expect(res.value.total).toBe(1);
      expect(res.value.completed).toBe(1);
    });

    it("calls hooks.onIssueStart and onIssueEnd for each candidate", async () => {
      const { NULL_HOOKS } = await import("../observability/instrumentation.js");
      const root = await mkdtemp(join(tmpdir(), "perform-orch-"));
      const tracker = createMemoryTracker(TRACKER_CFG);
      const backend = createMockBackend({ type: "mock" });
      const logger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
      const events: string[] = [];
      const hooks = {
        ...NULL_HOOKS,
        onIssueStart: (id: string) => events.push(`start:${id}`),
        onIssueEnd: (id: string) => events.push(`end:${id}`),
      };
      const config: WorkflowConfig = {
        agent: {
          backend: { type: "mock" },
          maxConcurrentAgents: 1,
          maxTurns: 1,
          maxRetryBackoffMs: 300_000,
          agentSessionStallTimeoutMs: 1_800_000,
          maxConcurrentAgentsByState: {},
        },
        tracker: TRACKER_CFG,
        prompt: "{{ issue.identifier }}",
        workspace: { root },
        observability: { dashboardEnabled: true, refreshMs: 1000, renderIntervalMs: 16 },
        polling: { intervalMs: 50 },
        logging: null,
      };
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 2000);
      const res = await runOrchestrator({
        tracker,
        backend,
        config,
        logger,
        hooks,
        signal: ctrl.signal,
      });
      if (res.type !== "Success") throw new Error("expected success");
      expect(events.length).toBe(2);
      expect(events[0]!.startsWith("start:")).toBe(true);
      expect(events[1]!.startsWith("end:")).toBe(true);
    });
  });
}
