# Milestone 2 Phase 1: tracker スキーマ kind 別分割 — 設計書

**日付:** 2026-05-14
**対象:** [`TODO.md`](../../../TODO.md) Milestone 2 Phase 1
**ステータス:** 設計確定、実装プラン待ち

---

## 背景

Milestone 2 では Symphony に GitHub Projects v2 を tracker として加える。M2 全体の設計指針と Phase 構成は [`TODO.md`](../../../TODO.md) Milestone 2 セクションを参照。Phase 番号は Milestone ごとにリセットされ、M2 は Phase 1 から始まる。

Phase 1 は **スキーマ移行のみ** を担当する。GitHub Adapter 本体（Phase 2）や orchestrator 連携（Phase 3）はこのフェーズの範囲外。

現状の `tracker:` ブロックは Linear 固有のフィールド（`api_key` / `endpoint` / `project_slug` / `assignee`）と Symphony 側の概念（`kind` / `active_states` / `terminal_states`）が一つに混在している。M2 で GitHub も足すにあたり、`agent.type` パターン（[ADR-0004](../../adr/0004-agent-type-backend-selection.md)）に揃えて**共通フィールドと kind 別フィールドを分離**する。

破壊的変更を伴うが、個人ユース・後方互換不要の方針（[`CLAUDE.md`](../../../CLAUDE.md) §「両アプリにまたがる仕様」）で sweep する。

---

## 目標

Phase 1 完了条件:

1. `tracker:` ブロックが共通フィールドのみを持つ
2. `linear:` ブロックに Linear 固有フィールドが移動している
3. `github:` ブロックの schema 上のフィールド宣言と cross-field validation（kind == github のとき `project_owner` / `project_number` 必須）が存在する。Status field option との照合など runtime validation は Phase 2 で実装
4. リポジトリ内のすべての WORKFLOW.md / fixture が新スキーマで通る
5. Linear 経路の既存テストが緑のまま
6. doc 系（アーキテクチャ図・プロトコル仕様・ルート CLAUDE.md）の WORKFLOW.md スキーマ例が新形式に揃っている

明示的なスコープ外（後続 Phase で扱う）:

- `Github.Adapter` の実装（Phase 2）
- `github/client.ex` / `project_meta.ex` / `queries.ex` / `issue.ex` の作成（Phase 2）
- Status field option の起動時 validation（Phase 2）
- Orchestrator の `doing_state` / `done_state` 連携（Phase 3）
- `examples/workflow.github.md` の新規作成（Phase 4）
- ADR-0013 / ADR-0014 の執筆（Phase 4）

---

## 新スキーマ

```yaml
tracker:
  kind: github                        # selector (linear | github | memory)
  active_states: [Todo, In Progress]  # 共通
  terminal_states: [Done, Cancelled]  # 共通
  doing_state: "In Progress"          # optional, Phase 3 で使う
  done_state: "Done"                  # optional, Phase 3 で使う

github:                               # Phase 1 では宣言のみ
  api_key: ${GITHUB_TOKEN}            # optional, env GITHUB_TOKEN フォールバック
  endpoint: https://api.github.com/graphql    # default
  project_owner: babie                # Project を所有する GitHub user または org の login
  project_number: 5                   # Projects v2 number (integer)
  assignee: babie                     # optional

linear:                               # 既存フィールドを丸ごと移動
  api_key: ${LINEAR_API_KEY}
  endpoint: https://api.linear.app/graphql
  project_slug: concert-3f96fb9d18cf
  assignee: babie
```

---

## 変更内容

### 1. `apps/symphony/lib/symphony_elixir/config/schema.ex`

- `Tracker` embed を縮小: `kind` / `active_states` / `terminal_states` / `doing_state` / `done_state` のみ
- 新規 `Linear` embed: `api_key` / `endpoint` / `project_slug` / `assignee`
- 新規 `Github` embed: `api_key` / `endpoint` / `project_owner` / `project_number` / `assignee`
- Cross-field validation:
  - `kind == "linear"` → `linear:` ブロック必須、`linear.project_slug` 必須
  - `kind == "github"` → `github:` ブロック必須、`github.project_owner` / `project_number` 必須
  - `kind == "memory"` → どちらも不要
- env fallback の kind 別切替:
  - `linear.api_key` → env `LINEAR_API_KEY`
  - `github.api_key` → env `GITHUB_TOKEN`

`endpoint` の default 値:

- `linear.endpoint` default = `https://api.linear.app/graphql`
- `github.endpoint` default = `https://api.github.com/graphql`

### 2. WORKFLOW.md / fixture sweep

| パス | 変更 |
|---|---|
| `apps/symphony/WORKFLOW.md` | `linear:` ブロックに移動 |
| `apps/symphony/examples/workflow.codex.md` | 同上 |
| `apps/symphony/examples/workflow.claude.md` | 同上 |
| `apps/symphony/test/symphony_elixir/core_test.exs` | 新スキーマに追従 |
| その他 fixture WORKFLOW.md があれば | 同上 |

`examples/workflow.github.md` の新規作成は **Phase 4** で行う。Phase 1 では schema が `kind: github` の WORKFLOW.md を parse できることのみが目標。

### 3. doc sweep

| パス | 変更 |
|---|---|
| `docs/protocol.md` | スキーマ例（Linear / Codex）を新形式に |
| `docs/architecture.md` | スキーマ例があれば新形式に |
| `CLAUDE.md`（ルート） | §「両アプリにまたがる仕様」の WORKFLOW.md スキーマ例を新形式に |
| `apps/symphony/CLAUDE.md` | `tracker.kind` の説明を追加（具体的 GitHub 実装の説明は Phase 2 で追記） |

### 4. Tracker adapter dispatch (`tracker.ex`)

Phase 1 では **触らない**。`Github.Adapter` モジュールは Phase 2 で作成するので、dispatch に `"github"` を加えるのも Phase 2 で行う。Phase 1 の範囲では `tracker.kind: github` の WORKFLOW.md は parse まで通るが、Symphony 起動時に adapter 解決でエラーになる（Phase 2 までの過渡的状態として許容）。

---

## テスト戦略

- 既存 `core_test.exs` の WORKFLOW.md fixture を新形式に書き換え、parse / validation テストが緑になることを確認
- `linear.api_key` が WORKFLOW.md 未指定 + env `LINEAR_API_KEY` 設定でフォールバックする回帰テスト
- Cross-field validation:
  - `kind: linear` で `linear:` ブロック未指定 → error
  - `kind: linear` で `linear.project_slug` 未指定 → error
  - `kind: github` で `github:` ブロック未指定 → error
  - `kind: github` で `github.project_owner` / `project_number` のいずれか未指定 → error
  - `kind: memory` で `linear:` も `github:` も無くて OK
- 既存 Linear orchestrator テスト一式が、新スキーマ下でも引き続き緑

---

## 不確実性 / 実装時に確認する点

| # | 項目 | 対応 |
|---|---|---|
| 1 | Ecto changeset で「kind に応じた required 切替」を綺麗に書けるか | 既存 Linear validation の書き方を実装時に再確認、cross-field validation の Ecto 慣用パターンに揃える |
| 2 | env fallback の現行実装位置（`schema.ex:402-406` 周辺、survey 結果） | 実装時に再読、kind 別に分岐 |
| 3 | `linear:` / `github:` 両方を書いた WORKFLOW.md を受け付けるか | 受け付ける方針（kind 不一致のブロックは無視）。テストで挙動を固定 |
| 4 | `doing_state` / `done_state` の起動時 validation（Status option との照合） | Phase 2 の `Github.ProjectMeta` 実装時に行う。Phase 1 では schema レベルでの存在チェックのみ（string field として受け取るだけ） |

---

## 参考

- [TODO.md Milestone 2](../../../TODO.md) — M2 全体の Phase 構成と設計指針
- [`docs/milestones/01-claude-minimal.md`](../../milestones/01-claude-minimal.md) — Milestone 1 完了記録
- [ADR-0004](../../adr/0004-agent-type-backend-selection.md) — `agent.type` パターン（本 Phase の `tracker.kind` 分割の前例）
- [`docs/superpowers/specs/2026-05-10-symphony-phase1-design.md`](2026-05-10-symphony-phase1-design.md) — M1 Symphony Phase 1 設計書（schema 拡張の前例として参考）
