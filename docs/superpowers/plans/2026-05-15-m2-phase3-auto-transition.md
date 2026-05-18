# Milestone 2 Phase 3: Orchestrator Auto-Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `tracker.doing_state` / `tracker.done_state` into Symphony orchestrator so state mutations happen automatically at dispatch + backend-finished lifecycle points. Renames `pickup_state` / `success_state` to `doing_state` / `done_state` as part of the change.

**Architecture:** Two new private functions in `orchestrator.ex` (`maybe_doing_transition/1`, `handle_backend_finished/2` + helpers), wired into existing `spawn_issue_on_worker_host` and `:DOWN :normal` handler. Both go through a shared `tracker_update_with_retry/2` helper (3 attempts with 250ms / 1s backoff). Mutation failures log warning + continue (best-effort). Recovery for stranded issues is out of scope (M3+).

**Tech Stack:** Elixir 1.19, GenServer, Ecto schema, ExUnit + `assert_receive` / `refute_receive`, existing Memory tracker adapter, new `MockTrackerAdapter` for scripted error injection.

**Spec:** [`docs/superpowers/specs/2026-05-15-m2-phase3-design.md`](../specs/2026-05-15-m2-phase3-design.md)

---

## File Structure

**Modified:**
- `apps/symphony/lib/symphony_elixir/config/schema.ex` — `Tracker` embed: `:pickup_state` → `:doing_state`, `:success_state` → `:done_state`
- `apps/symphony/lib/symphony_elixir/github/project_meta.ex` — warmup validation key list + `tracker/0` helper struct fields
- `apps/symphony/lib/symphony_elixir/tracker.ex` — add `:tracker_adapter_override` Application env hook
- `apps/symphony/lib/symphony_elixir/orchestrator.ex` — add private helpers (`tracker_update_with_retry`, `maybe_doing_transition`, `handle_backend_finished`, `maybe_done_transition`, `attempt_done_transition`) + 2 `_for_test` wrappers + 2 wire-up sites
- `apps/symphony/test/support/test_support.exs` — defaults / `Keyword.get` / YAML rename
- `apps/symphony/test/symphony_elixir/github/project_meta_test.exs` — setup state names + assertion strings
- `apps/symphony/test/symphony_elixir/github/adapter_test.exs` — setup state names
- `apps/symphony/test/symphony_elixir/tracker_test.exs` — add override test
- `apps/symphony/CLAUDE.md` — text sweep
- `TODO.md` — text sweep + remove "Linear adapter 自動遷移化" + mark Phase 3 done
- `docs/superpowers/specs/2026-05-14-m2-phase1-design.md` — text sweep
- `docs/superpowers/specs/2026-05-14-m2-phase2-design.md` — text sweep
- `docs/superpowers/plans/2026-05-14-m2-phase2-github-adapter.md` — text sweep

**Created:**
- `apps/symphony/test/support/mock_tracker_adapter.exs` — scripted `Tracker` behaviour for retry / error tests
- `apps/symphony/test/symphony_elixir/orchestrator_doing_transition_test.exs` — 5 cases
- `apps/symphony/test/symphony_elixir/orchestrator_done_transition_test.exs` — 8 cases

---

## Task 1: Rename `pickup_state` / `success_state` → `doing_state` / `done_state` (code + tests)

**Files:**
- Modify: `apps/symphony/lib/symphony_elixir/config/schema.ex` (lines 51-60)
- Modify: `apps/symphony/lib/symphony_elixir/github/project_meta.ex` (lines 149, 204-205)
- Modify: `apps/symphony/test/support/test_support.exs` (lines 98-99, 144-145, 191-192)
- Modify: `apps/symphony/test/symphony_elixir/github/project_meta_test.exs` (lines 22-23, 98-99, 174-175)
- Modify: `apps/symphony/test/symphony_elixir/github/adapter_test.exs` (lines 22-23)

This must be **one atomic commit** so test suite stays green between commits. Rename is mechanical; no behavior change.

- [ ] **Step 1: Edit `config/schema.ex` `Tracker` embed**

Replace lines 51-52:

```elixir
      field(:pickup_state, :string)
      field(:success_state, :string)
```

with:

```elixir
      field(:doing_state, :string)
      field(:done_state, :string)
```

Replace line 60 (inside `cast/3` call):

```elixir
        [:kind, :active_states, :terminal_states, :pickup_state, :success_state],
```

with:

```elixir
        [:kind, :active_states, :terminal_states, :doing_state, :done_state],
```

- [ ] **Step 2: Edit `github/project_meta.ex`**

Replace line 149:

```elixir
    [:pickup_state, :success_state]
```

with:

```elixir
    [:doing_state, :done_state]
```

Replace lines 204-205 (inside `tracker/0` helper):

```elixir
          pickup_state: tracker.pickup_state,
          success_state: tracker.success_state
```

with:

```elixir
          doing_state: tracker.doing_state,
          done_state: tracker.done_state
```

- [ ] **Step 3: Edit `test/support/test_support.exs`**

Replace lines 98-99 (defaults):

```elixir
          tracker_pickup_state: nil,
          tracker_success_state: nil,
```

with:

```elixir
          tracker_doing_state: nil,
          tracker_done_state: nil,
```

Replace lines 144-145 (`Keyword.get`):

```elixir
    tracker_pickup_state = Keyword.get(config, :tracker_pickup_state)
    tracker_success_state = Keyword.get(config, :tracker_success_state)
```

with:

```elixir
    tracker_doing_state = Keyword.get(config, :tracker_doing_state)
    tracker_done_state = Keyword.get(config, :tracker_done_state)
```

Replace lines 191-192 (YAML emission):

```elixir
        "  pickup_state: #{yaml_value(tracker_pickup_state)}",
        "  success_state: #{yaml_value(tracker_success_state)}",
```

with:

```elixir
        "  doing_state: #{yaml_value(tracker_doing_state)}",
        "  done_state: #{yaml_value(tracker_done_state)}",
```

- [ ] **Step 4: Edit `test/symphony_elixir/github/project_meta_test.exs`**

Replace each of the three occurrences at lines 22-23, 98-99, 174-175. The pattern is:

```elixir
      pickup_state: "In Progress",
      success_state: "Done"
```

becomes:

```elixir
      doing_state: "In Progress",
      done_state: "Done"
```

and:

```elixir
      pickup_state: nil,
      success_state: nil
```

becomes:

```elixir
      doing_state: nil,
      done_state: nil
```

Use `Edit` tool with `replace_all: false` per occurrence (or `replace_all: true` if the line context is identical — verify each Edit succeeds).

- [ ] **Step 5: Edit `test/symphony_elixir/github/adapter_test.exs`**

Replace lines 22-23:

```elixir
      pickup_state: "In Progress",
      success_state: "Done"
```

with:

```elixir
      doing_state: "In Progress",
      done_state: "Done"
```

- [ ] **Step 6: Run full test suite, expect all green**

```bash
cd apps/symphony && mix test
```

Expected: `Finished in ...` with 240+ tests, 0 failures, 2 skipped (same baseline as M2 Phase 2 completion). If anything fails, grep for any remaining `pickup_state` / `success_state` references in the codebase (`grep -rn "pickup_state\|success_state" apps/symphony/lib apps/symphony/test`) and add them to this step.

- [ ] **Step 7: Commit**

```bash
git add apps/symphony/lib/symphony_elixir/config/schema.ex \
        apps/symphony/lib/symphony_elixir/github/project_meta.ex \
        apps/symphony/test/support/test_support.exs \
        apps/symphony/test/symphony_elixir/github/project_meta_test.exs \
        apps/symphony/test/symphony_elixir/github/adapter_test.exs

git commit -m "$(cat <<'EOF'
refactor(symphony): rename pickup_state/success_state to doing_state/done_state

Phase 3 prep: shift terminology so 'doing_state' / 'done_state' read as the
target state for Symphony-driven transitions (the 'where' it moves an issue
on dispatch / on backend success). The old pickup/success names invited
"In Progress を pickup する" misreading. Schema, GitHub ProjectMeta warmup
validation, and the test_support YAML generator update together; no
behavior change. The pickup_state / success_state names were fork-only
additions (M2 Phase 1), so no upstream compatibility concern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Sweep `pickup_state` / `success_state` references in docs

**Files:**
- Modify: `TODO.md`
- Modify: `apps/symphony/CLAUDE.md` (line 29)
- Modify: `docs/superpowers/specs/2026-05-14-m2-phase1-design.md`
- Modify: `docs/superpowers/specs/2026-05-14-m2-phase2-design.md`
- Modify: `docs/superpowers/plans/2026-05-14-m2-phase2-github-adapter.md`

Pure documentation sweep, no test impact.

- [ ] **Step 1: List remaining hits**

```bash
grep -rn "pickup_state\|success_state" TODO.md apps/symphony/CLAUDE.md docs/
```

Expected to enumerate the files above. The Phase 3 design doc itself (`2026-05-15-m2-phase3-design.md`) also mentions these names contextually (as the *old* names) — leave those mentions alone where they describe history, only sweep when the doc treats them as current.

- [ ] **Step 2: Edit `apps/symphony/CLAUDE.md` line 29**

Find:

```text
`tracker:` ブロックには共通フィールド（`kind` / `active_states` / `terminal_states` / `pickup_state` / `success_state`）だけが残る。
```

Replace `pickup_state` / `success_state` with `doing_state` / `done_state`.

- [ ] **Step 3: Edit `TODO.md`**

Use `grep -n "pickup_state\|success_state" TODO.md` to find exact line numbers. For each hit, replace inline (the Milestone 2 横断指針 section, Phase chk items, and any M3 references all need updating).

Additionally, in the **Milestone 3 以降** "GitHub Adapter 派生課題" section, **remove** the bullet:

```text
- **Linear adapter の自動遷移化**（M2 Phase 3 で GitHub に入る `maybe_pickup_transition` / `maybe_success_transition` を Linear 側にも適用）
```

Reason: Phase 3 made the transition logic tracker-agnostic (works for Linear / GitHub / Memory uniformly when `doing_state` / `done_state` are set). The follow-up no longer needs to be tracked separately.

- [ ] **Step 4: Edit `docs/superpowers/specs/2026-05-14-m2-phase1-design.md`**

Find each `pickup_state` / `success_state` mention and replace with `doing_state` / `done_state`. The Phase 1 spec is historical, but keeping field names in sync with current code helps future readers. If a passage explicitly says "we introduce pickup_state in this phase", change it to say "we introduce doing_state (initially named pickup_state, renamed in Phase 3)" to preserve history accurately — judgment call per occurrence.

- [ ] **Step 5: Edit `docs/superpowers/specs/2026-05-14-m2-phase2-design.md`**

Same pattern as Step 4.

- [ ] **Step 6: Edit `docs/superpowers/plans/2026-05-14-m2-phase2-github-adapter.md`**

Same pattern as Step 4.

- [ ] **Step 7: Verify no remaining hits in current sources**

```bash
grep -rln "pickup_state\|success_state" TODO.md apps/symphony/CLAUDE.md apps/symphony/lib apps/symphony/test docs/architecture.md docs/protocol.md docs/superpowers/specs docs/superpowers/plans 2>&1 | grep -v "2026-05-15-m2-phase3-design.md"
```

Expected: empty output. The Phase 3 design doc itself is excluded because it discusses the rename as part of its design.

- [ ] **Step 8: Commit**

```bash
git add TODO.md apps/symphony/CLAUDE.md \
        docs/superpowers/specs/2026-05-14-m2-phase1-design.md \
        docs/superpowers/specs/2026-05-14-m2-phase2-design.md \
        docs/superpowers/plans/2026-05-14-m2-phase2-github-adapter.md

git commit -m "$(cat <<'EOF'
docs: sweep pickup_state/success_state -> doing_state/done_state

Mechanical rename in TODO.md, the symphony CLAUDE.md, and prior M2 spec /
plan docs to match the renamed schema fields (see prior commit). Also
removes the now-redundant "Linear adapter 自動遷移化" item from
TODO.md Milestone 3 — Phase 3 makes the transition logic tracker-agnostic
so Linear users can opt in without any further code change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add `Tracker.resolve_adapter/1` override hook for tests

**Files:**
- Modify: `apps/symphony/lib/symphony_elixir/tracker.ex` (lines 31-38)
- Modify: `apps/symphony/test/symphony_elixir/tracker_test.exs`

This adds an `Application.get_env(:symphony_elixir, :tracker_adapter_override)` hook so tests can inject `MockTrackerAdapter` without touching `Config.settings!`. Behavior unchanged when env var is absent.

- [ ] **Step 1: Write failing test for override**

Edit `apps/symphony/test/symphony_elixir/tracker_test.exs`. Append a new test after the existing one:

```elixir
  test "resolve_adapter/1 returns Application env override when set" do
    Application.put_env(:symphony_elixir, :tracker_adapter_override, SymphonyElixir.Tracker.Memory)

    try do
      assert Tracker.resolve_adapter("github") == SymphonyElixir.Tracker.Memory
      assert Tracker.resolve_adapter("linear") == SymphonyElixir.Tracker.Memory
      assert Tracker.resolve_adapter(nil) == SymphonyElixir.Tracker.Memory
    after
      Application.delete_env(:symphony_elixir, :tracker_adapter_override)
    end
  end

  test "resolve_adapter/1 ignores non-module override values" do
    Application.put_env(:symphony_elixir, :tracker_adapter_override, "not-a-module")

    try do
      assert Tracker.resolve_adapter("github") == SymphonyElixir.Github.Adapter
    after
      Application.delete_env(:symphony_elixir, :tracker_adapter_override)
    end
  end
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/symphony && mix test test/symphony_elixir/tracker_test.exs
```

Expected: 2 failures (the new tests). The first will return `Github.Adapter` instead of `Memory`, the second will likely match expectations but fail because `"not-a-module"` isn't filtered.

- [ ] **Step 3: Implement override hook in `tracker.ex`**

Replace lines 31-38 of `apps/symphony/lib/symphony_elixir/tracker.ex`:

```elixir
  @spec adapter() :: module()
  def adapter, do: resolve_adapter(Config.settings!().tracker.kind)

  @doc false
  @spec resolve_adapter(String.t() | nil) :: module()
  def resolve_adapter("memory"), do: SymphonyElixir.Tracker.Memory
  def resolve_adapter("github"), do: SymphonyElixir.Github.Adapter
  def resolve_adapter(_other), do: SymphonyElixir.Linear.Adapter
end
```

with:

```elixir
  @spec adapter() :: module()
  def adapter, do: resolve_adapter(Config.settings!().tracker.kind)

  @doc false
  @spec resolve_adapter(String.t() | nil) :: module()
  def resolve_adapter(kind) do
    case Application.get_env(:symphony_elixir, :tracker_adapter_override) do
      module when is_atom(module) and not is_nil(module) -> module
      _ -> default_resolve_adapter(kind)
    end
  end

  defp default_resolve_adapter("memory"), do: SymphonyElixir.Tracker.Memory
  defp default_resolve_adapter("github"), do: SymphonyElixir.Github.Adapter
  defp default_resolve_adapter(_other), do: SymphonyElixir.Linear.Adapter
end
```

- [ ] **Step 4: Run tests, expect pass**

```bash
cd apps/symphony && mix test test/symphony_elixir/tracker_test.exs
```

Expected: all green. Also run `mix test` to confirm no regression elsewhere.

- [ ] **Step 5: Commit**

```bash
git add apps/symphony/lib/symphony_elixir/tracker.ex apps/symphony/test/symphony_elixir/tracker_test.exs

git commit -m "$(cat <<'EOF'
feat(symphony): add tracker_adapter_override hook for tests

Allow Application.put_env(:symphony_elixir, :tracker_adapter_override, Mod)
to swap the resolved adapter independent of tracker.kind. Used by Phase 3
orchestrator tests to inject a scripted MockTrackerAdapter for error /
retry paths without standing up Memory tracker. Non-module values are
ignored so misconfigured tests fall back to the kind-based dispatch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Create `MockTrackerAdapter` test support module

**Files:**
- Create: `apps/symphony/test/support/mock_tracker_adapter.exs`
- Modify: `apps/symphony/test/test_helper.exs`
- Modify: `apps/symphony/mix.exs` (`test_ignore_filters`)

A scripted `Tracker` behaviour implementation. Tests load a list of responses into Application env; each call pops the head. Sends notification messages to a registered recipient so tests can `assert_receive` per-attempt.

- [ ] **Step 1: Create the mock module**

Write `apps/symphony/test/support/mock_tracker_adapter.exs`:

```elixir
defmodule SymphonyElixir.TestSupport.MockTrackerAdapter do
  @moduledoc """
  Scripted Tracker behaviour used by orchestrator transition tests. Responses
  are queued in Application env and popped per call. Each call notifies the
  registered recipient so tests can assert on the exact sequence of attempts.

  Use with `Application.put_env(:symphony_elixir, :tracker_adapter_override,
  __MODULE__)` and reset with `delete_env` in `on_exit`.
  """

  @behaviour SymphonyElixir.Tracker

  alias SymphonyElixir.Tracker.Issue

  @app :symphony_elixir
  @update_responses_key :mock_tracker_update_responses
  @refresh_responses_key :mock_tracker_refresh_responses
  @recipient_key :mock_tracker_recipient

  @impl true
  def fetch_candidate_issues, do: {:ok, []}

  @impl true
  def fetch_issues_by_states(_state_names), do: {:ok, []}

  @impl true
  def create_comment(_issue_id, _body), do: :ok

  @impl true
  def fetch_issue_states_by_ids(_ids) do
    response = consume(@refresh_responses_key, {:ok, []})
    notify({:mock_tracker_refresh_attempted, response})
    response
  end

  @impl true
  def update_issue_state(%Issue{id: id} = _issue, state_name) when is_binary(state_name) do
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

- [ ] **Step 2: Register the file with the test loader**

Edit `apps/symphony/test/test_helper.exs`. Append after the existing `Code.require_file/2` calls:

```elixir
Code.require_file("support/mock_tracker_adapter.exs", __DIR__)
```

Resulting file should read:

```elixir
ExUnit.start()
Code.require_file("support/snapshot_support.exs", __DIR__)
Code.require_file("support/test_support.exs", __DIR__)
Code.require_file("support/mock_tracker_adapter.exs", __DIR__)
```

- [ ] **Step 3: Exclude the file from coverage / mix test filters**

Edit `apps/symphony/mix.exs`. Inside the `test_ignore_filters` list (currently lines ~40-43), add:

```elixir
        "test/support/snapshot_support.exs",
        "test/support/test_support.exs",
        "test/support/mock_tracker_adapter.exs"
```

(append the third entry — preserve the existing two.)

- [ ] **Step 4: Verify module compiles and Tracker behaviour is satisfied**

```bash
cd apps/symphony && mix test test/symphony_elixir/tracker_test.exs
```

Expected: green. If `@impl true` complains about callbacks, double-check signatures against `lib/symphony_elixir/tracker.ex` lines 8-12 — all 5 callbacks must be implemented with matching arities.

- [ ] **Step 5: Commit**

```bash
git add apps/symphony/test/support/mock_tracker_adapter.exs \
        apps/symphony/test/test_helper.exs \
        apps/symphony/mix.exs

git commit -m "$(cat <<'EOF'
test(symphony): add MockTrackerAdapter for scripted Tracker responses

Phase 3 transition tests need to assert that retries fire on transient
errors and that warning logs surface on permanent failures. The Memory
tracker only returns :ok, so this support module pops scripted responses
from Application env per call and notifies a registered recipient with
each attempt. Loaded via test_helper.exs and excluded from coverage
filters in mix.exs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Implement doing transition (helpers + wire + tests)

**Files:**
- Modify: `apps/symphony/lib/symphony_elixir/orchestrator.ex`
- Create: `apps/symphony/test/symphony_elixir/orchestrator_doing_transition_test.exs`

Adds the shared `tracker_update_with_retry/2` helper, the `maybe_doing_transition/1` private function, a `_for_test` wrapper, and wires the call into `spawn_issue_on_worker_host/5`.

- [ ] **Step 1: Write failing tests**

Create `apps/symphony/test/symphony_elixir/orchestrator_doing_transition_test.exs`:

```elixir
defmodule SymphonyElixir.OrchestratorDoingTransitionTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.Orchestrator
  alias SymphonyElixir.Tracker.Issue
  alias SymphonyElixir.TestSupport.MockTrackerAdapter

  defp setup_mock_adapter(_ctx) do
    Application.put_env(:symphony_elixir, :tracker_adapter_override, MockTrackerAdapter)
    Application.put_env(:symphony_elixir, :mock_tracker_recipient, self())

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :tracker_adapter_override)
      Application.delete_env(:symphony_elixir, :mock_tracker_recipient)
      Application.delete_env(:symphony_elixir, :mock_tracker_update_responses)
      Application.delete_env(:symphony_elixir, :mock_tracker_refresh_responses)
    end)

    :ok
  end

  describe "maybe_doing_transition/1" do
    setup [:setup_mock_adapter]

    test "fires update_issue_state when doing_state is configured" do
      write_workflow_file!(Workflow.workflow_file_path(),
        tracker_kind: "linear",
        tracker_doing_state: "In Progress"
      )

      issue = %Issue{id: "issue-1", identifier: "MT-1", state: "Todo"}

      :ok = Orchestrator.maybe_doing_transition_for_test(issue)

      assert_receive {:mock_tracker_update_attempted, "issue-1", "In Progress", :ok}
    end

    test "is a no-op when doing_state is unset (nil)" do
      write_workflow_file!(Workflow.workflow_file_path(),
        tracker_kind: "linear",
        tracker_doing_state: nil
      )

      issue = %Issue{id: "issue-1", identifier: "MT-1", state: "Todo"}

      :ok = Orchestrator.maybe_doing_transition_for_test(issue)

      refute_receive {:mock_tracker_update_attempted, _, _, _}, 50
    end

    test "is a no-op when issue.state already matches doing_state (idempotent)" do
      write_workflow_file!(Workflow.workflow_file_path(),
        tracker_kind: "linear",
        tracker_doing_state: "In Progress"
      )

      issue = %Issue{id: "issue-1", identifier: "MT-1", state: "In Progress"}

      :ok = Orchestrator.maybe_doing_transition_for_test(issue)

      refute_receive {:mock_tracker_update_attempted, _, _, _}, 50
    end

    test "retries transient errors and succeeds on second attempt" do
      write_workflow_file!(Workflow.workflow_file_path(),
        tracker_kind: "linear",
        tracker_doing_state: "In Progress"
      )

      Application.put_env(:symphony_elixir, :mock_tracker_update_responses, [
        {:error, :timeout},
        :ok
      ])

      issue = %Issue{id: "issue-1", identifier: "MT-1", state: "Todo"}

      :ok = Orchestrator.maybe_doing_transition_for_test(issue)

      assert_receive {:mock_tracker_update_attempted, "issue-1", "In Progress", {:error, :timeout}}
      assert_receive {:mock_tracker_update_attempted, "issue-1", "In Progress", :ok}, 1_000
    end

    test "logs warning after exhausting all 3 retry attempts" do
      write_workflow_file!(Workflow.workflow_file_path(),
        tracker_kind: "linear",
        tracker_doing_state: "In Progress"
      )

      Application.put_env(:symphony_elixir, :mock_tracker_update_responses, [
        {:error, :timeout},
        {:error, :timeout},
        {:error, :timeout}
      ])

      issue = %Issue{id: "issue-1", identifier: "MT-1", state: "Todo"}

      log =
        capture_log(fn ->
          :ok = Orchestrator.maybe_doing_transition_for_test(issue)
        end)

      assert log =~ "Failed to transition issue to doing_state"
      assert log =~ "MT-1"
      assert_receive {:mock_tracker_update_attempted, _, _, {:error, :timeout}}
      assert_receive {:mock_tracker_update_attempted, _, _, {:error, :timeout}}, 1_000
      assert_receive {:mock_tracker_update_attempted, _, _, {:error, :timeout}}, 2_000
    end
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/symphony && mix test test/symphony_elixir/orchestrator_doing_transition_test.exs
```

Expected: 5 failures, each citing `Orchestrator.maybe_doing_transition_for_test/1` is undefined.

- [ ] **Step 3: Implement `tracker_update_with_retry/2` in `orchestrator.ex`**

Edit `apps/symphony/lib/symphony_elixir/orchestrator.ex`. Find a stable location near the bottom of the module (after the existing private helpers, before `defp integer_like/1`). Add:

```elixir
  @tracker_update_retry_backoffs_ms [250, 1_000]

  defp tracker_update_with_retry(%Issue{} = issue, target_state)
       when is_binary(target_state) do
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

- [ ] **Step 4: Implement `maybe_doing_transition/1` and `_for_test` wrapper**

In the same file, add right after `tracker_update_with_retry/2`:

```elixir
  defp maybe_doing_transition(%Issue{} = issue) do
    case Config.settings!().tracker.doing_state do
      target when target in [nil, ""] ->
        :ok

      target_state ->
        if normalize_issue_state(issue.state) == normalize_issue_state(target_state) do
          Logger.debug(
            "Skipping doing_state transition; already in target: " <>
              "#{issue_context(issue)} state=#{issue.state}"
          )

          :ok
        else
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

Then add the `_for_test` wrapper alongside the other test wrappers near line 301-334 of `orchestrator.ex`:

```elixir
  @doc false
  @spec maybe_doing_transition_for_test(Issue.t()) :: :ok
  def maybe_doing_transition_for_test(%Issue{} = issue) do
    maybe_doing_transition(issue)
  end
```

Place it next to `should_dispatch_issue_for_test/2` or another wrapper for cohesion.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/symphony && mix test test/symphony_elixir/orchestrator_doing_transition_test.exs
```

Expected: 5 passes. The retry tests should take ~1.25s each in worst case; the file as a whole should finish in under 3-4 seconds.

If the `capture_log` test fails because the warning isn't emitted, double-check the Logger level configured in test environment (`config/test.exs` should be `:warning` or lower).

- [ ] **Step 6: Wire `maybe_doing_transition` into `spawn_issue_on_worker_host`**

Edit `apps/symphony/lib/symphony_elixir/orchestrator.ex`. Find `spawn_issue_on_worker_host/5` (around line 693). Inside the `{:ok, pid}` branch, after building `running` and the new state map, add the doing transition call before returning.

Locate this block (currently around lines 700-731):

```elixir
        running =
          Map.put(state.running, issue.id, %{
            pid: pid,
            ...
          })

        %{
          state
          | running: running,
            claimed: MapSet.put(state.claimed, issue.id),
            retry_attempts: Map.delete(state.retry_attempts, issue.id)
        }
```

Change the return to capture the new state in a variable and trigger the transition before returning:

```elixir
        running =
          Map.put(state.running, issue.id, %{
            pid: pid,
            ...
          })

        new_state = %{
          state
          | running: running,
            claimed: MapSet.put(state.claimed, issue.id),
            retry_attempts: Map.delete(state.retry_attempts, issue.id)
        }

        :ok = maybe_doing_transition(issue)

        new_state
```

(Do not change the `{:error, reason}` branch — only the success branch fires the transition.)

- [ ] **Step 7: Run full test suite, expect no regression**

```bash
cd apps/symphony && mix test
```

Expected: 245+ tests (240 baseline + 5 new), 0 failures, 2 skipped.

Specifically, watch for `extensions_test.exs:184 "tracker delegates to memory and linear adapters"` which already exercises Memory tracker. If a stray `tracker_doing_state` from a prior test leaks into `Config.settings!()`, that test could trip — confirm `on_exit` resets the workflow file correctly (existing `TestSupport.setup/0` does this).

- [ ] **Step 8: Commit**

```bash
git add apps/symphony/lib/symphony_elixir/orchestrator.ex \
        apps/symphony/test/symphony_elixir/orchestrator_doing_transition_test.exs

git commit -m "$(cat <<'EOF'
feat(symphony): auto-transition issues to doing_state on dispatch

Adds maybe_doing_transition/1 to the orchestrator and wires it into
spawn_issue_on_worker_host/5 so that whenever a worker spawn succeeds,
Symphony moves the issue into the configured tracker.doing_state. The
shared tracker_update_with_retry/2 helper retries transient failures
twice (250ms / 1s backoff) before logging a warning and continuing —
mutation failures never block dispatch. No-op when doing_state is unset
or the issue is already in the target state. Tested via a 5-case suite
against a scripted MockTrackerAdapter.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Implement done transition (helpers + wire + tests)

**Files:**
- Modify: `apps/symphony/lib/symphony_elixir/orchestrator.ex`
- Create: `apps/symphony/test/symphony_elixir/orchestrator_done_transition_test.exs`

Adds `handle_backend_finished/2`, `maybe_done_transition/1`, `attempt_done_transition/2`, a `_for_test` wrapper, and wires the call into the `:DOWN reason=:normal` branch.

- [ ] **Step 1: Write failing tests**

Create `apps/symphony/test/symphony_elixir/orchestrator_done_transition_test.exs`:

```elixir
defmodule SymphonyElixir.OrchestratorDoneTransitionTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.Orchestrator
  alias SymphonyElixir.Tracker.Issue
  alias SymphonyElixir.TestSupport.MockTrackerAdapter

  defp setup_mock_adapter(_ctx) do
    Application.put_env(:symphony_elixir, :tracker_adapter_override, MockTrackerAdapter)
    Application.put_env(:symphony_elixir, :mock_tracker_recipient, self())

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :tracker_adapter_override)
      Application.delete_env(:symphony_elixir, :mock_tracker_recipient)
      Application.delete_env(:symphony_elixir, :mock_tracker_update_responses)
      Application.delete_env(:symphony_elixir, :mock_tracker_refresh_responses)
    end)

    :ok
  end

  defp default_workflow! do
    write_workflow_file!(Workflow.workflow_file_path(),
      tracker_kind: "linear",
      tracker_active_states: ["Todo", "In Progress"],
      tracker_terminal_states: ["Done", "Cancelled"],
      tracker_doing_state: "In Progress",
      tracker_done_state: "Done"
    )
  end

  defp running_entry(issue, last_event) do
    %{
      pid: self(),
      ref: make_ref(),
      identifier: issue.identifier,
      issue: issue,
      session_id: nil,
      turn_count: 1,
      last_codex_message: nil,
      last_codex_timestamp: DateTime.utc_now(),
      last_codex_event: last_event,
      started_at: DateTime.utc_now()
    }
  end

  describe "handle_backend_finished/2" do
    setup [:setup_mock_adapter]

    test "fires update to done_state when last_codex_event is turn_completed and refresh shows non-active" do
      default_workflow!()

      issue = %Issue{id: "issue-1", identifier: "MT-1", state: "In Progress"}
      refreshed = %Issue{issue | state: "In Review"}

      Application.put_env(:symphony_elixir, :mock_tracker_refresh_responses, [{:ok, [refreshed]}])

      Orchestrator.handle_backend_finished_for_test(running_entry(issue, :turn_completed))

      assert_receive {:mock_tracker_refresh_attempted, _}
      assert_receive {:mock_tracker_update_attempted, "issue-1", "Done", :ok}
    end

    test "no-op when issue is still in an active state (max_turns case)" do
      default_workflow!()

      issue = %Issue{id: "issue-1", identifier: "MT-1", state: "In Progress"}
      Application.put_env(:symphony_elixir, :mock_tracker_refresh_responses, [{:ok, [issue]}])

      Orchestrator.handle_backend_finished_for_test(running_entry(issue, :turn_completed))

      assert_receive {:mock_tracker_refresh_attempted, _}
      refute_receive {:mock_tracker_update_attempted, _, _, _}, 100
    end

    test "no-op when last_codex_event is not :turn_completed" do
      default_workflow!()

      issue = %Issue{id: "issue-1", identifier: "MT-1", state: "In Progress"}

      Orchestrator.handle_backend_finished_for_test(running_entry(issue, :turn_failed))

      refute_receive {:mock_tracker_refresh_attempted, _}, 50
      refute_receive {:mock_tracker_update_attempted, _, _, _}, 50
    end

    test "no-op when refresh returns the issue already in done_state" do
      default_workflow!()

      issue = %Issue{id: "issue-1", identifier: "MT-1", state: "In Progress"}
      refreshed = %Issue{issue | state: "Done"}

      Application.put_env(:symphony_elixir, :mock_tracker_refresh_responses, [{:ok, [refreshed]}])

      Orchestrator.handle_backend_finished_for_test(running_entry(issue, :turn_completed))

      assert_receive {:mock_tracker_refresh_attempted, _}
      refute_receive {:mock_tracker_update_attempted, _, _, _}, 100
    end

    test "no-op when tracker.done_state is nil" do
      write_workflow_file!(Workflow.workflow_file_path(),
        tracker_kind: "linear",
        tracker_doing_state: "In Progress",
        tracker_done_state: nil
      )

      issue = %Issue{id: "issue-1", identifier: "MT-1", state: "In Progress"}

      Orchestrator.handle_backend_finished_for_test(running_entry(issue, :turn_completed))

      refute_receive {:mock_tracker_refresh_attempted, _}, 50
      refute_receive {:mock_tracker_update_attempted, _, _, _}, 50
    end

    test "warning + no-op when refresh fails" do
      default_workflow!()

      issue = %Issue{id: "issue-1", identifier: "MT-1", state: "In Progress"}
      Application.put_env(:symphony_elixir, :mock_tracker_refresh_responses, [{:error, :timeout}])

      log =
        capture_log(fn ->
          Orchestrator.handle_backend_finished_for_test(running_entry(issue, :turn_completed))
        end)

      assert log =~ "Skipping done_state transition; refresh failed"
      refute_receive {:mock_tracker_update_attempted, _, _, _}, 100
    end

    test "warning after exhausting 3 update retries" do
      default_workflow!()

      issue = %Issue{id: "issue-1", identifier: "MT-1", state: "In Progress"}
      refreshed = %Issue{issue | state: "In Review"}

      Application.put_env(:symphony_elixir, :mock_tracker_refresh_responses, [{:ok, [refreshed]}])

      Application.put_env(:symphony_elixir, :mock_tracker_update_responses, [
        {:error, :timeout},
        {:error, :timeout},
        {:error, :timeout}
      ])

      log =
        capture_log(fn ->
          Orchestrator.handle_backend_finished_for_test(running_entry(issue, :turn_completed))
        end)

      assert log =~ "Failed to transition issue to done_state"
      assert_receive {:mock_tracker_update_attempted, _, _, {:error, :timeout}}, 2_000
    end

    test "no-op when refresh returns empty list (issue no longer visible)" do
      default_workflow!()

      issue = %Issue{id: "issue-1", identifier: "MT-1", state: "In Progress"}
      Application.put_env(:symphony_elixir, :mock_tracker_refresh_responses, [{:ok, []}])

      Orchestrator.handle_backend_finished_for_test(running_entry(issue, :turn_completed))

      assert_receive {:mock_tracker_refresh_attempted, _}
      refute_receive {:mock_tracker_update_attempted, _, _, _}, 100
    end
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/symphony && mix test test/symphony_elixir/orchestrator_done_transition_test.exs
```

Expected: 8 failures citing `Orchestrator.handle_backend_finished_for_test/1` undefined.

- [ ] **Step 3: Implement `handle_backend_finished/2`, `maybe_done_transition/1`, `attempt_done_transition/2`**

Edit `apps/symphony/lib/symphony_elixir/orchestrator.ex`. Add the three functions adjacent to `maybe_doing_transition/1` (added in Task 5):

```elixir
  defp handle_backend_finished(state, running_entry) when is_map(running_entry) do
    case Map.get(running_entry, :last_codex_event) do
      :turn_completed ->
        case Map.get(running_entry, :issue) do
          %Issue{} = issue -> maybe_done_transition(issue)
          _ -> :ok
        end

      other ->
        Logger.debug("Skipping done_state transition; last_codex_event=#{inspect(other)}")
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
    active_states = active_state_set()

    case Tracker.fetch_issue_states_by_ids([issue_id]) do
      {:ok, [%Issue{state: current_state} = refreshed | _]} ->
        cond do
          active_issue_state?(current_state, active_states) ->
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

Add the `_for_test` wrapper next to `maybe_doing_transition_for_test/1`:

```elixir
  @doc false
  @spec handle_backend_finished_for_test(map()) :: :ok
  def handle_backend_finished_for_test(running_entry) when is_map(running_entry) do
    _ = handle_backend_finished(%State{}, running_entry)
    :ok
  end
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/symphony && mix test test/symphony_elixir/orchestrator_done_transition_test.exs
```

Expected: 8 passes. Retry test takes ~1.25s; total suite ~3-4 seconds.

If the `capture_log` warning tests fail, verify that warnings have not been silenced in `config/test.exs`. The `Logger.warning` calls must produce log lines for `capture_log` to detect them.

- [ ] **Step 5: Wire `handle_backend_finished` into `:DOWN :normal` branch**

Edit `apps/symphony/lib/symphony_elixir/orchestrator.ex`. Find the `handle_info({:DOWN, ref, :process, _pid, reason}, ...)` handler around line 119-164. Inside the `case reason do ... :normal -> ...` branch:

Locate:

```elixir
            :normal ->
              Logger.info("Agent task completed for issue_id=#{issue_id} session_id=#{session_id}; scheduling active-state continuation check")

              state
              |> complete_issue(issue_id)
              |> schedule_issue_retry(issue_id, 1, %{
                identifier: running_entry.identifier,
                delay_type: :continuation,
                worker_host: Map.get(running_entry, :worker_host),
                workspace_path: Map.get(running_entry, :workspace_path)
              })
```

Replace with:

```elixir
            :normal ->
              Logger.info("Agent task completed for issue_id=#{issue_id} session_id=#{session_id}; scheduling active-state continuation check")

              state
              |> handle_backend_finished(running_entry)
              |> complete_issue(issue_id)
              |> schedule_issue_retry(issue_id, 1, %{
                identifier: running_entry.identifier,
                delay_type: :continuation,
                worker_host: Map.get(running_entry, :worker_host),
                workspace_path: Map.get(running_entry, :workspace_path)
              })
```

(One added line: `|> handle_backend_finished(running_entry)`.)

- [ ] **Step 6: Run full test suite, expect no regression**

```bash
cd apps/symphony && mix test
```

Expected: 253+ tests (245 from prior tasks + 8 new), 0 failures, 2 skipped.

Pay special attention to the existing snapshot / retry tests in `orchestrator_status_test.exs` — they synthesise running entries with `last_codex_event: nil`, so `handle_backend_finished` will hit the "Skipping done_state transition; last_codex_event=nil" debug branch (silent, no test impact). Confirm.

- [ ] **Step 7: Commit**

```bash
git add apps/symphony/lib/symphony_elixir/orchestrator.ex \
        apps/symphony/test/symphony_elixir/orchestrator_done_transition_test.exs

git commit -m "$(cat <<'EOF'
feat(symphony): auto-transition issues to done_state on backend success

Adds handle_backend_finished/2 + maybe_done_transition/1 +
attempt_done_transition/2 to the orchestrator and wires the call into
the :DOWN reason=:normal branch. Three-condition AND gate:

  1. running_entry.last_codex_event == :turn_completed
  2. :DOWN reason == :normal (implicit, only this branch calls it)
  3. fetch_issue_states_by_ids refresh shows issue is NOT in active_states

Refreshing protects against the max_turns-exhausted case where the
backend exited normally but the issue is still in an active state.
Idempotent: if the issue is already in done_state (LLM moved it first
via linear_graphql), no mutation fires. Uses the same retry helper as
maybe_doing_transition.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Final TODO.md update + completion verification

**Files:**
- Modify: `TODO.md` (mark Phase 3 checkboxes, finalize doc state)

- [ ] **Step 1: Mark Phase 3 checkboxes in TODO.md**

Open `TODO.md`. Find the Phase 3 section (under Milestone 2). The checklist items currently read:

```text
- [ ] `maybe_pickup_transition/1` を `maybe_dispatch` で呼ぶ
- [ ] `handle_backend_finished/2` で `turn/completed` + subprocess exit 統合判定して `maybe_success_transition/1` を呼ぶ
- [ ] Memory adapter ベースの結合テストで遷移呼び出しを検証
- [ ] 異常系（exit != 0、status: failed、network 失敗）の no-op をテスト
```

Replace with (using the renamed terms and checking each box):

```text
- [x] `maybe_doing_transition/1` を `spawn_issue_on_worker_host` で呼ぶ
- [x] `handle_backend_finished/2` で `turn/completed` + subprocess exit 統合判定して `maybe_done_transition/1` を呼ぶ
- [x] MockTrackerAdapter ベースの結合テストで遷移呼び出しを検証 (orchestrator_doing/done_transition_test.exs)
- [x] 異常系 (exit != 0、status: failed、network 失敗) の no-op をテスト
```

Also update the `spec:` line next to "Phase 3" to point at the design doc:

```text
spec: [`docs/superpowers/specs/2026-05-15-m2-phase3-design.md`](docs/superpowers/specs/2026-05-15-m2-phase3-design.md)
```

(replacing the `spec: 着手時に作成` placeholder).

- [ ] **Step 2: Final verification — full test suite**

```bash
cd apps/symphony && mix test
```

Expected: 253+ tests, 0 failures, 2 skipped (baseline 240 + 5 doing transition + 8 done transition + tracker override tests).

- [ ] **Step 3: Final verification — no stale references**

```bash
grep -rn "pickup_state\|success_state\|maybe_pickup_transition\|maybe_success_transition" \
  apps/symphony/lib apps/symphony/test TODO.md apps/symphony/CLAUDE.md docs/superpowers
```

Expected: only the Phase 3 design doc (`2026-05-15-m2-phase3-design.md`) which describes the rename historically. No production code or other docs should still reference the old names.

- [ ] **Step 4: Manual iex smoke check (optional but recommended)**

```bash
cd apps/symphony && iex -S mix
```

```elixir
# verify schema accepts new fields
{:ok, settings} = SymphonyElixir.Config.parse(%{
  "tracker" => %{
    "kind" => "memory",
    "active_states" => ["Todo", "In Progress"],
    "terminal_states" => ["Done"],
    "doing_state" => "In Progress",
    "done_state" => "Done"
  }
})
settings.tracker.doing_state
# => "In Progress"
settings.tracker.done_state
# => "Done"
```

This is optional — if `mix test` is green, the schema is correct.

- [ ] **Step 5: Commit**

```bash
git add TODO.md

git commit -m "$(cat <<'EOF'
chore(repo): mark M2 Phase 3 complete and link spec

Phase 3 (orchestrator auto-transition) is implemented and tested.
Checkboxes flip with updated function names matching the actual
implementation: maybe_doing_transition / maybe_done_transition wired
into spawn_issue_on_worker_host + the :DOWN :normal branch, all
verified against MockTrackerAdapter.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Completion checklist

After Task 7, this plan is done when:

- [ ] All 7 task commits land on `main` (or feature branch ready for merge)
- [ ] `mix test` is green in `apps/symphony` (253+ tests, 0 failures, 2 skipped)
- [ ] `grep -rn "pickup_state\|success_state"` returns only the Phase 3 design doc
- [ ] TODO.md Phase 3 section all checkboxes ticked, spec link present
- [ ] TODO.md Milestone 3 "Linear adapter 自動遷移化" item removed (subsumed by Phase 3)

Phase 4 (実機 GitHub E2E + ADR-0013/0014 + docs final sweep) is a separate plan.

---

## Out-of-scope reminders (carry to Phase 4 or M3+)

- Real GitHub Project E2E walk-through (`Todo → In Progress → Done`)
- `examples/workflow.github.md`
- ADR-0013 (tracker block split) / ADR-0014 (Symphony-driven state transition)
- Failure-comment / max_attempts (M3+ TODO L140)
- Startup sweep / polling补正 for stranded `doing_state` issues — explicitly deferred because parallel human / LLM operation makes "claim absent" an unsafe recovery signal
- `linear_graphql` dynamic tool retirement — M3+, dependent on `github_graphql` parity
