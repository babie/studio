import { describe, it, expect } from "vitest";
import * as v from "valibot";
import { selectDispatchable } from "../../src/orchestrator/dispatch-filter.js";
import { IssueId, IssueIdentifier, IssueStateName, PriorityValue } from "../../src/domain/issue.js";

describe("scheduler priority sort", () => {
  it("dispatches in order: priority 1 → 2 → 3 → 4 → null", () => {
    const mk = (id: string, priority: 1 | 2 | 3 | 4 | null) => ({
      id: v.parse(IssueId.schema, id),
      identifier: v.parse(IssueIdentifier.schema, id),
      title: "t",
      description: "",
      state: v.parse(IssueStateName.schema, "Todo"),
      priority: priority !== null ? v.parse(PriorityValue.schema, priority) : null,
      createdAt: null,
      assigneeId: null,
      assignedToWorker: true,
      blockedBy: [],
    });
    const issues = [mk("X", null), mk("D", 4), mk("A", 1), mk("C", 3), mk("B", 2)];
    const out = selectDispatchable({
      candidates: issues,
      activeStates: [v.parse(IssueStateName.schema, "Todo")],
      terminalStates: [v.parse(IssueStateName.schema, "Done")],
      running: new Set(),
      claimed: new Set(),
      maxConcurrentAgents: 10,
      maxConcurrentAgentsByState: {},
      runningCountByState: {},
    });
    expect(out.map((i) => i.identifier)).toEqual(["A", "B", "C", "D", "X"]);
  });
});
