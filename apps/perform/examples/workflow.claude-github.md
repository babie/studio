---
agent:
  type: claude
  # Pro/Max subscription rate limits — keep concurrency low.
  max_concurrent_agents: 2
  max_turns: 10

# Read when agent.type: claude. Pass model + permission-mode as CLI args.
claude:
  command: claude-app-server --model claude-opus-4-7 --permission-mode bypassPermissions

# Read when agent.type: codex. Untouched here so you can flip agent.type and re-run.
codex:
  command: codex --config shell_environment_policy.inherit=all --config 'model="gpt-5.5"' app-server
  approval_policy: never
  thread_sandbox: workspace-write
  turn_sandbox_policy:
    type: workspaceWrite

# Perform drives doing/done transitions via the GitHub API itself
# (no curl in the prompt). See docs/adr/0014-symphony-owned-state-transitions.md.
tracker:
  kind: github
  active_states: [Todo]
  terminal_states: [Done]
  doing_state: "In Progress"
  done_state: Done

# api_key/assignee accept either a literal value or a `$ENV_NAME` reference.
# NOTE: fine-grained PATs do NOT work with user-owned ProjectV2 (a known
# GitHub limitation). Issue a classic PAT (ghp_...) with repo + project scope.
github:
  api_key: $GITHUB_TOKEN
  project_owner: your-github-owner
  project_number: 1
  # assignee: me                # optional — restrict to issues whose first GitHub assignee matches the PAT owner
  # NOTE: project membership alone is not enough; the issue itself must carry the assignee in the UI.

workspace:
  root: /tmp/studio/workspaces

hooks:
  after_create: |
    git init
    git config user.email "agent@studio.local"
    git config user.name "Studio Agent"
    echo "# Workspace" > README.md
    git add README.md
    git commit -m "Initial commit"
---

You are working on GitHub issue {{ issue.identifier }} (id: {{ issue.id }}): {{ issue.title }}.

{{ issue.description }}

Instructions:
1. Read the issue description carefully and implement what is asked in the current workspace directory.
2. Commit your changes to the workspace git repository with a descriptive message.
3. When implementation is complete, stop — Perform will move the issue to "Done".
