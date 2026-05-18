---
agent:
  type: claude
  # Claude Pro/Max では concurrency 2〜3 を推奨
  max_concurrent_agents: 2
  max_turns: 10

# agent.type: claude のとき読まれる
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
  active_states: [Todo]
  terminal_states: [Done, Closed, Cancelled, Canceled, Duplicate]
  doing_state: "In Progress"
  done_state: "Done"

linear:
  api_key: $LINEAR_API_KEY
  project_slug: concert-3f96fb9d18cf

workspace:
  root: /tmp/studio-e2e/workspaces

hooks:
  after_create: |
    git init
    git config user.email "agent@studio.local"
    git config user.name "Studio Agent"
    echo "# Workspace" > README.md
    git add README.md
    git commit -m "Initial commit"
---

You are working on Linear issue {{ issue.identifier }} (id: {{ issue.id }}): {{ issue.title }}.

{{ issue.description }}

Instructions:
1. Read the issue description carefully and implement what is asked in the current workspace directory.
2. Commit your changes to the workspace git repository with a descriptive message.
3. When the implementation is complete, stop. The orchestrator will move the Linear issue to "Done" on your behalf — do not call the Linear API yourself.
