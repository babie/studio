import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as v from "valibot";
import { runOrchestrator } from "../../src/orchestrator/orchestrator.js";
import { createMockBackend } from "../../src/backend/mock.js";
import { createMemoryTracker } from "../../src/tracker/memory.js";
import { ObservabilityState } from "../../src/observability/state.js";
import { IssueId, IssueIdentifier, IssueStateName } from "../../src/domain/issue.js";
import type { WorkflowConfig } from "../../src/domain/workflow-config.js";

describe("orchestrator + ObservabilityState integration", () => {
  it("populates running entry while issue is in-flight and clears on end", async () => {
    const root = await mkdtemp(join(tmpdir(), "perform-instr-"));
    const trackerCfg = {
      kind: "memory" as const,
      activeStates: ["Todo"],
      terminalStates: ["Done"],
      doingState: "In Progress",
      doneState: "Done",
      issues: [
        {
          id: v.parse(IssueId.schema, "M-1"),
          identifier: v.parse(IssueIdentifier.schema, "M-1"),
          title: "one",
          description: "",
          state: v.parse(IssueStateName.schema, "Todo"),
          priority: null,
          createdAt: null,
          assigneeId: null,
          assignedToWorker: true,
          blockedBy: [],
        },
      ],
    };
    const tracker = createMemoryTracker(trackerCfg);
    const state = new ObservabilityState();
    const config: WorkflowConfig = {
      agent: {
        backend: { type: "mock" },
        maxConcurrentAgents: 1,
        maxTurns: 1,
        maxRetryBackoffMs: 300_000,
        agentSessionStallTimeoutMs: 1_800_000,
        maxConcurrentAgentsByState: {},
      },
      tracker: trackerCfg,
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
      backend: createMockBackend({ type: "mock" }),
      config,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      hooks: state,
      signal: ctrl.signal,
    });
    if (res.type !== "Success") throw new Error("expected success");
    const snap = state.getSnapshot();
    if (snap.type !== "ok") throw new Error("expected ok");
    expect(snap.data.running.length).toBe(0);
  });
});
