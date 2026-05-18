# M3 Phase 5: TUI dashboard + observability — 設計書

**日付:** 2026-05-17
**対象:** [`TODO.md`](../../../TODO.md) Milestone 3 / Phase 5
**前提:** [M3 overview](2026-05-15-m3-overview-design.md) / [Phase 4 完了](2026-05-17-m3-phase4-design.md)
**ステータス:** 設計確定、実装計画 (`writing-plans`) 着手待ち

---

## 背景

`apps/symphony/lib/symphony_elixir/status_dashboard.ex` (1,952 行) と `apps/symphony/lib/symphony_elixir_web/observability_pubsub.ex` を TS で書き直し、`apps/conductor` が同等の TUI ダッシュボードを持つ状態にする。Web ダッシュボード (`SymphonyElixirWeb.DashboardLive`) は M4+ 送り。

現状の conductor は逐次 `for` ループ + Logger (stderr) のみ。orchestrator の状態保持機構が無いため、Phase 5 では **observable state holder + event bus + TUI レンダラ** をまとめて入れる。Phase 6 で並列スケジューラを足す際の下地にもなる。

---

## スコープ

### in

- `src/observability/` 配下のモジュール群: state holder / event bus / dashboard driver / ANSI レンダラ
- WORKFLOW.md `observability:` ブロック (`dashboard_enabled` / `refresh_ms` / `render_interval_ms`) のスキーマ追加
- CLI `--no-dashboard` flag、`CONDUCTOR_DEBUG=1` 環境変数による toggle
- `bin.ts` / `cli/run.ts` で dashboard start/stop の lifecycle 統合
- Orchestrator / AgentRunner / BackendSession に observability hook を挿す
- codex `turn/completed` の `usage` payload から token tracking (claude-app-server は M4+ までゼロ固定)
- byte-for-byte parity を担保する snapshot fixture + parity test + 開発時 live diff script
- `dashboard` ON 時は stderr logger を no-op に差し替え (file logger は Phase 6)

### out

- Web ダッシュボード (`SymphonyElixirWeb.DashboardLive` 相当) — M4+
- claude-app-server streaming + `tokenUsage/updated` 通知 — M4+ (TODO.md 既存項目)
- ファイルロガー (`log_file.ex` 相当) — Phase 6
- 並列スケジューラ / retry backoff の本体 — Phase 6 (Phase 5 は state holder のプレースホルダのみ)
- `current_command` / `current_model` 表示 (state 別 backend 切替に紐づくため) — M4+

### 成功基準

- `conductor --dashboard examples/workflow.mock-memory.md` で symphony 同等の TUI が表示される
- `test/integration/dashboard-parity.test.ts` が全 fixture (7〜8 ケース) で byte-for-byte 一致 → 緑
- `pnpm --filter conductor test` 全部緑、`pnpm test:e2e:claude-linear` / `:claude-github` が `--no-dashboard` で引き続き緑
- 開発者が `pnpm --filter conductor diff-dashboard` で symphony と conductor の出力 diff を取れる (Phase 7 までの一時ツール)

---

## 確定事項

### Symphony parity の厳しさ

**byte-for-byte 一致** を狙う。ANSI escape も含めて完全一致させる。Phase 7 で symphony 削除と同時に goldens + capture script + diff script を削除する。

理由: 移行期間中は symphony と conductor の挙動を厳密比較できる方が回帰検出が楽。完全一致を諦めると「微妙に違うけど大丈夫」の判断が積み重なり、最終的に conductor 削除判断 (`apps/symphony` 削除可) を支える根拠が薄くなる。

タイトル "╭─ SYMPHONY STATUS" は Phase 5 中は **そのまま**。Phase 7 で symphony 削除コミットと同時に "CONDUCTOR STATUS" に rename + goldens 削除。

### Token usage のデータソース

- **codex backend**: `turn/completed` 通知の `usage.input_tokens` / `output_tokens` / `total_tokens` を `v.parse` で抽出して `codexTotals` に加算
- **claude-app-server backend**: M4+ まで `tokenUsage/updated` 未送信のため、tokens は 0 のまま (ダッシュボード表示は "in 0 | out 0 | total 0")
- **mock backend**: tokens は 0 のまま

claude-app-server がストリーミング + token 使用量通知を実装した時点で、Phase 5 のコードはそのまま流用できる (state holder の `applyTurnEvent` を拡張するだけ)。

### Event bus モデル

**EventEmitter ハイブリッド** (symphony の Orchestrator GenServer + StatusDashboard の構造を踏襲):

- `ObservabilityState` クラス: orchestrator/agent-runner/backend が状態変化を mutate する書込口
- `EventBus` (Node 標準 `EventEmitter` の typed wrapper): `stateChanged` イベントを emit
- Dashboard driver: tick (`refresh_ms` = 1s) で pull + bus subscribe で push、両方受ける
- 高頻度イベント (`item/agentMessage/delta` 等) は state mutation は全部反映するが、bus への emit は **16ms debounce** で coalesce

### Dashboard ON 時の stderr 抑制

- `dashboard_enabled && stdout.isTTY && !flag.noDashboard && !env.CONDUCTOR_DEBUG` → stderr logger を no-op に差し替え
- `--no-dashboard` flag または `CONDUCTOR_DEBUG=1` で dashboard OFF + stderr logger 復活
- Phase 6 で file logger を導入したら、dashboard ON 時は file logger に切り替わる予定

---

## アーキテクチャ

```
┌──────────────────────────────────────────────────────────────┐
│  Orchestrator (runOrchestrator)                              │
│  + AgentRunner (runAgent)                                    │
│  + BackendSession (JSON-RPC subprocess client)               │
│      │                                                       │
│      │ ObservabilityHooks.{onIssueStart,onTurnEvent,...}     │
│      ▼                                                       │
│  ObservabilityState  ── EventBus.emit("stateChanged") ────┐  │
│  (mutable holder)        (16ms debounce)                  │  │
└───────────────────────────────────────────────────────────┼──┘
                                                            │
                          ┌─────────────────────────────────┘
                          ▼
              ┌────────────────────────────┐
              │  Dashboard (driver)        │
              │  - on tick (refresh_ms):   │
              │      getSnapshot()         │
              │  - on "stateChanged":      │
              │      enqueue render        │
              │  - throttle / coalesce     │
              │      (render_interval_ms)  │
              │  - writeRender() → stdout  │
              └────────────────────────────┘
```

### 主要 type

```ts
// src/domain/observability-snapshot.ts
export type ObservabilitySnapshot = Readonly<{
  running: ReadonlyArray<RunningEntry>;
  retrying: ReadonlyArray<RetryEntry>;
  codexTotals: CodexTotals;
  rateLimits: RateLimits | null;
  polling: PollingState;
}>;

export type RunningEntry = Readonly<{
  issueId: string; identifier: string; state: string;
  workerHost: string | null; workspacePath: string | null;
  sessionId: string | null; codexAppServerPid: number | null;
  codexInputTokens: number; codexOutputTokens: number; codexTotalTokens: number;
  turnCount: number; startedAt: Date;
  lastCodexTimestamp: Date | null; lastCodexMessage: string | null;
  lastCodexEvent: string | null;
  runtimeSeconds: number;
}>;

export type RetryEntry = Readonly<{
  issueId: string; attempt: number; dueInMs: number;
  identifier: string | null; error: string | null;
  workerHost: string | null; workspacePath: string | null;
}>;

export type CodexTotals = Readonly<{
  inputTokens: number; outputTokens: number; totalTokens: number;
  secondsRunning: number;
}>;

export type RateLimits = Readonly<{ /* symphony と同 shape */ }>;
export type PollingState = Readonly<{
  checking: boolean;
  nextPollInMs: number | null;
  pollIntervalMs: number;
}>;
```

### Hook interface

```ts
// src/observability/instrumentation.ts
export type ObservabilityHooks = Readonly<{
  onIssueStart: (issueId: string, identifier: string, state: string,
                 pid: number | null, workspacePath: string | null) => void;
  onIssueEnd: (issueId: string) => void;
  onTurnEvent: (issueId: string, event: TurnEvent) => void;
  onRetryScheduled: (issueId: string, attempt: number, dueAtMs: number,
                     error: string | null) => void;
  onRetryComplete: (issueId: string) => void;
  onRateLimitObserved: (rateLimits: RateLimits) => void;
  onPollingTick: (nextPollInMs: number | null, intervalMs: number,
                  checking: boolean) => void;
}>;

export const NULL_HOOKS: ObservabilityHooks = {
  onIssueStart: () => {}, onIssueEnd: () => {}, onTurnEvent: () => {},
  onRetryScheduled: () => {}, onRetryComplete: () => {},
  onRateLimitObserved: () => {}, onPollingTick: () => {},
};
```

`ObservabilityState` が `ObservabilityHooks` を implement する。Dashboard OFF 時は `NULL_HOOKS` を渡して既存挙動を維持。

### Turn event のマッピング

| JSON-RPC notification | state への反映 |
|---|---|
| `thread/started` | `sessionId` 更新 |
| `turn/started` | `turnCount++`、`lastCodexEvent = "turn started"` |
| `item/started` | `lastCodexEvent = item.type` |
| `item/agentMessage/delta` | `lastCodexMessage` (テキスト先頭 ≈100 chars)、`lastCodexEvent = "agent message"` |
| `item/commandExecution/outputDelta` | `lastCodexEvent = "cmd: ..."` |
| `item/fileChange/outputDelta` | `lastCodexEvent = "edit: <path>"` |
| `item/completed` | `lastCodexEvent = "item done"` |
| `turn/completed` | codex の場合 `usage.{input,output,total}_tokens` を抽出 → `codexTotals` 加算。`lastCodexEvent = "turn done"` |

claude-app-server は `turn/completed` に usage を載せないため、claude backend では token フィールドは 0 のまま。

### rate_limits / polling のプレースホルダ

Phase 5 では `rateLimits = null` / `polling = { checking: false, nextPollInMs: null, pollIntervalMs: <config> }` 固定で良い (Phase 6 で並列スケジューラ + polling ループを入れた際に実値が乗る)。symphony parity 用 fixture もこの値で生成する。

---

## モジュール構成

```
apps/conductor/src/observability/
├── state.ts                     # ObservabilityState class + ObservabilitySnapshot 構築
├── event-bus.ts                 # typed EventEmitter wrapper + 16ms debounce
├── dashboard.ts                 # tick + stateChanged subscribe + throttling driver
├── runtime-config.ts            # WORKFLOW.md observability ブロックの schema + parse
├── instrumentation.ts           # ObservabilityHooks interface + NULL_HOOKS
└── render/
    ├── snapshot.ts              # formatSnapshot(snapshot, tps, width): string (entry)
    ├── header.ts                # "╭─ SYMPHONY STATUS" + Agents/Throughput/Runtime/Tokens/Rate Limits
    ├── project-link.ts          # Linear / GitHub project URL 行
    ├── running-table.ts         # Running セクション (header / separator / row)
    ├── backoff-queue.ts         # Backoff queue セクション
    ├── sparkline.ts             # throughput sparkline 8 階調 (▁▂▃▄▅▆▇█)
    ├── format.ts                # formatCount / formatRuntimeSeconds / formatTps / colorize
    └── offline.ts               # snapshot 取得失敗時の minimal 表示
```

**追加 / 変更ファイル (observability 外)**:

```
apps/conductor/src/
├── domain/
│   └── observability-snapshot.ts   # snapshot domain type
├── orchestrator/
│   ├── orchestrator.ts             # ObservabilityHooks 受け取り、issue start/end 呼ぶ
│   └── agent-runner.ts             # turn event を hooks.onTurnEvent に流す
├── backend/
│   └── jsonrpc/messages.ts         # codex turn/completed の usage 抽出 (v.parse)
├── config/
│   └── schema.ts                   # observability ブロックを WorkflowConfig schema に追加
├── cli/
│   └── run.ts                      # dashboard start/stop lifecycle + --no-dashboard
└── util/
    └── logger.ts                   # dashboard ON 時に no-op に差し替える factory

apps/conductor/test/
├── fixtures/dashboard/             # symphony から captured した goldens + snapshot JSON
│   ├── empty.txt / .json
│   ├── one-running-claude.txt / .json
│   ├── one-running-codex.txt / .json
│   ├── multi-running.txt / .json
│   ├── retry-only.txt / .json
│   ├── rate-limited.txt / .json
│   ├── narrow-terminal.txt / .json
│   └── snapshot-unavailable.txt / .json
└── integration/
    ├── dashboard-parity.test.ts
    ├── dashboard-lifecycle.test.ts
    ├── orchestrator-instrument.test.ts
    └── codex-usage-parse.test.ts

apps/conductor/scripts/
└── diff-symphony-dashboard.ts      # 開発時のみ、CI 不要

apps/symphony/scripts/
└── capture-dashboard-fixtures.exs  # Phase 5 開発時に 1 度実行して fixture を commit
```

**規模感**: `snapshot.ts` ≈ 100 行、`running-table.ts` ≈ 150 行、`header.ts` ≈ 80 行、他 50〜100 行、`state.ts` + `event-bus.ts` 合計 ≈ 200 行、`dashboard.ts` ≈ 250 行。合計 1,500 行前後。

---

## データフロー

### CLI 起動 (`bin.ts` / `cli/run.ts`)

```
load WORKFLOW.md → config (observability block 含む)
flags = parse(--no-dashboard, --i-understand-that-...)
observabilityEnabled =
  config.observability.dashboardEnabled
  && !flags.noDashboard
  && !env.CONDUCTOR_DEBUG
  && process.stdout.isTTY

if (observabilityEnabled):
  state = new ObservabilityState()
  bus = new EventBus()
  state.attachBus(bus)             // mutator が bus.emit("stateChanged")
  dashboard = new Dashboard({
    state, bus,
    refreshMs: config.observability.refreshMs,
    renderIntervalMs: config.observability.renderIntervalMs,
  })
  dashboard.start()                // initial render + interval timer + bus subscribe
  hooks = state                    // ObservabilityHooks 実装
  logger = noopLogger              // stderr 抑制
else:
  hooks = NULL_HOOKS
  logger = stdLogger               // 既存どおり stderr

try:
  await runOrchestrator({ ..., hooks, logger })
finally:
  dashboard?.stop()                // 最終 flush + cursor restore + 末尾改行
```

### Orchestrator/AgentRunner からの呼び出し

```
runOrchestrator(input):
  for each candidate issue:
    hooks.onIssueStart(issue.id, issue.identifier, issue.state, null, workspacePath)
    try:
      outcome = await runAgent({ ..., hooks })
        runAgent:
          session = await backend.start(...)
          hooks.onIssueStart(issue.id, ..., session.pid, ...)   // pid backfill
          for turn in 1..maxTurns:
            await session.startTurn(prompt)
            for event of session.events():     // turn/started → item/* → turn/completed
              hooks.onTurnEvent(issue.id, event)
            if refreshed.state ∈ terminalStates: break
            if !activeStates.includes(refreshed.state): break   // ADR-0014 第3条件
          await session.close()
    finally:
      hooks.onIssueEnd(issue.id)
```

### State mutation の throttle

- `ObservabilityState.applyTurnEvent` は state を **同期 mutate** するが、`bus.emit("stateChanged")` は **16ms debounce** で coalesce
- 高頻度更新は state に全反映、bus への push は間引く
- Dashboard tick (`refresh_ms` = 1s) で必ず最新を pull する safety net

---

## レンダラと throttling

### 定数 (symphony 移植)

| 名前 | 値 | 役割 |
|---|---|---|
| `MINIMUM_IDLE_RERENDER_MS` | 1,000 | 内容変化なしでも 1 秒に 1 度は再描画 (age 更新用) |
| `THROUGHPUT_WINDOW_MS` | 5,000 | tps 計算のスライディングウィンドウ |
| `THROUGHPUT_GRAPH_WINDOW_MS` | 600,000 | sparkline 全幅 (10 分) |
| `THROUGHPUT_GRAPH_COLUMNS` | 24 | sparkline バケット数 |
| `DEFAULT_TERMINAL_COLUMNS` | 115 | TTY 幅取得失敗時のフォールバック |
| `observability.refresh_ms` | 1,000 | tick 周期 (snapshot 取得) |
| `observability.render_interval_ms` | 16 | 連続描画の最小間隔 (60 fps 上限) |
| `observability.dashboard_enabled` | true | デフォルト ON |

`apps/conductor/src/observability/runtime-config.ts` に const 定義 + `observability:` block で override 可能。

### Dashboard 内部状態

```ts
type DashboardInternals = {
  refreshMs: number;
  renderIntervalMs: number;
  enabled: boolean;
  renderFn: (content: string) => void;       // 通常は process.stdout.write
  tokenSamples: Array<[tsMs: number, totalTokens: number]>;
  lastTpsSecond: number | null;
  lastTpsValue: number | null;
  lastRenderedContent: string | null;
  lastRenderedAtMs: number | null;
  pendingContent: string | null;
  flushTimer: NodeJS.Timeout | null;
  lastSnapshotFingerprint: string | null;    // JSON.stringify(snapshot)
  tickTimer: NodeJS.Timeout | null;
  busOff: () => void;                        // EventBus subscribe 解除
};
```

### tick / refresh ハンドラ

```
on tick (refreshMs ごと):
  snapshot = state.getSnapshot()
  tokenSamples = updateTokenSamples(tokenSamples, now, totalTokens(snapshot))
  tps = throttledTps(lastTpsSecond, lastTpsValue, now, tokenSamples)
  fingerprint = JSON.stringify(snapshot)
  if (fingerprint !== lastSnapshotFingerprint
      || (lastRenderedAtMs && now - lastRenderedAtMs >= MINIMUM_IDLE_RERENDER_MS)):
    content = formatSnapshot(snapshot, tps, terminalColumns())
    enqueueRender(content, now)

on "stateChanged" (bus emit、debounced):
  以後 tick と同じ処理を即時起動

enqueueRender(content, now):
  if (content === lastRenderedContent) return
  if (renderNow(lastRenderedAtMs, renderIntervalMs, now)):
    writeRender(content, now)
  else:
    pendingContent = content
    scheduleFlushRender(now)

scheduleFlushRender(now):
  if (flushTimer) return
  delay = max(1, renderIntervalMs - (now - lastRenderedAtMs))
  flushTimer = setTimeout(flushPending, delay)

writeRender(content, now):
  renderFn("\e[2J\e[H" + content + "\n")
  lastRenderedContent = content
  lastRenderedAtMs = now
  pendingContent = null
  flushTimer = null
```

### ANSI escape の直書き

symphony は `IO.ANSI.blue() = "\e[34m"` のような標準 ANSI を出す。conductor も **picocolors / chalk を使わず、`format.ts` で直書き** する:

```ts
// src/observability/render/format.ts
export const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",         // IO.ANSI.faint
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",     // orange / yellow 両用
  magenta: "\x1b[35m",
  gray: "\x1b[90m",       // light_black
} as const;

export const colorize = (text: string, color: string): string =>
  `${color}${text}${ANSI.reset}`;
```

`clear + home` は `"\x1b[2J\x1b[H"` (symphony 同じ)。cursor hide/show は `"\x1b[?25l"` / `"\x1b[?25h"`。

### formatSnapshot

```
formatSnapshot(snapshot, tps, terminalColumns) → string

  if snapshot is { type: "error" }:
    return offline 表示 (4〜6 行)

  lines = [
    renderHeader(snapshot.codexTotals, snapshot.rateLimits, runningCount, maxAgents, tps),
    renderProjectLinkLines(),
    renderProjectRefreshLine(snapshot.polling),
    "├─ Running",
    "│",
    renderRunningTableHeader(eventColumnWidth(terminalColumns)),
    renderRunningTableSeparator(eventColumnWidth(terminalColumns)),
    ...snapshot.running.map(row => renderRunningRow(row, eventColumnWidth)),
    ...(snapshot.running.length > 0 ? ["│"] : []),
    "├─ Backoff queue",
    "│",
    ...renderBackoffRows(snapshot.retrying),
    closingBorder(),
  ]
  return lines.flat().join("\n")
```

各 sub renderer は **純関数**、`Date.now()` を呼ばない。tick で取得した `now` / `tps` を引数で受ける (テスト時刻固定可能)。

### タイトル

"╭─ SYMPHONY STATUS" のまま (byte parity)。Phase 7 で symphony 削除と同時に "CONDUCTOR STATUS" + goldens 削除。

---

## Snapshot-compare ツーリング

byte parity の 3 段防御線。

### (1) Golden 文字列 fixtures (静的)

```
apps/conductor/test/fixtures/dashboard/
├── empty.txt / .json                # 0 agents, no totals, no rate_limits
├── one-running-claude.txt / .json   # 1 agent (claude, tokens 0)
├── one-running-codex.txt / .json    # 1 agent (codex, tokens 1234)
├── multi-running.txt / .json        # 2 running + 1 retrying
├── retry-only.txt / .json           # running 0、retry 2
├── rate-limited.txt / .json         # rate_limits 行非 nil
├── narrow-terminal.txt / .json      # terminalColumns=60 で event 列 truncate
└── snapshot-unavailable.txt / .json # offline path
```

`.txt` は golden ANSI 文字列、`.json` は `{ snapshot, tps, terminalColumns, now }` の組。Phase 5 着手時に 1 度だけ capture して commit、Phase 7 で削除。

### (2) Capture flow (`apps/symphony/scripts/capture-dashboard-fixtures.exs`)

両言語が共有できるよう、fixture spec は **個別の `<name>.json`** に置く (capture script も parity test も同じファイル群を読む)。spec の `name` 一覧は capture script 内で hard-code 配列に持つ:

```elixir
@fixtures [
  %{name: "empty", snapshot: %{...}, tps: 0.0, terminal_columns: 115, now: 1747476000000},
  %{name: "one-running-codex", snapshot: %{...}, tps: 13.7, terminal_columns: 115, now: 1747476090000},
  # ...
]
```

各 fixture について:

```
for fixture in @fixtures:
  build Orchestrator state (running map / retry / codex_totals / ...)
  inject via :sys.replace_state into a fresh StatusDashboard instance
  override render_fun to capture string
  trigger render (notify_update)
  write captured string → apps/conductor/test/fixtures/dashboard/<name>.txt
  write spec JSON → apps/conductor/test/fixtures/dashboard/<name>.json
```

Phase 5 着手時に 1 度実行 → goldens と spec JSON を commit。spec 配列を更新するたびに再実行して両ファイルを上書き。

### (3) Parity test (動的)

```ts
// test/integration/dashboard-parity.test.ts
import { readdirSync, readFileSync } from "node:fs";
import { formatSnapshot } from "../../src/observability/render/snapshot.js";

describe("dashboard byte parity", () => {
  const fixtures = readdirSync("test/fixtures/dashboard")
    .filter(f => f.endsWith(".json") && !f.startsWith("_"));
  for (const fixtureFile of fixtures) {
    const name = fixtureFile.replace(/\.json$/, "");
    it(`renders ${name} byte-for-byte vs symphony golden`, () => {
      const spec = JSON.parse(readFileSync(`test/fixtures/dashboard/${name}.json`, "utf8"));
      const golden = readFileSync(`test/fixtures/dashboard/${name}.txt`, "utf8");
      const actual = formatSnapshot(spec.snapshot, spec.tps, spec.terminalColumns);
      expect(actual).toBe(golden);
    });
  }
});
```

### (4) Live diff script (開発時、CI 不要)

`apps/conductor/scripts/diff-symphony-dashboard.ts`:

```
for each fixture spec:
  symphonyOutput = capture from symphony StatusDashboard
  conductorOutput = formatSnapshot(spec)
  print colored diff (line-by-line)
```

`pnpm --filter conductor diff-dashboard` で起動。修正中の手動チェック用、CI には組み込まない (symphony 実行コスト + Phase 7 で削除する一過性ツール)。

---

## テスト戦略

### Unit (in-source `import.meta.vitest`)

| ファイル | テスト内容 |
|---|---|
| `render/format.ts` | `formatCount(1234) === "1.2k"`, `formatRuntimeSeconds(90) === "1m 30s"`, `formatTps(13.7) === "13.7"`, `colorize` の ANSI escape 完全一致 |
| `render/sparkline.ts` | tokenSamples + window → 24 chars sparkline、全 0 / 全埋め / 部分埋め |
| `render/running-table.ts` | 列幅計算 (`runningEventWidth(115) === 44`)、UTF-8 truncate、empty running の挙動 |
| `render/backoff-queue.ts` | `dueInMs` の表示 ("3.2s" / "1m 5s") |
| `render/header.ts` | rate_limits null / 値あり、tokens 0 / 非 0 |
| `state.ts` | `applyTurnEvent` の codex usage 加算、claude usage 不在時 0 のまま、`onIssueEnd` で running から消える、`onRetryScheduled` で retrying に追加 |
| `event-bus.ts` | emit / subscribe / off、16ms debounce で複数 emit が 1 回に coalesce |
| `dashboard.ts` | tick で getSnapshot → enqueueRender、`stateChanged` で同上、`pendingContent` の flush タイマー、fingerprint 一致で再描画 skip |

### Integration

```
test/integration/
├── dashboard-parity.test.ts        # golden との byte 一致 (上記)
├── dashboard-lifecycle.test.ts     # start / stop / cursor restore / final flush
├── orchestrator-instrument.test.ts # mock backend + ObservabilityState で hook が想定通り呼ばれる
└── codex-usage-parse.test.ts       # codex turn/completed usage 抽出、malformed payload は parse error
```

`dashboard-lifecycle.test.ts` は:
- TTY stdout を `PassThrough` で fake
- `process.stdout.columns` を fake 値で固定
- `stop()` で cursor show escape (`\x1b[?25h`) + 末尾改行が出ること

### E2E

既存 `pnpm test:e2e:claude-linear` / `pnpm test:e2e:claude-github` は **dashboard OFF** (`--no-dashboard` を common.ts に追加)。byte parity 担保は unit/integration で十分、E2E で TTY を fake すると脆い。

新規 (任意):
- `apps/e2e/dashboard-smoke.ts` (`pnpm test:e2e:dashboard`): `conductor --dashboard examples/workflow.mock-memory.md` を `node-pty` で起動 → `╭─ SYMPHONY STATUS` 行が出ること + 終了時 cursor restore escape が出ることだけ確認。mock backend、所要 ≈ 5 秒、CI で走らせて良い。

### 完了判定

TODO.md Phase 5 文言との対応:

- symphony と TUI 出力 snapshot 比較 → `test/fixtures/dashboard/*.txt` + capture/diff スクリプト
- ANSI レンダラ (sparkline / テーブル / 色分け) → `src/observability/render/*`
- token usage / throughput 集計 → `state.ts` の codex usage 抽出 + `dashboard.ts` の `updateTokenSamples` / `throttledTps`
- observability pubsub 相当の event bus → `event-bus.ts`
- 描画 diff・スロットリング → `dashboard.ts` の `lastSnapshotFingerprint` / `lastRenderedContent` / `flushTimer`
- TUI 出力が symphony と機能的に同等 → `dashboard-parity.test.ts` 全 fixture 緑

---

## リスクと緩和策

| リスク | 影響 | 緩和策 |
|---|---|---|
| symphony との byte parity が IO.ANSI 内部実装差で取れない | `dashboard-parity.test.ts` が永久に赤 | capture 時に symphony 実行環境を固定 (`mise.toml` の Erlang/OTP バージョン)。`IO.ANSI.*` の戻り値を 1 度 print して conductor の `ANSI.*` 定数と完全一致するか先に検証 |
| `item/agentMessage/delta` の高頻度 emit でメインスレッドが詰まる | dashboard 表示が止まる、backend のターンが遅延 | state mutation は同期だが、bus.emit を 16ms debounce。さらに dashboard 側で `lastSnapshotFingerprint` skip がある |
| Phase 6 並列化前に running entry が常に 0/1 のため fixture が薄くなる | `multi-running.txt` が現実離れ | 並列スケジューラ未実装でも `ObservabilityState` の `running` map は複数 entry を保持可能な設計にし、capture 時は手動で多 entry state を inject する |
| `process.stdout.columns` が SIGWINCH で変わったときに table 列幅がずれる | resize 後に整列崩れ | symphony 同等の挙動 (terminal column を tick ごとに再取得) を素直に移植。SIGWINCH handler は Phase 6 で必要なら追加 |
| ファイルロガー無しでデバッグが辛い | dashboard ON 時に bug 発生すると stderr が見えない | `CONDUCTOR_DEBUG=1` で dashboard OFF + stderr 復活を必ず docs に明記。`pnpm --filter conductor diff-dashboard` も併用 |
| symphony fixture capture が一度しか走らないので、capture script が腐っても誰も気付かない | Phase 7 までは問題なし、Phase 5 中の再 capture が必要になったとき詰む | `capture-dashboard-fixtures.exs` を Phase 5 spec の implementation plan に「再実行 smoke」のタスクとして含める |

---

## Phase 6 への引き継ぎ

Phase 6 (並列実行・retry) で以下を `ObservabilityState` に追加するだけで dashboard は自動的に対応:

- `running` map に複数 entry を入れる (`onIssueStart` が並列に呼ばれる)
- `retrying` map に entry を入れる (`onRetryScheduled` / `onRetryComplete`)
- `polling` を実値で更新する (`onPollingTick`)
- `rateLimits` を実値で更新する (`onRateLimitObserved`)

dashboard 側に変更不要。fixtures の `multi-running` / `retry-only` / `rate-limited` が Phase 6 で初めて実機相当の値で動く。

---

## 参考資料

- ルート [`CLAUDE.md`](../../../CLAUDE.md)
- [M3 overview](2026-05-15-m3-overview-design.md)
- 移植元 [`apps/symphony/lib/symphony_elixir/status_dashboard.ex`](../../../apps/symphony/lib/symphony_elixir/status_dashboard.ex)
- 移植元 [`apps/symphony/lib/symphony_elixir_web/observability_pubsub.ex`](../../../apps/symphony/lib/symphony_elixir_web/observability_pubsub.ex)
- 関連 [ADR-0014 Symphony owned state transitions](../../adr/0014-symphony-owned-state-transitions.md)
- conductor `CLAUDE.md` [`apps/conductor/CLAUDE.md`](../../../apps/conductor/CLAUDE.md)
- kamae スキル `/workspace/.claude/skills/kamae/`
