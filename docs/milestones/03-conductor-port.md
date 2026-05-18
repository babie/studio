# Milestone 3: `apps/conductor` (TypeScript) 化

**ステータス:** 完了 (2026-05-18)

`apps/symphony` (Elixir) を `apps/conductor` (TypeScript) に書き直し、モノレポを単一スタックに統一する Milestone。Phase 1〜6 で機能 parity を達成し、Phase 7 で `apps/symphony` 削除とドキュメント sweep を完了して close した。

> このファイルは完了済みマイルストーンの記録。進行中・将来のタスクは [`TODO.md`](../../TODO.md) 参照。

---

## 横断する設計指針 (Milestone 3 時点での凍結事項)

- 現 symphony の 1:1 移植 (新規機能は Milestone 4+ 送り)
- TS スタックは `apps/claude-app-server` と統一 (valibot / byethrow / commander / vitest / oxlint / oxfmt)
- in-source test (`import.meta.vitest`) + `test/` integration / e2e
- YAML は js-yaml、TUI は vanilla ANSI (Ink 非採用)、prompt templating は liquidjs
- kamae 準拠 (discriminated unions / branded types / Result / valibot boundary / PII 保護 / 1 file 1 module)
- 並行モデルは plain async + AbortController + p-queue + p-retry (XState / Effect 不採用)
- 状態遷移は orchestrator 主導 ([ADR-0014](../adr/0014-symphony-owned-state-transitions.md) の owner を conductor 側に継承、[ADR-0015](../adr/0015-conductor-port-completion.md))

---

## Phase 1: TS bootstrap + Memory tracker で in-process happy path

**完了.** spec: [`2026-05-16-m3-phase1-design.md`](../superpowers/specs/2026-05-16-m3-phase1-design.md)

- [x] `apps/conductor/` 新規作成（package.json / tsconfig / vitest.config / commander エントリ）
- [x] pnpm workspace 登録、`pnpm dev:install` を conductor リンクに拡張
- [x] `apps/e2e/lib/common.ts` に backend command を中央化する先行リファクタ
- [x] ルート `tsconfig.base.json` を新設し、各 `tsconfig.json` を `extends` 形式に統一
- [x] WORKFLOW.md パーサ（js-yaml + valibot で schema 検証）
- [x] Config schema（`agent.type` / `claude:` / `codex:` / `tracker:` / `linear:` / `github:` / `workspace:` / `prompt:` 等）
- [x] Memory tracker adapter
- [x] Mock backend（subprocess 起動なし、in-process 応答）
- [x] 最小 Orchestrator skeleton
- [x] `conductor examples/workflow.mock-memory.md` で 1 issue を `Todo → Done` に内部遷移できる

---

## Phase 2: 実 backend subprocess 管理 + Workspace 管理

**完了.** spec: [`2026-05-16-m3-phase2-design.md`](../superpowers/specs/2026-05-16-m3-phase2-design.md)

- [x] JSON-RPC stdio クライアント実装（`thread/start` / `turn/start` / `turn/interrupt` 等）
- [x] 子プロセスライフサイクル管理（spawn / kill / exit ハンドリング）
- [x] Workspace 管理（`git clone`、`hooks.{before_run, after_create, before_remove}`）
- [x] Prompt builder（liquidjs）
- [x] AgentRunner 相当の制御フロー
- [x] 並行モデル方針確定（plain async + AbortController に決定、XState / Effect 不採用）
- [x] claude-app-server と JSON-RPC 型を共有 package 化するかの判断（= conductor 側に独自実装、M3 完了後に再評価）
- [x] workspace の SSH モード移植要否を判断（= 移植しない、M4+ に見送り）
- [x] Memory tracker + 実 claude-app-server / codex で 1 issue を end-to-end で完了

---

## Phase 3: Linear tracker + 自動 state 遷移 + Linear E2E

**完了.** spec: [`2026-05-16-m3-phase3-design.md`](../superpowers/specs/2026-05-16-m3-phase3-design.md)

- [x] Linear GraphQL クライアント
- [x] Tracker Linear adapter（5 callback）
- [x] `doing_state` / `done_state` mutation（[ADR-0014](../adr/0014-symphony-owned-state-transitions.md) 踏襲）
- [x] `pnpm test:e2e:claude-linear` の起動コマンドを conductor に切替
- [x] `pnpm test:e2e:claude-linear` 緑

---

## Phase 4: GitHub tracker + GitHub E2E

**完了.** spec: [`2026-05-17-m3-phase4-design.md`](../superpowers/specs/2026-05-17-m3-phase4-design.md)

- [x] GitHub GraphQL クライアント
- [x] ProjectMeta cache（Status field option name→id 解決）
- [x] Tracker GitHub adapter
- [x] 起動時 validation（`doing_state` / `done_state` が Status option として実在）
- [x] `pnpm test:e2e:claude-github` の起動コマンドを conductor に切替
- [x] `pnpm test:e2e:claude-github` 緑

---

## Phase 5: TUI dashboard + observability

**完了.** spec: [`2026-05-17-m3-phase5-design.md`](../superpowers/specs/2026-05-17-m3-phase5-design.md)

- [x] symphony と TUI 出力を snapshot 比較する仕組み (Phase 7 で削除)
- [x] ANSI レンダラ（`status_dashboard.ex` 相当：sparkline / テーブル / 色分け）
- [x] token usage / throughput 集計
- [x] observability pubsub 相当の event bus
- [x] 描画 diff・スロットリング（`@minimum_idle_rerender_ms` 等を移植）
- [x] TUI 出力が symphony と機能的に同等

---

## Phase 6: 並列実行・リトライ・edge cases パリティ

**完了.** spec: [`2026-05-17-m3-phase6-design.md`](../superpowers/specs/2026-05-17-m3-phase6-design.md)

- [x] `max_concurrent_agents` スケジューラ
- [x] retry backoff
- [x] ターン終了判定（`turn/completed` + subprocess exit 統合）
- [x] 異常系（exit ≠ 0、network 失敗、tracker API timeout）
- [x] ファイルロガー（`log_file.ex` 相当、pino + pino-roll）
- [x] symphony の対応 behaviour test を conductor 側で再現して緑

---

## Phase 7: `apps/symphony` 削除 + ドキュメント sweep

**完了 (2026-05-18).** spec: [`2026-05-18-m3-phase7-design.md`](../superpowers/specs/2026-05-18-m3-phase7-design.md), ADR: [`0015-conductor-port-completion.md`](../adr/0015-conductor-port-completion.md)

- [x] `apps/symphony/` 削除
- [x] ルート CLAUDE.md / docs/architecture.md / docs/protocol.md / README.md の symphony 参照 sweep
- [x] flake.nix / pnpm script から symphony 参照を削除
- [x] `test:e2e:setup` の cross-workspace 部分を `apps/e2e/package.json` に畳む
- [x] `apps/conductor/test/fixtures/dashboard/` と `dashboard-parity.test.ts`、`diff-symphony-dashboard.ts` を削除
- [x] ADR-0008 status 更新 + ADR-0015 起票
- [x] このマイルストーン記録の作成

---

## Milestone 3 完了条件

- [x] Phase 1〜7 完了
- [x] `pnpm --filter conductor test` 全緑
- [x] `pnpm test:e2e:claude-linear` / `:claude-github` 緑
- [x] `apps/symphony` が repo から消えている (`git grep -i symphony` のヒットが歴史ドキュメントのみ)
- [x] ADR-0008 implemented、ADR-0015 起票

---

## Milestone 4 以降に送った課題

- リブランディング (`cyfyapp/song` umbrella + `conductor → perform`)
- state 別 backend 切替 + passthrough 機構
- Web ダッシュボード
- conductor 自身の TUI snapshot 回帰検出 (vitest auto-snapshot)
- その他は [`TODO.md`](../../TODO.md) を参照
