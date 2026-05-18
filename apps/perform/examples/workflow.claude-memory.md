---
agent:
  type: claude
  max_concurrent_agents: 1
  max_turns: 3

claude:
  command: claude-app-server --model claude-opus-4-7 --permission-mode bypassPermissions

tracker:
  kind: memory
  # Memory tracker is in-process; the backend cannot mutate it via tools.
  # Use doing_state so the orchestrator transitions the issue to "In Progress"
  # before the agent runs. After the turn, the issue is no longer in active_states,
  # so the orchestrator marks it completed and transitions to done_state.
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
  root: /tmp/studio-e2e/workspaces

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
