# Milestone 1: Claude が動く最小構成

**ステータス:** 完了 (2026-05-14)

WORKFLOW.md の `agent.type` で backend を選択し、`apps/claude-app-server` 経由で Claude が issue を処理できる状態をゴールとしたマイルストーン。実 Linear (`concert-3f96fb9d18cf` / `CYFY-5`) を使ったフル E2E がローカルで PASS した時点で完了とした。

> このファイルは完了済みマイルストーンの記録。進行中・将来のタスクは [`TODO.md`](../../TODO.md) を参照。

---

## スコープ縮小の方針

当面 Codex サブスクリプションが無く実機検証できないため、state 別 backend 切替・passthrough 機構・camelCase 変換などの複雑な仕組みは**全て Milestone 3 以降に延期**。Symphony 改造は最小限（`agent.type` + `claude:` ブロック追加のみ）。

## 実行順

各アプリ内では Phase 番号順に進める。アプリ間の依存があるので、推奨実行順は以下：

1. `apps/symphony` **Phase 1**（完了済み: 2026-05-10 main マージ）
2. `apps/claude-app-server` **Phase 1**（完了済み: 2026-05-11 main マージ）
3. `apps/claude-app-server` **Phase 2**（thread/turn 基本フロー）
4. `apps/claude-app-server` **Phase 3**（ツール呼び出しマッピング、Bash → commandExecution など）
5. `apps/claude-app-server` **Phase 4**（仕上げ削減版: stub・レート制限・Codex フィールド無視・README）
6. モノレポ統合 (`pnpm dev:install`, `pnpm build`)
7. `apps/symphony` **Phase 2**（claude-app-server を実機で起動して issue 処理を回す。手順 2〜5 が前提）
8. `pnpm e2e` (`scripts/e2e.ts`) で受け入れテスト

**注意:** 各アプリの `Phase N` という番号はそのアプリ内ローカルの連番で、アプリ間で同じ番号でも別物。

## 共通仕様 / ドキュメント

- [x] `docs/architecture.md` を書く（アーキテクチャ全体図、ワークスペース戦略、認証）
- [x] `docs/protocol.md` を書く（JSON-RPC サブセット仕様、メソッド一覧、通知一覧）
- [x] `docs/e2e_testing.md` を書く（受け入れテスト手順）
- [x] ルート `README.md` を初見ユーザ向けに整備

---

## `apps/symphony` (Elixir) — 最小改造

詳細: [`apps/symphony/CLAUDE.md`](../../apps/symphony/CLAUDE.md)

### Phase 1: WORKFLOW.md スキーマに `agent.type` + `claude:` ブロック追加

ゴール: `agent.type: claude` で `claude.command` を起動、`agent.type: codex` で従来どおり `codex.command` を起動。

**完了済み（2026-05-10、merge commit `6e3cf62`）。** 実装は `lib/symphony_elixir/config/schema.ex`（`Schema.Claude` サブスキーマ + cross-field validation）と `lib/symphony_elixir/codex/app_server.ex`（`resolve_command/0`、コマンド存在チェック）。元設計の `workflow.ex` / `config.ex` ではなく `config/schema.ex` 側で対応した。

- [x] `lib/symphony_elixir/config/schema.ex` の YAML パース拡張
  - [x] `agent.type: claude | codex`（デフォルト `codex`、後方互換）
  - [x] `claude:` ブロック（最低限 `command:` のみ必須、cross-field validation で担保）
- [x] `Schema` 構造体に `:claude` embed 追加
- [x] `lib/symphony_elixir/codex/app_server.ex` の subprocess 起動箇所
  - [x] `agent.type: claude` のとき `claude.command` を使う（`resolve_command/0`）
  - [x] それ以外は従来どおり `codex.command`
  - [x] バイナリ存在チェック（`{:error, {:backend_command_not_found, bin}}`）
- [x] `thread/start.params` には引き続き `codex.*` の runtime 設定（`approval_policy`, `thread_sandbox`, `turn_sandbox_policy`）を載せる（claude-app-server は知らないフィールドを無視するので無害）
- [x] テスト追加
  - [x] `agent.type: claude` のとき `claude.command` が選ばれる
  - [x] `agent.type: codex` または未指定で `codex.command` が選ばれる
  - [x] `claude:` ブロックの `command:` 必須化（`type: claude` で未指定ならエラー）

### Phase 2: claude-app-server との結合確認

**完了済み（2026-05-14）。** `pnpm build && pnpm dev:install` で `claude-app-server` を PATH に通し、Linear プロジェクト `concert-3f96fb9d18cf` の test issue `CYFY-5` を `examples/workflow.claude.md` 経由で実行。Symphony → claude-app-server → Claude → Linear のフルパイプラインで issue を Todo → Done まで処理することを確認（`hello.txt` 作成 + commit + Linear API で状態更新）。

- [x] `apps/claude-app-server` をビルドして PATH に通す（`pnpm dev:install`）
- [x] テスト用 Linear プロジェクト + issue を1個用意
- [x] `examples/workflow.claude.md` で issue が処理されることを確認

### サンプル設定

- [x] `examples/workflow.claude.md`（`agent.type: claude`、`claude.command: claude-app-server ...`、`max_concurrent_agents: 2`）

---

## `apps/claude-app-server` (TypeScript)

詳細: [`apps/claude-app-server/CLAUDE.md`](../../apps/claude-app-server/CLAUDE.md)

### Phase 1: スケルトン疎通

**完了済み（2026-05-11、merge commit `a527420`）。** TypeScript ESM (NodeNext) + tsc + vitest + commander + oxlint + oxfmt の構成で TDD 実装。16 テスト全 PASS。

- [x] `package.json`, `tsconfig.json`, `src/bin.ts` 整備
- [x] CLI 引数パース (`--model`, `--permission-mode`, `--allowed-tools` 等を受け取る)
- [x] JSON-RPC 型定義 (`src/jsonrpc/types.ts`)
- [x] JSONL トランスポート (`src/jsonrpc/transport.ts`)
- [x] Dispatcher (`src/jsonrpc/dispatcher.ts`)
- [x] `initialize` ハンドラ + `initialized` 通知受信
- [x] 動作確認: `initialize` リクエストに応答が返る

### Phase 2: thread/turn の基本フロー

**完了済み（2026-05-12、`feat/cas-phase2` ブランチ）。** Claude Agent SDK 結合まで含めた thread/turn 基本フロー実装。97 tests PASS、手動 E2E で "What is 2+2?" → "4" 確認。

- [x] `state/threads.ts` でスレッド管理
- [x] `claude/session.ts` で Claude Agent SDK `query()` をラップ
  - [x] CLI 引数で受け取った `--model` 等を SDK 呼び出しに反映
- [x] `thread/start` ハンドラ → `thr_<uuid>` 発行 + `thread/started` 通知
- [x] `turn/start` ハンドラ → ターン作成、レスポンス即返し → 非同期 SDK 呼び出し
- [x] `claude/event_mapper.ts` で `assistant` text を `agentMessage` 通知に変換
- [x] `turn/completed` 通知
- [x] 動作確認: "What is 2+2?" で回答が `agentMessage` として届く

### Phase 3: ツール呼び出しのマッピング

**完了済み（2026-05-12、`feat/cas-phase3` ブランチ）。** tool_use / tool_result マッピング、`closeAll` による pending クローズ、Codex 本家との差異 README 化。131 tests PASS。

- [x] `tool_use(Bash)` → `commandExecution` item
- [x] `tool_use(Edit/Write/MultiEdit)` → `fileChange` item
- [x] `tool_use(Read/Glob/Grep その他)` → 最小限の item (`mcpToolCall` ラッパー)
- [x] `tool_result` → 対応 item を `item/completed` に
- [ ] `outputDelta` 系ストリーミング通知 (Phase 4: Claude SDK の制約で本家と差異あり、README に明記)
- [x] `turn/interrupt` 実装（`AbortController`、Phase 2 で導入、Phase 3 で tool 進行中の close 動作確認）

### Phase 4: 仕上げ（削減版）

スコープを「Symphony Phase 2 (E2E 実機検証) を回すのに必須かつ低リスクなもの」に絞り込み、partial messages とトークン使用量通知は Milestone 1 から外して [Milestone 3 以降](../../TODO.md#milestone-3-以降予定詳細は後日) に延期。設計詳細: [`docs/superpowers/specs/2026-05-12-cas-phase4-design.md`](../superpowers/specs/2026-05-12-cas-phase4-design.md)。

- [x] 未実装メソッド用 `stub` ハンドラ（`registerStub` helper + `mcpServerStatus/list` → `{ servers: [] }`、拡張可能な構造）
- [x] レート制限ハンドリング（`rate_limit_event` 検出 → `turn/completed status:failed` + `turn.error.codexErrorInfo: "UsageLimitExceeded"`、テキストマッチをフォールバック）
- [x] Symphony から `thread/start.params` / `turn/start.params` に乗ってくる Codex 由来フィールド（`approvalPolicy`, `sandboxPolicy` 等）の無視を回帰テストで固定
- [x] README とサンプル更新（延期項目の明記、`UsageLimitExceeded`、stub 仕様）

---

## モノレポ統合

- [x] root `package.json` に `build` / `build:<app>` / `test` / `test:<app>` / `dev:install` / `dev:uninstall` scripts 追加
- [x] `apps/claude-app-server/package.json` に `start` script 追加
- [x] `scripts/e2e.ts`（受け入れテスト一発実行、`pnpm e2e` で起動）
- [x] LICENSE 配置確認（Apache-2.0 をルートに）

---

## Milestone 1 完了条件

**完了 (2026-05-14)。** 実 Linear (`concert-3f96fb9d18cf` / `CYFY-5`) を使ったフル E2E がローカルで PASS。`outputDelta` 系ストリーミングは設計上 [Milestone 3 以降](../../TODO.md#milestone-3-以降予定詳細は後日) に分離されており、Phase 1〜4 完了の対象外。

- [x] `apps/symphony/` Phase 1〜2 完了
- [x] `apps/claude-app-server/` Phase 1〜4 完了 (outputDelta は Milestone 3 以降に分離)
- [x] `docs/` 配下のドキュメント整備
- [x] `pnpm e2e` で受け入れテストが通る
- [x] README.md が初見ユーザにも分かる内容
- [x] `examples/workflow.claude.md` で Claude backend 経由の issue 処理が実機で動く
