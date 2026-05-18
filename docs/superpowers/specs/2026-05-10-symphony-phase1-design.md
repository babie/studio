# Symphony Phase 1 設計: `agent.type` + `claude:` ブロック対応

**日付**: 2026-05-10  
**対象**: `apps/symphony/` (Elixir)  
**スコープ**: WORKFLOW.md の `agent.type` と `claude:` ブロックを認識し、`agent.type: claude` のとき `claude.command` でサブプロセスを起動できるようにする最小改造。

---

## 目的

WORKFLOW.md に以下の設定を書けるようにする:

```yaml
agent:
  type: claude
  max_concurrent_agents: 2

claude:
  command: claude-app-server --model claude-opus-4-7 --permission-mode bypassPermissions
```

`agent.type` が `claude` のとき `claude.command` を、それ以外（または未指定）のときは従来どおり `codex.command` をサブプロセスとして起動する。

---

## 変更ファイル

新規ファイルは作らない。既存の 2 ファイルへの追記のみ。

### 1. `lib/symphony_elixir/config/schema.ex`

#### 追加: `Claude` サブスキーマ

`Codex` モジュールの隣に追加する:

```elixir
defmodule Claude do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key false
  embedded_schema do
    field(:command, :string)
  end

  def changeset(schema, attrs) do
    schema
    |> cast(attrs, [:command], empty_values: [])
    |> validate_required([:command])
  end
end
```

#### 変更: `Agent` サブスキーマに `type` フィールド追加

```elixir
field(:type, :string, default: "codex")
```

`changeset/2` に追加:

```elixir
|> cast(attrs, [..., :type], empty_values: [])
|> validate_inclusion(:type, ["claude", "codex"])
```

#### 変更: ルート `embedded_schema` に `claude` 埋め込み追加

```elixir
embeds_one(:claude, Claude, on_replace: :update, defaults_to_struct: true)
```

#### 変更: `changeset/1` に `cast_embed(:claude)` 追加

```elixir
|> cast_embed(:claude, with: &Claude.changeset/2)
```

#### 変更: クロスフィールドバリデーション

`Schema.parse/1` 内、または `changeset/1` の末尾に追加:

```elixir
defp validate_claude_command(changeset) do
  case get_field(changeset, :agent) do
    %{type: "claude"} ->
      case get_field(changeset, :claude) do
        %{command: cmd} when is_binary(cmd) and cmd != "" -> changeset
        _ -> add_error(changeset, :claude, "command is required when agent.type is claude")
      end
    _ -> changeset
  end
end
```

エラーメッセージ例: `"Invalid WORKFLOW.md config: claude command is required when agent.type is claude"`

---

### 2. `lib/symphony_elixir/codex/app_server.ex`

#### 追加: `resolve_command/0` プライベート関数

```elixir
defp resolve_command do
  settings = Config.settings!()
  case settings.agent.type do
    "claude" -> settings.claude.command
    _ -> settings.codex.command
  end
end
```

#### 変更: `start_port/2` (ローカル起動)

`bash` の存在チェックの後、`resolve_command()` でコマンドを取得してバイナリの存在チェックを追加する:

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
              :binary, :exit_status, :stderr_to_stdout,
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

#### 変更: `remote_launch_command/1`

現在:
```elixir
"exec #{Config.settings!().codex.command}"
```

変更後:
```elixir
"exec #{resolve_command()}"
```

---

## データフロー

```
WORKFLOW.md
  → YamlElixir.read_from_string
  → Schema.parse (agent.type, claude.command のバリデーション含む)
  → Config.settings!()
  → AppServer.start_port
    → resolve_command()  # agent.type で分岐
    → System.find_executable(bin)  # コマンド存在チェック
    → Port.open (bash -lc <command>)
```

---

## エラーハンドリング

| 状況 | エラー |
|---|---|
| `agent.type: claude` + `claude:` ブロックなし | `{:error, {:invalid_workflow_config, "claude command is required when agent.type is claude"}}` |
| `agent.type: claude` + `claude.command` が空文字 | 同上 (`validate_required` が弾く) |
| コマンドバイナリが PATH にない | `{:error, {:backend_command_not_found, "claude-app-server"}}` |
| `agent.type` が `"claude"` でも `"codex"` でもない | `{:error, {:invalid_workflow_config, "agent.type is invalid"}}` |

既存の Codex 通信エラー（タイムアウト、ポート終了等）は変更なし。

---

## テスト戦略

### A. Schema ユニットテスト（`workspace_and_config_test.exs` に追加）

フェイクバイナリ不要、`Schema.parse/1` を直接呼ぶ:

- `agent.type: claude` + `claude.command` 指定 → パース成功
- `agent.type: claude` + `claude:` ブロックなし → `{:error, {:invalid_workflow_config, _}}`
- `agent.type: codex` → パース成功、`codex.command` が従来値
- `agent.type` 未指定 → デフォルト `"codex"` でパース成功
- `agent.type: unknown_value` → バリデーションエラー

### B. AppServer 統合テスト（`app_server_test.exs` に追加）

フェイクシェルスクリプトを一時ファイルとして作成して起動（既存スタイルと同じ）:

- `agent.type: claude` + `claude.command: <fake-claude-binary>` → fake-claude-binary が起動される
- `agent.type: codex` または未指定 → `codex.command` が起動される
- `claude.command` のバイナリが PATH にない → `{:error, {:backend_command_not_found, _}}` が返る

---

## 変更しないもの

- `Codex.AppServer` のモジュール名リネーム → しない
- behaviour/dispatch テーブル導入 → しない
- `codex:` ブロックの既存フィールド → 変更ゼロ
- SSH / リモートワーカー経路の既存ロジック → `resolve_command()` に委ねるだけ

---

## サンプル設定（`examples/workflow.claude.md`）

```markdown
---
agent:
  type: claude
  max_concurrent_agents: 2  # Claude Pro/Max では 2〜3 推奨
  max_turns: 10

claude:
  command: claude-app-server --model claude-opus-4-7 --permission-mode bypassPermissions

codex:
  command: codex app-server

tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: your-project
---

You are working on Linear issue {{ issue.identifier }}: {{ issue.title }}.

...
```
