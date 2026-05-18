---
agent:
  type: mock
  max_concurrent_agents: 1
  max_turns: 1

mock:
  delay_ms: 0

tracker:
  kind: memory
  active_states: [Todo]
  terminal_states: [Done]
  doing_state: In Progress
  done_state: Done

workspace:
  root: /tmp/studio-mock/workspaces

memory:
  issues:
    - id: MEMORY-1
      identifier: MEMORY-1
      title: Sample issue 1
      description: Phase 1 happy path
      state: Todo
    - id: MEMORY-2
      identifier: MEMORY-2
      title: Sample issue 2
      description: Phase 1 second issue
      state: Todo
---

You are working on issue {{ issue.identifier }}: {{ issue.title }}.
