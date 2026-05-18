import type { Result } from "@praha/byethrow";
import type { MemoryTrackerConfig } from "../domain/tracker-config.js";
import type { Issue } from "../domain/issue.js";
import type { TrackerError } from "../domain/tracker-errors.js";
import type { Tracker } from "./types.js";

const normalize = (s: string): string => s.trim().toLowerCase();

export const createMemoryTracker = (config: MemoryTrackerConfig): Tracker => {
  // Immutable snapshot; updateIssueState rebuilds the array via map.
  let store: ReadonlyArray<Issue> = config.issues.map((i) => ({ ...i }));

  const ok = <T>(value: T): Result.Result<T, TrackerError> => ({ type: "Success", value });

  return {
    fetchCandidateIssues: async () => ok(store.map((i) => ({ ...i }))),
    fetchIssuesByStates: async (states) => {
      const wanted = new Set(states.map(normalize));
      return ok(
        store.filter((i) => wanted.has(normalize(i.state))).map((i) => ({ ...i })),
      );
    },
    fetchIssueStatesByIds: async (ids) => {
      const wanted = new Set(ids);
      return ok(store.filter((i) => wanted.has(i.id)).map((i) => ({ ...i })));
    },
    createComment: async () => ok(undefined),
    updateIssueState: async (issue, state) => {
      const idx = store.findIndex((i) => i.id === issue.id);
      if (idx < 0) {
        return { type: "Failure", error: { kind: "issue-not-found", id: issue.id } };
      }
      store = store.map((i) => (i.id === issue.id ? { ...i, state } : i));
      return ok(undefined);
    },
  };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  const v = await import("valibot");
  const { IssueId, IssueIdentifier, IssueStateName } = await import("../domain/issue.js");

  describe("tracker/memory", () => {
    it("returns all candidate issues initially", async () => {
      const t = createMemoryTracker({
        kind: "memory",
        activeStates: ["Todo"],
        terminalStates: ["Done"],
        issues: [
          {
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
          },
        ],
      });
      const res = await t.fetchCandidateIssues();
      if (res.type !== "Success") throw new Error("unexpected");
      expect(res.value.length).toBe(1);
    });

    it("updateIssueState mutates the internal store", async () => {
      const t = createMemoryTracker({
        kind: "memory",
        activeStates: ["Todo"],
        terminalStates: ["Done"],
        issues: [
          {
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
          },
        ],
      });
      const initial = await t.fetchCandidateIssues();
      if (initial.type !== "Success") throw new Error("unexpected");
      const issue = initial.value[0];
      if (!issue) throw new Error("expected at least one issue");
      await t.updateIssueState(issue, v.parse(IssueStateName.schema, "Done"));
      const after = await t.fetchIssuesByStates([v.parse(IssueStateName.schema, "Done")]);
      if (after.type !== "Success") throw new Error("unexpected");
      expect(after.value.length).toBe(1);
      expect(after.value[0]?.state).toBe("Done");
    });

    it("returns issue-not-found when updating a missing id", async () => {
      const t = createMemoryTracker({
        kind: "memory",
        activeStates: [],
        terminalStates: [],
        issues: [],
      });
      const res = await t.updateIssueState(
        {
          id: v.parse(IssueId.schema, "missing"),
          identifier: v.parse(IssueIdentifier.schema, "missing"),
          title: "",
          description: "",
          state: v.parse(IssueStateName.schema, "Todo"),
          priority: null,
          createdAt: null,
          assigneeId: null,
          assignedToWorker: true,
          blockedBy: [],
        },
        v.parse(IssueStateName.schema, "Done"),
      );
      if (res.type !== "Failure") throw new Error("expected failure");
      expect(res.error.kind).toBe("issue-not-found");
    });
  });
}
