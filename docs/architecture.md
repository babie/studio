# studio アーキテクチャ

`studio` モノレポの全体設計と運用上の挙動をまとめたドキュメント。プロトコル仕様は [`protocol.md`](./protocol.md)、受け入れテスト手順は [`e2e_testing.md`](./e2e_testing.md) を参照。

---

## 1. 概要

`studio` は OpenAI 製の [Symphony](https://github.com/openai/symphony)（issue tracker (Linear / GitHub Projects) を駆動する Codex 専用オーケストレーター）をフォークし、**Codex / Claude を切り替えられるエージェント・オーケストレーター**として TypeScript で再構築したモノレポ。Milestone 3 で Elixir 実装 (`apps/symphony`) を TypeScript 実装 (`apps/conductor`) に書き直し、Milestone 4 で `apps/perform` にリブランディングした。現在は TS 単一スタックで運用している ([ADR-0008](adr/0008-symphony-to-conductor-migration.md) / [ADR-0015](adr/0015-conductor-port-completion.md))。

設計の核は次の発見にある:

- Codex App Server は OpenAI 専用ではなく **JSON-RPC 2.0 stdio (JSONL) のオープンプロトコル** である
- そのため Codex App Server 互換のサーバを Claude バックエンドで実装すれば、orchestrator 側からは透過的に扱える
- orchestrator (perform) 側は `agent.type` で起動コマンドを切り替える機能だけ追加すれば backend を選択できる

これを実現するため、モノレポは2つのアプリで構成される:

| アプリ | 言語 | 役割 |
|---|---|---|
| `apps/perform` | TypeScript | tracker (Linear / GitHub Projects) のポーリング、issue ごとの workspace 管理、backend subprocess の起動・切替 |
| `apps/claude-app-server` | TypeScript | Codex App Server 互換の JSON-RPC サーバ。中で Claude Agent SDK を呼ぶ |

**`apps/perform`:** orchestrator (旧 `apps/symphony` の TS 置き換え、M3 完了後 M4 でリブランディング)。
Memory / Linear / GitHub tracker を抽象化し、claude-app-server / codex
を subprocess として起動する。M3 完了 (Phase 7、2026-05-18) で `apps/symphony` は
削除済。contributor 向けに `agent.type: mock` を受け付け、subprocess を
起動せず in-process で応答することで Phase 1 happy path の自動テストを可能
にしている。本番 WORKFLOW.md では `mock` は使わない。

---

## 2. コンポーネント構成

```
                        ┌──────────────────────────────────────────┐
                        │ Tracker (Linear / GH Projects)           │
                        │  - issue の状態（Todo / In Progress / …） │
                        └────────────────────┬─────────────────────┘
                                             │ GraphQL (poll / mutate)
                                             │
        ┌────────────────────────────────────▼──────────────────────────────────┐
        │ apps/perform (TypeScript)                                             │
        │   - WORKFLOW.md を読み、agent.type でコマンドを解決                   │
        │   - issue ごとに workspace（git clone）を作成                         │
        │   - issue 1 件 = backend subprocess 1 つ                              │
        │   - 状態遷移を検知したら subprocess を kill して新コマンドで再起動    │
        └─────┬──────────────────────────────────────────────┬──────────────────┘
              │ stdio JSON-RPC                                │ stdio JSON-RPC
              │                                               │
   ┌──────────▼─────────────┐                  ┌──────────────▼─────────────────┐
   │ codex app-server       │                  │ apps/claude-app-server  (TS)   │
   │  (OpenAI 配布バイナリ) │                  │   - Codex App Server サブセット │
   │                        │                  │   - Claude Agent SDK をラップ   │
   └──────────┬─────────────┘                  └──────────────┬─────────────────┘
              │ HTTPS                                         │ HTTPS (OAuth)
              ▼                                               ▼
       OpenAI API / ChatGPT                             Anthropic / Claude.ai
```

### 通信経路

- **perform ↔ Linear**: GraphQL over HTTPS（issue の取得・状態変更）
- **perform ↔ backend**: stdin/stdout に JSONL（JSON-RPC 2.0、改行区切り）
- **backend ↔ AI provider**: 各 backend が直接 HTTPS で叩く。perform は通らない

### 重要: perform は backend を区別しない

WORKFLOW.md の `agent.type` に応じて `claude.command` または `codex.command` をそのまま subprocess として起動するだけで、起動後は `backend: codex` / `backend: claude` のような識別子を持たない。Codex CLI も `claude-app-server` も「Codex App Server プロトコルを喋る subprocess」として等しく扱われる。

---

## 3. エージェント実行ライフサイクル

1 件の issue が処理される流れ（Milestone 1 縮小スコープ）:

```
1. perform が Linear をポーリング
    └─ active_states に入った issue を検出
2. Workspace を作成
    └─ workspace ルート/<issue-id>/ に git clone --depth 1
    └─ workspace.hooks.after_create があれば実行
3. WORKFLOW.md の agent.type に応じて起動コマンドを解決
    └─ agent.type: claude → claude.command
    └─ agent.type: codex（または未指定）→ codex.command
4. 解決した command を subprocess として起動
    └─ stdio JSON-RPC で initialize → thread/start → turn/start を送る
    └─ thread/start.params に codex.* runtime 設定（approval_policy 等）を載せる
       （agent.type: claude のときも同じ。claude-app-server は知らないフィールドを無視）
    └─ backend 固有の設定（model, permission_mode 等）は command 引数として埋め込まれているので、
       backend 自身が起動時に解釈する
5. backend が動作（コード編集、コマンド実行、Linear 状態変更）
    └─ assistant message / item は JSON-RPC 通知で perform に届く
    └─ perform はログ・ダッシュボード表示・累計トークン集計のみ
6. issue が終了状態に入ったら subprocess を kill して workspace を解放
```

> **Milestone 3 以降（検討中）:** state 別 backend 切替（状態遷移時に subprocess を `turn/interrupt` → kill → 新 command で再起動）と passthrough 機構（`thread/start.params` への動的フィールドマージ）は将来の検討事項。詳細は [`TODO.md`](../TODO.md) 参照。

---

## 4. ワークスペース戦略

### 1 issue = 1 workspace

各 issue について 1 つの作業ディレクトリ（git clone 済み）を割り当て、その issue が終わるまで使い回す。backend が切り替わってもワークスペースは破棄しない。

### 切替時の作業引き継ぎ

backend を切り替えるとき、新しい backend は前任者がコミット／push したブランチを `git pull` して作業を続ける。コミット粒度・ブランチ命名は WORKFLOW.md とプロンプトで規定する。

### ワークスペース実装

現状は issue ごとに `git clone --depth 1` でフルクローン。ディスクと初回作成時間のコストが大きいため、Milestone 3 以降で `git worktree` ベースに移行予定（[TODO.md](../TODO.md) 参照）。

### `HOME` の扱い

backend は `~/.claude/` や `~/.codex/` の認証情報を読みに行くので、**perform は per-issue で `HOME` 環境変数を切り替えてはいけない**。workspace は `cwd` のみ切り替え、`HOME` はホストの `HOME` をそのまま継承する。

---

## 5. 認証

### Claude (claude-app-server)

- Claude Pro / Max **サブスクリプション認証**を前提とする（API キーは使わない）
- Claude CLI が `~/.claude/` に置く OAuth トークンを Claude Agent SDK が読む
- 起動時に `ANTHROPIC_API_KEY` 環境変数があれば**明示的に unset**する（API キー経由の課金を防ぐため）
- レート制限: Pro/Max は同時実行に厳しいので `WORKFLOW.md` の `max_concurrent_agents` は 2〜3 を推奨

### Codex (codex CLI)

- Codex CLI 標準のローカル認証（`~/.codex/`）を使う
- perform はトークン管理に関与しない

### モノレポでの注意

両 backend が同一ホストの `$HOME` 配下を読むため、perform が workspace を作るときに `HOME` を書き換えるとどちらも認証エラーになる。テストや CI で `HOME` を差し替える場合は事前に認証ファイルをコピーしておくこと。

---

## 6. backend 選択の挙動

Milestone 1 縮小スコープでは、**1 つの WORKFLOW.md = 1 つの backend** で固定。`agent.type` で選択した backend を全 issue 処理で使い続ける。state 遷移しても backend は切り替わらない。

### 選択ロジック

```
agent.type が "claude" → claude.command を起動
agent.type が "codex" または未指定 → codex.command を起動（本家 Symphony 互換）
```

### subprocess は issue の最後まで生存

issue が active_states に入ったら subprocess を起動し、終了状態に入るまで同じ subprocess を使い続ける。state 遷移時に subprocess の入れ替えは発生しない。

> **Milestone 3 以降（検討中）:** `agent.states` で state 別の `command` 切替を入れる可能性がある。そのとき turn/interrupt → kill → 再起動シーケンスを実装する。

---

## 7. 状態遷移責任

issue の状態を **Linear に書き戻すのは backend 側の責任**。perform は状態を読むだけ。

- 既存 Symphony 流儀: backend に `linear_graphql` 動的ツールを供給し、backend が必要なタイミングで mutation を発行する
- Phase 1 範囲では MCP 経由の動的ツール提供は未実装
- 当面は `apps/claude-app-server` でも、perform プロンプトで Claude に直接 Linear API を叩かせる回避策で対応

将来的に MCP サーバを `apps/claude-app-server` に同梱して動的ツールを提供する想定。

なお Milestone 2 Phase 3 以降、orchestrator (M2 では Symphony、M3 以降は conductor → M4 で perform) は `tracker.doing_state` / `tracker.done_state` 設定時に自動で issue 状態を更新する ([ADR-0014](adr/0014-symphony-owned-state-transitions.md))。動的ツール経路は本家 Symphony 互換のための legacy として残しているが、新規 backend (claude-app-server) は実装していない。

---

## 8. 関連ドキュメント

- [`protocol.md`](./protocol.md): JSON-RPC サブセットの正式仕様（メソッド／通知一覧）
- [`e2e_testing.md`](./e2e_testing.md): 受け入れテストの手順
- [`TODO.md`](../TODO.md): 実装タスク一覧
- ルート [`CLAUDE.md`](../CLAUDE.md): 両アプリにまたがる凍結事項

## perform subprocess flow (M3 Phase 2 以降)

`apps/perform` (TypeScript) は WORKFLOW.md の `agent.type` (`claude` / `codex` / `mock`) に応じて backend を spawn し、JSON-RPC 2.0 over stdin/stdout JSONL で通信する。

- spawn は `child_process.spawn`、子プロセスの stdio を `["pipe", "pipe", "pipe"]` で確保
- perform → backend: `initialize` → `thread/start` → `turn/start` × `max_turns` → `shutdown` の順
- backend → perform: `initialized` / `thread/started` / `turn/started` / `item/*` (started/completed/agentMessage/...) / `turn/completed` の通知
- ターン中断は `turn/interrupt` → SIGTERM → SIGKILL の段階的シャットダウン (`AbortController` 経由)
- perform の CLI は `--i-understand-that-this-will-be-running-without-the-usual-guardrails` flag を **必須化** (実 backend は per-tool prompt なしで動作するため)

詳細設計: [`docs/superpowers/specs/2026-05-16-m3-phase2-design.md`](superpowers/specs/2026-05-16-m3-phase2-design.md)。
