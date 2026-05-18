---
name: debug
description:
  Investigate stuck runs and execution failures by tracing perform and backend
  logs with issue/session identifiers; use when runs stall, retry repeatedly, or
  fail unexpectedly.
---

# Debug

## Goals

- Find why a run is stuck, retrying, or failing.
- Correlate Linear/GitHub issue identity to a backend session quickly.
- Read the right logs in the right order to isolate root cause.

## Log Sources

- Primary runtime log: `log/perform.log`
  - Default produced by `apps/perform/src/util/file-logger.ts` (pino + pino-roll).
    Path is configurable via `logging.file.path` in WORKFLOW.md; default is
    `<cwd>/log/perform.log`.
  - Includes orchestrator scheduler, agent runner, backend (claude-app-server /
    codex) JSON-RPC lifecycle, and tracker (Linear / GitHub / Memory) logs.
  - JSON Lines format (`{"level":30,"time":..., "msg":"..."}`). Use `jq` or
    `rg` patterns below.
- Rotated runtime logs: `log/perform.log.1`, `log/perform.log.2`, ...
  - pino-roll size-based rotation (`max_size_mb` / `max_files`). Check these
    when the relevant run is older.
- Stderr (when `PERFORM_DEBUG=1` or `--no-dashboard`): pretty-printed mirror
  of the same records.

## Correlation Keys

- `identifier`: human ticket key (example: `MT-625`, `CYFY-5`, `#42`)
- `id` (Linear UUID / GitHub node id): stable internal id, embedded in tracker
  responses but rarely surfaced in log lines verbatim — prefer `identifier`.
- backend session: claude-app-server / codex assign their own `thread_id` /
  `turn_id` in JSON-RPC notifications. They appear in `[backend …]
  notification …` lines emitted by `apps/perform/src/orchestrator/agent-runner.ts`.

## Quick Triage (Stuck Run)

1. Confirm scheduler symptoms for the ticket (no progression, repeated retry,
   stall warning).
2. Find recent lines for the ticket by `identifier`.
3. Trace scheduler decisions (`[scheduler] ...`) and per-agent activity
   (`[orchestrator] ...`, `[backend ...]`, `[workspace] ...`) around the same
   timestamp.
4. Decide class of failure: stall timeout, backend startup failure, turn
   failure, scheduler retry loop, or tracker API failure.

## Commands

```bash
# 1) Narrow by ticket key (fastest entry point). Pino emits JSON, so identifier
#    typically appears mid-msg; a plain substring search works fine.
rg -n "MT-625" log/perform.log*

# 2) Pull all scheduler decisions for that window
rg -n '\[scheduler\]' log/perform.log*

# 3) Pull all backend lifecycle lines
rg -n '\[backend ' log/perform.log*

# 4) Focus on stuck/retry signals
rg -n 'stalled:|scheduling restart|\[scheduler\] retry|terminal state|non-active' log/perform.log*

# 5) Pretty-print one JSON line if needed
rg -n "MT-625" log/perform.log | head -1 | jq .
```

## Investigation Flow

1. Locate the ticket slice:
    - Search by `identifier=<KEY>`. Linear adapters and the orchestrator both
      embed `identifier` into the human-readable `msg`.
2. Establish timeline:
    - First `[orchestrator] picked <identifier> (<state>)` — issue dispatched.
    - Followed by `[workspace] ensured ...` and `[backend ...] notification ...`
      events.
    - Terminal event: `[scheduler] ... reached terminal state ...`, or
      `[scheduler] retry <identifier> attempt=...`, or `stall-restart`.
3. Classify the problem:
    - Stall loop: `[scheduler] stalled: <identifier> elapsed=...; scheduling
      restart` (driven by `agent.agent_session_stall_timeout_ms`, default
      30 min).
    - Backend startup: missing `claude-app-server` / `codex` on PATH —
      AgentRunner reports a spawn error before any `[backend ...] notification`
      line.
    - Turn execution failure: `[scheduler] retry <identifier> attempt=... error=...`
      after at least one `[backend ...]` line; or `session-exited-mid-turn`
      errors when the subprocess crashes mid-turn.
    - Tracker failure: `[scheduler] fetchCandidateIssues failed: ...` or
      `reconcileRunning: tracker fetch failed: ...`.
4. Validate scope:
    - Check whether failures are isolated to one issue or repeating across
      multiple tickets (tracker outage vs. issue-specific).
5. Capture evidence:
    - Save key log lines with timestamps and the `identifier`.
    - Record probable root cause and the exact failing stage.

## Reading Backend Session Logs

Backend session diagnostics arrive as JSON-RPC notifications and are surfaced by
`apps/perform/src/orchestrator/agent-runner.ts` as
`[backend <claude|codex>] notification <method>` lines. Read them as a
lifecycle:

1. `[orchestrator] picked <identifier> (<state>)`
2. `[workspace] ensured <path> (created=<bool>)`
3. `[backend <type>] notification thread/started`
4. `[backend <type>] notification turn/started` then `item/...` streams
5. Terminal event:
    - `[backend <type>] notification turn/completed`, or
    - `[scheduler] retry <identifier> attempt=... error=...` (failure_retry), or
    - `[scheduler] stalled: <identifier> ...; scheduling restart`

For one specific run, keep the trace narrow:

1. Build a timestamped slice for only that identifier:
    - `rg -n "<IDENTIFIER>" log/perform.log*`
2. Mark the exact failing stage:
    - Startup failure before any `[backend ...] notification` line.
    - Turn/runtime failure mid-stream (`turn_failed`, `session-exited-mid-turn`,
      JSON-RPC error response).
    - Stall recovery (`stalled: ... scheduling restart`).

## Notes

- Prefer `rg` over `grep` for speed on large logs.
- Check rotated logs (`log/perform.log.*`) before concluding data is missing.
- The actual log line wording lives in
  `apps/perform/src/orchestrator/scheduler.ts` and
  `apps/perform/src/orchestrator/agent-runner.ts`. Read those when a phrase
  in this skill no longer matches reality.
