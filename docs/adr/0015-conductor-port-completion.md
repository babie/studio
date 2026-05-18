# 15. `apps/conductor` 化完了に伴う `apps/symphony` 廃止

## ステータス

Accepted

決定日: 2026-05-18

## コンテキスト

[ADR-0008](0008-symphony-to-conductor-migration.md) で「`apps/conductor` 完成後に `apps/symphony` を削除する」と決定した。Milestone 3 Phase 1〜6 で TS 移植が完了し、Linear / GitHub E2E と並列スケジューラ / retry / 異常系 / file logger まで symphony parity を取った状態に到達した。

ADR-0008 は削除タイミングを明示せず Phase 7 に委ねていた。当初 [`TODO.md`](../../TODO.md) は「conductor 単独運用を 1 週間以上回した後」を予約していたが、Milestone 4 でリブランディング (`conductor → perform`) と state 別 backend 切替が入る前提のため、symphony を fallback として残す価値は実質的に消滅している。

## 決定

Phase 7 で以下を一括実施する:

- `apps/symphony/` ディレクトリの削除
- ルート `package.json` の Elixir 系 script (`build:symphony` / `test:symphony`) 削除
- `apps/e2e/lib/common.ts` の symphony 分岐削除、関数・型を backend-neutral に rename
- `test:e2e:setup` の cross-workspace 部分を `apps/e2e/package.json` に畳む
- `flake.nix` から Erlang/Elixir 削除
- `apps/conductor/test/fixtures/dashboard/` (symphony 並走期間の TUI golden) と `dashboard-parity.test.ts` の削除
- ルート CLAUDE.md / README.md / docs/architecture.md / docs/protocol.md / docs/e2e_testing.md の symphony 参照 sweep

[ADR-0014](0014-symphony-owned-state-transitions.md) の本文は変更しない (歴史的記録)。架構決定 (orchestrator が `doing_state` / `done_state` を直接 mutation する) は依然有効であり、本 ADR で「ADR-0014 の orchestrator owner は M3 Phase 7 以降 conductor を指す」と明記する。

## 結果

- **良い影響**:
  - モノレポが TypeScript 単一スタックになり、CI・開発環境・新規参加者の学習コストが下がる
  - DevContainer の初回ビルドで Erlang/Elixir のダウンロードが走らなくなり、起動が高速化する
  - Milestone 4 のリブランディング (`conductor → perform`) を 2 app だけで行えば済む
- **悪い影響 / トレードオフ**:
  - Elixir/OTP の障害耐性設計は完全に手放す。conductor 側で TS の plain async + AbortController + p-queue + p-retry で代替済 (Phase 6)
  - symphony と conductor の挙動 byte-for-byte 比較ができなくなる (`dashboard-parity.test.ts` を削除)。conductor の TUI 回帰検出は Milestone 4+ で vitest auto-snapshot として書き直すかを別途判断する
  - 過去 commit を辿って Elixir 実装を参照する必要があれば `git show <commit>:apps/symphony/...` を使う
- **影響範囲**: モノレポ言語構成 / CI / DevContainer / E2E 起動 script / `apps/conductor/CLAUDE.md` の Phase 7 ステータス / Milestone 3 完了
