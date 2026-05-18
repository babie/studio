# JSON-RPC プロトコル仕様

`apps/perform` ↔ `apps/claude-app-server` 間の通信仕様。Codex App Server プロトコルのサブセットで、**perform が実際に喋る範囲**だけを正式に定義する (歴史的経緯から symphony の subset がそのまま継承されている)。

完全な Codex App Server SPEC は [vendored snapshot](./vendor/codex/app-server.md) または [公式ドキュメント](https://developers.openai.com/codex/app-server) を参照。本書で定義しない仕様には依存しないこと。

---

## 1. 概要

### 採用理由

- Symphony は元々 Codex CLI を subprocess として起動して JSON-RPC で会話する設計
- Codex App Server プロトコルは OpenAI 専用ではなく **JSON-RPC 2.0 stdio (JSONL) のオープン仕様**
- そのため、同じプロトコルを喋るサーバを Claude バックエンドで実装すれば Symphony 側を一切変えずに使える
- それが `apps/claude-app-server` の実装意義

### 適用範囲

- perform が起動する任意の subprocess（Codex CLI / claude-app-server / 将来の同等品）はこの仕様を満たす必要がある
- 本書は **perform が送る／受け取る** メソッドだけを正式仕様とする
- Codex 本家にあって perform が使わないメソッド（`account/*`, `fs/*`, `thread/fork`, `thread/resume`, `turn/steer` 等）は未定義

### 非対象

- HTTP / WebSocket トランスポート（stdio のみ）
- Codex App Server の全メソッド網羅
- 認証フロー（subprocess の認証は subprocess 内で完結。プロトコルは関与しない）

---

## 2. トランスポート

### stdio JSONL

- perform は backend を subprocess として起動し、**標準入出力**でやり取りする
- 各 JSON-RPC メッセージは **1 メッセージ = 1 行** の JSONL（JSON Lines）形式
- 行区切りは LF (`\n`)。CRLF は使わない
- エンコーディングは UTF-8

### フレーミング

```
{"id":1,"method":"initialize","params":{...}}\n
{"id":1,"result":{...}}\n
{"method":"item/agentMessage/delta","params":{...}}\n
```

- 1 行 1 JSON オブジェクト
- 改行を内部に含む文字列値は JSON エスケープされる（`\n`）
- ストリームの先頭にデータが部分送信されることがあるため、受信側は LF まで bufferring する責任を持つ

### stderr の扱い

- backend は **stderr を診断ログに使って良い**。perform は stderr をログにキャプチャするが解釈はしない
- プロトコルメッセージは必ず **stdout** に書く

### 起動パラメータ

- perform は `command` 文字列を `argv` に分解（shell-like quoting）して `exec` する
- 環境変数は親プロセス（perform）のものを継承する
- 作業ディレクトリは perform 自身の cwd（個別の workspace パスは `thread/start.params.cwd` で渡す）

---

## 3. JSON-RPC 2.0 基本

### メッセージ種別

| 種別 | 持つキー |
|---|---|
| Request | `id`, `method`, `params` |
| Response (success) | `id`, `result` |
| Response (error) | `id`, `error` (`code`, `message`, `data?`) |
| Notification | `method`, `params`（`id` を持たない） |

`jsonrpc` フィールドは **ワイヤ上では省略される**（Codex App Server SPEC 仕様）。送信側は省略してよく、受信側は省略を受け入れる必要がある。`"jsonrpc": "2.0"` を含むメッセージも互換のため受け入れる。

### id 規則

- perform が送る request の `id` は逐次採番される整数または固定値
- backend が送る request（approval / tool call）の `id` は backend が払い出す。perform はその `id` を含む response を返す
- thread / turn の id は不透明な文字列（典型的には `thr_<uuid>` / `turn_<uuid>` だがプレフィックスに依存しないこと）

### エラーコード

| code | 意味 |
|---|---|
| `-32600` | Invalid Request |
| `-32601` | Method not found（**未実装メソッドはこれを返す**） |
| `-32602` | Invalid params |
| `-32603` | Internal error |
| `-32000` 〜 `-32099` | Server error（実装定義） |

ターン処理中の AI 由来エラー（レート制限など）は JSON-RPC `error` ではなく **`turn/completed.params.turn.error`** で運ぶ（§9 参照）。

---

## 4. メソッド: perform → backend

### 4.1 `initialize` (request)

perform 起動直後、最初に送る。**初期化前の他メソッド送信はエラー**になる。

**params:**

```json
{
  "capabilities": {
    "experimentalApi": true
  },
  "clientInfo": {
    "name": "perform",
    "title": "Studio Orchestrator",
    "version": "0.1.0"
  }
}
```

`capabilities.experimentalApi: true` が **必須**。`dynamicTools` と `item/tool/call` を使うために必要。`false` だと backend は実験的メソッドを拒絶しなければならない。

**result:** backend のメタ情報（user agent, `platformFamily`, `platformOs` 等）。perform は内容を解釈しないので、claude-app-server は最低限 `{}` を返せばよい。

### 4.2 `initialized` (notification)

`initialize` の応答を受け取った後、perform は通知 `initialized` を送る。`params` は空オブジェクト。  
これ以降、`thread/start` 等のリクエストを送って良い。

### 4.3 `thread/start` (request)

スレッドを開始する。1 issue につき 1 スレッド。

**params:**

```json
{
  "approvalPolicy": "<string>",
  "sandboxPolicy": { "type": "workspaceWrite", "writableRoots": [...], "networkAccess": true },
  "cwd": "/path/to/workspace",
  "dynamicTools": [ /* tool spec 配列 */ ]
}
```

perform は WORKFLOW.md の `codex:` ブロックの runtime 設定（`approval_policy` / `thread_sandbox` / `turn_sandbox_policy`）から上記 params を組み立てて送る。`agent.type: claude` のときも同じ params が乗る（claude-app-server は知らないフィールドを無視する）。

backend 固有の設定（model, permission_mode 等）は **`command` の引数**として埋め込まれているので、backend 側が起動時に解釈する。perform は **中継しない**。

backend は **知っているフィールドだけ拾い、知らないものは無視**する。これは Codex App Server SPEC の寛容な精神に従う。

**result:**

```json
{
  "thread": { "id": "thr_<uuid>" }
}
```

`thread.id` は以降の `turn/start` で参照する。

**注意:** `dynamicTools` を有効化するには `initialize.params.capabilities.experimentalApi: true` が必須。

> **Milestone 3 以降（検討中）:** state エントリの追加フィールド（`model`, `permission_mode` 等）を camelCase 化して `thread/start.params` にマージする **passthrough 機構**は将来の検討事項。詳細は [`TODO.md`](../TODO.md) 参照。

### 4.4 `turn/start` (request)

スレッドにユーザ入力を渡してターンを開始する。

**params:**

```json
{
  "threadId": "thr_<uuid>",
  "input": [
    { "type": "text", "text": "prompt body..." }
  ],
  "cwd": "/path/to/workspace",
  "title": "ABC-123: Issue title",
  "approvalPolicy": "<string>",
  "sandboxPolicy": { "type": "workspaceWrite", ... }
}
```

`input` の item types は SPEC では `text` / `image` / `localImage` / `skill` が定義されているが、**perform は `text` のみ送る**。他の type は backend が無視してよい。

**result:**

```json
{
  "turn": {
    "id": "turn_<uuid>",
    "status": "inProgress",
    "items": [],
    "error": null
  }
}
```

レスポンス即返し（受理応答）で、ターンの実処理は非同期。完了は `turn/completed` 通知で通知される。perform は `turn.id` のみ参照するが、claude-app-server は SPEC に従って full shape を返すこと。

### 4.5 `turn/interrupt` (request)

進行中ターンを中断する。エージェント切替時や issue が処理外状態に遷移したときに使う。

**params:** `{ "threadId": "thr_<uuid>" }`（実装に応じて `turnId` も含む）

**result:** `{}`（成功時は固定で空オブジェクト）

中断後、backend はターンを **`turn/completed` with `turn.status: "interrupted"`** で閉じる。**`turn/cancelled` という独立通知は SPEC に存在しない**。

中断が完了しない場合、perform は SIGTERM → SIGKILL で subprocess 自体を落とす。

---

## 5. 通知・リクエスト: backend → perform

### 5.1 ターンライフサイクル通知

backend は以下の通知をターン中に送る:

| method | 意味 |
|---|---|
| `turn/started` | `{ turn }` — ターン開始通知。`turn.status: "inProgress"`, `items: []` |
| `turn/completed` | `{ turn }` — ターン終了。`turn.status` は `completed` / `interrupted` / `failed` のいずれか |
| `turn/diff/updated` | `{ threadId, turnId, diff }` — ターン中の累積 unified diff |
| `turn/plan/updated` | `{ turnId, explanation?, plan: [{step, status}] }` — エージェントが計画を更新したとき |
| `thread/tokenUsage/updated` | スレッドの累積トークン使用量更新（perform はこれを集計に使う） |

**`turn/failed` / `turn/cancelled` という独立 method は存在しない**。失敗・中断は `turn/completed` に `turn.status` と `turn.error` を載せて表現する:

```json
{
  "method": "turn/completed",
  "params": {
    "turn": {
      "id": "turn_<uuid>",
      "status": "failed",
      "items": [...],
      "error": {
        "message": "...",
        "codexErrorInfo": "UsageLimitExceeded",
        "additionalDetails": "...",
        "httpStatusCode": 429
      }
    }
  }
}
```

### 5.2 item ライフサイクル通知

backend が出力する各種 item（assistant message、コマンド実行、ファイル変更、ツール呼び出し）のライフサイクルを通知する:

| method | 意味 |
|---|---|
| `item/started` | item 開始（**full item を送る**。後続の delta はこれを土台に追加される） |
| `item/completed` | item 終了。**最終 item を authoritative として送る**。`status` は `completed` / `failed` / `declined` 等 |
| `item/agentMessage/delta` | アシスタントメッセージのストリーミング差分（増分テキスト） |
| `item/plan/delta` | 計画項目のストリーミング差分 |
| `item/reasoning/summaryTextDelta` | reasoning 要約のストリーミング差分 |

`item/started` は item の最終形ではない初期スナップショットを運び、`item/completed` が確定版を運ぶ。perform は `item/completed` を真実の値として扱う。

### 5.3 backend → perform リクエスト（perform が応答する）

backend は以下のリクエストを送り、perform からの応答を期待する。これらは **通知ではなく request**（`id` 付き）。

| method | 期待される応答 |
|---|---|
| `item/commandExecution/requestApproval` | `{"decision": <command decision>}` |
| `item/fileChange/requestApproval` | `{"decision": <fileChange decision>}` |
| `item/tool/call` | dynamic tool の実行結果（§5.4 参照） |
| `item/tool/requestUserInput` | ユーザ入力に相当する文字列／オブジェクト |

**承認 decision の値（SPEC 仕様）:**

- **コマンド実行:** `accept` / `acceptForSession` / `decline` / `cancel` / `{ "acceptWithExecpolicyAmendment": { ... } }`
- **ファイル変更:** `accept` / `acceptForSession` / `decline` / `cancel`

perform は `auto_approve_requests: true` のとき、approval 系リクエストを **`acceptForSession` で自動承認**する。それ以外のときは AgentRunner が中断して人手介入を要求する。

**請求承認のリクエスト params（参考、SPEC 抜粋）:**

```json
{
  "method": "item/commandExecution/requestApproval",
  "id": 42,
  "params": {
    "itemId": "item_<uuid>",
    "threadId": "thr_<uuid>",
    "turnId": "turn_<uuid>",
    "reason": "...",
    "command": ["bash", "-c", "..."],
    "cwd": "...",
    "commandActions": [...],
    "availableDecisions": ["accept", "acceptForSession", "decline", "cancel"]
  }
}
```

### 5.4 dynamic tool 実行: `item/tool/call`

> 注意 (M2 Phase 3 以降): orchestrator (M2 では Symphony、M3 以降は conductor → M4 で perform) は `tracker.doing_state` / `tracker.done_state` 設定時に自動で issue 状態を更新する ([ADR-0014](adr/0014-symphony-owned-state-transitions.md))。動的ツール経路 (`linear_graphql` 等) は本家 Symphony 互換のための legacy として残しているが、`claude-app-server` は MCP 動的ツール機構を実装していないため Claude backend では機能しない。

`thread/start.params.dynamicTools` で受け取ったツール仕様に基づき、backend が perform 側で実装されているツール（典型的には `linear_graphql`）を呼び出すリクエスト。`experimentalApi: true` 必須。

**フロー:**

1. backend が `item/started`（`item.type = "dynamicToolCall"`, `status = "inProgress"`, `tool`, `arguments` 入り）を通知
2. backend が **`item/tool/call`** を request として perform に送信
3. perform がツールを実行し、`{ contentItems, success }` を `result` として返答
4. backend が `item/completed`（`item.type = "dynamicToolCall"`, 最終 `status`, `contentItems`, `success`）を通知

**perform の応答 (`result`):**

```json
{
  "success": true,
  "contentItems": [
    { "type": "...", "text": "実行結果" }
  ],
  "output": "実行結果の文字列"
}
```

`success: false` のときも同形を返し、エラー説明を入れる。`contentItems` の `type` は SPEC 上厳密に列挙されておらず、perform 実装は `inputText` を使う（claude-app-server 側はこの値を受け入れること）。`output` は Symphony 由来の拡張フィールド (perform も同じく踏襲) で、SPEC 標準ではない。

### 5.5 `serverRequest/resolved` 通知

承認や `tool/requestUserInput` などの server → client request が完了した、もしくはターンの開始・完了・中断によって取り消された後、backend は確認通知 `serverRequest/resolved` を送る:

```json
{
  "method": "serverRequest/resolved",
  "params": { "threadId": "thr_<uuid>", "requestId": 42 }
}
```

perform は現状この通知を informational として扱い、特別なロジックは持たない。新規実装ではログのみで十分。

---

## 6. Item 種別

`item.type` で区別される主要種別。本書の subset では以下を扱う。SPEC は他の種別も多数定義しており、claude-app-server は emit してもしなくてもよいが、未知の type を perform は破棄せずログ・ダッシュボードに保持する。

### `agentMessage`

アシスタントの自然言語応答。`item/agentMessage/delta` で差分テキストが流れ、`item/completed` の最終 item にフルテキストが入る。

### `commandExecution`

bash 等のコマンド実行。

```json
{
  "id": "item_<uuid>",
  "type": "commandExecution",
  "command": ["bash", "-c", "..."],
  "cwd": "/path",
  "status": "inProgress | completed | failed | declined",
  "commandActions": [...],
  "aggregatedOutput": "stdout/stderr 連結",
  "exitCode": 0,
  "durationMs": 1234
}
```

`stdout` / `stderr` 個別フィールドは SPEC に存在せず、stdout/stderr の差分は `item/commandExecution/outputDelta` 通知で流れて `aggregatedOutput` に集約される。

### `fileChange`

ファイル編集。

```json
{
  "id": "item_<uuid>",
  "type": "fileChange",
  "changes": [
    {
      "path": "src/foo.ts",
      "kind": "edit | create | delete",
      "diff": "@@ ..."
    }
  ],
  "status": "inProgress | completed | failed | declined"
}
```

差分は `item/fileChange/outputDelta` 通知で流れる。

### `dynamicToolCall`

§5.4 の dynamic tool（`linear_graphql` 等）の呼び出し item。

```json
{
  "id": "item_<uuid>",
  "type": "dynamicToolCall",
  "tool": "linear_graphql",
  "arguments": { ... },
  "status": "inProgress | completed | failed",
  "contentItems": [ ... ],
  "success": true,
  "durationMs": 234
}
```

### その他

backend が独自種別を出した場合、perform は **未知の type を破棄せずログに保持**する。新しい種別を追加しても perform は壊れない。SPEC が定義する他の種別の例: `userMessage` / `reasoning` / `plan` / `webSearch` / `imageView` / `enteredReviewMode` / `exitedReviewMode` / `contextCompaction` / `mcpToolCall` / `collabToolCall`。

---

## 7. WORKFLOW.md と thread/start.params の関係

perform は **passthrough 機構を持たない** (M3 時点)。`thread/start.params` に乗る runtime 設定は WORKFLOW.md の `codex:` ブロックから固定的に読まれる:

| WORKFLOW.md (`codex:` ブロック) | thread/start.params |
|---|---|
| `approval_policy` | `approvalPolicy` |
| `thread_sandbox` | `sandbox` |
| `turn_sandbox_policy` | `sandboxPolicy` |

`agent.type: claude` のときも同じ params が乗る（claude-app-server は知らないフィールドを無視する責任を持つ）。

backend 固有の設定（`model` / `permission_mode` / `allowed_tools` など）は **`command` の引数として WORKFLOW.md に書く**:

```yaml
claude:
  command: claude-app-server --model claude-opus-4-7 --permission-mode bypassPermissions
codex:
  command: codex --config 'model="gpt-5.5"' app-server
```

backend が起動時に自分自身の引数を解釈する責務を負う。

> **Milestone 3 以降（検討中）:** WORKFLOW.md の追加フィールドを camelCase 化して `thread/start.params` にマージする passthrough 機構は将来の検討事項。snake_case → camelCase 変換もその時に検討する。

---

## 8. 未実装メソッド

perform が使わないメソッド（`account/*`, `fs/*`, `thread/fork`, `thread/resume`, `thread/list`, `turn/steer`, `command/exec` 等）について、claude-app-server は:

- request の場合: `error.code = -32601` (Method not found) を返す
- notification の場合: 黙って捨てる

perform は本書で定義していないメソッドを送らないため、現状この拡張ポイントは backend 側の保険でしかない。将来の拡張余地として残す。

実装上は `apps/claude-app-server/src/handlers/stub.ts`（または同等）に未実装メソッドの一覧と既定応答をまとめる方針。

---

## 9. エラーハンドリング

### turn 失敗

backend が処理中にエラーに遭遇したら、独立した `turn/failed` 通知ではなく **`turn/completed`** に `turn.status: "failed"` と `turn.error` を載せて送る:

```json
{
  "method": "turn/completed",
  "params": {
    "turn": {
      "id": "turn_<uuid>",
      "status": "failed",
      "items": [...],
      "error": {
        "message": "Something went wrong",
        "codexErrorInfo": "UsageLimitExceeded",
        "additionalDetails": "...",
        "httpStatusCode": 429
      }
    }
  }
}
```

`codexErrorInfo` は SPEC 定義の文字列タグ（`UsageLimitExceeded` 等）。レート制限・課金エラーはここで運ぶ。

### レート制限

Anthropic / OpenAI のレート制限に遭遇したら:
- リトライポリシーは backend の責任
- リトライ尽きたら上記の `turn/completed` `failed` で `error.codexErrorInfo: "UsageLimitExceeded"` を送る
- perform は `max_concurrent_agents` を尊重するが、それを超えるレートは backend で吸収する

### subprocess 異常終了

backend が stdout を閉じる / 異常終了した場合:
- perform は subprocess の `exit` を検出 (Symphony 由来の Erlang port 機構は M3 で TS の child_process に置き換え済み)
- 進行中ターンを `:port_exit` で失敗扱いにする
- 次回 issue 処理時に新しい subprocess を起動

### `turn/interrupt` のセマンティクス

- backend は中断要求を受けたら**速やかに**進行中処理を停止
- 部分出力の commit / cleanup は backend の判断（典型的にはやらない）
- 完了時に `turn/completed` `status: "interrupted"` を送る

---

## 10. シーケンス例: 1 issue を完了するまで

```
perform                               backend
   │                                     │
   │── initialize ─────────────────────▶ │
   │  (capabilities.experimentalApi=true)│
   │ ◀──────────── result {capabilities} │
   │── initialized (notification) ─────▶ │
   │                                     │
   │── thread/start ───────────────────▶ │
   │  (cwd, sandboxPolicy, dynamicTools) │
   │ ◀──── result {thread:{id:"thr_X"}}  │
   │                                     │
   │── turn/start ─────────────────────▶ │
   │  (threadId, input:[{text}], …)      │
   │ ◀──── result {turn:{id:"turn_Y",    │
   │                     status:         │
   │                     "inProgress",   │
   │                     items:[],       │
   │                     error:null}}    │
   │                                     │
   │ ◀──── notif: turn/started           │
   │ ◀── notif: item/started (Bash)      │
   │ ◀── notif: item/commandExecution/   │
   │            outputDelta (output)     │
   │                                     │
   │ ◀── req: item/commandExecution/     │
   │          requestApproval            │
   │── result {decision:"acceptForSession"} ▶
   │ ◀── notif: serverRequest/resolved   │
   │                                     │
   │ ◀── notif: item/completed (Bash)    │
   │ ◀── notif: item/started (Edit)      │
   │ ◀── notif: item/fileChange/         │
   │            outputDelta              │
   │ ◀── notif: item/completed (Edit)    │
   │ ◀── notif: item/started             │
   │            (dynamicToolCall:        │
   │             linear_graphql)         │
   │                                     │
   │ ◀── req: item/tool/call             │
   │     {tool:"linear_graphql", ...}    │
   │── result {success:true,             │
   │           contentItems:[...]} ────▶ │
   │ ◀── notif: serverRequest/resolved   │
   │ ◀── notif: item/completed           │
   │            (dynamicToolCall)        │
   │                                     │
   │ ◀── notif: item/agentMessage/delta  │
   │            ("Done.")                │
   │ ◀── notif: thread/tokenUsage/updated│
   │ ◀── notif: turn/completed           │
   │            {turn:{status:           │
   │                   "completed",...}} │
   │                                     │
   │── (次の issue or shutdown) ────────▶ │
```

---

## 11. 将来の拡張: 擬似フルセット応答

現状は本書で定義したサブセットのみ実装する。将来、perform 以外のクライアント（例: Codex 本家対象のツール）から claude-app-server を使う需要が出た場合、claude-app-server に**擬似フルセット応答**を追加する余地がある:

- `account/*` → 認証済みユーザの擬似情報を返す
- `fs/*` → ホスト fs を直接読み書きするか、`-32601` を返すか選べる
- `thread/fork` → 既存スレッドを duplicate する擬似実装
- `thread/list` / `thread/read` → メモリ上のスレッド履歴を返す
- `command/exec` → ホスト上で直接コマンド実行（要セキュリティ検討）

この拡張は **ユーザ目線で必要が出たら** 着手する。Milestone 1 範囲では未対応で、`-32601` で十分。

---

## 12. 参考資料

- [`architecture.md`](./architecture.md): モノレポ全体の設計とコンポーネント構成
- [`vendor/codex/app-server.md`](./vendor/codex/app-server.md): Codex App Server SPEC のスナップショット（参考）
- [Codex App Server (openai/codex)](https://github.com/openai/codex/tree/main/codex-rs/app-server): 本家の Rust 実装（参考）
- [Codex App Server ドキュメント](https://developers.openai.com/codex/app-server)
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
