# Milestone 2 Phase 3: Orchestrator 連携 + 自動遷移 — 設計書

**日付:** 2026-05-15
**対象:** [`TODO.md`](../../../TODO.md) Milestone 2 Phase 3
**ステータス:** 設計確定、実装プラン待ち

---

## 背景

Milestone 2 Phase 1 ([`2026-05-14-m2-phase1-design.md`](2026-05-14-m2-phase1-design.md)) で tracker schema を kind 別に分割し、共通ブロックに `pickup_state` / `success_state` フィールドを追加。Phase 2 ([`2026-05-14-m2-phase2-design.md`](2026-05-14-m2-phase2-design.md)) で GitHub Adapter 5 callback と `Github.ProjectMeta` の warmup・validation を実装。**ただしこれら 2 つのフィールドはまだ実際の振る舞いに繋がっていない**。

Phase 3 では、これらフィールドを **orchestrator 側から発火する自動 state 遷移ロジックの起点** として配線する。同時に、本家 Symphony が backend (Codex) の `linear_graphql` 動的ツールに任せていた issue state mutation 責務を、**Symphony オーケストレーター本体に移管する**。これにより:

- **エージェントの使用トークン削減** — 状態遷移を LLM プロンプトで指示する必要がなくなる
- **責務の明確化** — issue 操作は Symphony 側の仕事、LLM はコードを書く仕事に集中
- **遷移忘れ・誤遷移リスクの排除** — プログラムでできることはプログラムに任せる

M2 全体の Phase 構成と設計指針は [`TODO.md`](../../../TODO.md) Milestone 2 セクションを参照。Phase 4 (実機 E2E + ドキュメント整備) は本 spec のスコープ外。

---

## 設計判断サマリ (clarify 結果)

| 論点 | 採択 |
|---|---|
| 命名 | `pickup_state` → **`doing_state`**、`success_state` → **`done_state`** (Phase 3 内で sweep) |
| Doing 遷移の発火タイミング | orchestrator 内、`Task.Supervisor.start_child` が `{:ok, pid}` を返した直後 |
| Done 遷移の発火条件 | `last_codex_event == :turn_completed` AND `:DOWN reason == :normal` AND refresh 後 issue が active states に居ない |
| 適用範囲 | tracker.kind 不問 (Linear / GitHub / Memory どれでも `doing_state` / `done_state` 設定時に発火、未設定なら no-op) |
| Tracker mutation 失敗時 | 3 試行 (初回 + 250ms / 1s backoff の 2 retry)、全失敗で warning ログ + 継続 (best-effort) |
| 取り残し issue の recovery | Phase 3 では retry のみ。起動時 sweep / polling 補正 / 失敗時コメントは M3 以降 |

### 命名変更の理由

`pickup_state: "In Progress"` は「In Progress をピックアップする」と読めて誤読しやすい。実際の意味は「ピックアップしたら *どこに* 流すか」の "どこに" 側。

`doing` / `done` ペアは Todo/Doing/Done という agile board の慣用語に乗っており、「Symphony が作業中とみなす遷移先」「Symphony が成功裏に完了させたとみなす遷移先」を直感的に表現できる。`pickup_state` / `success_state` は本家 Symphony には無く今回のフォークで導入した独自概念なので、互換性負債なくリネームできる。

### 適用範囲をジェネリックにする理由

`Tracker.update_issue_state/2` は既に adapter-agnostic で、現状 production 側にも `Tracker.update_issue_state` の caller はゼロ (Phase 3 が初の本物の caller)。Linear ユーザが prompt 方式 (`linear_graphql` 動的ツール / curl) のまま運用したい場合は `doing_state` / `done_state` 未設定にすれば自動的に no-op になる。逆に Linear ユーザが「state 遷移を Symphony 側に寄せる」設計に乗りたい場合、追加コード無しで opt-in できる。

TODO L143 の「Linear adapter の自動遷移化」項目は Phase 3 完了時点で実質クローズし、M3 セクションから削除する。

---

## 目標

Phase 3 完了条件:

1. WORKFLOW.md の `tracker.doing_state` / `tracker.done_state` を orchestrator が読み、適切なタイミングで `Tracker.update_issue_state/2` を呼ぶ
2. Doing 遷移: 各 issue dispatch (worker spawn 成功直後) に発火
3. Done 遷移: backend が **`turn/completed` 受信 + `:normal` exit + refresh 後 issue が non-active** の三条件で発火
4. mutation 失敗は warning ログ + 継続 (3 試行までは透過的 retry)
5. `tracker.doing_state` / `tracker.done_state` 未設定時は完全 no-op
6. 既存テスト (240 件以上) が全緑、新規テストで遷移発火・no-op パスを Memory adapter ベースで検証
7. リネーム sweep: schema / project_meta / 既存 spec / TODO / fixture / docs のすべてで `pickup_state` / `success_state` → `doing_state` / `done_state` に更新

明示的なスコープ外:

- **取り残し issue の recovery** — 起動時 sweep / polling 補正 / 失敗時コメント は M3 以降 (理由: LLM や人間が並行して issue を手動操作している可能性があり、Symphony が claim 不在を理由に勝手に state を書き戻すと協調作業の事故になる)
- **実機 GitHub での E2E 確認** — Phase 4
- **ADR-0013 / ADR-0014 執筆** — Phase 4
- **`examples/workflow.github.md` 整備** — Phase 4
- **`linear_graphql` 動的ツールの撤去** — 後方互換のため当面残す (M3 以降で議論)

---

## 全体アーキテクチャ

```
lib/symphony_elixir/
├── orchestrator.ex                 # ★ doing/done transition の窓口
│   ├── spawn_issue_on_worker_host  #   spawn成功直後 → maybe_doing_transition
│   ├── handle_info(:DOWN, :normal) #   → handle_backend_finished → maybe_done_transition
│   └── tracker_update_with_retry   #   共通 retry ヘルパ (新規)
├── config/schema.ex                # ★ Tracker embed: pickup_state→doing_state, success_state→done_state
├── github/project_meta.ex          # ★ warmup validation のキー名 sweep
└── tracker.ex                      #   (変更なし)

test/
├── symphony_elixir/
│   ├── orchestrator_doing_transition_test.exs   # 新規
│   ├── orchestrator_done_transition_test.exs    # 新規
│   ├── config/schema_test.exs                   # ★ フィールド名 sweep
│   └── github/project_meta_test.exs             # ★ アサート sweep
└── support/
    ├── test_support.exs                          # ★ tracker_pickup_state → tracker_doing_state
    └── mock_tracker_adapter.exs                  # 新規 (retry/error テスト用)
```

---

## 命名 sweep の対象一覧

リネームは Phase 3 PR に同梱する **破壊的変更**。互換シムは入れない (ルート CLAUDE.md「本家追従不要」方針)。

| ファイル | 変更 |
|---|---|
| `apps/symphony/lib/symphony_elixir/config/schema.ex` | `Tracker` embed の `:pickup_state` → `:doing_state`、`:success_state` → `:done_state` |
| `apps/symphony/lib/symphony_elixir/github/project_meta.ex` | `[:pickup_state, :success_state]` 参照、エラーメッセージ、ProjectMeta 構造体に保持していれば構造体フィールド名 |
| `apps/symphony/lib/symphony_elixir/orchestrator.ex` | (Phase 3 新規コードで `doing_state` / `done_state` を読む) |
| `apps/symphony/test/support/test_support.exs` | キーワード引数 `tracker_pickup_state` → `tracker_doing_state`、`tracker_success_state` → `tracker_done_state`、YAML 生成側の文字列 |
| `apps/symphony/test/symphony_elixir/github/project_meta_test.exs` | アサート文字列、setup の状態名 |
| `apps/symphony/test/symphony_elixir/github/adapter_test.exs` | setup の状態名 |
| `apps/symphony/test/symphony_elixir/config/schema_test.exs` (存在すれば) | フィールド名 |
| `docs/superpowers/specs/2026-05-14-m2-phase1-design.md` | 表記 sweep (本文の YAML 例とテキスト) |
| `docs/superpowers/specs/2026-05-14-m2-phase2-design.md` | 表記 sweep |
| `docs/superpowers/plans/2026-05-14-m2-phase2-github-adapter.md` | 表記 sweep |
| `TODO.md` | Milestone 2 の横断指針 / Phase 1〜4 chk / 「Linear adapter 自動遷移化」項目の整理 |
| `apps/symphony/CLAUDE.md` (参照があれば) | 表記 sweep |
| `docs/architecture.md` / `docs/protocol.md` (YAML 例があれば) | 表記 sweep |
| `apps/symphony/examples/workflow.*.md` (`pickup_state`参照があれば) | 表記 sweep |
| ルート `CLAUDE.md` (参照があれば) | 表記 sweep |

実装前に grep で `pickup_state\|success_state` の全 hit を確認、テスト緑のまま 1 コミットで sweep するのが安全。

---

## Doing transition (作業開始時の自動遷移)

### 配置

`lib/symphony_elixir/orchestrator.ex` の `spawn_issue_on_worker_host/5` 内、`{:ok, pid}` 分岐で `running` map を更新したあと、戻り値 (新 state) を返す直前に呼ぶ。

```elixir
defp spawn_issue_on_worker_host(%State{} = state, issue, attempt, recipient, worker_host) do
  case Task.Supervisor.start_child(...) do
    {:ok, pid} ->
      ref = Process.monitor(pid)

      Logger.info("Dispatching issue to agent: ...")

      running = Map.put(state.running, issue.id, %{...})

      new_state = %{state | running: running, claimed: ..., retry_attempts: ...}

      :ok = maybe_doing_transition(issue)   # ★ 追加

      new_state

    {:error, reason} ->
      # ... 既存
  end
end
```

### 実装

```elixir
defp maybe_doing_transition(%Issue{} = issue) do
  case Config.settings!().tracker.doing_state do
    target when target in [nil, ""] ->
      :ok

    target_state ->
      cond do
        normalize_issue_state(issue.state) == normalize_issue_state(target_state) ->
          Logger.debug(
            "Skipping doing_state transition; issue already in target state: " <>
              "#{issue_context(issue)} state=#{issue.state}"
          )

          :ok

        true ->
          case tracker_update_with_retry(issue, target_state) do
            :ok ->
              Logger.info(
                "Transitioned issue to doing_state: #{issue_context(issue)} target=#{target_state}"
              )

            {:error, reason} ->
              Logger.warning(
                "Failed to transition issue to doing_state: " <>
                  "#{issue_context(issue)} target=#{target_state} reason=#{inspect(reason)}; continuing"
              )
          end

          :ok
      end
  end
end
```

### 設計上のポイント

- **同期実行**: orchestrator GenServer の `handle_info(:run_poll_cycle, ...)` 経路で呼ばれる。RTT (数百ms) + 最悪 retry 1.25s ≪ polling interval (30s 既定) で許容範囲。
- **`nil` / `""` で no-op**: Linear ユーザの prompt 方式運用、Memory tracker のテスト、tracker.kind 切替の途中状態などすべてに安全。
- **idempotent**: issue.state が既に doing_state なら mutation スキップ。これは `revalidate_issue_for_dispatch` 経由で refresh された issue を渡す前提なので、最新の state が見えている。
- **claim 確定後に発火**: `running` map と `claimed` MapSet が立った後に呼ぶので、tracker mutation 中に他のポーリングが同じ issue を二重 dispatch することはない。
- **失敗は dispatch をブロックしない**: warning ログのみで処理続行。issue.state は元のまま、worker は走っている = UI 上は若干ぶら下がるが、worker が正常に終わって done transition が走れば追いつく可能性あり (done 側も idempotent)。永続的失敗時は M3 以降で運用補助 (失敗コメント等) を入れる。

---

## Done transition (作業成功時の自動遷移)

### 配置

`lib/symphony_elixir/orchestrator.ex` の `handle_info({:DOWN, ref, :process, _pid, reason}, ...)` ハンドラ。`:normal` 分岐内、`complete_issue` の前に `handle_backend_finished/2` を挿入。

```elixir
state =
  case reason do
    :normal ->
      Logger.info("Agent task completed for issue_id=#{issue_id} ...")

      state
      |> handle_backend_finished(running_entry)            # ★ 追加
      |> complete_issue(issue_id)
      |> schedule_issue_retry(issue_id, 1, %{
        identifier: running_entry.identifier,
        delay_type: :continuation,
        worker_host: Map.get(running_entry, :worker_host),
        workspace_path: Map.get(running_entry, :workspace_path)
      })

    _ ->
      # ... 既存 (リトライ経路、done transition は呼ばない)
  end
```

### 実装

```elixir
defp handle_backend_finished(state, running_entry) when is_map(running_entry) do
  case Map.get(running_entry, :last_codex_event) do
    :turn_completed ->
      case Map.get(running_entry, :issue) do
        %Issue{} = issue -> maybe_done_transition(issue)
        _ -> :ok
      end

    other ->
      Logger.debug(
        "Skipping done_state transition; last_codex_event=#{inspect(other)}"
      )
  end

  state
end

defp maybe_done_transition(%Issue{} = issue) do
  case Config.settings!().tracker.done_state do
    target when target in [nil, ""] -> :ok
    target_state -> attempt_done_transition(issue, target_state)
  end
end

defp attempt_done_transition(%Issue{id: issue_id} = issue, target_state) do
  case Tracker.fetch_issue_states_by_ids([issue_id]) do
    {:ok, [%Issue{state: current_state} = refreshed | _]} ->
      cond do
        active_issue_state?(current_state, active_state_set()) ->
          Logger.debug(
            "Skipping done_state transition; issue still active: " <>
              "#{issue_context(refreshed)} state=#{current_state}"
          )

        normalize_issue_state(current_state) == normalize_issue_state(target_state) ->
          Logger.debug(
            "Skipping done_state transition; already in target: " <>
              "#{issue_context(refreshed)} state=#{current_state}"
          )

        true ->
          case tracker_update_with_retry(refreshed, target_state) do
            :ok ->
              Logger.info(
                "Transitioned issue to done_state: " <>
                  "#{issue_context(refreshed)} target=#{target_state}"
              )

            {:error, reason} ->
              Logger.warning(
                "Failed to transition issue to done_state: " <>
                  "#{issue_context(refreshed)} target=#{target_state} reason=#{inspect(reason)}; continuing"
              )
          end
      end

    {:ok, []} ->
      Logger.debug(
        "Skipping done_state transition; issue no longer visible: #{issue_context(issue)}"
      )

    {:error, reason} ->
      Logger.warning(
        "Skipping done_state transition; refresh failed: " <>
          "#{issue_context(issue)} reason=#{inspect(reason)}"
      )
  end

  :ok
end
```

### 3 条件 AND の判定根拠

| 条件 | 検出ソース | 検出を逃すケース |
|---|---|---|
| ① `last_codex_event == :turn_completed` | `running_entry.last_codex_event` (既存) | `turn/failed` / `turn/cancelled` 後に exit、または turn を 1 度も走らせずに exit |
| ② `:DOWN reason == :normal` | `handle_info` の引数 | AgentRunner が `{:error, _}` 経由で raise した場合 |
| ③ refresh 後 issue が active states に居ない | `Tracker.fetch_issue_states_by_ids` | max_turns 切れで AgentRunner が `:ok` を返したが issue がまだ active state にある |

`① + ②` は TODO の「turn/completed + subprocess exit 統合判定」をそのまま実装。③ は max_turns 切れケースの誤発火を防ぐ追加ガード。

### 既存 reconcile_running_issue_states との関係

`reconcile_running_issue_states` (orchestrator.ex L275 周辺) は「polling cycle 中に外部で issue が terminal 状態に動いた → running worker を kill」する経路。`handle_backend_finished` は「自分が backend を回した結果 backend が正常終了した → done_state に動かす」経路。責務が直交しており、同じ issue について両方が同時に走ることはない (どちらかが先に `running` map から削除する)。

### LLM 先行ケース (`linear_graphql` 経由)

旧 Linear 経路で LLM が prompt 指示通り Linear API を叩いて先に `Done` に動かしていた場合、refresh で current_state が `done_state` と一致するので idempotent no-op になる。後方互換あり。

---

## Tracker mutation の retry ポリシー

`doing_state` / `done_state` どちらの mutation も同一の `tracker_update_with_retry/2` ヘルパで包む。

### 実装

```elixir
# orchestrator.ex (private)
@tracker_update_retry_backoffs_ms [250, 1_000]

defp tracker_update_with_retry(%Issue{} = issue, target_state) do
  do_tracker_update(issue, target_state, @tracker_update_retry_backoffs_ms)
end

defp do_tracker_update(issue, target_state, []) do
  Tracker.update_issue_state(issue, target_state)
end

defp do_tracker_update(issue, target_state, [backoff_ms | rest]) do
  case Tracker.update_issue_state(issue, target_state) do
    :ok ->
      :ok

    {:error, reason} ->
      Logger.debug(
        "Tracker mutation transient failure; retrying after #{backoff_ms}ms: " <>
          "#{inspect(reason)} #{issue_context(issue)} target=#{target_state}"
      )

      Process.sleep(backoff_ms)
      do_tracker_update(issue, target_state, rest)
  end
end
```

### 設計上のポイント

- **3 試行 (初回 + 250ms / 1s backoff)**: 最悪 1.25s 程度 orchestrator GenServer がブロック。polling interval (30s 既定) と比べて無視できる。
- **エラー種別を区別しない**: GraphQL 4xx (恒常エラー) も含めて retry するが、1.25s 余分にかけても運用への影響は無視できる。判定ロジックを増やすほうが負債。
- **`Process.sleep` で GenServer をブロックする選択**: `Task.async` で非同期化すると state 引き回し / メッセージング / メールボックス順序の議論が増える。Phase 3 は同期実装で計測 → 必要なら Phase 4 で再検討。
- **永続失敗時 (3 連続失敗)**: 呼び出し側 (`maybe_doing_transition` / `attempt_done_transition`) が warning ログを出して継続。issue は元の状態のまま残るが、Symphony 側のロジックは前進する。

---

## Recovery のスコープ境界

Phase 3 では **transient ネットワーク失敗向けの retry のみ** を入れる。下記の本格的な recovery は M3 以降に送る。

| 項目 | Phase 3 での扱い | 移送先 / 理由 |
|---|---|---|
| 起動時 sweep (doing_state に居る running 不在 issue を Todo に戻す) | やらない | LLM / 人間が並行して手動操作している可能性があり、claim 不在を「取り残し」と断定すると協調作業を巻き戻す事故になる。M3 以降の運用ノウハウ蓄積と合わせて議論 |
| polling での doing_state 補正 | やらない | 上と同じ理由 |
| 失敗時 comment 投稿 | やらない | TODO L140「失敗時 comment / max_attempts」と統合 (M3 以降) |
| max_attempts に基づくエスカレーション | やらない | TODO L140 と統合 (M3 以降) |
| 永続失敗時の issue ハンドリング | warning ログのみ | オペレータが Logger / dashboard で気付き、UI で手動修正することを期待 |

> **重要な観察**: 「Symphony が claim していない doing_state の issue = エラー / 取り残し」とは限らない。LLM が `linear_graphql` で先に動かしているケース、人間が手動で issue を進行させているケース、別の Symphony インスタンスや別バックエンドが動いているケースがすべてあり得る。recovery を能動化する前に、これらと区別できる marker (ラベル / コメント / 専用フィールド) の設計を先行させる必要がある。

---

## テスト戦略

### Memory adapter ベースの結合テスト

Memory adapter は既に `{:memory_tracker_state_update, issue_id, state_name}` イベントを `Application.get_env(:symphony_elixir, :memory_tracker_recipient)` の pid に送る (`extensions_test.exs:198` で先例あり)。これを `self()` に向けてセットすれば `assert_receive` / `refute_receive` で遷移発火を直接検証できる。

### Mock Tracker Adapter (retry / error テスト用)

Memory adapter は常に `:ok` を返すので、retry や error 系のテスト用に scripted な Mock を別途用意。`Application.put_env/get_env` ベースのスクリプト消費は test 間で stateful になるため、Mock を使うテストは `async: false` で書く前提。

```elixir
# test/support/mock_tracker_adapter.exs
defmodule SymphonyElixir.TestSupport.MockTrackerAdapter do
  @behaviour SymphonyElixir.Tracker

  alias SymphonyElixir.Tracker.Issue

  @app :symphony_elixir
  @update_responses_key :mock_tracker_update_responses
  @refresh_responses_key :mock_tracker_refresh_responses
  @recipient_key :mock_tracker_recipient

  def fetch_candidate_issues, do: {:ok, []}
  def fetch_issues_by_states(_), do: {:ok, []}
  def create_comment(_, _), do: :ok

  def fetch_issue_states_by_ids(_ids) do
    consume(@refresh_responses_key, {:ok, []})
  end

  def update_issue_state(%Issue{id: id} = _issue, state_name) do
    response = consume(@update_responses_key, :ok)
    notify({:mock_tracker_update_attempted, id, state_name, response})
    response
  end

  defp consume(key, default) do
    case Application.get_env(@app, key, []) do
      [next | rest] ->
        Application.put_env(@app, key, rest)
        next

      [] ->
        default
    end
  end

  defp notify(message) do
    case Application.get_env(@app, @recipient_key) do
      pid when is_pid(pid) -> send(pid, message)
      _ -> :ok
    end
  end
end
```

各テストの setup で `Application.put_env(:symphony_elixir, :mock_tracker_update_responses, [{:error, :timeout}, :ok])` のようにレスポンス列をセットし、on_exit で `Application.delete_env/2` する。

`Tracker.resolve_adapter/1` に override hook を 1 行追加:

```elixir
def resolve_adapter(kind) do
  case Application.get_env(:symphony_elixir, :tracker_adapter_override) do
    nil -> default_resolve_adapter(kind)
    module when is_atom(module) -> module
  end
end

defp default_resolve_adapter("memory"), do: SymphonyElixir.Tracker.Memory
defp default_resolve_adapter("github"), do: SymphonyElixir.Github.Adapter
defp default_resolve_adapter(_other), do: SymphonyElixir.Linear.Adapter
```

テストの setup / on_exit で override をセット/解除する。

### Doing transition テストケース (`orchestrator_doing_transition_test.exs`)

| # | シナリオ | 期待 |
|---|---|---|
| 1 | `tracker.doing_state: "In Progress"` 設定 + 通常 dispatch | `assert_receive {:memory_tracker_state_update, "issue-1", "In Progress"}` |
| 2 | `tracker.doing_state: nil` で dispatch | `refute_receive {:memory_tracker_state_update, _, _}, 100` |
| 3 | issue.state が既に `"In Progress"` で dispatch | `refute_receive {:memory_tracker_state_update, _, _}, 100` (idempotent no-op) |
| 4 | Mock adapter で `[{:error, :timeout}, :ok]` を返す | 最終 `:ok`、warning ログなし、`{:mock_tracker_update_attempted, _, _, :ok}` を確認 |
| 5 | Mock adapter で 3 連続 `{:error, :timeout}` | `capture_log` で warning メッセージ確認、dispatch 自体は完走 |

### Done transition テストケース (`orchestrator_done_transition_test.exs`)

| # | シナリオ | 期待 |
|---|---|---|
| 1 | running_entry.last_codex_event = `:turn_completed` + `:DOWN :normal` + refresh で issue が non-active state (例: `"Done"` 以外の terminal) を返す | `assert_receive {:memory_tracker_state_update, _, "Done"}` |
| 2 | max_turns 切れ: 上と同じだが refresh で active state (`"In Progress"`) を返す | `refute_receive {:memory_tracker_state_update, _, "Done"}, 100` |
| 3 | last_codex_event = `:turn_failed` で `:DOWN :normal` (実環境では起きないが防御線) | no-op |
| 4 | `:DOWN reason != :normal` (retry 経路) | no-op |
| 5 | refresh で current_state が既に `"Done"` | no-op |
| 6 | `tracker.done_state: nil` | 全条件揃っても no-op |
| 7 | refresh が `{:error, :timeout}` | warning ログ + no-op、`complete_issue` は通常通り進行 |
| 8 | update が 3 連続失敗 | warning ログ、`complete_issue` 通常進行 |

### 既存テスト

| ファイル | 変更 |
|---|---|
| `config/schema_test.exs` | field 名 sweep (`doing_state` / `done_state`) |
| `github/project_meta_test.exs` | validation メッセージ / setup の state 名 sweep |
| `test_support.exs` | `tracker_pickup_state` / `tracker_success_state` キーワードと YAML 生成を sweep |
| 全体 | `mix test` 緑のまま、240+ tests skip 2 を維持 |

### Phase 4 で扱うテスト

実機 GitHub Project に対する doing → done 遷移確認、`linear_graphql` 撤去後の Linear 完全 Symphony 駆動運用の検証は Phase 4 / M3 で行う。

---

## 完了条件 (チェックリスト)

- [ ] `Tracker` embed の `pickup_state` / `success_state` を `doing_state` / `done_state` にリネーム
- [ ] `Github.ProjectMeta.warmup!` の validation キー名・エラーメッセージを sweep
- [ ] `orchestrator.ex` に `maybe_doing_transition/1` を実装、`spawn_issue_on_worker_host` から呼ぶ
- [ ] `orchestrator.ex` に `handle_backend_finished/2` / `maybe_done_transition/1` / `attempt_done_transition/2` を実装、`:DOWN :normal` 分岐から呼ぶ
- [ ] `orchestrator.ex` に `tracker_update_with_retry/2` 共通ヘルパを実装 (250ms / 1s backoff、3 試行)
- [ ] `Tracker.resolve_adapter/1` に test override hook を追加
- [ ] `test/support/mock_tracker_adapter.exs` を新設
- [ ] `test/symphony_elixir/orchestrator_doing_transition_test.exs` を新設 (上記 5 ケース)
- [ ] `test/symphony_elixir/orchestrator_done_transition_test.exs` を新設 (上記 8 ケース)
- [ ] `test_support.exs` のキーワード / YAML を sweep
- [ ] 既存 spec / TODO / docs / CLAUDE.md / examples の表記を sweep
- [ ] `mix test` 全緑 (240+ tests skip 2)、回帰なし
- [ ] TODO.md Milestone 3 セクションから「Linear adapter の自動遷移化」項目を削除 (Phase 3 完了で実質クローズ)

---

## 不確実性 / 実装時に確認する点

| # | 項目 | 対応 |
|---|---|---|
| 1 | `Process.sleep` を GenServer 内で使う影響 | 最悪 1.25s。polling 30s に対し無視可能と判断。Phase 4 で計測、問題あれば Phase 4 で `Task.async` 化 |
| 2 | `Github.ProjectMeta` 構造体に `pickup_state` / `success_state` を保持しているか | 実装時に確認、保持していれば構造体フィールドも sweep |
| 3 | `Tracker.resolve_adapter/1` の override hook の API 名 | `:tracker_adapter_override` で進める、実装時にネーミング再検討の余地あり |
| 4 | Memory adapter の `update_issue_state` イベント送信 | 既存実装あり (`memory.ex:44-48`)、追加変更不要 |
| 5 | `last_codex_event` が `:turn_completed` 以外の終端値を取り得るか | `:turn_failed` / `:turn_cancelled` で `:DOWN :normal` の組み合わせは実環境では起きないが、Mock テストで防御線を確認 |
| 6 | 既存 `examples/workflow.claude.md` / `examples/workflow.codex.md` 等に `pickup_state` / `success_state` の記載があるか | sweep 対象。実装時に grep |
| 7 | `tracker.doing_state` / `tracker.done_state` の起動時 validation (Phase 2 で警告レベル) | リネームのみ、振る舞いは Phase 2 のまま |
| 8 | `Tracker.fetch_issue_states_by_ids/1` の return shape (Linear adapter で空リストや欠落 issue) | 既存実装通り扱う、refresh 失敗時の no-op で吸収 |

---

## 参考

- [TODO.md Milestone 2](../../../TODO.md)
- [`2026-05-14-m2-phase1-design.md`](2026-05-14-m2-phase1-design.md) — Phase 1 schema 分割
- [`2026-05-14-m2-phase2-design.md`](2026-05-14-m2-phase2-design.md) — Phase 2 GitHub Adapter
- [`docs/milestones/01-claude-minimal.md`](../../milestones/01-claude-minimal.md) — Milestone 1 完了記録
- 本家 Symphony の `linear_graphql` 動的ツール: `apps/symphony/lib/symphony_elixir/codex/dynamic_tool.ex`
- 既存の Memory tracker event スキーム: `apps/symphony/lib/symphony_elixir/tracker/memory.ex:38-48`
