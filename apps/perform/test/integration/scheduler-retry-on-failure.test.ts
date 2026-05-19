import { describe, it, expect, vi } from "vitest";
import * as v from "valibot";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { runScheduler } from "../../src/orchestrator/scheduler.js";
import { createMockBackend } from "../../src/backend/mock.js";
import { IssueId, IssueIdentifier, IssueStateName } from "../../src/domain/issue.js";
import type { Tracker } from "../../src/tracker/types.js";

describe("scheduler retry on failure", () => {
  it("schedules failure retry after mock force_fail", async () => {
    vi.useFakeTimers();
    try {
      const root = await mkdtemp(join(tmpdir(), "sched-retry-"));
      const ok = <T>(v: T) => ({ type: "Success" as const, value: v });
      const issue = {
        id: v.parse(IssueId.schema, "A"),
        identifier: v.parse(IssueIdentifier.schema, "A"),
        title: "t",
        description: "",
        state: v.parse(IssueStateName.schema, "Todo"),
        priority: null,
        createdAt: null,
        assigneeId: null,
        assignedToWorker: true,
        blockedBy: [],
      };
      let calls = 0;
      const tracker: Tracker = {
        fetchCandidateIssues: async () => {
          calls += 1;
          return ok(calls < 3 ? [issue] : []);
        },
        fetchIssuesByStates: async () => ok([]),
        fetchIssueStatesByIds: async () => ok([issue]),
        createComment: async () => ok(undefined),
        updateIssueState: async () => ok(undefined),
      };
      const ctrl = new AbortController();
      const runP = runScheduler({
        tracker,
        backend: createMockBackend({ type: "mock", forceFail: true }),
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
            doingState: "In Progress",
            doneState: "Done",
            issues: [],
          },
          prompt: "Hi",
          polling: { intervalMs: 5_000 },
          logging: null,
          workspace: { root },
          observability: { dashboardEnabled: false, refreshMs: 1000, renderIntervalMs: 16 },
        } as any,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        signal: ctrl.signal,
      });

      // Advance fake clock to allow first dispatch and first retry tick
      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(10_000); // failure_retry attempt 1 = 10s
      ctrl.abort();
      const summary = await runP;
      expect(summary.failed).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
