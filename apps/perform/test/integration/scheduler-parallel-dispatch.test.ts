import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import * as v from "valibot";
import { runScheduler } from "../../src/orchestrator/scheduler.js";
import { createMockBackend } from "../../src/backend/mock.js";
import { IssueId, IssueIdentifier, IssueStateName } from "../../src/domain/issue.js";
import type { Tracker } from "../../src/tracker/types.js";

describe("scheduler parallel dispatch", () => {
  it("dispatches 2 issues concurrently when max_concurrent_agents=2", async () => {
    const root = await mkdtemp(join(tmpdir(), "sched-par-"));
    const ok = <T>(v: T) => ({ type: "Success" as const, value: v });
    const mk = (id: string, state: string) => ({
      id: v.parse(IssueId.schema, id),
      identifier: v.parse(IssueIdentifier.schema, id),
      title: id,
      description: "",
      state: v.parse(IssueStateName.schema, state),
      priority: null,
      createdAt: null,
      assigneeId: null,
      assignedToWorker: true,
      blockedBy: [],
    });
    const a = mk("A", "Todo");
    const b = mk("B", "Todo");
    const doneA = { ...a, state: v.parse(IssueStateName.schema, "Done") };
    const doneB = { ...b, state: v.parse(IssueStateName.schema, "Done") };

    let candCalls = 0;
    const tracker: Tracker = {
      fetchCandidateIssues: async () => {
        candCalls += 1;
        return ok(candCalls === 1 ? [a, b] : []);
      },
      fetchIssuesByStates: async () => ok([]),
      fetchIssueStatesByIds: async (ids) =>
        ok(ids.map((id) => (String(id) === "A" ? doneA : doneB))),
      createComment: async () => ok(undefined),
      updateIssueState: async () => ok(undefined),
    };

    const ctrl = new AbortController();
    // Force termination after 1s if the scheduler doesn't drain.
    const watchdog = setTimeout(() => ctrl.abort(), 2000);

    const summary = await runScheduler({
      tracker,
      backend: createMockBackend({ type: "mock", delayMs: 50 }),
      config: {
        agent: {
          backend: { type: "mock" },
          maxConcurrentAgents: 2,
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
        polling: { intervalMs: 200 },
        logging: null,
        workspace: { root },
        observability: { dashboardEnabled: false, refreshMs: 1000, renderIntervalMs: 16 },
      } as any,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      signal: ctrl.signal,
    });
    clearTimeout(watchdog);

    expect(summary.total).toBe(2);
    expect(summary.completed).toBe(2);
  });
});
