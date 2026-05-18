# M3 Phase 6: 並列実行 / Retry / Edge cases パリティ — 設計書

**日付:** 2026-05-17
**対象:** [`TODO.md`](../../../TODO.md) Milestone 3 / Phase 6
**前提:** [M3 overview](2026-05-15-m3-overview-design.md) / [Phase 5 完了](2026-05-17-m3-phase5-design.md)
**ステータス:** 設計確定、実装計画 (`writing-plans`) 着手待ち

---

## 背景

`apps/symphony/lib/symphony_elixir/orchestrator.ex` (1,826 行) と `agent_runner.ex` / `log_file.ex` を TS で書き直し、`apps/conductor` が **並列 dispatch + retry backoff + stall 検知 + 異常系ハンドリング + ファイルロガー** までのパリティを取る。Phase 5 で TUI dashboard + observability state が入ったことで、Scheduler が状態を書き込む先と event bus は既に揃っている。

現状の `orchestrator.ts` は逐次 `for` ループで 1 issue ずつ処理する skeleton。Phase 6 で **GenServer 相当の Scheduler** に書き換える。

---

## スコープ

### in

- 並列 dispatch スケジューラ (`p-queue` で `agent.max_concurrent_agents` 上限)
- per-state 並行上限 (`agent.max_concurrent_agents_by_state`)
- priority sort (1〜4 → 5 default) + createdAt tiebreaker
- blocker skip (`Todo` issue + non-terminal blocker)
- assigned_to_worker filter
- continuation_retry (1s 固定) + failure_retry (10s base × 2^attempt、`max_retry_backoff_ms` cap)
- stall 検知 + restart (`agent_session_stall_timeout_ms` default 30 min)
- Backend session の終了判定統合 (`turn/completed` / subprocess exit / abort の Promise.race)
- Tracker API timeout (15s、AbortController.timeout)
- ファイルロガー (pino + pino-roll + pino-pretty、JSON 出力、size-based wrap rotation)
- WORKFLOW.md スキーマ拡張 (`agent.max_retry_backoff_ms` / `agent.agent_session_stall_timeout_ms` / `agent.max_concurrent_agents_by_state` / `polling:` / `logging:`)
- Issue domain 拡張 (priority / createdAt / blockedBy / assignedToWorker / assigneeId)
- Linear / GitHub / Memory tracker adapter を 5 フィールド populate に対応
- Symphony orchestrator の behaviour test を conductor 側で再現

### out

- `worker.ssh_hosts` 並列 (Phase 2 で M4+ 送り確定)
- `current_command` / `current_model` ダッシュボード表示 (state 別 backend 切替前提のため M4+)
- Issue.url / Issue.branchName (symphony でも dead field、M4+ 送り)
- Web ダッシュボード (M4+)
- claude-app-server 側の token streaming (M4+ の `tokenUsage/updated` 待ち)

### 成功基準

- `pnpm --filter conductor test` 全部緑 (新規 integration test 含む)
- `pnpm test:e2e:claude-linear` / `:claude-github` が引き続き緑
- Memory tracker で 2 issue を同時 dispatch して `max_concurrent_agents: 2` 並列で完了することを E2E で確認
- mock backend `force_fail` で failure_retry が exponential backoff でスケジュールされることを integration test で確認
- 模擬 stall (lastActivity を進めず 30 分経過扱い) で issue が restart されることを integration test で確認
- `log/conductor.log` に JSON で書き込まれ、10MB × 5 files で rotate することを確認

---

## 確定事項 (ブレスト結果)

### スコープ: フル parity

symphony orchestrator の振る舞いをすべて移植する。Phase 7 で symphony を削除する際に「振る舞いが完全に揃っているから安全に消せる」と判断できる粒度。`worker.ssh_hosts` のみ Phase 2 で M4+ 送り済。

### 並行モデル: `p-queue` + `p-retry`

Phase 2 の「plain async + AbortController」を骨格として保ちつつ、concurrency 上限と exponential backoff という 2 大ボイラープレートを枯れた小型 lib に外出し。

- **`p-queue`**: `new PQueue({ concurrency: agent.max_concurrent_agents })`、`queue.add(() => dispatchIssue(issue))` で並列実行。サイズ 30KB、API は 3 関数
- **`p-retry`**: `pRetry(fn, { retries, factor, minTimeout, maxTimeout })` で exponential。tracker adapter の既存 3-attempts retry も統一化候補
- 既存スタック (valibot / byethrow / commander / pino) と同じ哲学（小さく枯れた lib のスタック）

rxjs / Effect-TS / nact は却下。

### Retry ポリシー: symphony verbatim

| 種別 | 起動条件 | delay 計算 |
|---|---|---|
| **continuation_retry** | AgentRunner が normal exit (== `turn/completed` + issue がまだ active) | 1,000ms 固定 |
| **failure_retry** | AgentRunner が異常 exit (subprocess crash / network / abort 以外) | `min(10_000 × 2^min(attempt-1, 10), max_retry_backoff_ms)` (default cap 300,000ms) |

continuation 経由で再 dispatch すると新 session が立ち上がる → 実質 `max_turns × N` 回まで turn を続けられる。Symphony と同じ振る舞い。

### Logger: pino + pino-roll + pino-pretty

- ファイル出力は **JSON** (`{level, time, msg, issueId?, identifier?, ...}`)。AI 視点で jq クエリが reliable に書ける、本文の escape 不要
- size-based wrap rotation: pino-roll で `size: '10mb', limit: { count: 5 }`
- `CONDUCTOR_DEBUG=1` で stderr に pino-pretty 整形 (人間 skim 用)
- dashboard ON 時は stderr no-op に差し替え (Phase 5 既存) + file logger へ flush
- 依存追加 +80KB (pino: 60KB / pino-roll: 5KB / pino-pretty: 15KB、production は pino-pretty は dev 依存も可)

### Issue domain 拡張: 5 フィールド

`priority` / `createdAt` / `blockedBy` / `assignedToWorker` / `assigneeId` のみ追加。`url` / `branchName` は symphony でも populate のみで runtime コードから使われていないため M4+ 送り。

### 異常系: Promise.race + Tracker timeout 15s

| 異常 | 検知 | 経路 |
|---|---|---|
| subprocess exit ≠ 0 (turn 中) | runTurn 内 Promise.race で `exitPromise` 勝利 | session-exited-mid-turn → failure_retry |
| subprocess exit = 0 (turn 後 / 全 turn 完了) | runTurn 後 AgentRunner 自然終了 | continuation_retry (issue がまだ active なら) |
| AbortSignal aborted | runTurn 内 Promise.race で `abortPromise` 勝利 | turn 強制終了 → outer ループ break、claim は orchestrator shutdown で全解除 |
| Tracker API network 失敗 / timeout | `AbortController.timeout(15_000)` + 3-attempts retry (既存 Phase 3/4) | 全失敗 → orchestrator の failure_retry へ |
| Tracker API: 不在 issue (fetch_issue が empty) | scheduler の `handle_retry_issue_lookup` 相当 | claim 解除のみ (terminal 化済み or 不可視) |

timeout 15s は symphony の Finch/Mint デフォルト `receive_timeout` (15s) と一致させた値。

---

## アーキテクチャ概要

```
                  ┌──────────────────────────────────────────┐
                  │            Orchestrator (Scheduler)      │
                  │                                          │
  tick (5s) ────▶ │  pumpCycle()                             │
                  │    ├─ reconcileRunning() (stall + state) │
                  │    ├─ fetchCandidates()                  │
                  │    ├─ dispatch-filter.selectDispatchable │
                  │    │   (sort + blocker + assignee +      │
                  │    │    perStateLimit + claimed)         │
                  │    └─ queue.add(() => dispatchIssue(i))  │
                  │                                          │
  retry timer ──▶ │  handleRetry(issueId)                    │
  child exit ───▶ │  handleSessionExit(issueId, code)        │
                  │                                          │
                  │  state: running Map / claimed Set /      │
                  │         retryAttempts Map / queue        │
                  │  (Phase 5 ObservabilityState と共有)     │
                  └────────────┬─────────────────────────────┘
                               │ queue.add → dispatchIssue
                               ▼
                  ┌──────────────────────────────────────────┐
                  │   AgentRunner (per issue, async fn)      │
                  │   - workspace ensure + before_run hook   │
                  │   - backend.startSession                 │
                  │   - turn loop (max_turns)                │
                  │     └ Promise.race(turn/completed,       │
                  │                    session exit, abort)  │
                  │   - doneState mutation + after_run hook  │
                  └──────────────────────────────────────────┘
```

---

## モジュール構成 (新規 / 修正)

| パス | 種別 | 内容 |
|---|---|---|
| `src/orchestrator/scheduler.ts` | **新規** | `Scheduler` クラス。pumpCycle / reconcileRunning / dispatchIssue / handleRetry / handleSessionExit |
| `src/orchestrator/dispatch-filter.ts` | **新規** | pure 関数群: `sortByPriorityThenCreatedAt`, `isBlockerSkippable`, `selectDispatchable`。in-source test |
| `src/orchestrator/retry-policy.ts` | **新規** | `continuationDelay()` / `failureDelay(attempt, maxBackoffMs)` の数値計算のみ。in-source test |
| `src/orchestrator/orchestrator.ts` | **書き換え** | 現状の `for` loop を Scheduler 起動 + abort 待ちに置換 |
| `src/orchestrator/agent-runner.ts` | **修正** | turn loop の Promise.race を 3 ソース統合、session-exited-mid-turn / aborted エラー追加 |
| `src/backend/types.ts` | **修正** | `BackendSession` interface に `exitPromise: Promise<{code, signal}>` 追加 |
| `src/backend/jsonrpc/session.ts` | **修正** | child exit 通知、`runTurn` を Promise.race 化 |
| `src/backend/mock.ts` | **修正** | `mock.force_fail` / `mock.delay_ms` のほか、`mock.exit_mid_turn` を test 用に追加 (in-source) |
| `src/observability/state.ts` | **修正** | scheduler が直接 mutate する API を追加 (Phase 5 の Hook 経由から橋渡し) |
| `src/util/file-logger.ts` | **新規** | pino + pino-roll 設定。`createFileLogger(path, maxSizeMb, maxFiles)` |
| `src/util/logger.ts` | **修正** | `createStdLogger` / `createNullLogger` / `createFileLogger` の 3 形態を export |
| `src/cli/run.ts` / `src/bin.ts` | **修正** | `--no-dashboard` でない & TTY なら file logger 起動 |
| `src/domain/issue.ts` | **修正** | priority / createdAt / blockedBy / assignedToWorker / assigneeId 追加 |
| `src/domain/orchestrator-errors.ts` | **修正** | `session-exited-mid-turn` / `aborted` / `tracker-timeout` / `stall-restart` 追加 |
| `src/domain/workflow-config.ts` | **修正** | `agent.max_retry_backoff_ms` / `agent.agent_session_stall_timeout_ms` / `agent.max_concurrent_agents_by_state` / `polling.intervalMs` / `logging.file.{path, maxSizeMb, maxFiles}` |
| `src/tracker/linear/{client,queries,adapter}.ts` | **修正** | 5 フィールド populate (`priority` / `createdAt` / `assigneeId` / `blockedBy`)、fetch に 15s timeout |
| `src/tracker/github/{client,queries,adapter}.ts` | **修正** | 同上 (ただし `blockedBy: []` 固定、sub-issue API は symphony parity 対象外) |
| `src/tracker/memory/adapter.ts` + Memory YAML schema | **修正** | 上記 5 フィールド optional 受付け |
| `src/config/schema.ts` | **修正** | logging block の transform で path を絶対化、isAbsolute 検証 |

### モジュール責務の分離方針

- **Scheduler** は「dispatch するかしないか」「retry をいつ起動するか」を判定。AgentRunner は「1 issue を端から端まで走らせる」。両者は Map mutation + EventBus (Phase 5) で通信
- **dispatch-filter.ts** は pure 関数のみ。Scheduler から分離してテストしやすく
- **retry-policy.ts** は数値計算のみ。timer 起動は Scheduler 内
- **file-logger.ts** は pino インスタンス生成のみ。logger interface (`info` / `warn` / `error`) は Phase 5 のまま

---

## データフローと Retry セマンティクス

### Scheduler State

```ts
class Scheduler {
  private running: Map<IssueId, RunningEntry>;    // dispatch 済み (Phase 5 state と共有)
  private claimed: Set<IssueId>;                  // dispatch 中 or retry 待ち (重複防止)
  private retryAttempts: Map<IssueId, RetryEntry>; // 各 issue の attempt 数と timer
  private queue: PQueue;                          // concurrency: agent.max_concurrent_agents
  private pollTimer: NodeJS.Timeout | null;
  private bus: EventEmitter;                      // 'wake' で pump 即時起動
}

type RetryEntry = {
  attempt: number;
  delayType: "continuation" | "failure";
  timerRef: NodeJS.Timeout;
  retryToken: symbol;        // stale timer 検知 (symphony の retry_token 相当)
  dueAtMs: number;
  identifier: IssueIdentifier;
  error: string | null;
};
```

### Pump cycle (1 tick = `polling.intervalMs` = default 5,000ms)

```
pumpCycle()
  ├─ 1. reconcileRunning()
  │       ├─ stallCheck: now - lastActivityAt > stall_timeout
  │       │     → terminate running + scheduleFailureRetry(attempt+1)
  │       └─ tracker.fetchIssueStatesByIds(running.keys, timeout=15s)
  │           ├─ terminal 化 → terminateRunningIssue (workspace cleanup)
  │           ├─ assigned_to_worker = false → terminateRunningIssue (workspace 保持)
  │           ├─ active のまま → updateRunningState (UI 反映)
  │           └─ active 以外の非 terminal → terminateRunningIssue (workspace 保持)
  │
  ├─ 2. fetchCandidates() (tracker.fetchCandidateIssues, 15s timeout, 既存 3-attempts)
  │
  ├─ 3. dispatch-filter.selectDispatchable(candidates, state)
  │       ├─ sort: priority (1-4, 他は 5) → createdAt 昇順 → identifier
  │       └─ filter (各 issue):
  │            ├─ !claimed.has(id) && !running.has(id)
  │            ├─ assigned_to_worker === true
  │            ├─ active state に居る
  │            ├─ Todo && blocked_by に非 terminal があれば skip
  │            ├─ running の per-state count < max_concurrent_agents_by_state[state] (未設定なら max_concurrent_agents)
  │            └─ queue.size + queue.pending < max_concurrent_agents
  │
  └─ 4. queue.add(() => dispatchIssue(issue)) を選抜分だけ
         └─ dispatchIssue:
              ├─ revalidate (再度 fetch_issue_states_by_ids で stale チェック)
              ├─ claimed.add(id); running.set(id, fresh entry)
              ├─ doingState mutation (ADR-0014)
              ├─ AgentRunner.run(issue, signal)
              │   ├─ resolve → "session exited normally"
              │   └─ reject  → "session failed (error)"
              └─ handleSessionExit:
                    ├─ normal → scheduleContinuationRetry(1s)
                    └─ failure → scheduleFailureRetry(exponential)
```

### Retry delay (symphony verbatim)

```ts
const CONTINUATION_RETRY_DELAY_MS = 1_000;
const FAILURE_RETRY_BASE_MS = 10_000;
const FAILURE_RETRY_MAX_POWER = 10;  // 2^10 = 1024 倍まで

function retryDelay(
  attempt: number,
  delayType: "continuation" | "failure",
  maxBackoffMs: number,
): number {
  if (delayType === "continuation" && attempt === 1) {
    return CONTINUATION_RETRY_DELAY_MS;
  }
  const power = Math.min(attempt - 1, FAILURE_RETRY_MAX_POWER);
  return Math.min(FAILURE_RETRY_BASE_MS * (1 << power), maxBackoffMs);
}
```

### handleRetry (timer 発火時)

1. `popRetryAttemptState(issueId, retryToken)` で stale (再スケジュールで上書きされた古い timer) を破棄
2. `tracker.fetchCandidateIssues()` で最新の issue を取得
3. issue が terminal → claim 解除 + workspace cleanup + **retryAttempts から削除** (symphony `complete_issue` 相当)
4. issue が非 active (Done など) → claim 解除のみ + retryAttempts 削除
5. issue が active かつ slot 空き → `dispatchIssue` を queue に積む (dispatch 成功時に retryAttempts 削除、symphony `do_dispatch_issue` 相当)
6. issue が active だが slot 不足 → 次の attempt で再スケジュール (`scheduleFailureRetry(attempt+1)`)

### retryAttempts のリセットタイミング

| イベント | リセット動作 |
|---|---|
| terminal 化 (Done など) | `retryAttempts.delete(id)` + `claimed.delete(id)` |
| 非 active で非 terminal (canceled 等) | 同上 |
| `dispatchIssue` 成功 (running に登録) | `retryAttempts.delete(id)` のみ。dispatch 失敗の時のために claimed は保持 |
| continuation_retry → 再 dispatch 成功 | 上記と同様 |
| failure_retry → 再 dispatch 成功 | 上記と同様 (attempt は捨てる) |
| **再 dispatch せず再 retry** | retryAttempts に新 attempt+1 entry が上書き保存 (古い timer は cancel) |

### Continuation retry の効果

- AgentRunner が normal exit (1 turn 完了 + ADR-0014 で done 確定) → scheduler は 1 秒後に再度 fetchCandidateIssues
- 同じ issue がまだ active state なら新セッションで再開 → 実質 `max_turns × N`
- terminal 化済みなら claim 解除

### Stall 検知 (`agent_session_stall_timeout_ms`、default 30 min)

```ts
type RunningEntry = { ...; lastActivityAt: Date };   // turn event のたびに更新

// reconcileRunning() 内:
const elapsedMs = now - entry.lastActivityAt.getTime();
if (elapsedMs > config.agent.agentSessionStallTimeoutMs) {
  logger.warn(`stalled: ${entry.identifier} elapsed=${elapsedMs}ms; restarting with backoff`);
  await session.shutdown();          // SIGTERM → 5s 後 SIGKILL fallback
  scheduler.terminateRunning(id);
  scheduleFailureRetry(id, attempt + 1);
}
```

### Backend session interface (Phase 6)

```ts
interface BackendSession {
  runTurn(input): Promise<Result<TurnSuccess, BackendError>>;
  shutdown(): Promise<void>;
  interrupt(): Promise<void>;
  readonly exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}
```

- `runTurn` 内部で `Promise.race([turnCompletedPromise, exitPromise, abortPromise])`
- AgentRunner 側でも turn ループ間の subprocess 早期 exit を捕捉するため `await Promise.race([runTurnP, exitP])` で 2 重ガード

---

## 設定スキーマ拡張 (WORKFLOW.md)

```yaml
agent:
  type: claude              # 既存
  max_concurrent_agents: 2  # 既存
  max_turns: 10             # 既存
  max_retry_backoff_ms: 300000               # 新規 default 300_000 (5min)
  agent_session_stall_timeout_ms: 1800000    # 新規 default 1_800_000 (30min)
  max_concurrent_agents_by_state:            # 新規 default {} (= 全 state 共通)
    "In Progress": 2
    "In Review": 1

# 新規 top-level ブロック
polling:
  interval_ms: 5000        # default 5_000

# 新規 top-level ブロック
logging:
  file:
    path: /workspace/log/conductor.log   # 絶対パス必須、未指定なら process.cwd() + 'log/conductor.log' で絶対化
    max_size_mb: 10                       # default 10
    max_files: 5                          # default 5
```

### `logging.file.path` のルール (workspace.root と同じ流儀)

- ユーザ指定: **絶対パス必須**。相対なら `path-unsafe` Failure (`workspacePathFor` の `isAbsolute` 検証と同じ)
- 未指定: config 読込時に `path.resolve(process.cwd(), "log/conductor.log")` で絶対化
- 検証タイミング: `src/config/schema.ts` の valibot transform 内
- 親ディレクトリの自動作成: pino-roll が起動時に行う (`mkdirSync(recursive: true)`)

### Issue domain schema (`src/domain/issue.ts`)

```ts
const PriorityValue = v.union([v.literal(1), v.literal(2), v.literal(3), v.literal(4)]);

export const Issue = v.object({
  id: IssueId.schema,
  identifier: IssueIdentifier.schema,
  title: v.string(),
  description: v.string(),
  state: IssueStateName.schema,
  priority: v.nullable(PriorityValue),
  createdAt: v.nullable(v.date()),
  assigneeId: v.nullable(v.string()),
  assignedToWorker: v.boolean(),
  blockedBy: v.array(v.object({
    id: IssueId.schema,
    state: IssueStateName.schema,
  })),
  extra: v.optional(IssueExtra.schema),
});
```

Memory tracker YAML schema も 5 フィールドを optional 受付。`assigned_to_worker` 未指定なら `true`、`blocked_by` 未指定なら `[]`、他は `null`。

---

## テスト戦略

### Unit tests (in-source `import.meta.vitest`)

| ファイル | テスト対象 |
|---|---|
| `dispatch-filter.ts` | sort 順 / blocker skip / per-state limit / assigned_to_worker / claimed 重複防止 |
| `retry-policy.ts` | continuation = 1s / failure exponential / cap = max_retry_backoff_ms / 大 attempt で overflow しない |
| `file-logger.ts` | JSON 出力 / rotation 起動 / pino-pretty stderr 切替 |
| `scheduler.ts` (in-source) | tick pump / EventBus wake / queue concurrency / claimed 管理 |
| `agent-runner.ts` (既存修正) | Promise.race の 3 ソース統合 / session-exited-mid-turn → Failure |

### Integration tests (`test/integration/`)

| ファイル | シナリオ |
|---|---|
| `scheduler-parallel-dispatch.test.ts` | **新規** Memory tracker + mock backend、2 issue を `max_concurrent_agents: 2` で同時 dispatch |
| `scheduler-retry-on-failure.test.ts` | **新規** mock `force_fail` → failure_retry が 10s 後 (vi.useFakeTimers) にスケジュール、attempt 増加で 20s, 40s ... 検証 |
| `scheduler-continuation-retry.test.ts` | **新規** AgentRunner normal exit + active のまま → 1s 後に再 dispatch、新 session 起動 |
| `scheduler-stall-restart.test.ts` | **新規** mock backend で turn 通知を送らない → 模擬 stall → restart 後 attempt+1 で再 dispatch |
| `scheduler-blocker-skip.test.ts` | **新規** Memory tracker で blocked_by 持つ Todo issue → fetchCandidate に含まれても dispatch されない |
| `scheduler-priority-sort.test.ts` | **新規** priority 1, 3, null, 2, 4 の 5 issue → dispatch 順検証 |
| `file-logger-rotation.test.ts` | **新規** 10MB 強の書き込みで rotation 発生、5 ファイル超で古いものが削除 |
| `tracker-timeout.test.ts` | **新規** Linear/GitHub mock を 16s 遅延 → 15s timeout で Failure → retry 経路 |

### E2E tests (`test/e2e/`)

| ファイル | 状態 |
|---|---|
| `conductor-claude-memory.test.ts` | 既存、引き続き緑 (Scheduler 経路) |
| `conductor-codex-memory.test.ts` | 既存、引き続き緑 |
| `conductor-cli.test.ts` | 既存 |
| `apps/e2e/claude-linear.ts` / `claude-github.ts` | 既存、`--no-dashboard` + Scheduler 経路で緑 |

### Symphony test の移植マッピング

| symphony test | conductor 移植先 |
|---|---|
| `orchestrator_test.exs` の `sort_issues_for_dispatch_for_test` | `dispatch-filter.ts` in-source |
| `orchestrator_test.exs` の `should_dispatch_issue_for_test` (per-state / blocker / assignee) | `dispatch-filter.ts` in-source |
| `orchestrator_test.exs` の retry scheduling | `retry-policy.ts` in-source + `scheduler-*-retry.test.ts` |
| `orchestrator_test.exs` の stall restart | `scheduler-stall-restart.test.ts` |
| `orchestrator_test.exs` の `reconcile_issue_states_for_test` | `scheduler.ts` in-source |

symphony 1,826 行は GenServer message handling 詳細を含む。**behaviour 観点で移植**（メッセージ駆動の internal は再現せず、Scheduler API レベルで等価な振る舞いを保証）。

---

## 実装順 (依存関係順)

0. **package.json に依存追加**: `pnpm --filter conductor add p-queue p-retry pino pino-roll pino-pretty`
1. **Issue domain 拡張** + tracker adapter populate + Memory YAML schema
2. **dispatch-filter.ts** (pure 関数、unit test 並走)
3. **retry-policy.ts** (delay 計算、unit test)
4. **file-logger.ts** (pino 設定) + `logger.ts` 拡張
5. **WORKFLOW.md schema 拡張** (agent.* / polling / logging)
6. **Backend session interface 拡張** (`exitPromise`、`runTurn` の Promise.race 化)
7. **AgentRunner 改修** (3 ソース race、session-exited-mid-turn / aborted Failure)
8. **scheduler.ts** 本体 (p-queue + retry timer + pump cycle)
9. **orchestrator.ts** を Scheduler 駆動に書き換え
10. **Stall 検知** + reconcileRunning
11. **Integration / E2E test 群**
12. **ドキュメント sweep** (`apps/conductor/CLAUDE.md` Phase 6 status / TODO.md / README)

---

## 依存追加サマリ

| パッケージ | バージョン目安 | サイズ | 用途 |
|---|---|---|---|
| `p-queue` | ^8.x | ~30KB | concurrency 上限 |
| `p-retry` | ^6.x | ~5KB | exponential backoff (tracker adapter の既存 3-attempts retry もここに統一する可能性) |
| `pino` | ^9.x | ~60KB | JSON logger |
| `pino-roll` | ^3.x | ~5KB | size-based rotation |
| `pino-pretty` | ^11.x | ~15KB | CONDUCTOR_DEBUG=1 用 (dev / runtime 両用) |

すべて MIT、メンテ active、依存は少。

---

## 不確実性 / 実装中に確認しうる事項

- **pino-roll の rotation 挙動**: 10MB ちょうどで切るか少しオーバーランするか、log lib のドキュメント確認。Phase 6 では integration test で「rotation 発生したかどうか」だけ assert する想定
- **p-queue の add 中に concurrency を動的に変える**: `agent.max_concurrent_agents` を WORKFLOW.md 編集後 hot-reload するか。Phase 6 では **しない**（再起動前提）。M4+ で考慮
- **stall 検知の `lastActivityAt` の粒度**: `item/agentMessage/delta` のような高頻度 event も lastActivityAt を更新するか。symphony は更新している → conductor も同じ
- **continuation_retry の token usage 集計**: 新 session でリセットされるか累積か。symphony は累積 (issue 単位で `codexTotalTokens` を持ち越し)。Phase 5 の state.ts ですでに累積仕様
- **Backend session の `exitPromise` を mock backend でも提供**: mock は subprocess を持たないので、`Promise.resolve({ code: 0, signal: null })` を session 終了時に解決する形で fake する

---

## 参考資料

- [TODO.md](../../../TODO.md) Milestone 3 / Phase 6
- [M3 overview](2026-05-15-m3-overview-design.md)
- [M3 Phase 5 spec](2026-05-17-m3-phase5-design.md)
- 移植元: `apps/symphony/lib/symphony_elixir/orchestrator.ex` (1,826 行) / `agent_runner.ex` / `log_file.ex`
- ADR-0014: Symphony-owned state transitions (Phase 3 で実装済、Phase 6 でも継承)
