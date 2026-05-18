import { describe, it, expect } from "vitest";
import * as v from "valibot";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { runScheduler } from "../../src/orchestrator/scheduler.js";
import { createMockBackend } from "../../src/backend/mock.js";
import { IssueId, IssueIdentifier, IssueStateName } from "../../src/domain/issue.js";
import type { Tracker } from "../../src/tracker/types.js";

describe("scheduler reconcileRunning", () => {
  it("frees dispatch slot when running issue's state transitions to terminal externally", async () => {
    const root = await mkdtemp(join(tmpdir(), "sched-rec-"));
    const ok = <T>(v: T) => ({ type: "Success" as const, value: v });
    const issue = {
      id: v.parse(IssueId.schema, "A"),
      identifier: v.parse(IssueIdentifier.schema, "A"),
      title: "t", description: "",
      state: v.parse(IssueStateName.schema, "Todo"),
      priority: null, createdAt: null, assigneeId: null, assignedToWorker: true, blockedBy: [],
    };
    const doneIssue = { ...issue, state: v.parse(IssueStateName.schema, "Done") };

    let fetchCalls = 0;
    const tracker: Tracker = {
      fetchCandidateIssues: async () => { fetchCalls += 1; return ok(fetchCalls === 1 ? [issue] : []); },
      fetchIssuesByStates: async () => ok([]),
      fetchIssueStatesByIds: async () => ok([doneIssue]),
      createComment: async () => ok(undefined),
      updateIssueState: async () => ok(undefined),
    };
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 1500);
    const summary = await runScheduler({
      tracker,
      backend: createMockBackend({ type: "mock", delayMs: 30 }),
      config: {
        agent: { backend: { type: "mock" }, maxConcurrentAgents: 1, maxTurns: 1,
          maxRetryBackoffMs: 300_000, agentSessionStallTimeoutMs: 1_800_000, maxConcurrentAgentsByState: {} },
        tracker: { kind: "memory", activeStates: ["Todo"], terminalStates: ["Done"],
          doingState: "In Progress", doneState: "Done", issues: [] },
        prompt: "Hi", polling: { intervalMs: 100 }, logging: null, workspace: { root },
        observability: { dashboardEnabled: false, refreshMs: 1000, renderIntervalMs: 16 },
      } as any,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      signal: ctrl.signal,
    });
    expect(summary.total).toBe(1);
  });
});
