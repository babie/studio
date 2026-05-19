import PQueue from "p-queue";
import { EventEmitter } from "node:events";
import type { Issue, IssueId, IssueIdentifier, IssueStateName } from "../domain/issue.js";
import type { Tracker } from "../tracker/types.js";
import type { Backend } from "../backend/types.js";
import type { WorkflowConfig } from "../domain/workflow-config.js";
import type { Logger } from "./orchestrator.js";
import { NULL_HOOKS, type ObservabilityHooks } from "../observability/instrumentation.js";
import type { runAgent } from "./agent-runner.js";
import { continuationDelay, failureDelay, type RetryDelayType } from "./retry-policy.js";

export type RunningEntry = Readonly<{
  issueId: IssueId;
  identifier: IssueIdentifier;
  issue: Issue;
  startedAt: Date;
  lastActivityAt: Date;
  retryAttempt: number;
}>;

export type RetryEntry = Readonly<{
  issueId: IssueId;
  identifier: IssueIdentifier;
  attempt: number;
  delayType: RetryDelayType;
  timerRef: NodeJS.Timeout;
  retryToken: symbol;
  dueAtMs: number;
  error: string | null;
}>;

export type SchedulerInput = Readonly<{
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

export class Scheduler {
  readonly running = new Map<string, RunningEntry>();
  readonly claimed = new Set<string>();
  readonly retryAttempts = new Map<string, RetryEntry>();
  readonly queue: PQueue;
  private readonly composedHooks: ObservabilityHooks;
  private pollTimer: NodeJS.Timeout | null = null;
  private bus = new EventEmitter();
  private stopped = false;
  private completedCount = 0;
  private failedCount = 0;
  private totalSeen = new Set<string>();

  constructor(private readonly input: SchedulerInput) {
    this.queue = new PQueue({ concurrency: input.config.agent.maxConcurrentAgents });
    this.composedHooks = this.composeHooks(input.hooks);
  }

  private composeHooks(userHooks: ObservabilityHooks | undefined): ObservabilityHooks {
    const fallback: ObservabilityHooks = userHooks ?? NULL_HOOKS;
    // Explicitly bind each method to preserve class-instance prototype methods.
    // Spreading a class instance (`{ ...fallback }`) only copies own enumerable properties
    // and loses prototype-defined methods (e.g. ObservabilityState).
    return {
      onIssueStart: (issueId, identifier, state, pid, workspacePath) =>
        fallback.onIssueStart(issueId, identifier, state, pid, workspacePath),
      onIssueEnd: (issueId) => fallback.onIssueEnd(issueId),
      onTurnEvent: (issueId, event) => {
        fallback.onTurnEvent(issueId, event);
        const entry = this.running.get(issueId);
        if (entry) this.running.set(issueId, { ...entry, lastActivityAt: new Date() });
      },
      onRetryScheduled: (issueId, attempt, dueAtMs, error) =>
        fallback.onRetryScheduled(issueId, attempt, dueAtMs, error),
      onRetryComplete: (issueId) => fallback.onRetryComplete(issueId),
      onRateLimitObserved: (rateLimits) => fallback.onRateLimitObserved(rateLimits),
      onPollingTick: (nextPollInMs, intervalMs, checking) =>
        fallback.onPollingTick(nextPollInMs, intervalMs, checking),
    };
  }

  async run(): Promise<RunSummary> {
    const pollMs = this.input.config.polling.intervalMs;
    const abortP = new Promise<void>((res) => {
      if (this.input.signal.aborted) {
        res();
        return;
      }
      this.input.signal.addEventListener("abort", () => res(), { once: true });
    });

    await this.pumpCycle();
    while (!this.input.signal.aborted) {
      this.scheduleNextTick(pollMs);
      let tickHandler!: () => void;
      let wakeHandler!: () => void;
      const tickP = new Promise<void>((res) => {
        tickHandler = () => res();
        this.bus.once("tick", tickHandler);
      });
      const wakeP = new Promise<void>((res) => {
        wakeHandler = () => res();
        this.bus.once("wake", wakeHandler);
      });
      try {
        await Promise.race([tickP, wakeP, abortP]);
      } finally {
        this.bus.removeListener("tick", tickHandler);
        this.bus.removeListener("wake", wakeHandler);
      }
      if (this.input.signal.aborted) break;
      // Always pump before checking idle: a just-completed issue may have freed slots for new
      // candidates that were not yet visible at the time wake() fired. Checking isIdleAndDone()
      // before the pump would cause premature exit when sequential issues are queued (e.g.
      // MEMORY-1 completes, wake fires, loop would exit before ever picking up MEMORY-2).
      await this.pumpCycle();
      if (this.isIdleAndDone()) break;
    }
    this.stop();
    await this.queue.onIdle();
    return { total: this.totalSeen.size, completed: this.completedCount, failed: this.failedCount };
  }

  private scheduleNextTick(pollMs: number): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this.bus.emit("tick"), pollMs);
  }

  protected wake(): void {
    this.bus.emit("wake");
  }

  private stop(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    for (const entry of this.retryAttempts.values()) clearTimeout(entry.timerRef);
    this.retryAttempts.clear();
    this.stopped = true;
  }

  private isIdleAndDone(): boolean {
    return (
      this.queue.size === 0 &&
      this.queue.pending === 0 &&
      this.running.size === 0 &&
      this.retryAttempts.size === 0
    );
  }

  protected async pumpCycle(): Promise<void> {
    if (this.stopped || this.input.signal.aborted) return;

    // 1. reconcileRunning — Task 17 will fill this in; for now, no-op.
    await this.reconcileRunning();

    // 2. fetch candidates
    const candR = await this.input.tracker.fetchCandidateIssues();
    if (candR.type === "Failure") {
      this.input.logger.warn(
        `[scheduler] fetchCandidateIssues failed: ${JSON.stringify(candR.error)}`,
      );
      return;
    }
    for (const i of candR.value) this.totalSeen.add(String(i.id));

    // 3. select dispatchable
    const { selectDispatchable } = await import("./dispatch-filter.js");
    const runningCountByState: Record<string, number> = {};
    for (const e of this.running.values()) {
      runningCountByState[e.issue.state] = (runningCountByState[e.issue.state] ?? 0) + 1;
    }
    const toDispatch = selectDispatchable({
      candidates: candR.value,
      // activeStates/terminalStates are validated as IssueStateName at parse time; the brand isn't preserved through TrackerConfig.
      activeStates: this.input.config.tracker.activeStates as ReadonlyArray<IssueStateName>,
      terminalStates: this.input.config.tracker.terminalStates as ReadonlyArray<IssueStateName>,
      running: new Set([...this.running.keys()]),
      claimed: new Set(this.claimed),
      maxConcurrentAgents: this.input.config.agent.maxConcurrentAgents,
      maxConcurrentAgentsByState: this.input.config.agent.maxConcurrentAgentsByState,
      runningCountByState,
    });

    // 4. enqueue dispatch tasks
    for (const issue of toDispatch) {
      this.claimed.add(String(issue.id));
      this.queue.add(() => this.dispatchIssue(issue));
    }
  }

  private async reconcileRunning(): Promise<void> {
    // 0. stall check
    const stallMs = this.input.config.agent.agentSessionStallTimeoutMs;
    const now = Date.now();
    for (const [id, entry] of this.running.entries()) {
      const elapsed = now - entry.lastActivityAt.getTime();
      if (elapsed > stallMs) {
        this.input.logger.warn(
          `[scheduler] stalled: ${entry.identifier} elapsed=${elapsed}ms; scheduling restart`,
        );
        this.terminateRunning(id, /*cleanupWorkspace=*/ false);
        this.scheduleFailureRetry(entry.issue, {
          kind: "stall-restart",
          issueId: id,
          elapsedMs: elapsed,
        });
      }
    }
    if (this.running.size === 0) return;
    const ids = Array.from(this.running.keys()) as IssueId[];
    const r = await this.input.tracker.fetchIssueStatesByIds(ids);
    if (r.type === "Failure") {
      this.input.logger.warn(
        `[scheduler] reconcileRunning: tracker fetch failed: ${JSON.stringify(r.error)}`,
      );
      return;
    }
    const seen = new Set<string>();
    const terminalSet = new Set(
      this.input.config.tracker.terminalStates.map((s) => s.toLowerCase().trim()),
    );
    const activeSet = new Set(
      this.input.config.tracker.activeStates.map((s) => s.toLowerCase().trim()),
    );

    for (const refreshed of r.value) {
      const id = String(refreshed.id);
      seen.add(id);
      const entry = this.running.get(id);
      if (!entry) continue;
      const stateKey = refreshed.state.toLowerCase().trim();

      if (terminalSet.has(stateKey)) {
        this.input.logger.info(
          `[scheduler] ${refreshed.identifier} reached terminal state ${refreshed.state}; stopping`,
        );
        this.terminateRunning(id, /*cleanupWorkspace=*/ true);
        continue;
      }
      if (!refreshed.assignedToWorker) {
        this.input.logger.info(`[scheduler] ${refreshed.identifier} no longer assigned; stopping`);
        this.terminateRunning(id, /*cleanupWorkspace=*/ false);
        continue;
      }
      if (!activeSet.has(stateKey)) {
        this.input.logger.info(
          `[scheduler] ${refreshed.identifier} non-active state ${refreshed.state}; stopping`,
        );
        this.terminateRunning(id, /*cleanupWorkspace=*/ false);
        continue;
      }
      // Still active — refresh entry.issue
      this.running.set(id, { ...entry, issue: refreshed });
    }

    // Issues that disappeared from tracker results — treat as stale, release.
    for (const id of this.running.keys()) {
      if (!seen.has(id)) {
        this.input.logger.warn(
          `[scheduler] running issue ${id} not visible from tracker; releasing claim`,
        );
        this.terminateRunning(id, /*cleanupWorkspace=*/ false);
      }
    }
  }

  private terminateRunning(id: string, _cleanupWorkspace: boolean): void {
    // The AgentRunner promise is still in-flight from dispatchIssue; we can't synchronously kill it.
    // Mark the entry for shutdown; the cleanup happens when the AgentRunner exits.
    // For Phase 6 parity we log + remove from running so dispatch slot frees up.
    this.running.delete(id);
    this.claimed.delete(id);
    // Workspace cleanup is invoked by the AgentRunner's after_run hook + the orchestrator's terminal handler
    // already exists; cleanupWorkspace parameter is forward-looking for future SSH-mode work.
  }

  private async dispatchIssue(issue: Issue): Promise<void> {
    const id = String(issue.id);
    const startedAt = new Date();
    this.running.set(id, {
      issueId: issue.id,
      identifier: issue.identifier,
      issue,
      startedAt,
      lastActivityAt: startedAt,
      retryAttempt: this.retryAttempts.get(id)?.attempt ?? 0,
    });
    this.retryAttempts.delete(id);
    this.input.logger.info(`[orchestrator] picked ${issue.identifier} (${issue.state})`);
    this.composedHooks.onIssueStart(id, issue.identifier, issue.state, null, null);

    try {
      // Lazy import to avoid circular: orchestrator → scheduler → agent-runner → orchestrator.
      const { runAgent } = await import("./agent-runner.js");
      const outcome = await runAgent({
        issue,
        backend: this.input.backend,
        tracker: this.input.tracker,
        agentConfig: this.input.config.agent,
        ...(this.input.config.workspace ? { workspaceConfig: this.input.config.workspace } : {}),
        ...(this.input.config.hooks ? { hooksConfig: this.input.config.hooks } : {}),
        ...(this.input.config.tracker.doingState
          ? { doingState: this.input.config.tracker.doingState as IssueStateName }
          : {}),
        ...(this.input.config.tracker.doneState
          ? { doneState: this.input.config.tracker.doneState as IssueStateName }
          : {}),
        // activeStates/terminalStates are validated as IssueStateName at parse time; the brand isn't preserved through TrackerConfig.
        terminalStates: this.input.config.tracker.terminalStates as ReadonlyArray<IssueStateName>,
        activeStates: this.input.config.tracker.activeStates as ReadonlyArray<IssueStateName>,
        promptTemplate: this.input.config.prompt,
        logger: this.input.logger,
        signal: this.input.signal,
        hooks: this.composedHooks,
      });
      this.handleAgentOutcome(issue, outcome);
    } finally {
      this.running.delete(id);
      this.claimed.delete(id);
      this.composedHooks.onIssueEnd(id);
    }
  }

  private handleAgentOutcome(issue: Issue, outcome: Awaited<ReturnType<typeof runAgent>>): void {
    const id = String(issue.id);
    if (outcome.type === "Success" && outcome.value.completed) {
      const doneState = this.input.config.tracker.doneState ?? "(no done_state)";
      this.input.logger.info(`[orchestrator] ${issue.identifier} -> ${doneState}`);
      this.completedCount += 1;
      this.retryAttempts.delete(id);
      // NOTE: do NOT clear claimed here. dispatchIssue's finally block clears both running and
      // claimed. Clearing claimed early (before finally runs) would allow pumpCycle — triggered
      // by wake() below — to re-dispatch the same issue while dispatchIssue is still in-flight.
      this.wake();
      return;
    }
    if (outcome.type === "Success" && !outcome.value.completed) {
      // Normal exit (max_turns reached without terminal). Symphony semantics: continuation retry.
      this.scheduleContinuationRetry(issue);
      this.wake();
      return;
    }
    // Failure — schedule failure retry with exponential backoff.
    this.failedCount += 1;
    const errorPayload = outcome.type === "Failure" ? outcome.error : undefined;
    this.scheduleFailureRetry(issue, errorPayload);
    this.wake();
  }

  private scheduleContinuationRetry(issue: Issue): void {
    this.scheduleRetry(issue, 1, "continuation", continuationDelay(), null);
  }

  private scheduleFailureRetry(issue: Issue, error: unknown): void {
    const id = String(issue.id);
    const prev = this.retryAttempts.get(id);
    const nextAttempt = (prev?.attempt ?? 0) + 1;
    const delay = failureDelay(nextAttempt, this.input.config.agent.maxRetryBackoffMs);
    this.scheduleRetry(issue, nextAttempt, "failure", delay, JSON.stringify(error));
  }

  private scheduleRetry(
    issue: Issue,
    attempt: number,
    delayType: RetryDelayType,
    delayMs: number,
    error: string | null,
  ): void {
    const id = String(issue.id);
    const prev = this.retryAttempts.get(id);
    if (prev) clearTimeout(prev.timerRef);
    const retryToken = Symbol("retry");
    const dueAtMs = Date.now() + delayMs;
    const timerRef = setTimeout(() => {
      void this.handleRetry(id, retryToken);
    }, delayMs);
    this.retryAttempts.set(id, {
      issueId: issue.id,
      identifier: issue.identifier,
      attempt,
      delayType,
      timerRef,
      retryToken,
      dueAtMs,
      error,
    });
    this.input.logger.warn(
      `[scheduler] retry ${issue.identifier} attempt=${attempt} delayType=${delayType} in ${delayMs}ms${error ? ` error=${error}` : ""}`,
    );
  }

  private async handleRetry(id: string, retryToken: symbol): Promise<void> {
    const entry = this.retryAttempts.get(id);
    if (!entry || entry.retryToken !== retryToken) return;
    this.retryAttempts.delete(id);

    const candR = await this.input.tracker.fetchCandidateIssues();
    if (candR.type === "Failure") {
      const fakeIssue = { id: entry.issueId, identifier: entry.identifier } as unknown as Issue;
      const nextAttempt = entry.attempt + 1;
      this.scheduleRetry(
        fakeIssue,
        nextAttempt,
        "failure",
        failureDelay(nextAttempt, this.input.config.agent.maxRetryBackoffMs),
        `retry-poll-failed: ${JSON.stringify(candR.error)}`,
      );
      return;
    }
    const refreshed = candR.value.find((i) => String(i.id) === id);
    const terminalSet = new Set(
      this.input.config.tracker.terminalStates.map((s) => s.toLowerCase().trim()),
    );
    const activeSet = new Set(
      this.input.config.tracker.activeStates.map((s) => s.toLowerCase().trim()),
    );

    if (!refreshed) {
      this.input.logger.info(`[scheduler] retry: issue ${id} no longer visible; releasing claim`);
      this.claimed.delete(id);
      this.wake();
      return;
    }
    const stateKey = refreshed.state.toLowerCase().trim();
    if (terminalSet.has(stateKey)) {
      this.input.logger.info(
        `[scheduler] retry: issue ${refreshed.identifier} terminal; releasing claim`,
      );
      this.claimed.delete(id);
      this.wake();
      return;
    }
    if (!activeSet.has(stateKey)) {
      this.input.logger.info(
        `[scheduler] retry: issue ${refreshed.identifier} non-active ${refreshed.state}; releasing claim`,
      );
      this.claimed.delete(id);
      this.wake();
      return;
    }

    // Active — selectDispatchable will re-claim on the next pump cycle.
    this.claimed.delete(id);
    this.wake();
  }
}

export const runScheduler = async (input: SchedulerInput): Promise<RunSummary> => {
  return new Scheduler(input).run();
};

if (import.meta.vitest) {
  const { describe, it, expect } = await import("vitest");

  describe("orchestrator/scheduler skeleton", () => {
    it("stops immediately when signal is pre-aborted and no work", async () => {
      const ctrl = new AbortController();
      ctrl.abort();
      const summary = await runScheduler({
        tracker: {
          fetchCandidateIssues: async () => ({ type: "Success", value: [] }),
          fetchIssuesByStates: async () => ({ type: "Success", value: [] }),
          fetchIssueStatesByIds: async () => ({ type: "Success", value: [] }),
          createComment: async () => ({ type: "Success", value: undefined }),
          updateIssueState: async () => ({ type: "Success", value: undefined }),
        } as unknown as Tracker,
        backend: {
          type: "mock",
          startSession: async () => ({
            type: "Failure",
            error: { kind: "mock-forced-failure", reason: "n/a" },
          }),
        } as unknown as Backend,
        config: {
          agent: {
            backend: { type: "mock" },
            maxConcurrentAgents: 1,
            maxTurns: 1,
            maxRetryBackoffMs: 300_000,
            agentSessionStallTimeoutMs: 1_800_000,
            maxConcurrentAgentsByState: {},
          },
          tracker: {
            kind: "memory",
            activeStates: ["Todo"],
            terminalStates: ["Done"],
            issues: [],
          },
          prompt: "",
          polling: { intervalMs: 50 },
          logging: null,
          observability: { dashboardEnabled: false, refreshMs: 1000, renderIntervalMs: 16 },
        } as unknown as WorkflowConfig,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        signal: ctrl.signal,
      });
      expect(summary.total).toBe(0);
      expect(summary.completed).toBe(0);
      expect(summary.failed).toBe(0);
    });
  });
}
