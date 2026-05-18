# perform

`perform` is the TypeScript orchestrator for the [`studio`](../../) monorepo.
It drives an issue tracker (Linear / GitHub / Memory) by spawning backend
processes (`claude-app-server` / `codex app-server`) per issue. Originally
ported from `apps/symphony` (Elixir), now the sole orchestrator in the repo
(M3 Phase 7, see [ADR-0015](../../docs/adr/0015-conductor-port-completion.md)
and [`docs/milestones/03-conductor-port.md`](../../docs/milestones/03-conductor-port.md)).
Rebranded from `conductor` to `perform` in M4 ([ADR-0017](../../docs/adr/0017-rebranding-to-studio.md)).

Status: **M3 complete** — Linear / GitHub / Memory trackers, parallel
scheduler with retry/backoff, stall detection, TUI dashboard, file logger.

## Install (workspace, development)

From the monorepo root:

```bash
pnpm install
pnpm build:perform
pnpm dev:install
```

After `pnpm dev:install`, the `perform` binary is on your PATH.

## Run

```bash
perform path/to/WORKFLOW.md
```

A WORKFLOW.md is a markdown file with YAML frontmatter describing the agent,
tracker, and workspace. See [`examples/`](./examples/) for samples.

## Test

```bash
pnpm --filter perform test
```

## Running with a real backend

perform requires the guardrail flag every time:

```bash
perform --i-understand-that-this-will-be-running-without-the-usual-guardrails examples/workflow.claude-memory.md
```

The Claude example assumes `claude-app-server` is on `$PATH` and that `~/.claude/` holds a valid Pro/Max OAuth (no API key needed).

For Codex:

```bash
perform --i-understand-that-this-will-be-running-without-the-usual-guardrails examples/workflow.codex-memory.md
```

Hooks live at the **top level** of WORKFLOW.md (alongside `workspace:`, not nested under it):

```yaml
workspace:
  root: /tmp/studio-perform-e2e/workspaces

hooks:
  after_create: |
    git init
  timeout_ms: 30000
```

## License

Apache-2.0
