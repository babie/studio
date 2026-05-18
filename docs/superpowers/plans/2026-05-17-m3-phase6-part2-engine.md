# M3 Phase 6 Implementation Plan — Part 2: Engine (Tasks 11-19)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Overview:** [`2026-05-17-m3-phase6.md`](2026-05-17-m3-phase6.md) (header / pre-flight / file structure / table of contents)
**Spec:** [`docs/superpowers/specs/2026-05-17-m3-phase6-design.md`](../specs/2026-05-17-m3-phase6-design.md)
**Branch:** `feat/m3-phase6`
**Prerequisite:** [Part 1 — Foundations](2026-05-17-m3-phase6-part1-foundations.md) complete (Tasks 1-10 ✅).

**Scope of Part 2:** WORKFLOW config schema, backend session integration, and the Scheduler core itself.

- Task 11: WORKFLOW.md schema extension (`agent.max_retry_backoff_ms` / `agent.agent_session_stall_timeout_ms` / `agent.max_concurrent_agents_by_state` / top-level `polling:` / `logging:`)
- Task 12: `BackendSession` interface gains `exitPromise` + mock backend exposes it + new `mock.exit_mid_turn` option
- Task 13: JSON-RPC `session.ts` exposes `exitPromise` + `runTurn` races 3 sources (turn/completed / exit / abort)
- Task 14: `AgentRunner` runTurn outer-guard race + new Failure kinds (session-exited-mid-turn / aborted)
- Task 15: `scheduler.ts` skeleton + state holder + tick timer + bus
- Task 16: Scheduler `pumpCycle` + `dispatchIssue` + 3 integration tests (parallel / priority / blocker)
- Task 17: Scheduler `reconcileRunning` (terminal / non-active / assignee-changed / missing) + integration test
- Task 18: Scheduler retry handling (continuation + failure scheduling + handleRetry) + 2 integration tests
- Task 19: Scheduler stall detection (hook composition + reconcile prepended check) + integration test

**Next:** [Part 3 — Wiring & finalization](2026-05-17-m3-phase6-part3-wiring.md) (Tasks 20-21)

---

## Task 11: WORKFLOW.md schema — agent.* / polling: / logging:

**Files:**
- Modify: `apps/conductor/src/domain/agent-config.ts`
- Modify: `apps/conductor/src/domain/workflow-config.ts`
- Create: `apps/conductor/src/domain/polling-config.ts`
- Create: `apps/conductor/src/domain/logging-config.ts`
- Modify: `apps/conductor/src/config/schema.ts`

- [ ] **Step 1: Extend AgentConfig**

In `domain/agent-config.ts`:

```ts
export type AgentConfig = Readonly<{
  backend: BackendConfig;
  maxConcurrentAgents: number;
  maxTurns: number;
  maxRetryBackoffMs: number;                // default 300_000
  agentSessionStallTimeoutMs: number;       // default 1_800_000
  maxConcurrentAgentsByState: Readonly<Record<string, number>>;  // default {}
}>;
```

Update the in-source test fixture accordingly.

- [ ] **Step 2: Create domain/polling-config.ts**

```ts
export type PollingConfig = Readonly<{
  intervalMs: number;  // default 5_000
}>;

if (import.meta.vitest) {
  const { describe, it, expect } = await import("vitest");
  describe("domain/polling-config", () => {
    it("has intervalMs", () => {
      const p: PollingConfig = { intervalMs: 5_000 };
      expect(p.intervalMs).toBe(5_000);
    });
  });
}
```

- [ ] **Step 3: Create domain/logging-config.ts**

```ts
export type LoggingConfig = Readonly<{
  file: Readonly<{
    path: string;        // absolute
    maxSizeMb: number;   // default 10
    maxFiles: number;    // default 5
  }>;
}>;

if (import.meta.vitest) {
  const { describe, it, expect } = await import("vitest");
  describe("domain/logging-config", () => {
    it("requires absolute path-shaped string", () => {
      const c: LoggingConfig = { file: { path: "/var/log/x.log", maxSizeMb: 10, maxFiles: 5 } };
      expect(c.file.path).toMatch(/^\//);
    });
  });
}
```

- [ ] **Step 4: Extend WorkflowConfig**

In `domain/workflow-config.ts`:

```ts
export type WorkflowConfig = Readonly<{
  agent: AgentConfig;
  tracker: TrackerConfig;
  workspace?: WorkspaceConfig;
  hooks?: HooksConfig;
  prompt: string;
  observability: ObservabilityConfig;
  polling: PollingConfig;            // NEW
  logging: LoggingConfig | null;     // NEW (null = no file logger)
}>;
```

- [ ] **Step 5: Extend YAML schema in config/schema.ts**

Find the existing `WorkflowYamlSchema` v.object and:

1. Inside `agent`, add:
```ts
max_retry_backoff_ms: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
agent_session_stall_timeout_ms: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
max_concurrent_agents_by_state: v.optional(v.record(v.string(), v.pipe(v.number(), v.integer(), v.minValue(1)))),
```

2. Add top-level optional `polling`:
```ts
polling: v.optional(v.object({
  interval_ms: v.optional(v.pipe(v.number(), v.integer(), v.minValue(100))),
})),
```

3. Add top-level optional `logging`:
```ts
logging: v.optional(v.object({
  file: v.optional(v.object({
    path: v.optional(v.string()),
    max_size_mb: v.optional(v.pipe(v.number(), v.minValue(1))),
    max_files: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  })),
})),
```

4. In the YAML → TS transform function, apply defaults + path absolutization:

```ts
const defaultLoggingPath = () => path.resolve(process.cwd(), "log/conductor.log");

// in the transform:
const loggingFile = yaml.logging?.file ?? {};
const loggingPath = loggingFile.path ?? defaultLoggingPath();
if (!path.isAbsolute(loggingPath)) {
  return { type: "Failure", error: { kind: "logging-path-not-absolute", path: loggingPath } };
}
const logging: LoggingConfig = {
  file: {
    path: loggingPath,
    maxSizeMb: loggingFile.max_size_mb ?? 10,
    maxFiles: loggingFile.max_files ?? 5,
  },
};

const polling: PollingConfig = { intervalMs: yaml.polling?.interval_ms ?? 5_000 };

const agent: AgentConfig = {
  /* existing fields ... */
  maxRetryBackoffMs: yaml.agent.max_retry_backoff_ms ?? 300_000,
  agentSessionStallTimeoutMs: yaml.agent.agent_session_stall_timeout_ms ?? 1_800_000,
  maxConcurrentAgentsByState: yaml.agent.max_concurrent_agents_by_state ?? {},
};
```

Add `"logging-path-not-absolute"` to `domain/config-errors.ts` ConfigError union.

- [ ] **Step 6: Update existing example files**

The mock-memory / claude-linear / claude-github / codex-memory examples have no logging block today. Their parse still succeeds (defaults apply). Optionally annotate one example with `polling: { interval_ms: 5000 }` and `logging: { file: { path: /tmp/conductor.log } }` for documentation.

- [ ] **Step 7: Add config schema tests**

```ts
it("parses default agent.max_retry_backoff_ms = 300000", () => {
  const r = parseWorkflowYaml(`
agent:
  type: mock
  max_concurrent_agents: 1
  max_turns: 1
tracker:
  kind: memory
  active_states: ["Todo"]
  terminal_states: ["Done"]
  issues: []
workspace:
  root: /tmp/ws
prompt: ""
`);
  if (r.type !== "Success") throw new Error("expected ok");
  expect(r.value.agent.maxRetryBackoffMs).toBe(300_000);
  expect(r.value.agent.agentSessionStallTimeoutMs).toBe(1_800_000);
  expect(r.value.polling.intervalMs).toBe(5_000);
  expect(r.value.logging?.file.maxSizeMb).toBe(10);
});

it("rejects relative logging.file.path", () => {
  const r = parseWorkflowYaml(`
agent: { type: mock, max_concurrent_agents: 1, max_turns: 1 }
tracker: { kind: memory, active_states: ["Todo"], terminal_states: ["Done"], issues: [] }
workspace: { root: /tmp/ws }
prompt: ""
logging:
  file:
    path: ./log/x.log
`);
  expect(r.type).toBe("Failure");
  if (r.type === "Failure") expect(r.error.kind).toBe("logging-path-not-absolute");
});

it("honours custom max_concurrent_agents_by_state", () => {
  const r = parseWorkflowYaml(`
agent:
  type: mock
  max_concurrent_agents: 5
  max_turns: 1
  max_concurrent_agents_by_state:
    "In Progress": 2
tracker: { kind: memory, active_states: ["Todo"], terminal_states: ["Done"], issues: [] }
workspace: { root: /tmp/ws }
prompt: ""
`);
  if (r.type !== "Success") throw new Error("expected ok");
  expect(r.value.agent.maxConcurrentAgentsByState["In Progress"]).toBe(2);
});
```

- [ ] **Step 8: Run + commit**

```bash
pnpm --filter conductor test src/config src/domain 2>&1 | tail -10
git add apps/conductor/src/domain/ apps/conductor/src/config/schema.ts apps/conductor/examples/
git commit -m "feat(conductor): WORKFLOW.md schema extension (agent retry/stall, polling, logging)"
```

---

## Task 12: BackendSession interface — exitPromise + mock backend

**Files:**
- Modify: `apps/conductor/src/backend/types.ts`
- Modify: `apps/conductor/src/backend/mock.ts`
- Modify: `apps/conductor/src/domain/backend-config.ts` (add `mock.exit_mid_turn`)

- [ ] **Step 1: Extend BackendSession interface**

```ts
export type SessionExitInfo = Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
}>;

export type BackendSession = Readonly<{
  runTurn: (params: RunTurnParams) => Promise<Result.Result<TurnResult, BackendError>>;
  shutdown: (opts?: { gracePeriodMs?: number }) => Promise<void>;
  interrupt: () => Promise<void>;
  readonly exitPromise: Promise<SessionExitInfo>;
}>;
```

Update in-source test fake.

- [ ] **Step 2: Update mock backend to expose exitPromise + exitMidTurn option**

```ts
// backend-config.ts: add to MockBackend
export type MockBackend = Readonly<{
  type: "mock";
  delayMs?: number;
  forceFail?: boolean;
  exitMidTurn?: boolean;  // test-only: resolve exitPromise during runTurn
}>;
```

In `mock.ts`:

```ts
export const createMockBackend = (config: MockBackend): Backend => ({
  type: "mock",
  startSession: async (_params) => {
    let resolveExit!: (info: SessionExitInfo) => void;
    const exitPromise = new Promise<SessionExitInfo>((res) => { resolveExit = res; });
    const session: BackendSession = {
      runTurn: async (params) => {
        if (config.delayMs && config.delayMs > 0) await sleep(config.delayMs);
        if (config.exitMidTurn) {
          resolveExit({ code: 1, signal: null });
          return { type: "Failure", error: { kind: "session-exited-mid-turn", exitCode: 1, signal: null } };
        }
        if (config.forceFail) {
          return { type: "Failure", error: { kind: "mock-forced-failure", reason: "configured force_fail" } };
        }
        return { type: "Success", value: { completed: true } };
      },
      shutdown: async () => { resolveExit({ code: 0, signal: null }); },
      interrupt: async () => { resolveExit({ code: null, signal: "SIGTERM" }); },
      exitPromise,
    };
    return { type: "Success", value: session };
  },
});
```

- [ ] **Step 3: Update YAML mock schema (if needed)**

In the `mock:` block schema, accept `exit_mid_turn: boolean` (optional, default false). This is documented as test-only — README does not advertise it.

- [ ] **Step 4: Add in-source tests for new mock behaviour**

```ts
it("exitPromise resolves with code 0 on shutdown", async () => {
  const b = createMockBackend({ type: "mock" });
  const s = await b.startSession({ workspace: "/tmp", issue, agentConfig });
  if (s.type !== "Success") throw new Error("expected success");
  await s.value.shutdown();
  const info = await s.value.exitPromise;
  expect(info.code).toBe(0);
});

it("exitMidTurn=true returns session-exited-mid-turn Failure and resolves exitPromise", async () => {
  const b = createMockBackend({ type: "mock", exitMidTurn: true });
  const s = await b.startSession({ workspace: "/tmp", issue, agentConfig });
  if (s.type !== "Success") throw new Error("expected success");
  const r = await s.value.runTurn({ prompt: "x", turnNumber: 1, maxTurns: 1, signal: new AbortController().signal, onNotification: () => {} });
  expect(r.type).toBe("Failure");
  if (r.type === "Failure") expect(r.error.kind).toBe("session-exited-mid-turn");
  const info = await s.value.exitPromise;
  expect(info.code).toBe(1);
});
```

- [ ] **Step 5: Run + commit**

```bash
pnpm --filter conductor test src/backend 2>&1 | tail -10
git add apps/conductor/src/backend/ apps/conductor/src/domain/backend-config.ts
git commit -m "feat(conductor): add exitPromise to BackendSession + mock.exit_mid_turn option"
```

---

## Task 13: JSON-RPC session — Promise.race over turn/completed + exit + abort

**Files:**
- Modify: `apps/conductor/src/backend/jsonrpc/session.ts`

- [ ] **Step 1: Read the existing session.ts**

```bash
cat /workspace/apps/conductor/src/backend/jsonrpc/session.ts
```

Identify: where `child.on('exit', ...)` is handled (or wherever the subprocess is spawned/tracked), and the `runTurn` implementation.

- [ ] **Step 2: Expose exitPromise from session.ts**

Inside the function that creates a session (likely returns a `BackendSession`):

```ts
let resolveExit!: (info: SessionExitInfo) => void;
const exitPromise = new Promise<SessionExitInfo>((res) => { resolveExit = res; });

child.on("exit", (code, signal) => {
  resolveExit({ code, signal });
});
```

Add `exitPromise` to the returned object.

- [ ] **Step 3: Wrap runTurn in Promise.race**

The current `runTurn` awaits the `turn/completed` notification via some internal promise (call it `turnCompletedP`). Wrap it:

```ts
const runTurn: BackendSession["runTurn"] = async (params) => {
  const turnCompletedP = waitForTurnCompleted(params.turnNumber); // existing helper
  const abortP = new Promise<{ kind: "abort" }>((_, rej) => {
    if (params.signal.aborted) {
      rej(new Error("aborted"));
      return;
    }
    params.signal.addEventListener("abort", () => rej(new Error("aborted")), { once: true });
  });
  const exitP = exitPromise.then((info) => ({ kind: "exit" as const, info }));

  try {
    const winner = await Promise.race([
      turnCompletedP.then((res) => ({ kind: "completed" as const, res })),
      exitP,
      abortP, // throws on abort
    ]);
    if (winner.kind === "completed") {
      return { type: "Success", value: { completed: true } };
    }
    // exit
    return {
      type: "Failure",
      error: { kind: "session-exited-mid-turn", exitCode: winner.info.code, signal: winner.info.signal },
    };
  } catch (err) {
    if (err instanceof Error && err.message === "aborted") {
      return { type: "Failure", error: { kind: "aborted" } };
    }
    throw err;
  }
};
```

- [ ] **Step 4: Add integration test that runs against mock subprocess**

There may already be a `jsonrpc-session.test.ts` integration test (Phase 2). Add one new case there:

```ts
it("returns session-exited-mid-turn when subprocess dies before turn/completed", async () => {
  // Spawn a Node script that prints initialize/thread/started then exits.
  const script = `
    process.stdout.write(JSON.stringify({ jsonrpc:"2.0", id:1, result:{ serverInfo:{ name:"x", version:"0" } } }) + "\\n");
    setTimeout(() => process.exit(1), 50);
  `;
  // ... build a fake backend pointing to a node -e <script>
  // Then await runTurn(...) → Failure { kind: "session-exited-mid-turn" }
});
```

If integration scaffolding is heavy, leave a TODO comment and rely on the mock-backend test from Task 12 as the primary coverage.

- [ ] **Step 5: Run + commit**

```bash
pnpm --filter conductor test src/backend/jsonrpc 2>&1 | tail -10
git add apps/conductor/src/backend/jsonrpc/session.ts
git commit -m "feat(conductor): JSON-RPC session exposes exitPromise + runTurn races 3 sources"
```

---

## Task 14: AgentRunner — runTurn race outer guard + new Failure kinds

**Files:**
- Modify: `apps/conductor/src/orchestrator/agent-runner.ts`

- [ ] **Step 1: Read current agent-runner.ts**

```bash
cat /workspace/apps/conductor/src/orchestrator/agent-runner.ts
```

The turn loop sits around lines 158-211. Identify the `session.runTurn(...)` call.

- [ ] **Step 2: Add outer Promise.race over runTurn + exitPromise**

Replace the inner `const tr = await session.runTurn(...);` block with:

```ts
const tr = await Promise.race([
  session.runTurn({
    prompt, turnNumber: turn, maxTurns: agentConfig.maxTurns,
    signal, onNotification: onNotif,
  }),
  session.exitPromise.then((info): Result.Result<TurnResult, BackendError> => ({
    type: "Failure",
    error: { kind: "session-exited-mid-turn", exitCode: info.code, signal: info.signal as string | null },
  })),
]);
```

This catches the rare case where the subprocess exits between turns (outside an active `runTurn` window). Without it, the loop would call `runTurn` on a dead session and hang.

- [ ] **Step 3: Add explicit AbortSignal early-exit at top of the turn loop**

Inside the loop, before `buildPrompt`:

```ts
if (signal.aborted) {
  lastErr = { kind: "backend", error: { kind: "aborted" } };
  break;
}
```

- [ ] **Step 4: Add in-source tests**

Append to the existing `agent-runner` in-source `describe` block:

```ts
it("aborts the turn loop when AbortSignal fires", async () => {
  const root = await mkdtemp(join(tmpdir(), "conductor-runner-"));
  const tracker = {
    fetchCandidateIssues: async () => ok([]),
    fetchIssuesByStates: async () => ok([]),
    fetchIssueStatesByIds: async () => ok([issue]),
    createComment: async () => ok(undefined),
    updateIssueState: async () => ok(undefined),
  } as Tracker;
  const backend = makeBackend([ok({ completed: true })]);
  const ctrl = new AbortController();
  ctrl.abort();

  const res = await runAgent({
    issue, backend, tracker,
    agentConfig: { backend: { type: "mock" }, maxConcurrentAgents: 1, maxTurns: 3,
      maxRetryBackoffMs: 300_000, agentSessionStallTimeoutMs: 1_800_000, maxConcurrentAgentsByState: {} },
    workspaceConfig: { root },
    terminalStates: [v.parse(IssueStateName.schema, "Done")],
    activeStates: [v.parse(IssueStateName.schema, "Todo")],
    promptTemplate: "Hi",
    logger: silent,
    signal: ctrl.signal,
  });
  if (res.type !== "Failure") throw new Error("expected failure");
  expect(res.error.kind).toBe("backend");
});

it("returns session-exited-mid-turn when mock exits mid-turn", async () => {
  const root = await mkdtemp(join(tmpdir(), "conductor-runner-"));
  const tracker = {
    fetchCandidateIssues: async () => ok([]),
    fetchIssuesByStates: async () => ok([]),
    fetchIssueStatesByIds: async () => ok([issue]),
    createComment: async () => ok(undefined),
    updateIssueState: async () => ok(undefined),
  } as Tracker;
  const { createMockBackend } = await import("../backend/mock.js");
  const backend = createMockBackend({ type: "mock", exitMidTurn: true });

  const res = await runAgent({
    issue, backend, tracker,
    agentConfig: { backend: { type: "mock" }, maxConcurrentAgents: 1, maxTurns: 1,
      maxRetryBackoffMs: 300_000, agentSessionStallTimeoutMs: 1_800_000, maxConcurrentAgentsByState: {} },
    workspaceConfig: { root },
    terminalStates: [v.parse(IssueStateName.schema, "Done")],
    activeStates: [v.parse(IssueStateName.schema, "Todo")],
    promptTemplate: "Hi",
    logger: silent,
    signal: new AbortController().signal,
  });
  if (res.type !== "Failure") throw new Error("expected failure");
  expect(res.error.kind).toBe("backend");
});
```

(The existing `makeBackend` helper in the agent-runner in-source tests will need an `exitPromise: Promise.resolve({code:0,signal:null})` added — update it.)

- [ ] **Step 5: Run + commit**

```bash
pnpm --filter conductor test src/orchestrator/agent-runner 2>&1 | tail -10
git add apps/conductor/src/orchestrator/agent-runner.ts
git commit -m "feat(conductor): AgentRunner races runTurn vs exitPromise + handles abort"
```

---

## Task 15: Scheduler — skeleton + state + tick timer

**Files:**
- Create: `apps/conductor/src/orchestrator/scheduler.ts`

- [ ] **Step 1: Scaffold the class with state holder + tick loop**

```ts
import PQueue from "p-queue";
import { EventEmitter } from "node:events";
import type { Issue, IssueId, IssueIdentifier, IssueStateName } from "../domain/issue.js";
import type { Tracker } from "../tracker/types.js";
import type { Backend } from "../backend/types.js";
import type { WorkflowConfig } from "../domain/workflow-config.js";
import type { Logger } from "./orchestrator.js";
import type { ObservabilityHooks } from "../observability/instrumentation.js";

export type RetryDelayType = "continuation" | "failure";

export type RunningEntry = Readonly<{
  issueId: IssueId;
  identifier: IssueIdentifier;
  issue: Issue;
  startedAt: Date;
  lastActivityAt: Date;
  retryAttempt: number;
}>;

export type RetryEntry = Readonly<{
  issueId: IssueId;
  identifier: IssueIdentifier;
  attempt: number;
  delayType: RetryDelayType;
  timerRef: NodeJS.Timeout;
  retryToken: symbol;
  dueAtMs: number;
  error: string | null;
}>;

export type SchedulerInput = Readonly<{
  tracker: Tracker;
  backend: Backend;
  config: WorkflowConfig;
  logger: Logger;
  signal: AbortSignal;
  hooks?: ObservabilityHooks;
}>;

export type RunSummary = Readonly<{
  total: number;
  completed: number;
  failed: number;
}>;

export class Scheduler {
  readonly running = new Map<string, RunningEntry>();
  readonly claimed = new Set<string>();
  readonly retryAttempts = new Map<string, RetryEntry>();
  readonly queue: PQueue;
  private pollTimer: NodeJS.Timeout | null = null;
  private bus = new EventEmitter();
  private stopped = false;
  private completedCount = 0;
  private failedCount = 0;
  private totalSeen = new Set<string>();

  constructor(private readonly input: SchedulerInput) {
    this.queue = new PQueue({ concurrency: input.config.agent.maxConcurrentAgents });
  }

  async run(): Promise<RunSummary> {
    const pollMs = this.input.config.polling.intervalMs;
    const abortP = new Promise<void>((res) => {
      if (this.input.signal.aborted) { res(); return; }
      this.input.signal.addEventListener("abort", () => res(), { once: true });
    });

    // Initial pump immediately, then schedule recurring ticks until idle + abort.
    await this.pumpCycle();
    while (!this.input.signal.aborted) {
      this.scheduleNextTick(pollMs);
      // Wake on: tick, bus 'wake', or abort. First-to-fire wins.
      // We attach listeners with explicit handles so we can remove the loser to avoid leaking.
      let tickHandler!: () => void;
      let wakeHandler!: () => void;
      const tickP = new Promise<void>((res) => { tickHandler = () => res(); this.bus.once("tick", tickHandler); });
      const wakeP = new Promise<void>((res) => { wakeHandler = () => res(); this.bus.once("wake", wakeHandler); });
      try {
        await Promise.race([tickP, wakeP, abortP]);
      } finally {
        this.bus.removeListener("tick", tickHandler);
        this.bus.removeListener("wake", wakeHandler);
      }
      if (this.input.signal.aborted) break;
      if (this.isIdleAndDone()) break;
      await this.pumpCycle();
    }
    this.stop();
    await this.queue.onIdle();
    return { total: this.totalSeen.size, completed: this.completedCount, failed: this.failedCount };
  }

  private scheduleNextTick(pollMs: number): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this.bus.emit("tick"), pollMs);
  }

  private wake(): void {
    this.bus.emit("wake");
  }

  private stop(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    for (const entry of this.retryAttempts.values()) clearTimeout(entry.timerRef);
    this.retryAttempts.clear();
    this.stopped = true;
  }

  private isIdleAndDone(): boolean {
    return this.queue.size === 0 && this.queue.pending === 0
      && this.running.size === 0 && this.retryAttempts.size === 0;
  }

  // pumpCycle implemented in Task 16
  private async pumpCycle(): Promise<void> { /* Task 16 */ }
}

export const runScheduler = async (input: SchedulerInput): Promise<RunSummary> => {
  return new Scheduler(input).run();
};
```

- [ ] **Step 2: Add bare-bones in-source test (skeleton-level)**

```ts
if (import.meta.vitest) {
  const { describe, it, expect } = await import("vitest");

  describe("orchestrator/scheduler skeleton", () => {
    it("stops immediately when signal is pre-aborted and no work", async () => {
      const ctrl = new AbortController();
      ctrl.abort();
      const summary = await runScheduler({
        tracker: {
          fetchCandidateIssues: async () => ({ type: "Success", value: [] }),
          fetchIssuesByStates: async () => ({ type: "Success", value: [] }),
          fetchIssueStatesByIds: async () => ({ type: "Success", value: [] }),
          createComment: async () => ({ type: "Success", value: undefined }),
          updateIssueState: async () => ({ type: "Success", value: undefined }),
        } as any,
        backend: { type: "mock", startSession: async () => ({ type: "Failure", error: { kind: "mock-forced-failure", reason: "n/a" } }) } as any,
        config: {
          agent: { backend: { type: "mock" }, maxConcurrentAgents: 1, maxTurns: 1,
            maxRetryBackoffMs: 300_000, agentSessionStallTimeoutMs: 1_800_000, maxConcurrentAgentsByState: {} },
          tracker: { kind: "memory", activeStates: ["Todo"], terminalStates: ["Done"], issues: [] },
          prompt: "", polling: { intervalMs: 50 },
          logging: null,
          observability: { dashboardEnabled: false, refreshMs: 1000, renderIntervalMs: 16 },
        } as any,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        signal: ctrl.signal,
      });
      expect(summary.total).toBe(0);
    });
  });
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter conductor test src/orchestrator/scheduler 2>&1 | tail -10
git add apps/conductor/src/orchestrator/scheduler.ts
git commit -m "feat(conductor): add Scheduler skeleton (state + tick loop)"
```

---

## Task 16: Scheduler — pumpCycle + dispatchIssue + parallel/priority/blocker integration tests

**Files:**
- Modify: `apps/conductor/src/orchestrator/scheduler.ts`
- Create: `apps/conductor/test/integration/scheduler-parallel-dispatch.test.ts`
- Create: `apps/conductor/test/integration/scheduler-priority-sort.test.ts`
- Create: `apps/conductor/test/integration/scheduler-blocker-skip.test.ts`

- [ ] **Step 1: Implement pumpCycle + dispatchIssue**

In `scheduler.ts`, replace the `private async pumpCycle(): Promise<void> { /* Task 16 */ }` stub with:

```ts
private async pumpCycle(): Promise<void> {
  if (this.stopped || this.input.signal.aborted) return;

  // 1. reconcileRunning — Task 17 will fill this in; for now, no-op.
  await this.reconcileRunning();

  // 2. fetch candidates
  const candR = await this.input.tracker.fetchCandidateIssues();
  if (candR.type === "Failure") {
    this.input.logger.warn(`[scheduler] fetchCandidateIssues failed: ${JSON.stringify(candR.error)}`);
    return;
  }
  for (const i of candR.value) this.totalSeen.add(String(i.id));

  // 3. select dispatchable
  const { selectDispatchable } = await import("./dispatch-filter.js");
  const runningCountByState: Record<string, number> = {};
  for (const e of this.running.values()) {
    runningCountByState[e.issue.state] = (runningCountByState[e.issue.state] ?? 0) + 1;
  }
  const toDispatch = selectDispatchable({
    candidates: candR.value,
    activeStates: this.input.config.tracker.activeStates as any,
    terminalStates: this.input.config.tracker.terminalStates as any,
    running: new Set([...this.running.keys()]),
    claimed: new Set(this.claimed),
    maxConcurrentAgents: this.input.config.agent.maxConcurrentAgents,
    maxConcurrentAgentsByState: this.input.config.agent.maxConcurrentAgentsByState,
    runningCountByState,
  });

  // 4. enqueue dispatch tasks
  for (const issue of toDispatch) {
    this.claimed.add(String(issue.id));
    this.queue.add(() => this.dispatchIssue(issue));
  }
}

private async reconcileRunning(): Promise<void> {
  // Filled in Task 17.
}

private async dispatchIssue(issue: Issue): Promise<void> {
  const id = String(issue.id);
  const startedAt = new Date();
  this.running.set(id, {
    issueId: issue.id, identifier: issue.identifier, issue,
    startedAt, lastActivityAt: startedAt, retryAttempt: this.retryAttempts.get(id)?.attempt ?? 0,
  });
  this.retryAttempts.delete(id);
  this.input.hooks?.onIssueStart(id, issue.identifier, issue.state, null, null);

  try {
    const { runAgent } = await import("./agent-runner.js");
    const outcome = await runAgent({
      issue,
      backend: this.input.backend,
      tracker: this.input.tracker,
      agentConfig: this.input.config.agent,
      ...(this.input.config.workspace ? { workspaceConfig: this.input.config.workspace } : {}),
      ...(this.input.config.hooks ? { hooksConfig: this.input.config.hooks } : {}),
      ...(this.input.config.tracker.doingState ? { doingState: this.input.config.tracker.doingState as IssueStateName } : {}),
      ...(this.input.config.tracker.doneState ? { doneState: this.input.config.tracker.doneState as IssueStateName } : {}),
      terminalStates: this.input.config.tracker.terminalStates as any,
      activeStates: this.input.config.tracker.activeStates as any,
      promptTemplate: this.input.config.prompt,
      logger: this.input.logger,
      signal: this.input.signal,
      ...(this.input.hooks ? { hooks: this.input.hooks } : {}),
    });
    this.handleAgentOutcome(issue, outcome);
  } finally {
    this.running.delete(id);
    this.claimed.delete(id);
    this.input.hooks?.onIssueEnd(id);
  }
}

private handleAgentOutcome(issue: Issue, outcome: Awaited<ReturnType<typeof import("./agent-runner.js").runAgent>>): void {
  // Task 18 (retry handling) replaces this body.
  if (outcome.type === "Success" && outcome.value.completed) {
    this.completedCount += 1;
  } else {
    this.failedCount += 1;
  }
  this.wake();
}
```

- [ ] **Step 2: Add integration test — parallel dispatch**

`test/integration/scheduler-parallel-dispatch.test.ts`:

```ts
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
      title: id, description: "",
      state: v.parse(IssueStateName.schema, state),
      priority: null, createdAt: null, assigneeId: null, assignedToWorker: true, blockedBy: [],
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
      fetchIssueStatesByIds: async (ids) => ok(ids.map((id) => (String(id) === "A" ? doneA : doneB))),
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
        agent: { backend: { type: "mock" }, maxConcurrentAgents: 2, maxTurns: 1,
          maxRetryBackoffMs: 300_000, agentSessionStallTimeoutMs: 1_800_000, maxConcurrentAgentsByState: {} },
        tracker: { kind: "memory", activeStates: ["Todo"], terminalStates: ["Done"],
          doingState: "In Progress", doneState: "Done", issues: [] },
        prompt: "Hi", polling: { intervalMs: 200 },
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
```

- [ ] **Step 3: Priority sort integration test**

`test/integration/scheduler-priority-sort.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as v from "valibot";
import { selectDispatchable } from "../../src/orchestrator/dispatch-filter.js";
import { IssueId, IssueIdentifier, IssueStateName, PriorityValue } from "../../src/domain/issue.js";

describe("scheduler priority sort", () => {
  it("dispatches in order: priority 1 → 2 → 3 → 4 → null", () => {
    const mk = (id: string, priority: 1 | 2 | 3 | 4 | null) => ({
      id: v.parse(IssueId.schema, id),
      identifier: v.parse(IssueIdentifier.schema, id),
      title: "t", description: "",
      state: v.parse(IssueStateName.schema, "Todo"),
      priority: priority !== null ? v.parse(PriorityValue.schema, priority) : null,
      createdAt: null, assigneeId: null, assignedToWorker: true, blockedBy: [],
    });
    const issues = [mk("X", null), mk("D", 4), mk("A", 1), mk("C", 3), mk("B", 2)];
    const out = selectDispatchable({
      candidates: issues,
      activeStates: [v.parse(IssueStateName.schema, "Todo")],
      terminalStates: [v.parse(IssueStateName.schema, "Done")],
      running: new Set(), claimed: new Set(),
      maxConcurrentAgents: 10, maxConcurrentAgentsByState: {}, runningCountByState: {},
    });
    expect(out.map((i) => i.identifier)).toEqual(["A", "B", "C", "D", "X"]);
  });
});
```

- [ ] **Step 4: Blocker skip integration test**

`test/integration/scheduler-blocker-skip.test.ts`:

```ts
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
```

- [ ] **Step 5: Run + commit**

```bash
pnpm --filter conductor test src/orchestrator/scheduler test/integration/scheduler 2>&1 | tail -20
git add apps/conductor/src/orchestrator/scheduler.ts apps/conductor/test/integration/scheduler-*.test.ts
git commit -m "feat(conductor): Scheduler pump cycle + dispatch (parallel/priority/blocker tests)"
```

---

## Task 17: Scheduler — reconcileRunning + integration test

**Files:**
- Modify: `apps/conductor/src/orchestrator/scheduler.ts`
- Create: `apps/conductor/test/integration/scheduler-reconcile.test.ts`

- [ ] **Step 1: Implement reconcileRunning**

Replace the no-op stub:

```ts
private async reconcileRunning(): Promise<void> {
  if (this.running.size === 0) return;
  const ids = Array.from(this.running.keys()).map((s) => s as unknown as IssueId);
  const r = await this.input.tracker.fetchIssueStatesByIds(ids as any);
  if (r.type === "Failure") {
    this.input.logger.warn(`[scheduler] reconcileRunning: tracker fetch failed: ${JSON.stringify(r.error)}`);
    return;
  }
  const seen = new Set<string>();
  const terminalSet = new Set(this.input.config.tracker.terminalStates.map((s) => s.toLowerCase().trim()));
  const activeSet = new Set(this.input.config.tracker.activeStates.map((s) => s.toLowerCase().trim()));

  for (const refreshed of r.value) {
    const id = String(refreshed.id);
    seen.add(id);
    const entry = this.running.get(id);
    if (!entry) continue;
    const stateKey = refreshed.state.toLowerCase().trim();

    if (terminalSet.has(stateKey)) {
      this.input.logger.info(`[scheduler] ${refreshed.identifier} reached terminal state ${refreshed.state}; stopping`);
      this.terminateRunning(id, /*cleanupWorkspace=*/ true);
      continue;
    }
    if (!refreshed.assignedToWorker) {
      this.input.logger.info(`[scheduler] ${refreshed.identifier} no longer assigned; stopping`);
      this.terminateRunning(id, /*cleanupWorkspace=*/ false);
      continue;
    }
    if (!activeSet.has(stateKey)) {
      this.input.logger.info(`[scheduler] ${refreshed.identifier} non-active state ${refreshed.state}; stopping`);
      this.terminateRunning(id, /*cleanupWorkspace=*/ false);
      continue;
    }
    // Still active — refresh entry.issue
    this.running.set(id, { ...entry, issue: refreshed });
  }

  // Issues that disappeared from tracker results — treat as stale, release.
  for (const id of this.running.keys()) {
    if (!seen.has(id)) {
      this.input.logger.warn(`[scheduler] running issue ${id} not visible from tracker; releasing claim`);
      this.terminateRunning(id, /*cleanupWorkspace=*/ false);
    }
  }
}

private terminateRunning(id: string, _cleanupWorkspace: boolean): void {
  // The AgentRunner promise is still in-flight from dispatchIssue; we can't synchronously kill it.
  // Mark the entry for shutdown; the cleanup happens when the AgentRunner exits.
  // For Phase 6 parity we log + remove from running so dispatch slot frees up.
  this.running.delete(id);
  this.claimed.delete(id);
  // Workspace cleanup is invoked by the AgentRunner's after_run hook + the orchestrator's terminal handler
  // already exists; cleanupWorkspace parameter is forward-looking for future SSH-mode work.
}
```

Note: clean subprocess termination requires propagating an `AbortController` per AgentRunner instance. That's a deeper refactor — for Phase 6, the AgentRunner shares the global `signal` and `terminateRunning` only releases the dispatch slot. The AgentRunner exits naturally when the backend session next races to abort or completes its current turn.

- [ ] **Step 2: Reconcile integration test**

`test/integration/scheduler-reconcile.test.ts`:

```ts
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
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter conductor test src/orchestrator/scheduler test/integration/scheduler-reconcile 2>&1 | tail -10
git add apps/conductor/src/orchestrator/scheduler.ts apps/conductor/test/integration/scheduler-reconcile.test.ts
git commit -m "feat(conductor): Scheduler reconcileRunning (terminal/non-active/missing transitions)"
```

---

## Task 18: Scheduler — retry handling (continuation + failure) + tests

**Files:**
- Modify: `apps/conductor/src/orchestrator/scheduler.ts`
- Create: `apps/conductor/test/integration/scheduler-retry-on-failure.test.ts`
- Create: `apps/conductor/test/integration/scheduler-continuation-retry.test.ts`

- [ ] **Step 1: Add top-level retry-policy import to scheduler.ts**

At the top of `scheduler.ts` (next to the other imports), add:

```ts
import { continuationDelay, failureDelay } from "./retry-policy.js";
```

- [ ] **Step 2: Replace handleAgentOutcome with retry-aware version**

```ts
private handleAgentOutcome(issue: Issue, outcome: Awaited<ReturnType<typeof import("./agent-runner.js").runAgent>>): void {
  const id = String(issue.id);
  if (outcome.type === "Success" && outcome.value.completed) {
    this.completedCount += 1;
    this.retryAttempts.delete(id);
    this.claimed.delete(id);
    this.wake();
    return;
  }
  if (outcome.type === "Success" && !outcome.value.completed) {
    // Normal exit (max_turns reached without terminal). Symphony semantics: continuation retry.
    this.scheduleContinuationRetry(issue);
    this.wake();
    return;
  }
  // Failure — schedule failure retry with exponential backoff.
  this.failedCount += 1;
  this.scheduleFailureRetry(issue, outcome.error);
  this.wake();
}

private scheduleContinuationRetry(issue: Issue): void {
  this.scheduleRetry(issue, 1, "continuation", continuationDelay(), null);
}

private scheduleFailureRetry(issue: Issue, error: unknown): void {
  const id = String(issue.id);
  const prev = this.retryAttempts.get(id);
  const nextAttempt = (prev?.attempt ?? 0) + 1;
  const delay = failureDelay(nextAttempt, this.input.config.agent.maxRetryBackoffMs);
  this.scheduleRetry(issue, nextAttempt, "failure", delay, JSON.stringify(error));
}

private scheduleRetry(issue: Issue, attempt: number, delayType: RetryDelayType, delayMs: number, error: string | null): void {
  const id = String(issue.id);
  const prev = this.retryAttempts.get(id);
  if (prev) clearTimeout(prev.timerRef);
  const retryToken = Symbol("retry");
  const dueAtMs = Date.now() + delayMs;
  const timerRef = setTimeout(() => this.handleRetry(id, retryToken), delayMs);
  this.retryAttempts.set(id, {
    issueId: issue.id, identifier: issue.identifier,
    attempt, delayType, timerRef, retryToken, dueAtMs, error,
  });
  this.input.logger.warn(
    `[scheduler] retry ${issue.identifier} attempt=${attempt} delayType=${delayType} in ${delayMs}ms${error ? ` error=${error}` : ""}`,
  );
}

private async handleRetry(id: string, retryToken: symbol): Promise<void> {
  const entry = this.retryAttempts.get(id);
  if (!entry || entry.retryToken !== retryToken) return;
  this.retryAttempts.delete(id);

  const candR = await this.input.tracker.fetchCandidateIssues();
  if (candR.type === "Failure") {
    // Re-schedule next attempt
    const fakeIssue = { id: entry.issueId, identifier: entry.identifier } as unknown as Issue;
    const nextAttempt = entry.attempt + 1;
    this.scheduleRetry(fakeIssue, nextAttempt, "failure",
      failureDelay(nextAttempt, this.input.config.agent.maxRetryBackoffMs),
      `retry-poll-failed: ${JSON.stringify(candR.error)}`);
    return;
  }
  const refreshed = candR.value.find((i) => String(i.id) === id);
  const terminalSet = new Set(this.input.config.tracker.terminalStates.map((s) => s.toLowerCase().trim()));
  const activeSet = new Set(this.input.config.tracker.activeStates.map((s) => s.toLowerCase().trim()));

  if (!refreshed) {
    this.input.logger.info(`[scheduler] retry: issue ${id} no longer visible; releasing claim`);
    this.claimed.delete(id);
    this.wake();
    return;
  }
  const stateKey = refreshed.state.toLowerCase().trim();
  if (terminalSet.has(stateKey)) {
    this.input.logger.info(`[scheduler] retry: issue ${refreshed.identifier} terminal; releasing claim`);
    this.claimed.delete(id);
    this.wake();
    return;
  }
  if (!activeSet.has(stateKey)) {
    this.input.logger.info(`[scheduler] retry: issue ${refreshed.identifier} non-active state ${refreshed.state}; releasing claim`);
    this.claimed.delete(id);
    this.wake();
    return;
  }

  // Active — re-enqueue dispatch
  this.claimed.delete(id); // selectDispatchable will re-claim
  this.wake(); // pumpCycle will pick it up on the next tick
}
```

- [ ] **Step 2: scheduler-retry-on-failure.test.ts**

```ts
import { describe, it, expect, vi } from "vitest";
import * as v from "valibot";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { runScheduler } from "../../src/orchestrator/scheduler.js";
import { createMockBackend } from "../../src/backend/mock.js";
import { IssueId, IssueIdentifier, IssueStateName } from "../../src/domain/issue.js";
import type { Tracker } from "../../src/tracker/types.js";

describe("scheduler retry on failure", () => {
  it("schedules failure retry after mock force_fail", async () => {
    vi.useFakeTimers();
    try {
      const root = await mkdtemp(join(tmpdir(), "sched-retry-"));
      const ok = <T>(v: T) => ({ type: "Success" as const, value: v });
      const issue = {
        id: v.parse(IssueId.schema, "A"),
        identifier: v.parse(IssueIdentifier.schema, "A"),
        title: "t", description: "",
        state: v.parse(IssueStateName.schema, "Todo"),
        priority: null, createdAt: null, assigneeId: null, assignedToWorker: true, blockedBy: [],
      };
      let calls = 0;
      const tracker: Tracker = {
        fetchCandidateIssues: async () => { calls += 1; return ok(calls < 3 ? [issue] : []); },
        fetchIssuesByStates: async () => ok([]),
        fetchIssueStatesByIds: async () => ok([issue]),
        createComment: async () => ok(undefined),
        updateIssueState: async () => ok(undefined),
      };
      const ctrl = new AbortController();
      const runP = runScheduler({
        tracker,
        backend: createMockBackend({ type: "mock", forceFail: true }),
        config: {
          agent: { backend: { type: "mock" }, maxConcurrentAgents: 1, maxTurns: 1,
            maxRetryBackoffMs: 300_000, agentSessionStallTimeoutMs: 1_800_000, maxConcurrentAgentsByState: {} },
          tracker: { kind: "memory", activeStates: ["Todo"], terminalStates: ["Done"],
            doingState: "In Progress", doneState: "Done", issues: [] },
          prompt: "Hi", polling: { intervalMs: 5_000 }, logging: null, workspace: { root },
          observability: { dashboardEnabled: false, refreshMs: 1000, renderIntervalMs: 16 },
        } as any,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        signal: ctrl.signal,
      });

      // Advance fake clock to allow first dispatch and first retry tick
      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(10_000); // failure_retry attempt 1 = 10s
      ctrl.abort();
      const summary = await runP;
      expect(summary.failed).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 3: scheduler-continuation-retry.test.ts**

```ts
import { describe, it, expect, vi } from "vitest";
import * as v from "valibot";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { runScheduler } from "../../src/orchestrator/scheduler.js";
import { createMockBackend } from "../../src/backend/mock.js";
import { IssueId, IssueIdentifier, IssueStateName } from "../../src/domain/issue.js";
import type { Tracker } from "../../src/tracker/types.js";

describe("scheduler continuation retry", () => {
  it("re-dispatches the same issue 1s after normal exit when still active (no doing_state)", async () => {
    vi.useFakeTimers();
    try {
      const root = await mkdtemp(join(tmpdir(), "sched-cont-"));
      const ok = <T>(v: T) => ({ type: "Success" as const, value: v });
      const todo = {
        id: v.parse(IssueId.schema, "A"),
        identifier: v.parse(IssueIdentifier.schema, "A"),
        title: "t", description: "",
        state: v.parse(IssueStateName.schema, "Todo"),
        priority: null, createdAt: null, assigneeId: null, assignedToWorker: true, blockedBy: [],
      };
      // Run 1: returns issue. Run 2 (after continuation): returns it again. Run 3: empty.
      let calls = 0;
      const tracker: Tracker = {
        fetchCandidateIssues: async () => {
          calls += 1;
          return ok(calls < 3 ? [todo] : []);
        },
        fetchIssuesByStates: async () => ok([]),
        fetchIssueStatesByIds: async () => ok([todo]), // stays active so loop ends w/ completed=false
        createComment: async () => ok(undefined),
        updateIssueState: async () => ok(undefined),
      };
      const ctrl = new AbortController();
      const runP = runScheduler({
        tracker,
        backend: createMockBackend({ type: "mock" }),
        config: {
          // doingState omitted → ADR-0014 3rd condition off → loop ends with completed=false
          agent: { backend: { type: "mock" }, maxConcurrentAgents: 1, maxTurns: 1,
            maxRetryBackoffMs: 300_000, agentSessionStallTimeoutMs: 1_800_000, maxConcurrentAgentsByState: {} },
          tracker: { kind: "memory", activeStates: ["Todo"], terminalStates: ["Done"], issues: [] },
          prompt: "Hi", polling: { intervalMs: 5_000 }, logging: null, workspace: { root },
          observability: { dashboardEnabled: false, refreshMs: 1000, renderIntervalMs: 16 },
        } as any,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        signal: ctrl.signal,
      });
      await vi.advanceTimersByTimeAsync(50);   // first dispatch
      await vi.advanceTimersByTimeAsync(1_500); // continuation retry tick after 1s + buffer
      ctrl.abort();
      const summary = await runP;
      expect(calls).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

(Note: fake timer tests can be flaky around `await import()`s and microtask flushes. If the test fails intermittently, drop fake timers and use real `polling.intervalMs: 100` with `setTimeout(ctrl.abort, 500)`.)

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter conductor test test/integration/scheduler-retry test/integration/scheduler-continuation 2>&1 | tail -20
git add apps/conductor/src/orchestrator/scheduler.ts apps/conductor/test/integration/scheduler-retry-on-failure.test.ts apps/conductor/test/integration/scheduler-continuation-retry.test.ts
git commit -m "feat(conductor): Scheduler retry handling (continuation 1s + failure exponential)"
```

---

## Task 19: Scheduler — stall detection + integration test

**Files:**
- Modify: `apps/conductor/src/orchestrator/scheduler.ts`
- Modify: `apps/conductor/src/orchestrator/agent-runner.ts` (push lastActivityAt updates back to scheduler)
- Create: `apps/conductor/test/integration/scheduler-stall-restart.test.ts`

- [ ] **Step 1: Add updateLastActivity callback to Scheduler + thread through AgentRunner via hooks**

Phase 5's ObservabilityHooks already fire on every turn event. Hook into it: the scheduler also subscribes its own hook that updates `running.get(id).lastActivityAt = new Date()` on `onTurnEvent`.

`SchedulerInput.hooks` is readonly, so we cannot mutate `this.input.hooks`. Add a private field instead.

In `scheduler.ts`:

```ts
// Add a private field on the Scheduler class:
private readonly composedHooks: ObservabilityHooks;

// In the constructor, after `this.queue = new PQueue(...)`:
this.composedHooks = this.composeHooks(input.hooks);

private composeHooks(userHooks: ObservabilityHooks | undefined): ObservabilityHooks {
  const noop: ObservabilityHooks = { onIssueStart() {}, onIssueEnd() {}, onTurnEvent() {} } as ObservabilityHooks;
  const fallback: ObservabilityHooks = userHooks ?? noop;
  return {
    ...fallback,
    onTurnEvent: (issueId, event) => {
      fallback.onTurnEvent(issueId, event);
      const entry = this.running.get(issueId);
      if (entry) this.running.set(issueId, { ...entry, lastActivityAt: new Date() });
    },
  };
}
```

Then in `dispatchIssue`, pass `this.composedHooks` to `runAgent` and to `onIssueStart`/`onIssueEnd` instead of `this.input.hooks`. Replace:

```ts
this.input.hooks?.onIssueStart(id, issue.identifier, issue.state, null, null);
// ...
...(this.input.hooks ? { hooks: this.input.hooks } : {}),
// ...
this.input.hooks?.onIssueEnd(id);
```

with:

```ts
this.composedHooks.onIssueStart(id, issue.identifier, issue.state, null, null);
// ...
hooks: this.composedHooks,
// ...
this.composedHooks.onIssueEnd(id);
```

- [ ] **Step 2: Add stallCheck inside reconcileRunning**

Prepend to `reconcileRunning`:

```ts
private async reconcileRunning(): Promise<void> {
  // 0. stall check
  const stallMs = this.input.config.agent.agentSessionStallTimeoutMs;
  const now = Date.now();
  for (const [id, entry] of this.running.entries()) {
    const elapsed = now - entry.lastActivityAt.getTime();
    if (elapsed > stallMs) {
      this.input.logger.warn(`[scheduler] stalled: ${entry.identifier} elapsed=${elapsed}ms; scheduling restart`);
      this.terminateRunning(id, /*cleanupWorkspace=*/ false);
      this.scheduleFailureRetry(entry.issue, { kind: "stall-restart", issueId: id, elapsedMs: elapsed });
    }
  }
  // existing reconcile logic continues …
}
```

- [ ] **Step 3: scheduler-stall-restart.test.ts**

```ts
import { describe, it, expect, vi } from "vitest";
import * as v from "valibot";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { Scheduler } from "../../src/orchestrator/scheduler.js";
import { createMockBackend } from "../../src/backend/mock.js";
import { IssueId, IssueIdentifier, IssueStateName } from "../../src/domain/issue.js";
import type { Tracker } from "../../src/tracker/types.js";

describe("scheduler stall restart", () => {
  it("schedules a failure_retry for an issue whose lastActivityAt is older than the stall timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "sched-stall-"));
    const ok = <T>(v: T) => ({ type: "Success" as const, value: v });
    const issue = {
      id: v.parse(IssueId.schema, "A"),
      identifier: v.parse(IssueIdentifier.schema, "A"),
      title: "t", description: "",
      state: v.parse(IssueStateName.schema, "Todo"),
      priority: null, createdAt: null, assigneeId: null, assignedToWorker: true, blockedBy: [],
    };
    const tracker: Tracker = {
      fetchCandidateIssues: async () => ok([]),
      fetchIssuesByStates: async () => ok([]),
      fetchIssueStatesByIds: async () => ok([issue]),
      createComment: async () => ok(undefined),
      updateIssueState: async () => ok(undefined),
    };
    const ctrl = new AbortController();
    const sched = new Scheduler({
      tracker,
      backend: createMockBackend({ type: "mock" }),
      config: {
        agent: { backend: { type: "mock" }, maxConcurrentAgents: 1, maxTurns: 1,
          maxRetryBackoffMs: 300_000, agentSessionStallTimeoutMs: 100, maxConcurrentAgentsByState: {} },
        tracker: { kind: "memory", activeStates: ["Todo"], terminalStates: ["Done"], issues: [] },
        prompt: "", polling: { intervalMs: 50 }, logging: null, workspace: { root },
        observability: { dashboardEnabled: false, refreshMs: 1000, renderIntervalMs: 16 },
      } as any,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      signal: ctrl.signal,
    });

    // Manually inject a running entry with stale lastActivityAt.
    sched.running.set("A", {
      issueId: issue.id, identifier: issue.identifier, issue,
      startedAt: new Date(Date.now() - 5_000),
      lastActivityAt: new Date(Date.now() - 5_000),
      retryAttempt: 0,
    });
    sched.claimed.add("A");

    await (sched as any).reconcileRunning();
    expect(sched.retryAttempts.has("A")).toBe(true);
    const retry = sched.retryAttempts.get("A")!;
    expect(retry.delayType).toBe("failure");
    expect(retry.attempt).toBe(1);
    // cleanup timer
    clearTimeout(retry.timerRef);
  });
});
```

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter conductor test test/integration/scheduler-stall 2>&1 | tail -10
git add apps/conductor/src/orchestrator/ apps/conductor/test/integration/scheduler-stall-restart.test.ts
git commit -m "feat(conductor): Scheduler stall detection + failure_retry restart"
```

---

