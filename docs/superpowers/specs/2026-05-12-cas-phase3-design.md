# claude-app-server Phase 3 設計

**対象:** `apps/claude-app-server` Phase 3 (ツール呼び出しのマッピング)
**前提:** Phase 2 完了 (2026-05-12 main マージ済み、97 tests + E2E PASS)
**ゴール:** Claude Agent SDK が発行する `tool_use` / `tool_result` を Codex 風の `commandExecution` / `fileChange` / `mcpToolCall` item にマッピングし、`item/started` → `item/completed` のライフサイクル通知を Symphony に届ける

---

## 1. スコープ

### 含むもの

- `tool_use` (Bash) → `commandExecution` item の組み立て
- `tool_use` (Edit / Write / MultiEdit) → `fileChange` item の組み立て (`diff` は簡易表現)
- `tool_use` (Read / Glob / Grep / WebFetch / TodoWrite / その他) → `mcpToolCall` item の薄いラッパー
- `tool_result` 受信時に対応 item を `item/completed` に閉じる
- ターン終了時の pending item クローズ (`ResultSuccess` → `completed` / `ResultError` → `failed` / abort → `interrupted`)
- `SdkMessage.parse` をブロック単位分解に再設計 (戻り値を `SdkMessage[]` に)
- `EventMapper` の `MapperState` に pending tool map を追加
- README に Codex App Server 本家との既知の差異セクションを追加

### 含まないもの (Phase 4 以降)

- `commandExecution/outputDelta` 通知 (Claude Agent SDK が tool 実行中の段階的出力を露出しないため省略。本家との既知の差異)
- `fileChange/outputDelta` 通知 (同上)
- `fileChange.changes[*].diff` の本格的な unified diff 生成
- `thread/tokenUsage/updated` 通知
- レート制限ハンドリング (`UsageLimitExceeded`)
- `partial_message` による text_delta ストリーミング
- 未実装メソッド `stub.ts`

`turn/interrupt` 自体は Phase 2 で受け口を実装済み (AbortController 経由)。Phase 3 では tool 実行中の abort 動作を E2E で確認するのみで、新規ハンドラは追加しない。

---

## 2. モジュール構成

新規および変更ファイル:

```
src/claude/
├── sdk-message.ts         # 変更: parse(raw): SdkMessage[] にする (ブロック分解)
├── event-mapper.ts        # 変更: MapperState に pendingTools 追加、tool 系ブランチ拡張、closeAll を追加
├── tool-item.ts           # 新規: tool_use.input → Codex item 変換ロジック (純粋関数)
└── session.ts             # 微変更: SdkMessage[] ループ対応、closeAll 呼び出しに変更

test/claude/
├── sdk-message.test.ts    # 既存拡張: ブロック分解、複数 yield、混在パターン
├── tool-item.test.ts      # 新規: tool ごとの started / completed shape
└── event-mapper.test.ts   # 既存拡張: tool フロー、pending close 戦略

apps/claude-app-server/README.md   # 新規: Codex 本家との既知の差異セクション含む
examples/manual_test.jsonl         # 拡張: tool 系シナリオを追加
```

`handlers/turn.ts` は変更不要 (Phase 2 のまま)。

`tool-item.ts` を `event-mapper.ts` から独立させる理由は **TDD で純粋関数として書きやすい / EventMapper の責務肥大を防ぐ** ため。`tool-item.ts` は副作用ゼロ、`tool_use` の input パースと item shape 構築のみを担う。

---

## 3. `SdkMessage` の再設計

### 3.1 戻り値を配列化

現状の `SdkMessage.parse(raw): SdkMessage` を **`SdkMessage.parse(raw): SdkMessage[]`** に変える。

- `system`, `result` 系は **1 要素** の配列を返す
- `assistant` メッセージは `content[]` を順走査し、ブロックごとに DU バリアントを yield:
  - `text` ブロック → `AssistantText`
  - `tool_use` ブロック → `AssistantToolUse`
  - その他 (`thinking` などの未知ブロック) → 黙殺 (skip)
- `user` メッセージは `tool_result` ブロックを順に拾って `UserToolResult[]` (複数ツール並列実行を想定)
- パース不能 → `[{ kind: "Unknown", raw }]` の単一要素

### 3.2 DU バリアントは変えない

`SdkMessage` の DU バリアント (`kind: "AssistantText" | "AssistantToolUse" | ...`) は Phase 2 のまま。**変わるのは `parse` の戻り値の cardinality だけ**。これにより event-mapper 側の switch は既存のまま拡張できる。

### 3.3 session.ts 側のループ

```typescript
for await (const raw of deps.query({ prompt, options })) {
  for (const parsed of SdkMessage.parse(raw)) {
    // SystemInit から sessionId を抜く処理
    if (parsed.kind === "SystemInit") {
      const sid = SessionId.parse(parsed.sessionId);
      if (sid.type === "Success") threads.setSessionId(thread.id, sid.value);
    }
    const r = EventMapper.map(parsed, mapperState, mapCtx);
    mapperState = r.state;
    for (const n of r.notifications) sendNotification(n);

    if (parsed.kind === "ResultError") {
      status = "failed";
      error = { message: parsed.errors.join("; ") || `result error: ${parsed.subtype}` };
    }
  }
}
```

---

## 4. `EventMapper` の pending tool 管理

### 4.1 `MapperState` 拡張

```typescript
type PendingTool = Readonly<{
  itemId: ItemId;
  itemType: "commandExecution" | "fileChange" | "mcpToolCall";
  startedItem: Readonly<Record<string, unknown>>;  // item/started で送ったのと同じ shape
}>;

type MapperState = Readonly<{
  currentAgentMessage?: Readonly<{ itemId: ItemId; text: string }>;
  pendingTools: ReadonlyMap<string, PendingTool>;   // key: tool_use_id
}>;
```

`initialState()` は `{ pendingTools: new Map() }` を返す。

### 4.2 遷移ルール

| 受信 `SdkMessage.kind` | 挙動 |
|---|---|
| `SystemInit` | state そのまま、notifications なし |
| `AssistantText` | 既存通り: 進行中 agentMessage を close → 新 agentMessage を open。pending tool には触らない |
| `AssistantToolUse` | 進行中 agentMessage を close → `tool-item.ts` で `item/started` を組み立て → `pendingTools` に `(toolUseId → PendingTool)` を登録 |
| `UserToolResult` | `pendingTools` から `toolUseId` で引いて、`tool_result.content` を整形した `item/completed` を発行 → pending から削除。**pending に無い `tool_result` は黙殺** (Claude SDK のバグや想定外ケースのフォールバック) |
| `ResultSuccess` / `ResultError` | **何もしない**。session.ts が `closeAll` を必ず呼ぶので map 側で close すると二重通知になる |
| `Unknown` | state そのまま、notifications なし |

### 4.3 `closeAll(state, ctx, reason)`

ターン終了処理用の公開関数を追加:

```typescript
type CloseReason = "completed" | "failed" | "interrupted";

closeAll(state: MapperState, ctx: MapperCtx, reason: CloseReason): MapResult
```

挙動:

1. `currentAgentMessage` があれば `item/completed` を `status: reason` で発行 (`agentMessage` の status 取り得る値は SPEC 上 `completed`/`failed` だが、`interrupted` も Symphony は破棄しないログる)
2. `pendingTools` の各エントリについて、`item/completed` を `status: reason` 相当で発行
3. 戻り値 state は `{ pendingTools: 空 Map, currentAgentMessage: undefined }`

pending tool item の `completed` shape は `startedItem` をベースに `status` と `tool_result` 由来フィールドのデフォルト (空文字列など) を埋める。

### 4.4 純粋性の維持

`EventMapper.map` および `EventMapper.closeAll` は (state, msg, ctx) → (新 state, notifications) のまま、副作用なし。pending map は immutable の `ReadonlyMap` でコピーして更新する。

---

## 5. `tool-item.ts` のマッピング規則

### 5.1 dispatch

```typescript
const dispatch = (name: string): "commandExecution" | "fileChange" | "mcpToolCall" => {
  switch (name) {
    case "Bash":
      return "commandExecution";
    case "Edit":
    case "Write":
    case "MultiEdit":
      return "fileChange";
    default:
      return "mcpToolCall";
  }
};
```

`default` で `mcpToolCall` に流すので、新しい tool 名 (`BashOutput`, `KillShell`, `NotebookEdit` 等) にも自然に対応する。

### 5.2 Bash → `commandExecution`

`tool_use.input` 想定: `{ command: string, description?: string, timeout?: number }` (Claude Bash tool の公開仕様)。

`item/started` shape:

```json
{
  "id": "item_<uuid>",
  "type": "commandExecution",
  "command": ["bash", "-c", "<input.command>"],
  "cwd": "<thread.cwd>",
  "status": "inProgress",
  "commandActions": [],
  "aggregatedOutput": "",
  "exitCode": null,
  "durationMs": null
}
```

`item/completed` (tool_result 受信時):

- `aggregatedOutput` ← `tool_result.content` を文字列化 (配列なら `text` ブロックの text を連結、文字列ならそのまま)
- `exitCode` ← 一律 `null` (Claude SDK は exit code を返さない、README に差異記載)
- `is_error: true` なら `status: "failed"`、それ以外 `status: "completed"`
- `durationMs` ← `null` (Phase 3 では計測しない)

### 5.3 Edit / Write / MultiEdit → `fileChange`

input 想定:
- Edit: `{ file_path, old_string, new_string, replace_all? }`
- Write: `{ file_path, content }`
- MultiEdit: `{ file_path, edits: [{old_string, new_string, replace_all?}, ...] }`

`item/started` shape:

```json
{
  "id": "item_<uuid>",
  "type": "fileChange",
  "changes": [{
    "path": "<input.file_path>",
    "kind": "edit" | "create",
    "diff": "<簡易表現>"
  }],
  "status": "inProgress"
}
```

`kind` 決定:
- Write → `"create"` (Claude SDK は新規/既存を区別しないので一律 `create`。README に差異記載)
- Edit, MultiEdit → `"edit"`
- `"delete"` は Claude tool には対応概念がないので発行しない

`buildSimpleDiff`:
- Edit: `` `< ${old_string}\n> ${new_string}` ``
- Write: `` `> ${content}` ``
- MultiEdit: 各 edit を Edit と同形式で `\n---\n` 区切り連結

`item/completed` (tool_result 受信時):
- `changes` は started のものをそのまま保持
- `is_error: true` なら `status: "failed"`、それ以外 `status: "completed"`

### 5.4 その他 → `mcpToolCall`

`item/started` shape:

```json
{
  "id": "item_<uuid>",
  "type": "mcpToolCall",
  "server": "claude-builtin",
  "tool": "<tool_use.name>",
  "arguments": <tool_use.input>,
  "status": "inProgress"
}
```

`server: "claude-builtin"` 固定 (Claude builtin tool に MCP server 概念がないため識別用の placeholder)。README に差異記載。

`item/completed` (tool_result 受信時):
- `result` ← `tool_result.content` を文字列化
- `is_error: true` なら `status: "failed"`、それ以外 `status: "completed"`

### 5.5 `tool_result.content` の正規化

Claude Agent SDK の `tool_result.content` は以下のいずれか:
- 文字列 (例: `"File updated"`)
- ブロック配列 (例: `[{ type: "text", text: "..." }, ...]`)
- その他 (image など) → 未対応、文字列化は `JSON.stringify` の fallback

`tool-item.ts` 内に `normalizeToolResultContent(content: unknown): string` を置く:
- 文字列 → そのまま
- 配列 → 各要素の `text` フィールドを連結、`text` がなければ `JSON.stringify`
- それ以外 → `JSON.stringify`

---

## 6. session.ts の変更点

### 6.1 ループ構造

`§3.3` のとおり `SdkMessage.parse(raw)` の戻り値が配列になったため、内部 for ループを追加する。

### 6.2 `closeAll` 呼び出し

Phase 2 の `closeAgentMessageIfAny` (ResultError を疑似的に流して close ロジックを再利用) は廃止し、`EventMapper.closeAll` を直接呼ぶ:

```typescript
const finalReason: CloseReason =
  status === "interrupted" ? "interrupted" :
  status === "failed"      ? "failed"      :
                             "completed";

const closed = EventMapper.closeAll(mapperState, mapCtx, finalReason);
for (const n of closed.notifications) sendNotification(n);
```

呼び出しタイミング:
- 正常終了 (`ResultSuccess` 受信後 for ループ抜け) → `"completed"`
- `ResultError` 受信 → `"failed"`
- `AbortError` キャッチ → `"interrupted"`
- その他 throw → `"failed"`

これにより Phase 2 メモにあった「設計の継ぎ目」(疑似 ResultError を流すハック) を解消する。

### 6.3 unit テスト不要は継続

session.ts は引き続き境界レイヤとして unit テストなし、手動 E2E のみで検証する。

---

## 7. README

`apps/claude-app-server/README.md` を新規作成。最低限の構成:

1. **概要** (1 段落): Codex App Server 互換の JSON-RPC サーバを Claude Agent SDK バックエンドで提供。Symphony から subprocess として起動される。
2. **起動方法**: CLI 引数の例 (`--model`, `--permission-mode` 等)
3. **対応プロトコル**: 実装している method 一覧へのリンク (`docs/protocol.md`)
4. **Codex App Server 本家との既知の差異**:

| 項目 | Codex 本家 | claude-app-server | 理由 |
|---|---|---|---|
| `item/commandExecution/outputDelta` | bash 実行中に stdout/stderr を逐次配信 | 出さない。`item/completed.aggregatedOutput` に最終結果のみ | Claude Agent SDK が tool 実行中の段階的出力を露出しない |
| `item/fileChange/outputDelta` | 編集中の差分を逐次配信 | 出さない | 同上 |
| `commandExecution.exitCode` | プロセスの実 exit code | 一律 `null` (`is_error: true` で `status: "failed"` 判別) | Claude SDK が exit code を返さない |
| `commandExecution.durationMs` | 実時間計測 | 一律 `null` | Phase 3 では計測しない |
| `fileChange.changes[*].diff` | unified diff | 簡易表現 (`< old\n> new`) | Phase 3 工数都合。Phase 4+ で改善余地 |
| `fileChange.changes[*].kind` | edit/create/delete を正確判定 | Edit/MultiEdit → `edit`、Write → 一律 `create` | Claude SDK 上で新規/既存を判別不能 |
| `mcpToolCall.server` | 実 MCP server 名 | `"claude-builtin"` 固定 | Claude builtin tool に MCP server 概念がない |
| `thread/tokenUsage/updated` | 都度発行 | 未発行 | Phase 4 で対応予定 |
| 未実装メソッド | (Codex 互換すべて実装) | `-32601 Method not found` | Symphony が使う subset のみサポート |

5. **互換性**: Symphony と組み合わせる限り上記差異は問題にならない (Symphony はこれらに依存しない) ことを 1 文で書く。

---

## 8. テスト方針

### 8.1 `sdk-message.test.ts` (既存拡張)

- assistant message に text 1 個 → `[AssistantText]`
- assistant message に tool_use 1 個 → `[AssistantToolUse]`
- assistant message に text + tool_use 混在 → 順序保持で複数要素配列
- assistant message に複数 tool_use → 複数 `AssistantToolUse` 要素
- user message に複数 tool_result → 複数 `UserToolResult` 要素
- 既存ケースの単一要素配列での後方互換

### 8.2 `tool-item.test.ts` (新規)

- `dispatch("Bash" | "Edit" | "Write" | "MultiEdit" | "Read" | 未知名)` のカバレッジ
- Bash の started shape (command 配列、cwd、初期値)
- Bash の completed shape (`aggregatedOutput`、`status` 切り替え、`is_error` 時の failed)
- Edit / Write / MultiEdit の `kind` と `diff` (各 input の形)
- mcpToolCall (Read, Glob, WebFetch) の shape
- `tool_result.content` 正規化 (文字列、ブロック配列、未知形)
- `tool_result.is_error: true` → `status: "failed"`

### 8.3 `event-mapper.test.ts` (既存拡張)

- `AssistantToolUse` 受信 → 進行中 agentMessage close + `item/started` + pending 登録
- `UserToolResult` 受信 → pending から削除 + `item/completed`
- pending に無い `tool_result` → 黙殺 (notifications なし、state そのまま)
- `AssistantText → AssistantToolUse → AssistantText` の順序保持 (1 メッセージ内 / 別メッセージにまたがる両方)
- 並列 tool_use (1 assistant に 2 つの tool_use) → 2 つの pending エントリが独立に作られ、それぞれ独立に閉じられる
- `closeAll` の 3 reason (`completed`/`failed`/`interrupted`) × {pending なし / agentMessage のみ / tool 1 個 / 混在} の組み合わせ
- `ResultSuccess` / `ResultError` 受信時は notifications 0 件 (close は session.ts 側の責務)

### 8.4 手動 E2E (`examples/manual_test.jsonl`)

シナリオを拡張:
1. `Write` で一時ファイル作成 (e.g. `/tmp/cas-phase3-test.txt`)
2. `Read` で読み戻し
3. `Bash` で `cat` 実行
4. 最後に agentMessage で結果報告

期待される通知列:
- `turn/started`
- `item/started` (fileChange) → `item/completed` (fileChange, completed)
- `item/started` (mcpToolCall, tool=Read) → `item/completed` (mcpToolCall, completed)
- `item/started` (commandExecution) → `item/completed` (commandExecution, completed)
- `item/started` (agentMessage) → `item/agentMessage/delta` → `item/completed` (agentMessage, completed)
- `turn/completed` (status: completed)

実行手順は `docs/e2e_testing.md` または Phase 2 で導入した手順に従う。

### 8.5 session.ts は unit テスト不要

Phase 2 と同じ方針: 境界レイヤとして unit テストなし、手動 E2E のみ。

---

## 9. 設計判断ログ

ブレストで合意した主要判断 (Phase 3 で確定):

- **outputDelta は出さない**: Claude Agent SDK が tool 実行中の段階的出力を露出しないため。Codex 本家との差異として README に明記。
- **その他のツール (Read/Glob/Grep 等) は `mcpToolCall` で包む**: ダッシュボードでエージェント挙動を可視化するため。`server: "claude-builtin"` 固定。
- **`SdkMessage.parse` をブロック単位分解に再設計**: 1 メッセージ内の text と tool_use の混在を正確に扱うため。`parse(raw): SdkMessage[]` に変更。
- **`fileChange.diff` は簡易表現**: unified diff の本格生成は工数大、Phase 4+ で改善余地。簡易表現でも目視可能。
- **pending close は終了種別ごとに使い分け**: `ResultSuccess` → `completed`、`ResultError` → `failed`、abort → `interrupted`。EventMapper に `closeAll(state, ctx, reason)` を一級市民として追加し、Phase 2 の疑似 ResultError ハックを廃止。
- **dispatch は switch 文**: event-mapper の `msg.kind` 分岐と一貫させる。`default` で `mcpToolCall` に流すので tool 名の追加に強い。

---

## 10. 参考

- ルート [`CLAUDE.md`](../../../CLAUDE.md)
- [`apps/claude-app-server/CLAUDE.md`](../../../apps/claude-app-server/CLAUDE.md)
- [`docs/protocol.md`](../../protocol.md)
- Phase 2 設計: [`2026-05-12-cas-phase2-design.md`](./2026-05-12-cas-phase2-design.md)
- [`TODO.md`](../../../TODO.md)
