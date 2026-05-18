# Milestones

完了済みマイルストーンの記録置き場。各ファイルは当時の計画・チェックリスト・完了日・関連 commit/spec への参照を保持する。

進行中・将来のタスクは [`TODO.md`](../../TODO.md) を参照。

| Milestone | ゴール | 完了日 |
|---|---|---|
| [01: Claude が動く最小構成](01-claude-minimal.md) | `agent.type: claude` で `claude-app-server` 経由で Claude が issue を処理できる | 2026-05-14 |
| [02: GitHub Project 対応](02-github-tracker.md) | `tracker.kind` で Linear / GitHub Projects を切り替え可能 | 2026-05-15 |
| [03: `apps/conductor` (TS) 化](03-conductor-port.md) | symphony (Elixir) を `apps/conductor` (TypeScript) に書き直し、モノレポを単一スタックに統一 | 2026-05-18 |
| [04: リブランディング](04-rebranding.md) | `babie/concert` を `babie/studio` にフレッシュ移行、`apps/conductor` → `apps/perform` | (進行中) |
