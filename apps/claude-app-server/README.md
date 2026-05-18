# `claude-app-server`

Codex App Server 互換の JSON-RPC 2.0 stdio サーバを Claude Agent SDK バックエンドで提供する。同モノレポの `apps/perform` から subprocess として起動されるのが主な用途だが、設計上は Codex App Server プロトコル互換の任意のクライアントから呼べる。設計の詳細は [`../../CLAUDE.md`](../../CLAUDE.md) と [`docs/protocol.md`](../../docs/protocol.md) を参照。

## 起動方法

```bash
claude-app-server --model claude-opus-4-7 --permission-mode bypassPermissions
```

CLI 引数:

- `--model <id>` Claude モデル ID (例: `claude-opus-4-7`)
- `--permission-mode <mode>` `default` / `acceptEdits` / `bypassPermissions`
- `--allowed-tools <list>` 許可するツール名 (カンマ区切り)
- `--cwd <path>` 既定 cwd (`thread/start.params.cwd` で上書き可能)

`thread/start.params` が後勝ち。

## 認証

Claude Pro/Max サブスクリプション (OAuth) 前提。起動時に `ANTHROPIC_API_KEY` 環境変数があってもクリアして CLI の `~/.claude/` を必ず使う。

## 対応プロトコル

`docs/protocol.md` の subset を実装:

- `initialize` / `initialized`
- `thread/start`
- `turn/start` / `turn/interrupt`

未実装メソッドは `-32601 Method not found` を返す。

## Codex App Server 本家との既知の差異

| 項目 | Codex 本家 | claude-app-server | 理由 |
|---|---|---|---|
| `item/commandExecution/outputDelta` | bash 実行中に stdout/stderr を逐次配信 | 出さない。`item/completed.aggregatedOutput` に最終結果のみ | Claude Agent SDK が tool 実行中の段階的出力を露出しない |
| `item/fileChange/outputDelta` | 編集中の差分を逐次配信 | 出さない | 同上 |
| `commandExecution.exitCode` | プロセスの実 exit code | 一律 `null` (`is_error: true` で `status: "failed"` 判別) | Claude SDK が exit code を返さない |
| `commandExecution.durationMs` | 実時間計測 | 一律 `null` | Phase 3 では計測しない |
| `fileChange.changes[*].diff` | unified diff | 簡易表現 (`< old\n> new`、MultiEdit は `\n---\n` 区切り) | Phase 3 工数都合。将来改善余地 |
| `fileChange.changes[*].kind` | edit/create/delete を正確判定 | Edit/MultiEdit → `edit`、Write → 一律 `create` | Claude SDK 上で新規/既存を判別不能 |
| `mcpToolCall.server` | 実 MCP server 名 | `"claude-builtin"` 固定 | Claude builtin tool に MCP server 概念がない |
| `thread/tokenUsage/updated` | 都度発行 | 未発行 | Milestone 3 以降に延期 (本番投入直前に再判定) |
| 未実装メソッド | (Codex 互換すべて実装) | `-32601 Method not found` | perform が使う subset のみサポート (Codex App Server の他のメソッドは未対応) |

perform と組み合わせる限り、上記の差異はいずれも実害なし (perform はこれらに依存しない)。Codex App Server を別クライアントから直接叩く場合は本表を参照のこと。

## 未実装メソッド

perform が使わないメソッド (`account/*`, `fs/*`, `thread/fork`, `thread/list`, `turn/steer`, `command/exec`, `thread/resume` 等) は dispatcher のデフォルトで `-32601 Method not found` を返す。

スタブで擬似応答を返すメソッドは `src/handlers/stub.ts` の `registerStubs` に集約:

- `mcpServerStatus/list` → `{ "servers": [] }`

擬似応答を追加したいときは `registerStubs` 内で `registerStub(dispatcher, "<method>", <response>)` を 1 行足すだけ。挙動を分岐させたい場合は `dispatcher.registerRequest` で個別ハンドラを登録する。

## レート制限

Claude Agent SDK が `rate_limit_event` で `rate_limit_info.status: "rejected"` を流したターン、または例外 / `ResultError.errors[]` のメッセージに rate limit / usage limit / quota パターンが含まれるターンは、`turn/completed` 通知の `turn.error` に Codex 互換タグを載せて失敗扱いにする:

```json
{
  "method": "turn/completed",
  "params": {
    "turn": {
      "status": "failed",
      "error": {
        "message": "...",
        "codexErrorInfo": "UsageLimitExceeded"
      }
    }
  }
}
```

perform は `codexErrorInfo` を見てレート制限を識別する。リトライポリシーは perform 側で持つ。

### `fileChange.changes[*].diff` の取り扱い注意

`diff` は **unified diff ではなく、視覚的に変更を確認するための簡易プレビュー文字列**。具体的には:

- Edit: `< <old_string>\n> <new_string>`
- Write: `> <content>` (新規ファイル全体に `>` プレフィックスを 1 度だけ付ける)
- MultiEdit: 各 edit を Edit と同形式で `\n---\n` 区切り連結

`<` / `>` / `---` は内容に含まれていても**エスケープされない**。`content` 中の改行・Markdown 記法・diff 風記法は全てそのまま埋め込まれる。**機械的に parse しないこと**。perform 側ではログ・ダッシュボード表示用の opaque 文字列として扱う。

## 開発

```bash
pnpm install
pnpm test          # vitest
pnpm build         # tsc + chmod +x dist/bin.js
pnpm lint          # oxlint
pnpm format        # oxfmt
```

詳細は [`CLAUDE.md`](./CLAUDE.md) を参照。
