# 実装 Todo

`studio` モノレポの実装タスク一覧。詳細は各 CLAUDE.md と各 spec を参照。

完了済みマイルストーンの記録は [`docs/milestones/`](docs/milestones/) を参照。

---

# Milestone 4: リブランディング (進行中)

詳細・チェックリスト: [`docs/superpowers/specs/2026-05-18-m4-rebranding-design.md`](docs/superpowers/specs/2026-05-18-m4-rebranding-design.md)

実装プラン: [`docs/superpowers/plans/2026-05-18-m4-rebranding.md`](docs/superpowers/plans/2026-05-18-m4-rebranding.md)

---

# Milestone 5 以降 (候補)

下記は M4 完了後に改めて議論する。スキーマ・実装方針はその時点で決定する。

## state 別 backend 切替（passthrough 機構含む）

- WORKFLOW.md `agent.states` で状態ごとに違う `command` / `model` を指定できるようにする
- state 遷移時に旧 subprocess を `turn/interrupt` → kill → 新 command で再起動
- state エントリの `command` 以外のキーを camelCase 化して `thread/start.params` にパススルー
- `default` 必須（マッチしない state はここを使う）
- **前提**: Codex サブスク復帰、または backend 別の検証可能性確保
- 以前 Phase 1〜4 で計画していた内容を全部ここに統合

## Web ダッシュボード（LiveView 相当の TS 実装）

- M3 で TUI のみ移植したため、Web 版は M5+ で別途構築
- 候補: Hono + SSE + Solid/Preact SPA、または Hono + WebSocket + SPA
- 既存 `/api/v1/state` / `/api/v1/refresh` / `/api/v1/:issue_identifier` のエンドポイント仕様は維持

## perform TUI snapshot 回帰検出 (vitest auto-snapshot)

- M3 Phase 5 で導入した `apps/perform/test/fixtures/dashboard/` (symphony golden + parity test) は Phase 7 で削除済
- 代わりに vitest の `toMatchSnapshot` で自動 snapshot 化するかを判断する
- 既存 ANSI レンダラ (`apps/perform/src/observability/` 配下) の出力を 5〜10 ケース snapshot に取り、`pnpm --filter perform test` で回帰検出する
- 第 1 回 capture は初回 run、以後の差分は意図的な変更があったときに `vitest -u` で更新
- 着手判定: M4 リブランディングで TUI に手を入れる前か、Web ダッシュボード実装時 (TUI と並行運用するなら両方の snapshot を持つ)

## BackendConfig 系の discriminant を `kind` に統一

- 現状: `BackendConfig` / `Backend` / `BackendSession` / `turnSandboxPolicy` などが `type` を discriminant に使用 (kamae 慣習は `kind`)
- `apps/perform/src/domain/backend-config.ts` のヘッダコメントで deviation を明記済み
- YAML 互換性は維持しつつ、TS 側のみ `kind` に揃える方向で検討
- 影響範囲: WORKFLOW.md パーサ (YAML → TS 変換層で `type` → `kind` マッピング)、`backend/factory.ts`、`backend/jsonrpc/messages.ts` の Codex sandbox policy

## tracker adapter 全体を `Result.pipe` で書き直す

- 現状: `updateStateWithRetry` のみ pipe 化 (`linear/adapter.ts`、`github/adapter.ts`)
- 残り: `fetchCandidateIssues` / `fetchIssuesByIds` / `fetchIssueStatesByIds` / `createComment` などの `if (r.type === "Failure") return r;` 連鎖
- 目標: byethrow ガイドの Railway Oriented Programming スタイルへ全面移行
- 副産物として helper 関数の curry 化が進み、unit test しやすくなる想定

## `apps/compose` (TS): 要求を細かいタスクに分割して tracker に登録するアプリ

- ユーザの要求（自然言語の機能要望・改善提案など）を入力として、実装可能な粒度のタスクに分解
- 分解結果を GitHub Project または Linear に issue として登録（ラベル・依存関係・受け入れ条件付き）
- Perform の前段に位置づけ: Compose でタスク化 → tracker → Perform が拾って実装、というパイプライン
- TS で実装（Anthropic SDK / MCP を直接活用、`apps/claude-app-server` とは独立）
- Linear/GitHub クライアントは Compose で新規実装（公式 TS SDK `@linear/sdk`, Octokit 等を利用）

## `apps/mix` (TS、仮称): PR をまとめて main に統合するアプリ

- パイプライン的位置づけ: Compose → tracker → Perform → **Mix** → CI/CD
- 責務:
  - Perform が完了させた複数 PR を集約し、レビュー・コンフリクト解決を行う
  - 全体仕様（CLAUDE.md / docs / ADR / 既存テスト）との整合性チェック
  - `main` にマージして push するまで（実際の deploy / release は CI/CD に委譲）
- TS で実装（Anthropic SDK 等、`apps/claude-app-server` とは独立）。GitHub Project / Linear クライアントは Compose と共有可能か検討

## ステート毎の使用スキルカスタマイズ

- `agent.states[*]` で「使うスキル一覧」を絞れるようにする
- Codex/Claude それぞれのスキル指定方法（skills ディレクトリのフィルタリング、ツール allowlist 等）を統一インタフェースで扱う
- 既存の `allowed_tools` との関係整理

## ダッシュボード対応（state 別 backend 切替時）

- `running` state の各エントリに `current_command` / `current_model` を追加
- TUI / Web の両方で表示
- `codex_totals` 系フィールドを `agent_totals` に汎化（必要なら）

## `apps/claude-app-server` ストリーミング & トークン使用量対応

- Milestone 1 の Phase 4 から分離して延期した項目
- `includePartialMessages: true` で `stream_event` の `content_block_delta` (`text_delta`) → `item/agentMessage/delta` に変換
- partial と最終 `assistant` (text) メッセージの重複を吸収する mapper 拡張
- SDK の `usage` (`input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens`) から `thread/tokenUsage/updated` 通知を組み立て（独自 camelCase スキーマ、Codex 本家との差異は README に明記）
- 累積 (per-thread) を `state/threads.ts` に持たせる
- **着手判定**: 本番投入直前 (Perform 完成後) に再判定。Perform 設計時にストリーミング必須要件が出たらそのタイミングで前倒し

## workspace を git worktree ベースに移行

- 現状は issue ごとに `git clone --depth 1` でフルクローン → ディスク・時間コスト大
- 共有 bare/`.git` から worktree を切り出す方式に変えるとディスク削減と初回作成高速化が見込める
- 詳細は後日検討（WORKFLOW.md の `workspace.hooks.after_create` の互換、サブスクリプション越しのリポジトリ共有戦略など）

## `@babie/` scope での npmjs 公開

- **前提**: M4 リブランディング完了 + Claude/Codex の API キー対応
- 目的: `pnpm dev:install` ベース配布から脱却し、外部利用者も入れられるようにする
- 対象は `@babie/perform`、`@babie/claude-app-server` 等 (ADR-0017 で `@babie/*` scope 据置を確定)

## prompt 構築方式の Liquid 依存見直し

- M3 では symphony の `Solid` (Elixir Liquid) を 1:1 移植するため liquidjs を採用
- Perform 完成後、prompt 構築方式自体（Liquid を続けるか、TS native のテンプレート / 構造化プロンプトに置換するか）を再検討

## claude-app-server / Perform の重複コード共有 package 化

- M3 では当面 perform 側に独自実装し、共有 package 化はしない（YAGNI）
- 候補:
  - **JSON-RPC 2.0 stdio メッセージ型・schema** (`initialize` / `thread/start` / `turn/*` / `item/*` notification 等。perform `backend/jsonrpc/messages.ts` と claude-app-server で重複する想定)
  - JSON-RPC stdio クライアント / Transport 抽象
  - 共通の Result / Schema 拡張
- 重複量が積み上がってから着手
- M3 Phase 2 ([`docs/superpowers/specs/2026-05-16-m3-phase2-design.md`](docs/superpowers/specs/2026-05-16-m3-phase2-design.md)) で「perform 側に独自実装、共有 package 化は M3 完了後判断」を確定

## Perform backend の BackendSession 2 層化リファクタ

- M3 Phase 2 では `JsonRpcSubprocessClient` (transport) + `Backend` (spawn コマンド + thread/start.params 提供) の 2 層構造で実装
- 候補として **`BackendSession`** (initialize → thread/start → turn ループ → shutdown を 1 オブジェクトに集約) を 3 層化する案あり
- メリット: max_turns ループ・interrupt トラッキング・session 単位の状態が 1 箇所に閉じる、AgentRunner が薄くなる
- M3 Phase 2 時点では client 内に session 相当のメソッドを生やして 2 層で済ませる（YAGNI）
- M5+ で並列実行・retry・session lifecycle の複雑化が露呈してきたタイミングで再評価

## SSH 経由の workspace 分散実行 (symphony `worker.ssh_hosts` / `ssh.ex` 互換)

- 元 symphony は `worker.ssh_hosts` で複数 host に issue を分散実行する仕組みを持つ
- M3 Phase 2 ([`docs/superpowers/specs/2026-05-16-m3-phase2-design.md`](docs/superpowers/specs/2026-05-16-m3-phase2-design.md)) で**移植しない**判断: perform は schema 自体受け取らず、`worker.ssh_hosts` を書いた WORKFLOW.md はエラーにする
- 個人ユースでは未使用、orchestrator / workspace の設計が肥大化するため
- 必要性が出てきたら M5+ で再評価。Perform 側で別途設計する想定（symphony 実装を直訳しない）

## GitHub Adapter 派生課題（M2 Phase 2 完了後の宿題）

- **`assignee: me` 設定時、GitHub UI で Issue 側に明示的に assignee を立てないと候補に乗らない** 運用ノウハウを doc に
- **`adapter.ex/normalize_issue_node` と `Github.Issue` の helper 重複統合**（`extract_status` / `first_assignee` / `extract_labels` / `parse_datetime` / `build_branch_name` の 5 helper を `Github.Normalizer` などに括り出す）
- **複数 repo を 1 Project に紐づける運用**（Project 全体を読むコードは入っているが、運用ノウハウ・branch_name 衝突回避が未検証）
- **GitHub App 認証**（PAT は M2 のみ、長期運用には App 推奨）
- **`github_graphql` 動的ツール**（claude-app-server の MCP 動的ツール提供を実装し、Linear 同様に backend から直接叩けるようにする）
- **失敗時 comment / max_attempts**（orchestrator が backend exit code を見てリトライ・通知する仕組み）
- **PR-based 完了検知**（Issue が PR にリンクされ PR が merge されたら自動 Done に）
