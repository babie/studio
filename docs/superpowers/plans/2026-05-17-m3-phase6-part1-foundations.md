# M3 Phase 6 Implementation Plan — Part 1: Foundations (Tasks 1-10)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Overview:** [`2026-05-17-m3-phase6.md`](2026-05-17-m3-phase6.md) (header / pre-flight / file structure / table of contents)
**Spec:** [`docs/superpowers/specs/2026-05-17-m3-phase6-design.md`](../specs/2026-05-17-m3-phase6-design.md)
**Branch:** `feat/m3-phase6` (created in Task 1)

**Scope of Part 1:** ready-to-use building blocks before any orchestrator change.

- Task 1: Pre-flight + branch + deps (`p-queue`, `p-retry`, `pino`, `pino-roll`, `pino-pretty`)
- Task 2: Issue domain extension (priority / createdAt / assigneeId / assignedToWorker / blockedBy)
- Task 3: OrchestratorError + BackendError + TrackerError extension
- Task 4: `dispatch-filter.ts` (sort + blocker + per-state limit, pure)
- Task 5: `retry-policy.ts` (continuation 1s + failure exponential, pure)
- Task 6: Memory tracker — schema + adapter populate
- Task 7: Linear tracker — populate 5 fields + 15s timeout
- Task 8: GitHub tracker — populate 5 fields + 15s timeout
- Task 9: `file-logger.ts` (pino + pino-roll + pino-pretty, JSON + rotation)
- Task 10: `logger.ts` dispatch (std / noop / file) + CLI wiring

**Next:** [Part 2 — Engine](2026-05-17-m3-phase6-part2-engine.md) (Tasks 11-19)

---

## Task 1: Pre-flight + branch + dependencies

**Files:**
- Modify: `apps/conductor/package.json`

- [ ] **Step 1: Confirm clean tree on main and create branch**

```bash
git -C /workspace status
git -C /workspace switch -c feat/m3-phase6
```

Expected: branch `feat/m3-phase6` created from main, tree clean.

- [ ] **Step 2: Add dependencies**

```bash
pnpm --filter conductor add p-queue@^8 p-retry@^6 pino@^9 pino-roll@^3 pino-pretty@^11
```

Expected: 5 packages added to `apps/conductor/package.json` "dependencies".

- [ ] **Step 3: Verify install + Phase 5 tests still green**

```bash
cd /workspace && pnpm install 2>&1 | tail -3
pnpm --filter conductor test 2>&1 | tail -10
```

Expected: install ok, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/conductor/package.json pnpm-lock.yaml
git commit -m "chore(conductor): add p-queue/p-retry/pino deps for M3 Phase 6"
```

---

## Task 2: Issue domain extension (priority / createdAt / assigneeId / assignedToWorker / blockedBy)

**Files:**
- Modify: `apps/conductor/src/domain/issue.ts`

- [ ] **Step 1: Add fields to Issue type + branded schemas**

Replace `Issue` type and add `BlockedByRef`:

```ts
const PriorityValueSchema = v.union([v.literal(1), v.literal(2), v.literal(3), v.literal(4)]);
export type PriorityValue = v.InferOutput<typeof PriorityValueSchema>;
export const PriorityValue: Readonly<{ schema: typeof PriorityValueSchema }> = {
  schema: PriorityValueSchema,
} as const;

export type BlockedByRef = Readonly<{
  id: IssueId;
  state: IssueStateName;
}>;

export type Issue = Readonly<{
  id: IssueId;
  identifier: IssueIdentifier;
  title: string;
  description: string;
  state: IssueStateName;
  priority: PriorityValue | null;
  createdAt: Date | null;
  assigneeId: string | null;
  assignedToWorker: boolean;
  blockedBy: ReadonlyArray<BlockedByRef>;
  extra?: IssueExtra;
}>;
```

- [ ] **Step 2: Update in-source tests to populate new fields**

Replace existing tests that construct an `Issue` to include the new fields. Add 3 new tests for `priority` (parse 1/2/3/4 ok, parse 5 throws), `blockedBy` (empty array default), `assignedToWorker` (boolean only).

```ts
it("PriorityValue accepts 1-4 only", () => {
  expect(v.parse(PriorityValue.schema, 1)).toBe(1);
  expect(v.parse(PriorityValue.schema, 4)).toBe(4);
  expect(() => v.parse(PriorityValue.schema, 5)).toThrow();
  expect(() => v.parse(PriorityValue.schema, 0)).toThrow();
});

it("Issue carries priority/createdAt/assigneeId/assignedToWorker/blockedBy", () => {
  const issue: Issue = {
    id: v.parse(IssueId.schema, "M-1"),
    identifier: v.parse(IssueIdentifier.schema, "M-1"),
    title: "t", description: "d",
    state: v.parse(IssueStateName.schema, "Todo"),
    priority: v.parse(PriorityValue.schema, 2),
    createdAt: new Date("2026-05-01T00:00:00Z"),
    assigneeId: "user_42",
    assignedToWorker: true,
    blockedBy: [{
      id: v.parse(IssueId.schema, "M-2"),
      state: v.parse(IssueStateName.schema, "In Progress"),
    }],
  };
  expect(issue.priority).toBe(2);
  expect(issue.blockedBy.length).toBe(1);
  expect(issue.assignedToWorker).toBe(true);
});
```

The existing `extra: optional` test stays. Update **every** existing `Issue` literal in the file to include the new required fields (priority: null, createdAt: null, assigneeId: null, assignedToWorker: true, blockedBy: []) for default cases.

- [ ] **Step 3: Update every callsite that constructs an Issue**

This change ripples to every file that builds an `Issue` literal. Run:

```bash
grep -rln "as const satisfies Issue\|: Issue = {\|Issue = {" /workspace/apps/conductor/src /workspace/apps/conductor/test
```

For each match, add `priority: null, createdAt: null, assigneeId: null, assignedToWorker: true, blockedBy: []` to the literal (keep them inline at the end of the object before `extra` / closing brace).

Files known to need this update (verify via grep):
- `apps/conductor/src/backend/mock.ts` (in-source test fixture)
- `apps/conductor/src/orchestrator/orchestrator.ts` (in-source test)
- `apps/conductor/src/orchestrator/agent-runner.ts` (in-source test)
- `apps/conductor/src/observability/state.ts` (if any)
- `apps/conductor/test/integration/*.test.ts` (multiple)
- `apps/conductor/test/e2e/*.test.ts` (multiple)

- [ ] **Step 4: Run conductor tests; expect type errors to flag missing fields, then fix**

```bash
pnpm --filter conductor test 2>&1 | tail -40
```

Expected: TypeScript errors at any callsite that still omits the new fields. Add the defaults until clean.

- [ ] **Step 5: Commit**

```bash
git add apps/conductor/src/domain/issue.ts apps/conductor/src/ apps/conductor/test/
git commit -m "feat(conductor): extend Issue with priority/createdAt/assignee/blockedBy/assignedToWorker"
```

---

## Task 3: OrchestratorError extension (new failure kinds)

**Files:**
- Modify: `apps/conductor/src/domain/orchestrator-errors.ts`
- Modify: `apps/conductor/src/domain/backend-errors.ts`

- [ ] **Step 1: Add new BackendError kinds**

In `backend-errors.ts`, add to the `BackendError` discriminated union:
```ts
| Readonly<{ kind: "session-exited-mid-turn"; exitCode: number | null; signal: string | null }>
| Readonly<{ kind: "aborted" }>
```

- [ ] **Step 2: Add new TrackerError kind**

In `tracker-errors.ts`, add:
```ts
| Readonly<{ kind: "tracker-timeout"; operation: string; timeoutMs: number }>
```

- [ ] **Step 3: Add new OrchestratorError kind**

In `orchestrator-errors.ts`, add to the union:
```ts
| Readonly<{ kind: "stall-restart"; issueId: string; elapsedMs: number }>
```

- [ ] **Step 4: Add in-source tests**

```ts
it("supports session-exited-mid-turn from backend", () => {
  const e: OrchestratorError = {
    kind: "backend",
    error: { kind: "session-exited-mid-turn", exitCode: 1, signal: null },
  };
  expect(e.kind).toBe("backend");
});
it("supports aborted from backend", () => {
  const e: OrchestratorError = { kind: "backend", error: { kind: "aborted" } };
  expect(e.error.kind).toBe("aborted");
});
it("supports tracker-timeout", () => {
  const e: OrchestratorError = {
    kind: "tracker",
    error: { kind: "tracker-timeout", operation: "fetchCandidates", timeoutMs: 15000 },
  };
  expect(e.error.kind).toBe("tracker-timeout");
});
it("supports stall-restart", () => {
  const e: OrchestratorError = { kind: "stall-restart", issueId: "M-1", elapsedMs: 1_900_000 };
  expect(e.kind).toBe("stall-restart");
});
```

- [ ] **Step 5: Verify + commit**

```bash
pnpm --filter conductor test 2>&1 | tail -5
git add apps/conductor/src/domain/
git commit -m "feat(conductor): add session-exited-mid-turn/aborted/tracker-timeout/stall-restart error kinds"
```

---

## Task 4: dispatch-filter.ts (pure, in-source tested)

**Files:**
- Create: `apps/conductor/src/orchestrator/dispatch-filter.ts`

- [ ] **Step 1: Write the failing tests inside the new module**

Create the file with in-source tests first (TDD red):

```ts
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
  let totalUsed = running.size + claimed.size;
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
  });
}
```

- [ ] **Step 2: Run tests — verify all 8 pass**

```bash
pnpm --filter conductor test src/orchestrator/dispatch-filter.ts 2>&1 | tail -20
```

Expected: 8 tests pass under "orchestrator/dispatch-filter".

- [ ] **Step 3: Commit**

```bash
git add apps/conductor/src/orchestrator/dispatch-filter.ts
git commit -m "feat(conductor): add dispatch-filter (sort + blocker skip + per-state limit)"
```

---

## Task 5: retry-policy.ts (pure, in-source tested)

**Files:**
- Create: `apps/conductor/src/orchestrator/retry-policy.ts`

- [ ] **Step 1: Create the module with in-source tests**

```ts
/**
 * Symphony parity:
 *   continuation_retry_delay_ms = 1_000   (1s)
 *   failure_retry_base_ms       = 10_000  (10s)
 *   failure_retry_max_power     = 10      (2^10 = 1024 ×)
 *   max_retry_backoff_ms        configurable, default 300_000 (5 min)
 */

export const CONTINUATION_RETRY_DELAY_MS = 1_000;
export const FAILURE_RETRY_BASE_MS = 10_000;
export const FAILURE_RETRY_MAX_POWER = 10;

export type RetryDelayType = "continuation" | "failure";

export const continuationDelay = (): number => CONTINUATION_RETRY_DELAY_MS;

export const failureDelay = (attempt: number, maxBackoffMs: number): number => {
  if (attempt < 1) return FAILURE_RETRY_BASE_MS;
  const power = Math.min(attempt - 1, FAILURE_RETRY_MAX_POWER);
  return Math.min(FAILURE_RETRY_BASE_MS * (1 << power), maxBackoffMs);
};

export const retryDelay = (
  attempt: number,
  delayType: RetryDelayType,
  maxBackoffMs: number,
): number => {
  if (delayType === "continuation" && attempt === 1) return continuationDelay();
  return failureDelay(attempt, maxBackoffMs);
};

if (import.meta.vitest) {
  const { describe, it, expect } = await import("vitest");

  describe("orchestrator/retry-policy", () => {
    it("continuation attempt 1 returns 1000ms", () => {
      expect(retryDelay(1, "continuation", 300_000)).toBe(1_000);
    });

    it("failure attempt 1 returns 10s base", () => {
      expect(retryDelay(1, "failure", 300_000)).toBe(10_000);
    });

    it("failure attempt 2 returns 20s (2x)", () => {
      expect(retryDelay(2, "failure", 300_000)).toBe(20_000);
    });

    it("failure attempt 3 returns 40s (4x)", () => {
      expect(retryDelay(3, "failure", 300_000)).toBe(40_000);
    });

    it("failure cap honoured at maxBackoffMs", () => {
      expect(retryDelay(20, "failure", 300_000)).toBe(300_000);
    });

    it("failure capped at 2^10 × base when below maxBackoffMs", () => {
      expect(retryDelay(15, "failure", 100_000_000)).toBe(10_000 * (1 << 10));
    });

    it("continuation with attempt >1 falls back to failure delay (rare)", () => {
      expect(retryDelay(2, "continuation", 300_000)).toBe(20_000);
    });

    it("attempt < 1 falls back to base", () => {
      expect(failureDelay(0, 300_000)).toBe(10_000);
      expect(failureDelay(-5, 300_000)).toBe(10_000);
    });
  });
}
```

- [ ] **Step 2: Run + verify 8 pass**

```bash
pnpm --filter conductor test src/orchestrator/retry-policy.ts 2>&1 | tail -20
```

- [ ] **Step 3: Commit**

```bash
git add apps/conductor/src/orchestrator/retry-policy.ts
git commit -m "feat(conductor): add retry-policy (continuation 1s + failure exponential w/ cap)"
```

---

## Task 6: Memory tracker — schema + adapter populate

**Files:**
- Modify: `apps/conductor/src/tracker/memory/schema.ts`
- Modify: `apps/conductor/src/tracker/memory/adapter.ts`
- Modify: `apps/conductor/examples/workflow.mock-memory.md` (add `priority`/`blocked_by` examples)

- [ ] **Step 1: Inspect current Memory schema**

```bash
cat /workspace/apps/conductor/src/tracker/memory/schema.ts
cat /workspace/apps/conductor/src/tracker/memory/adapter.ts
```

Identify the existing `MemoryIssueYaml` schema (snake_case YAML keys).

- [ ] **Step 2: Extend the YAML schema with 5 optional fields**

Add to the MemoryIssueYaml `v.object({...})`:

```ts
priority: v.optional(v.union([v.literal(1), v.literal(2), v.literal(3), v.literal(4)])),
created_at: v.optional(v.string()), // ISO-8601 string; transform to Date in adapter
assignee_id: v.optional(v.nullable(v.string())),
assigned_to_worker: v.optional(v.boolean()),
blocked_by: v.optional(v.array(v.object({
  id: v.string(),
  state: v.string(),
}))),
```

- [ ] **Step 3: Update adapter to populate Issue with defaults**

When converting `MemoryIssueYaml` → `Issue`:
```ts
priority: yaml.priority ?? null,
createdAt: yaml.created_at ? new Date(yaml.created_at) : null,
assigneeId: yaml.assignee_id ?? null,
assignedToWorker: yaml.assigned_to_worker ?? true,
blockedBy: (yaml.blocked_by ?? []).map((b) => ({
  id: v.parse(IssueId.schema, b.id),
  state: v.parse(IssueStateName.schema, b.state),
})),
```

- [ ] **Step 4: Add in-source test for new fields**

In the adapter's in-source test block, add:

```ts
it("populates priority/createdAt/assigneeId/assignedToWorker/blockedBy from YAML", async () => {
  const tracker = createMemoryTracker({
    issues: [{
      id: "M-1", identifier: "M-1", title: "t", description: "",
      state: "Todo",
      priority: 2,
      created_at: "2026-01-01T00:00:00Z",
      assignee_id: "u_42",
      assigned_to_worker: true,
      blocked_by: [{ id: "M-2", state: "In Progress" }],
    }],
    activeStates: ["Todo"], terminalStates: ["Done"],
  });
  const r = await tracker.fetchCandidateIssues();
  if (r.type !== "Success") throw new Error("expected ok");
  const issue = r.value[0]!;
  expect(issue.priority).toBe(2);
  expect(issue.createdAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  expect(issue.assigneeId).toBe("u_42");
  expect(issue.assignedToWorker).toBe(true);
  expect(issue.blockedBy.length).toBe(1);
});

it("defaults to null/true/[] when fields omitted", async () => {
  const tracker = createMemoryTracker({
    issues: [{ id: "M-1", identifier: "M-1", title: "t", description: "", state: "Todo" }],
    activeStates: ["Todo"], terminalStates: ["Done"],
  });
  const r = await tracker.fetchCandidateIssues();
  if (r.type !== "Success") throw new Error("expected ok");
  const issue = r.value[0]!;
  expect(issue.priority).toBeNull();
  expect(issue.createdAt).toBeNull();
  expect(issue.assigneeId).toBeNull();
  expect(issue.assignedToWorker).toBe(true);
  expect(issue.blockedBy).toEqual([]);
});
```

- [ ] **Step 5: Run + commit**

```bash
pnpm --filter conductor test src/tracker/memory 2>&1 | tail -20
git add apps/conductor/src/tracker/memory/ apps/conductor/examples/workflow.mock-memory.md
git commit -m "feat(conductor): memory tracker populates priority/blockedBy/assignee/createdAt"
```

---

## Task 7: Linear tracker — populate 5 fields + 15s timeout

**Files:**
- Modify: `apps/conductor/src/tracker/linear/queries.ts` (add `priority`, `createdAt`, `assignee.id`, `inverseRelations { type, relatedIssue { id, state { name } } }`)
- Modify: `apps/conductor/src/tracker/linear/client.ts` (wire `AbortController.timeout(15_000)` into `linearQuery` / `linearMutation`)
- Modify: `apps/conductor/src/tracker/linear/adapter.ts` (populate 5 fields)
- Create: `apps/conductor/test/integration/tracker-timeout.test.ts` (shared with Task 8)

- [ ] **Step 1: Extend GraphQL queries**

Edit `linear/queries.ts`. The existing list/by-states queries need these fields added to each issue selection:

```graphql
... on Issue {
  id
  identifier
  title
  description
  state { name }
  # NEW
  priority
  createdAt
  assignee { id }
  inverseRelations(filter: { type: { eq: blocks } }) {
    nodes {
      relatedIssue {
        id
        state { name }
      }
    }
  }
}
```

(Same for `LIST_ISSUES_QUERY`, `LIST_ISSUES_BY_ASSIGNEE_QUERY`, `LIST_ISSUES_BY_STATES_QUERY`, `ISSUE_STATES_BY_IDS_QUERY` — pick whichever subset is actually present in queries.ts. The state-fetch query may not need `inverseRelations`; only candidate-list queries need it.)

- [ ] **Step 2: Update `linearQuery` / `linearMutation` to honour timeout**

In `linear/client.ts`, find the `fetch(...)` call inside `linearQuery` (and `linearMutation`). Wrap signal:

```ts
const TIMEOUT_MS = 15_000;

const ac = new AbortController();
const timer = setTimeout(() => ac.abort(new Error("tracker-timeout")), TIMEOUT_MS);
try {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { /* existing */ },
    body: JSON.stringify({ query, variables }),
    signal: ac.signal,
  });
  // existing response handling
} catch (err) {
  if (err instanceof Error && err.name === "AbortError") {
    return { type: "Failure", error: { kind: "tracker-timeout", operation, timeoutMs: TIMEOUT_MS } };
  }
  throw err;
} finally {
  clearTimeout(timer);
}
```

The `operation` parameter (string label for telemetry) needs to be added as the second positional arg to `linearQuery` / `linearMutation` — update call sites with labels like `"fetchCandidates"`, `"updateIssueState"`, etc.

- [ ] **Step 3: Update adapter to populate 5 fields**

In `linear/adapter.ts`, find where `Issue` is built from the GraphQL response and add:

```ts
priority: linearIssue.priority && [1, 2, 3, 4].includes(linearIssue.priority)
  ? (linearIssue.priority as 1 | 2 | 3 | 4)
  : null,
createdAt: linearIssue.createdAt ? new Date(linearIssue.createdAt) : null,
assigneeId: linearIssue.assignee?.id ?? null,
assignedToWorker: computeAssignedToWorker(linearIssue.assignee?.id, assigneeFilter), // see helper below
blockedBy: (linearIssue.inverseRelations?.nodes ?? []).map((n) => ({
  id: v.parse(IssueId.schema, n.relatedIssue.id),
  state: v.parse(IssueStateName.schema, n.relatedIssue.state.name),
})),
```

Add helper:

```ts
const computeAssignedToWorker = (assigneeId: string | null | undefined, filter: string | null): boolean => {
  if (!filter) return true;
  return assigneeId === filter;
};
```

The `assigneeFilter` value is the resolved viewer/literal id from `linear/adapter.ts` warmup (already exists per Phase 3 status notes).

- [ ] **Step 4: Update valibot response schema**

`linear/queries.ts` (or wherever `LinearIssueSchema` lives) should add the new fields:
```ts
priority: v.nullable(v.number()),
createdAt: v.string(),
assignee: v.nullable(v.object({ id: v.string() })),
inverseRelations: v.optional(v.object({
  nodes: v.array(v.object({
    relatedIssue: v.object({
      id: v.string(),
      state: v.object({ name: v.string() }),
    }),
  })),
})),
```

- [ ] **Step 5: Add in-source tests + integration test**

Add to `linear/adapter.ts` in-source (mock the GraphQL fetch via vi.spyOn) test that the 5 fields are populated.

Then create `test/integration/tracker-timeout.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createLinearTracker } from "../../src/tracker/linear/adapter.js";

describe("tracker timeout (Linear)", () => {
  it("returns tracker-timeout Failure when fetch hangs past 15s", async () => {
    // mock fetch to hang past 15s — but for test speed, monkey-patch the timeout const
    // by using a wrapper that injects a short signal.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() => new Promise(() => {})); // never resolves
    try {
      const tracker = createLinearTracker({
        apiKey: "secret",
        endpoint: "https://api.linear.app/graphql",
        projectSlug: "test",
        assignee: null,
        timeoutMs: 200, // override (see Step 2 — accept timeoutMs option)
      });
      const r = await tracker.fetchCandidateIssues();
      expect(r.type).toBe("Failure");
      if (r.type === "Failure") {
        expect(r.error.kind).toBe("tracker-timeout");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
```

Adjust `linear/adapter.ts` to accept `timeoutMs` option (default 15_000) — this is the public API hook for the integration test. Same pattern goes into GitHub adapter (Task 8) so the test file can later add a `tracker timeout (GitHub)` describe.

- [ ] **Step 6: Run tests + commit**

```bash
pnpm --filter conductor test src/tracker/linear test/integration/tracker-timeout 2>&1 | tail -30
git add apps/conductor/src/tracker/linear/ apps/conductor/test/integration/tracker-timeout.test.ts
git commit -m "feat(conductor): Linear adapter populates priority/blockedBy/etc + 15s timeout"
```

---

## Task 8: GitHub tracker — populate 5 fields + 15s timeout

**Files:**
- Modify: `apps/conductor/src/tracker/github/queries.ts`
- Modify: `apps/conductor/src/tracker/github/client.ts` (15s AbortController.timeout)
- Modify: `apps/conductor/src/tracker/github/adapter.ts`
- Modify: `apps/conductor/test/integration/tracker-timeout.test.ts` (add GitHub describe)

- [ ] **Step 1: Extend GraphQL query**

In `github/queries.ts`, add to the `... on Issue` selection in the project-items query:

```graphql
... on Issue {
  id number title body createdAt
  assignees(first: 5) { nodes { login id } }
  # priority is *not* a native GitHub Issue field. Pull it from the Project Status field if present
  # OR leave as null. For Phase 6 parity with symphony: priority comes from a Single-select project field
  # named "Priority" with options "P1".."P4". If absent → null.
}
```

For priority, symphony parses the project-item `fieldValues` for a `ProjectV2ItemFieldSingleSelectValue` where `field.name === "Priority"`, then maps `"P1" → 1`, `"P2" → 2`, etc. Mirror that. If the field is absent, `priority` is `null`.

The query already pulls `fieldValues` for the Status field — extend the selection to include all single-select field values:

```graphql
fieldValues(first: 20) {
  nodes {
    ... on ProjectV2ItemFieldSingleSelectValue {
      name
      field { ... on ProjectV2SingleSelectField { name } }
    }
  }
}
```

- [ ] **Step 2: Wire 15s timeout into `githubQuery` / `githubMutation`**

Same pattern as Task 7 Step 2. Accept `timeoutMs` (default 15_000), wrap `fetch` with `AbortController` + `setTimeout`, return `tracker-timeout` Failure on AbortError.

- [ ] **Step 3: Populate adapter**

In `github/adapter.ts`, when assembling `Issue` from the GraphQL response:

```ts
const priorityFromFieldValues = (fieldValues: Array<{ name: string; field?: { name?: string } }> | undefined): 1 | 2 | 3 | 4 | null => {
  if (!fieldValues) return null;
  const p = fieldValues.find((v) => v.field?.name === "Priority");
  if (!p) return null;
  const match = /^P([1-4])$/.exec(p.name);
  return match ? (Number(match[1]) as 1 | 2 | 3 | 4) : null;
};

priority: priorityFromFieldValues(node.fieldValues?.nodes),
createdAt: node.createdAt ? new Date(node.createdAt) : null,
assigneeId: node.assignees?.nodes?.[0]?.login ?? null,
assignedToWorker: !meta.assigneeLogin
  ? true
  : (node.assignees?.nodes ?? []).some((a) => a.login === meta.assigneeLogin),
blockedBy: [], // GitHub Projects sub-issue / blocked-by API is beta; not ported in M3
```

- [ ] **Step 4: Extend valibot response schema**

Add to the GitHub Issue schema:
```ts
createdAt: v.optional(v.string()),
assignees: v.optional(v.object({
  nodes: v.array(v.object({ login: v.string(), id: v.optional(v.string()) })),
})),
fieldValues: v.optional(v.object({
  nodes: v.array(v.union([
    v.object({
      name: v.string(),
      field: v.optional(v.object({ name: v.optional(v.string()) })),
    }),
    v.unknown(),
  ])),
})),
```

Note: existing Status-field parsing should still work; just extend nodes union to be tolerant of multiple field types.

- [ ] **Step 5: Add tests + add GitHub describe block to tracker-timeout.test.ts**

```ts
describe("tracker timeout (GitHub)", () => {
  it("returns tracker-timeout Failure when fetch hangs past timeout", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() => new Promise(() => {}));
    try {
      const trackerR = await createGithubTracker({
        apiKey: "secret",
        endpoint: "https://api.github.com/graphql",
        projectOwner: "owner",
        projectNumber: 1,
        assignee: null,
        timeoutMs: 200,
      } as any);
      // warmup may hit the timeout — that itself counts as tracker-timeout
      if (trackerR.type === "Failure") {
        expect(trackerR.error.kind).toBe("tracker-timeout");
        return;
      }
      const r = await trackerR.value.fetchCandidateIssues();
      expect(r.type).toBe("Failure");
      if (r.type === "Failure") expect(r.error.kind).toBe("tracker-timeout");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
```

In-source tests for `priorityFromFieldValues` (5 cases: P1, P2, P3, P4, missing).

- [ ] **Step 6: Run + commit**

```bash
pnpm --filter conductor test src/tracker/github test/integration/tracker-timeout 2>&1 | tail -30
git add apps/conductor/src/tracker/github/ apps/conductor/test/integration/tracker-timeout.test.ts
git commit -m "feat(conductor): GitHub adapter populates priority/assignee/createdAt + 15s timeout"
```

---

## Task 9: file-logger.ts (pino + pino-roll + pino-pretty)

**Files:**
- Create: `apps/conductor/src/util/file-logger.ts`
- Create: `apps/conductor/test/integration/file-logger-rotation.test.ts`

- [ ] **Step 1: Create file-logger.ts**

```ts
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import pino, { type Logger as PinoLogger } from "pino";
// pino-roll types: import via default
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import type { Logger } from "../orchestrator/orchestrator.js";

export type FileLoggerOptions = Readonly<{
  path: string;            // absolute path required
  maxSizeMb: number;       // default 10
  maxFiles: number;        // default 5
  prettyStderr?: boolean;  // if true, also pipe to stderr via pino-pretty (CONDUCTOR_DEBUG=1)
}>;

export const createFileLogger = (opts: FileLoggerOptions): Logger => {
  if (!isAbsolute(opts.path)) {
    throw new Error(`file-logger path must be absolute: ${opts.path}`);
  }
  mkdirSync(dirname(opts.path), { recursive: true });

  const targets: object[] = [
    {
      target: "pino-roll",
      level: "trace",
      options: {
        file: opts.path,
        size: `${opts.maxSizeMb}m`,
        limit: { count: opts.maxFiles },
        mkdir: true,
      },
    },
  ];
  if (opts.prettyStderr) {
    targets.push({
      target: "pino-pretty",
      level: "info",
      options: { destination: 2, colorize: true, translateTime: "SYS:HH:MM:ss.l" },
    });
  }
  const pinoLogger: PinoLogger = pino({ level: "trace" }, pino.transport({ targets }));

  return {
    info: (msg: string) => pinoLogger.info(msg),
    warn: (msg: string) => pinoLogger.warn(msg),
    error: (err: unknown) => {
      if (err instanceof Error) {
        pinoLogger.error({ err: { name: err.name, message: err.message, stack: err.stack } }, err.message);
      } else if (typeof err === "object" && err !== null) {
        pinoLogger.error({ err }, "error object");
      } else {
        pinoLogger.error(String(err));
      }
    },
  };
};

if (import.meta.vitest) {
  const { describe, it, expect } = await import("vitest");
  const { tmpdir } = await import("node:os");
  const { mkdtemp, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const setTimeoutP = (ms: number) => new Promise((r) => setTimeout(r, ms));

  describe("util/file-logger", () => {
    it("rejects relative paths", () => {
      expect(() => createFileLogger({ path: "log/x.log", maxSizeMb: 10, maxFiles: 5 })).toThrow(/absolute/);
    });

    it("writes JSON lines containing msg + level", async () => {
      const dir = await mkdtemp(join(tmpdir(), "flog-"));
      const path = join(dir, "out.log");
      const log = createFileLogger({ path, maxSizeMb: 10, maxFiles: 5 });
      log.info("hello world");
      await setTimeoutP(150); // pino-roll flush
      const content = await readFile(path, "utf-8");
      expect(content).toMatch(/"msg":"hello world"/);
      expect(content).toMatch(/"level":30/); // pino level for info
    });
  });
}
```

- [ ] **Step 2: Run in-source tests**

```bash
pnpm --filter conductor test src/util/file-logger.ts 2>&1 | tail -20
```

Expected: 2 in-source tests pass.

- [ ] **Step 3: Create rotation integration test**

`apps/conductor/test/integration/file-logger-rotation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createFileLogger } from "../../src/util/file-logger.js";

const setTimeoutP = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("file-logger rotation", () => {
  it("rotates when file exceeds max_size_mb (using 1MB cap + chunked writes)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flog-rot-"));
    const path = join(dir, "rot.log");
    const log = createFileLogger({ path, maxSizeMb: 1, maxFiles: 3 });

    // Write enough content to cross the 1MB rotation boundary at least once.
    const big = "x".repeat(900); // ~1KB per pino line incl. JSON overhead
    for (let i = 0; i < 1300; i += 1) log.info(big);
    await setTimeoutP(500); // pino-roll flush + rotate

    const entries = await readdir(dir);
    // Expect a current file plus at least one rotated sibling (e.g. rot.log.1)
    const rotated = entries.filter((f) => f.startsWith("rot.log"));
    expect(rotated.length).toBeGreaterThanOrEqual(2);
    expect(rotated.length).toBeLessThanOrEqual(4);
  });
});
```

- [ ] **Step 4: Run integration test (may take ~1s)**

```bash
pnpm --filter conductor test test/integration/file-logger-rotation 2>&1 | tail -10
```

If the test is flaky (timing-dependent), bump the sleep to 1000ms.

- [ ] **Step 5: Commit**

```bash
git add apps/conductor/src/util/file-logger.ts apps/conductor/test/integration/file-logger-rotation.test.ts
git commit -m "feat(conductor): add pino+pino-roll file logger with size-based rotation"
```

---

## Task 10: logger.ts dispatch + CLI wiring

**Files:**
- Modify: `apps/conductor/src/util/logger.ts`
- Modify: `apps/conductor/src/cli/run.ts`

- [ ] **Step 1: Re-export createFileLogger + add a `selectLogger` factory**

In `util/logger.ts`:

```ts
import { createFileLogger as createFileLoggerImpl, type FileLoggerOptions } from "./file-logger.js";

export const createFileLogger = createFileLoggerImpl;

export type SelectLoggerInput = Readonly<{
  dashboardOn: boolean;         // observability.dashboardEnabled && TTY && !--no-dashboard && !CONDUCTOR_DEBUG
  debugEnv: boolean;            // CONDUCTOR_DEBUG=1
  fileLoggerOptions: FileLoggerOptions | null; // null → no file logger configured
}>;

export const selectLogger = (input: SelectLoggerInput): Logger => {
  if (input.dashboardOn && input.fileLoggerOptions) {
    return createFileLoggerImpl(input.fileLoggerOptions);
  }
  if (input.dashboardOn) {
    // Dashboard ON without file logger configured: silent stderr to avoid breaking the TUI.
    return createNoopLogger();
  }
  if (input.debugEnv && input.fileLoggerOptions) {
    return createFileLoggerImpl({ ...input.fileLoggerOptions, prettyStderr: true });
  }
  return createStdLogger();
};
```

- [ ] **Step 2: Wire selectLogger into cli/run.ts**

Find the existing logger creation in `cli/run.ts` (likely a `createStdLogger()` call near dashboard setup). Replace with `selectLogger({...})` and read `logging.file` from the parsed WorkflowConfig (added in Task 11).

For Task 10 itself, gate the wiring behind a feature flag if `logging` is not yet in the config — but since this task ships *after* Task 11, the field is available.

- [ ] **Step 3: Add in-source tests for selectLogger**

```ts
it("selectLogger: dashboard ON + file options → file logger", () => {
  const log = selectLogger({
    dashboardOn: true, debugEnv: false,
    fileLoggerOptions: { path: "/tmp/x.log", maxSizeMb: 1, maxFiles: 2 },
  });
  expect(typeof log.info).toBe("function");
});

it("selectLogger: dashboard ON + no file options → noop", () => {
  const log = selectLogger({
    dashboardOn: true, debugEnv: false, fileLoggerOptions: null,
  });
  log.info("dropped");
  // noop logger has no observable side effect — just type-check pass.
  expect(typeof log.info).toBe("function");
});

it("selectLogger: dashboard OFF → std logger (stderr)", () => {
  const log = selectLogger({
    dashboardOn: false, debugEnv: false, fileLoggerOptions: null,
  });
  expect(typeof log.info).toBe("function");
});
```

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter conductor test src/util 2>&1 | tail -10
git add apps/conductor/src/util/logger.ts apps/conductor/src/cli/run.ts
git commit -m "feat(conductor): logger dispatch (std/noop/file) + selectLogger factory"
```

---

