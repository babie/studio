# Symphony Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apps/symphony` の WORKFLOW.md で `agent.type: claude` を指定したとき `claude.command` を、`agent.type: codex` または未指定のとき `codex.command` を subprocess として起動できるようにする。

**Architecture:** `config/schema.ex` に `Claude` Ecto サブスキーマと `Agent.type` フィールドを追加し、`agent.type: claude` + `claude.command` 未指定のクロスフィールドバリデーションを入れる。`codex/app_server.ex` に `resolve_command/0` を追加して `start_port/2` と `remote_launch_command/1` のコマンド取得箇所を差し替える。既存の Codex 通信コードは一切変えない。

**Tech Stack:** Elixir, Ecto (embedded schema / changeset), ExUnit, shell script fake binaries (テスト用)

---

## File Map

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `apps/symphony/test/support/test_support.exs` | 修正 | `agent_type` / `claude_command` オーバーライドキーを追加 |
| `apps/symphony/lib/symphony_elixir/config/schema.ex` | 修正 | `Claude` サブスキーマ追加、`Agent.type` フィールド追加、クロスフィールドバリデーション追加 |
| `apps/symphony/lib/symphony_elixir/codex/app_server.ex` | 修正 | `resolve_command/0` 追加、`start_port/2` と `remote_launch_command/1` を修正 |
| `apps/symphony/test/symphony_elixir/workspace_and_config_test.exs` | 修正 | Schema ユニットテスト追加 |
| `apps/symphony/test/symphony_elixir/app_server_test.exs` | 修正 | AppServer 統合テスト追加 |
| `apps/symphony/examples/workflow.claude.md` | 新規 | Claude backend 設定サンプル |

---

## Task 1: TestSupport に agent_type / claude_command キーを追加

**Files:**
- Modify: `apps/symphony/test/support/test_support.exs`

テストで `write_workflow_file!(path, agent_type: "claude", claude_command: "my-cas")` と書けるようにする。`defaults_to_struct: true` により `Claude` struct は常に存在するが、`command` は nil になる。

- [ ] **Step 1: `Keyword.merge` のデフォルトリストに 2 キーを追加する**

`workflow_content/1` の `Keyword.merge([ ... ], overrides)` のデフォルトリストに以下を追加（`codex_command:` の直前あたり）:

```elixir
agent_type: "codex",
claude_command: nil,
```

- [ ] **Step 2: 変数展開行を追加する**

```elixir
agent_type = Keyword.get(config, :agent_type)
claude_command = Keyword.get(config, :claude_command)
```

（`codex_command = ...` の直前）

- [ ] **Step 3: `agent:` セクションに `type:` 行を追加する**

現在:
```elixir
"agent:",
"  max_concurrent_agents: #{yaml_value(max_concurrent_agents)}",
```

変更後:
```elixir
"agent:",
"  type: #{yaml_value(agent_type)}",
"  max_concurrent_agents: #{yaml_value(max_concurrent_agents)}",
```

- [ ] **Step 4: `claude:` セクションをヘルパー経由で追加する**

`sections` リストの `"codex:",` 行の直前に `claude_yaml(claude_command),` を追加:

```elixir
claude_yaml(claude_command),
"codex:",
```

ファイル末尾に private 関数を追加:

```elixir
defp claude_yaml(nil), do: nil

defp claude_yaml(command) when is_binary(command) do
  "claude:\n  command: #{yaml_value(command)}"
end
```

- [ ] **Step 5: 既存テストが壊れないことを確認してコミット**

```bash
cd apps/symphony
mise exec -- mix test
```

期待: 全テスト PASS（`agent_type` のデフォルトが `"codex"` なので既存テストには影響なし）

```bash
git add test/support/test_support.exs
git commit -m "test(symphony): add agent_type and claude_command overrides to TestSupport"
```

---

## Task 2: Schema ユニットテスト — agent.type フィールド

**Files:**
- Modify: `apps/symphony/test/symphony_elixir/workspace_and_config_test.exs`

- [ ] **Step 1: 失敗するテストを追加する**

`workspace_and_config_test.exs` の末尾（他のテストの後）に追加:

```elixir
test "agent.type defaults to codex when not specified" do
  config = %{
    "tracker" => %{"kind" => "linear", "api_key" => "token", "project_slug" => "proj"},
    "codex" => %{"command" => "codex app-server"}
  }
  assert {:ok, settings} = Schema.parse(config)
  assert settings.agent.type == "codex"
end

test "agent.type can be set to codex" do
  config = %{
    "tracker" => %{"kind" => "linear", "api_key" => "token", "project_slug" => "proj"},
    "agent" => %{"type" => "codex"},
    "codex" => %{"command" => "my-codex app-server"}
  }
  assert {:ok, settings} = Schema.parse(config)
  assert settings.agent.type == "codex"
end

test "agent.type rejects values other than claude or codex" do
  config = %{
    "tracker" => %{"kind" => "linear", "api_key" => "token", "project_slug" => "proj"},
    "agent" => %{"type" => "gpt5"},
    "codex" => %{"command" => "codex app-server"}
  }
  assert {:error, {:invalid_workflow_config, message}} = Schema.parse(config)
  assert message =~ "agent"
end
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
cd apps/symphony
mise exec -- mix test test/symphony_elixir/workspace_and_config_test.exs --seed 0
```

期待: `agent.type defaults to codex` が `** (KeyError) key :type not found` 等で FAIL

- [ ] **Step 3: テストをコミット（実装前）**

```bash
git add test/symphony_elixir/workspace_and_config_test.exs
git commit -m "test(symphony): add failing tests for agent.type field in Schema"
```

---

## Task 3: Schema.Agent に type フィールドを実装

**Files:**
- Modify: `apps/symphony/lib/symphony_elixir/config/schema.ex`

- [ ] **Step 1: Agent モジュールの `embedded_schema` に `type` を追加する**

`lib/symphony_elixir/config/schema.ex` の `defmodule Agent` 内:

```elixir
embedded_schema do
  field(:type, :string, default: "codex")   # ← 追加
  field(:max_concurrent_agents, :integer, default: 10)
  field(:max_turns, :integer, default: 20)
  field(:max_retry_backoff_ms, :integer, default: 300_000)
  field(:max_concurrent_agents_by_state, :map, default: %{})
end
```

- [ ] **Step 2: Agent.changeset/2 の cast と validate を更新する**

```elixir
def changeset(schema, attrs) do
  schema
  |> cast(
    attrs,
    [:type, :max_concurrent_agents, :max_turns, :max_retry_backoff_ms, :max_concurrent_agents_by_state],
    empty_values: []
  )
  |> validate_inclusion(:type, ["claude", "codex"])
  |> validate_number(:max_concurrent_agents, greater_than: 0)
  |> validate_number(:max_turns, greater_than: 0)
  |> validate_number(:max_retry_backoff_ms, greater_than: 0)
  |> update_change(:max_concurrent_agents_by_state, &Schema.normalize_state_limits/1)
  |> Schema.validate_state_limits(:max_concurrent_agents_by_state)
end
```

- [ ] **Step 3: テストがパスすることを確認してコミット**

```bash
cd apps/symphony
mise exec -- mix test test/symphony_elixir/workspace_and_config_test.exs --seed 0
```

期待: Task 2 で追加した 3 テストが PASS

```bash
mise exec -- mix test
```

期待: 全テスト PASS

```bash
git add lib/symphony_elixir/config/schema.ex
git commit -m "feat(symphony): add agent.type field to Schema.Agent"
```

---

## Task 4: Schema ユニットテスト — claude: ブロックのバリデーション

**Files:**
- Modify: `apps/symphony/test/symphony_elixir/workspace_and_config_test.exs`

- [ ] **Step 1: 失敗するテストを追加する**

```elixir
test "agent.type: claude requires claude.command" do
  config = %{
    "tracker" => %{"kind" => "linear", "api_key" => "token", "project_slug" => "proj"},
    "agent" => %{"type" => "claude"},
    "codex" => %{"command" => "codex app-server"}
  }
  assert {:error, {:invalid_workflow_config, message}} = Schema.parse(config)
  assert message =~ "claude"
end

test "agent.type: claude with claude.command parses successfully" do
  config = %{
    "tracker" => %{"kind" => "linear", "api_key" => "token", "project_slug" => "proj"},
    "agent" => %{"type" => "claude"},
    "codex" => %{"command" => "codex app-server"},
    "claude" => %{"command" => "claude-app-server --model claude-opus-4-7"}
  }
  assert {:ok, settings} = Schema.parse(config)
  assert settings.agent.type == "claude"
  assert settings.claude.command == "claude-app-server --model claude-opus-4-7"
end

test "claude block is optional when agent.type is codex" do
  config = %{
    "tracker" => %{"kind" => "linear", "api_key" => "token", "project_slug" => "proj"},
    "agent" => %{"type" => "codex"},
    "codex" => %{"command" => "codex app-server"}
  }
  assert {:ok, settings} = Schema.parse(config)
  assert settings.agent.type == "codex"
end
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
cd apps/symphony
mise exec -- mix test test/symphony_elixir/workspace_and_config_test.exs --seed 0
```

期待: `agent.type: claude requires claude.command` が FAIL（まだ Claude スキーマが存在しない）

- [ ] **Step 3: テストをコミット（実装前）**

```bash
git add test/symphony_elixir/workspace_and_config_test.exs
git commit -m "test(symphony): add failing tests for claude: block validation in Schema"
```

---

## Task 5: Schema.Claude サブスキーマとクロスフィールドバリデーションを実装

**Files:**
- Modify: `apps/symphony/lib/symphony_elixir/config/schema.ex`

- [ ] **Step 1: `Codex` モジュールの直後に `Claude` モジュールを追加する**

`defmodule Codex do ... end` の直後（`defmodule Hooks do` の前）に追加:

```elixir
defmodule Claude do
  @moduledoc false
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key false
  embedded_schema do
    field(:command, :string)
  end

  @spec changeset(%__MODULE__{}, map()) :: Ecto.Changeset.t()
  def changeset(schema, attrs) do
    schema
    |> cast(attrs, [:command], empty_values: [])
  end
end
```

注: `validate_required` は **Claude モジュール側に書かない**。必須チェックはクロスフィールドバリデーション（ルート側）で行う。

- [ ] **Step 2: ルートの `embedded_schema` に `claude` を追加する**

`embeds_one(:codex, ...)` の直後に追加:

```elixir
embeds_one(:claude, Claude, on_replace: :update, defaults_to_struct: true)
```

- [ ] **Step 3: ルートの `changeset/1` に `cast_embed` とバリデーションを追加する**

`|> cast_embed(:codex, ...)` の直後に追加:

```elixir
|> cast_embed(:claude, with: &Claude.changeset/2)
|> validate_claude_command()
```

- [ ] **Step 4: `validate_claude_command/1` プライベート関数を追加する**

`defp changeset(attrs)` の前（他の private 関数と並ぶ位置）に追加:

```elixir
defp validate_claude_command(changeset) do
  agent = get_field(changeset, :agent)
  claude = get_field(changeset, :claude)

  if agent && agent.type == "claude" &&
       (is_nil(claude) || is_nil(claude.command) || claude.command == "") do
    add_error(changeset, :claude, "command is required when agent.type is claude")
  else
    changeset
  end
end
```

- [ ] **Step 5: テストがパスすることを確認してコミット**

```bash
cd apps/symphony
mise exec -- mix test test/symphony_elixir/workspace_and_config_test.exs --seed 0
```

期待: Task 2 と Task 4 で追加した全テストが PASS

```bash
mise exec -- mix test
```

期待: 全テスト PASS

```bash
git add lib/symphony_elixir/config/schema.ex
git commit -m "feat(symphony): add Claude schema and cross-field validation for agent.type"
```

---

## Task 6: AppServer 統合テスト — コマンド選択ロジック

**Files:**
- Modify: `apps/symphony/test/symphony_elixir/app_server_test.exs`

- [ ] **Step 1: 失敗するテストを 4 件追加する**

`app_server_test.exs` の末尾に追加:

```elixir
test "app server launches claude command when agent.type is claude" do
  test_root =
    Path.join(
      System.tmp_dir!(),
      "symphony-elixir-app-server-claude-backend-#{System.unique_integer([:positive])}"
    )

  try do
    workspace_root = Path.join(test_root, "workspaces")
    workspace = Path.join(workspace_root, "MT-CAS-1")
    claude_binary = Path.join(test_root, "fake-claude-app-server")
    trace_file = Path.join(test_root, "claude-backend.trace")
    previous_trace = System.get_env("SYMP_TEST_CAS_TRACE")

    on_exit(fn ->
      if is_binary(previous_trace) do
        System.put_env("SYMP_TEST_CAS_TRACE", previous_trace)
      else
        System.delete_env("SYMP_TEST_CAS_TRACE")
      end
    end)

    System.put_env("SYMP_TEST_CAS_TRACE", trace_file)
    File.mkdir_p!(workspace)

    File.write!(claude_binary, """
    #!/bin/sh
    trace_file="${SYMP_TEST_CAS_TRACE:-/tmp/claude-backend.trace}"
    count=0

    while IFS= read -r line; do
      count=$((count + 1))
      printf 'JSON:%s\\n' "$line" >> "$trace_file"

      case "$count" in
        1)
          printf '%s\\n' '{"id":1,"result":{}}'
          ;;
        2)
          printf '%s\\n' '{"id":2,"result":{"thread":{"id":"thread-cas-1"}}}'
          ;;
        3)
          printf '%s\\n' '{"id":3,"result":{"turn":{"id":"turn-cas-1"}}}'
          ;;
        4)
          printf '%s\\n' '{"method":"turn/completed"}'
          exit 0
          ;;
        *)
          exit 0
          ;;
      esac
    done
    """)

    File.chmod!(claude_binary, 0o755)

    issue = %Issue{
      id: "issue-cas-1",
      identifier: "MT-CAS-1",
      title: "Claude backend command selection",
      description: "Ensure claude.command is used when agent.type is claude",
      state: "In Progress",
      url: "https://example.org/issues/MT-CAS-1",
      labels: []
    }

    write_workflow_file!(Workflow.workflow_file_path(),
      workspace_root: workspace_root,
      agent_type: "claude",
      claude_command: "#{claude_binary}"
    )

    assert {:ok, _result} = AppServer.run(workspace, "use claude backend", issue)

    assert File.exists?(trace_file), "trace file was not created; claude_binary was not executed"
  after
    File.rm_rf(test_root)
  end
end

test "app server launches codex command when agent.type is codex" do
  test_root =
    Path.join(
      System.tmp_dir!(),
      "symphony-elixir-app-server-codex-explicit-#{System.unique_integer([:positive])}"
    )

  try do
    workspace_root = Path.join(test_root, "workspaces")
    workspace = Path.join(workspace_root, "MT-CAS-2")
    codex_binary = Path.join(test_root, "fake-codex-explicit")
    trace_file = Path.join(test_root, "codex-explicit.trace")
    previous_trace = System.get_env("SYMP_TEST_CODEX_EXPLICIT_TRACE")

    on_exit(fn ->
      if is_binary(previous_trace) do
        System.put_env("SYMP_TEST_CODEX_EXPLICIT_TRACE", previous_trace)
      else
        System.delete_env("SYMP_TEST_CODEX_EXPLICIT_TRACE")
      end
    end)

    System.put_env("SYMP_TEST_CODEX_EXPLICIT_TRACE", trace_file)
    File.mkdir_p!(workspace)

    File.write!(codex_binary, """
    #!/bin/sh
    trace_file="${SYMP_TEST_CODEX_EXPLICIT_TRACE:-/tmp/codex-explicit.trace}"
    count=0

    while IFS= read -r line; do
      count=$((count + 1))
      printf 'JSON:%s\\n' "$line" >> "$trace_file"

      case "$count" in
        1)
          printf '%s\\n' '{"id":1,"result":{}}'
          ;;
        2)
          printf '%s\\n' '{"id":2,"result":{"thread":{"id":"thread-cas-2"}}}'
          ;;
        3)
          printf '%s\\n' '{"id":3,"result":{"turn":{"id":"turn-cas-2"}}}'
          ;;
        4)
          printf '%s\\n' '{"method":"turn/completed"}'
          exit 0
          ;;
        *)
          exit 0
          ;;
      esac
    done
    """)

    File.chmod!(codex_binary, 0o755)

    issue = %Issue{
      id: "issue-cas-2",
      identifier: "MT-CAS-2",
      title: "Codex explicit backend command selection",
      description: "Ensure codex.command is used when agent.type is codex",
      state: "In Progress",
      url: "https://example.org/issues/MT-CAS-2",
      labels: []
    }

    write_workflow_file!(Workflow.workflow_file_path(),
      workspace_root: workspace_root,
      agent_type: "codex",
      codex_command: "#{codex_binary} app-server"
    )

    assert {:ok, _result} = AppServer.run(workspace, "use codex backend", issue)

    assert File.exists?(trace_file), "trace file was not created; codex_binary was not executed"
  after
    File.rm_rf(test_root)
  end
end

test "app server launches codex command when agent.type is not specified" do
  test_root =
    Path.join(
      System.tmp_dir!(),
      "symphony-elixir-app-server-codex-default-#{System.unique_integer([:positive])}"
    )

  try do
    workspace_root = Path.join(test_root, "workspaces")
    workspace = Path.join(workspace_root, "MT-CAS-3")
    codex_binary = Path.join(test_root, "fake-codex-default")
    trace_file = Path.join(test_root, "codex-default.trace")
    previous_trace = System.get_env("SYMP_TEST_CODEX_DEFAULT_TRACE")

    on_exit(fn ->
      if is_binary(previous_trace) do
        System.put_env("SYMP_TEST_CODEX_DEFAULT_TRACE", previous_trace)
      else
        System.delete_env("SYMP_TEST_CODEX_DEFAULT_TRACE")
      end
    end)

    System.put_env("SYMP_TEST_CODEX_DEFAULT_TRACE", trace_file)
    File.mkdir_p!(workspace)

    File.write!(codex_binary, """
    #!/bin/sh
    trace_file="${SYMP_TEST_CODEX_DEFAULT_TRACE:-/tmp/codex-default.trace}"
    count=0

    while IFS= read -r line; do
      count=$((count + 1))
      printf 'JSON:%s\\n' "$line" >> "$trace_file"

      case "$count" in
        1)
          printf '%s\\n' '{"id":1,"result":{}}'
          ;;
        2)
          printf '%s\\n' '{"id":2,"result":{"thread":{"id":"thread-cas-3"}}}'
          ;;
        3)
          printf '%s\\n' '{"id":3,"result":{"turn":{"id":"turn-cas-3"}}}'
          ;;
        4)
          printf '%s\\n' '{"method":"turn/completed"}'
          exit 0
          ;;
        *)
          exit 0
          ;;
      esac
    done
    """)

    File.chmod!(codex_binary, 0o755)

    issue = %Issue{
      id: "issue-cas-3",
      identifier: "MT-CAS-3",
      title: "Codex default backend command selection",
      description: "Ensure codex.command is used when agent.type is not specified",
      state: "In Progress",
      url: "https://example.org/issues/MT-CAS-3",
      labels: []
    }

    write_workflow_file!(Workflow.workflow_file_path(),
      workspace_root: workspace_root,
      codex_command: "#{codex_binary} app-server"
    )

    assert {:ok, _result} = AppServer.run(workspace, "default to codex backend", issue)

    assert File.exists?(trace_file), "trace file was not created; codex_binary was not executed"
  after
    File.rm_rf(test_root)
  end
end

test "app server returns error when backend command binary is not found in PATH" do
  test_root =
    Path.join(
      System.tmp_dir!(),
      "symphony-elixir-app-server-command-not-found-#{System.unique_integer([:positive])}"
    )

  try do
    workspace_root = Path.join(test_root, "workspaces")
    workspace = Path.join(workspace_root, "MT-CAS-4")
    File.mkdir_p!(workspace)

    issue = %Issue{
      id: "issue-cas-4",
      identifier: "MT-CAS-4",
      title: "Backend command not found",
      description: "Ensure a clear error is returned when the backend binary is missing",
      state: "In Progress",
      url: "https://example.org/issues/MT-CAS-4",
      labels: []
    }

    write_workflow_file!(Workflow.workflow_file_path(),
      workspace_root: workspace_root,
      agent_type: "claude",
      claude_command: "this-binary-does-not-exist-#{System.unique_integer([:positive])}"
    )

    assert {:error, {:backend_command_not_found, bin}} = AppServer.run(workspace, "missing binary", issue)
    assert is_binary(bin)
    assert String.contains?(bin, "this-binary-does-not-exist")
  after
    File.rm_rf(test_root)
  end
end
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
cd apps/symphony
mise exec -- mix test test/symphony_elixir/app_server_test.exs --seed 0 2>&1 | tail -30
```

期待: 4 件の新テストがすべて FAIL（`resolve_command/0` 未実装、または `claude_command` キーが無効）

- [ ] **Step 3: テストをコミット（実装前）**

```bash
git add test/symphony_elixir/app_server_test.exs
git commit -m "test(symphony): add failing tests for backend command selection in AppServer"
```

---

## Task 7: AppServer に resolve_command/0 を実装

**Files:**
- Modify: `apps/symphony/lib/symphony_elixir/codex/app_server.ex`

- [ ] **Step 1: `resolve_command/0` プライベート関数を追加する**

`defp stop_port(port)` の直前（他の private 関数と並ぶ位置）に追加:

```elixir
# 歴史的経緯: このモジュールは Codex 専用として実装されたが、
# agent.type に応じて Claude も起動できるよう拡張された。
defp resolve_command do
  settings = Config.settings!()

  case settings.agent.type do
    "claude" -> settings.claude.command
    _ -> settings.codex.command
  end
end
```

- [ ] **Step 2: `start_port/2`（ローカル）を書き換える**

現在の `defp start_port(workspace, nil)`:

```elixir
defp start_port(workspace, nil) do
  executable = System.find_executable("bash")

  if is_nil(executable) do
    {:error, :bash_not_found}
  else
    port =
      Port.open(
        {:spawn_executable, String.to_charlist(executable)},
        [
          :binary,
          :exit_status,
          :stderr_to_stdout,
          args: [~c"-lc", String.to_charlist(Config.settings!().codex.command)],
          cd: String.to_charlist(workspace),
          line: @port_line_bytes
        ]
      )

    {:ok, port}
  end
end
```

変更後:

```elixir
defp start_port(workspace, nil) do
  executable = System.find_executable("bash")

  if is_nil(executable) do
    {:error, :bash_not_found}
  else
    command = resolve_command()
    [bin | _] = String.split(command)

    case System.find_executable(bin) do
      nil ->
        {:error, {:backend_command_not_found, bin}}

      _ ->
        port =
          Port.open(
            {:spawn_executable, String.to_charlist(executable)},
            [
              :binary,
              :exit_status,
              :stderr_to_stdout,
              args: [~c"-lc", String.to_charlist(command)],
              cd: String.to_charlist(workspace),
              line: @port_line_bytes
            ]
          )

        {:ok, port}
    end
  end
end
```

- [ ] **Step 3: `remote_launch_command/1` を書き換える**

現在:

```elixir
defp remote_launch_command(workspace) when is_binary(workspace) do
  [
    "cd #{shell_escape(workspace)}",
    "exec #{Config.settings!().codex.command}"
  ]
  |> Enum.join(" && ")
end
```

変更後:

```elixir
defp remote_launch_command(workspace) when is_binary(workspace) do
  [
    "cd #{shell_escape(workspace)}",
    "exec #{resolve_command()}"
  ]
  |> Enum.join(" && ")
end
```

- [ ] **Step 4: テストがパスすることを確認する**

```bash
cd apps/symphony
mise exec -- mix test test/symphony_elixir/app_server_test.exs --seed 0
```

期待: Task 6 で追加した 4 件のテストを含む全 AppServer テストが PASS

- [ ] **Step 5: 全テストが通ることを確認してコミット**

```bash
mise exec -- mix test
```

期待: 全テスト PASS

```bash
git add lib/symphony_elixir/codex/app_server.ex
git commit -m "feat(symphony): add resolve_command/0 and backend command existence check to AppServer"
```

---

## Task 8: examples/workflow.claude.md を作成

**Files:**
- Create: `apps/symphony/examples/workflow.claude.md`

- [ ] **Step 1: サンプルファイルを作成する**

```bash
cat > apps/symphony/examples/workflow.claude.md << 'WORKFLOW'
---
agent:
  type: claude
  # Claude Pro/Max は同時実行数に厳しいため 2〜3 を推奨
  max_concurrent_agents: 2
  max_turns: 10

# agent.type: claude のとき読まれる
# モデルや permission-mode は command 引数として指定する
claude:
  command: claude-app-server --model claude-opus-4-7 --permission-mode bypassPermissions

# agent.type: codex のとき読まれる（本家 Symphony 互換、変更ゼロ）
codex:
  command: codex --config shell_environment_policy.inherit=all --config 'model="gpt-5.5"' app-server
  approval_policy: never
  thread_sandbox: workspace-write
  turn_sandbox_policy:
    type: workspaceWrite

tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: your-project-slug

workspace:
  root: /tmp/concert-e2e/workspaces

hooks:
  after_create: |
    git init
    git config user.email "agent@concert.local"
    git config user.name "Concert Agent"
    echo "# Workspace" > README.md
    git add README.md
    git commit -m "Initial commit"
---

You are working on Linear issue {{ issue.identifier }}: {{ issue.title }}.

{{ issue.description }}

Instructions:
1. Read the issue description carefully and implement what is asked.
2. Commit your changes to the workspace git repository.
3. Update the Linear issue status to Done when complete.

To update Linear status, use the curl command below (LINEAR_API_KEY is available in the environment):

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation IssueUpdate($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }","variables":{"id":"ISSUE_ID","stateId":"STATE_ID"}}'
```
WORKFLOW
```

- [ ] **Step 2: コミット**

```bash
git add apps/symphony/examples/workflow.claude.md
git commit -m "feat(symphony): add workflow.claude.md example for Claude backend"
```

---

## Task 9: 最終確認

- [ ] **Step 1: 全テストを実行する**

```bash
cd apps/symphony
mise exec -- mix test
```

期待: 全テスト PASS、0 failures

- [ ] **Step 2: `agent.type: claude` のワークフローファイルをパースして設定が読めることを確認する（手動スモークテスト）**

```bash
cd apps/symphony
mise exec -- mix run -e '
path = "examples/workflow.claude.md"
SymphonyElixir.Workflow.set_workflow_file_path(path)
{:ok, settings} = SymphonyElixir.Config.settings()
IO.puts("agent.type: " <> settings.agent.type)
IO.puts("claude.command: " <> (settings.claude.command || "(nil)"))
'
```

期待:
```
agent.type: claude
claude.command: claude-app-server --model claude-opus-4-7 --permission-mode bypassPermissions
```

- [ ] **Step 3: README に agent.type の説明を追加する**

`apps/symphony/README.md` の設定例セクション（または末尾）に追記:

```markdown
## Claude backend を使う

WORKFLOW.md で `agent.type: claude` を指定すると `claude.command` が起動されます。

\```yaml
agent:
  type: claude          # claude | codex（未指定なら codex）
  max_concurrent_agents: 2

claude:
  command: claude-app-server --model claude-opus-4-7 --permission-mode bypassPermissions
\```

サンプル設定: [`examples/workflow.claude.md`](examples/workflow.claude.md)
```

- [ ] **Step 4: 最終コミット**

```bash
git add apps/symphony/README.md
git commit -m "docs(symphony): document agent.type backend selection in README"
```
