import type { Issue, IssueStateName } from "../domain/issue.js";

/**
 * Symphony parity:
 * - priority 1-4 → priorityRank(p) = p; null/anything else → 5
 * - createdAt null → +Infinity (sort to end)
 * - identifier as last tiebreaker
 */
const priorityRank = (p: number | null): number => (p === 1 || p === 2 || p === 3 || p === 4 ? p : 5);

const createdAtKey = (d: Date | null): number => (d ? d.getTime() : Number.POSITIVE_INFINITY);

export const sortByPriorityThenCreatedAt = <T extends Issue>(issues: ReadonlyArray<T>): T[] => {
  return [...issues].sort((a, b) => {
    const pa = priorityRank(a.priority);
    const pb = priorityRank(b.priority);
    if (pa !== pb) return pa - pb;
    const ca = createdAtKey(a.createdAt);
    const cb = createdAtKey(b.createdAt);
    if (ca !== cb) return ca - cb;
    return (a.identifier || a.id).localeCompare(b.identifier || b.id);
  });
};

/**
 * Todo + any non-terminal blocker → skip.
 */
export const isBlockerSkippable = (
  issue: Issue,
  terminalStates: ReadonlyArray<IssueStateName>,
): boolean => {
  if (issue.state.toLowerCase().trim() !== "todo") return false;
  const terminalSet = new Set(terminalStates.map((s) => s.toLowerCase().trim()));
  return issue.blockedBy.some((b) => !terminalSet.has(b.state.toLowerCase().trim()));
};

export type DispatchableInput<T extends Issue> = Readonly<{
  candidates: ReadonlyArray<T>;
  activeStates: ReadonlyArray<IssueStateName>;
  terminalStates: ReadonlyArray<IssueStateName>;
  running: ReadonlySet<string>; // issue ids
  claimed: ReadonlySet<string>;
  maxConcurrentAgents: number;
  maxConcurrentAgentsByState: Readonly<Record<string, number>>;
  runningCountByState: Readonly<Record<string, number>>;
}>;

export const selectDispatchable = <T extends Issue>(input: DispatchableInput<T>): T[] => {
  const {
    candidates, activeStates, terminalStates, running, claimed,
    maxConcurrentAgents, maxConcurrentAgentsByState, runningCountByState,
  } = input;
  const activeSet = new Set(activeStates.map((s) => s.toLowerCase().trim()));
  const terminalSet = new Set(terminalStates.map((s) => s.toLowerCase().trim()));
  const inflight = new Map<string, number>(Object.entries(runningCountByState));
  let totalUsed = claimed.size;
  const result: T[] = [];

  for (const issue of sortByPriorityThenCreatedAt(candidates)) {
    if (totalUsed >= maxConcurrentAgents) break;
    if (running.has(String(issue.id)) || claimed.has(String(issue.id))) continue;
    if (!issue.assignedToWorker) continue;
    const stateKey = issue.state.toLowerCase().trim();
    if (!activeSet.has(stateKey)) continue;
    if (terminalSet.has(stateKey)) continue;
    if (isBlockerSkippable(issue, terminalStates)) continue;
    const stateLimit = maxConcurrentAgentsByState[issue.state] ?? maxConcurrentAgents;
    const stateUsed = inflight.get(issue.state) ?? 0;
    if (stateUsed >= stateLimit) continue;

    result.push(issue);
    totalUsed += 1;
    inflight.set(issue.state, stateUsed + 1);
  }
  return result;
};

if (import.meta.vitest) {
  const { describe, it, expect } = await import("vitest");
  const v = await import("valibot");
  const { IssueId, IssueIdentifier, IssueStateName, PriorityValue } = await import("../domain/issue.js");

  const mk = (overrides: Partial<Issue> & Pick<Issue, "id" | "identifier" | "state">): Issue => ({
    title: "t", description: "",
    priority: null, createdAt: null, assigneeId: null, assignedToWorker: true, blockedBy: [],
    ...overrides,
  }) as Issue;

  describe("orchestrator/dispatch-filter", () => {
    it("sorts by priority asc, null treated as 5", () => {
      const a = mk({
        id: v.parse(IssueId.schema, "A"), identifier: v.parse(IssueIdentifier.schema, "A"),
        state: v.parse(IssueStateName.schema, "Todo"), priority: v.parse(PriorityValue.schema, 3),
      });
      const b = mk({
        id: v.parse(IssueId.schema, "B"), identifier: v.parse(IssueIdentifier.schema, "B"),
        state: v.parse(IssueStateName.schema, "Todo"), priority: v.parse(PriorityValue.schema, 1),
      });
      const c = mk({
        id: v.parse(IssueId.schema, "C"), identifier: v.parse(IssueIdentifier.schema, "C"),
        state: v.parse(IssueStateName.schema, "Todo"), priority: null,
      });
      const sorted = sortByPriorityThenCreatedAt([a, b, c]);
      expect(sorted.map((i) => i.identifier)).toEqual(["B", "A", "C"]);
    });

    it("createdAt tiebreaker after priority", () => {
      const older = mk({
        id: v.parse(IssueId.schema, "OLD"), identifier: v.parse(IssueIdentifier.schema, "OLD"),
        state: v.parse(IssueStateName.schema, "Todo"),
        priority: v.parse(PriorityValue.schema, 2), createdAt: new Date("2026-01-01"),
      });
      const newer = mk({
        id: v.parse(IssueId.schema, "NEW"), identifier: v.parse(IssueIdentifier.schema, "NEW"),
        state: v.parse(IssueStateName.schema, "Todo"),
        priority: v.parse(PriorityValue.schema, 2), createdAt: new Date("2026-02-01"),
      });
      const sorted = sortByPriorityThenCreatedAt([newer, older]);
      expect(sorted.map((i) => i.identifier)).toEqual(["OLD", "NEW"]);
    });

    it("isBlockerSkippable: Todo + non-terminal blocker is true", () => {
      const issue = mk({
        id: v.parse(IssueId.schema, "X"), identifier: v.parse(IssueIdentifier.schema, "X"),
        state: v.parse(IssueStateName.schema, "Todo"),
        blockedBy: [{
          id: v.parse(IssueId.schema, "Y"),
          state: v.parse(IssueStateName.schema, "In Progress"),
        }],
      });
      expect(isBlockerSkippable(issue, [v.parse(IssueStateName.schema, "Done")])).toBe(true);
    });

    it("isBlockerSkippable: Todo + only terminal blocker is false", () => {
      const issue = mk({
        id: v.parse(IssueId.schema, "X"), identifier: v.parse(IssueIdentifier.schema, "X"),
        state: v.parse(IssueStateName.schema, "Todo"),
        blockedBy: [{
          id: v.parse(IssueId.schema, "Y"),
          state: v.parse(IssueStateName.schema, "Done"),
        }],
      });
      expect(isBlockerSkippable(issue, [v.parse(IssueStateName.schema, "Done")])).toBe(false);
    });

    it("isBlockerSkippable: non-Todo state never skipped", () => {
      const issue = mk({
        id: v.parse(IssueId.schema, "X"), identifier: v.parse(IssueIdentifier.schema, "X"),
        state: v.parse(IssueStateName.schema, "In Progress"),
        blockedBy: [{
          id: v.parse(IssueId.schema, "Y"),
          state: v.parse(IssueStateName.schema, "Todo"),
        }],
      });
      expect(isBlockerSkippable(issue, [v.parse(IssueStateName.schema, "Done")])).toBe(false);
    });

    it("selectDispatchable: respects maxConcurrentAgents", () => {
      const issues = ["A", "B", "C"].map((id) => mk({
        id: v.parse(IssueId.schema, id), identifier: v.parse(IssueIdentifier.schema, id),
        state: v.parse(IssueStateName.schema, "Todo"),
      }));
      const out = selectDispatchable({
        candidates: issues,
        activeStates: [v.parse(IssueStateName.schema, "Todo")],
        terminalStates: [v.parse(IssueStateName.schema, "Done")],
        running: new Set(), claimed: new Set(),
        maxConcurrentAgents: 2,
        maxConcurrentAgentsByState: {},
        runningCountByState: {},
      });
      expect(out.length).toBe(2);
    });

    it("selectDispatchable: skips assignedToWorker=false", () => {
      const issue = mk({
        id: v.parse(IssueId.schema, "A"), identifier: v.parse(IssueIdentifier.schema, "A"),
        state: v.parse(IssueStateName.schema, "Todo"), assignedToWorker: false,
      });
      const out = selectDispatchable({
        candidates: [issue],
        activeStates: [v.parse(IssueStateName.schema, "Todo")],
        terminalStates: [v.parse(IssueStateName.schema, "Done")],
        running: new Set(), claimed: new Set(),
        maxConcurrentAgents: 2,
        maxConcurrentAgentsByState: {}, runningCountByState: {},
      });
      expect(out.length).toBe(0);
    });

    it("selectDispatchable: respects per-state limit", () => {
      const issues = ["A", "B"].map((id) => mk({
        id: v.parse(IssueId.schema, id), identifier: v.parse(IssueIdentifier.schema, id),
        state: v.parse(IssueStateName.schema, "In Progress"),
      }));
      const out = selectDispatchable({
        candidates: issues,
        activeStates: [v.parse(IssueStateName.schema, "In Progress")],
        terminalStates: [v.parse(IssueStateName.schema, "Done")],
        running: new Set(), claimed: new Set(),
        maxConcurrentAgents: 10,
        maxConcurrentAgentsByState: { "In Progress": 1 },
        runningCountByState: {},
      });
      expect(out.length).toBe(1);
    });

    it("selectDispatchable: skips already running or claimed", () => {
      const issue = mk({
        id: v.parse(IssueId.schema, "A"), identifier: v.parse(IssueIdentifier.schema, "A"),
        state: v.parse(IssueStateName.schema, "Todo"),
      });
      const out = selectDispatchable({
        candidates: [issue],
        activeStates: [v.parse(IssueStateName.schema, "Todo")],
        terminalStates: [v.parse(IssueStateName.schema, "Done")],
        running: new Set(["A"]),
        claimed: new Set(),
        maxConcurrentAgents: 10,
        maxConcurrentAgentsByState: {}, runningCountByState: {},
      });
      expect(out.length).toBe(0);
    });

    it("selectDispatchable: respects max=3 with 2 running and 0 extra claimed → 1 more dispatchable", () => {
      const candidates = ["X", "Y", "Z"].map((id) => mk({
        id: v.parse(IssueId.schema, id), identifier: v.parse(IssueIdentifier.schema, id),
        state: v.parse(IssueStateName.schema, "Todo"),
      }));
      const out = selectDispatchable({
        candidates,
        activeStates: [v.parse(IssueStateName.schema, "Todo")],
        terminalStates: [v.parse(IssueStateName.schema, "Done")],
        running: new Set(["A", "B"]),  // 2 already running
        claimed: new Set(["A", "B"]),  // running ⊆ claimed, so claimed.size = 2
        maxConcurrentAgents: 3,
        maxConcurrentAgentsByState: {}, runningCountByState: {},
      });
      // Before fix: totalUsed = 2+2 = 4 ≥ 3 → out.length = 0 (BUG)
      // After fix:  totalUsed = 2 → 1 slot free → out.length = 1
      expect(out.length).toBe(1);
    });
  });
}
