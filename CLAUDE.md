# `studio` モノレポ — 全体指示書

## このリポジトリは何

`studio` は `openai/symphony` のフォークから始まったモノレポです。当初は Symphony (Elixir) を改造して Codex/Claude 両対応のオーケストレーターにする方針でしたが、Milestone 3 で TypeScript 製の `apps/conductor` に書き直し、symphony は削除しました。Milestone 4 でリブランディングして `apps/perform` に改名しました。現在の構成は:

```
studio/
├── apps/
│   ├── perform/                # TypeScript 実装。orchestrator (旧 apps/symphony 相当)
│   ├── claude-app-server/      # TypeScript 実装。Codex App Server 互換 JSON-RPC サーバ
│   └── e2e/                    # 統合テスト用スクリプト
└── docs/                       # 両アプリで共有するドキュメント
```

各アプリの詳細指示は **各ディレクトリの `CLAUDE.md`** を読むこと。このファイルは**全体像**と**両アプリにまたがる事項**を扱う。

---

## 背景・目的

- 本家 OpenAI の Symphony (https://github.com/openai/symphony) は Linear ボードを駆動する Codex 専用オーケストレーターだった
- 開発者は Claude Code 派、かつ「フェーズごとに backend と model を使い分けたい」要件あり  
  （例: 実装は Claude Sonnet、レビューは Codex GPT-5、最終チェックは Claude Opus）
- Codex App Server は実は OpenAI 専用ではなく **JSON-RPC 2.0 stdio のオープンプロトコル**
- なので、**Codex App Server と互換のサーバを Claude バックエンドで実装**すれば、orchestrator からは透過的に扱える
- それが `apps/claude-app-server`
- `apps/perform` (TS) は orchestrator。state ごとに違うコマンド（Codex / claude-app-server / 将来的にはそれ以外）を起動できる (= 旧 `apps/symphony` の TS 置き換え、[ADR-0008](docs/adr/0008-symphony-to-conductor-migration.md) / [ADR-0015](docs/adr/0015-conductor-port-completion.md))

**重要前提**: 本家 `openai/symphony` への追従は考えない。開発者の個人ユース・ツール。コードの綺麗さよりも実用性を優先する。

---

## モノレポにした理由

- 受け入れテストで「両方ビルド→両方起動→疎通確認」を一発で回したい
- ドキュメントを共通管理したい
- バージョニングを揃えたい
- アプリを跨いだ仕様変更時、両側を同じコミットで変更できる

ただし、**コードレベルでは両アプリは独立**:
- perform と claude-app-server は互いを import しない
- 通信は subprocess + stdio JSON-RPC のみ
- TypeScript で揃っているが pnpm workspace で個別パッケージとして閉じている

---

## ディレクトリ構成

```
studio/
├── README.md                       # ユーザ向け説明
├── CLAUDE.md                       # ★ このファイル
├── LICENSE                         # Apache-2.0 (Symphony 由来)
├── .gitignore
├── package.json                    # モノレポルート、pnpm workspace 定義
├── pnpm-workspace.yaml             # workspaces 設定
│
├── apps/
│   ├── perform/                    # TS、orchestrator
│   │   ├── CLAUDE.md               # perform 開発指示
│   │   ├── README.md
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   ├── test/
│   │   └── examples/
│   │
│   ├── claude-app-server/          # TS、Claude バックエンド用 JSON-RPC サーバ
│   │   ├── CLAUDE.md               # claude-app-server 実装指示
│   │   ├── README.md
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   ├── test/
│   │   └── examples/
│   │
│   └── e2e/
│       ├── claude-linear.ts        # Linear E2E スクリプト
│       ├── claude-github.ts        # GitHub E2E スクリプト
│       ├── config.json             # non-secret E2E 設定
│       ├── workflow.claude-linear.md   # Linear 用 WORKFLOW.md
│       ├── workflow.claude-github.md   # GitHub 用 WORKFLOW.md
│       └── lib/
│           └── common.ts           # 共通ヘルパー
│
└── docs/                           # 両アプリで参照する共通ドキュメント
    ├── architecture.md             # アーキテクチャ全体図
    ├── protocol.md                 # 二者間で喋る JSON-RPC のサブセット仕様
    ├── workflow_md_schema.md       # WORKFLOW.md の拡張スキーマ仕様
    └── e2e_testing.md              # E2E テスト手順
```

---

## 開発ルール（両アプリ共通）

### Git ブランチ

- `main`: 最新の動く状態
- `feat/*`: 機能追加
- `fix/*`: バグ修正
- 大きな変更は両アプリにまたがる可能性があるので、**branchはモノレポ全体で1本**に保つ

### コミットメッセージ

両アプリにまたがる変更がコミット単位で発生する可能性があるので、scope を付けて区別:

```
feat(claude-app-server): implement turn/start handler
fix(perform): resolve backend by state correctly
docs(both): update WORKFLOW.md schema doc
chore(repo): drop apps/symphony after M3 conductor port
```

### バージョニング

- 当面、両アプリは独立したバージョン番号を持つ (`apps/perform/package.json` と `apps/claude-app-server/package.json`)
- リポジトリ全体には git tag で marker を打つ程度
- リリース管理は当座は不要、開発中は main で動けば OK

### ライセンス

- ルートは Apache-2.0 (Symphony 由来を継承)
- claude-app-server も Apache-2.0 で揃える（混乱を避ける）

---

## 両アプリにまたがる仕様（凍結事項）

ここに書いてあることは**両アプリの実装担当が必ず守る**。各アプリ内の CLAUDE.md と齟齬があったらここを優先。

### プロトコル: Codex App Server サブセット

両者は **JSON-RPC 2.0 stdio (JSONL)** で会話する。完全な Codex App Server SPEC ではなく、perform が使うサブセットだけを実装する。

**perform が使うメソッド**（claude-app-server が必ず実装する）:

| メソッド | 種類 |
|---|---|
| `initialize` | request |
| `initialized` | notification |
| `thread/start` | request |
| `turn/start` | request |
| `turn/interrupt` | request |

**claude-app-server が送る通知**:

| 通知 | 用途 |
|---|---|
| `thread/started` | スレッド開始 |
| `turn/started` | ターン開始 |
| `item/started`, `item/completed` | 各 item のライフサイクル |
| `item/agentMessage/delta` | アシスタントメッセージのストリーミング |
| `item/commandExecution/outputDelta` | bash コマンド出力 |
| `item/fileChange/outputDelta` | ファイル編集差分 |
| `turn/completed` | ターン終了 |

その他の Codex メソッド（`account/*`, `fs/*`, `thread/fork` 等）は **未実装、JSON-RPC エラー -32601 を返す**。  
将来、擬似応答で埋めるニーズが出たら `apps/claude-app-server/src/handlers/stub.ts` を拡張。

詳細は `docs/protocol.md` を参照。

### WORKFLOW.md スキーマ

`apps/perform` が読む WORKFLOW.md は、本家 symphony から **最小限**だけ拡張されている。Milestone 1 では state 別の backend 切替・passthrough 機構などは導入せず、`agent.type` で backend ブロックを選択するだけ:

```yaml
agent:
  type: claude              # claude | codex （未指定なら codex で本家互換）
  max_concurrent_agents: 2  # Pro/Max サブスクなら控えめ推奨
  max_turns: 10

# agent.type: claude のとき読まれる
claude:
  command: claude-app-server --model claude-opus-4-7 --permission-mode bypassPermissions

# agent.type: codex のとき読まれる（本家 symphony と完全互換、変更ゼロ）
codex:
  command: codex --config shell_environment_policy.inherit=all --config 'model="gpt-5.5"' app-server
  approval_policy: never
  thread_sandbox: workspace-write
  turn_sandbox_policy: { type: workspaceWrite }
```

#### スキーマ規約

- **`agent.type`** で backend を選択（`claude` または `codex`）。未指定なら `codex`（本家互換）
  - **contributor 向け補足**: `apps/perform` では開発・テスト用に `mock` の値も受け付ける（subprocess 起動なし、in-process で即時応答）。本番 WORKFLOW.md では使わない
- **各 backend の設定は自前のブロック内**（`claude:` / `codex:`）に書く。perform は **中身を解釈せず**、選んだブロックの `command` を subprocess として起動するだけ
- **backend 固有の設定（model, permission_mode 等）は `command` の引数として渡す**:
  - claude: `claude-app-server --model claude-opus-4-7 --permission-mode bypassPermissions`
  - codex: `codex --config 'model="gpt-5.5"' app-server`
- perform から `thread/start.params` に乗せる runtime 設定（`approval_policy`, `thread_sandbox`, `turn_sandbox_policy`）は引き続き **`codex:` ブロック**から読まれる。`agent.type: claude` のときも同じものが乗る（claude-app-server は知らないフィールドを無視）
- **state 別 backend 切替・passthrough・camelCase 変換は Milestone 1 では未実装**。Milestone 3 以降で再導入予定（[`TODO.md`](TODO.md) 参照）
- **tracker.kind と per-kind block** ([ADR-0013](docs/adr/0013-tracker-block-split-by-kind.md)): `tracker:` は共通フィールドのみ (`kind` / `active_states` / `terminal_states` / `doing_state` / `done_state`)、kind 固有設定は `linear:` / `github:` ブロックに分離。
- **state 遷移は orchestrator 主導** ([ADR-0014](docs/adr/0014-symphony-owned-state-transitions.md) — owner は perform、[ADR-0015](docs/adr/0015-conductor-port-completion.md) 参照): `tracker.doing_state` / `tracker.done_state` 設定時、perform が直接 mutation する。未設定なら no-op (Linear の prompt 方式運用とも互換)。
- `workspace:` ブロックは `root:` のみを持つ。**`hooks:` ブロックは top-level** (`workspace:` の入れ子ではない)。`before_run` / `after_create` / `before_remove` / `after_run` の 4 hook と `timeout_ms` を取る

詳細は [`docs/protocol.md`](docs/protocol.md) と [`docs/architecture.md`](docs/architecture.md) を参照。

### ワークスペース戦略

Issue ごとに 1 つのワークスペースを共有。backend が切り替わってもワークスペースは使い回す（git ブランチ経由で引き継ぎ）。  
詳細は `docs/architecture.md` を参照。

### 認証

- claude-app-server は Claude Pro/Max サブスクリプション認証前提
- `~/.claude/` の OAuth トークンを CLI が読む
- API キーは使わない（ANTHROPIC_API_KEY があれば明示的にクリア）

### 状態遷移責任

各 backend が `linear_graphql` 動的ツールで Linear の状態を直接変える（既存 symphony 流儀）。  
将来 MCP 経由の動的ツール提供を `apps/claude-app-server` で実装する想定だが、Phase 1 の範囲では未実装。  
当面は perform プロンプトで Claude に直接 Linear API を叩かせる回避策で対応。

---

## 実装の進め方

### 並行開発の方針

**両アプリは並行に開発できる**ようにプロトコルを最初に固定したので、以下の順で進めて良い:

1. **このルート CLAUDE.md と各アプリの CLAUDE.md を読む**
2. **`docs/architecture.md`、`docs/protocol.md` を確認**（既存なら）
3. 開発者の好みで:
   - claude-app-server から着手して Phase 2 まで完成させる → perform 側に移る
   - 両方並行（pair / 別セッション）で Phase 1 ずつ進める
4. **Phase 6（perform）/ Phase 4（claude-app-server）で疎通テスト**

疎通テストは `pnpm test:e2e` (→ `apps/e2e/claude-linear.ts` / `apps/e2e/claude-github.ts`) が担当する。実装と詳細は `docs/superpowers/specs/2026-05-14-e2e-script-design.md` 参照。

### 受け入れテスト（E2E）

`apps/e2e/claude-linear.ts` / `apps/e2e/claude-github.ts` (TypeScript、`pnpm test:e2e` で起動) が `pnpm build` → `pnpm dev:install` → issue リセット → perform 起動 → workspace 検証を一発で実行する。Linear API key / GitHub PAT と test issue 設定 (`apps/e2e/config.json`) が必要。詳細は `docs/superpowers/specs/2026-05-14-e2e-script-design.md` と `docs/e2e_testing.md` を参照。

---

## DevContainer (Nix Flake)

このリポジトリは **DevContainer + Nix Flake** で開発できる。Claude Code を `--dangerously-skip-permissions` で動かす際の隔離環境として用意したもの。

### 起動

任意の DevContainer 対応クライアント (DevPod, VS Code Remote-Containers, GitHub Codespaces 等) でリポジトリを開く。`postCreateCommand` が Nix + direnv をインストールして devShell をロードする。

```bash
# 例: DevPod の場合
devpod up .
```

### 想定構成

- ユーザ: `dev` (uid 1000、`vscode` を Dockerfile でリネーム)
- workspace: `/workspace` (リポジトリ全体を bind mount)
- 永続ボリューム: `/nix` と `/home` (`COMPOSE_PROJECT_NAME` スコープ、例: `babie-studio_nix` / `babie-studio_home`)
- 提供されるツール: `nodejs`, `pnpm`, `claude`, `codex`, `git`, `gh`, `curl`, `jq`, `ripgrep`, `fd`, `direnv`, `nil`

### 初回ログイン

`~/.claude/` は **ホストとは独立** の named volume に乗っているので、コンテナ初回起動時に:

```bash
claude login
```

を実行する必要がある。

### Cachix を使いたい時

リポジトリルートに `.env.local` を作って:

```
CACHIX_AUTH_TOKEN=your-token-here
```

その上で `postCreateCommand.sh` 内の `YOUR_CACHIX_CACHE` を実際のキャッシュ名に書き換え、`nix.conf` の `substituters` / `trusted-public-keys` にもキャッシュ URL と公開鍵を追加する。

### トラブル時

`postCreateCommand.sh` は冪等に書かれているので、Nix 周りで何か壊れたら:

```bash
bash .devcontainer/postCreateCommand.sh
```

をコンテナ内で再実行すれば良い。

### Flake の更新

`flake.nix` を編集してパッケージを追加した場合:

```bash
cd /workspace
direnv reload   # nix-direnv が変更を検知してリビルド
```

`nixpkgs` 側を更新したい場合:

```bash
nix flake update nixpkgs
direnv reload
```

`flake.lock` の差分はコミットすれば他の DevContainer 利用者にも反映される。

---

## 落とし穴 (両アプリ共通の事情)

### 認証ファイルの位置

claude-app-server は `~/.claude/` を読む。perform が per-issue で workspace を切るとき、**`HOME` 環境変数を切り替えてはいけない**。  
モノレポ全体で `HOME` の扱いに気をつけること。

### claude-app-server がインストールされていないと動かない

perform が state エントリの `command: claude-app-server` を起動するとき、PATH に `claude-app-server` が無ければ即エラー。  
開発時は `pnpm dev:install` (内部で `cd apps/claude-app-server && pnpm link --global` を実行) で対応。アンインストールは `pnpm dev:uninstall`。

### モデル指定の意味が backend で違う

- Codex: `gpt-5.4` 等
- Claude: `claude-opus-4-7` 等

perform は中身を解釈せずパススルー。各 backend が認識できないモデル名はエラー応答する。  
WORKFLOW.md でユーザが間違えても backend 側でしかキャッチできない。

### Pro/Max のレート制限

Codex 用デフォルトの `max_concurrent_agents: 10` は Claude Pro/Max では厳しすぎる。  
WORKFLOW.md コメントとドキュメントで推奨値（2〜3）を明示すること。

---

## 参考資料

- 本家 Symphony: https://github.com/openai/symphony
- Symphony SPEC: https://github.com/openai/symphony/blob/main/SPEC.md
- Codex App Server: https://github.com/openai/codex/tree/main/codex-rs/app-server
- Codex App Server ドキュメント: https://developers.openai.com/codex/app-server
- Claude Agent SDK: https://docs.claude.com/en/api/agent-sdk/overview
- 参考実装 (clode-app-server): https://github.com/sumansid/clode-app-server
- 参考実装 (sapsaldog/symphony-claude): https://sapsaldog.com/posts/symphony-with-claude-code

---

## 完了条件（プロジェクト全体）

- [x] `apps/conductor/` への移植完了（Milestone 3 / Phase 1〜7、[`docs/milestones/03-conductor-port.md`](docs/milestones/03-conductor-port.md)）
- [x] `apps/perform/` へのリブランディング完了（Milestone 4）
- [ ] `apps/claude-app-server/` の実装完了（Phase 1〜4、各CLAUDE.md参照）
- [ ] `docs/` 配下のドキュメント整備
- [x] `pnpm test:e2e` で受け入れテストが通る
- [ ] README.md が初見ユーザにも分かる内容
- [ ] Codex backend で issue 処理が動く（`examples/workflow.codex.md`）

---

## 質問があれば

両アプリにまたがる仕様変更や、ここに書いていない判断は、**ルート CLAUDE.md の更新を伴う**。  
各アプリ内の CLAUDE.md だけで決められる事項とは区別すること。
