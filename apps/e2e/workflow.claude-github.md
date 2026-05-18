---
agent:
  type: claude
  # Claude Pro/Max throttles concurrency; 2-3 is a reasonable cap.
  max_concurrent_agents: 2
  max_turns: 10

claude:
  command: claude-app-server --model claude-opus-4-7 --permission-mode bypassPermissions

tracker:
  kind: github
  active_states: [Todo]
  terminal_states: [Done]
  # When doing_state / done_state are set, perform handles the status
  # transitions automatically (see ADR-0014). Leave them unset to opt out
  # and run with the Linear-style prompt-driven workflow instead.
  doing_state: "In Progress"
  done_state: Done

github:
  # api_key is required by perform; env-ref form is the standard
  # `$VAR` indirection resolved by config/env-resolve.ts.
  api_key: $GITHUB_TOKEN
  # NOTE: fine-grained PATs do not work with user-owned ProjectV2 (a known
  # GitHub limitation). Issue a classic PAT (ghp_...) with repo + project scope.
  project_owner: babie
  project_number: 4
  # assignee: me restricts the candidate set to project items where the
  # PAT owner is explicitly assigned. Make sure the issue carries that
  # assignee in the GitHub UI; project membership alone is not enough.
  assignee: me

workspace:
  # Separate root from the Linear E2E (/tmp/studio-e2e/workspaces) so both
  # tracker pipelines can run side by side without colliding.
  root: /tmp/studio-e2e-github/workspaces

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

Note: Issue status transitions (Todo -> In Progress -> Done) are handled automatically by perform -- you do not need to call the GitHub API. Just finish the implementation and exit cleanly.
