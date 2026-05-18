# 13. `tracker:` ブロックを kind 別に分割する

## ステータス

Accepted

決定日: 2026-05-14

## コンテキスト

Milestone 1 までは `tracker:` 単一ブロックに `kind` と Linear 固有設定 (`api_key` / `endpoint` / `project_slug` / `assignee`) が混在していた。Milestone 2 で GitHub Projects (v2) を追加するにあたり、kind 固有フィールド (`project_owner` / `project_number` 等) がさらに増えることが見えてきた。

Milestone 1 では既に [ADR-0004](0004-agent-type-backend-selection.md) で `agent.type` の値に応じて `claude:` / `codex:` の per-kind ブロックを切り替えるパターンを確立済み。tracker 側だけ単一ブロックに kind 別 if/else を抱えると、`agent.type` パターンとの構造的一貫性が崩れる。また、Schema validation や error メッセージが kind 横断で絡まり、レビューしづらい。

本家追従不要 ([ADR-0007](0007-no-upstream-tracking.md)) のため、本家 Symphony `SPEC.md` のスキーマと乖離する破壊的変更を許容できる。

## 決定

`tracker:` ブロックは **共通フィールドのみ** を持つ:

- `kind` (`linear` / `github` / `memory`)
- `active_states` / `terminal_states`
- `doing_state` / `done_state` (Milestone 2 Phase 3 で追加、`pickup_state` / `success_state` からリネーム)

kind 固有設定は per-kind block に分離:

- `linear:` ブロック — `api_key` / `endpoint` / `project_slug` / `assignee`
- `github:` ブロック — `api_key` / `endpoint` / `project_owner` / `project_number` / `assignee`
- `memory` — 専用ブロック不要 (テスト用)

`tracker.kind` の値で読まれるブロックを切り替える ([ADR-0004](0004-agent-type-backend-selection.md) の `agent.type` パターンと対称)。

## 結果

- **良い影響**:
  - `agent.type` パターンとの構造的一貫性が取れる
  - kind 追加時の影響範囲が明確 (新ブロック追加 + dispatch 拡張のみ)
  - Schema validation が kind ごとに分離されてレビューしやすい (`Github` / `Linear` の embed 単位)
  - Phase 3 で追加した `doing_state` / `done_state` のような「tracker 共通」フィールドの居場所が自然に決まる
- **悪い影響 / トレードオフ**:
  - 既存 WORKFLOW.md (`workflow.claude.md` 等) を破壊的に sweep する必要があった (Milestone 2 Phase 1 で完了)
  - 本家 Symphony `SPEC.md` のスキーマと乖離 ([ADR-0007](0007-no-upstream-tracking.md) 方針なので許容)
- **影響範囲**:
  - `apps/symphony/lib/symphony_elixir/config/schema.ex` (`Tracker` embed の縮小、`Linear` / `Github` 新規 embed)
  - `apps/symphony/examples/workflow.*.md` (全 sample)
  - `apps/symphony/WORKFLOW.md`
  - `docs/architecture.md` / `docs/protocol.md` / 両 `CLAUDE.md`
