# M3 Phase 6 Implementation Plan — Part 3: Wiring & finalization (Tasks 20-21)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Overview:** [`2026-05-17-m3-phase6.md`](2026-05-17-m3-phase6.md) (header / pre-flight / file structure / table of contents)
**Spec:** [`docs/superpowers/specs/2026-05-17-m3-phase6-design.md`](../specs/2026-05-17-m3-phase6-design.md)
**Branch:** `feat/m3-phase6`
**Prerequisites:**
- [Part 1 — Foundations](2026-05-17-m3-phase6-part1-foundations.md) complete (Tasks 1-10 ✅)
- [Part 2 — Engine](2026-05-17-m3-phase6-part2-engine.md) complete (Tasks 11-19 ✅)

**Scope of Part 3:** swap the sequential `for` loop in `orchestrator.ts` for the new Scheduler, and update docs.

- Task 20: `orchestrator.ts` delegates to `runScheduler`; existing in-source tests get watchdog aborts + new config defaults
- Task 21: doc sweep — `apps/conductor/CLAUDE.md` Phase 6 status section, `TODO.md` flip Phase 6 boxes to `- [x]`, optional E2E green check, optional PR open

---

## Task 20: Orchestrator rewrite — delegate to Scheduler

**Files:**
- Modify: `apps/conductor/src/orchestrator/orchestrator.ts`

- [ ] **Step 1: Replace the `for` loop with `runScheduler`**

Replace the body of `runOrchestrator` with:

```ts
export const runOrchestrator = async (
  input: RunOrchestratorInput,
): Promise<Result.Result<RunSummary, OrchestratorError>> => {
  const { runScheduler } = await import("./scheduler.js");
  try {
    const summary = await runScheduler({
      tracker: input.tracker,
      backend: input.backend,
      config: input.config,
      logger: input.logger,
      signal: input.signal,
      ...(input.hooks ? { hooks: input.hooks } : {}),
    });
    return { type: "Success", value: summary };
  } catch (err) {
    return { type: "Failure", error: { kind: "backend", error: { kind: "unexpected", message: String(err) } } as any };
  }
};
```

- [ ] **Step 2: Update existing in-source tests**

The existing in-source tests inside `orchestrator.ts` (lines 104-208) used the synchronous `for` loop. The Scheduler semantics still pass them as-is IF the dispatch + reconcile cycle stabilises within one tick — but they may need a polling.intervalMs override and a watchdog abort to terminate cleanly.

Update each existing test's `config` literal to include `polling: { intervalMs: 50 }` and `logging: null` (and the new agent fields), and surround the `await runOrchestrator(...)` with a watchdog abort:

```ts
const ctrl = new AbortController();
setTimeout(() => ctrl.abort(), 2000);
const res = await runOrchestrator({ /* ... */ signal: ctrl.signal });
```

- [ ] **Step 3: Run full conductor test suite**

```bash
pnpm --filter conductor test 2>&1 | tail -30
```

Fix any failing tests by updating the config literals.

- [ ] **Step 4: Run E2E mock-memory test**

```bash
pnpm --filter conductor test test/e2e/conductor-cli 2>&1 | tail -10
```

Expected: still green. If the mock-memory CLI run hangs, increase the watchdog abort.

- [ ] **Step 5: Commit**

```bash
git add apps/conductor/src/orchestrator/orchestrator.ts
git commit -m "refactor(conductor): orchestrator delegates to Scheduler (Phase 6 wiring)"
```

---

## Task 21: Doc sweep + final E2E + Phase 6 status notes

**Files:**
- Modify: `apps/conductor/CLAUDE.md`
- Modify: `TODO.md`
- Modify: `apps/conductor/examples/workflow.mock-memory.md` (optional: add `polling:` / `logging:` examples)
- Modify: `apps/conductor/examples/workflow.claude-linear.md` / `.claude-github.md` (add `max_concurrent_agents_by_state: { "In Progress": 2 }` reference)

- [ ] **Step 1: Run the full test matrix locally**

```bash
pnpm --filter conductor test 2>&1 | tail -10
pnpm --filter conductor build 2>&1 | tail -5
pnpm --filter conductor lint 2>&1 | tail -5 || true
```

Expected: all green (or lint warnings only).

- [ ] **Step 2: Run E2E (real backends) if credentials available**

```bash
pnpm test:e2e:claude-linear 2>&1 | tail -20
pnpm test:e2e:claude-github 2>&1 | tail -20
```

If credentials are not available in this shell, document the skip in the PR description.

- [ ] **Step 3: Update `apps/conductor/CLAUDE.md` — append a "Phase 6 status" section**

After the existing "Phase 5 status" section, append:

```markdown
---

## Phase 6 status (this branch)

- Scheduler (`src/orchestrator/scheduler.ts`) replaces the sequential `for` loop in `orchestrator.ts`. Owns `running` Map, `claimed` Set, `retryAttempts` Map, and a `p-queue` (concurrency = `agent.max_concurrent_agents`). Tick interval = `polling.interval_ms` (default 5_000)
- **Retry policy** (symphony verbatim): continuation_retry 1s on normal exit; failure_retry `10s × 2^min(attempt-1, 10)` capped at `agent.max_retry_backoff_ms` (default 300_000)
- **Stall detection**: `agent.agent_session_stall_timeout_ms` (default 1_800_000 = 30 min). Stalled runners get a failure_retry restart
- **dispatch-filter** is pure: sort by priority (1-4, else 5) → createdAt asc → identifier; skips assigned_to_worker=false, blocker-non-terminal Todo, per-state limit exhausted
- **Issue domain extended** with `priority` (1-4 | null), `createdAt` (Date | null), `assigneeId` (string | null), `assignedToWorker` (bool, default true), `blockedBy` (BlockedByRef[]). Linear / GitHub / Memory adapters all populate the 5 fields. GitHub blocked_by stays `[]` (sub-issue API not in scope)
- **Tracker API timeout**: 15_000ms via `AbortController.timeout`. New `tracker-timeout` TrackerError surfaces to scheduler's failure_retry
- **Backend session** now exposes `exitPromise: Promise<{code, signal}>`. AgentRunner races `runTurn` against `exitPromise` so subprocess crashes mid-turn become `session-exited-mid-turn` Failures
- **File logger**: pino + pino-roll + pino-pretty. JSON output to `logging.file.path` (absolute path required, default `process.cwd()/log/conductor.log`), size-based wrap rotation (`max_size_mb: 10`, `max_files: 5`). `CONDUCTOR_DEBUG=1` adds pino-pretty stderr
- **Mock backend**: new optional `exit_mid_turn: true` (test-only) — README does NOT advertise
- AbortController-based shutdown: outer `signal` cancels everything. Per-issue AbortController is *not* introduced in Phase 6 (a follow-up for M4+); during reconcile-driven termination, the dispatch slot frees up and the AgentRunner exits naturally on its next turn
```

- [ ] **Step 4: Mark TODO.md Phase 6 boxes done**

In `TODO.md` Milestone 3 / Phase 6 section, flip every `- [ ]` to `- [x]`. Leave Phase 7 untouched.

- [ ] **Step 5: Commit doc sweep**

```bash
git add apps/conductor/CLAUDE.md TODO.md apps/conductor/examples/
git commit -m "docs(conductor): mark M3 Phase 6 complete (scheduler + retry + edge cases parity)"
```

- [ ] **Step 6: Push branch + open PR (optional, user decides)**

```bash
git push -u origin feat/m3-phase6
gh pr create --title "feat(conductor): M3 Phase 6 (parallel scheduler + retry + edge cases parity)" \
  --body "$(cat <<'EOF'
## Summary
- Port symphony's GenServer-based orchestrator (1,826 LoC) to a TS Scheduler using p-queue + p-retry
- continuation_retry (1s) + failure_retry (10s × 2^attempt, 5min cap) — symphony verbatim
- stall detection (30 min default) with failure_retry restart
- Issue domain extended: priority / createdAt / assigneeId / assignedToWorker / blockedBy
- Tracker API 15s timeout (AbortController.timeout)
- Backend session exitPromise + runTurn races 3 sources (turn/completed, exit, abort)
- pino + pino-roll + pino-pretty file logger

## Test plan
- [x] `pnpm --filter conductor test` green
- [x] `pnpm test:e2e:claude-linear` green (if credentials available)
- [x] `pnpm test:e2e:claude-github` green (if credentials available)
- [x] Manual: `pnpm dev:install` + `conductor examples/workflow.mock-memory.md` runs to completion

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

This step is optional — the user may want to inspect the branch locally first.

---

## Self-review checklist (for the implementer, not the plan author)

Before claiming Phase 6 done:

- [ ] `apps/conductor/CLAUDE.md` Phase 6 status accurately describes what shipped
- [ ] `TODO.md` Phase 6 all `- [x]`
- [ ] No `as any` casts left in scheduler.ts (target zero; minimal escape hatches OK)
- [ ] Every new file has at least one passing test (in-source or integration)
- [ ] `pnpm --filter conductor test 2>&1 | tail -5` reports 0 failures
- [ ] `pnpm --filter conductor build 2>&1 | tail -5` reports 0 errors
- [ ] Branch is `feat/m3-phase6`, commits are scoped (`feat(conductor):` / `docs(conductor):` etc.)
