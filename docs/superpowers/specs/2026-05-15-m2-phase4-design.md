# Milestone 2 Phase 4: 実機 E2E + ドキュメント整備 — 設計書

**日付:** 2026-05-15
**対象:** [`TODO.md`](../../../TODO.md) Milestone 2 Phase 4
**ステータス:** 設計確定、実装プラン待ち

---

## 背景

Milestone 2 Phase 1 ([`2026-05-14-m2-phase1-design.md`](2026-05-14-m2-phase1-design.md)) で `tracker:` ブロックを共通フィールド + per-kind block に分割。Phase 2 ([`2026-05-14-m2-phase2-design.md`](2026-05-14-m2-phase2-design.md)) で GitHub Adapter を実装。Phase 3 ([`2026-05-15-m2-phase3-design.md`](2026-05-15-m2-phase3-design.md)) で orchestrator から `doing_state` / `done_state` を発火させる自動遷移を実装。

Phase 4 は **Symphony / claude-app-server のコード変更は無し**、ドキュメント整備 + 実機 E2E + E2E 自動化スクリプトの GitHub 対応が主体。M2 を「実 GitHub Project に対して issue 1 つを Todo → In Progress → Done で処理できた」状態でクローズし、後から M3 以降に着手する際に立ち戻れる凍結記録 (ADR + milestone doc) を残す。

TODO.md M3 セクション L142「E2E 自動化（現状は手動 iex、`scripts/e2e.ts` から GitHub 経路もカバー）」は具体プランが未着手なまま M3 に積まれていた。手動セットアップ済みの GitHub Project を活用すれば Phase 4 中にカバーできるため、本 spec で取り込んでクローズする。

---

## 設計判断サマリ (clarify 結果)

| 論点 | 採択 |
|---|---|
| 作業スコープ | ドキュメント整備 + 実機 E2E を **同一セッション内で完結**。途中でバグが出たら同 branch で fix |
| backend 選択 | `examples/workflow.claude-github.md` は `agent.type: claude` + `tracker.kind: github`。codex 版は作らない |
| 既存 example のリネーム | `workflow.claude.md` → `workflow.claude-linear.md`、新規 `workflow.claude-github.md`。`<backend>-<tracker>` の一貫パターン |
| GitHub 環境 | ユーザがコンテナ外で準備済み (`babie` / Project #3、classic PAT) |
| ADR | ADR-0013 (tracker block 分割) と ADR-0014 (state transition を Symphony 集約) を **独立 1 判断ずつ**、Phase 1/3 のマージ日付で起票 |
| PR 構造 | `feat/m2-phase4` 1 本で docs → E2E → milestone close。最終 commit で milestone doc に E2E 実行ログを焼き付け |
| E2E 自動化 | TODO L142 を Phase 4 内で取り込み。`scripts/e2e.ts` → `scripts/e2e.claude-linear.ts` リネーム、新規 `scripts/e2e.claude-github.ts`、共通部分は `scripts/lib/e2e-common.ts` に抽出 |
| E2E config | `scripts/e2e.config.json` 1 ファイルに両 tracker 分を並べる。PAT / API key は env (`GITHUB_TOKEN` / `LINEAR_API_KEY`) のまま |
| `pnpm e2e` 既定動作 | `pnpm e2e:claude-linear && pnpm e2e:claude-github` を順番に実行 (`pnpm test` パターンと同じ) |

---

## 目標

Phase 4 完了条件:

1. `examples/workflow.claude-github.md` 新規作成、Phase 2 の `/tmp/workflow.github.md` をベースに Phase 3 のリネーム (`doing_state` / `done_state`) を適用
2. 既存 `examples/workflow.claude.md` を `workflow.claude-linear.md` にリネーム
3. ADR-0013 / ADR-0014 を `docs/adr/` 配下に追加、`docs/adr/README.md` の索引も更新
4. README / docs/architecture.md / docs/protocol.md / 両 CLAUDE.md / scripts/e2e.ts / docs/e2e_testing.md / apps/symphony/README.md を sweep
5. 実 GitHub Project (`babie` / Project #3) に対する手動 E2E が PASS (Todo → In Progress → Done 自動遷移、workspace に commit が残る、subprocess exit code 0)
6. `docs/milestones/02-github-tracker.md` 新規作成、E2E 実行ログを焼き付けて M2 完了マーク
7. `TODO.md` の M2 Phase 4 チェックリストを全 `[x]`、M3 派生課題を整理

明示的なスコープ外:

- **GitHub App 認証** — PAT のみ、App は M3 以降 (TODO L138)
- **`github_graphql` 動的ツール** — claude-app-server MCP は M3 以降 (TODO L139)
- **複数 repo を 1 Project に紐づける運用ノウハウ** — M3 以降 (TODO L137)
- **`linear_graphql` 動的ツールの撤去** — legacy 経路として当面残す (Phase 3 spec で同じ判断、M3 以降で議論)
- **本家 Symphony との後方互換** — `tracker.kind` 必須化は Phase 1 で破壊済み、復元しない (ADR-0007 方針)

---

## 成果物一覧

```
apps/symphony/examples/workflow.claude-github.md      # 新規
apps/symphony/examples/workflow.claude-linear.md      # リネーム (中身変更なし)

docs/adr/0013-tracker-block-split-by-kind.md          # 新規
docs/adr/0014-symphony-owned-state-transitions.md     # 新規
docs/adr/README.md                                    # 索引更新

docs/milestones/02-github-tracker.md                  # 新規 (最終 commit で完成)

scripts/e2e.claude-linear.ts                          # リネーム (内部 import 等は最小限調整)
scripts/e2e.claude-github.ts                          # 新規
scripts/lib/e2e-common.ts                             # 新規 (共通部分抽出)
scripts/e2e.config.json                               # 新規 (両 tracker の test issue 設定)
package.json                                          # e2e scripts 更新
tsdown.config.* (or build glob 設定があれば)           # 新エントリ追加 (必要なら)

README.md                                             # sweep
docs/architecture.md                                  # sweep (tracker 抽象化)
docs/protocol.md                                      # sweep (linear_graphql legacy 注記)
CLAUDE.md                                             # sweep (tracker.kind 説明補完)
apps/symphony/CLAUDE.md                               # sweep (リネーム反映)
apps/symphony/README.md                               # sweep (リネーム反映)
docs/e2e_testing.md                                   # sweep (リネーム + GitHub E2E 追記)
TODO.md                                               # Phase 4 チェック、M3 派生課題整理 (L142 削除)
```

**触らないファイル (frozen records):**

- `docs/superpowers/specs/2026-05-10-*` / `2026-05-13-*` / `2026-05-14-*` / `2026-05-15-m2-phase3-*`
- `docs/superpowers/plans/2026-05-10-*` / `2026-05-13-*` / `2026-05-14-*` / `2026-05-15-m2-phase3-*`
- `docs/milestones/01-claude-minimal.md`
- `apps/symphony/SPEC.md` (本家由来、本家追従なし方針)
- `apps/symphony/WORKFLOW.md` (本家由来、自分用は `examples/` 配下)

---

## `examples/workflow.claude-github.md` の中身

Phase 2 の検証で使った `/tmp/workflow.github.md` をベースに、Phase 3 のリネームと Linear 版の運用ノウハウを取り込む。

```yaml
---
agent:
  type: claude
  # Claude Pro/Max は同時実行数に厳しいため 2〜3 を推奨
  max_concurrent_agents: 2
  max_turns: 10

claude:
  command: claude-app-server --model claude-opus-4-7 --permission-mode bypassPermissions

tracker:
  kind: github
  active_states: [Todo, "In Progress"]
  terminal_states: [Done]
  # doing_state / done_state を設定すると Symphony が自動遷移する (ADR-0014)。
  # 未設定なら no-op (Linear の prompt 方式運用とも互換)。
  doing_state: "In Progress"
  done_state: Done

github:
  # API key は env GITHUB_TOKEN フォールバックで読まれる。
  # 注意: fine-grained PAT は user-owned ProjectV2 に未対応 (GitHub の既知の制限)。
  # classic PAT (ghp_...) を repo + project scope で発行すること。
  project_owner: babie
  project_number: 3
  # assignee: me は Project の Items に PAT 所有者が assignee として
  # 明示的にセットされている issue のみを候補に乗せる。GitHub UI で
  # 必ず assignee を立てておくこと。
  assignee: me

workspace:
  # Linear E2E (/tmp/concert-e2e/workspaces) と並走できるよう別 root に
  root: /tmp/concert-e2e-github/workspaces

hooks:
  after_create: |
    git init
    git config user.email "agent@concert.local"
    git config user.name "Concert Agent"
    echo "# Workspace" > README.md
    git add README.md
    git commit -m "Initial commit"
---

You are working on GitHub issue {{ issue.identifier }} (id: {{ issue.id }}): {{ issue.title }}.

{{ issue.description }}

Instructions:
1. Read the issue description carefully and implement what is asked in the current workspace directory.
2. Commit your changes to the workspace git repository with a descriptive message.

Note: Issue status transitions (Todo → In Progress → Done) are handled automatically by Symphony's orchestrator — you do not need to call the GitHub API. Just finish the implementation and exit cleanly.
```

### Linear 版との差分まとめ

| 項目 | `workflow.claude-linear.md` (旧 `workflow.claude.md`) | `workflow.claude-github.md` |
|---|---|---|
| `tracker.kind` | `linear` | `github` |
| tracker-specific block | `linear:` (`api_key`, `project_slug`) | `github:` (`project_owner`, `project_number`, `assignee`) |
| `doing_state` / `done_state` | (未設定。LLM が `curl issueUpdate` を叩く運用) | `"In Progress"` / `Done` (Symphony 自動遷移) |
| プロンプトの `curl` 手順 | あり | **なし** (Symphony が遷移するため) |
| workspace.root | `/tmp/concert-e2e/workspaces` | `/tmp/concert-e2e-github/workspaces` |
| PAT 制限の注記 | (Linear API key は OAuth 風、制限なし) | fine-grained PAT 非対応のコメント追加 |

### Linear 版を Symphony 自動遷移に切り替えるかどうか

スコープ外。`workflow.claude-linear.md` は **中身変更なし** でリネームのみ。Linear ユーザが `doing_state` / `done_state` を後から追加すれば opt-in できる (Phase 3 設計通り)。

---

## ADR-0013: `tracker:` ブロックを kind 別に分割する

**置き場所:** `docs/adr/0013-tracker-block-split-by-kind.md`
**ステータス:** Accepted
**決定日:** 2026-05-14 (Phase 1 main マージ日に合わせる)

### コンテキスト

- M1 までは `tracker:` 単一ブロックに `kind` と Linear 固有設定 (`api_key` / `endpoint` / `project_slug` / `assignee`) が混在
- M2 で GitHub を追加するにあたり、kind 固有フィールドが増加 (`project_owner` / `project_number` etc.)
- M1 で確立済みの `agent.type` で `claude:` / `codex:` を切り替えるパターン ([ADR-0004](0004-agent-type-backend-selection.md)) に揃えるべき
- 単一ブロックで kind 別 if/else を抱えると schema validation と error メッセージが kind 横断で絡まり、レビューしづらい

### 決定

`tracker:` ブロックは **共通フィールドのみ**:

- `kind` (`linear` / `github` / `memory`)
- `active_states` / `terminal_states`
- `doing_state` / `done_state` (Phase 3 で追加、`pickup_state` / `success_state` からリネーム)

kind 固有設定は **per-kind block** に分離:

- `linear:` — `api_key` / `endpoint` / `project_slug` / `assignee`
- `github:` — `api_key` / `endpoint` / `project_owner` / `project_number` / `assignee`
- `memory` — ブロック不要 (テスト用)

`tracker.kind` の値で読まれるブロックを切り替える (`agent.type` パターンと対称)。本家追従不要 ([ADR-0007](0007-no-upstream-tracking.md)) のため破壊的変更を許容。

### 結果

- **良い影響**:
  - `agent.type` パターンとの構造的一貫性
  - kind 追加時の影響範囲が明確 (新ブロック追加 + dispatch 拡張のみ)
  - Schema validation が kind ごとに分離されてレビューしやすい (`Github.embed` / `Linear.embed` 単位)
- **悪い影響 / トレードオフ**:
  - 既存 WORKFLOW.md (`workflow.claude.md` 等) を破壊的に sweep する必要があった (M2 Phase 1 でリネーム済み)
  - 本家 Symphony `SPEC.md` のスキーマと乖離 (本家追従なし方針なので許容)
- **影響範囲**:
  - `apps/symphony/lib/symphony_elixir/config/schema.ex` (`Tracker` embed の縮小、`Linear` / `Github` 新規 embed)
  - `apps/symphony/examples/workflow.*.md` (全 sample)
  - `apps/symphony/WORKFLOW.md`
  - `docs/architecture.md` / `docs/protocol.md` / CLAUDE.md

---

## ADR-0014: state transition を Symphony 側に集約する

**置き場所:** `docs/adr/0014-symphony-owned-state-transitions.md`
**ステータス:** Accepted
**決定日:** 2026-05-15 (Phase 3 main マージ日に合わせる)

### コンテキスト

- 本家 Symphony は backend (Codex) に `linear_graphql` 動的ツールを供給し、LLM がプロンプト指示に従って `issueUpdate` mutation を発行する設計
- GitHub 対応にあたり、backend ごとに Linear / GitHub 両 API クライアントを抱えるのは非合理:
  - `claude-app-server` 側に動的ツール (MCP) 機構が未実装
  - 各 backend に tracker クライアント実装を求めると保守コストが増える
- LLM が状態遷移を忘れる / 誤遷移するリスク
- 状態遷移ごとに LLM プロンプトに API 手順を埋め込むことで毎回トークンを消費

### 決定

WORKFLOW.md に `tracker.doing_state` / `tracker.done_state` が指定されている場合、**Symphony orchestrator が `Tracker.update_issue_state/2` で直接 mutation する**。

発火タイミング:

- **doing**: `spawn_issue_on_worker_host` で worker spawn が `{:ok, pid}` を返した直後
- **done**: `:DOWN reason == :normal` 受信 AND `last_codex_event == :turn_completed` AND refresh 後 issue が active states に居ない (三条件 AND)

mutation 失敗時は warning ログ + 継続 (3 試行までは透過的 retry)。`doing_state` / `done_state` 未設定なら完全 no-op (本家 Symphony との後方互換維持、Linear ユーザの prompt 方式運用も継続可能)。

`linear_graphql` 動的ツールは legacy 経路として当面残す (M3 以降で議論)。LLM が prompt 指示通り先に Linear API を叩いた場合も、Symphony 側は refresh で current_state を取得して idempotent no-op になる。

詳細設計: [`2026-05-15-m2-phase3-design.md`](../superpowers/specs/2026-05-15-m2-phase3-design.md)

### 結果

- **良い影響**:
  - LLM トークン削減 (状態遷移指示をプロンプトから削除可能)
  - 責務の明確化 (LLM = コード実装、Symphony = issue 操作)
  - 遷移忘れ・誤遷移リスクの排除
  - backend ごとの tracker クライアント実装が不要 (claude-app-server に MCP 動的ツールを後付けせずに GitHub 対応可能)
- **悪い影響 / トレードオフ**:
  - 「LLM が自律的に判断して状態を変える」ユースケース (例: 実装不能と判断して別ラベル付与) は backend 側で別途仕組みが必要
  - mutation 失敗時の recovery は best-effort (warning ログのみ)。起動時 sweep / polling 補正 / 失敗時コメントは M3 以降
  - `linear_graphql` 経路と Symphony 経路の二重化が当面続く (M3 で legacy 撤去判断)
- **影響範囲**:
  - `apps/symphony/lib/symphony_elixir/orchestrator.ex` (`maybe_doing_transition/1` / `handle_backend_finished/2` / `attempt_done_transition/2` / `tracker_update_with_retry/2`)
  - `apps/symphony/lib/symphony_elixir/config/schema.ex` (`Tracker` embed の `doing_state` / `done_state`)
  - `examples/workflow.claude-github.md` (Symphony 経路、curl 手順なし)
  - `docs/protocol.md` (`linear_graphql` 言及箇所に legacy 注記)
  - tracker mutation の責務に関わる将来判断

---

## `docs/milestones/02-github-tracker.md` の構造

`01-claude-minimal.md` を踏襲し、以下の骨子で書く。E2E 実行後に最終値を埋める。

```markdown
# Milestone 2: GitHub Project 対応

**ステータス:** 完了 (YYYY-MM-DD)  ← E2E PASS 日

WORKFLOW.md の `tracker.kind` で Linear / GitHub Projects (v2) を切り替えられる
状態をゴールとしたマイルストーン。実 GitHub Project (`babie/` Project #3)
を使った手動 E2E が PASS した時点で完了とした。

> 完了済みマイルストーンの記録。進行中・将来のタスクは [`TODO.md`](../../TODO.md) 参照。

## 横断する設計指針 (M2 時点での凍結事項)
- `tracker.kind` で per-kind block 切替 ([ADR-0013](../adr/0013-tracker-block-split-by-kind.md))
- state mutation は Symphony が担当 ([ADR-0014](../adr/0014-symphony-owned-state-transitions.md))
- GitHub Adapter は Linear adapter のミラー (Octokit 非依存、生 GraphQL POST)
- PAT 認証のみ (env `GITHUB_TOKEN` + `github.api_key` フォールバック)

## Phase 1: tracker スキーマの kind 別分割
**完了 (2026-05-14、merge commit ...).** spec: [`...`](../superpowers/specs/2026-05-14-m2-phase1-design.md)
(TODO.md Phase 1 チェックリストを貼る)

## Phase 2: GitHub Adapter 実装
**完了 (2026-05-14、merge commit ...).** spec: [`...`](../superpowers/specs/2026-05-14-m2-phase2-design.md)
(チェックリスト + iex 実機検証ログサマリ)

## Phase 3: Orchestrator 連携 + 自動遷移
**完了 (2026-05-15、merge commit bf2cbf7).** spec: [`...`](../superpowers/specs/2026-05-15-m2-phase3-design.md)
(チェックリスト)

## Phase 4: 実機 E2E + ドキュメント整備
**完了 (YYYY-MM-DD、merge commit ...).** spec: [`...`](../superpowers/specs/2026-05-15-m2-phase4-design.md)
- [x] `examples/workflow.claude-github.md` 整備
- [x] 既存 `workflow.claude.md` → `workflow.claude-linear.md` リネーム
- [x] `scripts/e2e.claude-github.ts` + `scripts/lib/e2e-common.ts` + `scripts/e2e.config.json` 新規
- [x] `scripts/e2e.ts` → `scripts/e2e.claude-linear.ts` リネーム + 共通部分抽出
- [x] `package.json` の `e2e:*` script 整備
- [x] ADR-0013 / ADR-0014 執筆
- [x] README.md / docs/architecture.md / docs/protocol.md / 両 CLAUDE.md / docs/e2e_testing.md sweep
- [x] 実機 E2E PASS (`pnpm e2e:claude-github`、Todo → In Progress → Done 自動遷移確認)
- [x] TODO.md の M3 派生課題反映 (L134 / L142 削除)

### 実機 E2E 実行ログ
- 対象: `<owner>/<repo>` の Project #N、issue #X (`<title>`)
- コマンド: `pnpm e2e:claude-github`
- 観測:
  - discovery query で projectId / fieldId / Todo optionId / itemId 解決
  - reset mutation で Status を Todo に
  - Symphony 起動後、Status: Todo → In Progress (Symphony が `updateProjectV2ItemFieldValue` 発火)
  - workspace `/tmp/concert-e2e-github/workspaces/<branch>` で `tmp/hello.js` 作成 + commit
  - `turn/completed` 受信後、Status: In Progress → Done (Symphony が同 mutation)
  - `verifyWorkspace` で `node tmp/hello.js` の出力確認 PASS
  - スクリプト exit code 0
- 所要時間: 約 X 分

## Milestone 2 完了条件
- [x] Phase 1〜4 完了
- [x] `mix test` 全緑 (Phase 3 時点 240+ tests, 0 failures, 2 skipped)
- [x] 実 GitHub Project で issue 処理が動く
- [x] ADR-0013 / ADR-0014 起票済み

## M3 以降に送った課題
(TODO.md M3 セクションの該当項目をリンク・整理)
```

E2E 実行後の最終 commit で「実行ログ」と日付・merge commit を確定。

---

## E2E 自動化スクリプト

### モジュール構成

```
scripts/
├── e2e.config.json              # 新規。両 tracker の test issue 設定 (PAT/API key は除く)
├── e2e.claude-linear.ts         # リネーム (旧 e2e.ts)。Linear 固有部分のみに整理
├── e2e.claude-github.ts         # 新規。GitHub Project (v2) 固有部分を実装
└── lib/
    └── e2e-common.ts            # 新規。tracker 非依存の共通部分を集約
```

### `scripts/lib/e2e-common.ts` (共通モジュール)

下記を export する。今の `scripts/e2e.ts` から「Linear に依存しない」関数・型をそのまま移す。

- `runChild` (subprocess wrapper)
- `preflight` (tool checks + ANTHROPIC_API_KEY unset)
- `cleanWorkspace` / `verifyWorkspace` (workspace root を引数化)
- `buildClaudeAppServer` / `buildSymphony` / `installClaudeAppServer`
- `spawnSymphony` / `killGracefully`
- `runChild` の戻り値型
- shared `E2EErrorBase` 型 (`'ConfigError' | 'ToolMissing' | 'BuildFailed' | 'InstallFailed' | 'SymphonySpawnFailed' | 'SymphonyExitedUnexpectedly' | 'SymphonyTimedOut' | 'VerifyFailed' | 'Interrupted'`)
- `reportCommonError` (共通バリアントの message 整形)
- `REPO_ROOT` 定数

tracker 固有のエラー (`LinearHttpError` / `LinearGraphQLError` / `LinearResponseInvalid` / `StateNotFound` / GitHub 版同等) と GraphQL クエリ・schema・polling ロジック・env parsing は各 tracker スクリプトに残す。

### `scripts/e2e.config.json` (test issue 設定)

```json
{
  "linear": {
    "issueKey": "concert-3f96fb9d18cf-XXXX-5",
    "resetStateName": "Todo",
    "workflowPath": "apps/symphony/examples/workflow.claude-linear.md",
    "workspaceRoot": "/tmp/concert-e2e/workspaces",
    "timeoutSeconds": 300
  },
  "github": {
    "projectOwner": "babie",
    "projectNumber": 3,
    "repo": "babie/<repo-name>",
    "issueNumber": 1,
    "resetStateName": "Todo",
    "statusFieldName": "Status",
    "workflowPath": "apps/symphony/examples/workflow.claude-github.md",
    "workspaceRoot": "/tmp/concert-e2e-github/workspaces",
    "timeoutSeconds": 300
  }
}
```

- 公開リポジトリにコミットして OK な値だけを置く (`linear.issueKey` は Linear UUID なので秘密値ではないが、現状 `LINEAR_API_KEY` 持っていなければ叩けない)
- PAT / API key は **必ず env**:
  - `LINEAR_API_KEY` (既存)
  - `GITHUB_TOKEN` (新規。classic PAT、`repo` + `project` scope)
- `<repo-name>` / `issueNumber` 等のプレースホルダ部分は E2E 準備時にユーザに教えてもらって埋める
- valibot schema で parse 時に validate

### `scripts/e2e.claude-linear.ts` (リネーム)

現状の `scripts/e2e.ts` から:

1. **冒頭の env schema を縮小**: `LINEAR_API_KEY` のみを env から読む。残りは `e2e.config.json` の `linear` セクションから読む
2. 共通関数を `e2e-common.ts` から import
3. Linear 固有の `linearGraphql`, `fetchIssue`, `resetIssueToTodo`, `pollIssueStatus`, `TERMINAL_STATES`, `linear*` エラー variant、`reportLinearError` を残す
4. `main()` の流れは変えない (preflight → clean → build → install → fetchIssue → reset → runSymphonyUntilTerminal → verify)

### `scripts/e2e.claude-github.ts` (新規)

Linear 版と対称構造で実装:

- env: `GITHUB_TOKEN` のみ
- config: `e2e.config.json` の `github` セクション
- GraphQL endpoint: `https://api.github.com/graphql`
- Auth: `Bearer ${GITHUB_TOKEN}` (Linear は raw token 形式と違う点に注意)
- **discovery query**: `projectOwner` + `projectNumber` から projectId / Status field id / Status options の id 一覧 / item id (issue number で照合) を取得
- **reset mutation**: `updateProjectV2ItemFieldValue` で Status を `resetStateName` (Todo) の optionId に
- **poll query**: project item の `fieldValueByName(name: "Status")` を読み、`SingleSelectValue.name` を見る
- **terminal states**: `Done` だけにする (Project の単一 Status field option として `Done` のみが該当。`Cancelled` 等は project 設定次第なので config に置く)
- workspace verify は Linear 版と同じく `tmp/hello.js` を期待 (test issue の description で同じタスクを指示)

エラー variant:

- `GitHubHttpError` (status, body)
- `GitHubGraphQLError` (errors[])
- `GitHubResponseInvalid` (issues)
- `ProjectItemNotFound` (issueNumber が project に紐づいていない場合)
- `StatusFieldNotFound` / `StatusOptionNotFound`
- 共通 variant は import で再利用

### `package.json` の scripts 更新

```json
{
  "scripts": {
    "e2e:build": "tsdown",
    "e2e:claude-linear": "pnpm e2e:build && node scripts/dist/e2e.claude-linear.mjs",
    "e2e:claude-github": "pnpm e2e:build && node scripts/dist/e2e.claude-github.mjs",
    "e2e": "pnpm e2e:claude-linear && pnpm e2e:claude-github"
  }
}
```

`tsdown` のエントリポイント設定があれば `scripts/e2e.claude-linear.ts` / `scripts/e2e.claude-github.ts` の 2 本を build する設定に更新。`scripts/lib/e2e-common.ts` は bundle されるか個別出力かは tsdown の挙動次第 (bundle 派の方が運用楽)。

### test issue の準備 (GitHub 側)

- `babie` の repo (config の `repo` で指定) に test issue 1 つ
- Project #3 に Items として追加 (assignee: `babie`)
- Status: `Todo`
- Description: 「Create a file at `tmp/hello.js` that prints `Hello, World!` when run with `node`. Commit the change.」 (Linear 版 issue と同じタスクで verify 関数を共通化できる)

`e2e.claude-github.ts` 起動時に discovery query が走り、projectId / itemId / fieldId / optionId が解決されるので、ユーザは config に owner / projectNumber / repo / issueNumber を書くだけで済む。

### Linear 側の config 移行

現状 env に `E2E_LINEAR_ISSUE_KEY` / `E2E_LINEAR_RESET_STATE` / `E2E_WORKFLOW_PATH` / `E2E_WORKSPACE_ROOT` / `E2E_TIMEOUT_SECONDS` を取っているが、Phase 4 で **non-secret な値は `e2e.config.json` の `linear` セクションに移管**。CI で env override したくなったら将来 env の方を fallback で見るようにできるが、Phase 4 では JSON 一本化を優先 (YAGNI)。

`LINEAR_API_KEY` だけは env のまま。

### 落とし穴

| # | 項目 | 対応 |
|---|---|---|
| 1 | `tsdown` が `scripts/dist/e2e.claude-linear.mjs` のような出力名を解釈できるか | tsdown のエントリポイント明示が必要なら `tsdown.config.ts` を新規追加 |
| 2 | GitHub API の rate limit (5000/h) | E2E は手動実行想定。1 回あたり discovery + reset + 数十回 poll + 数回 mutation 程度なので余裕 |
| 3 | classic PAT を使うと `Bearer` プレフィックスでなく `token` でもいけるが、新しめの GitHub API ドキュメントは `Bearer` 推奨 | `Bearer ${GITHUB_TOKEN}` で統一 |
| 4 | Project items クエリで pagination が必要なケース | 当面 `first: 100` で済ませる。100 越えのプロジェクトは想定外。仕様コメントに明記 |
| 5 | GitHub Project の `Status` field name が `Status` 以外にカスタマイズされている可能性 | `statusFieldName` を config に置いて吸収済み |
| 6 | discovery query が複雑なので最初のリクエスト失敗時のデバッグが辛い | Linear 版同様、HTTP body / GraphQL errors を error variant に詰めて報告 |
| 7 | E2E 内で Symphony が doing/done 自動遷移する → スクリプト側の "reset" が衝突しないか | reset は Symphony 起動 **前** に行うので衝突なし。Symphony 動作中の Status 変化はスクリプトの polling が読み取るだけ |

---

## Sweep の対象と変更点

### `README.md`

| 行 | 変更 |
|---|---|
| L40-44 (Milestone 1 セクション) | (変更なし、参考のため残す) |
| L46-50 (Milestone 2 セクション) | 「次の予定」→ 「完了 (YYYY-MM-DD)」、`docs/milestones/02-github-tracker.md` へのリンク追加 |
| L55-60 (必要なもの) | `GITHUB_TOKEN` (classic PAT、repo + project scope) を Linear API key と並べて追記 |
| L73 (クイックスタート 3.) | 「`apps/symphony/examples/workflow.claude.md` を参考に」→ Linear / GitHub 両 example に言及 (`workflow.claude-linear.md` / `workflow.claude-github.md`) |
| L74 | `tracker.project_slug` → `linear.project_slug` (Phase 1 で sweep 済みかも要 grep) |
| L79 | `examples/workflow.claude.md` → `examples/workflow.claude-linear.md` |
| L82 周辺 (E2E 言及) | `pnpm e2e` の説明を新スクリプト構成 (`e2e:claude-linear` / `e2e:claude-github` / `e2e` 一括) に書き換え、`scripts/e2e.config.json` への言及追加 |

### `docs/architecture.md`

| 行 | 変更 |
|---|---|
| L9 周辺 (序文) | 「Linear ボードを駆動する」→ 「Issue tracker (Linear / GitHub Projects) を駆動する」 |
| L21 (アプリ表) | 「tracker (Linear)」→ 「tracker (Linear / GitHub Projects)」 |
| L32 周辺 (構成図) | 「Linear (issue tracker)」→ 「Tracker (Linear / GitHub Projects)」 |
| L160 周辺 (linear_graphql 説明) | 「Phase 3 以降は Symphony 主導の自動遷移 (doing_state / done_state) が優先。動的ツール経路は legacy 互換」と注記。撤去はしない |

### `docs/protocol.md`

L302 / L391 / L397 / L540 / L543 の `linear_graphql` 言及箇所に legacy 注記:

> 注意: M2 Phase 3 以降、Symphony は `tracker.doing_state` / `tracker.done_state` 設定時に直接 mutation する (ADR-0014)。動的ツール経路は本家 Symphony 互換のための legacy として残しているが、新規 backend (claude-app-server) は実装していない。

### `CLAUDE.md` (root)

`## 両アプリにまたがる仕様（凍結事項）` セクションの `WORKFLOW.md スキーマ` 配下に:

- `tracker.kind` で `linear` / `github` per-kind block を切り替える説明 ([ADR-0013](docs/adr/0013-tracker-block-split-by-kind.md))
- `doing_state` / `done_state` 設定時に Symphony が自動遷移する説明 ([ADR-0014](docs/adr/0014-symphony-owned-state-transitions.md))

(既に部分的に書かれているかは実装時に grep して補完)

### `apps/symphony/CLAUDE.md`

`workflow.claude.md` 参照 (L96, L130, L162, L203, L227) を `workflow.claude-linear.md` に置換。`tracker.kind と per-kind ブロック` セクション (L21〜) は GitHub adapter 実装済みを反映 ("adapter 実装は Milestone 2 Phase 2 で対応" → "実装済み、`Github.Adapter`")。

### `apps/symphony/README.md`

L167 の `workflow.claude.md` → `workflow.claude-linear.md`。GitHub 版もある旨を追記。

### `scripts/e2e.ts` (リネーム + 抽出)

上記「E2E 自動化スクリプト」セクション参照。

### `docs/e2e_testing.md`

- L3 / L44 / L122 / L128 / L163 / L197 / L275 の `workflow.claude.md` → `workflow.claude-linear.md`
- env 一覧 (L163 周辺) を `e2e.config.json` ベースに書き換え、PAT/API key だけが env のままである旨を明記
- `pnpm e2e:claude-linear` / `pnpm e2e:claude-github` / `pnpm e2e` の使い分けを追記
- GitHub 経路の事前準備 (PAT scope、Project Items に assignee セット、Status option) も簡潔に追記

### `TODO.md`

- Phase 4 チェックリスト (L61〜) を全 `[x]`
- 「Milestone 2 完了 (YYYY-MM-DD)、`docs/milestones/02-github-tracker.md` 参照」を Milestone 2 セクション末尾に
- 「GitHub Adapter 派生課題」セクション (L132〜L142) のうち:
  - L134 (fine-grained PAT 制限のドキュメント化) → Phase 4 で対応済みなので削除
  - L142 (E2E 自動化) → Phase 4 で対応済みなので削除
  - 残りは「Milestone 3 以降」セクションに昇格 or リンク統合

### `docs/adr/README.md`

索引に 2 行追加:

```
| [ADR-0013](0013-tracker-block-split-by-kind.md) | `tracker:` ブロックを kind 別に分割する | Accepted |
| [ADR-0014](0014-symphony-owned-state-transitions.md) | state transition を Symphony 側に集約する | Accepted |
```

### 触らないファイル (frozen records)

- `docs/superpowers/specs/2026-05-10-*` 〜 `2026-05-15-m2-phase3-*`
- `docs/superpowers/plans/2026-05-10-*` 〜 `2026-05-15-m2-phase3-*`
- `docs/milestones/01-claude-minimal.md`
- `apps/symphony/SPEC.md` (本家由来)
- `apps/symphony/WORKFLOW.md` (本家由来)

これら frozen records 内に `pickup_state` / `success_state` や旧 `workflow.claude.md` が残るのは想定通り。

---

## 実機 E2E 手順

E2E は **`scripts/e2e.claude-github.ts` 経由の自動実行**を主、ユーザ手動 `./bin/symphony` 実行を副とする。`pnpm e2e` で両 tracker 通すのが最終的な PASS 条件。

### 事前準備 (ユーザ手動、コンテナ外で完了済み)

1. classic PAT (`ghp_...`) を `repo` + `project` scope で発行、コンテナ環境変数 `GITHUB_TOKEN` にセット
2. GitHub Project #3 に test issue 1 つ作成
   - Status: `Todo`
   - Assignee: PAT 所有者 (`babie`)
   - Title: `Phase 4 E2E test` 程度
   - Description: 「Create a file at `tmp/hello.js` that prints `Hello, World!` when run with `node`. Commit the change.」(Linear 版と同じタスク、verify ロジックを共通化)
3. Project の Status field option (`Todo` / `In Progress` / `Done`) が存在することを確認

ユーザは config に書く値 (owner / projectNumber / repo / issueNumber) を私に共有する。

### `scripts/e2e.config.json` 確定後の自動実行

```bash
# 1. ビルド + claude-app-server を PATH に通す (e2e:build が build:claude-app-server を含む構成にする)
pnpm build
pnpm dev:install

# 2. GitHub E2E
pnpm e2e:claude-github

# 3. Linear E2E (回帰確認、設定がもし残っていれば)
pnpm e2e:claude-linear

# あるいは両方:
pnpm e2e
```

### 観測ポイント (GitHub E2E)

`pnpm e2e:claude-github` 内部で自動チェックされる項目:

| # | 期待挙動 | 検出方法 |
|---|---|---|
| 1 | discovery query で projectId / fieldId / Todo optionId / itemId が解決 | スクリプト stderr に解決結果ログ、失敗時 `ProjectItemNotFound` 等のエラー |
| 2 | reset mutation で Status を Todo に戻せる | `updateProjectV2ItemFieldValue` の success レスポンス |
| 3 | Symphony 起動、`Github.ProjectMeta.warmup!` PASS | symphony ログ (`scripts/e2e.symphony.log`) で確認 |
| 4 | worker spawn 直後、Status: Todo → In Progress | polling で観測 (スクリプト stdout) |
| 5 | turn/completed 受信、subprocess 正常終了 | symphony ログ |
| 6 | Status: In Progress → Done | polling で terminal 検出 → スクリプトが `verifyWorkspace` 走らせて PASS / FAIL を決定 |
| 7 | workspace `/tmp/concert-e2e-github/workspaces/<branch>` に `tmp/hello.js` が存在 + commit | `verifyWorkspace` (共通化済み) |
| 8 | スクリプト exit code 0 | 全 verify PASS |

### 不具合発生時

同 branch `feat/m2-phase4` で fix → 再実行。最終的に PASS したスクリプト stdout / symphony ログ抜粋を `docs/milestones/02-github-tracker.md` の「実機 E2E 実行ログ」セクションに転記して milestone close。

途中で大規模 fix が必要になったら、Phase 4 と分離せず同 branch / 同 PR にまとめる (1 本 branch 方針)。

---

## 作業順序

最終 PR の commit 列はおおよそ:

1. `chore(repo): rename workflow.claude.md to workflow.claude-linear.md and sweep refs`
2. `feat(symphony): add workflow.claude-github.md example`
3. `refactor(scripts): extract e2e common module and rename e2e.ts -> e2e.claude-linear.ts`
4. `feat(scripts): add e2e.claude-github.ts for GitHub Project automated E2E`
5. `chore(scripts): introduce e2e.config.json and migrate Linear non-secret env`
6. `docs(adr): add ADR-0013 tracker block split by kind`
7. `docs(adr): add ADR-0014 Symphony-owned state transitions`
8. `docs: sweep README / architecture / protocol / CLAUDE.md for GitHub support`
9. `docs(e2e): document GitHub E2E preparation and new pnpm e2e scripts`
10. `docs(milestones): create 02-github-tracker.md scaffolding`
11. `chore(repo): update TODO.md for Phase 4 completion and M3 follow-ups`
12. (実機 E2E 実行: `pnpm e2e` で両 tracker PASS)
13. `docs(milestones): record M2 Phase 4 E2E results and close milestone`

途中で bug fix が入ったら順序の間に挿入。実装プラン (writing-plans skill) で詳細化する。

---

## 完了条件 (チェックリスト)

- [ ] `examples/workflow.claude-github.md` 新規作成、Phase 3 リネーム反映
- [ ] `examples/workflow.claude.md` → `workflow.claude-linear.md` リネーム (中身変更なし)
- [ ] live docs 内の `workflow.claude.md` 参照を sweep (README / e2e_testing.md / apps/symphony/CLAUDE.md / apps/symphony/README.md / package.json / e2e config)
- [ ] frozen records (specs/ / plans/ / milestones/01) は **触っていない**
- [ ] `scripts/lib/e2e-common.ts` 抽出、`scripts/e2e.ts` → `scripts/e2e.claude-linear.ts` リネーム
- [ ] `scripts/e2e.claude-github.ts` 新規、discovery / reset / poll / verify 実装
- [ ] `scripts/e2e.config.json` 新規、両 tracker 設定
- [ ] `package.json` scripts: `e2e:claude-linear` / `e2e:claude-github` / `e2e` (両方順番)
- [ ] tsdown ビルド設定が両エントリポイントを出す
- [ ] ADR-0013 / ADR-0014 を `docs/adr/` 配下に追加、`docs/adr/README.md` 索引も更新
- [ ] `docs/architecture.md` / `docs/protocol.md` / `CLAUDE.md` / `apps/symphony/CLAUDE.md` の GitHub 関連 sweep
- [ ] `docs/e2e_testing.md` sweep (リネーム + GitHub E2E 追記 + config.json 説明)
- [ ] `docs/milestones/02-github-tracker.md` 新規作成 (E2E 前は実行ログをプレースホルダ)
- [ ] 実機 E2E PASS (`pnpm e2e:claude-github` で exit 0)、ログを milestone doc に焼き付け
- [ ] (任意) `pnpm e2e:claude-linear` でも回帰 PASS
- [ ] `TODO.md` の Phase 4 チェックリスト全 `[x]`、M3 派生課題反映 (L134 / L142 削除)
- [ ] `mix test` 緑のまま (Symphony / claude-app-server のコード変更はない、念のため)
- [ ] 最終 PR のレビュー可能な状態 (commit 列が論理的に並んでいる)

---

## 不確実性 / 実装時に確認する点

| # | 項目 | 対応 |
|---|---|---|
| 1 | classic PAT を `GITHUB_TOKEN` env としてコンテナに渡す方法 | ユーザに確認 (DevContainer の env 設定 or `direnv` or `.env.local`) |
| 2 | `github.api_key` を WORKFLOW.md に書くか env だけにするか | Phase 2 example では未指定で env フォールバック前提だった。実装時に挙動確認 |
| 3 | `workflow.claude.md` を参照する frozen plan/spec 内で「リンク切れ」を起こすか | リンク切れは frozen records 内なので無害だが、検証で grep する |
| 4 | E2E で workspace 作成時の hooks.after_create が走らないケース | Phase 2 で iex 検証済みだが、`./bin/symphony` 経由は未検証。観測 |
| 5 | `Github.ProjectMeta.warmup!` が `doing_state` / `done_state` の存在を検証する | Phase 2 / Phase 3 で実装済み、warmup PASS を確認するだけ |
| 6 | issue の description 中の改行を Symphony がどう扱うか | Linear E2E で確認済みのはず、念のため簡単なタスクで E2E |
| 7 | E2E 中に LLM が `Note: Issue status transitions...` を読まずに GitHub API を叩こうとした場合 | claude-app-server には `gh` CLI / GitHub API ツールがそもそも有効化されていないので空振り。観測のみ |
| 8 | merge commit のハッシュは Phase 完了後にしか決まらない | milestone doc は最終 commit で確定値を埋める (Phase 3 と同じ運用) |
| 9 | `tsdown` のエントリポイント追加方法 (config なし運用 or `tsdown.config.ts` 必要) | 実装時に `pnpm tsdown --help` / 既存設定確認。最小コストで両エントリ出すよう調整 |
| 10 | GitHub Project の `Status` field option として `Todo` / `In Progress` / `Done` が **その順番で** 存在することを config 側で前提にしてよいか | config に `resetStateName` (例: `Todo`) と terminal 判定セット (例: `["Done"]`) を持たせ、option 名は env / config 側で吸収。実装時にユーザの Project 設定で実値確認 |
| 11 | E2E スクリプトが Symphony 終了後に **Status の最終値**を読み取って verify するタイミング | polling で `Done` 検出 → Symphony kill → workspace verify の順。`Done` 検出前に kill すると false negative になるので注意 |
| 12 | `LINEAR_API_KEY` を要求する `e2e.claude-linear.ts` を **`pnpm e2e` から強制起動** する設計だと、GitHub だけ走らせたい人が困らないか | `pnpm e2e:claude-github` 単体で走るので回避可能。README / e2e_testing.md でその旨を明記 |

---

## 参考

- [`TODO.md`](../../../TODO.md) Milestone 2 Phase 4
- [`2026-05-14-m2-phase1-design.md`](2026-05-14-m2-phase1-design.md) — Phase 1 schema 分割
- [`2026-05-14-m2-phase2-design.md`](2026-05-14-m2-phase2-design.md) — Phase 2 GitHub Adapter
- [`2026-05-15-m2-phase3-design.md`](2026-05-15-m2-phase3-design.md) — Phase 3 auto-transition
- [`docs/milestones/01-claude-minimal.md`](../../milestones/01-claude-minimal.md) — Milestone 1 完了記録 (形式参考)
- [ADR-0012](../../adr/0012-adr-format.md) — ADR 形式
- [`/tmp/workflow.github.md`](/tmp/workflow.github.md) — Phase 2 で使った GitHub workflow ファイル
