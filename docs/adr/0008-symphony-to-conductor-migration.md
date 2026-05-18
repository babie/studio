# 8. `apps/symphony` を最終的に廃棄し TypeScript 版 `apps/conductor` に置換する

## ステータス

Accepted (implemented 2026-05-18 in M3 Phase 7, see [ADR-0015](0015-conductor-port-completion.md))

決定日: 2026-05-10

## コンテキスト

`apps/symphony` は Elixir 実装で、本家フォーク由来。並行性・スーパーバイザ設計の点では Elixir/OTP の恩恵が大きい一方、本プロジェクトの状況は次のとおり:

- 開発者の主戦場は TypeScript（`apps/claude-app-server` も TS）。Elixir コードのメンテに割ける時間が限られる
- モノレポ内に 2 言語が同居し、CI・依存管理・開発環境のセットアップが二重になる
- 本家追従は放棄しているので（[ADR-0007](0007-no-upstream-tracking.md)）、Elixir 実装を維持する積極的理由が薄い
- WORKFLOW.md の拡張機能（state 別 backend 切替・passthrough 等）は今後 TS 側で書きたい

ただし `apps/symphony` は現状で動作しており、即時廃止すると Milestone 1 の疎通テストが回せなくなる。

## 決定

段階的に Elixir → TypeScript へ移行する:

- **Milestone 1**: `apps/symphony` (Elixir) を改造して使い続ける。当面の機能追加は Elixir 側で行う
- **Milestone 3 以降**: `apps/conductor` (TypeScript) を新規作成し、Symphony の機能を移植する
- **`apps/conductor` 完成後**: `apps/symphony` を削除する

`apps/symphony` 内部の Elixir コード（モジュール名 `Symphony.*` 等）のリブランディングは行わない。最終的に削除するものに対してリブランディングコストを払う価値がないため。

## 結果

- **良い影響**:
  - 長期的にはモノレポを単一言語（TypeScript）に統一でき、CI・開発環境がシンプルになる
  - 開発者の慣れた言語に揃うため、新機能の実装速度が上がる
  - 既存 Elixir コードを動かしたまま段階的に移行でき、急な機能停止が起きない
- **悪い影響 / トレードオフ**:
  - 移行期間中は Elixir と TypeScript が併存し、開発環境が重い
  - Elixir/OTP の並行性・障害耐性の恩恵を放棄することになる（TypeScript 側で同等の設計を入れ直す必要がある）
  - `apps/conductor` の実装が完了するまで Elixir 側の改修が無駄になるリスクがある（必要最小限に留めること）
- **影響範囲**: `apps/symphony` の改修方針、`apps/conductor` の新規実装計画、モノレポの言語構成
