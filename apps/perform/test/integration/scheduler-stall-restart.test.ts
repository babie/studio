import { describe, it, expect } from "vitest";
import * as v from "valibot";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { Scheduler } from "../../src/orchestrator/scheduler.js";
import { createMockBackend } from "../../src/backend/mock.js";
import { IssueId, IssueIdentifier, IssueStateName } from "../../src/domain/issue.js";
import type { Tracker } from "../../src/tracker/types.js";

describe("scheduler stall restart", () => {
  it("schedules a failure_retry for an issue whose lastActivityAt is older than the stall timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "sched-stall-"));
    const ok = <T>(v: T) => ({ type: "Success" as const, value: v });
    const issue = {
      id: v.parse(IssueId.schema, "A"),
      identifier: v.parse(IssueIdentifier.schema, "A"),
      title: "t", description: "",
      state: v.parse(IssueStateName.schema, "Todo"),
      priority: null, createdAt: null, assigneeId: null, assignedToWorker: true, blockedBy: [],
    };
    const tracker: Tracker = {
      fetchCandidateIssues: async () => ok([]),
      fetchIssuesByStates: async () => ok([]),
      fetchIssueStatesByIds: async () => ok([issue]),
      createComment: async () => ok(undefined),
      updateIssueState: async () => ok(undefined),
    };
    const ctrl = new AbortController();
    const sched = new Scheduler({
      tracker,
      backend: createMockBackend({ type: "mock" }),
      config: {
        agent: { backend: { type: "mock" }, maxConcurrentAgents: 1, maxTurns: 1,
          maxRetryBackoffMs: 300_000, agentSessionStallTimeoutMs: 100, maxConcurrentAgentsByState: {} },
        tracker: { kind: "memory", activeStates: ["Todo"], terminalStates: ["Done"], issues: [] },
        prompt: "", polling: { intervalMs: 50 }, logging: null, workspace: { root },
        observability: { dashboardEnabled: false, refreshMs: 1000, renderIntervalMs: 16 },
      } as any,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      signal: ctrl.signal,
    });

    // Manually inject a running entry with stale lastActivityAt.
    sched.running.set("A", {
      issueId: issue.id, identifier: issue.identifier, issue,
      startedAt: new Date(Date.now() - 5_000),
      lastActivityAt: new Date(Date.now() - 5_000),
      retryAttempt: 0,
    });
    sched.claimed.add("A");

    await (sched as any).reconcileRunning();
    expect(sched.retryAttempts.has("A")).toBe(true);
    const retry = sched.retryAttempts.get("A")!;
    expect(retry.delayType).toBe("failure");
    expect(retry.attempt).toBe(1);
    // cleanup timer
    clearTimeout(retry.timerRef);
  });
});
