# studio

`studio` は [openai/symphony](https://github.com/openai/symphony) をフォークしたモノレポで、**Codex 専用だった Symphony を Claude にも対応させる**ことを目的として始まりました。現在は TypeScript 実装の `apps/perform` (orchestrator) と `apps/claude-app-server` (Codex App Server 互換 JSON-RPC サーバ) の 2 app 構成で動いています。

> [!NOTE]
> 開発者本人が使うための個人ユース・フォークです。`studio` への追従や一般ユーザサポートは行いません。コードの綺麗さよりも実用性を優先しています。

---

## 何ができるか

本家 Symphony は Linear ボードをポーリングし、active 状態に入った issue を自動的にコーディングエージェントに処理させるオーケストレーターです。`studio` はこの仕組みを **Codex App Server プロトコル互換のサーバを Claude バックエンドで実装する**ことで、同じフローのまま Claude を動かせるようにし、orchestrator 自体も TypeScript に書き直しました (`apps/perform`)。

> 本家 Symphony のデモ動画は [openai/symphony](https://github.com/openai/symphony) のリポジトリで参照できます。`studio` も同等のフローを Claude バックエンドで動かすことを目指しています。

---

## リポジトリ構成

```
studio/
├── apps/
│   ├── perform/             # TypeScript、Codex App Server 互換 orchestrator
│   ├── claude-app-server/   # TypeScript、Codex App Server 互換 JSON-RPC サーバ
│   └── e2e/                 # E2E テストスクリプト・設定
└── docs/                    # 設計・プロトコル・E2E 手順など
```

- **`apps/perform`**: TypeScript 実装の orchestrator。tracker (Linear / GitHub Projects v2) をポーリングして issue を coding agent に dispatch する
- **`apps/claude-app-server`**: perform が subprocess として起動する、Codex App Server プロトコル互換の JSON-RPC サーバ。中で Claude Agent SDK を呼ぶ

両アプリは subprocess + stdio JSON-RPC のみで通信し、コードレベルでは独立しています。

---

## ステータス

**Milestone 1（完了、2026-05-14）**: Claude が issue を処理できる最小構成

- `agent.type: claude` で `claude-app-server` を起動できる
- Codex 互換動作（`agent.type: codex` または未指定時）は本家 Symphony と同じ
- 実 Linear での E2E が PASS（詳細は [`docs/milestones/01-claude-minimal.md`](docs/milestones/01-claude-minimal.md)）

**Milestone 2（完了、2026-05-15）**: GitHub Project 対応

- WORKFLOW.md `tracker.kind` で Linear / GitHub Projects (v2) を切り替え可能 ([ADR-0013](docs/adr/0013-tracker-block-split-by-kind.md))
- state 遷移は orchestrator (perform) が `tracker.doing_state` / `tracker.done_state` を使って自動発火 ([ADR-0014](docs/adr/0014-symphony-owned-state-transitions.md))
- 実 GitHub Project での E2E が PASS（詳細は [`docs/milestones/02-github-tracker.md`](docs/milestones/02-github-tracker.md)）

state 別 backend 切替・passthrough 機構などの高度な機能は **Milestone 3 以降**（[`TODO.md`](TODO.md) 参照）。

---

## 必要なもの

- **Node.js** + **pnpm** — perform / claude-app-server のビルドと実行
- **Linear API key** — `LINEAR_API_KEY` 環境変数にセット (Linear tracker を使う場合)
- **GitHub Personal Access Token** — `GITHUB_TOKEN` 環境変数にセット。classic PAT (`ghp_...`) を `repo` + `project` scope で発行 (GitHub Projects v2 を使う場合)
- **Claude Pro / Max サブスクリプション** — `~/.claude/` に OAuth トークンが置かれている状態（API キーは使わない）

---

## クイックスタート

```bash
# 1. ビルド（perform と claude-app-server 両方）
pnpm build

# 2. claude-app-server を PATH に通す
pnpm dev:install

# 3. WORKFLOW.md を用意（apps/perform/examples/workflow.claude-linear.md または
#    workflow.claude-github.md を参考に）
#    - Linear なら linear.project_slug をテストプロジェクトに合わせる
#    - GitHub なら github.project_owner / project_number を合わせる
#    - claude.command で起動引数を指定（model など）

# 4. perform を起動
perform apps/perform/examples/workflow.claude-linear.md
```

E2E テスト（`tmp/hello.js` を作って実行確認するシナリオ）は [`docs/e2e_testing.md`](docs/e2e_testing.md) を参照。Linear / GitHub 両 tracker 向けに `pnpm test:e2e:claude-linear` / `pnpm test:e2e:claude-github` を用意しており、`pnpm test:e2e` で両方順番に走ります。test issue 設定は `apps/e2e/config.json` に置きます (PAT / API key は env のまま)。

---

## DevContainer で開発する

このリポジトリは DevContainer + Nix Flake で開発できる。

```bash
# 例: DevPod を使う場合
devpod up .

# コンテナ内に入ったら初回のみ
claude login
```

ユーザ名は `dev`、workspace は `/workspace`。詳細は [`CLAUDE.md`](CLAUDE.md) と [`docs/superpowers/specs/2026-05-13-devcontainer-nix-flake-design.md`](docs/superpowers/specs/2026-05-13-devcontainer-nix-flake-design.md) を参照。

---

## ドキュメント

- [`docs/architecture.md`](docs/architecture.md) — モノレポ全体の設計、コンポーネント構成、ライフサイクル
- [`docs/protocol.md`](docs/protocol.md) — perform ↔ claude-app-server の JSON-RPC サブセット仕様
- [`docs/e2e_testing.md`](docs/e2e_testing.md) — 受け入れテスト手順
- [`TODO.md`](TODO.md) — 実装タスク一覧（Milestone 2 以降）
- [`docs/milestones/`](docs/milestones/) — 完了済みマイルストーンの記録
- [`CLAUDE.md`](CLAUDE.md) — 両アプリにまたがる凍結事項（コーディングエージェント向け指示書）
- [`apps/claude-app-server/CLAUDE.md`](apps/claude-app-server/CLAUDE.md) — claude-app-server 実装指示

---

## 謝辞

- [openai/symphony](https://github.com/openai/symphony): フォーク元。Linear 連携・workspace 管理・ポーリング基盤などの設計を引き継ぎつつ、Milestone 3 で TypeScript に書き直し、Milestone 4 で `apps/perform` にリブランディングしました ([ADR-0008](docs/adr/0008-symphony-to-conductor-migration.md) / [ADR-0015](docs/adr/0015-conductor-port-completion.md))
- [Codex App Server](https://developers.openai.com/codex/app-server): JSON-RPC 2.0 stdio のオープンプロトコルとして設計されており、これを Claude バックエンドで再実装するという発想が `studio` の出発点です
- [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview): claude-app-server 内部で利用

---

## ライセンス

Apache-2.0（本家 Symphony と同じ）。詳細は [`LICENSE`](LICENSE) を参照。
