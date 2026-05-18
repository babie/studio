# 3. プロトコルは Symphony が使うサブセットのみ実装する

## ステータス

Accepted

決定日: 2026-05-10

## コンテキスト

[ADR-0002](0002-codex-app-server-protocol.md) で Claude バックエンドを Codex App Server 互換サーバとして実装することを決めた。しかし Codex App Server の完全仕様は広く、`account/*`、`fs/*`、`thread/fork` など Symphony が使わない領域も含む。

claude-app-server の用途は当面 `apps/symphony`（および将来の `apps/conductor`）からの利用に限られるため、Symphony が実際に呼ぶメソッドだけ実装すれば十分。完全互換を目指すと:

- 工数が膨らみ Phase 1 で動くものができない
- 使われない実装に Bug が混入してもテストで気付けない
- Claude SDK にない概念（OpenAI account API 等）を擬似実装する不毛さがある

## 決定

claude-app-server は **Symphony が使うサブセットのみ実装する**。未対応メソッドは JSON-RPC エラー `-32601 (Method not found)` を返す。

実装するメソッド:

| メソッド | 種類 |
|---|---|
| `initialize` | request |
| `initialized` | notification |
| `thread/start` | request |
| `turn/start` | request |
| `turn/interrupt` | request |

claude-app-server が送る通知:

| 通知 | 用途 |
|---|---|
| `thread/started` | スレッド開始 |
| `turn/started` | ターン開始 |
| `item/started`, `item/completed` | 各 item のライフサイクル |
| `item/agentMessage/delta` | アシスタントメッセージのストリーミング |
| `item/commandExecution/outputDelta` | bash コマンド出力 |
| `item/fileChange/outputDelta` | ファイル編集差分 |
| `turn/completed` | ターン終了 |

将来 Symphony 以外のクライアントから呼ばれるニーズが出たら、`apps/claude-app-server/src/handlers/stub.ts` に擬似応答を追加して拡張する。

詳細仕様は [`docs/protocol.md`](../protocol.md) を正本とする。

## 結果

- **良い影響**:
  - Phase 1 で疎通可能な最小実装が早期に完成する
  - 使われないコードが入らないため、書いたコードはすべてテストで覆われる
  - 仕様変更時の追随コストが低い
- **悪い影響 / トレードオフ**:
  - claude-app-server を Symphony 以外のクライアント（例: 任意の Codex App Server 対応ツール）で使えない
  - 「完全互換」ではないので、命名上の誤解が生まれる可能性がある（README で明示する必要がある）
- **影響範囲**: `apps/claude-app-server` の実装範囲、`docs/protocol.md` の記述、将来クライアントを追加する際の意思決定
