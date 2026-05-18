# `apps/claude-app-server` 実装指示書

## あなたの担当

このディレクトリは **Codex App Server と互換の JSON-RPC 2.0 サーバを Claude Code (Anthropic Agent SDK) バックエンドで実装**する担当です。  
モノレポ全体の文脈は **リポジトリルートの `CLAUDE.md`** を読むこと。このファイルは claude-app-server に固有の事項のみ扱う。

---

## このアプリの位置づけ

- 同モノレポ内の `apps/perform` から subprocess として起動される
- 通信は **stdio (JSONL) の JSON-RPC 2.0**
- Claude Code を Codex App Server クライアントから透過的に使えるようにする独立資産
- **perform 専用ではない**。設計上は Codex VS Code 拡張など他の Codex App Server クライアントからも使える形にしておく

---

## 実装の概要

### スタック

- 言語: TypeScript
- ランタイム: Node.js 20+
- 依存: `@anthropic-ai/claude-agent-sdk`
- パッケージ名: `claude-app-server`（公開しない前提でスコープなし、`"private": true`）
- エントリポイント: `claude-app-server` という CLI コマンド
- ライセンス: Apache-2.0

### プロトコル

**JSON-RPC 2.0 (`jsonrpc` フィールドは省略可、Codex App Server の慣習に倣う)** を **stdio (JSONL = newline-delimited JSON)** で。

WebSocket トランスポートは実装しない。

### 認証

- Claude Pro/Max サブスクリプション認証前提
- `claude` CLI が `~/.claude/` から読む OAuth トークンを使う
- API キーは使わない
- 起動時に `delete process.env.ANTHROPIC_API_KEY` で明示的にクリア（あった場合に CLI が誤って優先するのを防ぐ）

### 実装する JSON-RPC メソッド

両アプリ共通の凍結事項はルート CLAUDE.md 参照。再掲:

| メソッド | 種類 | 必須/任意 |
|---|---|---|
| `initialize` | request | 必須 |
| `initialized` | notification | 必須 |
| `thread/start` | request | 必須 |
| `turn/start` | request | 必須 |
| `turn/interrupt` | request | 必須 |
| `thread/resume` | request | 任意（スタブで OK） |
| `mcpServerStatus/list` | request | 任意（空配列でOK） |
| その他全部 | - | 未実装、JSON-RPC エラー -32601 を返す |

将来「擬似的なレスポンスを返したい」とユーザから要望が出る可能性。**全メソッドが共通のディスパッチャを通る構造**にしておき、後でスタブハンドラを足せるようにする。

### 実装する通知（サーバ→クライアント）

| 通知 | タイミング |
|---|---|
| `thread/started` | `thread/start` レスポンス直後 |
| `turn/started` | ターンが実際に動き出した時 |
| `item/started` | 各 item の開始 |
| `item/completed` | 各 item の完了 (authoritative state) |
| `item/agentMessage/delta` | テキスト部分送信 |
| `item/commandExecution/outputDelta` | bash の stdout/stderr |
| `item/fileChange/outputDelta` | apply_patch 結果 |
| `turn/completed` | ターン終了 |
| `thread/tokenUsage/updated` | トークン使用量（任意） |

### Claude オプションマッピング

`thread/start` または `turn/start` で受け取る Codex 風パラメータを、Claude Agent SDK のオプションに変換:

| Codex 風パラメータ | Claude SDK オプション | 備考 |
|---|---|---|
| `params.cwd` | `cwd` | そのまま |
| `params.model` | `model` | `claude-opus-4-7` 等 |
| `params.sandboxPolicy.type` | `permissionMode` | 下表参照 |
| `params.approvalPolicy` | (主に無視) | perform は `never` を渡してくる |

サンドボックスマッピング:

| Codex sandboxPolicy.type | Claude permissionMode |
|---|---|
| `dangerFullAccess` | `bypassPermissions` |
| `workspaceWrite` | `acceptEdits` |
| `readOnly` | `default` |
| 未指定 | `default` |

加えて、`canUseTool: async (_tool, input) => ({ behavior: 'allow', updatedInput: input })` を常に設定（perform の `approval_policy: never` に対応）。

### イベントマッピング (Claude Agent SDK → Codex item)

```
SDK message type    → Codex item type
────────────────────────────────────────
system.init         → (内部処理: session_id を保存)
assistant (text)    → agentMessage (item/started → delta → item/completed)
assistant (tool_use Bash)               → commandExecution
assistant (tool_use Edit/Write/MultiEdit) → fileChange
assistant (tool_use Read/Glob/Grep)     → mcpToolCall (薄いラッパー)
assistant (tool_use その他)              → mcpToolCall
user (tool_result)  → (上記 item の completed に統合)
stream_event (text_delta) → item/agentMessage/delta
result              → turn/completed (status と usage を含む)
```

ツール ID: Claude SDK の `tool_use.id` をそのまま Codex item の `id` にマップ。`tool_result` 結合に使う。

### thread_id と Claude session_id の管理

- 自前で `thr_<uuid>` を発行 → Codex 風 thread_id
- Claude SDK が返す `session_id` を内部で対応表に保存
- 2 ターン目以降は `query()` の `resume` オプションに Claude SDK の session_id を渡す

---

## ディレクトリ構成

```
apps/claude-app-server/
├── CLAUDE.md                     # ★ このファイル
├── README.md
├── package.json
├── tsconfig.json
├── LICENSE
├── src/
│   ├── bin.ts                    # シェバン付き CLI エントリ
│   ├── server.ts                 # サーバ本体（main 関数）
│   ├── jsonrpc/
│   │   ├── transport.ts          # stdio JSONL 読み書き
│   │   ├── dispatcher.ts         # method → handler ルーティング
│   │   └── types.ts              # Request/Response/Notification 型
│   ├── handlers/
│   │   ├── initialize.ts
│   │   ├── thread.ts             # thread/start, thread/resume(stub)
│   │   ├── turn.ts               # turn/start, turn/interrupt
│   │   ├── stub.ts               # 未実装メソッドの error 応答用
│   │   └── index.ts              # ハンドラ登録の集約
│   ├── claude/
│   │   ├── session.ts            # Claude セッション管理（resume 含む）
│   │   ├── event_mapper.ts       # SDK message → Codex item 変換
│   │   ├── permission.ts         # canUseTool / permissionMode マッピング
│   │   └── usage.ts              # トークン集計
│   ├── state/
│   │   └── threads.ts            # thread_id → session のマップ
│   └── util/
│       ├── logger.ts             # stderr に出すログ
│       └── ids.ts                # uuid 生成ユーティリティ
├── test/
│   ├── jsonrpc.test.ts
│   ├── event_mapper.test.ts
│   └── e2e/
│       └── basic_turn.test.ts
└── examples/
    └── manual_test.jsonl         # 手動疎通確認用
```

---

## 実装フェーズ

### Phase 1: スケルトン疎通 (1日)

ゴール: `claude-app-server` を起動して `initialize` に応答を返せるところまで。

1. `package.json`, `tsconfig.json`, `src/bin.ts` 整備
2. JSON-RPC 型定義 (`src/jsonrpc/types.ts`)
3. JSONL トランスポート (`src/jsonrpc/transport.ts`) — stdin から1行ずつ読んで JSON.parse、stdout に書く
4. Dispatcher (`src/jsonrpc/dispatcher.ts`) — method 名でハンドラを呼ぶ、エラーキャッチ
5. `initialize` ハンドラ実装、`initialized` 通知受信ハンドリング
6. **動作確認**: 最初の `initialize` リクエストだけ流して応答が返ること

### Phase 2: thread/turn の基本フロー (2〜3日)

ゴール: 簡単なプロンプト（"What is 2+2?"）を投げて回答が `agentMessage` として流れてくる。

1. `state/threads.ts` でスレッド管理
2. `claude/session.ts` で Claude Agent SDK の `query()` 呼び出しをラップ
3. `thread/start` ハンドラ → `thr_<uuid>` 発行、レスポンス + `thread/started` 通知
4. `turn/start` ハンドラ → ターン作成、レスポンス即返し → 非同期で SDK 呼ぶ
5. `claude/event_mapper.ts` で `assistant` メッセージの text を `agentMessage` 関連通知に変換
6. `turn/completed` 通知

### Phase 3: ツール呼び出しのマッピング (2〜3日)

ゴール: Bash や Edit ツールが使われた時に対応する Codex item として通知。

1. `tool_use` (Bash) → `commandExecution` item の組み立て
2. `tool_use` (Edit/Write/MultiEdit) → `fileChange` item の組み立て
3. `tool_use` (Read/Glob/Grep その他) → 最小限の `mcpToolCall` 風 item
4. `tool_result` で対応 item を `item/completed` に
5. ストリーミングの `command/exec/outputDelta` 風通知
6. `turn/interrupt` 実装（AbortController で SDK 呼び出しを中断）

### Phase 4: 仕上げ (1〜2日)

1. 未実装メソッド用の `stub` ハンドラ（後で擬似応答に拡張可能な構造で）
2. レート制限ハンドリング、`turn/completed status:failed` で抜ける
3. トークン使用量の集計と `thread/tokenUsage/updated` 通知
4. `partial messages` 有効化で `text_delta` ストリーミング対応
5. README とサンプル

---

## 落とし穴

### stdout の汚染禁止

JSON-RPC 専用なので **stdout に他のものを絶対に書かない**。`console.log` も禁止。
- ログは必ず stderr (`console.error`、`process.stderr.write`)
- Claude Agent SDK 自体が stdout に何か書く設定があったら無効化

### thread_id と session_id の混同

- `thread_id` はこのサーバが発行する Codex 互換 ID (`thr_<uuid>`)
- `session_id` は Claude SDK 内部の ID
- **両者を必ず別フィールドで管理**、ログにもラベル付けて出す

### partial messages のタイミング

- `includePartialMessages: true` にすると `stream_event` で `text_delta` を取れる
- 最初は使わなくても動く（Phase 2 では無効、Phase 4 で有効化）

### Bash ツールの cwd

- Codex は各 `command/exec` で cwd 指定可能
- Claude SDK は session 単位で `cwd` 固定
- perform はターン中に動的 cwd 変更しないので問題なし

### permissionMode の優先順位

- `permissionMode: 'bypassPermissions'` 設定しても、`canUseTool` コールバックがあるとそちら優先される SDK バージョンあり
- **両方設定**（bypassPermissions + canUseTool 全 allow）。冗長だが安全

### perform が送る不明フィールド

perform は WORKFLOW.md の `agent.states[*]` および `agent.default` の `command` 以外の全フィールド（`model`, `permission_mode`, `allowed_tools`, `approval_policy`, `sandbox_policy`, `effort` など）を snake_case → camelCase に変換した上でそのまま `thread/start` / `turn/start` に渡してくる。**知らないフィールドは無視**して落ちないようにする（Codex App Server SPEC の寛容ポリシーに合わせる）。

---

## 動作確認手順

### Phase 1 完了時点

```bash
cd apps/claude-app-server
pnpm install
pnpm build

# 認証確認
claude --version

# 単体起動
echo '{"method":"initialize","id":0,"params":{"clientInfo":{"name":"test","title":"Test","version":"0.1.0"}}}' \
  | node dist/bin.js

# 期待: {"id":0,"result":{"userAgent":"...","platformFamily":"...","platformOs":"..."}}
```

### Phase 2 完了時点

```bash
cat examples/manual_test.jsonl | node dist/bin.js
# 期待: thread/started、turn/started、item/started、item/agentMessage/delta、item/completed、turn/completed が流れる
```

`examples/manual_test.jsonl` 例:

```jsonl
{"method":"initialize","id":0,"params":{"clientInfo":{"name":"test","title":"Test","version":"0.1.0"}}}
{"method":"initialized","params":{}}
{"method":"thread/start","id":1,"params":{"model":"claude-opus-4-7","cwd":"/tmp"}}
{"method":"turn/start","id":2,"params":{"threadId":"REPLACE_WITH_RESPONSE","input":[{"type":"text","text":"What is 2+2?"}]}}
```

### perform 側との結合確認

ルート `pnpm test:e2e` 経由で。ユーザと協調。

---

## 不確実性 / 実装中の判断事項

実装中にユーザに確認すべき項目:

1. **Claude Agent SDK の `resume` の Pro/Max 安定性**: 動かなければ毎ターン新規セッションにフォールバック
2. **`stream_event` の text_delta 形式**: SDK バージョンによって違う可能性
3. **`thread/tokenUsage/updated` のフィールド命名**: Codex の正確なスキーマと揃えるか
4. **MCP サーバ機能**: `linear_graphql` 動的ツール対応は将来。現時点では実装しない、コメントだけ残す
5. **ログレベル制御**: 環境変数 `CLAUDE_APP_SERVER_LOG_LEVEL` 等

---

## 完了条件

- [x] Phase 1〜4 の全項目完了 (outputDelta ストリーミングは Milestone 3 以降に分離)
- [x] `pnpm build` がエラーなく通る
- [x] 手動確認シナリオが成功 (Phase 2 / Phase 3 / Phase 4 各段階で確認済み、E2E は `pnpm test:e2e` で自動化)
- [x] `pnpm test` が通る (2026-05-14: 145 tests pass)
- [x] README に最低限の使い方 (起動方法 / 認証 / 対応プロトコル / 本家との差異 / 未実装メソッド / レート制限 / 開発)
- [x] ルートの `pnpm test:e2e` から呼び出される統合テストに対応

---

## 参考資料

- ルート `CLAUDE.md`（必読）
- perform の動作仕様は [`apps/perform/CLAUDE.md`](../perform/CLAUDE.md)
- Codex App Server: https://github.com/openai/codex/tree/main/codex-rs/app-server
- Codex App Server ドキュメント: https://developers.openai.com/codex/app-server
- Claude Agent SDK: https://docs.claude.com/en/api/agent-sdk/overview
- 参考実装 (clode-app-server): https://github.com/sumansid/clode-app-server （アイデア参考、コピペ非推奨）

---

## 質問があれば

実装中に詰まったら:

1. 該当のソースコードまたは差分
2. 期待する挙動と実際の挙動
3. SDK のメッセージダンプ（あれば）
4. 試した対処と結果

仕様の解釈に迷ったら、**perform が実際に何を送ってくるか優先**で判断すること。  
Codex App Server SPEC との完全互換は目標ではない。
