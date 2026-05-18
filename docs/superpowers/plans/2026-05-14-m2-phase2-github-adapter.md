# Milestone 2 Phase 2: GitHub Adapter 実装 — 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tracker.kind: github` の Symphony が GitHub Projects v2 を相手に 5 callback (`fetch_candidate_issues` / `fetch_issues_by_states` / `fetch_issue_states_by_ids` / `create_comment` / `update_issue_state`) を実機で叩けるようにする。orchestrator 連携 (自動状態遷移) は Phase 3。

**Architecture:** Linear adapter のフルミラー。`lib/symphony_elixir/github/` 配下に Adapter / Client / Queries / Issue / IssueExtra / ProjectMeta を新設。Linear.Issue を `Tracker.Issue` にリネームし、`source: :linear | :github` と `extra: nil | %Github.IssueExtra{}` で adapter 固有フィールドを吸収。Project / Status field / option id は起動時に `Github.ProjectMeta` が 1 回だけ GraphQL で取得し `:persistent_term` にキャッシュ、ここで fail-fast validation を行う。テストは Req.Test で HTTP 層を stub。

**Tech Stack:** Elixir / `Req` + `Req.Test` / GitHub Projects v2 GraphQL / Ecto schema (既存) / `:persistent_term`

**Spec:** [`docs/superpowers/specs/2026-05-14-m2-phase2-design.md`](../specs/2026-05-14-m2-phase2-design.md)

**作業ブランチ:** `feat/m2-phase2-github-adapter`（main からブランチ、完了時に PR）

---

## ファイル構成

### 新規ファイル

| パス | 役割 |
|---|---|
| `apps/symphony/lib/symphony_elixir/tracker/issue.ex` | `Tracker.Issue` 構造体 (Linear.Issue から移動) |
| `apps/symphony/lib/symphony_elixir/github/issue_extra.ex` | `Github.IssueExtra` 構造体 (`project_id` / `project_item_id`) |
| `apps/symphony/lib/symphony_elixir/github/queries.ex` | GraphQL クエリ・mutation 文字列を module attribute で集約 |
| `apps/symphony/lib/symphony_elixir/github/client.ex` | `graphql/2` のみ。Req + Req.Test 対応 |
| `apps/symphony/lib/symphony_elixir/github/issue.ex` | `normalize_item/2` 純関数 (ProjectV2Item JSON → Tracker.Issue) |
| `apps/symphony/lib/symphony_elixir/github/project_meta.ex` | warmup + fail-fast validation + `:persistent_term` キャッシュ |
| `apps/symphony/lib/symphony_elixir/github/adapter.ex` | `Tracker` behaviour 実装 (5 callback) |
| `apps/symphony/test/symphony_elixir/github/issue_extra_test.exs` | struct の `@enforce_keys` 動作確認 |
| `apps/symphony/test/symphony_elixir/github/queries_test.exs` | 文字列に必須トークンが含まれていることだけ確認 |
| `apps/symphony/test/symphony_elixir/github/client_test.exs` | Req.Test で Authorization ヘッダ / JSON body / エラーレスポンスをアサート |
| `apps/symphony/test/symphony_elixir/github/issue_test.exs` | normalize 純関数の単体テスト |
| `apps/symphony/test/symphony_elixir/github/project_meta_test.exs` | warmup 成功 / fail-fast / 名前不一致 |
| `apps/symphony/test/symphony_elixir/github/adapter_test.exs` | 5 callback、GraphQL variables を Req.Test で検証 |

### 削除ファイル

| パス | 理由 |
|---|---|
| `apps/symphony/lib/symphony_elixir/linear/issue.ex` | `Tracker.Issue` に移動 |

### 既存変更ファイル

| パス | 変更 |
|---|---|
| `apps/symphony/lib/symphony_elixir/tracker.ex` | adapter dispatch に `"github"` 追加、`update_issue_state` callback の第 1 引数を `Tracker.Issue.t()` に |
| `apps/symphony/lib/symphony_elixir/tracker/memory.ex` | alias 更新、`update_issue_state(%Tracker.Issue{}, state)` シグネチャに |
| `apps/symphony/lib/symphony_elixir/linear/adapter.ex` | alias 更新、`update_issue_state(%Tracker.Issue{}, state)` で受ける |
| `apps/symphony/lib/symphony_elixir/linear/client.ex` | alias 更新、normalize 出力に `source: :linear, extra: nil` を含める |
| `apps/symphony/lib/symphony_elixir/orchestrator.ex` | `Linear.Issue` alias → `Tracker.Issue` |
| `apps/symphony/lib/symphony_elixir/agent_runner.ex` | 同上 |
| `apps/symphony/lib/symphony_elixir/prompt_builder.ex` | typespec 上の `Linear.Issue.t()` → `Tracker.Issue.t()` |
| `apps/symphony/lib/symphony_elixir.ex` | `Application.start/2` で `Github.ProjectMeta.maybe_warmup!/0` を呼ぶ |
| `apps/symphony/test/test_helper.exs` | `Req.Test` の `default_options` 設定追加 |
| `apps/symphony/test/support/test_support.exs` | `Linear.Issue` 参照を `Tracker.Issue` に書き換え |
| `apps/symphony/test/symphony_elixir/core_test.exs` | 同上 |
| `apps/symphony/test/symphony_elixir/orchestrator_status_test.exs` | 同上 |
| `apps/symphony/test/symphony_elixir/live_e2e_test.exs` | 同上 |
| `apps/symphony/test/symphony_elixir/workspace_and_config_test.exs` | 同上 |
| `apps/symphony/test/symphony_elixir/app_server_test.exs` | 同上 |
| `apps/symphony/test/symphony_elixir/extensions_test.exs` | `Tracker.update_issue_state` 呼び出しを Issue 構造体渡しに、その他 sweep |

### スコープ外（Phase 3 / 4 で扱う）

- 自動状態遷移 (`maybe_pickup_transition` / `maybe_success_transition`)
- `examples/workflow.github.md` 新規作成
- ADR-0013 / ADR-0014 執筆
- E2E スクリプト化

---

## 実装順序

依存関係:

```
Task 1: Github.IssueExtra struct
  └─ Task 2: Tracker.Issue (Linear.Issue rename + sweep)
       └─ Task 3: Tracker behaviour update_issue_state signature change
            ├─ Task 4: Github.Queries
            ├─ Task 5: Github.Client (Req.Test)
            └─ Task 6: Github.Issue.normalize_item
                 └─ Task 7: Github.ProjectMeta
                      ├─ Task 8: Github.Adapter — fetch_candidate_issues
                      ├─ Task 9: Github.Adapter — fetch_issues_by_states + fetch_issue_states_by_ids
                      └─ Task 10: Github.Adapter — create_comment + update_issue_state
                           └─ Task 11: Tracker dispatch + Application warmup wiring
                                └─ Task 12: 実機 iex 動作確認
```

各 Task 末尾で `mix test --warnings-as-errors` を緑にしてからコミット。

---

## Task 1: `Github.IssueExtra` struct

**Files:**
- Create: `apps/symphony/lib/symphony_elixir/github/issue_extra.ex`
- Create: `apps/symphony/test/symphony_elixir/github/issue_extra_test.exs`

- [ ] **Step 1: テストを書く**

```elixir
# apps/symphony/test/symphony_elixir/github/issue_extra_test.exs
defmodule SymphonyElixir.Github.IssueExtraTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Github.IssueExtra

  test "constructs with project_id and project_item_id" do
    extra = %IssueExtra{project_id: "PVT_abc", project_item_id: "PVTI_xyz"}
    assert extra.project_id == "PVT_abc"
    assert extra.project_item_id == "PVTI_xyz"
  end

  test "raises when project_id is missing" do
    assert_raise ArgumentError, ~r/project_id/, fn ->
      struct!(IssueExtra, project_item_id: "PVTI_xyz")
    end
  end

  test "raises when project_item_id is missing" do
    assert_raise ArgumentError, ~r/project_item_id/, fn ->
      struct!(IssueExtra, project_id: "PVT_abc")
    end
  end
end
```

- [ ] **Step 2: テストを走らせて失敗確認**

```bash
cd apps/symphony && mix test test/symphony_elixir/github/issue_extra_test.exs
```

Expected: `** (CompileError) ... SymphonyElixir.Github.IssueExtra is not loaded`

- [ ] **Step 3: 構造体を実装**

```elixir
# apps/symphony/lib/symphony_elixir/github/issue_extra.ex
defmodule SymphonyElixir.Github.IssueExtra do
  @moduledoc """
  GitHub-specific fields attached to `Tracker.Issue.extra` when source is :github.
  Holds the ProjectV2 node id and ProjectV2Item id required to update the
  Status field.
  """

  @enforce_keys [:project_id, :project_item_id]
  defstruct [:project_id, :project_item_id]

  @type t :: %__MODULE__{
          project_id: String.t(),
          project_item_id: String.t()
        }
end
```

- [ ] **Step 4: テストを走らせて緑確認**

```bash
cd apps/symphony && mix test test/symphony_elixir/github/issue_extra_test.exs
```

Expected: 3 tests, 0 failures

- [ ] **Step 5: コミット**

```bash
git add apps/symphony/lib/symphony_elixir/github/issue_extra.ex \
        apps/symphony/test/symphony_elixir/github/issue_extra_test.exs
git commit -m "feat(symphony): add Github.IssueExtra struct for project_item_id"
```

---

## Task 2: `Tracker.Issue` 新設 + Linear.Issue sweep

`Linear.Issue` を `lib/symphony_elixir/tracker/issue.ex` に移動し、`source: :linear | :github` と `extra: nil | IssueExtra.t()` を追加。既存の `Linear.Issue` 参照を全て `Tracker.Issue` に置換する。

**Files:**
- Create: `apps/symphony/lib/symphony_elixir/tracker/issue.ex`
- Delete: `apps/symphony/lib/symphony_elixir/linear/issue.ex`
- Modify: `apps/symphony/lib/symphony_elixir/linear/client.ex`
- Modify: `apps/symphony/lib/symphony_elixir/linear/adapter.ex`
- Modify: `apps/symphony/lib/symphony_elixir/tracker/memory.ex`
- Modify: `apps/symphony/lib/symphony_elixir/orchestrator.ex`
- Modify: `apps/symphony/lib/symphony_elixir/agent_runner.ex`
- Modify: `apps/symphony/lib/symphony_elixir/prompt_builder.ex`
- Modify: 上記参照を持つ test ファイル (test_support.exs, core_test.exs, orchestrator_status_test.exs, live_e2e_test.exs, workspace_and_config_test.exs, app_server_test.exs, extensions_test.exs)

- [ ] **Step 1: 新ファイル `tracker/issue.ex` を書く**

`linear/issue.ex` の内容をコピーし、モジュール名を変えて source / extra を追加する。

```elixir
# apps/symphony/lib/symphony_elixir/tracker/issue.ex
defmodule SymphonyElixir.Tracker.Issue do
  @moduledoc """
  Normalized issue representation used by the orchestrator across all
  tracker backends (Linear, GitHub, in-memory).
  """

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

  @spec label_names(t()) :: [String.t()]
  def label_names(%__MODULE__{labels: labels}), do: labels
end
```

- [ ] **Step 2: 旧ファイル削除**

```bash
git rm apps/symphony/lib/symphony_elixir/linear/issue.ex
```

- [ ] **Step 3: lib 側の参照を全て置換**

各ファイルを開いて以下を機械的に置換:

| 対象パターン | 置換後 |
|---|---|
| `alias SymphonyElixir.{Config, Linear.Issue, ...}` | `alias SymphonyElixir.{Config, Tracker.Issue, ...}` |
| `alias SymphonyElixir.Linear.Issue` | `alias SymphonyElixir.Tracker.Issue` |
| `SymphonyElixir.Linear.Issue.t()` | `SymphonyElixir.Tracker.Issue.t()` |

該当ファイル: `linear/client.ex`, `linear/adapter.ex`, `tracker/memory.ex`, `orchestrator.ex`, `agent_runner.ex`, `prompt_builder.ex`

`linear/client.ex:452` の `%Issue{}` リテラルに `source: :linear, extra: nil` を追加:

```elixir
# 変更前 (line ~449-468)
defp normalize_issue(issue, assignee_filter) when is_map(issue) do
  assignee = issue["assignee"]

  %Issue{
    id: issue["id"],
    identifier: issue["identifier"],
    # ...
    updated_at: parse_datetime(issue["updatedAt"])
  }
end

# 変更後
defp normalize_issue(issue, assignee_filter) when is_map(issue) do
  assignee = issue["assignee"]

  %Issue{
    id: issue["id"],
    identifier: issue["identifier"],
    # ...
    updated_at: parse_datetime(issue["updatedAt"]),
    source: :linear,
    extra: nil
  }
end
```

- [ ] **Step 4: test 側の参照を全て置換**

`test_support.exs` / `core_test.exs` / `orchestrator_status_test.exs` / `live_e2e_test.exs` / `workspace_and_config_test.exs` / `app_server_test.exs` / `extensions_test.exs` を開いて、Step 3 と同じ機械的置換を適用。Issue リテラルは `source` / `extra` を明示しなくても defstruct のデフォルト (`source: :linear, extra: nil`) で動く。

- [ ] **Step 5: テスト全実行**

```bash
cd apps/symphony && mix test --warnings-as-errors
```

Expected: 全テスト緑 (Phase 1 完了時点と同数)。warnings-as-errors で残った警告が出るならファイル参照漏れ。

- [ ] **Step 6: コミット**

```bash
git add apps/symphony/lib apps/symphony/test
git commit -m "refactor(symphony): rename Linear.Issue to Tracker.Issue and add source/extra"
```

---

## Task 3: `Tracker` behaviour の `update_issue_state` シグネチャ変更

第 1 引数を `String.t()` から `Tracker.Issue.t()` に変更し、Linear adapter / Memory adapter / 関連テストを追従させる。orchestrator は `Tracker.update_issue_state` を呼んでいないので無変更。

**Files:**
- Modify: `apps/symphony/lib/symphony_elixir/tracker.ex`
- Modify: `apps/symphony/lib/symphony_elixir/tracker/memory.ex`
- Modify: `apps/symphony/lib/symphony_elixir/linear/adapter.ex`
- Modify: `apps/symphony/test/symphony_elixir/extensions_test.exs`

- [ ] **Step 1: 失敗するテストを `extensions_test.exs` に追加**

既存の `assert :ok = SymphonyElixir.Tracker.update_issue_state("issue-1", "Done")` の周辺を Issue 構造体渡しの新シグネチャに書き換える。

```elixir
# extensions_test.exs 内、既存テストを書き換える
# 変更前:
assert :ok = SymphonyElixir.Tracker.update_issue_state("issue-1", "Done")
# 変更後:
issue = %SymphonyElixir.Tracker.Issue{id: "issue-1", source: :linear}
assert :ok = SymphonyElixir.Tracker.update_issue_state(issue, "Done")
```

同様に `Memory.update_issue_state("issue-1", "Quiet")` → `Memory.update_issue_state(issue, "Quiet")`、
`Adapter.update_issue_state("issue-1", "Done")` → `Adapter.update_issue_state(issue, "Done")` を書き換える。

- [ ] **Step 2: テストを走らせて失敗確認**

```bash
cd apps/symphony && mix test test/symphony_elixir/extensions_test.exs
```

Expected: `FunctionClauseError` または引数型違い

- [ ] **Step 3: `tracker.ex` の callback / 委譲を変更**

```elixir
# apps/symphony/lib/symphony_elixir/tracker.ex
defmodule SymphonyElixir.Tracker do
  alias SymphonyElixir.{Config, Tracker.Issue}

  @callback fetch_candidate_issues() :: {:ok, [Issue.t()]} | {:error, term()}
  @callback fetch_issues_by_states([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  @callback fetch_issue_states_by_ids([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  @callback create_comment(String.t(), String.t()) :: :ok | {:error, term()}
  @callback update_issue_state(Issue.t(), String.t()) :: :ok | {:error, term()}

  @spec fetch_candidate_issues() :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_candidate_issues, do: adapter().fetch_candidate_issues()

  @spec fetch_issues_by_states([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_states(states), do: adapter().fetch_issues_by_states(states)

  @spec fetch_issue_states_by_ids([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issue_states_by_ids(issue_ids), do: adapter().fetch_issue_states_by_ids(issue_ids)

  @spec create_comment(String.t(), String.t()) :: :ok | {:error, term()}
  def create_comment(issue_id, body), do: adapter().create_comment(issue_id, body)

  @spec update_issue_state(Issue.t(), String.t()) :: :ok | {:error, term()}
  def update_issue_state(%Issue{} = issue, state_name) do
    adapter().update_issue_state(issue, state_name)
  end

  @spec adapter() :: module()
  def adapter do
    case Config.settings!().tracker.kind do
      "memory" -> SymphonyElixir.Tracker.Memory
      _ -> SymphonyElixir.Linear.Adapter
    end
  end
end
```

- [ ] **Step 4: Linear.Adapter を新シグネチャに**

```elixir
# apps/symphony/lib/symphony_elixir/linear/adapter.ex
# 既存の update_issue_state(issue_id, state_name) を以下に置換:

@spec update_issue_state(Tracker.Issue.t(), String.t()) :: :ok | {:error, term()}
def update_issue_state(%Tracker.Issue{id: issue_id}, state_name)
    when is_binary(issue_id) and is_binary(state_name) do
  with {:ok, state_id} <- resolve_state_id(issue_id, state_name),
       {:ok, response} <-
         client_module().graphql(@update_state_mutation, %{issueId: issue_id, stateId: state_id}),
       true <- get_in(response, ["data", "issueUpdate", "success"]) == true do
    :ok
  else
    false -> {:error, :issue_update_failed}
    {:error, reason} -> {:error, reason}
    _ -> {:error, :issue_update_failed}
  end
end
```

ファイル冒頭の alias に `Tracker.Issue` を追加:
```elixir
alias SymphonyElixir.{Linear.Client, Tracker.Issue}
```

- [ ] **Step 5: Tracker.Memory を新シグネチャに**

```elixir
# apps/symphony/lib/symphony_elixir/tracker/memory.ex
# 既存の update_issue_state(issue_id, state_name) を以下に置換:

@spec update_issue_state(SymphonyElixir.Tracker.Issue.t(), String.t()) :: :ok | {:error, term()}
def update_issue_state(%SymphonyElixir.Tracker.Issue{id: issue_id}, state_name) do
  send_event({:memory_tracker_state_update, issue_id, state_name})
  :ok
end
```

- [ ] **Step 6: テスト全実行**

```bash
cd apps/symphony && mix test --warnings-as-errors
```

Expected: 全テスト緑

- [ ] **Step 7: コミット**

```bash
git add apps/symphony/lib apps/symphony/test
git commit -m "refactor(symphony): Tracker.update_issue_state takes Issue struct"
```

---

## Task 4: `Github.Queries` モジュール

GraphQL クエリ・mutation 文字列を module attribute で集約。テストは「クエリ文字列に必須のフィールド名・mutation 名が含まれること」だけを確認 (リグレッション検知)。

**Files:**
- Create: `apps/symphony/lib/symphony_elixir/github/queries.ex`
- Create: `apps/symphony/test/symphony_elixir/github/queries_test.exs`

- [ ] **Step 1: テストを書く**

```elixir
# apps/symphony/test/symphony_elixir/github/queries_test.exs
defmodule SymphonyElixir.Github.QueriesTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Github.Queries

  test "project_meta query references projectV2 fields and singleSelect options" do
    q = Queries.project_meta()
    assert q =~ "user(login: $owner)"
    assert q =~ "projectV2(number: $number)"
    assert q =~ "ProjectV2SingleSelectField"
    assert q =~ "options"
  end

  test "project_meta_org query targets organization scope" do
    q = Queries.project_meta_org()
    assert q =~ "organization(login: $owner)"
    assert q =~ "projectV2(number: $number)"
  end

  test "viewer query asks for login" do
    assert Queries.viewer() =~ "viewer"
    assert Queries.viewer() =~ "login"
  end

  test "poll_items query iterates project items with content and field values" do
    q = Queries.poll_items()
    assert q =~ "items(first: $first, after: $after)"
    assert q =~ "ProjectV2ItemFieldSingleSelectValue"
    assert q =~ "pageInfo"
    assert q =~ "Issue {"
    assert q =~ "repository { nameWithOwner }"
  end

  test "issues_by_ids query selects issues by node ids" do
    q = Queries.issues_by_ids()
    assert q =~ "nodes(ids: $ids)"
    assert q =~ "projectItems(first:"
  end

  test "add_comment mutation uses addComment with subjectId" do
    m = Queries.add_comment()
    assert m =~ "addComment"
    assert m =~ "subjectId"
  end

  test "update_item_status mutation uses updateProjectV2ItemFieldValue with singleSelectOptionId" do
    m = Queries.update_item_status()
    assert m =~ "updateProjectV2ItemFieldValue"
    assert m =~ "singleSelectOptionId"
  end
end
```

- [ ] **Step 2: テストを走らせて失敗確認**

```bash
cd apps/symphony && mix test test/symphony_elixir/github/queries_test.exs
```

Expected: `** (UndefinedFunctionError) SymphonyElixir.Github.Queries.project_meta/0`

- [ ] **Step 3: モジュール実装**

```elixir
# apps/symphony/lib/symphony_elixir/github/queries.ex
defmodule SymphonyElixir.Github.Queries do
  @moduledoc """
  GraphQL queries and mutations for GitHub Projects v2 tracker integration.
  Strings are returned from zero-arity functions so call sites read naturally.
  """

  @project_meta """
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
  """

  @project_meta_org """
  query SymphonyGithubProjectMetaOrg($owner: String!, $number: Int!) {
    organization(login: $owner) {
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
  """

  @viewer """
  query SymphonyGithubViewer {
    viewer { login }
  }
  """

  @poll_items """
  query SymphonyGithubPollItems($projectId: ID!, $first: Int!, $after: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: $first, after: $after) {
          nodes {
            id
            content {
              __typename
              ... on Issue {
                id
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
  """

  @issues_by_ids """
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
  """

  @add_comment """
  mutation SymphonyGithubAddComment($subjectId: ID!, $body: String!) {
    addComment(input: {subjectId: $subjectId, body: $body}) {
      clientMutationId
    }
  }
  """

  @update_item_status """
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
  """

  @spec project_meta() :: String.t()
  def project_meta, do: @project_meta

  @spec project_meta_org() :: String.t()
  def project_meta_org, do: @project_meta_org

  @spec viewer() :: String.t()
  def viewer, do: @viewer

  @spec poll_items() :: String.t()
  def poll_items, do: @poll_items

  @spec issues_by_ids() :: String.t()
  def issues_by_ids, do: @issues_by_ids

  @spec add_comment() :: String.t()
  def add_comment, do: @add_comment

  @spec update_item_status() :: String.t()
  def update_item_status, do: @update_item_status
end
```

- [ ] **Step 4: テスト緑確認**

```bash
cd apps/symphony && mix test test/symphony_elixir/github/queries_test.exs
```

Expected: 7 tests, 0 failures

- [ ] **Step 5: コミット**

```bash
git add apps/symphony/lib/symphony_elixir/github/queries.ex \
        apps/symphony/test/symphony_elixir/github/queries_test.exs
git commit -m "feat(symphony): add Github.Queries module with GraphQL strings"
```

---

## Task 5: `Github.Client` (Req.Test 対応)

GraphQL リクエストを 1 メソッド `graphql/2` で受ける薄いクライアント。HTTP は `Req`、テストは `Req.Test.stub` で乗っ取る。

**Files:**
- Create: `apps/symphony/lib/symphony_elixir/github/client.ex`
- Create: `apps/symphony/test/symphony_elixir/github/client_test.exs`

`Github.Client` 内で `plug: {Req.Test, SymphonyElixir.Github.Client}` を指定するので、`test_helper.exs` への global 追記は不要。各テストの `setup` で `Application.put_env(:symphony_elixir, :github, %{...})` + `Req.Test.stub(SymphonyElixir.Github.Client, fn conn -> ... end)` を行う。

- [ ] **Step 1: 失敗テストを書く**

```elixir
# apps/symphony/test/symphony_elixir/github/client_test.exs
defmodule SymphonyElixir.Github.ClientTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Github.Client

  setup do
    prev = Application.get_env(:symphony_elixir, :github)
    Application.put_env(:symphony_elixir, :github, %{
      api_key: "test-token",
      endpoint: "http://gh-test.local/graphql"
    })

    on_exit(fn ->
      case prev do
        nil -> Application.delete_env(:symphony_elixir, :github)
        v -> Application.put_env(:symphony_elixir, :github, v)
      end
    end)

    :ok
  end

  test "sends Authorization Bearer header and JSON body" do
    Req.Test.stub(SymphonyElixir.Github.Client, fn conn ->
      assert ["Bearer test-token"] = Plug.Conn.get_req_header(conn, "authorization")
      assert ["application/json"] = Plug.Conn.get_req_header(conn, "content-type")
      {:ok, body, conn} = Plug.Conn.read_body(conn)
      decoded = Jason.decode!(body)
      assert decoded["query"] =~ "query Foo"
      assert decoded["variables"] == %{"x" => 1}

      Req.Test.json(conn, %{"data" => %{"ok" => true}})
    end)

    assert {:ok, %{"data" => %{"ok" => true}}} =
             Client.graphql("query Foo { ok }", %{x: 1})
  end

  test "returns {:error, {:github_api_status, status}} on 4xx" do
    Req.Test.stub(SymphonyElixir.Github.Client, fn conn ->
      Plug.Conn.send_resp(conn, 401, "Unauthorized")
    end)

    assert {:error, {:github_api_status, 401}} =
             Client.graphql("query { viewer { login } }", %{})
  end

  test "returns {:error, {:github_graphql_errors, errors}} when payload has errors" do
    Req.Test.stub(SymphonyElixir.Github.Client, fn conn ->
      Req.Test.json(conn, %{"errors" => [%{"message" => "bad"}]})
    end)

    assert {:error, {:github_graphql_errors, [%{"message" => "bad"}]}} =
             Client.graphql("query { x }", %{})
  end
end
```

- [ ] **Step 2: テストを走らせて失敗確認**

```bash
cd apps/symphony && mix test test/symphony_elixir/github/client_test.exs
```

Expected: `** (UndefinedFunctionError) SymphonyElixir.Github.Client.graphql/2`

- [ ] **Step 3: Client モジュール実装**

```elixir
# apps/symphony/lib/symphony_elixir/github/client.ex
defmodule SymphonyElixir.Github.Client do
  @moduledoc """
  Thin GraphQL client for GitHub. Sends POST requests with a JSON body and
  returns either the decoded `data` payload or a typed error tuple.

  Tests substitute the HTTP layer via `Req.Test.stub(__MODULE__, fn conn -> ... end)`.
  """

  require Logger

  @spec graphql(String.t(), map()) :: {:ok, map()} | {:error, term()}
  def graphql(query, variables \\ %{}) when is_binary(query) and is_map(variables) do
    case settings() do
      {:ok, %{endpoint: endpoint, api_key: token}} ->
        post_graphql(endpoint, token, query, variables)

      {:error, _reason} = err ->
        err
    end
  end

  defp post_graphql(endpoint, token, query, variables) do
    payload = %{"query" => query, "variables" => variables}

    case Req.post(endpoint,
           headers: [
             {"authorization", "Bearer " <> token},
             {"content-type", "application/json"}
           ],
           json: payload,
           plug: {Req.Test, __MODULE__},
           connect_options: [timeout: 30_000]
         ) do
      {:ok, %{status: 200, body: %{"errors" => errors}}} ->
        {:error, {:github_graphql_errors, errors}}

      {:ok, %{status: 200, body: body}} ->
        {:ok, body}

      {:ok, %{status: status, body: body}} ->
        Logger.error("GitHub GraphQL request failed status=#{status} body=#{inspect(body)}")
        {:error, {:github_api_status, status}}

      {:error, reason} ->
        Logger.error("GitHub GraphQL request failed: #{inspect(reason)}")
        {:error, {:github_api_request, reason}}
    end
  end

  defp settings do
    case Application.get_env(:symphony_elixir, :github) do
      %{endpoint: endpoint, api_key: api_key}
      when is_binary(endpoint) and is_binary(api_key) ->
        {:ok, %{endpoint: endpoint, api_key: api_key}}

      _ ->
        # Fallback to Config.settings!() when not overridden by tests.
        github = SymphonyElixir.Config.settings!().github

        cond do
          is_nil(github.api_key) ->
            {:error, :missing_github_api_token}

          is_nil(github.endpoint) ->
            {:error, :missing_github_endpoint}

          true ->
            {:ok, %{endpoint: github.endpoint, api_key: github.api_key}}
        end
    end
  end
end
```

注: 本番では `Config.settings!()` 経由で endpoint / api_key を取得する。テストでは setup ブロックで `Application.put_env(:symphony_elixir, :github, %{...})` を入れる (Config を読む必要を回避)。

- [ ] **Step 4: テスト緑確認**

```bash
cd apps/symphony && mix test test/symphony_elixir/github/client_test.exs
```

Expected: 3 tests, 0 failures

- [ ] **Step 5: 全体テスト**

```bash
cd apps/symphony && mix test --warnings-as-errors
```

Expected: 既存テストも全て緑

- [ ] **Step 6: コミット**

```bash
git add apps/symphony/lib/symphony_elixir/github/client.ex \
        apps/symphony/test/symphony_elixir/github/client_test.exs
git commit -m "feat(symphony): add Github.Client GraphQL wrapper with Req.Test support"
```

---

## Task 6: `Github.Issue.normalize_item/2`

ProjectV2Item の JSON ノードを `Tracker.Issue` に変換する純関数。Issue 以外 (PR / DraftIssue) は `nil` を返す。

**Files:**
- Create: `apps/symphony/lib/symphony_elixir/github/issue.ex`
- Create: `apps/symphony/test/symphony_elixir/github/issue_test.exs`

- [ ] **Step 1: テストを書く**

```elixir
# apps/symphony/test/symphony_elixir/github/issue_test.exs
defmodule SymphonyElixir.Github.IssueTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Github.Issue, as: GhIssue
  alias SymphonyElixir.Github.IssueExtra
  alias SymphonyElixir.Tracker.Issue, as: TIssue

  @project_id "PVT_kwDO_test"
  @viewer "babie"

  defp item_fixture(overrides \\ %{}) do
    Map.merge(
      %{
        "id" => "PVTI_item1",
        "content" => %{
          "__typename" => "Issue",
          "id" => "I_kw_issue1",
          "number" => 42,
          "title" => "Fix login bug",
          "body" => "details",
          "url" => "https://github.com/babie/concert/issues/42",
          "repository" => %{"nameWithOwner" => "babie/concert"},
          "assignees" => %{"nodes" => [%{"login" => "babie"}]},
          "labels" => %{"nodes" => [%{"name" => "bug"}, %{"name" => "P1"}]},
          "createdAt" => "2026-05-10T10:00:00Z",
          "updatedAt" => "2026-05-12T11:00:00Z"
        },
        "fieldValues" => %{
          "nodes" => [
            %{
              "__typename" => "ProjectV2ItemFieldSingleSelectValue",
              "field" => %{"name" => "Status"},
              "name" => "Todo",
              "optionId" => "opt_todo"
            }
          ]
        }
      },
      overrides
    )
  end

  describe "normalize_item/2" do
    test "maps an Issue item to %Tracker.Issue{source: :github}" do
      issue = GhIssue.normalize_item(item_fixture(), %{project_id: @project_id, viewer_login: @viewer})

      assert %TIssue{
               source: :github,
               id: "I_kw_issue1",
               identifier: "babie/concert#42",
               title: "Fix login bug",
               description: "details",
               state: "Todo",
               url: "https://github.com/babie/concert/issues/42",
               assignee_id: "babie",
               labels: ["bug", "p1"],
               priority: nil,
               blocked_by: [],
               extra: %IssueExtra{project_id: @project_id, project_item_id: "PVTI_item1"},
               branch_name: branch
             } = issue

      assert branch == "babie/concert-42-fix-login-bug"
      assert %DateTime{} = issue.created_at
      assert %DateTime{} = issue.updated_at
    end

    test "returns nil for non-Issue content (PR)" do
      pr_item =
        item_fixture()
        |> put_in(["content", "__typename"], "PullRequest")

      assert is_nil(GhIssue.normalize_item(pr_item, %{project_id: @project_id, viewer_login: @viewer}))
    end

    test "returns nil for DraftIssue" do
      draft =
        item_fixture()
        |> put_in(["content", "__typename"], "DraftIssue")

      assert is_nil(GhIssue.normalize_item(draft, %{project_id: @project_id, viewer_login: @viewer}))
    end

    test "drops Status field value when no SingleSelect named Status is present" do
      no_status = put_in(item_fixture(), ["fieldValues", "nodes"], [])
      issue = GhIssue.normalize_item(no_status, %{project_id: @project_id, viewer_login: @viewer})
      assert issue.state == nil
    end

    test "falls back to viewer/repo-number branch when title slug is empty" do
      empty_title =
        item_fixture()
        |> put_in(["content", "title"], "全角のみ")

      issue = GhIssue.normalize_item(empty_title, %{project_id: @project_id, viewer_login: @viewer})
      assert issue.branch_name == "babie/concert-42"
    end

    test "truncates slug to 50 chars" do
      long_title = put_in(item_fixture(), ["content", "title"], String.duplicate("a", 200))
      issue = GhIssue.normalize_item(long_title, %{project_id: @project_id, viewer_login: @viewer})
      ["babie", suffix] = String.split(issue.branch_name, "/", parts: 2)
      [_repo, _num, slug] = String.split(suffix, "-", parts: 3)
      assert String.length(slug) <= 50
    end

    test "selects first assignee login as assignee_id" do
      multi =
        put_in(item_fixture(), ["content", "assignees", "nodes"], [
          %{"login" => "alice"},
          %{"login" => "bob"}
        ])

      issue = GhIssue.normalize_item(multi, %{project_id: @project_id, viewer_login: @viewer})
      assert issue.assignee_id == "alice"
    end
  end
end
```

- [ ] **Step 2: テストを走らせて失敗確認**

```bash
cd apps/symphony && mix test test/symphony_elixir/github/issue_test.exs
```

Expected: `** (UndefinedFunctionError)` or compile error

- [ ] **Step 3: Issue モジュール実装**

```elixir
# apps/symphony/lib/symphony_elixir/github/issue.ex
defmodule SymphonyElixir.Github.Issue do
  @moduledoc """
  Pure transformation from a ProjectV2Item JSON node to %Tracker.Issue{}.
  Returns nil for non-Issue content (PR, DraftIssue).
  """

  alias SymphonyElixir.Github.IssueExtra
  alias SymphonyElixir.Tracker.Issue, as: TIssue

  @slug_max_length 50

  @typedoc "Required context: project node id and PAT-owner login (for branch_name)."
  @type context :: %{project_id: String.t(), viewer_login: String.t()}

  @spec normalize_item(map(), context()) :: TIssue.t() | nil
  def normalize_item(%{"content" => %{"__typename" => "Issue"} = content} = item, ctx) do
    repo = repo_short_name(content)
    number = content["number"]
    identifier = repo_with_owner(content) <> "#" <> Integer.to_string(number)

    %TIssue{
      id: content["id"],
      identifier: identifier,
      title: content["title"],
      description: content["body"],
      state: extract_status(item["fieldValues"]),
      branch_name: build_branch_name(ctx.viewer_login, repo, number, content["title"]),
      url: content["url"],
      assignee_id: first_assignee(content["assignees"]),
      priority: nil,
      blocked_by: [],
      labels: extract_labels(content["labels"]),
      assigned_to_worker: true,
      created_at: parse_datetime(content["createdAt"]),
      updated_at: parse_datetime(content["updatedAt"]),
      source: :github,
      extra: %IssueExtra{
        project_id: ctx.project_id,
        project_item_id: item["id"]
      }
    }
  end

  def normalize_item(_other, _ctx), do: nil

  @spec slugify(String.t()) :: String.t()
  def slugify(title) when is_binary(title) do
    title
    |> String.downcase()
    |> String.replace(~r/[^a-z0-9]+/u, "-")
    |> String.trim("-")
    |> String.slice(0, @slug_max_length)
    |> String.trim("-")
  end

  def slugify(_), do: ""

  defp build_branch_name(viewer, repo, number, title) do
    slug = slugify(title || "")
    base = "#{viewer}/#{repo}-#{number}"
    if slug == "", do: base, else: base <> "-" <> slug
  end

  defp repo_with_owner(%{"repository" => %{"nameWithOwner" => name}}) when is_binary(name), do: name
  defp repo_with_owner(_), do: "unknown/unknown"

  defp repo_short_name(content) do
    case repo_with_owner(content) do
      "unknown/unknown" -> "unknown"
      name -> name |> String.split("/", parts: 2) |> List.last()
    end
  end

  defp extract_status(%{"nodes" => nodes}) when is_list(nodes) do
    Enum.find_value(nodes, fn
      %{
        "__typename" => "ProjectV2ItemFieldSingleSelectValue",
        "field" => %{"name" => "Status"},
        "name" => name
      } when is_binary(name) ->
        name

      _ ->
        nil
    end)
  end

  defp extract_status(_), do: nil

  defp first_assignee(%{"nodes" => [%{"login" => login} | _]}) when is_binary(login), do: login
  defp first_assignee(_), do: nil

  defp extract_labels(%{"nodes" => nodes}) when is_list(nodes) do
    nodes
    |> Enum.map(& &1["name"])
    |> Enum.reject(&is_nil/1)
    |> Enum.map(&String.downcase/1)
  end

  defp extract_labels(_), do: []

  defp parse_datetime(nil), do: nil

  defp parse_datetime(raw) when is_binary(raw) do
    case DateTime.from_iso8601(raw) do
      {:ok, dt, _offset} -> dt
      _ -> nil
    end
  end
end
```

- [ ] **Step 4: テスト緑確認**

```bash
cd apps/symphony && mix test test/symphony_elixir/github/issue_test.exs
```

Expected: 7 tests, 0 failures

- [ ] **Step 5: コミット**

```bash
git add apps/symphony/lib/symphony_elixir/github/issue.ex \
        apps/symphony/test/symphony_elixir/github/issue_test.exs
git commit -m "feat(symphony): add Github.Issue normalize_item pure function"
```

---

## Task 7: `Github.ProjectMeta` (warmup + fail-fast + cache)

起動時に Project node id / Status field id / option name→id / viewer login を取得し `:persistent_term` にキャッシュ。`active_states` / `terminal_states` / `doing_state` / `done_state` の名前が options に実在することを fail-fast 検証。

**Files:**
- Create: `apps/symphony/lib/symphony_elixir/github/project_meta.ex`
- Create: `apps/symphony/test/symphony_elixir/github/project_meta_test.exs`

- [ ] **Step 1: テストを書く**

```elixir
# apps/symphony/test/symphony_elixir/github/project_meta_test.exs
defmodule SymphonyElixir.Github.ProjectMetaTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Github.ProjectMeta

  @owner "babie"
  @number 5

  setup do
    Application.put_env(:symphony_elixir, :github, %{
      api_key: "test-token",
      endpoint: "http://gh-test.local/graphql",
      project_owner: @owner,
      project_number: @number,
      assignee: nil
    })

    Application.put_env(:symphony_elixir, :tracker, %{
      kind: "github",
      active_states: ["Todo", "In Progress"],
      terminal_states: ["Done"],
      doing_state: "In Progress",
      done_state: "Done"
    })

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :github)
      Application.delete_env(:symphony_elixir, :tracker)
      :persistent_term.erase({ProjectMeta, :meta})
    end)

    :ok
  end

  defp stub_user_project_response do
    %{
      "data" => %{
        "user" => %{
          "projectV2" => %{
            "id" => "PVT_kwDO_test",
            "title" => "Sandbox",
            "fields" => %{
              "nodes" => [
                %{
                  "__typename" => "ProjectV2SingleSelectField",
                  "id" => "PVTSSF_status",
                  "name" => "Status",
                  "options" => [
                    %{"id" => "opt_todo", "name" => "Todo"},
                    %{"id" => "opt_inprog", "name" => "In Progress"},
                    %{"id" => "opt_done", "name" => "Done"}
                  ]
                }
              ]
            }
          }
        }
      }
    }
  end

  defp stub_viewer_response, do: %{"data" => %{"viewer" => %{"login" => "babie"}}}

  defp stub_default(conn) do
    {:ok, body, conn} = Plug.Conn.read_body(conn)
    payload = Jason.decode!(body)
    query = payload["query"]

    cond do
      String.contains?(query, "SymphonyGithubProjectMeta") and
          not String.contains?(query, "Org") ->
        Req.Test.json(conn, stub_user_project_response())

      String.contains?(query, "SymphonyGithubViewer") ->
        Req.Test.json(conn, stub_viewer_response())

      true ->
        Req.Test.json(conn, %{"data" => %{}})
    end
  end

  test "warmup!/0 caches project/status/viewer meta in persistent_term" do
    Req.Test.stub(SymphonyElixir.Github.Client, &stub_default/1)

    assert :ok = ProjectMeta.warmup!()
    meta = ProjectMeta.fetch!()
    assert meta.project_id == "PVT_kwDO_test"
    assert meta.status_field_id == "PVTSSF_status"
    assert meta.status_options == %{"Todo" => "opt_todo", "In Progress" => "opt_inprog", "Done" => "opt_done"}
    assert meta.viewer_login == "babie"
  end

  test "maybe_warmup!/0 is a no-op when tracker.kind is not github" do
    Application.put_env(:symphony_elixir, :tracker, %{
      kind: "linear",
      active_states: [],
      terminal_states: [],
      doing_state: nil,
      done_state: nil
    })

    assert :ok = ProjectMeta.maybe_warmup!()
    assert_raise RuntimeError, ~r/not warmed up/, fn -> ProjectMeta.fetch!() end
  end

  test "warmup!/0 falls back to organization when user has no project" do
    Req.Test.stub(SymphonyElixir.Github.Client, fn conn ->
      {:ok, body, conn} = Plug.Conn.read_body(conn)
      payload = Jason.decode!(body)
      query = payload["query"]

      cond do
        String.contains?(query, "SymphonyGithubProjectMetaOrg") ->
          Req.Test.json(conn, %{
            "data" => %{"organization" => %{"projectV2" => stub_user_project_response()["data"]["user"]["projectV2"]}}
          })

        String.contains?(query, "SymphonyGithubProjectMeta") ->
          Req.Test.json(conn, %{"data" => %{"user" => nil}})

        String.contains?(query, "SymphonyGithubViewer") ->
          Req.Test.json(conn, stub_viewer_response())
      end
    end)

    assert :ok = ProjectMeta.warmup!()
    assert ProjectMeta.fetch!().project_id == "PVT_kwDO_test"
  end

  test "warmup!/0 raises when project not found in user or org" do
    Req.Test.stub(SymphonyElixir.Github.Client, fn conn ->
      {:ok, body, conn} = Plug.Conn.read_body(conn)
      payload = Jason.decode!(body)
      query = payload["query"]

      cond do
        String.contains?(query, "SymphonyGithubProjectMetaOrg") ->
          Req.Test.json(conn, %{"data" => %{"organization" => nil}})

        String.contains?(query, "SymphonyGithubProjectMeta") ->
          Req.Test.json(conn, %{"data" => %{"user" => nil}})

        true ->
          Req.Test.json(conn, %{"data" => %{}})
      end
    end)

    assert_raise RuntimeError, ~r/GitHub project not found/, fn -> ProjectMeta.warmup!() end
  end

  test "warmup!/0 raises when Status SingleSelect field is missing" do
    Req.Test.stub(SymphonyElixir.Github.Client, fn conn ->
      Req.Test.json(conn, %{
        "data" => %{
          "user" => %{
            "projectV2" => %{
              "id" => "PVT_kwDO_test",
              "title" => "Sandbox",
              "fields" => %{"nodes" => []}
            }
          }
        }
      })
    end)

    assert_raise RuntimeError, ~r/no Status SingleSelect/, fn -> ProjectMeta.warmup!() end
  end

  test "warmup!/0 raises when active_states contains an unknown option" do
    Application.put_env(:symphony_elixir, :tracker, %{
      kind: "github",
      active_states: ["Todo", "Triage"],
      terminal_states: ["Done"],
      doing_state: "In Progress",
      done_state: "Done"
    })

    Req.Test.stub(SymphonyElixir.Github.Client, &stub_default/1)

    assert_raise RuntimeError, ~r/Triage/, fn -> ProjectMeta.warmup!() end
  end

  test "option_id!/1 raises on unknown name even after warmup" do
    Req.Test.stub(SymphonyElixir.Github.Client, &stub_default/1)
    :ok = ProjectMeta.warmup!()
    assert_raise RuntimeError, ~r/Unknown Status option/, fn -> ProjectMeta.option_id!("Nowhere") end
  end
end
```

- [ ] **Step 2: テスト失敗確認**

```bash
cd apps/symphony && mix test test/symphony_elixir/github/project_meta_test.exs
```

Expected: `** (UndefinedFunctionError) SymphonyElixir.Github.ProjectMeta.warmup!/0`

- [ ] **Step 3: ProjectMeta 実装**

```elixir
# apps/symphony/lib/symphony_elixir/github/project_meta.ex
defmodule SymphonyElixir.Github.ProjectMeta do
  @moduledoc """
  Warms up GitHub project metadata at Symphony startup, validates that all
  configured Status names exist as ProjectV2 SingleSelect options, and caches
  the resolved ids in `:persistent_term` for the lifetime of the BEAM node.

  Cache key: `{__MODULE__, :meta}`. Tests may inject a fixture via
  `Application.put_env(:symphony_elixir, :github_project_meta, %ProjectMeta{...})`.
  """

  alias SymphonyElixir.Github.{Client, Queries}

  @persistent_key {__MODULE__, :meta}

  defstruct [
    :project_id,
    :status_field_id,
    :status_options,
    :viewer_login
  ]

  @type t :: %__MODULE__{
          project_id: String.t(),
          status_field_id: String.t(),
          status_options: %{String.t() => String.t()},
          viewer_login: String.t()
        }

  @spec maybe_warmup!() :: :ok
  def maybe_warmup! do
    case tracker().kind do
      "github" -> warmup!()
      _ -> :ok
    end
  end

  @spec warmup!() :: :ok
  def warmup! do
    github = github_settings()
    {project_id, status_field_id, status_options} = fetch_project!(github.project_owner, github.project_number)
    validate_status_names!(status_options)
    viewer_login = fetch_viewer!()

    meta = %__MODULE__{
      project_id: project_id,
      status_field_id: status_field_id,
      status_options: status_options,
      viewer_login: viewer_login
    }

    :persistent_term.put(@persistent_key, meta)
    :ok
  end

  @spec fetch!() :: t()
  def fetch! do
    case Application.get_env(:symphony_elixir, :github_project_meta) do
      %__MODULE__{} = injected ->
        injected

      _ ->
        try do
          :persistent_term.get(@persistent_key)
        rescue
          ArgumentError ->
            raise "Github.ProjectMeta not warmed up. Is tracker.kind == github?"
        end
    end
  end

  @spec option_id!(String.t()) :: String.t()
  def option_id!(state_name) when is_binary(state_name) do
    case fetch!().status_options[state_name] do
      nil -> raise "Unknown Status option: #{inspect(state_name)}"
      id -> id
    end
  end

  @doc false
  def __cache_key__, do: @persistent_key

  defp fetch_project!(owner, number) do
    case Client.graphql(Queries.project_meta(), %{owner: owner, number: number}) do
      {:ok, %{"data" => %{"user" => %{"projectV2" => %{} = project}}}} ->
        decode_project!(project)

      {:ok, %{"data" => %{"user" => nil}}} ->
        fetch_project_org!(owner, number)

      {:ok, %{"data" => %{"user" => %{"projectV2" => nil}}}} ->
        fetch_project_org!(owner, number)

      {:error, reason} ->
        raise "GitHub project lookup failed (user scope): #{inspect(reason)}"

      other ->
        raise "GitHub project lookup returned unexpected payload: #{inspect(other)}"
    end
  end

  defp fetch_project_org!(owner, number) do
    case Client.graphql(Queries.project_meta_org(), %{owner: owner, number: number}) do
      {:ok, %{"data" => %{"organization" => %{"projectV2" => %{} = project}}}} ->
        decode_project!(project)

      {:ok, _} ->
        raise "GitHub project not found: owner=#{owner}, number=#{number}"

      {:error, reason} ->
        raise "GitHub project lookup failed (org scope): #{inspect(reason)}"
    end
  end

  defp decode_project!(%{"id" => project_id, "fields" => %{"nodes" => fields}}) do
    case Enum.find(fields, &status_single_select?/1) do
      %{"id" => field_id, "options" => options} ->
        options_map =
          options
          |> Enum.map(fn %{"id" => id, "name" => name} -> {name, id} end)
          |> Map.new()

        {project_id, field_id, options_map}

      _ ->
        raise "GitHub project has no Status SingleSelect field"
    end
  end

  defp status_single_select?(%{
         "__typename" => "ProjectV2SingleSelectField",
         "name" => "Status"
       }), do: true

  defp status_single_select?(_), do: false

  defp validate_status_names!(options_map) do
    tracker = tracker()

    [:active_states, :terminal_states]
    |> Enum.each(fn key ->
      names = Map.get(tracker, key, []) || []
      missing = Enum.reject(names, &Map.has_key?(options_map, &1))

      if missing != [] do
        raise "Unknown Status option(s) in #{key}: #{inspect(missing)}. Available: #{inspect(Map.keys(options_map))}"
      end
    end)

    [:doing_state, :done_state]
    |> Enum.each(fn key ->
      case Map.get(tracker, key) do
        nil ->
          :ok

        name when is_binary(name) ->
          unless Map.has_key?(options_map, name) do
            raise "Unknown Status option in #{key}: #{inspect(name)}. Available: #{inspect(Map.keys(options_map))}"
          end
      end
    end)
  end

  defp fetch_viewer! do
    case Client.graphql(Queries.viewer(), %{}) do
      {:ok, %{"data" => %{"viewer" => %{"login" => login}}}} when is_binary(login) ->
        login

      {:ok, _} ->
        raise "Failed to resolve viewer login"

      {:error, reason} ->
        raise "GitHub viewer query failed: #{inspect(reason)}"
    end
  end

  defp github_settings do
    case Application.get_env(:symphony_elixir, :github) do
      %{project_owner: _, project_number: _} = m ->
        Map.new(m)

      _ ->
        github = SymphonyElixir.Config.settings!().github
        %{
          project_owner: github.project_owner,
          project_number: github.project_number,
          api_key: github.api_key,
          endpoint: github.endpoint
        }
    end
  end

  defp tracker do
    case Application.get_env(:symphony_elixir, :tracker) do
      %{} = m ->
        Map.new(m)

      _ ->
        tracker = SymphonyElixir.Config.settings!().tracker

        %{
          kind: tracker.kind,
          active_states: tracker.active_states,
          terminal_states: tracker.terminal_states,
          doing_state: tracker.doing_state,
          done_state: tracker.done_state
        }
    end
  end
end
```

- [ ] **Step 4: テスト緑確認**

```bash
cd apps/symphony && mix test test/symphony_elixir/github/project_meta_test.exs
```

Expected: 7 tests, 0 failures

- [ ] **Step 5: コミット**

```bash
git add apps/symphony/lib/symphony_elixir/github/project_meta.ex \
        apps/symphony/test/symphony_elixir/github/project_meta_test.exs
git commit -m "feat(symphony): add Github.ProjectMeta with fail-fast warmup and cache"
```

---

## Task 8: `Github.Adapter` — `fetch_candidate_issues`

Adapter モジュール雛形と最初の callback を実装。ページングと active_states / assignee フィルタを行う。

**Files:**
- Create: `apps/symphony/lib/symphony_elixir/github/adapter.ex`
- Create: `apps/symphony/test/symphony_elixir/github/adapter_test.exs`

- [ ] **Step 1: テスト fixture を書く**

```elixir
# apps/symphony/test/symphony_elixir/github/adapter_test.exs
defmodule SymphonyElixir.Github.AdapterTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Github.{Adapter, IssueExtra, ProjectMeta}
  alias SymphonyElixir.Tracker.Issue, as: TIssue

  @project_id "PVT_kwDO_test"

  setup do
    Application.put_env(:symphony_elixir, :github, %{
      api_key: "test-token",
      endpoint: "http://gh-test.local/graphql",
      project_owner: "babie",
      project_number: 5,
      assignee: nil
    })

    Application.put_env(:symphony_elixir, :tracker, %{
      kind: "github",
      active_states: ["Todo", "In Progress"],
      terminal_states: ["Done"],
      doing_state: "In Progress",
      done_state: "Done"
    })

    Application.put_env(:symphony_elixir, :github_project_meta, %ProjectMeta{
      project_id: @project_id,
      status_field_id: "PVTSSF_status",
      status_options: %{"Todo" => "opt_todo", "In Progress" => "opt_inprog", "Done" => "opt_done"},
      viewer_login: "babie"
    })

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :github)
      Application.delete_env(:symphony_elixir, :tracker)
      Application.delete_env(:symphony_elixir, :github_project_meta)
    end)

    :ok
  end

  defp item_node(opts) do
    %{
      "id" => Keyword.fetch!(opts, :item_id),
      "content" => %{
        "__typename" => "Issue",
        "id" => Keyword.fetch!(opts, :issue_id),
        "number" => Keyword.fetch!(opts, :number),
        "title" => Keyword.get(opts, :title, "Some issue"),
        "body" => Keyword.get(opts, :body, ""),
        "url" => "https://github.com/babie/concert/issues/#{Keyword.fetch!(opts, :number)}",
        "repository" => %{"nameWithOwner" => "babie/concert"},
        "assignees" => %{"nodes" => Enum.map(Keyword.get(opts, :assignees, []), &%{"login" => &1})},
        "labels" => %{"nodes" => []},
        "createdAt" => "2026-05-10T10:00:00Z",
        "updatedAt" => "2026-05-12T11:00:00Z"
      },
      "fieldValues" => %{
        "nodes" => [
          %{
            "__typename" => "ProjectV2ItemFieldSingleSelectValue",
            "field" => %{"name" => "Status"},
            "name" => Keyword.fetch!(opts, :state),
            "optionId" => "opt_x"
          }
        ]
      }
    }
  end

  defp poll_page(items, opts \\ []) do
    %{
      "data" => %{
        "node" => %{
          "items" => %{
            "nodes" => items,
            "pageInfo" => %{
              "hasNextPage" => Keyword.get(opts, :has_next, false),
              "endCursor" => Keyword.get(opts, :cursor)
            }
          }
        }
      }
    }
  end

  describe "fetch_candidate_issues/0" do
    test "filters items whose Status is in active_states" do
      items = [
        item_node(item_id: "PVTI_1", issue_id: "I_1", number: 1, state: "Todo"),
        item_node(item_id: "PVTI_2", issue_id: "I_2", number: 2, state: "Done"),
        item_node(item_id: "PVTI_3", issue_id: "I_3", number: 3, state: "In Progress")
      ]

      Req.Test.stub(SymphonyElixir.Github.Client, fn conn ->
        {:ok, body, conn} = Plug.Conn.read_body(conn)
        payload = Jason.decode!(body)
        assert payload["variables"]["projectId"] == "PVT_kwDO_test"
        Req.Test.json(conn, poll_page(items))
      end)

      assert {:ok, results} = Adapter.fetch_candidate_issues()
      ids = Enum.map(results, & &1.id)
      assert "I_1" in ids
      assert "I_3" in ids
      refute "I_2" in ids
    end

    test "applies assignee filter when github.assignee is set" do
      Application.put_env(:symphony_elixir, :github, %{
        api_key: "test-token",
        endpoint: "http://gh-test.local/graphql",
        project_owner: "babie",
        project_number: 5,
        assignee: "babie"
      })

      items = [
        item_node(item_id: "PVTI_1", issue_id: "I_1", number: 1, state: "Todo", assignees: ["alice"]),
        item_node(item_id: "PVTI_2", issue_id: "I_2", number: 2, state: "Todo", assignees: ["babie"])
      ]

      Req.Test.stub(SymphonyElixir.Github.Client, fn conn ->
        Req.Test.json(conn, poll_page(items))
      end)

      assert {:ok, [%TIssue{id: "I_2"}]} = Adapter.fetch_candidate_issues()
    end

    test "resolves 'me' to viewer_login from ProjectMeta" do
      Application.put_env(:symphony_elixir, :github, %{
        api_key: "test-token",
        endpoint: "http://gh-test.local/graphql",
        project_owner: "babie",
        project_number: 5,
        assignee: "me"
      })

      items = [
        item_node(item_id: "PVTI_1", issue_id: "I_1", number: 1, state: "Todo", assignees: ["babie"]),
        item_node(item_id: "PVTI_2", issue_id: "I_2", number: 2, state: "Todo", assignees: ["alice"])
      ]

      Req.Test.stub(SymphonyElixir.Github.Client, fn conn ->
        Req.Test.json(conn, poll_page(items))
      end)

      assert {:ok, [%TIssue{id: "I_1"}]} = Adapter.fetch_candidate_issues()
    end

    test "paginates with after cursor until hasNextPage is false" do
      page1_items = [item_node(item_id: "PVTI_1", issue_id: "I_1", number: 1, state: "Todo")]
      page2_items = [item_node(item_id: "PVTI_2", issue_id: "I_2", number: 2, state: "Todo")]

      Req.Test.stub(SymphonyElixir.Github.Client, fn conn ->
        {:ok, body, conn} = Plug.Conn.read_body(conn)
        payload = Jason.decode!(body)
        case payload["variables"]["after"] do
          nil -> Req.Test.json(conn, poll_page(page1_items, has_next: true, cursor: "cur1"))
          "cur1" -> Req.Test.json(conn, poll_page(page2_items, has_next: false))
        end
      end)

      assert {:ok, [%TIssue{id: "I_1"}, %TIssue{id: "I_2"}]} = Adapter.fetch_candidate_issues()
    end

    test "issue carries extra.project_item_id matching the ProjectV2Item id" do
      items = [item_node(item_id: "PVTI_aaa", issue_id: "I_aaa", number: 7, state: "Todo")]

      Req.Test.stub(SymphonyElixir.Github.Client, fn conn ->
        Req.Test.json(conn, poll_page(items))
      end)

      assert {:ok, [%TIssue{extra: %IssueExtra{project_item_id: "PVTI_aaa"}}]} =
               Adapter.fetch_candidate_issues()
    end
  end
end
```

- [ ] **Step 2: テスト失敗確認**

```bash
cd apps/symphony && mix test test/symphony_elixir/github/adapter_test.exs
```

Expected: `** (UndefinedFunctionError) SymphonyElixir.Github.Adapter.fetch_candidate_issues/0`

- [ ] **Step 3: Adapter モジュール雛形 + `fetch_candidate_issues` 実装**

```elixir
# apps/symphony/lib/symphony_elixir/github/adapter.ex
defmodule SymphonyElixir.Github.Adapter do
  @moduledoc """
  Tracker adapter backed by GitHub Projects v2.
  """

  @behaviour SymphonyElixir.Tracker

  alias SymphonyElixir.Github.{Client, ProjectMeta, Queries}
  alias SymphonyElixir.Github.Issue, as: GithubIssue
  alias SymphonyElixir.Tracker.Issue, as: TIssue

  @page_size 50

  @impl true
  def fetch_candidate_issues do
    meta = ProjectMeta.fetch!()
    active = active_states()
    assignee = assignee_filter(meta)

    with {:ok, items} <- paginate_items(meta.project_id, nil, []) do
      issues =
        items
        |> Enum.map(&GithubIssue.normalize_item(&1, %{project_id: meta.project_id, viewer_login: meta.viewer_login}))
        |> Enum.reject(&is_nil/1)
        |> Enum.filter(&state_in?(&1, active))
        |> Enum.filter(&assignee_match?(&1, assignee))

      {:ok, issues}
    end
  end

  # Stubs for callbacks implemented in later tasks.
  @impl true
  def fetch_issues_by_states(_state_names), do: {:error, :not_implemented}

  @impl true
  def fetch_issue_states_by_ids(_issue_ids), do: {:error, :not_implemented}

  @impl true
  def create_comment(_issue_id, _body), do: {:error, :not_implemented}

  @impl true
  def update_issue_state(_issue, _state_name), do: {:error, :not_implemented}

  defp paginate_items(project_id, cursor, acc) do
    vars = %{projectId: project_id, first: @page_size, after: cursor}

    case Client.graphql(Queries.poll_items(), vars) do
      {:ok, %{"data" => %{"node" => %{"items" => %{"nodes" => nodes, "pageInfo" => page_info}}}}} ->
        new_acc = acc ++ nodes

        case page_info do
          %{"hasNextPage" => true, "endCursor" => end_cursor} when is_binary(end_cursor) ->
            paginate_items(project_id, end_cursor, new_acc)

          _ ->
            {:ok, new_acc}
        end

      {:ok, _} ->
        {:error, :github_unexpected_payload}

      {:error, _reason} = err ->
        err
    end
  end

  defp active_states do
    case Application.get_env(:symphony_elixir, :tracker) do
      %{active_states: v} when is_list(v) -> v
      _ -> SymphonyElixir.Config.settings!().tracker.active_states
    end
  end

  defp assignee_filter(meta) do
    setting =
      case Application.get_env(:symphony_elixir, :github) do
        %{assignee: v} -> v
        _ -> SymphonyElixir.Config.settings!().github.assignee
      end

    case setting do
      nil -> nil
      "me" -> meta.viewer_login
      login when is_binary(login) -> login
    end
  end

  defp state_in?(%TIssue{state: state}, active), do: state in active

  defp assignee_match?(_issue, nil), do: true
  defp assignee_match?(%TIssue{assignee_id: nil}, _), do: false
  defp assignee_match?(%TIssue{assignee_id: id}, login), do: id == login
end
```

注: `assignee_match?` は `Tracker.Issue.assignee_id` (= 先頭 assignee の login) しか見ない。複数 assignee のうち他に login が居るケースは漏れるので、後で要件があれば normalize_item で `assignee_logins` を別途持たせる方向に拡張する (Phase 2 スコープ外)。

- [ ] **Step 4: テスト緑確認**

```bash
cd apps/symphony && mix test test/symphony_elixir/github/adapter_test.exs
```

Expected: 5 tests, 0 failures

- [ ] **Step 5: コミット**

```bash
git add apps/symphony/lib/symphony_elixir/github/adapter.ex \
        apps/symphony/test/symphony_elixir/github/adapter_test.exs
git commit -m "feat(symphony): add Github.Adapter fetch_candidate_issues"
```

---

## Task 9: `Github.Adapter` — `fetch_issues_by_states` + `fetch_issue_states_by_ids`

**Files:**
- Modify: `apps/symphony/lib/symphony_elixir/github/adapter.ex`
- Modify: `apps/symphony/test/symphony_elixir/github/adapter_test.exs`

- [ ] **Step 1: `fetch_issues_by_states` のテスト追加**

`adapter_test.exs` に describe ブロック追加:

```elixir
describe "fetch_issues_by_states/1" do
  test "returns items whose Status is in the given list (ignores assignee)" do
    items = [
      item_node(item_id: "PVTI_1", issue_id: "I_1", number: 1, state: "Done", assignees: ["alice"]),
      item_node(item_id: "PVTI_2", issue_id: "I_2", number: 2, state: "Todo", assignees: ["babie"]),
      item_node(item_id: "PVTI_3", issue_id: "I_3", number: 3, state: "Done", assignees: ["babie"])
    ]

    Req.Test.stub(SymphonyElixir.Github.Client, fn conn ->
      Req.Test.json(conn, poll_page(items))
    end)

    assert {:ok, results} = Adapter.fetch_issues_by_states(["Done"])
    ids = results |> Enum.map(& &1.id) |> Enum.sort()
    assert ids == ["I_1", "I_3"]
  end

  test "returns empty list when input states is empty" do
    Req.Test.stub(SymphonyElixir.Github.Client, fn _ -> flunk("should not call API") end)
    assert {:ok, []} = Adapter.fetch_issues_by_states([])
  end
end
```

- [ ] **Step 2: テスト失敗確認**

```bash
cd apps/symphony && mix test test/symphony_elixir/github/adapter_test.exs
```

Expected: `fetch_issues_by_states` の 2 件失敗

- [ ] **Step 3: 実装を追加**

`adapter.ex` の `fetch_issues_by_states` を実装に差し替え:

```elixir
@impl true
def fetch_issues_by_states([]), do: {:ok, []}

def fetch_issues_by_states(state_names) when is_list(state_names) do
  meta = ProjectMeta.fetch!()
  states = Enum.map(state_names, &to_string/1) |> Enum.uniq()

  with {:ok, items} <- paginate_items(meta.project_id, nil, []) do
    issues =
      items
      |> Enum.map(&GithubIssue.normalize_item(&1, %{project_id: meta.project_id, viewer_login: meta.viewer_login}))
      |> Enum.reject(&is_nil/1)
      |> Enum.filter(&(&1.state in states))

    {:ok, issues}
  end
end
```

- [ ] **Step 4: テスト緑確認**

```bash
cd apps/symphony && mix test test/symphony_elixir/github/adapter_test.exs
```

Expected: 7 tests (新規 2 含む) 全部緑

- [ ] **Step 5: `fetch_issue_states_by_ids` のテスト追加**

```elixir
# adapter_test.exs に追記
defp issues_by_ids_response(issues) do
  %{
    "data" => %{
      "nodes" => issues
    }
  }
end

defp issue_node(opts) do
  %{
    "id" => Keyword.fetch!(opts, :issue_id),
    "number" => Keyword.fetch!(opts, :number),
    "title" => Keyword.get(opts, :title, "Issue"),
    "body" => "",
    "url" => "https://github.com/babie/concert/issues/#{Keyword.fetch!(opts, :number)}",
    "repository" => %{"nameWithOwner" => "babie/concert"},
    "projectItems" => %{
      "nodes" => [
        %{
          "id" => Keyword.fetch!(opts, :item_id),
          "project" => %{"id" => Keyword.get(opts, :project_id, @project_id)},
          "fieldValues" => %{
            "nodes" => [
              %{
                "__typename" => "ProjectV2ItemFieldSingleSelectValue",
                "field" => %{"name" => "Status"},
                "name" => Keyword.fetch!(opts, :state),
                "optionId" => "opt_x"
              }
            ]
          }
        }
      ]
    },
    "assignees" => %{"nodes" => [%{"login" => "babie"}]},
    "labels" => %{"nodes" => []},
    "createdAt" => "2026-05-10T10:00:00Z",
    "updatedAt" => "2026-05-12T11:00:00Z"
  }
end

describe "fetch_issue_states_by_ids/1" do
  test "returns issues with state and extra.project_item_id resolved" do
    Req.Test.stub(SymphonyElixir.Github.Client, fn conn ->
      {:ok, body, conn} = Plug.Conn.read_body(conn)
      payload = Jason.decode!(body)
      assert payload["variables"]["ids"] == ["I_aaa", "I_bbb"]
      Req.Test.json(conn, issues_by_ids_response([
        issue_node(issue_id: "I_aaa", item_id: "PVTI_aaa", number: 1, state: "In Progress"),
        issue_node(issue_id: "I_bbb", item_id: "PVTI_bbb", number: 2, state: "Done")
      ]))
    end)

    assert {:ok, results} = Adapter.fetch_issue_states_by_ids(["I_aaa", "I_bbb"])
    assert [%TIssue{id: "I_aaa", state: "In Progress", extra: %IssueExtra{project_item_id: "PVTI_aaa"}},
            %TIssue{id: "I_bbb", state: "Done", extra: %IssueExtra{project_item_id: "PVTI_bbb"}}] = results
  end

  test "preserves request order" do
    Req.Test.stub(SymphonyElixir.Github.Client, fn conn ->
      Req.Test.json(conn, issues_by_ids_response([
        issue_node(issue_id: "I_bbb", item_id: "PVTI_bbb", number: 2, state: "Todo"),
        issue_node(issue_id: "I_aaa", item_id: "PVTI_aaa", number: 1, state: "Todo")
      ]))
    end)

    assert {:ok, [%TIssue{id: "I_aaa"}, %TIssue{id: "I_bbb"}]} =
             Adapter.fetch_issue_states_by_ids(["I_aaa", "I_bbb"])
  end

  test "returns empty list for empty input" do
    Req.Test.stub(SymphonyElixir.Github.Client, fn _ -> flunk("should not call API") end)
    assert {:ok, []} = Adapter.fetch_issue_states_by_ids([])
  end

  test "skips projectItems that belong to a different project" do
    Req.Test.stub(SymphonyElixir.Github.Client, fn conn ->
      Req.Test.json(conn, issues_by_ids_response([
        issue_node(issue_id: "I_x", item_id: "PVTI_x", project_id: "PVT_other", number: 99, state: "Todo")
      ]))
    end)

    assert {:ok, [%TIssue{id: "I_x", state: nil}]} =
             Adapter.fetch_issue_states_by_ids(["I_x"])
  end
end
```

- [ ] **Step 6: テスト失敗確認**

```bash
cd apps/symphony && mix test test/symphony_elixir/github/adapter_test.exs
```

Expected: `fetch_issue_states_by_ids` の 4 件失敗

- [ ] **Step 7: 実装を追加**

`adapter.ex` の `fetch_issue_states_by_ids` を差し替え:

```elixir
@impl true
def fetch_issue_states_by_ids([]), do: {:ok, []}

def fetch_issue_states_by_ids(issue_ids) when is_list(issue_ids) do
  meta = ProjectMeta.fetch!()
  ids = Enum.uniq(issue_ids)
  order_index = ids |> Enum.with_index() |> Map.new()

  case Client.graphql(Queries.issues_by_ids(), %{ids: ids}) do
    {:ok, %{"data" => %{"nodes" => nodes}}} ->
      issues =
        nodes
        |> Enum.map(&normalize_issue_node(&1, meta))
        |> Enum.reject(&is_nil/1)
        |> Enum.sort_by(fn %TIssue{id: id} -> Map.get(order_index, id, length(ids)) end)

      {:ok, issues}

    {:ok, _} ->
      {:error, :github_unexpected_payload}

    {:error, _reason} = err ->
      err
  end
end

defp normalize_issue_node(nil, _meta), do: nil

defp normalize_issue_node(%{"id" => issue_id} = node, meta) do
  matching_item =
    Enum.find(get_in(node, ["projectItems", "nodes"]) || [], fn item ->
      get_in(item, ["project", "id"]) == meta.project_id
    end)

  item_id =
    case matching_item do
      %{"id" => id} -> id
      _ -> nil
    end

  state =
    case matching_item do
      %{"fieldValues" => field_values} ->
        extract_status(field_values)

      _ ->
        nil
    end

  repo = get_in(node, ["repository", "nameWithOwner"]) || "unknown/unknown"
  number = node["number"]
  short_repo = repo |> String.split("/", parts: 2) |> List.last()

  %TIssue{
    id: issue_id,
    identifier: repo <> "#" <> Integer.to_string(number),
    title: node["title"],
    description: node["body"],
    state: state,
    branch_name: build_branch_name(meta.viewer_login, short_repo, number, node["title"]),
    url: node["url"],
    assignee_id: first_assignee(node["assignees"]),
    priority: nil,
    blocked_by: [],
    labels: extract_labels(node["labels"]),
    assigned_to_worker: true,
    created_at: parse_datetime(node["createdAt"]),
    updated_at: parse_datetime(node["updatedAt"]),
    source: :github,
    extra: build_extra(meta.project_id, item_id)
  }
end

defp normalize_issue_node(_other, _meta), do: nil

defp build_extra(_project_id, nil), do: nil
defp build_extra(project_id, item_id), do: %SymphonyElixir.Github.IssueExtra{project_id: project_id, project_item_id: item_id}

defp extract_status(%{"nodes" => nodes}) when is_list(nodes) do
  Enum.find_value(nodes, fn
    %{
      "__typename" => "ProjectV2ItemFieldSingleSelectValue",
      "field" => %{"name" => "Status"},
      "name" => name
    } when is_binary(name) -> name
    _ -> nil
  end)
end

defp extract_status(_), do: nil

defp first_assignee(%{"nodes" => [%{"login" => login} | _]}) when is_binary(login), do: login
defp first_assignee(_), do: nil

defp extract_labels(%{"nodes" => nodes}) when is_list(nodes) do
  nodes |> Enum.map(& &1["name"]) |> Enum.reject(&is_nil/1) |> Enum.map(&String.downcase/1)
end

defp extract_labels(_), do: []

defp parse_datetime(nil), do: nil

defp parse_datetime(raw) when is_binary(raw) do
  case DateTime.from_iso8601(raw) do
    {:ok, dt, _offset} -> dt
    _ -> nil
  end
end

defp build_branch_name(viewer, repo, number, title) do
  slug = SymphonyElixir.Github.Issue.slugify(title || "")
  base = "#{viewer}/#{repo}-#{number}"
  if slug == "", do: base, else: base <> "-" <> slug
end
```

注: branch_name / slug / 各種 extract 関数は `Github.Issue` 側にも存在する。**重複を避けるため、`Github.Issue` に `normalize_issue_node/2` の責務を吸収する** のが理想的だが、`normalize_item/2` は item 単位、こちらは issue 単位 (projectItems を含む) で構造が違う。リファクタは Phase 3 以降に回し、共通 helper だけ抽出する形にする。

- [ ] **Step 8: テスト緑確認**

```bash
cd apps/symphony && mix test test/symphony_elixir/github/adapter_test.exs
```

Expected: 11 tests 全部緑

- [ ] **Step 9: コミット**

```bash
git add apps/symphony/lib/symphony_elixir/github/adapter.ex \
        apps/symphony/test/symphony_elixir/github/adapter_test.exs
git commit -m "feat(symphony): add fetch_issues_by_states and fetch_issue_states_by_ids to Github.Adapter"
```

---

## Task 10: `Github.Adapter` — `create_comment` + `update_issue_state`

**Files:**
- Modify: `apps/symphony/lib/symphony_elixir/github/adapter.ex`
- Modify: `apps/symphony/test/symphony_elixir/github/adapter_test.exs`

- [ ] **Step 1: `create_comment` のテスト追加**

```elixir
describe "create_comment/2" do
  test "sends addComment mutation with subjectId and body" do
    Req.Test.stub(SymphonyElixir.Github.Client, fn conn ->
      {:ok, body, conn} = Plug.Conn.read_body(conn)
      payload = Jason.decode!(body)
      assert payload["query"] =~ "addComment"
      assert payload["variables"] == %{"subjectId" => "I_abc", "body" => "hello"}
      Req.Test.json(conn, %{"data" => %{"addComment" => %{"clientMutationId" => nil}}})
    end)

    assert :ok = Adapter.create_comment("I_abc", "hello")
  end

  test "returns {:error, {:github_graphql_errors, _}} when payload has errors" do
    Req.Test.stub(SymphonyElixir.Github.Client, fn conn ->
      Req.Test.json(conn, %{"errors" => [%{"message" => "bad"}]})
    end)

    assert {:error, {:github_graphql_errors, [%{"message" => "bad"}]}} =
             Adapter.create_comment("I_abc", "hi")
  end
end
```

- [ ] **Step 2: `update_issue_state` のテスト追加**

```elixir
describe "update_issue_state/2" do
  test "sends updateProjectV2ItemFieldValue with projectId/itemId/fieldId/optionId resolved" do
    issue = %TIssue{
      id: "I_abc",
      source: :github,
      extra: %IssueExtra{project_id: @project_id, project_item_id: "PVTI_abc"}
    }

    Req.Test.stub(SymphonyElixir.Github.Client, fn conn ->
      {:ok, body, conn} = Plug.Conn.read_body(conn)
      payload = Jason.decode!(body)
      assert payload["query"] =~ "updateProjectV2ItemFieldValue"
      assert payload["variables"] == %{
               "projectId" => "PVT_kwDO_test",
               "itemId" => "PVTI_abc",
               "fieldId" => "PVTSSF_status",
               "optionId" => "opt_inprog"
             }

      Req.Test.json(conn, %{"data" => %{"updateProjectV2ItemFieldValue" => %{"clientMutationId" => nil}}})
    end)

    assert :ok = Adapter.update_issue_state(issue, "In Progress")
  end

  test "raises when state name is not a known Status option" do
    issue = %TIssue{
      id: "I_abc",
      source: :github,
      extra: %IssueExtra{project_id: @project_id, project_item_id: "PVTI_abc"}
    }

    assert_raise RuntimeError, ~r/Unknown Status option/, fn ->
      Adapter.update_issue_state(issue, "Nowhere")
    end
  end
end
```

- [ ] **Step 3: テスト失敗確認**

```bash
cd apps/symphony && mix test test/symphony_elixir/github/adapter_test.exs
```

Expected: `create_comment` / `update_issue_state` の 4 件失敗

- [ ] **Step 4: 実装を追加**

`adapter.ex` の 2 callback を差し替え:

```elixir
@impl true
def create_comment(issue_id, body) when is_binary(issue_id) and is_binary(body) do
  case Client.graphql(Queries.add_comment(), %{subjectId: issue_id, body: body}) do
    {:ok, %{"data" => %{"addComment" => _}}} ->
      :ok

    {:ok, %{"errors" => errors}} ->
      {:error, {:github_graphql_errors, errors}}

    {:ok, _} ->
      {:error, :github_unexpected_payload}

    {:error, _reason} = err ->
      err
  end
end

@impl true
def update_issue_state(%TIssue{extra: %SymphonyElixir.Github.IssueExtra{project_id: project_id, project_item_id: item_id}}, state_name)
    when is_binary(state_name) do
  meta = ProjectMeta.fetch!()
  option_id = ProjectMeta.option_id!(state_name)

  vars = %{
    projectId: project_id,
    itemId: item_id,
    fieldId: meta.status_field_id,
    optionId: option_id
  }

  case Client.graphql(Queries.update_item_status(), vars) do
    {:ok, %{"data" => %{"updateProjectV2ItemFieldValue" => _}}} ->
      :ok

    {:ok, %{"errors" => errors}} ->
      {:error, {:github_graphql_errors, errors}}

    {:ok, _} ->
      {:error, :github_unexpected_payload}

    {:error, _reason} = err ->
      err
  end
end
```

- [ ] **Step 5: テスト緑確認**

```bash
cd apps/symphony && mix test test/symphony_elixir/github/adapter_test.exs
```

Expected: 15 tests 全部緑

- [ ] **Step 6: コミット**

```bash
git add apps/symphony/lib/symphony_elixir/github/adapter.ex \
        apps/symphony/test/symphony_elixir/github/adapter_test.exs
git commit -m "feat(symphony): add create_comment and update_issue_state to Github.Adapter"
```

---

## Task 11: Tracker dispatch + Application warmup wiring

**Files:**
- Modify: `apps/symphony/lib/symphony_elixir/tracker.ex`
- Modify: `apps/symphony/lib/symphony_elixir.ex`
- Create: `apps/symphony/test/symphony_elixir/tracker_test.exs`

`Tracker.adapter/0` は本番では `Config.settings!()` を経由する。テストで Config 全体を入れ替えるのは重く、また kind → module の対応表だけ確認できれば dispatch ロジックの回帰検知としては十分なので、`Tracker.resolve_adapter/1` という pure helper を public 公開して、それをテストする。

- [ ] **Step 1: Tracker dispatch のテストを書く**

```elixir
# apps/symphony/test/symphony_elixir/tracker_test.exs
defmodule SymphonyElixir.TrackerDispatchTest do
  use ExUnit.Case, async: true
  alias SymphonyElixir.Tracker

  test "resolve_adapter/1 returns the right module per kind" do
    expectations = %{
      "memory" => SymphonyElixir.Tracker.Memory,
      "github" => SymphonyElixir.Github.Adapter,
      "linear" => SymphonyElixir.Linear.Adapter,
      nil => SymphonyElixir.Linear.Adapter
    }

    Enum.each(expectations, fn {kind, expected} ->
      assert Tracker.resolve_adapter(kind) == expected
    end)
  end
end
```

- [ ] **Step 2: テスト失敗確認**

```bash
cd apps/symphony && mix test test/symphony_elixir/tracker_test.exs
```

Expected: `Tracker.resolve_adapter/1` undefined

- [ ] **Step 3: `tracker.ex` を更新**

```elixir
# apps/symphony/lib/symphony_elixir/tracker.ex
defmodule SymphonyElixir.Tracker do
  alias SymphonyElixir.{Config, Tracker.Issue}

  @callback fetch_candidate_issues() :: {:ok, [Issue.t()]} | {:error, term()}
  @callback fetch_issues_by_states([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  @callback fetch_issue_states_by_ids([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  @callback create_comment(String.t(), String.t()) :: :ok | {:error, term()}
  @callback update_issue_state(Issue.t(), String.t()) :: :ok | {:error, term()}

  @spec fetch_candidate_issues() :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_candidate_issues, do: adapter().fetch_candidate_issues()

  @spec fetch_issues_by_states([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_states(states), do: adapter().fetch_issues_by_states(states)

  @spec fetch_issue_states_by_ids([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issue_states_by_ids(issue_ids), do: adapter().fetch_issue_states_by_ids(issue_ids)

  @spec create_comment(String.t(), String.t()) :: :ok | {:error, term()}
  def create_comment(issue_id, body), do: adapter().create_comment(issue_id, body)

  @spec update_issue_state(Issue.t(), String.t()) :: :ok | {:error, term()}
  def update_issue_state(%Issue{} = issue, state_name) do
    adapter().update_issue_state(issue, state_name)
  end

  @spec adapter() :: module()
  def adapter, do: resolve_adapter(Config.settings!().tracker.kind)

  @doc false
  @spec resolve_adapter(String.t() | nil) :: module()
  def resolve_adapter("memory"), do: SymphonyElixir.Tracker.Memory
  def resolve_adapter("github"), do: SymphonyElixir.Github.Adapter
  def resolve_adapter(_other), do: SymphonyElixir.Linear.Adapter
end
```

- [ ] **Step 4: `symphony_elixir.ex` に warmup フックを追加**

```elixir
# apps/symphony/lib/symphony_elixir.ex
defmodule SymphonyElixir.Application do
  use Application

  @impl true
  def start(_type, _args) do
    :ok = SymphonyElixir.LogFile.configure()
    :ok = SymphonyElixir.Github.ProjectMeta.maybe_warmup!()

    children = [
      {Phoenix.PubSub, name: SymphonyElixir.PubSub},
      {Task.Supervisor, name: SymphonyElixir.TaskSupervisor},
      SymphonyElixir.WorkflowStore,
      SymphonyElixir.Orchestrator,
      SymphonyElixir.HttpServer,
      SymphonyElixir.StatusDashboard
    ]

    Supervisor.start_link(
      children,
      strategy: :one_for_one,
      name: SymphonyElixir.Supervisor
    )
  end
end
```

注: `Config.settings!()` が `Application.start/2` の時点で利用可能か確認する。利用不能なら `WorkflowStore` の `start_link` が走った後の post-init で呼ぶ形に変える (CLI 経由ロード後)。

実装時に確認: `iex -S mix` で `Config.settings!()` がブートストラップ無しで失敗するなら、warmup の呼び出し位置を `CLI.run/1` に移す。

- [ ] **Step 5: 全テスト緑確認**

```bash
cd apps/symphony && mix test --warnings-as-errors
```

Expected: 全部緑

- [ ] **Step 6: コミット**

```bash
git add apps/symphony/lib apps/symphony/test
git commit -m "feat(symphony): wire Tracker dispatch to Github.Adapter and warmup on boot"
```

---

## Task 12: 実機 iex 動作確認 (手動)

実装プランで唯一の手動 step。ユーザがローカルで実行し、結果を確認する。

**Files:** (なし、手動操作のみ)

- [ ] **Step 1: テスト用 GitHub Project と issue を準備**

GitHub の web UI で以下を用意:
- ProjectV2 (個人 user 配下、例: `babie` の Project number 5)
- "Status" SingleSelect field、options: `Todo` / `In Progress` / `Done`
- 1 件 issue を作成し、ProjectV2 に Add、Status: `Todo`

- [ ] **Step 2: WORKFLOW.md を用意**

例 `/tmp/workflow.github.md`:

```markdown
---
agent:
  type: claude

claude:
  command: claude-app-server --model claude-opus-4-7 --permission-mode bypassPermissions

tracker:
  kind: github
  active_states: [Todo, "In Progress"]
  terminal_states: [Done]
  doing_state: "In Progress"
  done_state: Done

github:
  project_owner: babie
  project_number: 5
  assignee: me
---

# Test Workflow
prompt for issue: {{ issue.identifier }}
```

- [ ] **Step 3: PAT を export**

```bash
export GITHUB_TOKEN="ghp_xxx"  # repo + project スコープ
```

- [ ] **Step 4: iex 起動**

```bash
cd apps/symphony
iex -S mix
```

- [ ] **Step 5: 動作確認**

```elixir
SymphonyElixir.Config.load!("/tmp/workflow.github.md")
SymphonyElixir.Github.ProjectMeta.fetch!()
# %SymphonyElixir.Github.ProjectMeta{project_id: "PVT_...", status_field_id: "PVTSSF_...", ...}

{:ok, issues} = SymphonyElixir.Tracker.fetch_candidate_issues()
# [%SymphonyElixir.Tracker.Issue{source: :github, identifier: "babie/<repo>#<num>", ...}]

SymphonyElixir.Tracker.create_comment(hd(issues).id, "hello from symphony")
# :ok → GitHub UI でコメントが付くこと

SymphonyElixir.Tracker.update_issue_state(hd(issues), "In Progress")
# :ok → GitHub UI で Status が "In Progress" に変わること
```

- [ ] **Step 6: 結果記録**

確認できた挙動を `docs/superpowers/plans/2026-05-14-m2-phase2-github-adapter.md` の末尾に「実機確認 (YYYY-MM-DD)」セクションで追記。失敗があれば該当 Task に戻って修正、再度 Step 5 を回す。

- [ ] **Step 7: 最終コミット (記録のみの場合)**

```bash
git add docs/superpowers/plans/2026-05-14-m2-phase2-github-adapter.md
git commit -m "docs(plans): record M2 Phase 2 manual iex verification"
```

---

## 完了条件

- [x] Task 1-12 すべて完了 (Task 12 は実機確認の結果を記録)
- [x] `cd apps/symphony && mix test --warnings-as-errors` 全緑 (284 tests)
- [x] iex で 3 操作 (`fetch_candidate_issues` / `create_comment` / `update_issue_state`) が実機 GitHub Project に対して動く
- [ ] `TODO.md` Milestone 2 Phase 2 のチェックボックスをすべて埋める

---

## 実機確認 (2026-05-14)

`iex -S mix run --no-start` から `/tmp/workflow.github.md` (tracker.kind: github、project_owner: babie、project_number: 3、assignee: me) を使って GitHub Project に対して以下を確認:

- `Github.ProjectMeta.maybe_warmup!/0` → `:ok`、`status_options: %{"Done" => "98236657", "In Progress" => "47fc9ee4", "Todo" => "f75ad846"}` がキャッシュされた
- `Tracker.fetch_candidate_issues/0` → 該当 issue 1 件 (`babie/concert#1`、Status: Todo、assignee_id: babie、`extra.project_item_id: PVTI_lAHNKzfOAV7Xds4LMB8I`) を取得
- `Tracker.create_comment/2` → 対象 Issue に "hello from symphony" コメント投稿成功
- `Tracker.update_issue_state(issue, "In Progress")` → Status が Todo → In Progress に遷移
- `Tracker.update_issue_state(issue, "Todo")` → Status を Todo に戻して後始末

### 実機確認中に見つかった問題と対応

1. **`Github.Client` が `plug: {Req.Test, __MODULE__}` を無条件に渡しており、`iex --no-start` で `Req.Test.Ownership` 不在によりクラッシュ。** Mix.env() == :test 時のみ plug を注入するよう修正 (commit `6f49024`)。Phase 5 のコードレビューで Important として flag されていた懸念がそのまま現実化した。

2. **fine-grained PAT (`github_pat_...`) は user-owned ProjectV2 をサポートしない (GitHub の既知の制限)。** Classic PAT (`ghp_...`) を `repo` + `project` scope で発行する必要がある。`README` / `examples/workflow.github.md` 整備時 (Phase 4) に明記すること。

3. **`assignee: me` のとき viewer_login と issue.assignees[].login が一致する必要あり。** Project に Issue を Add しただけでは assignee は付かない。GitHub UI で Issue 側の Assignees を明示的に設定する必要がある — fail-fast にはならず空リストが返るだけなので、運用ノウハウとして README に記載すべき。

### 起動コマンド (再現用)

```bash
cd apps/symphony
export GITHUB_TOKEN=ghp_...        # classic PAT、repo + project scope
iex -S mix run --no-start
```

```elixir
{:ok, _} = Application.ensure_all_started(:req)
SymphonyElixir.Workflow.set_workflow_file_path("/tmp/workflow.github.md")
SymphonyElixir.LogFile.configure()
SymphonyElixir.Github.ProjectMeta.maybe_warmup!()
{:ok, [issue | _]} = SymphonyElixir.Tracker.fetch_candidate_issues()
SymphonyElixir.Tracker.create_comment(issue.id, "hello from symphony")
SymphonyElixir.Tracker.update_issue_state(issue, "In Progress")
SymphonyElixir.Tracker.update_issue_state(issue, "Todo")
```
