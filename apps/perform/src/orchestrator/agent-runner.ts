import type { Result } from "@praha/byethrow";
import type { Issue, IssueStateName } from "../domain/issue.js";
import type { OrchestratorError } from "../domain/orchestrator-errors.js";
import type { Tracker } from "../tracker/types.js";
import type { Backend, TurnResult } from "../backend/types.js";
import type { BackendError } from "../domain/backend-errors.js";
import type { ServerNotification } from "../backend/jsonrpc/messages.js";
import { extractCodexUsage } from "../backend/jsonrpc/messages.js";
import type { WorkspaceConfig } from "../domain/workspace-config.js";
import type { HooksConfig } from "../domain/hooks-config.js";
import type { AgentConfig } from "../domain/agent-config.js";
import type { Logger } from "./orchestrator.js";
import {
  type ObservabilityHooks,
  type TurnEvent,
  NULL_HOOKS,
} from "../observability/instrumentation.js";
import { ensureForIssue } from "../workspace/manager.js";
import { runHook, buildHookEnv, DEFAULT_HOOK_TIMEOUT_MS } from "../workspace/hooks.js";
import { buildPrompt } from "../prompt/builder.js";
import { buildContinuationPrompt } from "../prompt/continuation.js";

export type RunAgentInput = Readonly<{
  issue: Issue;
  backend: Backend;
  tracker: Tracker;
  agentConfig: AgentConfig;
  workspaceConfig?: WorkspaceConfig;
  hooksConfig?: HooksConfig;
  doingState?: IssueStateName;
  doneState?: IssueStateName;
  terminalStates: ReadonlyArray<IssueStateName>;
  activeStates: ReadonlyArray<IssueStateName>;
  promptTemplate: string;
  logger: Logger;
  signal: AbortSignal;
  hooks?: ObservabilityHooks;
}>;

export type RunAgentOutcome = Readonly<{
  issue: Issue;
  completed: boolean;
  turnsExecuted: number;
}>;

const inferWorkspace = (cfg: WorkspaceConfig | undefined): WorkspaceConfig => {
  if (cfg) return cfg;
  // Backend may require a real cwd. For mock-only runs we tolerate a fallback to process.cwd().
  return { root: process.cwd() };
};

export const runAgent = async (
  input: RunAgentInput,
): Promise<Result.Result<RunAgentOutcome, OrchestratorError>> => {
  const {
    issue,
    backend,
    tracker,
    agentConfig,
    workspaceConfig,
    hooksConfig,
    doingState,
    doneState,
    terminalStates,
    activeStates,
    promptTemplate,
    logger,
    signal,
  } = input;
  const hooks = input.hooks ?? NULL_HOOKS;

  // 1. workspace + after_create
  const wsR = await ensureForIssue(inferWorkspace(workspaceConfig), hooksConfig, issue);
  if (wsR.type === "Failure") {
    return { type: "Failure", error: { kind: "workspace", error: wsR.error } };
  }
  const workspace = wsR.value.path;
  logger.info(`[workspace] ensured ${workspace} (created=${wsR.value.created})`);

  // 2. doingState mutation
  if (doingState) {
    const r = await tracker.updateIssueState(issue, doingState);
    if (r.type === "Failure") {
      return { type: "Failure", error: { kind: "tracker", error: r.error } };
    }
  }

  // 3. before_run hook (if any)
  if (hooksConfig?.beforeRun) {
    const hr = await runHook({
      command: hooksConfig.beforeRun,
      cwd: workspace,
      env: buildHookEnv(issue),
      hookName: "before_run",
      timeoutMs: hooksConfig.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
    });
    if (hr.type === "Failure") {
      return { type: "Failure", error: { kind: "workspace", error: hr.error } };
    }
  }

  // 4. backend session
  const sessionR = await backend.startSession({ workspace, issue, agentConfig });
  if (sessionR.type === "Failure") {
    return { type: "Failure", error: { kind: "backend", error: sessionR.error } };
  }
  const session = sessionR.value;

  let currentIssue = issue;
  let turnsExecuted = 0;
  let completed = false;
  let lastErr: OrchestratorError | null = null;

  try {
    const issueIdStr = String(issue.id);
    const onNotif = (n: ServerNotification) => {
      logger.info(`[backend ${backend.type}] notification ${n.method}`);
      // Dispatch to observability hooks.
      switch (n.method) {
        case "thread/started": {
          const p = n.params as Record<string, unknown> | undefined;
          const id =
            (p?.thread as { id?: string } | undefined)?.id ?? (p?.threadId as string | undefined);
          if (id) hooks.onTurnEvent(issueIdStr, { kind: "thread-started", sessionId: id });
          break;
        }
        case "turn/started":
          hooks.onTurnEvent(issueIdStr, { kind: "turn-started" });
          break;
        case "turn/completed": {
          const usage = extractCodexUsage(n.params);
          hooks.onTurnEvent(
            issueIdStr,
            usage ? { kind: "turn-completed", usage } : { kind: "turn-completed" },
          );
          break;
        }
        default: {
          if (n.method.startsWith("item/")) {
            const p =
              ((n as { params?: unknown }).params as Record<string, unknown> | undefined) ?? {};
            if (n.method === "item/agentMessage/delta") {
              const text = String(
                (p.delta as { text?: string } | undefined)?.text ??
                  (p.text as string | undefined) ??
                  "",
              );
              hooks.onTurnEvent(issueIdStr, { kind: "agent-message", text });
            } else if (n.method === "item/commandExecution/outputDelta") {
              const command = String((p.command as string | undefined) ?? "?");
              hooks.onTurnEvent(issueIdStr, { kind: "command-execution", command });
            } else if (n.method === "item/fileChange/outputDelta") {
              const path = String((p.path as string | undefined) ?? "?");
              hooks.onTurnEvent(issueIdStr, { kind: "file-change", path });
            } else if (n.method === "item/completed") {
              hooks.onTurnEvent(issueIdStr, { kind: "item-completed" });
            } else {
              const itemType = n.method.replace(/^item\//, "");
              hooks.onTurnEvent(issueIdStr, { kind: "item-started", itemType });
            }
          }
          break;
        }
      }
    };

    for (let turn = 1; turn <= agentConfig.maxTurns; turn += 1) {
      // Early-exit if signal is already aborted (catches pre-fired AbortControllers)
      if (signal.aborted) {
        lastErr = { kind: "backend", error: { kind: "aborted" } };
        break;
      }

      // 4a. prompt
      let prompt: string;
      if (turn === 1) {
        const pr = await buildPrompt(promptTemplate, { issue: currentIssue });
        if (pr.type === "Failure") {
          lastErr = { kind: "prompt", error: pr.error };
          break;
        }
        prompt = pr.value;
      } else {
        prompt = buildContinuationPrompt(turn, agentConfig.maxTurns);
      }

      // 4b. run a single turn
      // Two-layer guard against subprocess death:
      //   - Layer 1 (Task 13): JsonRpcClient.runTurn races internally against child-process close
      //     during an active turn invocation.
      //   - Layer 2 (here): races the entire runTurn Promise against exitPromise to catch deaths
      //     that happen BETWEEN turns (after one turn resolves but before the next starts).
      const tr = await Promise.race([
        session.runTurn({
          prompt,
          turnNumber: turn,
          maxTurns: agentConfig.maxTurns,
          signal,
          onNotification: onNotif,
        }),
        session.exitPromise.then(
          (info): Result.Result<TurnResult, BackendError> => ({
            type: "Failure",
            error: {
              kind: "session-exited-mid-turn",
              exitCode: info.code,
              signal: info.signal as string | null,
            },
          }),
        ),
      ]);
      turnsExecuted = turn;
      if (tr.type === "Failure") {
        lastErr = { kind: "backend", error: tr.error };
        break;
      }

      // 4c. refetch issue state
      const refR = await tracker.fetchIssueStatesByIds([currentIssue.id]);
      if (refR.type === "Failure") {
        lastErr = { kind: "tracker", error: refR.error };
        break;
      }
      const refreshed = refR.value[0];
      if (refreshed) {
        currentIssue = refreshed;
      }
      if (refreshed && terminalStates.includes(refreshed.state)) {
        completed = true;
        break;
      }
      // ADR-0014 third condition: if the orchestrator owns doing/done transitions
      // (doingState is configured), the issue is no longer in active_states immediately
      // after the doing_state mutation. A successful turn ending in this state means
      // the agent has finished its work — fire done_state below.
      if (refreshed && doingState && !activeStates.includes(refreshed.state)) {
        completed = true;
        break;
      }
      if (turn === agentConfig.maxTurns) {
        logger.info(
          `[orchestrator] ${currentIssue.identifier} reached max_turns=${agentConfig.maxTurns} without terminal state`,
        );
      }
    }
  } finally {
    await session.shutdown();
  }

  // 5. after_run hook — failures are logged but do not affect outcome
  if (hooksConfig?.afterRun) {
    const hr = await runHook({
      command: hooksConfig.afterRun,
      cwd: workspace,
      env: buildHookEnv(currentIssue),
      hookName: "after_run",
      timeoutMs: hooksConfig.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
    });
    if (hr.type === "Failure") {
      logger.error(`after_run hook failed (ignored): ${JSON.stringify(hr.error)}`);
    }
  }

  if (lastErr) {
    return { type: "Failure", error: lastErr };
  }

  // 6. doneState mutation (terminal-only)
  if (completed && doneState) {
    const r = await tracker.updateIssueState(currentIssue, doneState);
    if (r.type === "Failure") {
      return { type: "Failure", error: { kind: "tracker", error: r.error } };
    }
  }

  return { type: "Success", value: { issue: currentIssue, completed, turnsExecuted } };
};

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;
  const v = await import("valibot");
  const { IssueId, IssueIdentifier, IssueStateName } = await import("../domain/issue.js");
  const { tmpdir } = await import("node:os");
  const { mkdtemp } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const issue = {
    id: v.parse(IssueId.schema, "M-1"),
    identifier: v.parse(IssueIdentifier.schema, "M-1"),
    title: "t",
    description: "",
    state: v.parse(IssueStateName.schema, "Todo"),
    priority: null,
    createdAt: null,
    assigneeId: null,
    assignedToWorker: true,
    blockedBy: [],
  } as const satisfies Issue;
  const doneIssue: Issue = { ...issue, state: v.parse(IssueStateName.schema, "Done") };
  const ok = <T>(val: T) => ({ type: "Success" as const, value: val });

  const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

  const makeBackend = (
    turnResults: Array<
      { type: "Success"; value: { completed: true } } | { type: "Failure"; error: any }
    >,
  ) => {
    let i = 0;
    return {
      type: "mock" as const,
      startSession: async () =>
        ok({
          runTurn: vi.fn(async () => {
            const r = turnResults[i++] ?? ok({ completed: true });
            return r;
          }),
          shutdown: async () => {},
          interrupt: async () => {},
          exitPromise: Promise.resolve({ code: 0, signal: null }),
        }),
    };
  };

  describe("orchestrator/agent-runner (Phase 2)", () => {
    it("runs one turn then transitions to Done when terminal", async () => {
      const root = await mkdtemp(join(tmpdir(), "perform-runner-"));
      const fetched: Issue[][] = [[doneIssue]];
      let fetchedIdx = 0;
      const tracker = {
        fetchCandidateIssues: async () => ok([]),
        fetchIssuesByStates: async () => ok([]),
        fetchIssueStatesByIds: async () => ok(fetched[fetchedIdx++]!),
        createComment: async () => ok(undefined),
        updateIssueState: vi.fn(async () => ok(undefined)),
      } as Tracker;
      const backend = makeBackend([ok({ completed: true })]);

      const res = await runAgent({
        issue,
        backend,
        tracker,
        agentConfig: {
          backend: { type: "mock" },
          maxConcurrentAgents: 1,
          maxTurns: 3,
          maxRetryBackoffMs: 300_000,
          agentSessionStallTimeoutMs: 1_800_000,
          maxConcurrentAgentsByState: {},
        },
        workspaceConfig: { root },
        terminalStates: [v.parse(IssueStateName.schema, "Done")],
        activeStates: [v.parse(IssueStateName.schema, "Todo")],
        doingState: v.parse(IssueStateName.schema, "In Progress"),
        doneState: v.parse(IssueStateName.schema, "Done"),
        promptTemplate: "Hi {{ issue.identifier }}",
        logger: silent,
        signal: new AbortController().signal,
      });
      if (res.type !== "Success") throw new Error("expected success");
      expect(res.value.completed).toBe(true);
      expect(res.value.turnsExecuted).toBe(1);
      expect(tracker.updateIssueState).toHaveBeenCalledTimes(2);
    });

    it("ADR-0014 third condition: doingState set + issue not in active_states → fire doneState after turn 1", async () => {
      const root = await mkdtemp(join(tmpdir(), "perform-runner-"));
      // Issue starts Todo; doing_state mutation moves it to "In Progress" (not in activeStates,
      // not in terminalStates). After turn 1, the third condition should fire and break.
      const inProgressIssue: Issue = {
        ...issue,
        state: v.parse(IssueStateName.schema, "In Progress"),
      };
      const tracker = {
        fetchCandidateIssues: async () => ok([]),
        fetchIssuesByStates: async () => ok([]),
        fetchIssueStatesByIds: async () => ok([inProgressIssue]),
        createComment: async () => ok(undefined),
        updateIssueState: vi.fn(async () => ok(undefined)),
      } as Tracker;
      const backend = makeBackend([
        ok({ completed: true }),
        ok({ completed: true }),
        ok({ completed: true }),
      ]);

      const res = await runAgent({
        issue,
        backend,
        tracker,
        agentConfig: {
          backend: { type: "mock" },
          maxConcurrentAgents: 1,
          maxTurns: 3,
          maxRetryBackoffMs: 300_000,
          agentSessionStallTimeoutMs: 1_800_000,
          maxConcurrentAgentsByState: {},
        },
        workspaceConfig: { root },
        terminalStates: [v.parse(IssueStateName.schema, "Done")],
        activeStates: [v.parse(IssueStateName.schema, "Todo")],
        doingState: v.parse(IssueStateName.schema, "In Progress"),
        doneState: v.parse(IssueStateName.schema, "Done"),
        promptTemplate: "Hi",
        logger: silent,
        signal: new AbortController().signal,
      });
      if (res.type !== "Success") throw new Error("expected success");
      expect(res.value.completed).toBe(true);
      expect(res.value.turnsExecuted).toBe(1);
      // doingState (1) + doneState (1) = 2 calls; loop must NOT continue past turn 1.
      expect(tracker.updateIssueState).toHaveBeenCalledTimes(2);
      expect(tracker.updateIssueState).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: issue.id }),
        v.parse(IssueStateName.schema, "Done"),
      );
    });

    it("ADR-0014 third condition does NOT fire without doingState", async () => {
      const root = await mkdtemp(join(tmpdir(), "perform-runner-"));
      const inProgressIssue: Issue = {
        ...issue,
        state: v.parse(IssueStateName.schema, "In Progress"),
      };
      const tracker = {
        fetchCandidateIssues: async () => ok([]),
        fetchIssuesByStates: async () => ok([]),
        fetchIssueStatesByIds: async () => ok([inProgressIssue]),
        createComment: async () => ok(undefined),
        updateIssueState: vi.fn(async () => ok(undefined)),
      } as Tracker;
      const backend = makeBackend([
        ok({ completed: true }),
        ok({ completed: true }),
        ok({ completed: true }),
      ]);

      const res = await runAgent({
        issue,
        backend,
        tracker,
        agentConfig: {
          backend: { type: "mock" },
          maxConcurrentAgents: 1,
          maxTurns: 3,
          maxRetryBackoffMs: 300_000,
          agentSessionStallTimeoutMs: 1_800_000,
          maxConcurrentAgentsByState: {},
        },
        workspaceConfig: { root },
        terminalStates: [v.parse(IssueStateName.schema, "Done")],
        activeStates: [v.parse(IssueStateName.schema, "Todo")],
        // doingState NOT set
        promptTemplate: "Hi",
        logger: silent,
        signal: new AbortController().signal,
      });
      if (res.type !== "Success") throw new Error("expected success");
      // Without doingState, the third condition must not fire — loop runs to max_turns.
      expect(res.value.completed).toBe(false);
      expect(res.value.turnsExecuted).toBe(3);
    });

    it("loops up to max_turns when issue stays active", async () => {
      const root = await mkdtemp(join(tmpdir(), "perform-runner-"));
      const tracker = {
        fetchCandidateIssues: async () => ok([]),
        fetchIssuesByStates: async () => ok([]),
        fetchIssueStatesByIds: async () => ok([issue]),
        createComment: async () => ok(undefined),
        updateIssueState: async () => ok(undefined),
      } as Tracker;
      const backend = makeBackend([
        ok({ completed: true }),
        ok({ completed: true }),
        ok({ completed: true }),
      ]);

      const res = await runAgent({
        issue,
        backend,
        tracker,
        agentConfig: {
          backend: { type: "mock" },
          maxConcurrentAgents: 1,
          maxTurns: 3,
          maxRetryBackoffMs: 300_000,
          agentSessionStallTimeoutMs: 1_800_000,
          maxConcurrentAgentsByState: {},
        },
        workspaceConfig: { root },
        terminalStates: [v.parse(IssueStateName.schema, "Done")],
        activeStates: [v.parse(IssueStateName.schema, "Todo")],
        promptTemplate: "Hi {{ issue.identifier }}",
        logger: silent,
        signal: new AbortController().signal,
      });
      if (res.type !== "Success") throw new Error("expected success");
      expect(res.value.completed).toBe(false);
      expect(res.value.turnsExecuted).toBe(3);
    });

    it("propagates backend turn failure", async () => {
      const root = await mkdtemp(join(tmpdir(), "perform-runner-"));
      const tracker = {
        fetchCandidateIssues: async () => ok([]),
        fetchIssuesByStates: async () => ok([]),
        fetchIssueStatesByIds: async () => ok([issue]),
        createComment: async () => ok(undefined),
        updateIssueState: async () => ok(undefined),
      } as Tracker;
      const backend = makeBackend([
        { type: "Failure", error: { kind: "mock-forced-failure", reason: "x" } },
      ]);

      const res = await runAgent({
        issue,
        backend,
        tracker,
        agentConfig: {
          backend: { type: "mock" },
          maxConcurrentAgents: 1,
          maxTurns: 3,
          maxRetryBackoffMs: 300_000,
          agentSessionStallTimeoutMs: 1_800_000,
          maxConcurrentAgentsByState: {},
        },
        workspaceConfig: { root },
        terminalStates: [v.parse(IssueStateName.schema, "Done")],
        activeStates: [v.parse(IssueStateName.schema, "Todo")],
        promptTemplate: "Hi",
        logger: silent,
        signal: new AbortController().signal,
      });
      if (res.type !== "Failure") throw new Error("expected failure");
      expect(res.error.kind).toBe("backend");
    });

    it("aborts the turn loop when AbortSignal is pre-fired", async () => {
      const root = await mkdtemp(join(tmpdir(), "perform-runner-"));
      const tracker = {
        fetchCandidateIssues: async () => ok([]),
        fetchIssuesByStates: async () => ok([]),
        fetchIssueStatesByIds: async () => ok([issue]),
        createComment: async () => ok(undefined),
        updateIssueState: async () => ok(undefined),
      } as Tracker;
      const backend = makeBackend([ok({ completed: true })]);
      const ctrl = new AbortController();
      ctrl.abort();

      const res = await runAgent({
        issue,
        backend,
        tracker,
        agentConfig: {
          backend: { type: "mock" },
          maxConcurrentAgents: 1,
          maxTurns: 3,
          maxRetryBackoffMs: 300_000,
          agentSessionStallTimeoutMs: 1_800_000,
          maxConcurrentAgentsByState: {},
        },
        workspaceConfig: { root },
        terminalStates: [v.parse(IssueStateName.schema, "Done")],
        activeStates: [v.parse(IssueStateName.schema, "Todo")],
        promptTemplate: "Hi",
        logger: silent,
        signal: ctrl.signal,
      });
      if (res.type !== "Failure") throw new Error("expected failure");
      expect(res.error.kind).toBe("backend");
      if (res.error.kind === "backend") {
        expect(res.error.error.kind).toBe("aborted");
      }
    });

    it("returns session-exited-mid-turn when mock exits mid-turn", async () => {
      const root = await mkdtemp(join(tmpdir(), "perform-runner-"));
      const tracker = {
        fetchCandidateIssues: async () => ok([]),
        fetchIssuesByStates: async () => ok([]),
        fetchIssueStatesByIds: async () => ok([issue]),
        createComment: async () => ok(undefined),
        updateIssueState: async () => ok(undefined),
      } as Tracker;
      const { createMockBackend } = await import("../backend/mock.js");
      const backend = createMockBackend({ type: "mock", exitMidTurn: true });

      const res = await runAgent({
        issue,
        backend,
        tracker,
        agentConfig: {
          backend: { type: "mock" },
          maxConcurrentAgents: 1,
          maxTurns: 1,
          maxRetryBackoffMs: 300_000,
          agentSessionStallTimeoutMs: 1_800_000,
          maxConcurrentAgentsByState: {},
        },
        workspaceConfig: { root },
        terminalStates: [v.parse(IssueStateName.schema, "Done")],
        activeStates: [v.parse(IssueStateName.schema, "Todo")],
        promptTemplate: "Hi",
        logger: silent,
        signal: new AbortController().signal,
      });
      if (res.type !== "Failure") throw new Error("expected failure");
      expect(res.error.kind).toBe("backend");
      if (res.error.kind === "backend") {
        expect(res.error.error.kind).toBe("session-exited-mid-turn");
      }
    });
  });
}
