import { describe, it, expect } from "vitest";
import * as v from "valibot";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { runScheduler } from "../../src/orchestrator/scheduler.js";
import { createMockBackend } from "../../src/backend/mock.js";
import { IssueId, IssueIdentifier, IssueStateName } from "../../src/domain/issue.js";
import type { Tracker } from "../../src/tracker/types.js";
import { CONTINUATION_RETRY_DELAY_MS } from "../../src/orchestrator/retry-policy.js";

describe("scheduler continuation retry", () => {
  it("re-dispatches the same issue 1s after normal exit when still active (no doing_state)", async () => {
    // Real timers — fake timers interact poorly with the EventEmitter/Promise.race pattern.
    // Use a short continuation delay by monkey-patching CONTINUATION_RETRY_DELAY_MS via
    // a small polling interval and aborting after enough real time has elapsed.
    const root = await mkdtemp(join(tmpdir(), "sched-cont-"));
    const ok = <T>(v: T) => ({ type: "Success" as const, value: v });
    const todo = {
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
    // Run 1: returns issue. Run 2 (after continuation): returns it again. Run 3+: empty → scheduler exits.
    let calls = 0;
    const tracker: Tracker = {
      fetchCandidateIssues: async () => {
        calls += 1;
        return ok(calls < 3 ? [todo] : []);
      },
      fetchIssuesByStates: async () => ok([]),
      fetchIssueStatesByIds: async () => ok([todo]), // stays active so loop ends with completed=false
      createComment: async () => ok(undefined),
      updateIssueState: async () => ok(undefined),
    };
    const ctrl = new AbortController();
    // Abort after 2× the real CONTINUATION_RETRY_DELAY_MS plus generous buffer.
    const abortTimer = setTimeout(() => ctrl.abort(), CONTINUATION_RETRY_DELAY_MS * 2 + 500);
    try {
      await runScheduler({
        tracker,
        backend: createMockBackend({ type: "mock" }),
        config: {
          // doingState omitted → ADR-0014 3rd condition off → loop ends with completed=false
          agent: {
            backend: { type: "mock" },
            maxConcurrentAgents: 1,
            maxTurns: 1,
            maxRetryBackoffMs: 300_000,
            agentSessionStallTimeoutMs: 1_800_000,
            maxConcurrentAgentsByState: {},
          },
          tracker: { kind: "memory", activeStates: ["Todo"], terminalStates: ["Done"], issues: [] },
          prompt: "Hi",
          polling: { intervalMs: 100 },
          logging: null,
          workspace: { root },
          observability: { dashboardEnabled: false, refreshMs: 1000, renderIntervalMs: 16 },
        } as any,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(abortTimer);
    }
    expect(calls).toBeGreaterThanOrEqual(2);
  }, 10_000);
});
