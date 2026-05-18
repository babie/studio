---
agent:
  type: codex
  max_concurrent_agents: 1
  max_turns: 3

codex:
  command: codex --config shell_environment_policy.inherit=all --config 'model="gpt-5.5"' app-server
  approval_policy: never
  thread_sandbox: workspace-write
  turn_sandbox_policy:
    type: workspaceWrite

tracker:
  kind: memory
  # Memory tracker is in-process; use doing_state so the orchestrator transitions
  # the issue through "In Progress" → "Done" automatically (same rationale as
  # workflow.claude-memory.md).
  active_states: [Todo]
  terminal_states: [Done]
  doing_state: In Progress
  done_state: Done

memory:
  issues:
    - id: MEMORY-1
      identifier: MEMORY-1
      title: Write hello world README
      description: |
        Create README.md with "Hello World" and commit it.
      state: Todo

workspace:
  root: /tmp/studio-e2e-codex/workspaces

hooks:
  after_create: |
    git init
    git config user.email "agent@studio.local"
    git config user.name "Studio Agent"
  timeout_ms: 30000
---

You are working on issue {{ issue.identifier }}: {{ issue.title }}.

{{ issue.description }}

Steps:
1. Create README.md with the text "Hello World".
2. git add README.md and commit with message "Initial commit".
