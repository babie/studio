# Milestone 3 Phase 2: 実 backend subprocess + Workspace 管理 設計書

**日付:** 2026-05-16
**対象:** [`TODO.md`](../../../TODO.md) Milestone 3 Phase 2
**親 spec:** [`2026-05-15-m3-overview-design.md`](2026-05-15-m3-overview-design.md)
**前 Phase spec:** [`2026-05-16-m3-phase1-design.md`](2026-05-16-m3-phase1-design.md)
**ステータス:** 設計確定、実装着手待ち

---

## 背景

Phase 1 ([`2026-05-16-m3-phase1-design.md`](2026-05-16-m3-phase1-design.md)) で `apps/conductor/` を立ち上げ、Memory tracker + Mock backend の in-process happy path を通した。本 Phase 2 では **実 backend (claude-app-server / codex) を subprocess として起動し、JSON-RPC stdio で 1 issue を end-to-end で完了** できる状態を作る。

Phase 2 のゴール:

1. JsonRpcSubprocessClient（共通）と Backend (claude / codex) 実装
2. Workspace 管理 (`hooks` top-level、symphony 互換 4 hook + timeout)
3. Prompt builder (liquidjs、symphony の `Solid` 1:1 移植)
4. AgentRunner の max_turns ループ実装（symphony 互換）
5. Memory tracker + 実 claude-app-server / codex で 1 issue を Done にできる E2E

Phase 1 では未確定だった「並行モデル」「JSON-RPC 型の共有化要否」「SSH モード移植要否」を本 spec で確定する。

---

## スコープ

### スコープ in

- **JsonRpcSubprocessClient**: `child_process.spawn` + JSONL stdio + request/response マッチング + notification subscribe + interrupt + lifecycle
- **Backend interface 拡張**: Phase 1 の `Backend.runIssueTurn` を **session ベース** (`startSession` → `runTurn` × N → `shutdown`) に変更
- **`backend/claude.ts`**: claude-app-server 用 spawn コマンド構築 + `thread/start.params` 組み立て
- **`backend/codex.ts`**: codex 用 spawn コマンド構築 + `approval_policy` / `thread_sandbox` / `turn_sandbox_policy` を `thread/start.params` に乗せる
- **Workspace 管理**: `workspace/path.ts` (path 安全化) + `workspace/manager.ts` (ensure/remove) + `workspace/hooks.ts` (hook 実行、env 注入、timeout)
- **WORKFLOW.md schema 修正**: `hooks` を **top-level** に戻す（Phase 1 で誤って `workspace.hooks` に入れ子化したのを訂正）
- **Hook 種類拡充**: `before_run` / `after_create` / `before_remove` / `after_run` + `hooks.timeout_ms`（symphony 互換）
- **Prompt builder**: liquidjs。`{{ issue.* }}` / `{{ attempt }}` を strict_variables 相当で展開
- **AgentRunner**: max_turns ループ + 継続 turn プロンプト（symphony `agent_runner.ex` 1:1）
- **guardrail flag**: `--i-understand-that-this-will-be-running-without-the-usual-guardrails` を必須化。flag なし時は `OrchestratorError.guardrail-missing` で exit
- **SIGINT ハンドリング**: AbortController 経由で `turn/interrupt` → SIGTERM → SIGKILL の段階的シャットダウン
- **E2E 新規 2 本**: `conductor-claude-memory.test.ts` / `conductor-codex-memory.test.ts`

### スコープ out（Phase 3 以降）

- Tracker Linear / GitHub adapter（Phase 3 / 4）
- TUI dashboard、event bus、token usage 集計、ストリーミング (`item/agentMessage/delta`)（Phase 5、claude-app-server 側の TODO に依存）
- 並列実行 (`max_concurrent_agents > 1`)、retry backoff、失敗時 comment、`max_attempts`（Phase 6）
- ファイルロガー（Phase 6）
- TUI 描画（Phase 5）
- **SSH モード** (`worker.ssh_hosts`、symphony `ssh.ex`)。M4+ にも見送り、schema 自体受け取らない
- `workspace.before_remove` 起動後の workspace 削除自体（symphony も issue 再開時に再利用、削除は手動）
- workspace の git worktree 化（M4+）
- claude-app-server と JSON-RPC 型の共有 package 化（M3 完了後判断、YAGNI）

### 成功基準（自動検証）

1. **Phase 1 で書いた既存テスト** (`pnpm --filter conductor test`) が全件 green
2. **新規 unit / integration tests**: JsonRpcSubprocessClient / workspace / prompt / agent-runner (max_turns) を in-source / `test/integration/` で網羅
3. **新規 E2E**: `apps/conductor/test/e2e/conductor-claude-memory.test.ts` — `conductor --i-understand-... examples/workflow.claude-memory.md` を spawn、実 claude-app-server が起動して 1 issue が Done に到達（120s timeout、Claude OAuth 無ければ `skip`）
4. **新規 E2E**: `apps/conductor/test/e2e/conductor-codex-memory.test.ts` — 同上 codex 版（`codex` CLI 無ければ `skip`）
5. 既存 `pnpm test:e2e:claude-linear` / `pnpm test:e2e:claude-github` は **symphony 起動のまま緑維持**（conductor 切替は Phase 3 / 4）

---

## 横断指針

M3 overview の指針を踏襲。Phase 2 で追加・確定する事項:

- **並行モデル**: plain async + AbortController + 小さな state object。Node 標準の `Promise` / `EventEmitter` / async iterator / AbortController だけで組む。symphony の GenServer / Supervisor ツリーは 1:1 移植せず、issue 処理 1 件 = 1 本の async function + 1 subprocess に単純化。並列制御は Phase 6 で semaphore / pool を乗せる
- **JSON-RPC 型の取り扱い**: conductor 側に独自実装 (`backend/jsonrpc/`)。`apps/claude-app-server` との型重複は M3 期間 YAGNI、M3 完了後に共有 package 化を再評価
- **SSH モード**: 移植しない。`worker.ssh_hosts` を WORKFLOW.md に書いたら schema 違反でエラー
- **AgentRunner のターン制御**: symphony 互換の max_turns ループを 2 backend とも実装
- **Backend factoring**: `JsonRpcSubprocessClient` を共通化、`Backend` は spawn コマンド + thread/start.params 提供だけ。3 層化 (`BackendSession` を独立クラス) は M4+ メモに退避（[`TODO.md`](../../../TODO.md) 参照）

---

## アーキテクチャ

### コンポーネント関係図（Phase 2 完了時点）

```
                          apps/conductor
┌────────────────────────────────────────────────────────────────────────┐
│ cli/run.ts                                                              │
│   └─► orchestrator/orchestrator.ts                                      │
│         └─► orchestrator/agent-runner.ts ───────┐                       │
│              │  (per-issue, max_turns loop)      │                       │
│              ├─► workspace/manager.ts            │                       │
│              │     ├─► workspace/path.ts         │                       │
│              │     └─► workspace/hooks.ts        │                       │
│              ├─► prompt/builder.ts (liquidjs)    │                       │
│              └─► backend (Backend interface) ────┘                       │
│                     │                                                    │
│                     ├─ backend/claude.ts ──┐                            │
│                     ├─ backend/codex.ts  ──┼─► backend/jsonrpc/         │
│                     └─ backend/mock.ts       │     ├─ client.ts          │
│                                              │     │   (spawn + JSONL    │
│                                              │     │    + req/resp +     │
│                                              │     │    notif + intr +   │
│                                              │     │    init→thread/start│
│                                              │     │    →turn ループ     │
│                                              │     │    →shutdown)       │
│                                              │     ├─ messages.ts        │
│                                              │     │   (型 + valibot)    │
│                                              │     ├─ transport.ts       │
│                                              │     │   (write/onLine     │
│                                              │     │    の interface)    │
│                                              │     └─ errors.ts          │
│                                              └─► child_process.spawn     │
└────────────────────────────────────────────────────────────────────────┘
```

### 既存ファイル変更概要

| ファイル | 変更内容 |
|---|---|
| `src/domain/backend-config.ts` | 変更なし（型はそのまま、Backend factory が claude/codex を実装に紐付け） |
| `src/domain/workspace-config.ts` | `WorkspaceConfig` から `hooks` を外し、新規 `domain/hooks-config.ts` に移す |
| `src/domain/workflow-config.ts` | `hooks?: HooksConfig` を top-level に追加 |
| `src/config/schema.ts` | `hooks:` を top-level に移動、`after_run` と `timeout_ms` 追加 |
| `src/backend/types.ts` | `Backend.runIssueTurn` を `Backend.startSession` + `Session.runTurn` + `Session.shutdown` に変更 |
| `src/backend/mock.ts` | session ベースに移行（既存テストの shape 変更が伴う） |
| `src/orchestrator/agent-runner.ts` | max_turns ループ + 継続 turn プロンプト追加、workspace ensure + hooks 呼び出し |
| `src/orchestrator/orchestrator.ts` | workspace path / before_run / after_run の呼び出し配線 |
| `src/cli/run.ts` | guardrail flag 検証、`--i-understand-...` 必須化 |
| `src/domain/errors.ts` | `BackendError` / `WorkspaceError` / `PromptError` / `OrchestratorError` 拡張 |

---

## モジュール詳細

### `backend/jsonrpc/`

#### `transport.ts`

```ts
export type StdioTransport = {
  readonly write: (line: string) => void;
  readonly onLine: (handler: (line: string) => void) => () => void; // unsubscribe
  readonly onClose: (handler: (info: { code: number | null; signal: NodeJS.Signals | null }) => void) => () => void;
  readonly stderrTail: () => string; // 末尾 4KB
  readonly kill: (signal: NodeJS.Signals) => void;
};
```

`Transport` は subprocess の物理層をカプセル化する interface。実体は 2 つ:

- `subprocessTransport(spawnArgs)`: `child_process.spawn` で起動した child のラッパー。stdout を改行で split、stderr は ring buffer (4KB) に保持
- `inMemoryTransport()`: テスト用。`feedInput(line)` / `readOutput()` で対向側から駆動

#### `messages.ts`

JSON-RPC 2.0 メッセージの型 + valibot schema。`Symphony` が使うサブセット（[`docs/protocol.md`](../../protocol.md) 参照）に限定:

- request 側: `initialize` / `thread/start` / `turn/start` / `turn/interrupt`
- 受信側 response: 上記の result / error
- 受信側 notification: `initialized` / `thread/started` / `turn/started` / `item/*` (started/completed/agentMessage/delta/commandExecution/outputDelta/fileChange/outputDelta) / `turn/completed`

未知の method / notification は **無視 + 1 行 info ログ**。schema 違反は `BackendError.stdio-protocol-error` で halt。

#### `client.ts`

`JsonRpcSubprocessClient` class。1 instance = 1 subprocess。

```ts
class JsonRpcSubprocessClient {
  constructor(opts: { transport: StdioTransport; logger: Logger });

  // ライフサイクル
  initialize(params: InitializeParams, opts?: { timeoutMs?: number }): Promise<Result<InitializeResult, BackendError>>;
  startThread(params: ThreadStartParams, opts?: { timeoutMs?: number }): Promise<Result<ThreadStartResult, BackendError>>;
  runTurn(params: TurnStartParams, opts: { onNotification: (n: ServerNotification) => void; signal: AbortSignal }): Promise<Result<TurnCompletedResult, BackendError>>;
  shutdown(opts?: { gracePeriodMs?: number }): Promise<void>;

  // SIGINT などからの abort
  interrupt(): Promise<void>; // turn/interrupt 送信 → SIGTERM → SIGKILL
}
```

内部状態:
- `pending: Map<requestId, { resolve, reject, method, timer }>` — request/response マッチング
- `notificationHandlers: Set<(n) => void>` — `runTurn` 中だけ subscribe
- `nextId: number` — JSON-RPC ID 採番
- `lifecycle: "init" | "ready" | "running-turn" | "shutting-down" | "closed"`

ライフサイクル不整合 (例: `runTurn` を `ready` 以外で呼ぶ) は throw（内部 invariant、外部入力ではない）。

#### `errors.ts`

`BackendError` の補助関数 (`stdioProtocolError(phase, raw)` 等) + `valibot` issue → schema-violation 変換。

### `backend/`

#### `backend/types.ts`

Phase 1 を上書き:

```ts
export type Backend = {
  readonly type: "claude" | "codex" | "mock";
  readonly startSession: (params: StartSessionParams) => Promise<Result<BackendSession, BackendError>>;
};

export type BackendSession = {
  readonly runTurn: (params: RunTurnParams) => Promise<Result<TurnResult, BackendError>>;
  readonly shutdown: (opts?: { gracePeriodMs?: number }) => Promise<void>;
  readonly interrupt: () => Promise<void>;
};

export type StartSessionParams = Readonly<{
  workspace: string;       // cwd
  issue: Issue;
  agentConfig: AgentConfig;
}>;

export type RunTurnParams = Readonly<{
  prompt: string;
  turnNumber: number;      // 1-indexed
  maxTurns: number;
  signal: AbortSignal;
  onNotification: (n: ServerNotification) => void;
}>;

export type TurnResult = Readonly<{
  completed: true;
  // tracker から refetch するためのヒント程度。詳細は将来追加
}>;
```

`Backend` 自体は spawn 引数構築 + initialize/thread/start params 提供だけの薄い factory。実体は `BackendSession` 側にある。Mock backend も同じ interface を実装するため、Phase 1 のテストも shape 更新が必要。

#### `backend/claude.ts`

```ts
export const createClaudeBackend = (config: ClaudeBackendConfig): Backend => ({
  type: "claude",
  startSession: async ({ workspace, issue, agentConfig }) => {
    const spawnArgs = parseCommandLine(config.command); // 例: ["claude-app-server", "--model", "claude-opus-4-7", ...]
    const transport = subprocessTransport({ command: spawnArgs[0], args: spawnArgs.slice(1), cwd: workspace, env: buildEnv() });
    const client = new JsonRpcSubprocessClient({ transport, logger });
    const init = await client.initialize({ /* protocolVersion 等 */ });
    if (Result.isFailure(init)) return init;
    const thread = await client.startThread({ /* cwd, etc */ });
    if (Result.isFailure(thread)) return thread;
    return Result.success(makeSession(client, thread.value.threadId));
  },
});
```

`buildEnv()`:
- 親プロセスの `process.env` を base
- `ANTHROPIC_API_KEY` を **明示削除**（Claude Pro/Max OAuth を強制、ルート CLAUDE.md の方針）
- `HOME` は親から継承（`~/.claude/` を OAuth が読むため）

#### `backend/codex.ts`

```ts
export const createCodexBackend = (config: CodexBackendConfig): Backend => ({
  type: "codex",
  startSession: async ({ workspace, issue, agentConfig }) => {
    const spawnArgs = parseCommandLine(config.command); // 例: ["codex", "--config", "model=...", "app-server"]
    const transport = subprocessTransport({ ... });
    const client = new JsonRpcSubprocessClient({ ... });
    const init = await client.initialize({ ... });
    const thread = await client.startThread({
      approvalPolicy: config.approvalPolicy,
      threadSandbox: config.threadSandbox,
      turnSandboxPolicy: config.turnSandboxPolicy,
      // 他 codex 固有
    });
    return Result.success(makeSession(client, thread.value.threadId));
  },
});
```

`approval_policy` / `thread_sandbox` / `turn_sandbox_policy` は WORKFLOW.md の `codex:` ブロックから来る（Phase 1 schema 確定済）。

#### `backend/mock.ts`

Phase 1 と同じ振る舞いを session 化:
- `startSession` で in-process session 作成
- `runTurn` で `delayMs` 待機 → `Result.success({ completed: true })`
- `force_fail` で `BackendError.mock-forced-failure`
- `shutdown` / `interrupt` は no-op

### `workspace/`

#### `workspace/path.ts`

```ts
export const safeIdentifier = (id: string): Result<string, WorkspaceError>;
export const workspacePathFor = (root: string, identifier: string): Result<string, WorkspaceError>;
```

symphony の `PathSafety` 相当。`..` / 絶対パス / null byte を弾く。

#### `workspace/manager.ts`

```ts
export const ensureForIssue = (config: WorkspaceConfig, hooks: HooksConfig | undefined, issue: Issue, env: HookEnv): Promise<Result<{ path: string; created: boolean }, WorkspaceError>>;
export const removeForIssue = (config: WorkspaceConfig, hooks: HooksConfig | undefined, identifier: string): Promise<Result<void, WorkspaceError>>;
```

- `ensureForIssue`: path 計算 → 存在チェック → 無ければ `mkdir -p` → `after_create` hook → `{ path, created }` 返却
- `removeForIssue`: `before_remove` hook → `rm -rf`（Phase 2 では呼び出さない、symphony 互換で issue 再開時に再利用するため）

#### `workspace/hooks.ts`

```ts
export type HookEnv = Readonly<{
  ISSUE_ID: string;
  ISSUE_IDENTIFIER: string;
  ISSUE_TITLE: string;
}>;

export const runHook = (params: {
  command: string;
  cwd: string;
  env: HookEnv;
  timeoutMs: number;
  hookName: "before_run" | "after_create" | "before_remove" | "after_run";
}): Promise<Result<{ stdout: string; stderr: string }, WorkspaceError>>;
```

- `command` を `bash -lc <command>` で実行
- stdout / stderr を ring buffer (32KB) に取り、エラー時に末尾を error に詰める
- timeout は `child.kill("SIGTERM")` → 1 秒 → `SIGKILL`
- `before_run` / `after_create` 失敗 → orchestrator が issue を skip
- `before_remove` / `after_run` 失敗 → log のみ（symphony `ignore_hook_failure` 互換）

### `prompt/`

#### `prompt/builder.ts`

```ts
export const buildPrompt = (template: string, context: { issue: Issue; attempt?: number }): Result<string, PromptError>;
```

liquidjs の `Liquid` インスタンスを使い、`strictVariables: true` / `strictFilters: true` / `lenientIf: false` で render。`issue` の各 field を文字列 / null / array 等に展開（`Date` → ISO 文字列）。

継続 turn プロンプト（symphony `agent_runner.ex` のハードコード文言）は別関数 `buildContinuationPrompt(turnNumber, maxTurns)` で出す。これは liquidjs を通さず、TS テンプレートリテラルで symphony 文言と 1:1 になるよう書く。

### `orchestrator/agent-runner.ts`

Phase 1 の skeleton を以下に拡張:

```ts
export const runAgentForIssue = async (params: {
  issue: Issue;
  config: WorkflowConfig;
  tracker: Tracker;
  backend: Backend;
  workspaceManager: WorkspaceManager;
  logger: Logger;
  signal: AbortSignal;
}): Promise<Result<RunSummary, OrchestratorError>> => {
  // 1. workspace ensure + after_create
  // 2. tracker.updateIssueState(issue, doingState)
  // 3. hooks.before_run
  // 4. backend.startSession
  // 5. for turn = 1..maxTurns:
  //      prompt = (turn === 1 ? buildPrompt : buildContinuationPrompt)
  //      session.runTurn({ prompt, turnNumber, maxTurns, signal, onNotification })
  //      refreshedIssue = tracker.fetchIssueStatesByIds([issue.id])
  //      if terminal_states includes refreshed.state: break
  //      if turn >= maxTurns: break
  // 6. session.shutdown
  // 7. hooks.after_run (ignore failures)
  // 8. tracker.updateIssueState(refreshedIssue, doneState) if terminal
};
```

### `cli/run.ts`

`--i-understand-that-this-will-be-running-without-the-usual-guardrails` を必須化（mock backend 限定の bypass は **しない**、Phase 2 から実 backend が前提）。

```
$ conductor --i-understand-that-this-will-be-running-without-the-usual-guardrails examples/workflow.claude-memory.md
```

flag なし → stderr に 1 行説明 + exit 2。

### `util/`

Phase 1 から追加:
- `util/abort.ts`: `withAbort(promise, signal)` ヘルパー
- `util/redact.ts`: schema に `linear.api_key` / `github.api_key` 追加されたので redact 対象拡充は **Phase 3 / 4**。Phase 2 では既存のままで OK
- `util/parse-command.ts`: `claude.command` / `codex.command` を argv に split（shell-quote 互換、簡易版を自前で）

---

## データフロー (1 issue 完了までの 1 ターン)

1. `conductor --i-understand-... examples/workflow.claude-memory.md`
2. `cli/run.ts`: guardrail flag 検証 → `loader` → `parser` → `WorkflowConfig`
3. `orchestrator.run`: tracker / backend / workspaceManager を組み立て
4. Issue 1 件目を `tracker.fetchCandidateIssues` で取得
5. `agent-runner.runAgentForIssue`:
   1. `workspaceManager.ensureForIssue` → path 計算 → mkdir → `after_create` hook
   2. `tracker.updateIssueState(issue, doingState)`
   3. `hooks.runBeforeRun(workspace, issue)`
   4. `backend.startSession({ workspace, issue, agentConfig })`
      - `subprocessTransport` で child_process.spawn
      - `client.initialize` → 応答待ち
      - `client.startThread` → threadId 取得
   5. `for turn = 1..maxTurns`:
      - `prompt = buildPrompt | buildContinuationPrompt`
      - `session.runTurn({ prompt, turnNumber, maxTurns, signal, onNotification })`
        - 内部で `turn/start` 送信、notification を `onNotification` に流す（dashboard なし、Phase 5 で event bus 化）
        - `turn/completed` 受信で resolve
      - `refreshed = tracker.fetchIssueStatesByIds([issue.id])`
      - `if terminal_states includes refreshed.state: break`
      - `if turn === maxTurns: break`
   6. `session.shutdown(gracePeriodMs: 5000)` → SIGTERM → タイムアウトで SIGKILL
   7. `hooks.runAfterRun(workspace, issue)`（失敗は log のみ）
   8. `tracker.updateIssueState(refreshed, doneState)`（terminal の場合のみ）
6. 次の issue へ。すべて処理し終えたら orchestrator 終了

**割り込み (Ctrl-C)**:
- CLI で SIGINT → orchestrator が AbortController.abort
- `session.runTurn` の signal がトリガされ、`client.interrupt()`:
  1. `turn/interrupt` 送信
  2. 5 秒待っても `turn/completed` または exit が来なければ SIGTERM
  3. さらに 5 秒で SIGKILL
- orchestrator は `OrchestratorError.backend({ kind: "turn-not-completed", reason: "abort" })` を出して exit 130

---

## エラーハンドリング

### 拡張後の discriminated union

```ts
export type BackendError =
  | { kind: "mock-forced-failure"; reason: string }
  | { kind: "spawn-failed"; command: string; cause: string }
  | { kind: "stdio-protocol-error"; phase: "framing" | "json-parse" | "schema"; raw: string }
  | { kind: "jsonrpc-error"; code: number; message: string; method?: string }
  | { kind: "request-timeout"; method: string; timeoutMs: number }
  | { kind: "subprocess-crashed"; signal: NodeJS.Signals | null; exitCode: number | null; stderrTail: string }
  | { kind: "turn-not-completed"; threadId: string; reason: "abort" | "exit-before-complete" };

export type WorkspaceError =
  | { kind: "path-unsafe"; path: string }
  | { kind: "create-failed"; path: string; cause: string }
  | { kind: "hook-failed"; hook: "before_run" | "after_create" | "before_remove" | "after_run"; exitCode: number; stderrTail: string }
  | { kind: "hook-timeout"; hook: string; timeoutMs: number };

export type PromptError =
  | { kind: "template-parse-failed"; cause: string }
  | { kind: "render-failed"; cause: string; missingVariables?: string[] };

export type OrchestratorError =
  | { kind: "config"; error: ConfigError }
  | { kind: "tracker"; error: TrackerError }
  | { kind: "backend"; error: BackendError }
  | { kind: "workspace"; error: WorkspaceError }
  | { kind: "prompt"; error: PromptError }
  | { kind: "guardrail-missing"; flag: string };
```

### 運用方針

| エラー | 振る舞い |
|---|---|
| `before_run` / `after_create` 失敗 | issue を skip し、orchestrator は次 issue へ continue（symphony 互換） |
| `after_run` / `before_remove` 失敗 | log only、issue 結果は変えない（symphony `ignore_hook_failure`） |
| `subprocess-crashed` / `turn-not-completed` | issue 失敗。tracker への失敗 comment / `max_attempts` retry は Phase 6 |
| `guardrail-missing` | exit 2 で即終了、stderr に 1 行説明 |
| `stdio-protocol-error` / `jsonrpc-error` / `spawn-failed` | issue 失敗扱い、orchestrator 続行（Phase 6 で retry 検討） |
| 全 error 共通 | `cli/run.ts` 出口で `kind` 別に 1 行サマリ stderr 出力 |

### PII 保護

- `stderrTail` は 4KB ring buffer の末尾。subprocess の出力をそのまま乗せるため、Phase 2 では `util/redact.ts` を通さない（subprocess 内部の PII 制御は backend 側の責任）
- ただし error log に `WorkflowConfig` を直接乗せる経路は Phase 1 の `redactConfig()` を引き続き使う
- `linear.api_key` / `github.api_key` の redact は Phase 3 / 4 で具体的に効かせる

### ログ

Phase 1 の stdout 行ログを継続。Phase 2 で追加する行:

```
[hook after_create] exit=0 (123ms)
[backend claude] spawn pid=12345 command="claude-app-server --model ..."
[backend claude] initialize complete protocolVersion=...
[backend claude] thread-started thr_abc123
[backend claude] turn-started turn=1/10
[item agentMessage] ...
[item commandExecution] ...
[backend claude] turn-completed turn=1/10 (4321ms)
[orchestrator] MEMORY-1 -> Done
[backend claude] shutdown SIGTERM (pid=12345 exit=0)
```

ファイルロガーは Phase 6（`log_file.ex` 相当）。

---

## テスト戦略

### 配置

| 種類 | 配置 | 例 |
|---|---|---|
| Unit | in-source (`if (import.meta.vitest)`) | `backend/jsonrpc/client.ts`（mock transport で req/resp/notif/abort 検証）、`workspace/path.ts`、`workspace/hooks.ts`（child_process を stub）、`prompt/builder.ts`（liquidjs 変数展開・strict・継続 turn 文言）、`backend/claude.ts` / `backend/codex.ts`（spawn args 組み立てのみ）、`util/parse-command.ts` |
| Integration | `test/integration/` | `agent-runner` を fake backend（`inMemoryTransport` 経由の JsonRpcSubprocessClient）で動かし、max_turns ループ / 継続 turn / interrupt / tracker refetch を網羅 |
| E2E | `test/e2e/` | `child_process.spawn('conductor', [...])` |

### 新規 E2E 2 本

| ファイル | 内容 | skip 条件 |
|---|---|---|
| `test/e2e/conductor-claude-memory.test.ts` | `conductor --i-understand-... examples/workflow.claude-memory.md` を spawn → 実 claude-app-server が起動 → 1 issue が Done に到達。stdout を行ログで assert。120s timeout | Claude OAuth (`~/.claude/`) が無い、または `claude-app-server` が PATH に無い |
| `test/e2e/conductor-codex-memory.test.ts` | 同上 codex 版。120s timeout | `codex` CLI が PATH に無い、または Codex 認証が無い |

E2E 内で issue は memory tracker 上の 1 件のみ。prompt は「Hello World を README に書いて commit」程度の最小タスク。

### Test double 設計

`JsonRpcSubprocessClient` は `transport` を constructor 注入する形にし、unit / integration では `inMemoryTransport()` を渡す:

```ts
const { transport, controlSide } = inMemoryTransport();
const client = new JsonRpcSubprocessClient({ transport, logger });
// テスト側から controlSide.feedLine('{"jsonrpc":"2.0","method":"thread/started",...}') 等で driver
```

これで subprocess 起動なしで JSON-RPC ライフサイクル全パスを単体テスト可能。E2E のみ `subprocessTransport(spawnArgs)` の実 transport。

### 回帰維持

- `pnpm test:e2e:claude-linear` / `pnpm test:e2e:claude-github` は **symphony 起動のまま緑** を Phase 2 で維持
- Phase 1 で導入した `resolveBackendCommand` の API は変更しない（Phase 3 / 4 で `"conductor"` に切替える）

---

## インフラ作業

### WORKFLOW.md schema 訂正（Phase 1 のバグ修正）

Phase 1 で `hooks` を `workspace.hooks` に入れ子化したが、symphony と既存 `apps/e2e/workflow.claude-{linear,github}.md` は `hooks` が **top-level**。Phase 2 で訂正:

```yaml
# 修正後（symphony 互換）
workspace:
  root: /tmp/concert-e2e/workspaces

hooks:
  before_run: |
    ...
  after_create: |
    git init
    git config user.email "agent@concert.local"
  after_run: |
    ...
  before_remove: |
    ...
  timeout_ms: 60000
```

変更点:
- `src/domain/workspace-config.ts`: `hooks` を削除、`WorkspaceConfig` は `{ root: string }` のみ
- `src/domain/hooks-config.ts`（新規）: `HooksConfig = { beforeRun? / afterCreate? / beforeRemove? / afterRun? / timeoutMs? }`
- `src/domain/workflow-config.ts`: top-level `hooks?: HooksConfig` を追加
- `src/config/schema.ts`: `hooks:` を top-level に移動、`after_run` と `timeout_ms` 追加
- Phase 1 で書いた in-source test を新形式に書き直す

### `examples/workflow.mock-memory.md` の修正

Phase 1 で `workspace.hooks` 形式（に **見える** が、Phase 1 では mock のため hooks 自体不使用）。Phase 2 で top-level に移すか、そもそも `hooks` ブロックを削るか。`mock-memory.md` は workspace を使わないので `hooks` 自体を **書かない**ことで対応。

### 新規 `examples/workflow.claude-memory.md` / `examples/workflow.codex-memory.md`

```yaml
# workflow.claude-memory.md
---
agent:
  type: claude
  max_concurrent_agents: 1
  max_turns: 3

claude:
  command: claude-app-server --model claude-opus-4-7 --permission-mode bypassPermissions

tracker:
  kind: memory
  doing_state: In Progress
  done_state: Done

memory:
  issues:
    - id: MEMORY-1
      identifier: MEMORY-1
      title: Write hello world README
      description: Create README.md with "Hello World" and commit.
      state: Todo

workspace:
  root: /tmp/concert-conductor-e2e/workspaces

hooks:
  after_create: |
    git init
    git config user.email "agent@concert.local"
    git config user.name "Concert Agent"
  timeout_ms: 30000
---

You are working on issue {{ issue.identifier }}: {{ issue.title }}.

{{ issue.description }}

Steps:
1. Create README.md with "Hello World".
2. git add and commit with message "Initial commit".
```

```yaml
# workflow.codex-memory.md
---
agent:
  type: codex
  max_concurrent_agents: 1
  max_turns: 3

codex:
  command: codex --config shell_environment_policy.inherit=all --config 'model="gpt-5.5"' app-server
  approval_policy: never
  thread_sandbox: workspace-write
  turn_sandbox_policy:
    type: workspaceWrite

tracker:
  kind: memory
  doing_state: In Progress
  done_state: Done

memory:
  issues:
    - id: MEMORY-1
      identifier: MEMORY-1
      title: Write hello world README
      description: Create README.md with "Hello World" and commit.
      state: Todo

workspace:
  root: /tmp/concert-conductor-e2e/workspaces

hooks:
  after_create: |
    git init
    git config user.email "agent@concert.local"
    git config user.name "Concert Agent"
  timeout_ms: 30000
---

You are working on issue {{ issue.identifier }}: {{ issue.title }}.

{{ issue.description }}

Steps:
1. Create README.md with "Hello World".
2. git add and commit with message "Initial commit".
```

---

## CLI 表面

```
$ conductor --i-understand-that-this-will-be-running-without-the-usual-guardrails <workflow.md>
$ conductor --help
$ conductor --version
```

Phase 1 では mock 限定で guardrail flag を省略していたが、Phase 2 から **実 backend を spawn する** ため必須化。`mock-memory.md` の E2E でも flag を付ける。

---

## ドキュメント更新（Phase 2 範囲）

| ファイル | 更新内容 |
|---|---|
| [`apps/conductor/CLAUDE.md`](../../../apps/conductor/CLAUDE.md) | Phase 2 完了範囲を 1 段落追記。並行モデル / JSON-RPC 型方針 / SSH 不サポートを明記 |
| [`apps/conductor/README.md`](../../../apps/conductor/README.md) | 実 backend 起動の最小例を追加（claude / codex 両方）。`hooks` top-level 例 |
| ルート [`CLAUDE.md`](../../../CLAUDE.md) 「WORKFLOW.md スキーマ」 | `hooks` が top-level であることを明示（Phase 1 で文章上は曖昧だった） |
| ルート [`CLAUDE.md`](../../../CLAUDE.md) | conductor の Phase 2 進捗を 1 行追記 |
| [`docs/architecture.md`](../../architecture.md) | conductor の subprocess + JSON-RPC の図を追加（symphony 図と並べる） |
| [`TODO.md`](../../../TODO.md) Milestone 3 Phase 2 | 進捗チェックボックスを実装フェーズで update |

---

## 作業順序（ボトムアップ）

1. `src/domain/hooks-config.ts` 新設 + `workspace-config.ts` / `workflow-config.ts` 訂正 + in-source test 書き直し
2. `src/config/schema.ts` で `hooks` を top-level に移動 + `after_run` / `timeout_ms` 追加 + Phase 1 test を新形式に
3. `src/util/parse-command.ts` + in-source test
4. `src/backend/jsonrpc/transport.ts` (in-memory + subprocess) + in-source test
5. `src/backend/jsonrpc/messages.ts` + valibot schema + in-source test
6. `src/backend/jsonrpc/errors.ts`
7. `src/backend/jsonrpc/client.ts` (initialize → startThread → runTurn → shutdown → interrupt) + in-source test（mock transport で全パス）
8. `src/backend/types.ts` を session ベースに更新
9. `src/backend/mock.ts` を session ベースに移行 + Phase 1 test 書き直し
10. `src/backend/claude.ts` + in-source test（spawn args 組み立てだけ）
11. `src/backend/codex.ts` + in-source test
12. `src/workspace/path.ts` + in-source test
13. `src/workspace/hooks.ts` + in-source test（child_process stub）
14. `src/workspace/manager.ts` + in-source test
15. `src/prompt/builder.ts` + in-source test（liquidjs / 継続 turn 文言）
16. `src/orchestrator/agent-runner.ts` 拡張 + in-source test
17. `src/orchestrator/orchestrator.ts` 配線更新
18. `src/cli/run.ts` で guardrail flag 必須化
19. `examples/workflow.mock-memory.md` 形式統一、`examples/workflow.claude-memory.md` / `workflow.codex-memory.md` 新規
20. `test/integration/` に max_turns ループ + interrupt の統合テスト
21. `test/e2e/conductor-claude-memory.test.ts` + `test/e2e/conductor-codex-memory.test.ts`
22. ドキュメント update（CLAUDE.md / README.md / docs/architecture.md / TODO.md）

---

## リスクと緩和策

| リスク | 影響 | 緩和策 |
|---|---|---|
| `JsonRpcSubprocessClient` の req/resp マッチングと notification subscribe を 1 つの client に混ぜると lifecycle 不整合が出やすい | Phase 2 デバッグが長引く、Phase 5 で event bus 化する際に書き直し | `lifecycle` ステートを enum で明示し、状態に応じた method 呼び出し制約を assert（throw、外部入力ではないので Result 不要）。`runTurn` 中の notification は handler 経由でしか出さない |
| `turn/interrupt` の挙動が backend ごとに微妙に違う | SIGINT 時の挙動が claude / codex で不一致になり、E2E がフレーキー | `interrupt()` を `turn/interrupt 送信 → 5s timeout → SIGTERM → 5s → SIGKILL` の段階的シャットダウンに統一。各段階の wait は config 化可能にしておく（Phase 6 で調整余地） |
| Phase 1 で誤った `workspace.hooks` schema を引きずる | 既存 mock-memory test の更新もれで Phase 2 build が壊れる | スキーマ修正を作業順序 1-2 に置き、Phase 1 test を全件書き直してから次に進む |
| guardrail flag を required にすると Phase 1 mock E2E が壊れる | 既存 conductor CLI E2E が壊れる | Phase 1 の `test/e2e/conductor-cli.test.ts` も flag 付きに更新する（作業順序 18 と同時） |
| codex CLI / Claude OAuth の有無で E2E が CI で flaky | E2E が green / skip で安定しない | skip 条件を明示し、ローカルでは両方緑、CI では skip 許容を docs に明記。Phase 2 の完了判定はローカル green でも OK |
| liquidjs の strict_variables が symphony の Solid と微妙に挙動差を持つ | prompt が一部の workflow で render fail | `prompt/builder.ts` の test で symphony が許す変数欠落パターン（例: `issue.assignee` が null）を網羅し、`{{ issue.assignee | default: "" }}` 等の Liquid 文法で吸収する形に統一。継続 turn 文言は liquidjs を通さず TS リテラルで symphony 1:1 |
| `backend/types.ts` を session ベースに変えると Phase 1 mock backend / test の影響が広い | Phase 1 で書いた既存テストが多数壊れる、リファクタが長期化 | 作業順序 8-9 で先に mock を session ベースに移行し、in-source test を書き直してから claude / codex の実装に進む。Phase 1 test の green を中継点とする |

---

## 参考資料

- 親 spec [`2026-05-15-m3-overview-design.md`](2026-05-15-m3-overview-design.md)
- 前 Phase spec [`2026-05-16-m3-phase1-design.md`](2026-05-16-m3-phase1-design.md)
- [`TODO.md`](../../../TODO.md) Milestone 3 Phase 2
- ルート [`CLAUDE.md`](../../../CLAUDE.md)
- [`apps/conductor/CLAUDE.md`](../../../apps/conductor/CLAUDE.md)
- [`apps/claude-app-server/CLAUDE.md`](../../../apps/claude-app-server/CLAUDE.md)
- [`docs/architecture.md`](../../architecture.md)
- [`docs/protocol.md`](../../protocol.md)
- [ADR-0004 agent.type backend selection](../../adr/0004-agent-type-backend-selection.md)
- [ADR-0008 symphony → conductor migration](../../adr/0008-symphony-to-conductor-migration.md)
- 移植元: [`apps/symphony/lib/symphony_elixir/agent_runner.ex`](../../../apps/symphony/lib/symphony_elixir/agent_runner.ex), [`workspace.ex`](../../../apps/symphony/lib/symphony_elixir/workspace.ex), [`prompt_builder.ex`](../../../apps/symphony/lib/symphony_elixir/prompt_builder.ex), [`codex/app_server.ex`](../../../apps/symphony/lib/symphony_elixir/codex/app_server.ex)
