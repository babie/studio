# Milestone 2 Phase 1: tracker スキーマ kind 別分割 — 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WORKFLOW.md の `tracker:` ブロックを共通フィールド + per-kind サブブロック (`linear:` / `github:`) に分割し、Symphony の全 fixture/example/doc を新スキーマで通る状態にする。機能追加なし、純粋な schema migration + breaking sweep。

**Architecture:** 既存の `agent.type` パターン（[ADR-0004](../../adr/0004-agent-type-backend-selection.md)）に倣う。`Tracker` embed を縮小し、新規 `Linear` / `Github` embed を追加。`tracker.kind` で読まれるブロックが切り替わる。env fallback は kind 別 (`linear` ↔ `LINEAR_API_KEY`、`github` ↔ `GITHUB_TOKEN`)。

**Tech Stack:** Elixir / Ecto Schema (embedded) / Mix test / YAML (front matter)

**Spec:** [`docs/superpowers/specs/2026-05-14-m2-phase1-design.md`](../specs/2026-05-14-m2-phase1-design.md)

**作業ブランチ:** 既存 main で進める想定（Phase 1 単独でマージ可能）

---

## ファイル構成

| 種別 | パス | 役割 |
|---|---|---|
| 変更 | `apps/symphony/lib/symphony_elixir/config/schema.ex` | embed 定義、cast_embed、finalize_settings の env fallback |
| 変更 | `apps/symphony/lib/symphony_elixir/config.ex` | `validate_semantics/1` の kind 別チェック |
| 変更 | `apps/symphony/lib/symphony_elixir/linear/client.ex` | `settings.tracker.*` → `settings.linear.*` |
| 変更 | `apps/symphony/test/support/test_support.exs` | `workflow_content` ヘルパーの新スキーマ対応 |
| 変更 | `apps/symphony/test/symphony_elixir/core_test.exs` | assertion パス更新、Github 関連テスト追加 |
| 変更 | `apps/symphony/test/symphony_elixir/workspace_and_config_test.exs` | env fallback アサート 2 件 |
| 変更 | `apps/symphony/WORKFLOW.md` | 新スキーマ構造 |
| 変更 | `apps/symphony/examples/workflow.claude.md` | 同上 |
| 変更 | `apps/symphony/CLAUDE.md` | `tracker.kind` の説明追加 |

**Sweep 対象から外れたもの（事前 grep で YAML スキーマ例が無いことを確認済み）:**

- `apps/symphony/examples/workflow.codex.md`（ファイル自体が存在しない）
- `docs/protocol.md` / `docs/architecture.md` / ルート `CLAUDE.md`（tracker 関連はプロセス記述だけで YAML 例なし）
- 過去のスペック・プラン（`docs/superpowers/specs/2026-05-10-symphony-phase1-design.md` 等）は歴史的記録のためそのまま残す

**スコープ外（Phase 2 以降で扱う、本プランで触らない）:**

- `apps/symphony/lib/symphony_elixir/tracker.ex`（adapter dispatch）
- `apps/symphony/lib/symphony_elixir/github/` 一式（モジュール自体まだ無い）
- Status field option との runtime validation
- `examples/workflow.github.md` の新規作成

---

## 実装順序の方針

Schema migration は coordinated refactor なので、純粋 TDD（test-first）よりも「**小さな step を積みながら mix test を緑のままに保つ**」を優先する。各 Task は単一論点・単一 commit を目安に切る。

1. Schema 側の構造変更（Task 1〜3）
2. 既存テスト fixture / アサーションの追従（Task 4〜6）
3. 新規 GitHub 用 validation テスト追加（Task 7）
4. example WORKFLOW.md sweep（Task 8）
5. doc sweep（Task 9）

各 Task の末尾で必ず `mix test --warnings-as-errors` を緑にしてからコミット。

---

## Task 1: `Linear` / `Github` embed モジュール + 新 Tracker フィールド追加

**Files:**
- Modify: `apps/symphony/lib/symphony_elixir/config/schema.ex`

embed 定義のみ。top-level 配線・env fallback はまだ触らない。

- [ ] **Step 1: schema.ex の `Tracker` embed を縮小し、新フィールドを追加**

`apps/symphony/lib/symphony_elixir/config/schema.ex` L40-66 を置換する。`Tracker` モジュール全体を以下に書き換え:

```elixir
  defmodule Tracker do
    @moduledoc false
    use Ecto.Schema
    import Ecto.Changeset

    @primary_key false

    embedded_schema do
      field(:kind, :string)
      field(:active_states, {:array, :string}, default: ["Todo", "In Progress"])
      field(:terminal_states, {:array, :string}, default: ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"])
      field(:doing_state, :string)
      field(:done_state, :string)
    end

    @spec changeset(%__MODULE__{}, map()) :: Ecto.Changeset.t()
    def changeset(schema, attrs) do
      schema
      |> cast(
        attrs,
        [:kind, :active_states, :terminal_states, :doing_state, :done_state],
        empty_values: []
      )
    end
  end
```

旧フィールド (`endpoint`, `api_key`, `project_slug`, `assignee`) は消える。

- [ ] **Step 2: 新規 `Linear` embed モジュールを追加**

L66 と `defmodule Polling` の間に挿入:

```elixir
  defmodule Linear do
    @moduledoc false
    use Ecto.Schema
    import Ecto.Changeset

    @primary_key false

    embedded_schema do
      field(:api_key, :string)
      field(:endpoint, :string, default: "https://api.linear.app/graphql")
      field(:project_slug, :string)
      field(:assignee, :string)
    end

    @spec changeset(%__MODULE__{}, map()) :: Ecto.Changeset.t()
    def changeset(schema, attrs) do
      schema
      |> cast(attrs, [:api_key, :endpoint, :project_slug, :assignee], empty_values: [])
    end
  end
```

- [ ] **Step 3: 新規 `Github` embed モジュールを追加**

`Linear` モジュールの直後に追加:

```elixir
  defmodule Github do
    @moduledoc false
    use Ecto.Schema
    import Ecto.Changeset

    @primary_key false

    embedded_schema do
      field(:api_key, :string)
      field(:endpoint, :string, default: "https://api.github.com/graphql")
      field(:project_owner, :string)
      field(:project_number, :integer)
      field(:assignee, :string)
    end

    @spec changeset(%__MODULE__{}, map()) :: Ecto.Changeset.t()
    def changeset(schema, attrs) do
      schema
      |> cast(attrs, [:api_key, :endpoint, :project_owner, :project_number, :assignee], empty_values: [])
    end
  end
```

- [ ] **Step 4: トップレベル `embedded_schema` に `linear` / `github` を追加**

`apps/symphony/lib/symphony_elixir/config/schema.ex` L283-294 を置換:

```elixir
  embedded_schema do
    embeds_one(:tracker, Tracker, on_replace: :update, defaults_to_struct: true)
    embeds_one(:linear, Linear, on_replace: :update, defaults_to_struct: true)
    embeds_one(:github, Github, on_replace: :update, defaults_to_struct: true)
    embeds_one(:polling, Polling, on_replace: :update, defaults_to_struct: true)
    embeds_one(:workspace, Workspace, on_replace: :update, defaults_to_struct: true)
    embeds_one(:worker, Worker, on_replace: :update, defaults_to_struct: true)
    embeds_one(:agent, Agent, on_replace: :update, defaults_to_struct: true)
    embeds_one(:codex, Codex, on_replace: :update, defaults_to_struct: true)
    embeds_one(:claude, Claude, on_replace: :update, defaults_to_struct: true)
    embeds_one(:hooks, Hooks, on_replace: :update, defaults_to_struct: true)
    embeds_one(:observability, Observability, on_replace: :update, defaults_to_struct: true)
    embeds_one(:server, Server, on_replace: :update, defaults_to_struct: true)
  end
```

- [ ] **Step 5: `changeset/1` 私的関数の `cast_embed` 配線を追加**

`apps/symphony/lib/symphony_elixir/config/schema.ex` L386-400 を置換:

```elixir
  defp changeset(attrs) do
    %__MODULE__{}
    |> cast(attrs, [])
    |> cast_embed(:tracker, with: &Tracker.changeset/2)
    |> cast_embed(:linear, with: &Linear.changeset/2)
    |> cast_embed(:github, with: &Github.changeset/2)
    |> cast_embed(:polling, with: &Polling.changeset/2)
    |> cast_embed(:workspace, with: &Workspace.changeset/2)
    |> cast_embed(:worker, with: &Worker.changeset/2)
    |> cast_embed(:agent, with: &Agent.changeset/2)
    |> cast_embed(:codex, with: &Codex.changeset/2)
    |> cast_embed(:claude, with: &Claude.changeset/2)
    |> validate_claude_command()
    |> cast_embed(:hooks, with: &Hooks.changeset/2)
    |> cast_embed(:observability, with: &Observability.changeset/2)
    |> cast_embed(:server, with: &Server.changeset/2)
  end
```

- [ ] **Step 6: コンパイルだけ確認（テストはまだ赤）**

Run: `cd apps/symphony && mix compile --warnings-as-errors`
Expected: コンパイル成功（warning なし）

- [ ] **Step 7: 一旦コミットしない**（次 Task の env fallback と一緒にする）

---

## Task 2: `finalize_settings/1` の env fallback を kind 別に書き換え

**Files:**
- Modify: `apps/symphony/lib/symphony_elixir/config/schema.ex` L402-421

- [ ] **Step 1: `finalize_settings/1` を新構造に対応**

`apps/symphony/lib/symphony_elixir/config/schema.ex` L402-421 を置換:

```elixir
  defp finalize_settings(settings) do
    linear = %{
      settings.linear
      | api_key: resolve_secret_setting(settings.linear.api_key, System.get_env("LINEAR_API_KEY")),
        assignee: resolve_secret_setting(settings.linear.assignee, System.get_env("LINEAR_ASSIGNEE"))
    }

    github = %{
      settings.github
      | api_key: resolve_secret_setting(settings.github.api_key, System.get_env("GITHUB_TOKEN"))
    }

    workspace = %{
      settings.workspace
      | root: resolve_path_value(settings.workspace.root, Path.join(System.tmp_dir!(), "symphony_workspaces"))
    }

    codex = %{
      settings.codex
      | approval_policy: normalize_keys(settings.codex.approval_policy),
        turn_sandbox_policy: normalize_optional_map(settings.codex.turn_sandbox_policy)
    }

    %{settings | linear: linear, github: github, workspace: workspace, codex: codex}
  end
```

ポイント:
- `settings.tracker` 経由の api_key/assignee 解決を削除（Tracker からはフィールドが消えた）
- `settings.linear` 経由で `LINEAR_API_KEY` / `LINEAR_ASSIGNEE` を解決
- `settings.github` 経由で `GITHUB_TOKEN` を解決（assignee の env fallback は無し、明示的に WORKFLOW.md に書く運用）

- [ ] **Step 2: コンパイル確認**

Run: `cd apps/symphony && mix compile --warnings-as-errors`
Expected: 成功

- [ ] **Step 3: コミットしない**（次 Task と統合）

---

## Task 3: `validate_semantics/1` の kind 別チェック書き換え

**Files:**
- Modify: `apps/symphony/lib/symphony_elixir/config.ex` L117-134

- [ ] **Step 1: `validate_semantics/1` を新構造に対応**

`apps/symphony/lib/symphony_elixir/config.ex` L117-134 を置換:

```elixir
  defp validate_semantics(settings) do
    cond do
      is_nil(settings.tracker.kind) ->
        {:error, :missing_tracker_kind}

      settings.tracker.kind not in ["linear", "github", "memory"] ->
        {:error, {:unsupported_tracker_kind, settings.tracker.kind}}

      settings.tracker.kind == "linear" and not is_binary(settings.linear.api_key) ->
        {:error, :missing_linear_api_token}

      settings.tracker.kind == "linear" and not is_binary(settings.linear.project_slug) ->
        {:error, :missing_linear_project_slug}

      settings.tracker.kind == "github" and not is_binary(settings.github.api_key) ->
        {:error, :missing_github_api_token}

      settings.tracker.kind == "github" and not is_binary(settings.github.project_owner) ->
        {:error, :missing_github_project_owner}

      settings.tracker.kind == "github" and not is_integer(settings.github.project_number) ->
        {:error, :missing_github_project_number}

      true ->
        :ok
    end
  end
```

ポイント:
- `"github"` を `kind` の許可リストに追加
- `linear.api_key` / `linear.project_slug` の null チェックを `settings.linear` 経由に変更
- `github.api_key` / `github.project_owner` / `github.project_number` のチェックを追加

- [ ] **Step 2: コンパイル確認**

Run: `cd apps/symphony && mix compile --warnings-as-errors`
Expected: 成功

---

## Task 4: `linear/client.ex` を `settings.linear` 参照に切り替え

**Files:**
- Modify: `apps/symphony/lib/symphony_elixir/linear/client.ex` L108-145, L384, L398, L491

5 箇所のうち `tracker.active_states` (L120) は Tracker embed に残るので変更不要。残り 4 つ (`api_key`, `project_slug`, `endpoint`, `assignee`) を `settings.linear` 経由に切り替える。

- [ ] **Step 1: L106-122 (`fetch_candidate_issues/0`) を修正**

L106-122 の `fetch_candidate_issues/0` を置換:

```elixir
  @spec fetch_candidate_issues() :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_candidate_issues do
    settings = Config.settings!()
    linear = settings.linear
    project_slug = linear.project_slug

    cond do
      is_nil(linear.api_key) ->
        {:error, :missing_linear_api_token}

      is_nil(project_slug) ->
        {:error, :missing_linear_project_slug}

      true ->
        with {:ok, assignee_filter} <- routing_assignee_filter() do
          do_fetch_by_states(project_slug, settings.tracker.active_states, assignee_filter)
        end
    end
  end
```

(active_states は引き続き `settings.tracker.active_states` から取る。)

- [ ] **Step 2: L125-146 (`fetch_issues_by_states/1`) を修正**

L125-146 の `fetch_issues_by_states/1` を置換:

```elixir
  @spec fetch_issues_by_states([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_states(state_names) when is_list(state_names) do
    normalized_states = Enum.map(state_names, &to_string/1) |> Enum.uniq()

    if normalized_states == [] do
      {:ok, []}
    else
      linear = Config.settings!().linear
      project_slug = linear.project_slug

      cond do
        is_nil(linear.api_key) ->
          {:error, :missing_linear_api_token}

        is_nil(project_slug) ->
          {:error, :missing_linear_project_slug}

        true ->
          do_fetch_by_states(project_slug, normalized_states, nil)
      end
    end
  end
```

- [ ] **Step 3: L384 の `tracker.api_key` 参照を修正**

`apps/symphony/lib/symphony_elixir/linear/client.ex` を開き、L384 周辺の関数 (auth header 構築) で `Config.settings!().tracker.api_key` を `Config.settings!().linear.api_key` に置換。

具体的には:

```elixir
    case Config.settings!().tracker.api_key do
```

を

```elixir
    case Config.settings!().linear.api_key do
```

に変更。

- [ ] **Step 4: L398 の `tracker.endpoint` 参照を修正**

L398 周辺:

```elixir
    Req.post(Config.settings!().tracker.endpoint,
```

を

```elixir
    Req.post(Config.settings!().linear.endpoint,
```

に変更。

- [ ] **Step 5: L491 の `tracker.assignee` 参照を修正**

L491 周辺:

```elixir
    case Config.settings!().tracker.assignee do
```

を

```elixir
    case Config.settings!().linear.assignee do
```

に変更。

- [ ] **Step 6: コンパイル確認**

Run: `cd apps/symphony && mix compile --warnings-as-errors`
Expected: 成功

---

## Task 5: `test/support/test_support.exs` の `workflow_content` を新スキーマに

**Files:**
- Modify: `apps/symphony/test/support/test_support.exs` L91-204

- [ ] **Step 1: defaults リストに新フィールドを追加、旧フィールド名を `linear_*` / `github_*` に変更**

L91-132 の `workflow_content/1` 内の `defaults` 部分を置換:

```elixir
  defp workflow_content(overrides) do
    config =
      Keyword.merge(
        [
          tracker_kind: "linear",
          tracker_active_states: ["Todo", "In Progress"],
          tracker_terminal_states: ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"],
          tracker_doing_state: nil,
          tracker_done_state: nil,
          linear_api_token: "token",
          linear_endpoint: "https://api.linear.app/graphql",
          linear_project_slug: "project",
          linear_assignee: nil,
          github_api_token: nil,
          github_endpoint: "https://api.github.com/graphql",
          github_project_owner: nil,
          github_project_number: nil,
          github_assignee: nil,
          poll_interval_ms: 30_000,
          workspace_root: Path.join(System.tmp_dir!(), "symphony_workspaces"),
          worker_ssh_hosts: [],
          worker_max_concurrent_agents_per_host: nil,
          max_concurrent_agents: 10,
          max_turns: 20,
          max_retry_backoff_ms: 300_000,
          max_concurrent_agents_by_state: %{},
          agent_type: "codex",
          claude_command: nil,
          codex_command: "codex app-server",
          codex_approval_policy: %{reject: %{sandbox_approval: true, rules: true, mcp_elicitations: true}},
          codex_thread_sandbox: "workspace-write",
          codex_turn_sandbox_policy: nil,
          codex_turn_timeout_ms: 3_600_000,
          codex_read_timeout_ms: 5_000,
          codex_stall_timeout_ms: 300_000,
          hook_after_create: nil,
          hook_before_run: nil,
          hook_after_run: nil,
          hook_before_remove: nil,
          hook_timeout_ms: 60_000,
          observability_enabled: true,
          observability_refresh_ms: 1_000,
          observability_render_interval_ms: 16,
          server_port: nil,
          server_host: nil,
          prompt: @workflow_prompt
        ],
        overrides
      )
```

- [ ] **Step 2: `Keyword.get` 呼び出し（L134-168）を新名に追従**

L134-168 を以下に置換:

```elixir
    tracker_kind = Keyword.get(config, :tracker_kind)
    tracker_active_states = Keyword.get(config, :tracker_active_states)
    tracker_terminal_states = Keyword.get(config, :tracker_terminal_states)
    tracker_doing_state = Keyword.get(config, :tracker_doing_state)
    tracker_done_state = Keyword.get(config, :tracker_done_state)
    linear_api_token = Keyword.get(config, :linear_api_token)
    linear_endpoint = Keyword.get(config, :linear_endpoint)
    linear_project_slug = Keyword.get(config, :linear_project_slug)
    linear_assignee = Keyword.get(config, :linear_assignee)
    github_api_token = Keyword.get(config, :github_api_token)
    github_endpoint = Keyword.get(config, :github_endpoint)
    github_project_owner = Keyword.get(config, :github_project_owner)
    github_project_number = Keyword.get(config, :github_project_number)
    github_assignee = Keyword.get(config, :github_assignee)
    poll_interval_ms = Keyword.get(config, :poll_interval_ms)
    workspace_root = Keyword.get(config, :workspace_root)
    worker_ssh_hosts = Keyword.get(config, :worker_ssh_hosts)
    worker_max_concurrent_agents_per_host = Keyword.get(config, :worker_max_concurrent_agents_per_host)
    max_concurrent_agents = Keyword.get(config, :max_concurrent_agents)
    max_turns = Keyword.get(config, :max_turns)
    max_retry_backoff_ms = Keyword.get(config, :max_retry_backoff_ms)
    max_concurrent_agents_by_state = Keyword.get(config, :max_concurrent_agents_by_state)
    agent_type = Keyword.get(config, :agent_type)
    claude_command = Keyword.get(config, :claude_command)
    codex_command = Keyword.get(config, :codex_command)
    codex_approval_policy = Keyword.get(config, :codex_approval_policy)
    codex_thread_sandbox = Keyword.get(config, :codex_thread_sandbox)
    codex_turn_sandbox_policy = Keyword.get(config, :codex_turn_sandbox_policy)
    codex_turn_timeout_ms = Keyword.get(config, :codex_turn_timeout_ms)
    codex_read_timeout_ms = Keyword.get(config, :codex_read_timeout_ms)
    codex_stall_timeout_ms = Keyword.get(config, :codex_stall_timeout_ms)
    hook_after_create = Keyword.get(config, :hook_after_create)
    hook_before_run = Keyword.get(config, :hook_before_run)
    hook_after_run = Keyword.get(config, :hook_after_run)
    hook_before_remove = Keyword.get(config, :hook_before_remove)
    hook_timeout_ms = Keyword.get(config, :hook_timeout_ms)
    observability_enabled = Keyword.get(config, :observability_enabled)
    observability_refresh_ms = Keyword.get(config, :observability_refresh_ms)
    observability_render_interval_ms = Keyword.get(config, :observability_render_interval_ms)
    server_port = Keyword.get(config, :server_port)
    server_host = Keyword.get(config, :server_host)
    prompt = Keyword.get(config, :prompt)
```

- [ ] **Step 3: `sections` リストの YAML 出力を新構造に**

L170-184 の sections 構築箇所（tracker ブロックと前後）を置換:

```elixir
    sections =
      [
        "---",
        "tracker:",
        "  kind: #{yaml_value(tracker_kind)}",
        "  active_states: #{yaml_value(tracker_active_states)}",
        "  terminal_states: #{yaml_value(tracker_terminal_states)}",
        "  doing_state: #{yaml_value(tracker_doing_state)}",
        "  done_state: #{yaml_value(tracker_done_state)}",
        "linear:",
        "  api_key: #{yaml_value(linear_api_token)}",
        "  endpoint: #{yaml_value(linear_endpoint)}",
        "  project_slug: #{yaml_value(linear_project_slug)}",
        "  assignee: #{yaml_value(linear_assignee)}",
        "github:",
        "  api_key: #{yaml_value(github_api_token)}",
        "  endpoint: #{yaml_value(github_endpoint)}",
        "  project_owner: #{yaml_value(github_project_owner)}",
        "  project_number: #{yaml_value(github_project_number)}",
        "  assignee: #{yaml_value(github_assignee)}",
        "polling:",
        "  interval_ms: #{yaml_value(poll_interval_ms)}",
        ...
```

(以降の workspace, worker, agent, codex, hooks, observability, server, prompt セクションは無変更。)

- [ ] **Step 4: コンパイル確認**

Run: `cd apps/symphony && mix compile --warnings-as-errors`
Expected: 成功

---

## Task 6: 既存テストアサーションを新スキーマパスに追従

**Files:**
- Modify: `apps/symphony/test/symphony_elixir/core_test.exs`
- Modify: `apps/symphony/test/symphony_elixir/workspace_and_config_test.exs`

- [ ] **Step 1: `core_test.exs` の旧キー名 `tracker_api_token` / `tracker_project_slug` / `tracker_assignee` を `linear_*` に変更**

`apps/symphony/test/symphony_elixir/core_test.exs` を開き、以下を sed-style 置換 (Edit ツールで個別に):

| 旧 | 新 |
|---|---|
| `tracker_api_token:` | `linear_api_token:` |
| `tracker_project_slug:` | `linear_project_slug:` |
| `tracker_assignee:` | `linear_assignee:` |

該当行は L6-10, L45-46, L51-52, L126-127, L144-145 周辺。

- [ ] **Step 2: `core_test.exs` のアサーションパスを変更**

L18 を:

```elixir
    assert config.tracker.assignee == nil
```

から:

```elixir
    assert config.linear.assignee == nil
```

に変更。

L101-102 の WORKFLOW.md 読み取りテストを:

```elixir
    assert Map.get(tracker, "kind") == "linear"
    assert is_binary(Map.get(tracker, "project_slug"))
```

から:

```elixir
    assert Map.get(tracker, "kind") == "linear"
    linear = Map.get(config, "linear", %{})
    assert is_binary(Map.get(linear, "project_slug"))
```

に変更（`project_slug` は `tracker:` ではなく `linear:` に移ったため）。

L131-132 のアサーション:

```elixir
    assert Config.settings!().tracker.api_key == env_api_key
    assert Config.settings!().tracker.project_slug == "project"
```

を:

```elixir
    assert Config.settings!().linear.api_key == env_api_key
    assert Config.settings!().linear.project_slug == "project"
```

に変更。

L149:

```elixir
    assert Config.settings!().tracker.assignee == env_assignee
```

を:

```elixir
    assert Config.settings!().linear.assignee == env_assignee
```

に変更。

L186 の inline YAML フィクスチャ:

```elixir
    File.write!(workflow_path, "---\ntracker:\n  kind: linear\n")
```

はこのまま OK（kind だけしか定義していないので新構造でも parse 可能。ただし `validate_semantics` で `:missing_linear_api_token` が返ってくることに留意、その期待値次第で追加修正が必要なら下記）。

L188 が

```elixir
    assert {:ok, %{config: %{"tracker" => %{"kind" => "linear"}}, prompt: "", prompt_template: ""}} =
```

であれば、`config` map の key 名が `"tracker"` 単一のままなので問題なし。

- [ ] **Step 3: `workspace_and_config_test.exs` の旧パスを修正**

`apps/symphony/test/symphony_elixir/workspace_and_config_test.exs` を開き:

L741:

```elixir
    assert config.tracker.endpoint == "https://api.linear.app/graphql"
```

を:

```elixir
    assert config.linear.endpoint == "https://api.linear.app/graphql"
```

に変更。

L1036:

```elixir
    assert settings.tracker.api_key == nil
```

を:

```elixir
    assert settings.linear.api_key == nil
```

に変更。

L1049:

```elixir
    assert settings.tracker.api_key == "fallback-linear-token"
```

を:

```elixir
    assert settings.linear.api_key == "fallback-linear-token"
```

に変更。

- [ ] **Step 4: `tracker_endpoint` を使っているテストヘルパー呼び出しを `linear_endpoint` に置換**

`apps/symphony/test` 配下で `tracker_endpoint:` を grep し（test_support.exs の defaults 以外の使用箇所がもしあれば）、`linear_endpoint:` に置換:

Run: `grep -rn "tracker_endpoint:" apps/symphony/test`
Expected: マッチが test_support.exs のみ → OK、追加変更なし。マッチが他にもある → そのファイルで `tracker_endpoint:` → `linear_endpoint:` に置換。

- [ ] **Step 5: `mix test` を実行して全体緑を確認**

Run: `cd apps/symphony && mix test --warnings-as-errors`
Expected: 全テスト pass、warning なし

失敗があれば失敗内容に応じて追加修正（grep で漏れを探す）。

- [ ] **Step 6: ここで一旦コミット（Task 1〜6 をまとめて）**

Run:
```bash
git add apps/symphony/lib apps/symphony/test
git commit -m "$(cat <<'EOF'
refactor(symphony): split tracker config into linear/github sub-blocks

Shrink the Tracker embed to common fields (kind/active_states/
terminal_states/pickup_state/success_state) and move tracker-specific
fields into new Linear / Github embeds. The Linear adapter now reads
from settings.linear; env fallback for LINEAR_API_KEY / GITHUB_TOKEN
runs through finalize_settings per kind. validate_semantics gains
github required-field checks. Test fixtures and assertions migrate
to the new paths.

Phase 1 of Milestone 2 — schema migration only, no behavior change.
GitHub Adapter implementation comes in Phase 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

> **Historical note:** これらのフィールドは Phase 3 準備 (commit `cd7c531`) で `doing_state` / `done_state` にリネームされました。本セクションの commit message 例は当時のフィールド名のまま残しています (= 実際の git log と一致)。

---

## Task 7: GitHub 用 validation テストを追加

**Files:**
- Modify: `apps/symphony/test/symphony_elixir/core_test.exs`

新しい `github:` パスの正常系・異常系を回帰固定する。

- [ ] **Step 1: 失敗テスト追加 — `kind: github` で `github.project_owner` 未指定**

`apps/symphony/test/symphony_elixir/core_test.exs` の `"config defaults and validation checks"` テストの末尾（L89 直前、`assert {:error, {:unsupported_tracker_kind, "123"}}` の後）に以下を追加:

```elixir
    write_workflow_file!(Workflow.workflow_file_path(),
      tracker_kind: "github",
      github_api_token: "ghp_xxx",
      github_project_owner: nil,
      github_project_number: 5
    )
    assert {:error, :missing_github_project_owner} = Config.validate!()

    write_workflow_file!(Workflow.workflow_file_path(),
      tracker_kind: "github",
      github_api_token: "ghp_xxx",
      github_project_owner: "babie",
      github_project_number: nil
    )
    assert {:error, :missing_github_project_number} = Config.validate!()

    write_workflow_file!(Workflow.workflow_file_path(),
      tracker_kind: "github",
      github_api_token: nil,
      github_project_owner: "babie",
      github_project_number: 5
    )
    assert {:error, :missing_github_api_token} = Config.validate!()

    write_workflow_file!(Workflow.workflow_file_path(),
      tracker_kind: "github",
      github_api_token: "ghp_xxx",
      github_project_owner: "babie",
      github_project_number: 5
    )
    assert :ok = Config.validate!()
```

- [ ] **Step 2: 失敗テスト追加 — `GITHUB_TOKEN` env fallback**

`workspace_and_config_test.exs` の Linear env fallback テスト（L1036-1049 周辺）の後に、対応する GitHub 用テストを追加:

`apps/symphony/test/symphony_elixir/workspace_and_config_test.exs` を開き、Linear env fallback テストの後に新しいテストを挿入:

```elixir
  test "github.api_key falls back to GITHUB_TOKEN env" do
    env_api_key = "ghp_env_fallback"
    System.put_env("GITHUB_TOKEN", env_api_key)
    on_exit(fn -> System.delete_env("GITHUB_TOKEN") end)

    write_workflow_file!(Workflow.workflow_file_path(),
      tracker_kind: "github",
      github_api_token: nil,
      github_project_owner: "babie",
      github_project_number: 5
    )

    assert :ok = Config.validate!()
    assert Config.settings!().github.api_key == env_api_key
  end
```

(配置は既存テストの命名規約に合わせて `defmodule` 内、末尾近く。)

- [ ] **Step 3: テスト実行**

Run: `cd apps/symphony && mix test --warnings-as-errors`
Expected: 新規 GitHub テスト含め全て pass

- [ ] **Step 4: コミット**

```bash
git add apps/symphony/test
git commit -m "$(cat <<'EOF'
test(symphony): cover tracker.kind: github schema validation

Pin behavior for the new github: block: missing api_key /
project_owner / project_number each yield the expected validation
error; GITHUB_TOKEN env var falls back into settings.github.api_key.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: example WORKFLOW.md ファイルを新スキーマに sweep

**Files:**
- Modify: `apps/symphony/WORKFLOW.md` L2-15
- Modify: `apps/symphony/examples/workflow.claude.md` L21-24

- [ ] **Step 1: `apps/symphony/WORKFLOW.md` の tracker ブロックを書き換え**

L2-15 を置換。

旧（実 file 抜粋）:
```yaml
tracker:
  kind: linear
  project_slug: "symphony-0c79b11b75ea"
  active_states:
    - Todo
    - In Progress
    - Merging
    - Rework
  terminal_states:
    - Closed
    - Cancelled
    - Canceled
    - Duplicate
    - Done
```

新:
```yaml
tracker:
  kind: linear
  active_states:
    - Todo
    - In Progress
    - Merging
    - Rework
  terminal_states:
    - Closed
    - Cancelled
    - Canceled
    - Duplicate
    - Done

linear:
  project_slug: "symphony-0c79b11b75ea"
```

(`api_key` は env `LINEAR_API_KEY` フォールバックに任せる、`assignee` / `endpoint` は default のまま。)

- [ ] **Step 2: `apps/symphony/examples/workflow.claude.md` の tracker ブロックを書き換え**

L21-24 を置換。

旧:
```yaml
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: concert-3f96fb9d18cf
```

新:
```yaml
tracker:
  kind: linear

linear:
  api_key: $LINEAR_API_KEY
  project_slug: concert-3f96fb9d18cf
```

- [ ] **Step 3: 修正後の WORKFLOW.md を mix test の current-WORKFLOW テストで検証**

`core_test.exs` の `"current WORKFLOW.md file is valid and complete"` テストが既存 WORKFLOW.md を直接読み込んで parse する。新形式に書き換えた後にこのテストが通ることを確認:

Run: `cd apps/symphony && mix test test/symphony_elixir/core_test.exs --warnings-as-errors`
Expected: pass

- [ ] **Step 4: `mix test` 全体実行**

Run: `cd apps/symphony && mix test --warnings-as-errors`
Expected: 全 pass

- [ ] **Step 5: コミット**

```bash
git add apps/symphony/WORKFLOW.md apps/symphony/examples/workflow.claude.md
git commit -m "$(cat <<'EOF'
docs(symphony): migrate WORKFLOW.md examples to split tracker schema

Move linear-specific fields (project_slug, api_key) out of the
tracker: block into a dedicated linear: block, matching the new
schema introduced in Phase 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `apps/symphony/CLAUDE.md` に `tracker.kind` の説明を追加 + 残存参照確認

**Files:**
- Modify: `apps/symphony/CLAUDE.md`

ルート docs（`docs/protocol.md` / `docs/architecture.md` / `/workspace/CLAUDE.md`）には事前確認で「tracker」関連の **YAML サンプルが存在しない**ことを確認済み（プロセス記述のみ）。よって Phase 1 で sweep する doc は `apps/symphony/CLAUDE.md` のみ。

- [ ] **Step 1: 残存する旧スキーマ参照が無いか grep**

Run:
```bash
grep -rn "tracker\.api_key\|tracker\.endpoint\|tracker\.project_slug\|tracker\.assignee" /workspace/docs /workspace/CLAUDE.md /workspace/apps/symphony/CLAUDE.md
```
Expected: 過去スペック (`docs/superpowers/specs/2026-05-10-symphony-phase1-design.md` 等) 以外のヒットがあれば修正対象。歴史的記録は触らない。

- [ ] **Step 1.5: `docs/e2e_testing.md` の `tracker.project_slug` 参照を `linear.project_slug` に置換**

L44, L122, L268 周辺で `examples/workflow.claude.md` の編集を案内している箇所が `tracker.project_slug:` を指している。`linear.project_slug:` に書き換える。Step 1 の grep 結果に従って正確な行を特定し、置換する。

- [ ] **Step 2: `apps/symphony/CLAUDE.md` の §「Milestone 1 の改造方針」付近を確認**

Run: `grep -n "Milestone 1 の改造方針\|## " /workspace/apps/symphony/CLAUDE.md`
Expected: section heading の行番号一覧

挿入箇所の候補: §「Milestone 1 の改造方針」の直後、または §「Milestone 3 以降に延期したもの」の直前。

- [ ] **Step 3: `apps/symphony/CLAUDE.md` に `tracker.kind` 説明セクションを追加**

L20 直後（§「Milestone 1 の改造方針」見出しの後ろ）に以下を挿入:

```markdown
### tracker.kind と per-kind ブロック

WORKFLOW.md の `tracker.kind` で読まれるブロックが切り替わる:

- `kind: linear` → `linear:` ブロック（`api_key` / `endpoint` / `project_slug` / `assignee`）
- `kind: github` → `github:` ブロック（`api_key` / `endpoint` / `project_owner` / `project_number` / `assignee`）。adapter 実装は Milestone 2 Phase 2 で対応
- `kind: memory` → どちらも不要（テスト用）

`tracker:` ブロックには共通フィールド（`kind` / `active_states` / `terminal_states` / `doing_state` / `done_state`）だけが残る。Schema 詳細は `lib/symphony_elixir/config/schema.ex` の `Tracker` / `Linear` / `Github` embed を参照。
```

- [ ] **Step 4: コミット**

```bash
git add apps/symphony/CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(symphony): describe tracker.kind block selection in CLAUDE.md

Add a short section explaining the tracker: / linear: / github:
block split so future readers know which block is read per kind.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: 最終回帰 + Phase 1 完了確認

- [ ] **Step 1: 全体 mix test を最終実行**

Run: `cd apps/symphony && mix test --warnings-as-errors`
Expected: 全 pass、warning なし

- [ ] **Step 2: ルート pnpm build / test も含めて regression**

Run: `cd /workspace && pnpm build && pnpm test`
Expected: 全 pass（claude-app-server 側はスキーマ変更の影響なしのはず）

- [ ] **Step 3: TODO.md の Phase 1 チェックリストを `[x]` に**

`TODO.md` を開き、Milestone 2 Phase 1 の各チェックボックスを `[ ]` → `[x]` に変更。

- [ ] **Step 4: 完了コミット**

```bash
git add TODO.md
git commit -m "$(cat <<'EOF'
chore(repo): mark Milestone 2 Phase 1 complete

Schema migration done; all tests green. Phase 2 (GitHub Adapter
implementation) is next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 1 完了条件 self-check

実装完了時に以下が全て満たされること:

- [ ] `tracker:` ブロックが `kind` / `active_states` / `terminal_states` / `doing_state` / `done_state` のみ
- [ ] `linear:` ブロックに `api_key` / `endpoint` / `project_slug` / `assignee` が移動
- [ ] `github:` ブロックの schema 宣言と cross-field validation（kind == github のとき api_key / project_owner / project_number 必須）が存在
- [ ] `apps/symphony/WORKFLOW.md` / `examples/workflow.codex.md` / `examples/workflow.claude.md` が新形式
- [ ] Linear 経路の既存 mix test が緑
- [ ] GitHub 用 validation テスト 4 件 (`missing_github_*` × 3 + OK ケース) + GITHUB_TOKEN env fallback テスト 1 件 が緑
- [ ] doc 系（`docs/protocol.md` / `docs/architecture.md` / ルート `CLAUDE.md` / `apps/symphony/CLAUDE.md`）の WORKFLOW.md スキーマ例が新形式
- [ ] `apps/symphony/lib/symphony_elixir/tracker.ex`（adapter dispatch）は変更されていない（Phase 2 で対応）
- [ ] `apps/symphony/lib/symphony_elixir/github/` 配下に何も新規作成されていない（Phase 2 で対応）
