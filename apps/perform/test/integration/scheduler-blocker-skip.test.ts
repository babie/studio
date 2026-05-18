import { describe, it, expect } from "vitest";
import * as v from "valibot";
import { selectDispatchable, isBlockerSkippable } from "../../src/orchestrator/dispatch-filter.js";
import { IssueId, IssueIdentifier, IssueStateName } from "../../src/domain/issue.js";

describe("scheduler blocker skip", () => {
  it("skips Todo issue blocked by non-terminal issue", () => {
    const blocker = {
      id: v.parse(IssueId.schema, "B"),
      state: v.parse(IssueStateName.schema, "In Progress"),
    };
    const blocked = {
      id: v.parse(IssueId.schema, "A"),
      identifier: v.parse(IssueIdentifier.schema, "A"),
      title: "t", description: "",
      state: v.parse(IssueStateName.schema, "Todo"),
      priority: null, createdAt: null, assigneeId: null, assignedToWorker: true,
      blockedBy: [blocker],
    };
    const out = selectDispatchable({
      candidates: [blocked],
      activeStates: [v.parse(IssueStateName.schema, "Todo")],
      terminalStates: [v.parse(IssueStateName.schema, "Done")],
      running: new Set(), claimed: new Set(),
      maxConcurrentAgents: 5, maxConcurrentAgentsByState: {}, runningCountByState: {},
    });
    expect(out).toEqual([]);
    expect(isBlockerSkippable(blocked as any, [v.parse(IssueStateName.schema, "Done")])).toBe(true);
  });

  it("dispatches Todo issue once its blocker is terminal", () => {
    const blocker = {
      id: v.parse(IssueId.schema, "B"),
      state: v.parse(IssueStateName.schema, "Done"),
    };
    const blocked = {
      id: v.parse(IssueId.schema, "A"),
      identifier: v.parse(IssueIdentifier.schema, "A"),
      title: "t", description: "",
      state: v.parse(IssueStateName.schema, "Todo"),
      priority: null, createdAt: null, assigneeId: null, assignedToWorker: true,
      blockedBy: [blocker],
    };
    const out = selectDispatchable({
      candidates: [blocked],
      activeStates: [v.parse(IssueStateName.schema, "Todo")],
      terminalStates: [v.parse(IssueStateName.schema, "Done")],
      running: new Set(), claimed: new Set(),
      maxConcurrentAgents: 5, maxConcurrentAgentsByState: {}, runningCountByState: {},
    });
    expect(out.length).toBe(1);
  });
});
