# E2E テスト手順

`studio` モノレポの受け入れテスト（End-to-End）手順。Linear および GitHub Projects (v2) 両 tracker について、`examples/workflow.claude-linear.md` / `examples/workflow.claude-github.md` の issue 1 件が `claude-app-server` 経由で処理されることを確認する。

---

## 1. 概要

検証する E2E フロー:

```
perform が Linear をポーリング
  → active_states に入った issue を検出
  → workspace を作成（git clone）
  → claude-app-server を subprocess として起動
  → initialize / thread/start / turn/start で issue 内容を渡す
  → claude-app-server が Claude Agent SDK 経由で実装を進行
  → 完了通知（turn/completed）+ issue が終了状態に遷移
```

E2E テストはこの一連の流れが**実機で完走する**ことを確認する。

---

## 2. 前提条件

### ツール

- **Node.js / pnpm** — perform / claude-app-server のビルド・実行用 (`flake.nix` の devShell が `nodejs_24` + `pnpm` を提供)
- **git** — workspace 作成に使う
- **claude** CLI — `~/.claude/` の OAuth トークンを使うため

### 認証

- **Claude Pro / Max サブスクリプション**: `~/.claude/` に OAuth トークンが置かれている状態
  - 確認: `claude --version` がエラーなく動く
  - **`ANTHROPIC_API_KEY` が環境にあれば unset しておく**（API キー経由の課金を防ぐため）
- **Linear API key**: 環境変数 `LINEAR_API_KEY` にセット

### Linear プロジェクト

- テスト用 Linear プロジェクトを 1 つ用意
- `examples/workflow.claude-linear.md` の `linear.project_slug:` を合わせる
- `active_states:` に含まれる状態（例: `Todo`）に **issue を 1 件** 入れる
- issue の内容は「Hello World 的な簡単な編集タスク」が望ましい（例: README に1行追加）

---

## 3. ビルド手順

モノレポルートで:

```bash
pnpm build
```

中身（手動でやるなら）:

```bash
pnpm build:claude-app-server
pnpm build:perform
```

生成物:
- `apps/claude-app-server/dist/bin.js` — claude-app-server の実行可能 entrypoint
- `apps/perform/dist/bin.js` — perform の実行可能 entrypoint

---

## 4. claude-app-server を PATH に通す

perform が `claude.command: claude-app-server ...` を `exec` できるよう、`claude-app-server` を PATH に通す:

```bash
pnpm dev:install
```

内部で `cd apps/claude-app-server && pnpm link --global` を実行し、グローバルに `claude-app-server` コマンドを登録する。アンインストールは `pnpm dev:uninstall`。

確認:

```bash
which claude-app-server
# → (pnpm global bin ディレクトリ内のリンク先)
```

---

## 5. テスト用 issue の準備

### 5.1 issue 内容（Milestone 1 の標準 E2E ケース）

プログラム的に検証可能な最小タスク: **`tmp/hello.js` を作成し、`node tmp/hello.js` が `Hello, World!` を出力する**。

```markdown
Title: [E2E test] Create tmp/hello.js

Description:
Create a file at `tmp/hello.js` in this workspace that, when executed with
`node tmp/hello.js`, outputs exactly `Hello, World!` (followed by a newline).

Steps:
1. Create the file `tmp/hello.js` (create the `tmp/` directory if needed).
2. Use `console.log("Hello, World!")`.
3. Commit the change to the workspace git (no push required).
4. Update this Linear issue's status to Done.

Acceptance criteria:
- `tmp/hello.js` exists.
- `node tmp/hello.js` outputs exactly `Hello, World!\n`.
- The file is committed to the workspace's git history.
- This Linear issue is moved to the `Done` state.
```

### 5.2 Linear プロジェクト

1. Linear で **テスト用プロジェクト**を作成（または既存のテスト用を使う）
2. プロジェクト slug を `examples/workflow.claude-linear.md` の `linear.project_slug:` に書く
3. `active_states:` のいずれか（典型的には `Todo`）に上記 issue を **1 件のみ**作成
4. `LINEAR_API_KEY` 環境変数をセット

### GitHub E2E の事前準備

1. classic PAT (`ghp_...`) を `repo` + `project` scope で発行し、`GITHUB_TOKEN` env にセット。fine-grained PAT は user-owned ProjectV2 に未対応 (GitHub の既知制限)。
2. test repository に test issue を 1 件作成。description には Linear 版と同じく「Create a file at `tmp/hello.js` that prints `Hello, World!` when run with `node`. Commit the change.」のような実装可能なタスクを書く。
3. test Project (Projects v2) に issue を Items として追加。
4. Project の Status field option (`Todo` / `In Progress` / `Done`) が `e2e.config.json` の `github.resetStateName` / `github.terminalStates` と一致しているか確認。
5. issue の assignee を PAT 所有者にセット。`workflow.claude-github.md` の `github.assignee: me` が有効になる条件。
6. `apps/e2e/config.json` の `github.repo` / `github.issueNumber` を実値で埋める。

### 5.3 workspace 設定

E2E では決定的なパス・自前 `git init` 構成にする。`examples/workflow.claude-linear.md` 抜粋:

```yaml
workspace:
  root: /tmp/studio-e2e/workspaces
hooks:
  after_create: |
    git init
    git config user.email "e2e@studio.test"
    git config user.name "Studio E2E"
    echo "# E2E Workspace" > README.md
    git add README.md
    git commit -m "Initial commit"
```

- 外部リポジトリの clone は不要（`git init` で自前初期化）
- `tmp/` は `.gitignore` に入れない（commit してほしいので）
- 検証完了後に workspace ルートを丸ごと削除して冪等にする

---

### 5.4 設定・環境変数

#### 環境変数 (シークレット)

| 変数 | 必須 | 説明 |
|---|---|---|
| `LINEAR_API_KEY` | Linear E2E のみ必須 | Linear API key |
| `GITHUB_TOKEN` | GitHub E2E のみ必須 | classic PAT (`ghp_...`、`repo` + `project` scope) |

#### `apps/e2e/config.json` (non-secret 設定)

- `linear.issueKey` / `linear.resetStateName` / `linear.workflowPath` / `linear.workspaceRoot` / `linear.timeoutSeconds` / `linear.terminalStates`
- `github.projectOwner` / `github.projectNumber` / `github.repo` / `github.issueNumber` / `github.resetStateName` / `github.statusFieldName` / `github.workflowPath` / `github.workspaceRoot` / `github.timeoutSeconds` / `github.terminalStates`

PAT / API key 以外は全部このファイルにコミットして OK。

---

## 6. E2E 実行

### 自動実行（推奨）

```bash
# 両方順番に走らせる (`test:e2e:setup` で build + install してから両 tracker)
pnpm test:e2e

# 個別実行 (事前に `pnpm build && pnpm dev:install` が必要)
pnpm test:e2e:claude-linear
pnpm test:e2e:claude-github
```

`pnpm test:e2e` は `pnpm test:e2e:setup` (build + dev:install) を実行してから両 tracker を順に走らせる。個別の `pnpm test:e2e:claude-*` スクリプトはビルド・インストール済みであることを前提とする。

各 E2E スクリプトが実行する手順:

1. env parse（シークレット env 変数を検証）
2. preflight（`ANTHROPIC_API_KEY` unset、`pnpm`/`node`/`git`/`claude-app-server` の存在確認）
3. workspace クリーンアップ（前回の残骸を削除）
4. issue を `resetStateName`（`e2e.config.json`）にリセット
5. perform を起動し、issue が terminal state に入るまで 10 秒ごとにポーリング
6. workspace 検証（`tmp/hello.js` 存在・実行・git commit 確認）
7. 成功時に workspace を削除

タイムアウトは `apps/e2e/config.json` の `timeoutSeconds`（デフォルト 5 分）。Backend (perform) のログは `apps/e2e/backend.log` に追記される。

### 手動実行

```bash
perform --no-dashboard --i-understand-that-this-will-be-running-without-the-usual-guardrails apps/perform/examples/workflow.claude-linear.md
```

実行中、perform が以下を行う:
- Linear をポーリングして対象 issue を検出
- workspace を作成（`workspace.root` 配下）
- `claude-app-server --model ... --permission-mode ...` を subprocess として起動
- JSON-RPC で会話 → Claude が編集を実行
- 完了したら subprocess を kill して workspace を解放

---

## 7. 検証ポイント

E2E 成功とみなす条件（`pnpm test:e2e` が自動チェックする項目を含む）:

### プログラム的に検証される（自動）

- [ ] **ファイル生成** — `<workspace>/tmp/hello.js` が存在
- [ ] **実行結果** — `node tmp/hello.js` が `Hello, World!` を出力（改行込み）
- [ ] **コミット済み** — `git log -- tmp/hello.js` にコミットがある
- [ ] **issue の状態遷移** — テスト issue が `Done`（`terminal_states` のいずれか）に入っている

### 目視・ログで確認

- [ ] **perform ログ** — 以下が観測できる:
  - `claude-app-server` の起動ログ
  - `initialize` / `thread/start` / `turn/start` のリクエスト/レスポンス
  - `item/agentMessage/delta` 通知
  - `turn/completed` 通知（`turn.status: "completed"`）
- [ ] **subprocess の正常終了** — perform 終了時に claude-app-server が残らない（`pgrep claude-app-server` で確認）
- [ ] **workspace のクリーンアップ** — `pnpm test:e2e` の末尾で `/tmp/studio-e2e/workspaces` が削除されている

### より本格的な検証（将来）

playwright-cli または agent-browser を使った PR 作成・GitHub 連携の E2E は Milestone 2 以降。当面は上記のローカル commit 確認のみ。

---

## 8. トラブルシューティング

### `claude-app-server: command not found`

`pnpm dev:install` を実行していない、もしくは PATH 設定が反映されていない。  
確認: `which claude-app-server`。シェルを開き直すか、PATH を export し直す。

### `~/.claude/` 認証切れ

claude-app-server 起動直後に Claude Agent SDK が認証エラー。  
対処: `claude` CLI を別プロセスで起動して再ログイン → `~/.claude/` のトークンが更新される。  
**`ANTHROPIC_API_KEY` がセットされていると API キー側で誤動作する可能性があるので unset 推奨**。

### Linear API がレート制限 / 権限不足

issue の状態を変更する際に 401/403/429。  
対処:
- `LINEAR_API_KEY` の権限を確認（少なくとも対象プロジェクトへの write）
- レート制限なら数分待って再実行

### Claude のレート制限（Pro/Max）

Pro/Max は同時実行数に厳しい。`max_concurrent_agents: 2` を超えていないか確認。  
`turn/completed.params.turn.error.codexErrorInfo: "UsageLimitExceeded"` が返ったらレート制限。

### subprocess が終了しない

claude-app-server が `turn/interrupt` に応答せず残ることがある。  
対処: `pkill -f claude-app-server`。並行して原因調査（`apps/claude-app-server/CLAUDE.md` のデバッグ手順を参照）。

### perform が issue を検出しない

- `linear.project_slug:` が Linear のプロジェクト slug と一致しているか
- issue が `active_states:` に入っているか
- `polling.interval_ms` 経過を待ったか

### 検証スクリプトが「FAIL: no workspace」と言う

- perform が起動前に異常終了した可能性。perform のログを確認
- `examples/workflow.claude-linear.md` の `workspace.root` が `/tmp/studio-e2e/workspaces` になっているか
- 前回の E2E 失敗で残った状態が干渉していないか（`rm -rf /tmp/studio-e2e/workspaces` で再実行）

### 検証スクリプトが「FAIL: tmp/hello.js was not committed」と言う

ファイルは作られたが commit されていないケース。Claude が指示を読み落としているか、`workspace.hooks.after_create` の `git config` が効いていない可能性。  
対処: workspace に入って `git status` / `git log` を確認 → ローカル変更が残っていれば commit プロンプトを強化する

---

## 9. 手動デバッグ用の最小プロトコル疎通

E2E が失敗したとき、claude-app-server が単体でプロトコルに応答できるかを切り分けるワンライナー:

```bash
echo '{"id":1,"method":"initialize","params":{"capabilities":{"experimentalApi":true},"clientInfo":{"name":"manual-test","title":"manual","version":"0.0.0"}}}' \
  | claude-app-server
```

期待: 1 行の JSON レスポンス（`{"id":1,"result":{...}}`）が返ってくる。  
返ってこなければ claude-app-server 側のバグ。返ってくれば perform との連携部分（PATH、引数渡し、stdin/stdout）の問題と切り分けできる。

`thread/start` まで確認するなら以下を続けて流す:

```bash
{
  echo '{"id":1,"method":"initialize","params":{"capabilities":{"experimentalApi":true},"clientInfo":{"name":"manual-test","title":"manual","version":"0.0.0"}}}'
  echo '{"method":"initialized","params":{}}'
  echo '{"id":2,"method":"thread/start","params":{"cwd":"/tmp","approvalPolicy":"never","sandboxPolicy":{"type":"workspaceWrite"}}}'
} | claude-app-server
```

---

## 10. 将来の自動化（CI）

Milestone 1 では手動実行で十分。CI に乗せるときに検討する事項:

- **Linear モック** — 実 Linear を叩かないようにする。`tracker.kind: linear` を mock backend に差し替えるか、フィクスチャ応答を返すローカルサーバを立てる
- **Claude モック** — Claude Agent SDK 呼び出しを subagent でモック化（あるいは記録再生）
- **`HOME` の扱い** — CI 環境では `~/.claude/` の認証情報を事前に配置する必要がある。`HOME` を書き換えるなら認証ファイルもコピーする
- **テスト用 issue の自動 reset** — テスト終了時に issue を `active_states` に戻すクリーンアップ

詳細は別途 Milestone 2 以降の課題として議論する。

---

## 11. 関連ドキュメント

- [`architecture.md`](./architecture.md): 全体設計とコンポーネント構成
- [`protocol.md`](./protocol.md): JSON-RPC サブセット仕様
- [`TODO.md`](../TODO.md): 実装タスク一覧
- ルート [`CLAUDE.md`](../CLAUDE.md): モノレポ全体の凍結事項
