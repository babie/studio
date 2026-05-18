# Milestone 2 Phase 2: GitHub Adapter 実装 — 設計書

**日付:** 2026-05-14
**対象:** [`TODO.md`](../../../TODO.md) Milestone 2 Phase 2
**ステータス:** 設計確定、実装プラン待ち

---

## 背景

Milestone 2 Phase 1 ([`2026-05-14-m2-phase1-design.md`](2026-05-14-m2-phase1-design.md)) で `tracker:` ブロックを kind 共通フィールドのみに縮小し、`linear:` / `github:` 別ブロックを宣言した。Phase 2 では実体である **GitHub Adapter** を実装し、`tracker.kind: github` で実際の Project に対する読み書きが動くところまでを担当する。

M2 全体の Phase 構成と設計指針は [`TODO.md`](../../../TODO.md) Milestone 2 セクションを参照。Phase 3 (orchestrator 連携 + 自動遷移) と Phase 4 (実機 E2E + ドキュメント整備) は本 spec のスコープ外。

---

## 目標

Phase 2 完了条件:

1. `tracker.kind: github` を選んだ Symphony が、設定された GitHub ProjectV2 に対して以下を行える:
   - 候補 issue の取得 (`Tracker.fetch_candidate_issues/0`)
   - 状態指定の issue 取得 (`Tracker.fetch_issues_by_states/1`)
   - id 指定の最新状態再取得 (`Tracker.fetch_issue_states_by_ids/1`)
   - issue へのコメント投稿 (`Tracker.create_comment/2`)
   - issue の Status field 更新 (`Tracker.update_issue_state/2`)
2. 起動時に Status field の存在と `active_states` / `terminal_states` / `doing_state` / `done_state` の名前が ProjectV2 の Status options に実在することを **fail-fast** で検証する
3. Linear adapter の挙動は変えない (既存テスト全緑)
4. 設定で参照される ID 類 (Project node id / Status field id / option id / viewer login) は **`:persistent_term` に Symphony 起動中ずっとキャッシュ**
5. iex で 5 callback すべてが実機 GitHub Project に対して動く

明示的なスコープ外:

- 自動状態遷移 (`maybe_pickup_transition` / `maybe_success_transition`) — Phase 3
- `examples/workflow.github.md` の整備 — Phase 4
- ADR-0013 / ADR-0014 執筆 — Phase 4
- 実機 E2E スクリプト化 — Phase 4
- 複数 repo 横断の運用ノウハウ — M3 以降 (コードは Project 全体取得で対応済み、当面は 1 repo 前提で運用)
- GitHub App 認証 — M3 以降 (PAT のみ)
- `priority` フィールドの project field 経由マッピング — M3 以降
- `blocked_by` の Issue Dependencies (beta) 対応 — M3 以降

---

## 全体アーキテクチャ

```
lib/symphony_elixir/
├── tracker.ex                       # adapter dispatch に "github" 追加
├── tracker/
│   ├── memory.ex                    # Linear.Issue → Tracker.Issue 参照に書き換え
│   └── issue.ex                     # ★新設: Tracker.Issue 構造体
├── linear/
│   ├── adapter.ex                   # 返り値型を Tracker.Issue に
│   ├── client.ex                    # normalize 出力を Tracker.Issue に
│   └── issue.ex                     # 削除 (tracker/issue.ex に移動)
└── github/                          # ★新設
    ├── adapter.ex                   # Tracker behaviour 実装 (5 callback)
    ├── client.ex                    # 生 GraphQL POST、Req ベース、Req.Test 対応
    ├── queries.ex                   # クエリ/mutation 文字列をモジュール属性で集約
    ├── issue.ex                     # ProjectV2Item → Tracker.Issue normalize の純関数
    └── project_meta.ex              # Project/Status の ID を :persistent_term にキャッシュ
```

### 各モジュールの責務

- **`Github.Adapter`** — Tracker callback の窓口。`Application.get_env(:symphony_elixir, :github_client_module, Client)` で client を差し替え可能 (テスト用)
- **`Github.Client`** — GraphQL を `graphql/2` 1 メソッドで受ける。HTTP は `Req` 経由、テストは `Req.Test.stub` で乗っ取り
- **`Github.Queries`** — クエリ・mutation 文字列をモジュール属性で集約 (`Linear.Adapter` / `Linear.Client` の慣用と同じスタイル)
- **`Github.Issue`** — 1 ProjectV2Item ノード JSON を `%Tracker.Issue{source: :github, extra: %Github.IssueExtra{...}}` に変換する純関数
- **`Github.ProjectMeta`** — 起動時 1 回 GraphQL を投げ、Project node id / Status field id / option name→id / viewer login を取得し `:persistent_term` に保存。fail-fast validation もここで行う

---

## Tracker.Issue 型 (`lib/symphony_elixir/tracker/issue.ex`)

`Linear.Issue` を移動・改名し、source / extra を追加する。

```elixir
defmodule SymphonyElixir.Tracker.Issue do
  @moduledoc "Normalized issue representation used by orchestrator."

  defstruct [
    :id,
    :identifier,
    :title,
    :description,
    :priority,
    :state,
    :branch_name,
    :url,
    :assignee_id,
    source: :linear,
    extra: nil,
    blocked_by: [],
    labels: [],
    assigned_to_worker: true,
    created_at: nil,
    updated_at: nil
  ]

  @type source :: :linear | :github
  @type extra :: nil | SymphonyElixir.Github.IssueExtra.t()

  @type t :: %__MODULE__{
          id: String.t() | nil,
          identifier: String.t() | nil,
          title: String.t() | nil,
          description: String.t() | nil,
          priority: integer() | nil,
          state: String.t() | nil,
          branch_name: String.t() | nil,
          url: String.t() | nil,
          assignee_id: String.t() | nil,
          source: source(),
          extra: extra(),
          blocked_by: [map()],
          labels: [String.t()],
          assigned_to_worker: boolean(),
          created_at: DateTime.t() | nil,
          updated_at: DateTime.t() | nil
        }
end

defmodule SymphonyElixir.Github.IssueExtra do
  @enforce_keys [:project_id, :project_item_id]
  defstruct [:project_id, :project_item_id]

  @type t :: %__MODULE__{
          project_id: String.t(),
          project_item_id: String.t()
        }
end
```

### 各 adapter での値の詰め方

| field | Linear | GitHub |
|---|---|---|
| `id` | Linear issue.id | **GitHub Issue node id** (`I_kw...`) — `addComment` の subjectId に使う |
| `identifier` | `CYFY-5` | `owner/repo#123` |
| `title` | issue.title | issue.title |
| `description` | issue.description | issue.body |
| `state` | state.name | Status field の option name |
| `branch_name` | `issue.branchName` | 自前生成 (下記) |
| `url` | issue.url | issue.url |
| `assignee_id` | assignee.id | assignee.login (username) |
| `priority` | 0-4 integer | `nil` (M3 以降で対応) |
| `blocked_by` | `inverseRelations` から抽出 | `[]` 固定 (M3 以降で対応) |
| `labels` | labels.nodes[].name | labels.nodes[].name |
| `created_at` / `updated_at` | createdAt / updatedAt | createdAt / updatedAt |
| `source` | `:linear` | `:github` |
| `extra` | `nil` | `%Github.IssueExtra{project_id, project_item_id}` |

### branch_name 自動生成 (GitHub)

orchestrator / AgentRunner / workspace は branch_name を git ブランチ名と workspace ディレクトリ名にそのまま使う。Linear の `branchName` (例: `babie/sym-5-issue-title-slug`) と同じ思想で **user prefix + 識別子 + slug** の形式に揃える。

ルール:
```
{viewer_login}/{repo}-{number}-{slugified-title}
```

- `viewer_login` は `Github.ProjectMeta` が起動時に取得した PAT 所有者の username
- `{repo}` は `repository.nameWithOwner` から `owner/` を落とした側 (例: `concert`)
- `{slugified-title}` は下記の slug 化ルールで生成

slug 化:
```elixir
defp slugify(title) when is_binary(title) do
  title
  |> String.downcase()
  |> String.replace(~r/[^a-z0-9]+/u, "-")
  |> String.trim("-")
  |> String.slice(0, 50)
  |> String.trim("-")
end
```

slug が空文字になる (全角タイトル等) 場合は suffix を省略して `{viewer_login}/{repo}-{number}` とする。

---

## GraphQL クエリ・mutation (`lib/symphony_elixir/github/queries.ex`)

### A. ProjectMeta 取得 (起動時 1 回)

ProjectV2 が user に紐づくか org に紐づくか不明なので、まず `user` で試し、結果が nil なら `organization` で再試行する。

```graphql
query SymphonyGithubProjectMeta($owner: String!, $number: Int!) {
  user(login: $owner) {
    projectV2(number: $number) {
      id
      title
      fields(first: 50) {
        nodes {
          __typename
          ... on ProjectV2SingleSelectField {
            id
            name
            options { id name }
          }
        }
      }
    }
  }
}
```

- 取得結果から `name == "Status"` の SingleSelectField を探す
- 見つからなければ `Github.ProjectMeta.warmup!/0` が raise → 起動失敗
- option name→id を `:persistent_term` に保存
- `active_states` / `terminal_states` / `doing_state` / `done_state` の名前がすべて options に存在することを照合、欠けていれば fail-fast

### B. Candidate issue ポーリング (`fetch_candidate_issues/0`)

ProjectV2 は「Status == X の item だけ」を GraphQL フィルタで取れないため **全件取って client 側で絞る**。

```graphql
query SymphonyGithubPollItems($projectId: ID!, $first: Int!, $after: String) {
  node(id: $projectId) {
    ... on ProjectV2 {
      items(first: $first, after: $after) {
        nodes {
          id                       # ProjectV2Item id (= extra.project_item_id)
          content {
            __typename
            ... on Issue {
              id                   # Issue node id (= Tracker.Issue.id)
              number
              title
              body
              url
              repository { nameWithOwner }
              assignees(first: 10) { nodes { login } }
              labels(first: 20) { nodes { name } }
              createdAt
              updatedAt
            }
          }
          fieldValues(first: 20) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue {
                field { ... on ProjectV2SingleSelectField { name } }
                name
                optionId
              }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}
```

クライアント側で:
- `content.__typename == "Issue"` のみ採用 (PR/DraftIssue 除外)
- `fieldValues` から Status の `name` を取って `Tracker.Issue.state` に入れる
- `active_states` に含まれる state のみ残す
- `assignee` 設定があれば `assignees.nodes[].login` に含まれるかでフィルタ

### C. ID 指定の状態再取得 (`fetch_issue_states_by_ids/1`)

```graphql
query SymphonyGithubIssuesById($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Issue {
      id
      number
      title
      body
      url
      repository { nameWithOwner }
      projectItems(first: 10) {
        nodes {
          id
          project { id }
          fieldValues(first: 20) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue {
                field { ... on ProjectV2SingleSelectField { name } }
                name
                optionId
              }
            }
          }
        }
      }
      assignees(first: 10) { nodes { login } }
      labels(first: 20) { nodes { name } }
      createdAt
      updatedAt
    }
  }
}
```

- `projectItems.nodes` の中で `project.id == ProjectMeta.fetch!().project_id` に一致する ProjectV2Item を採用
- Status を `fieldValues` から抽出

### D. Comment 投稿 (`create_comment/2`)

```graphql
mutation SymphonyGithubAddComment($subjectId: ID!, $body: String!) {
  addComment(input: {subjectId: $subjectId, body: $body}) {
    clientMutationId
  }
}
```

- `subjectId` = `Tracker.Issue.id` (Issue node id)

### E. Status 更新 (`update_issue_state/2`)

```graphql
mutation SymphonyGithubUpdateItemStatus(
  $projectId: ID!,
  $itemId: ID!,
  $fieldId: ID!,
  $optionId: String!
) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $projectId,
    itemId: $itemId,
    fieldId: $fieldId,
    value: { singleSelectOptionId: $optionId }
  }) {
    clientMutationId
  }
}
```

- `projectId` / `fieldId` / `optionId` は `Github.ProjectMeta` キャッシュから引く
- `itemId` は `issue.extra.project_item_id` から取る

### F. Viewer 解決 (assignee: "me" / branch_name 用)

```graphql
query SymphonyGithubViewer { viewer { login } }
```

- 起動時に `Github.ProjectMeta` が 1 回引き、結果を ProjectMeta 構造体に保持
- assignee 設定が空でも viewer_login は branch_name 生成に必須

---

## Github.ProjectMeta: キャッシュと fail-fast

### 構造体

```elixir
defmodule SymphonyElixir.Github.ProjectMeta do
  defstruct [
    :project_id,           # ProjectV2 node id
    :status_field_id,      # Status SingleSelectField id
    :status_options,       # %{"Todo" => "f75ad846", ...} (name → optionId)
    :viewer_login          # PAT 所有者の username
  ]
end
```

`:persistent_term` のキーは `{SymphonyElixir.Github.ProjectMeta, :meta}` 一本。

### ライフサイクル

```
Symphony 起動
  ↓
Config.settings!() で WORKFLOW.md ロード
  ↓
settings.tracker.kind == "github" ?
  ├─ no  → ProjectMeta スキップ
  └─ yes → Github.ProjectMeta.warmup!/0
              ├─ A: GraphQL で project / fields / viewer 取得
              ├─ B: Status field 存在チェック
              ├─ C: active/terminal/pickup/success 全名が options に実在するか照合
              └─ OK → :persistent_term.put、起動継続
                 失敗 → raise → Application.start エラーで Symphony 終了
```

### 起動フックの組み込み位置

```elixir
# lib/symphony_elixir/application.ex (既存)
def start(_type, _args) do
  :ok = SymphonyElixir.Github.ProjectMeta.maybe_warmup!()
  Supervisor.start_link(children, opts)
end
```

`maybe_warmup!/0` が `Config.settings!().tracker.kind` を見て自分で no-op or warmup を判定。warmup 内で raise すれば Application.start が `{:error, ...}` を返し Symphony は起動失敗する。

### fail-fast エラー

| 条件 | エラー |
|---|---|
| ProjectV2 取得失敗 (user/org どちらも nil) | `GitHub project not found: owner=babie, number=5` |
| `name == "Status"` の SingleSelectField 無し | `GitHub project has no Status SingleSelect field` |
| `active_states` のうち option に無い名前 | `Unknown Status option(s) in active_states: ["Triage"]. Available: [...]` |
| `terminal_states` / `doing_state` / `done_state` の不一致 | 同形式で個別エラー |
| `assignee: "me"` 設定で viewer query が空 | `Failed to resolve viewer login` |
| GraphQL ネットワーク失敗 | Req のエラーを含めて raise |

### キャッシュ読み出し API

```elixir
@spec fetch!() :: %__MODULE__{}
def fetch! do
  case Application.get_env(:symphony_elixir, :github_project_meta) do
    %__MODULE__{} = injected -> injected   # テスト用注入を優先
    _ ->
      try do
        :persistent_term.get({__MODULE__, :meta})
      rescue
        ArgumentError ->
          raise "Github.ProjectMeta not warmed up. Is tracker.kind == github?"
      end
  end
end

@spec option_id!(String.t()) :: String.t()
def option_id!(state_name) do
  case fetch!().status_options[state_name] do
    nil -> raise "Unknown Status option: #{inspect(state_name)}"
    id -> id
  end
end
```

起動時に validation 済みなので、本来 `option_id!` が raise することは想定外 (防御線)。

---

## Tracker behaviour と dispatch の変更

### dispatch (`lib/symphony_elixir/tracker.ex`)

```elixir
@spec adapter() :: module()
def adapter do
  case Config.settings!().tracker.kind do
    "memory" -> SymphonyElixir.Tracker.Memory
    "github" -> SymphonyElixir.Github.Adapter
    _ -> SymphonyElixir.Linear.Adapter
  end
end
```

### behaviour の `update_issue_state` シグネチャ変更

GitHub では Status 更新に `project_item_id` (Issue node id とは別) が必要なため、callback の第 1 引数を `String.t()` (issue id) から `Tracker.Issue.t()` に変更する。Linear adapter / orchestrator も追従する。

```elixir
# 変更前
@callback update_issue_state(String.t(), String.t()) :: :ok | {:error, term()}
# 変更後
@callback update_issue_state(Tracker.Issue.t(), String.t()) :: :ok | {:error, term()}
```

Linear adapter 側の修正は `def update_issue_state(%Tracker.Issue{id: id}, state) ...` で受ける 1 箇所のみ。orchestrator の呼び出し側も Issue 構造体を渡すよう 1 行修正。

---

## Github.Adapter callback 概略

```elixir
defmodule SymphonyElixir.Github.Adapter do
  @behaviour SymphonyElixir.Tracker

  alias SymphonyElixir.{Config, Tracker.Issue}
  alias SymphonyElixir.Github.{Client, ProjectMeta, Queries}
  alias SymphonyElixir.Github.Issue, as: GithubIssue

  # 1. fetch_candidate_issues
  @impl true
  def fetch_candidate_issues do
    %ProjectMeta{project_id: project_id} = ProjectMeta.fetch!()
    active = Config.settings!().tracker.active_states

    with {:ok, raw_items} <- paginate_items(project_id),
         issues = Enum.map(raw_items, &GithubIssue.normalize_item/1) |> Enum.reject(&is_nil/1),
         filtered = filter_issues(issues, active, assignee_filter()) do
      {:ok, filtered}
    end
  end

  # 2. fetch_issues_by_states
  @impl true
  def fetch_issues_by_states(state_names) do
    # candidate と同じだが active_states ではなく引数で絞る。assignee フィルタは外す。
  end

  # 3. fetch_issue_states_by_ids
  @impl true
  def fetch_issue_states_by_ids(issue_node_ids) do
    # Queries.issues_by_ids() で取得し、projectItems から自プロジェクトの ProjectV2Item を選んで normalize。
  end

  # 4. create_comment
  @impl true
  def create_comment(issue_id, body) do
    case Client.graphql(Queries.add_comment(), %{subjectId: issue_id, body: body}) do
      {:ok, %{"data" => %{"addComment" => %{"clientMutationId" => _}}}} -> :ok
      {:ok, %{"errors" => errors}} -> {:error, {:github_graphql_errors, errors}}
      {:error, reason} -> {:error, reason}
    end
  end

  # 5. update_issue_state (新シグネチャ)
  @impl true
  def update_issue_state(%Issue{extra: %{project_item_id: item_id}}, state_name) do
    meta = ProjectMeta.fetch!()
    option_id = ProjectMeta.option_id!(state_name)
    vars = %{
      projectId: meta.project_id,
      itemId: item_id,
      fieldId: meta.status_field_id,
      optionId: option_id
    }

    case Client.graphql(Queries.update_item_status(), vars) do
      {:ok, %{"data" => %{"updateProjectV2ItemFieldValue" => _}}} -> :ok
      {:ok, %{"errors" => errors}} -> {:error, {:github_graphql_errors, errors}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp assignee_filter do
    case Config.settings!().github.assignee do
      nil -> nil
      "me" -> ProjectMeta.fetch!().viewer_login
      login when is_binary(login) -> login
    end
  end

  defp matches_assignee?(_assignees, nil), do: true
  defp matches_assignee?(assignees, login),
    do: Enum.any?(assignees, fn %{"login" => l} -> l == login end)
end
```

---

## テスト戦略

### Req.Test セットアップ

```elixir
# test/test_helper.exs (既存ファイルに追記)
Application.put_env(:req, :default_options, plug: {Req.Test, SymphonyElixir.Github.Client})
```

`Github.Client.graphql/2` は `Req.post(endpoint, plug: {Req.Test, __MODULE__}, ...)` を渡す。テストは `Req.Test.stub(SymphonyElixir.Github.Client, fn conn -> ... end)` で振る舞いを差し替える。

### テスト分担

| ファイル | 検証内容 |
|---|---|
| `test/symphony_elixir/github/client_test.exs` | `graphql/2` が `Authorization: Bearer ...` ヘッダ / JSON body を組み立てるか。404 / 500 / `errors` 入りレスポンスでエラー型を返すか |
| `test/symphony_elixir/github/issue_test.exs` | `normalize_item/1` 純関数: JSON → `%Tracker.Issue{source: :github, extra: %Github.IssueExtra{...}}` 各フィールド組み立て、Issue/PR 判別、Status 抽出、空タイトルの slug fallback |
| `test/symphony_elixir/github/project_meta_test.exs` | warmup 成功時に `:persistent_term` に書かれること。Status field 不在 / `doing_state` 名前不一致 / network 失敗で raise すること |
| `test/symphony_elixir/github/adapter_test.exs` | 5 callback。Req.Test で GraphQL の **variables** までアサート (特に `update_issue_state` で itemId/optionId が ProjectMeta 経由で正しく解決されている) |
| `test/symphony_elixir/tracker_test.exs` | `Tracker.adapter/0` が `"github"` で `Github.Adapter` を返すこと |

### 既存テストへの影響

- `Linear.Issue` 参照を `Tracker.Issue` に置換 (sed で機械的)
- Linear adapter の normalize 出力が `source: :linear, extra: nil` を含むようテストを更新
- それ以外の挙動は不変、既存テスト群が緑のまま通ること

---

## iex 動作確認手順 (Phase 2 完了確認)

```bash
cd apps/symphony
export GITHUB_TOKEN=...                       # 適切なスコープの PAT
iex -S mix
```

```elixir
# WORKFLOW.md ロード (Phase 2 段階では手書き最小の WORKFLOW.md でも可)
SymphonyElixir.Config.load!("path/to/workflow.github.md")

# ProjectMeta warmup 結果
SymphonyElixir.Github.ProjectMeta.fetch!()
# %SymphonyElixir.Github.ProjectMeta{
#   project_id: "PVT_kwDO...",
#   status_field_id: "PVTSSF_...",
#   status_options: %{"Todo" => "f75ad846", "In Progress" => "...", "Done" => "..."},
#   viewer_login: "babie"
# }

# 候補 issue
{:ok, issues} = SymphonyElixir.Tracker.fetch_candidate_issues()
# [%SymphonyElixir.Tracker.Issue{
#     source: :github,
#     identifier: "babie/concert#1",
#     state: "Todo",
#     branch_name: "babie/concert-1-...",
#     extra: %SymphonyElixir.Github.IssueExtra{project_id: "PVT_...", project_item_id: "PVTI_..."}
#   }, ...]

# コメント投稿
SymphonyElixir.Tracker.create_comment(hd(issues).id, "hello from symphony")
# :ok

# Status 更新 (新シグネチャ: Issue 構造体を渡す)
SymphonyElixir.Tracker.update_issue_state(hd(issues), "In Progress")
# :ok → GitHub UI で Status が "In Progress" に変わる
```

iex で 3 操作が通れば Phase 2 完了。

---

## 完了条件 (チェックリスト)

- [ ] `lib/symphony_elixir/tracker/issue.ex` を新設、`Linear.Issue` を削除
- [ ] `lib/symphony_elixir/github/{adapter,client,queries,issue,project_meta}.ex` 実装
- [ ] `Github.IssueExtra` 構造体定義
- [ ] `Tracker.behaviour` の `update_issue_state/2` を Issue 受け取りに変更
- [ ] Linear adapter / `Tracker.Memory` / orchestrator を新シグネチャに追従
- [ ] `Tracker.adapter/0` dispatch に `"github"` を追加
- [ ] `Github.ProjectMeta.maybe_warmup!/0` を `Application.start/2` に組み込み
- [ ] Req.Test ベースの新規テスト群を追加
- [ ] 既存 Linear・Memory・orchestrator テストが `Tracker.Issue` 移行後も全緑
- [ ] iex で `Tracker.fetch_candidate_issues/0` / `create_comment/2` / `update_issue_state/2` が実機 GitHub Project に対して動く

---

## 不確実性 / 実装時に確認する点

| # | 項目 | 対応 |
|---|---|---|
| 1 | ProjectV2 が user/org どちらに紐づくかの判定 | user で先に試し、`data.user` が nil なら organization で再試行。両方 nil なら fail-fast |
| 2 | `paginate_items` のページング上限 | Linear 既存実装と同じく 1 ページ 50 件、`hasNextPage` で継続。1 万 item 超は当面想定しない |
| 3 | `fetch_issue_states_by_ids/1` で `nodes(ids: [...])` の返り値順序保証 | 順序保証されない可能性あり。Linear 既存実装の `sort_issues_by_requested_ids` パターンを踏襲 |
| 4 | `branch_name` が空 slug + 既存ディレクトリ衝突 | suffix が空のときの fallback は `{viewer_login}/{repo}-{number}`。実装時に workspace 側の衝突挙動を確認 |
| 5 | Req.Test の `plug:` オプション指定が `Req.post/2` の他のオプションと両立するか | 実装時に Req のドキュメントで確認、テスト時のみ `plug:` を渡す形にする |
| 6 | `Application.start/2` から warmup を呼ぶ際、`Config.settings!()` が利用可能か | Config がアプリ起動の早い段階で WORKFLOW.md を読むかを実装時に確認。読まないなら CLI 側 (`SymphonyElixir.CLI.run/1`) からの呼び出しに切り替える |
| 7 | orchestrator の `update_issue_state` 呼び出し箇所 | `lib/symphony_elixir/orchestrator.ex` の grep で確認、Issue 構造体を渡せる場所か確認。渡せないなら Tracker 層に id→Issue 再フェッチを挟む |

---

## 参考

- [TODO.md Milestone 2](../../../TODO.md) — M2 全体の Phase 構成と設計指針
- [`2026-05-14-m2-phase1-design.md`](2026-05-14-m2-phase1-design.md) — Phase 1 設計書 (schema 分割)
- [`docs/milestones/01-claude-minimal.md`](../../milestones/01-claude-minimal.md) — Milestone 1 完了記録
- [ADR-0004](../../adr/0004-agent-type-backend-selection.md) — `agent.type` パターン (本 Phase の前例)
- GitHub Projects v2 GraphQL: https://docs.github.com/en/graphql/reference/objects#projectv2
- GitHub `updateProjectV2ItemFieldValue` mutation: https://docs.github.com/en/graphql/reference/mutations#updateprojectv2itemfieldvalue
- Req.Test ドキュメント: https://hexdocs.pm/req/Req.Test.html
