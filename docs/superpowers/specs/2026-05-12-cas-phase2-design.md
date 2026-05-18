# claude-app-server Phase 2 設計

**対象:** `apps/claude-app-server` Phase 2 (thread/turn の基本フロー + Claude Agent SDK 結合)
**前提:** Phase 1 完了 (2026-05-11 main マージ済み)
**ゴール:** `examples/manual_test.jsonl` を流して "What is 2+2?" の応答が `item/agentMessage/delta` として届く

---

## 1. スコープ

### 含むもの

- `thread/start` ハンドラ: `thr_<uuid>` 発行、`thread/started` 通知、ThreadState 保存
- `turn/start` ハンドラ: `turn_<uuid>` 発行、即レスポンス、非同期 SDK 呼び出し
- `turn/interrupt` ハンドラ (最小): 進行中ターンの `AbortController.abort()` + `turn/completed status:interrupted` 通知
- Claude Agent SDK `query()` ラッパ (model / permissionMode / cwd / resume 対応)
- SDK message → Codex 風 `OutgoingNotification` 配列への変換 (純粋関数)
- ThreadState の `sessionId` 抽出と resume への利用
- 必要最小限のユニットテスト (純粋関数中心) + 手動 E2E 手順

### 含まないもの (Phase 3 以降)

- `tool_use` (Bash / Edit / Read 等) → `commandExecution` / `fileChange` item へのマッピング
- `outputDelta` 系ストリーミング通知
- レート制限ハンドリング (`codexErrorInfo: "UsageLimitExceeded"`)
- `thread/tokenUsage/updated` 通知
- `partial_message` による `text_delta` ストリーミング (Phase 4)
- 未実装メソッド `stub.ts` (Phase 4)

---

## 2. モジュール構成

```
src/
├── claude/
│   ├── sdk-message.ts       # SDK メッセージの DU + valibot schema
│   ├── event-mapper.ts      # SDK message → OutgoingNotification 配列 (純粋関数)
│   ├── session-options.ts   # CLI opts + thread/start params → SdkOptions 解決
│   └── session.ts           # query() ラッパ + AbortController 管理
├── state/
│   └── threads.ts           # ThreadId → ThreadState
├── handlers/
│   ├── thread.ts            # thread/start
│   └── turn.ts              # turn/start, turn/interrupt
├── util/
│   └── ids.ts               # thr_/turn_/item_<uuid> 発行
└── handlers/index.ts        # 既存。新ハンドラ登録を追加
```

各モジュールは「外部から見える型」と「振る舞い」を 1 箇所に閉じる kamae スタイルで書く。Phase 1 の `jsonrpc/incoming-message.ts` などと同じスタイル。

---

## 3. 主要型

### Branded ID 型 (`util/ids.ts`)

```ts
type ThreadId = v.InferOutput<typeof ThreadId.schema>;  // v.brand("ThreadId")
type TurnId   = v.InferOutput<typeof TurnId.schema>;
type ItemId   = v.InferOutput<typeof ItemId.schema>;
type SessionId = v.InferOutput<typeof SessionId.schema>;  // Claude SDK 由来

// 発行: ThreadId.fresh() → `thr_<uuid>` を branded で返す
// 同様に TurnId.fresh() → `turn_<uuid>`, ItemId.fresh() → `item_<uuid>`
```

### `ThreadState` (`state/threads.ts`)

```ts
type ResolvedThreadOptions = Readonly<{
  cwd: string;
  permissionMode: "default" | "acceptEdits" | "bypassPermissions";
  // model / allowedTools は CLI からのみ来る前提だが、将来 thread/start.params から
  // 上書きしたくなった場合に備えて ThreadState に持つ。
  model?: string;
  allowedTools?: ReadonlyArray<string>;
}>;

type ThreadState = Readonly<{
  id: ThreadId;
  options: ResolvedThreadOptions; // thread/start 時点で確定。turn/start は触らない (Phase 2)
  sessionId?: SessionId;        // SDK から取れたら保存。次ターンで resume に渡す
  currentTurn?: TurnInProgress; // turn/interrupt 用
}>;

type TurnInProgress = Readonly<{
  id: TurnId;
  abort: AbortController;
}>;

type Threads = Readonly<{
  start: (options: ResolvedThreadOptions) => ThreadState;
  get: (id: ThreadId) => ThreadState | undefined;
  setSessionId: (id: ThreadId, sessionId: SessionId) => void;
  setCurrentTurn: (id: ThreadId, turn: TurnInProgress) => void;
  clearCurrentTurn: (id: ThreadId) => void;
}>;

const Threads = { create: (): Threads => ... };  // 内部に Map<ThreadId, ThreadState>
```

`Threads.create()` を `server.ts` で 1 つ作り、`HandlerContext` 経由でハンドラに渡す。

### `HandlerContext` 拡張

現状 `sendNotification` のみ。Phase 2 で以下を足す:
- `threads: Threads`
- `cli: ServerOptions` — `resolveThreadOptions` で CLI 引数のデフォルトを参照するため
- `session: { runTurn: RunTurn }` — `turn/start` ハンドラから呼ぶ。test double で差し替え可能

### `SdkMessage` DU (`claude/sdk-message.ts`)

Claude Agent SDK の `query()` が返す非同期イテレータの message を、必要な範囲で valibot で narrow した DU として表現。

```ts
type SdkMessage =
  | { kind: "SystemInit"; sessionId: SessionId }
  | { kind: "AssistantText"; text: string }
  | { kind: "AssistantToolUse"; toolUseId: string; name: string; input: unknown }  // Phase 3 で使用
  | { kind: "UserToolResult"; toolUseId: string; content: unknown }                // Phase 3 で使用
  | { kind: "Result"; status: "completed" | "error"; errorMessage?: string }
  | { kind: "Unknown"; raw: unknown };  // 未知は破棄せず Unknown で持つ
```

valibot で SDK の wire 形式 (`{ type: "system", subtype: "init", session_id: ... }` 等) を受け、上記 DU に `v.transform` する。SDK のバージョン差異を吸収するレイヤ。

### `SdkOptions` (`claude/session-options.ts`)

このモジュールは 2 つの責務を持つ:

1. **thread/start 時のオプション解決** (`resolveThreadOptions`): CLI args + `thread/start.params` → `ResolvedThreadOptions`
2. **turn 実行時の SDK 引数組み立て** (`toSdkOptions`): `ResolvedThreadOptions` + resume + abortController → SDK の `query()` に渡す options

```ts
type SdkOptions = Readonly<{
  model?: string;
  permissionMode: "default" | "acceptEdits" | "bypassPermissions";
  cwd: string;
  allowedTools?: ReadonlyArray<string>;
  resume?: SessionId;
  abortController: AbortController;
  canUseTool: NonNullable<QueryOptions["canUseTool"]>;
}>;

// thread/start 時: CLI opts + params の優先順位 (params 優先、なければ CLI) で解決
const resolveThreadOptions = (args: {
  cli: ServerOptions;
  params: ThreadStartParams;
}): ResolvedThreadOptions => ...;

// turn 実行直前: 確定済みオプション + 動的情報 (resume sessionId, abort) を結合
const toSdkOptions = (args: {
  thread: ResolvedThreadOptions;
  resume?: SessionId;
  abortController: AbortController;
}): SdkOptions => ...;
```

優先順位 (Phase 2 確定): **params があれば params、無ければ CLI**。
- `params.cwd` 必須でなく、無ければ Node の `process.cwd()` (論点③ B)
- `params.sandboxPolicy.type` → `permissionMode` (CLAUDE.md のマッピング表)
- `params.model` (SPEC では `thread/start` に model はないが、Symphony が送ってくる可能性があるため許容する。Phase 2 では valibot で `optional`)
- `canUseTool` は常に `(_tool, input) => ({ behavior: "allow", updatedInput: input })` を設定 (CLAUDE.md 落とし穴: bypassPermissions と冗長設定)

---

## 4. データフロー

### `thread/start`

```
handler.thread/start (params)
  ├─ params 検証 (valibot)  ── cwd は optional (B 案)
  ├─ resolved = resolveThreadOptions({ cli, params })
  ├─ state = threads.start(resolved)  // 内部で ThreadId.fresh()
  ├─ ctx.sendNotification("thread/started", { threadId: state.id })
  └─ return { thread: { id: state.id } }
```

### `turn/start` (同期部分)

```
handler.turn/start (params)
  ├─ params 検証 (threadId, input)
  ├─ thread = threads.get(threadId)  // なければ Invalid params
  ├─ turnId = TurnId.fresh()
  ├─ abort = new AbortController()
  ├─ threads.setCurrentTurn(threadId, { id: turnId, abort })
  ├─ // 非同期で SDK 呼び出し開始 (await しない)
  │   void runTurn(thread, turnId, params.input, ctx)
  └─ return {
       turn: { id: turnId, status: "inProgress", items: [], error: null }
     }
```

### `runTurn` (非同期)

```
runTurn(thread, turnId, input, ctx)
  ├─ ctx.sendNotification("turn/started", { turn: {...inProgress} })
  ├─ sdkOpts = toSdkOptions({ thread: thread.options, resume: thread.sessionId, abortController })
  ├─ try:
  │   for await (msg of query({ prompt, options: sdkOpts })):
  │     parsed = SdkMessage.parse(msg)
  │     if parsed.kind === "SystemInit":
  │       threads.setSessionId(thread.id, parsed.sessionId)  // side effect
  │     notifications = eventMapper.map(parsed, { turnId, threadId })
  │     for n of notifications: ctx.sendNotification(n.method, n.params)
  ├─ catch (err):
  │   if AbortError: status = "interrupted"
  │   else:          status = "failed", error = { message: ... }
  ├─ finally:
  │   threads.clearCurrentTurn(thread.id)
  │   ctx.sendNotification("turn/completed", { turn: { id: turnId, status, items, error } })
```

### `turn/interrupt`

```
handler.turn/interrupt (params)
  ├─ thread = threads.get(params.threadId)
  ├─ if thread.currentTurn: thread.currentTurn.abort.abort()
  └─ return {}
```

実際の `turn/completed status:interrupted` 通知は `runTurn` の finally で出る。

---

## 5. event-mapper (純粋関数)

入力: `SdkMessage` + context (`turnId`, `threadId`, current item state)
出力: `ReadonlyArray<OutgoingNotification>`

実装上、event-mapper は**ステートを持つ**: 進行中の `agentMessage` item id を覚えておいて、`item/started` / `item/agentMessage/delta` / `item/completed` を順に出す必要がある。

→ event-mapper を 2 層に分ける:
- `mapMessage(msg, state) → { state, notifications }` の純粋関数
- session.ts 側で `state` をローカル変数として持ち回す

```ts
type MapperState = Readonly<{
  currentAgentMessage?: { itemId: ItemId; text: string };
}>;

const mapMessage = (
  msg: SdkMessage,
  state: MapperState,
  ctx: Readonly<{ turnId: TurnId; threadId: ThreadId }>,
): Readonly<{ state: MapperState; notifications: ReadonlyArray<OutgoingNotification> }> => ...;
```

これなら state は immutable に流せて、テストは「fixture 列を順に流して期待 notification 列が出るか」で書ける。

### Phase 2 でマップする SDK message → notification

| SdkMessage | 出力 notification |
|---|---|
| `SystemInit` | (なし。sessionId は session.ts 側で保存) |
| `AssistantText (text)` | `item/started` (agentMessage, inProgress) + `item/agentMessage/delta` + (次の AssistantText か Result で `item/completed`) |
| `AssistantToolUse` | (Phase 2 では `Unknown` 扱い、Phase 3 で実装) |
| `UserToolResult` | (Phase 2 では `Unknown` 扱い) |
| `Result (completed)` | (進行中 agentMessage を `item/completed` で閉じる) ※ `turn/completed` は session.ts が出す |
| `Result (error)` | (進行中 agentMessage を閉じる、エラーは session.ts 側で turn/completed.error に乗せる) |
| `Unknown` | (空配列。stderr に debug ログ) |

注: Phase 2 では Claude Agent SDK の `assistant` message 内に text content が複数あっても、シンプルに 1 つの `agentMessage` item にまとめて concatenation するだけで十分とする (検証ゴール "What is 2+2?" には対応可能)。

---

## 6. session.ts (薄いラッパ)

```ts
type SessionDeps = Readonly<{
  // テスト用に query を注入できる
  query: typeof import("@anthropic-ai/claude-agent-sdk").query;
}>;

type RunTurn = (args: {
  thread: ThreadState;
  turnId: TurnId;
  input: ReadonlyArray<TurnInput>;
  cli: ServerOptions;
  params: TurnStartParams;
  threads: Threads;
  sendNotification: HandlerContext["sendNotification"];
  abortController: AbortController;
}) => Promise<void>;

const createSession = (deps: SessionDeps): { runTurn: RunTurn } => ...;
```

`session.ts` 内で:
1. `turn/started` 通知発行
2. `resolveSdkOptions` で SDK 引数組み立て
3. `deps.query()` を for await
4. 各 message を `SdkMessage.parse` → `mapMessage` で notification 列を取得 → 送信
5. catch / finally で `turn/completed` 発行

`session.ts` のユニットテストは作らない。手動 E2E で検証 (kamae の境界レイヤ方針)。

---

## 7. テスト方針

### 新規ユニットテスト

| ファイル | 対象 | 戦略 |
|---|---|---|
| `claude/sdk-message.test.ts` | valibot による wire → DU 変換 | fixture (system/init, assistant text, result, 未知) → DU 期待値 |
| `claude/event-mapper.test.ts` | `mapMessage` 純粋関数 | message 列 → notification 列を assert |
| `claude/session-options.test.ts` | `resolveThreadOptions` / `toSdkOptions` | 優先順位 (params 優先) のケース表、resume / canUseTool が常に設定されること |
| `state/threads.test.ts` | Threads モジュール | start / get / setSessionId / currentTurn ライフサイクル |
| `util/ids.test.ts` | Branded ID の prefix と uniqueness | 既存 `id.ts` と同じスタイル |
| `handlers/thread.test.ts` | dispatcher 経由で thread/start | レスポンス + thread/started 通知の発行 |
| `handlers/turn.test.ts` | dispatcher 経由で turn/start / turn/interrupt | 即レスポンス + 通知。session は test double で query をモック |

### 手動 E2E

`examples/manual_test.jsonl` を作成し、CLAUDE.md の例どおりに流す:

```jsonl
{"method":"initialize","id":0,"params":{"clientInfo":{"name":"test","title":"Test","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}
{"method":"initialized","params":{}}
{"method":"thread/start","id":1,"params":{}}
{"method":"turn/start","id":2,"params":{"threadId":"thr_<...>","input":[{"type":"text","text":"What is 2+2?"}]}}
```

`thr_<...>` は thread/start のレスポンスから手で書き戻す (or 簡単な expect スクリプトを examples 配下に置く)。

期待出力:
- `thread/started`
- `turn/started`
- `item/started (agentMessage)`
- 1+ 個の `item/agentMessage/delta` で "4" を含むテキスト
- `item/completed (agentMessage)`
- `turn/completed status:completed`

---

## 8. 依存追加

- `@anthropic-ai/claude-agent-sdk` (production)
- `uuid` (production) — `thr_<uuid>` 生成用。Node 20+ の `crypto.randomUUID()` でも可だが、テスト時にモックしたいので `uuid` を使う or seam を作る。**`crypto.randomUUID()` を使い、テストでは `util/ids.ts` の `fresh()` を spy する方針** とする (依存削減)

---

## 9. エラーハンドリング

- `params` 検証失敗 → `-32602 Invalid params` (Phase 1 の Dispatcher 例外パスで `InternalError` ではなく適切に返したい。`DispatchError` に `InvalidParams` バリアントを追加)
- SDK 例外 → `turn/completed status:failed` + `error: { message }`
- AbortError → `turn/completed status:interrupted` + `error: null`
- レート制限・`codexErrorInfo` は Phase 4

### `DispatchError` 拡張

現在の DU に `InvalidParams` 追加:
```ts
type DispatchError =
  | { kind: "ParseError" }
  | { kind: "InvalidRequest" }
  | { kind: "MethodNotFound"; method: string }
  | { kind: "InvalidParams"; details: ValidationError }  // 新規
  | { kind: "InternalError"; cause: unknown };
```

ハンドラ内で valibot エラーを返した場合 (Result.Failure) に dispatcher が `InvalidParams` に変換できるよう、`RequestHandler` の戻り値型を `Promise<Result.Result<unknown, ValidationError>> | unknown` のように拡張するか、ハンドラ内で `throw` して dispatcher の catch で識別する。**シンプルさ優先で、ハンドラ内で `InvalidParamsError` をスローし、dispatcher で `instanceof` 判定** する。

---

## 10. 落とし穴と対応

- **stdout 汚染禁止** (CLAUDE.md): SDK 自体が stdout に書く可能性があるなら、必要に応じて SDK のロガー設定を確認。Phase 2 では SDK の公開 API を呼ぶだけなのでまず問題ない想定だが、手動 E2E で stdout に JSON-RPC 以外が出ていないか必ず確認。
- **`canUseTool` の冗長設定** (CLAUDE.md): `permissionMode: bypassPermissions` + `canUseTool: () => allow` を**両方**設定する。
- **resume の不安定性** (CLAUDE.md): Pro/Max で `resume` が動かない場合、手動 E2E で 2 ターン目の挙動を見て、ダメなら `sessionId` を threads から消すフォールバックを `session.ts` に入れる。Phase 2 では検証ゴール (1 ターン) に到達できればよく、resume が動かなくても先に進む。
- **partial message off**: Phase 2 では `includePartialMessages: false` (デフォルト)。Phase 4 で有効化。

---

## 11. 完了条件

- [ ] 上記モジュール全て実装、ユニットテスト追加 (33 → 50+ tests 程度を目安)
- [ ] `pnpm build` / `pnpm test` / lint / format チェックが通る
- [ ] `examples/manual_test.jsonl` で手動 E2E が "What is 2+2?" に答えて完走する
- [ ] CLAUDE.md / TODO.md Phase 2 のチェック項目を埋める
- [ ] PR をブランチ `feat/cas-phase2` で main にマージ (個人ツール方針: --no-ff)
