# Milestone 2: GitHub Project 対応

**ステータス:** 完了 (2026-05-15)

WORKFLOW.md の `tracker.kind` で Linear / GitHub Projects (v2) を切り替えられる状態をゴールとしたマイルストーン。実 GitHub Project (`babie` / Project #3) を使った自動 E2E (`pnpm test:e2e:claude-github`) が PASS した時点で完了とした。

> このファイルは完了済みマイルストーンの記録。進行中・将来のタスクは [`TODO.md`](../../TODO.md) 参照。

---

## 横断する設計指針 (Milestone 2 時点での凍結事項)

- `tracker.kind` で per-kind block 切替 ([ADR-0013](../adr/0013-tracker-block-split-by-kind.md))
- state mutation は Symphony が担当 ([ADR-0014](../adr/0014-symphony-owned-state-transitions.md))
- GitHub Adapter は Linear adapter のミラー (Octokit 非依存、生 GraphQL POST)
- PAT 認証のみ (env `GITHUB_TOKEN` + `github.api_key` フォールバック)

---

## Phase 1: tracker スキーマの kind 別分割

**完了 (2026-05-14、merge commit `0e8cb71`).** spec: [`2026-05-14-m2-phase1-design.md`](../superpowers/specs/2026-05-14-m2-phase1-design.md)

- [x] `config/schema.ex` の Tracker embed を縮小 (kind / active_states / terminal_states / doing_state / done_state)
- [x] 新規 Linear embed (既存フィールドを移動)
- [x] 新規 Github embed (フィールド宣言のみ、実体は Phase 2)
- [x] Cross-field validation の kind 別実装
- [x] 既存 example / fixture WORKFLOW.md を新形式に sweep
- [x] doc 系 (`docs/architecture.md` / `docs/protocol.md` / ルート `CLAUDE.md`) のスキーマ例を新形式に
- [x] 既存 Linear 経路のテストが緑のまま通る

---

## Phase 2: GitHub Adapter 実装

**完了 (2026-05-14、merge commit `a2bf332`).** spec: [`2026-05-14-m2-phase2-design.md`](../superpowers/specs/2026-05-14-m2-phase2-design.md)

- [x] `github/client.ex` + Req.Test ベースのテスト
- [x] `github/issue.ex` / `github/queries.ex`
- [x] `github/project_meta.ex` (`:persistent_term` キャッシュ、Status field option name→id 解決)
- [x] `github/adapter.ex` (Tracker 5 callback、Req.Test で検証)
- [x] `tracker.ex` adapter dispatch に `"github"` を追加
- [x] 起動時 validation: `doing_state` / `done_state` が Status option として実在することを確認
- [x] `iex` で `Tracker.fetch_candidate_issues/0` 等が動く (2026-05-14 実機検証済、[`docs/superpowers/plans/2026-05-14-m2-phase2-github-adapter.md`](../superpowers/plans/2026-05-14-m2-phase2-github-adapter.md) 末尾参照)

---

## Phase 3: Orchestrator 連携 + 自動遷移

**完了 (2026-05-15、merge commit `bf2cbf7`).** spec: [`2026-05-15-m2-phase3-design.md`](../superpowers/specs/2026-05-15-m2-phase3-design.md)

- [x] `maybe_doing_transition/1` を `spawn_issue_on_worker_host` で呼ぶ
- [x] `handle_backend_finished/2` で `turn/completed` + subprocess exit 統合判定して `maybe_done_transition/1` を呼ぶ
- [x] MockTrackerAdapter ベースの結合テストで遷移呼び出しを検証 (orchestrator_doing/done_transition_test.exs)
- [x] 異常系 (exit != 0、status: failed、network 失敗) の no-op をテスト

---

## Phase 4: 実機 E2E + ドキュメント整備

**完了 (2026-05-15、merge commit `bcf81e4`).** spec: [`2026-05-15-m2-phase4-design.md`](../superpowers/specs/2026-05-15-m2-phase4-design.md)

- [x] `examples/workflow.claude-github.md` 整備
- [x] 既存 `workflow.claude.md` → `workflow.claude-linear.md` リネーム
- [x] `e2e/claude-github.ts` + `e2e/lib/common.ts` + `e2e/config.json` 新規 (当初 `scripts/e2e.claude-github.ts` 等、のちに `e2e/` へ rename)
- [x] `scripts/e2e.ts` → `e2e/claude-linear.ts` リネーム + 共通部分抽出
- [x] `package.json` の `e2e:*` script 整備
- [x] ADR-0013 / ADR-0014 執筆
- [x] README.md / docs/architecture.md / docs/protocol.md / 両 CLAUDE.md / docs/e2e_testing.md sweep
- [x] 実機 E2E PASS (`pnpm test:e2e:claude-github`、Todo → In Progress → Done 自動遷移確認)
- [x] TODO.md の M3 派生課題反映 (L134 / L142 削除)

### 実機 E2E 実行ログ

`pnpm test:e2e:claude-github` を実 GitHub Project に対して走らせ、Todo → In Progress → Done が自動遷移することを確認 (2026-05-15)。`pnpm test:e2e:claude-linear` での Linear 経路も回帰 PASS。

- **対象**: `babie/concert#1` ("Test: Milestone 2 Phase 2"), GitHub Projects v2 Project #3
- **コマンド**: `pnpm test:e2e:claude-github`
- **discovery query 解決**:
  - `projectId=PVT_kwHNKzfOAV7Xdg`
  - `fieldId=PVTSSF_lAHNKzfOAV7Xds4UuHwD` (Status field)
  - `itemId=PVTI_lAHNKzfOAV7Xds4LMB8I`
- **Symphony observed events** (`apps/symphony/log/symphony.log.1` 抜粋, UTC):
  - `16:21:43.7` — Worker spawn + `after_create` hook
  - `16:21:43.8` — Codex session started (turn 1)
  - `16:21:44.2` — Transitioned issue to doing_state: target=In Progress (Phase 3 doing transition)
  - `16:22:10.4` — Codex session completed (turn 1, 約 26 秒)
  - `16:22:10.4` — Completed agent run, turn=1/10 (Phase 4 incidental fix: AgentRunner 単一 turn 終了)
  - `16:22:11.3` — Transitioned issue to done_state: target=Done (Phase 4 incidental fix: doing_state も done に進む)
- **Workspace**: `/tmp/concert-e2e-github/workspaces/babie_concert_1`
- **Agent commit**: `tmp/hello.js` 新規 (`console.log("Hello, World!");`)
- **`verifyWorkspaceHello`**: `node tmp/hello.js` 出力 + `git log -- tmp/hello.js` の commit 存在を確認
- **総時間**: 約 60 秒
- **Final Status (GitHub API 確認)**: `Done`
- **Exit code**: 0 (PASS)

### Linear 経路の回帰確認

`pnpm test:e2e:claude-linear` も同セッションで PASS (Linear issue `CYFY-5`)。Phase 4 の `e2e/config.json` 導入と workflow YAML parse へのリファクタが既存 Linear 経路を壊していないことを確認。

### Phase 4 中に判明・修正した付随バグ

- Phase 3 done transition は `doing_state ∈ active_states` 構成で必ず skip する設計欠陥があり、Phase 4 E2E で初めて顕在化。`orchestrator.ex` に「current == doing_state なら done に進める」分岐を追加して修正。
- AgentRunner.`continue_with_issue?/2` にも同種の判定があり、`doing_state` 設定時に turn が `max_turns` まで空回しされていた。`doing_state` set のとき単一 turn セマンティクスに変更。
- workflow.claude-github.md の日本語コメントが yamerl の `invalid_unicode` を踏むため、front-matter 内コメントを英語に置換。
- E2E スクリプトの workspace key 計算が Symphony の `safe_identifier(${repo}#${number})` 仕様と不整合だった (本番は `babie_concert_1`、初版 E2E スクリプトは `babie-3-1`)。仕様を合わせる修正。
- E2E スクリプトの buildSymphony が `mix compile` のみで `bin/symphony` escript を再生成しておらず、ソース変更が反映されない問題があった (`pnpm build:symphony` 経由に変更)。
- `yaml` パッケージから `js-yaml` + `@types/js-yaml` に乗り換え (TS の慣例に合わせる + bundle サイズ削減)。

---

## Milestone 2 完了条件

- [x] Phase 1〜4 完了
- [x] `mix test` 全緑 (Phase 3 時点 240+ tests, 0 failures, 2 skipped)
- [x] 実 GitHub Project で issue 処理が動く (`pnpm test:e2e:claude-github` exit 0)
- [x] ADR-0013 / ADR-0014 起票済み

---

## Milestone 3 以降に送った課題

- 起動時 sweep / polling 補正 / 失敗時コメント ([Phase 3 spec](../superpowers/specs/2026-05-15-m2-phase3-design.md) の Recovery 境界)
- 複数 repo を 1 Project に紐づける運用ノウハウ (TODO.md の M3 派生課題)
- GitHub App 認証 (PAT は M2 のみ、長期運用には App)
- `github_graphql` 動的ツール (`claude-app-server` の MCP 動的ツール提供を実装し、Linear 同様 backend から叩けるように)
- PR-based 完了検知 (Issue が PR にリンクされ PR が merge されたら自動 Done)
- M3 以降の詳細は [`TODO.md`](../../TODO.md) を参照
