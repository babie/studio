# M2 Phase 4: Docs + E2E Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Milestone 2 by writing GitHub-supporting documentation, refactoring E2E scripts to support both Linear and GitHub trackers, and running a real E2E against the live GitHub Project to validate the full pipeline.

**Architecture:** No Symphony / claude-app-server code changes. Documentation work (workflow example, 2 ADRs, milestone doc, sweep of live docs), plus TypeScript script refactor (extract `scripts/lib/e2e-common.ts`, rename `scripts/e2e.ts` → `scripts/e2e.claude-linear.ts`, add `scripts/e2e.claude-github.ts`, introduce `scripts/e2e.config.json`). Real E2E is the validation step, executed manually by the user, with the result captured in the milestone doc.

**Tech Stack:** TypeScript (Node 20+, ESM, tsdown bundler), valibot for runtime schema, @praha/byethrow for Result types, GitHub GraphQL v4 (`api.github.com/graphql`), Linear GraphQL (`api.linear.app/graphql`). All script-side; Elixir / claude-app-server unchanged.

**Branch:** `feat/m2-phase4` (already created at start of this work).

**Spec:** [`docs/superpowers/specs/2026-05-15-m2-phase4-design.md`](../specs/2026-05-15-m2-phase4-design.md)

---

## Pre-flight checks (run once before Task 1)

- [ ] Verify branch is `feat/m2-phase4`: `git -C /workspace branch --show-current`
- [ ] Verify `mix test` is green at HEAD: `cd /workspace/apps/symphony && mix test 2>&1 | tail -5`
- [ ] Verify pnpm build still works: `cd /workspace && pnpm build 2>&1 | tail -10`

These are sanity checks. None of the Phase 4 work should break them, so if they fail at start, fix before continuing.

---

## Task 1: Rename `workflow.claude.md` → `workflow.claude-linear.md` and sweep live references

**Files:**
- Rename: `apps/symphony/examples/workflow.claude.md` → `apps/symphony/examples/workflow.claude-linear.md`
- Modify: `README.md` L73, L79
- Modify: `scripts/e2e.ts` L22 (default path string only; will be reorganized in later tasks)
- Modify: `docs/e2e_testing.md` L3, L44, L122, L128, L163, L197, L275
- Modify: `apps/symphony/CLAUDE.md` L96, L130, L162, L203, L227
- Modify: `apps/symphony/README.md` L167

**Do NOT modify:** Anything under `docs/superpowers/specs/`, `docs/superpowers/plans/`, `docs/milestones/01-claude-minimal.md`, `apps/symphony/SPEC.md`, `apps/symphony/WORKFLOW.md`. These are frozen records.

- [ ] **Step 1: Rename the example file**

```bash
git mv /workspace/apps/symphony/examples/workflow.claude.md /workspace/apps/symphony/examples/workflow.claude-linear.md
```

- [ ] **Step 2: Verify the rename is staged**

```bash
git -C /workspace status --short
```

Expected output contains:
```
R  apps/symphony/examples/workflow.claude.md -> apps/symphony/examples/workflow.claude-linear.md
```

- [ ] **Step 3: Sweep `README.md`**

Replace exactly two strings in `/workspace/README.md`:
- L73 (or its current content): `apps/symphony/examples/workflow.claude.md を参考に` → `apps/symphony/examples/workflow.claude-linear.md を参考に`
- L79 (or its current content): `./bin/symphony examples/workflow.claude.md` → `./bin/symphony examples/workflow.claude-linear.md`

Use Edit on each occurrence individually. The README only has these two hits for `workflow.claude.md`; do not edit other lines in this task.

- [ ] **Step 4: Sweep `scripts/e2e.ts` default path**

In `/workspace/scripts/e2e.ts` L22, change the default:

```ts
E2E_WORKFLOW_PATH: v.optional(v.string(), 'apps/symphony/examples/workflow.claude.md'),
```

to:

```ts
E2E_WORKFLOW_PATH: v.optional(v.string(), 'apps/symphony/examples/workflow.claude-linear.md'),
```

This is the only `scripts/e2e.ts` edit in this task. Wholesale refactor is Task 3.

- [ ] **Step 5: Sweep `docs/e2e_testing.md`**

Replace every occurrence of the literal string `workflow.claude.md` with `workflow.claude-linear.md` in `/workspace/docs/e2e_testing.md`. Use Edit with `replace_all: true` if appropriate.

Note: the file may have multiple occurrences in fenced code blocks, table cells, and prose. All should be renamed.

- [ ] **Step 6: Sweep `apps/symphony/CLAUDE.md`**

Same as Step 5 but for `/workspace/apps/symphony/CLAUDE.md`. Replace all `workflow.claude.md` → `workflow.claude-linear.md`.

- [ ] **Step 7: Sweep `apps/symphony/README.md`**

Same as Step 5 but for `/workspace/apps/symphony/README.md`. Replace all `workflow.claude.md` → `workflow.claude-linear.md`.

- [ ] **Step 8: Verify no live doc still references the old name**

```bash
cd /workspace && rg -n "workflow\.claude\.md" -- 'README.md' 'scripts/' 'docs/e2e_testing.md' 'apps/symphony/CLAUDE.md' 'apps/symphony/README.md' 'CLAUDE.md' 'docs/architecture.md' 'docs/protocol.md' 2>&1
```

Expected: no output (zero matches).

If anything is matched, fix it before committing.

- [ ] **Step 9: Verify build still works**

```bash
cd /workspace && pnpm e2e:build 2>&1 | tail -10
```

Expected: build succeeds (`Build complete` or similar from tsdown). The rename to `workflow.claude-linear.md` is just a string update in `e2e.ts`; the script still compiles.

- [ ] **Step 10: Commit**

```bash
cd /workspace && git add -A apps/symphony/examples/workflow.claude.md apps/symphony/examples/workflow.claude-linear.md README.md scripts/e2e.ts docs/e2e_testing.md apps/symphony/CLAUDE.md apps/symphony/README.md
git status --short
```

Confirm staged contents look right (1 rename, 5 modifications), then commit:

```bash
git commit -m "$(cat <<'EOF'
chore(repo): rename workflow.claude.md to workflow.claude-linear.md

M2 で GitHub backend example も加わるため、`<backend>-<tracker>` の
一貫した命名パターンに揃える。中身は変更なし。frozen records
(docs/superpowers/, docs/milestones/01-*, apps/symphony/SPEC.md,
apps/symphony/WORKFLOW.md) には触らない。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `apps/symphony/examples/workflow.claude-github.md`

**Files:**
- Create: `apps/symphony/examples/workflow.claude-github.md`

**Reference:** Phase 2 `/tmp/workflow.github.md` (in the dev container), plus the spec section "`examples/workflow.claude-github.md` の中身".

- [ ] **Step 1: Write the file**

Create `/workspace/apps/symphony/examples/workflow.claude-github.md` with exactly this content:

```markdown
---
agent:
  type: claude
  # Claude Pro/Max は同時実行数に厳しいため 2〜3 を推奨
  max_concurrent_agents: 2
  max_turns: 10

claude:
  command: claude-app-server --model claude-opus-4-7 --permission-mode bypassPermissions

tracker:
  kind: github
  active_states: [Todo, "In Progress"]
  terminal_states: [Done]
  # doing_state / done_state を設定すると Symphony が自動遷移する (ADR-0014)。
  # 未設定なら no-op (Linear の prompt 方式運用とも互換)。
  doing_state: "In Progress"
  done_state: Done

github:
  # API key は env GITHUB_TOKEN フォールバックで読まれる。
  # 注意: fine-grained PAT は user-owned ProjectV2 に未対応 (GitHub の既知の制限)。
  # classic PAT (ghp_...) を repo + project scope で発行すること。
  project_owner: babie
  project_number: 3
  # assignee: me は Project の Items に PAT 所有者が assignee として
  # 明示的にセットされている issue のみを候補に乗せる。GitHub UI で
  # 必ず assignee を立てておくこと。
  assignee: me

workspace:
  # Linear E2E (/tmp/concert-e2e/workspaces) と並走できるよう別 root に
  root: /tmp/concert-e2e-github/workspaces

hooks:
  after_create: |
    git init
    git config user.email "agent@concert.local"
    git config user.name "Concert Agent"
    echo "# Workspace" > README.md
    git add README.md
    git commit -m "Initial commit"
---

You are working on GitHub issue {{ issue.identifier }} (id: {{ issue.id }}): {{ issue.title }}.

{{ issue.description }}

Instructions:
1. Read the issue description carefully and implement what is asked in the current workspace directory.
2. Commit your changes to the workspace git repository with a descriptive message.

Note: Issue status transitions (Todo → In Progress → Done) are handled automatically by Symphony's orchestrator — you do not need to call the GitHub API. Just finish the implementation and exit cleanly.
```

- [ ] **Step 2: Verify YAML front-matter parses**

There is no standalone YAML lint configured. The acceptance test is that Symphony can load it. Defer the actual load test to Task 5 / Task 7 (E2E script run). For now, sanity-check the file exists and contains the expected sentinel string:

```bash
cd /workspace && grep -c "doing_state" apps/symphony/examples/workflow.claude-github.md
```

Expected: `1` (the YAML key, no others).

- [ ] **Step 3: Commit**

```bash
cd /workspace && git add apps/symphony/examples/workflow.claude-github.md
git commit -m "$(cat <<'EOF'
feat(symphony): add workflow.claude-github.md example

`agent.type: claude` + `tracker.kind: github` 構成のサンプル。Phase 2 の
iex 検証で使った設定をベースに、Phase 3 のリネーム (doing_state /
done_state) を適用し、fine-grained PAT 制限 / assignee 運用ノウハウを
コメントで明記。prompt 本文は Linear 版と異なり curl で state を
動かす手順を持たない (ADR-0014、Symphony が自動遷移する)。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Extract `scripts/lib/e2e-common.ts` and rename `e2e.ts` → `e2e.claude-linear.ts`

**Files:**
- Create: `scripts/lib/e2e-common.ts`
- Rename + restructure: `scripts/e2e.ts` → `scripts/e2e.claude-linear.ts`
- Modify: `tsdown.config.ts` (entry list)
- Modify: `package.json` (scripts)

**Architecture for this refactor:** the common module exports tracker-agnostic helpers and a `CommonE2EError` union. The Linear-specific file imports both and extends the error union. No behavior change to what `pnpm e2e:claude-linear` does at runtime.

This is a pure refactor task: after it lands, `pnpm e2e:claude-linear` should pass the same way `pnpm e2e` did before. `pnpm e2e:claude-github` does **not** yet exist; it lands in Task 5.

- [ ] **Step 1: Create `scripts/lib/e2e-common.ts`**

Create the directory `/workspace/scripts/lib/` if it does not exist, then create `/workspace/scripts/lib/e2e-common.ts` with the following content. This file collects every tracker-agnostic helper from the current `scripts/e2e.ts`. Lines that are *not* moved here stay in the renamed Linear script.

```ts
// scripts/lib/e2e-common.ts
//
// Tracker-agnostic helpers for E2E scripts. The Linear and GitHub
// variants import from this module and extend the error union with
// their own tracker-specific variants.

import { execFile, spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import type { ChildProcess } from 'node:child_process';
import { Result } from '@praha/byethrow';

const execFileP = promisify(execFile);

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
export const SYMPHONY_LOG_PATH = path.join(REPO_ROOT, 'scripts/e2e.symphony.log');

// ---------------------------------------------------------------------
// Common error variants
// ---------------------------------------------------------------------

export type CommonE2EError =
  | { kind: 'ConfigError'; issues: ReadonlyArray<string> }
  | { kind: 'ToolMissing'; tools: ReadonlyArray<string> }
  | { kind: 'BuildFailed'; phase: 'claude-app-server' | 'symphony'; code: number }
  | { kind: 'InstallFailed'; code: number }
  | { kind: 'SymphonySpawnFailed'; cause: string }
  | { kind: 'SymphonyExitedUnexpectedly'; code: number }
  | {
      kind: 'SymphonyTimedOut';
      logPath: string;
      lastPollErrorKind: string | null;
    }
  | {
      kind: 'VerifyFailed';
      check: 'fileExists' | 'nodeOutput' | 'gitCommitted';
      detail: string;
      workspacePath: string;
    }
  | { kind: 'Interrupted' };

export function assertNever(x: never): never {
  throw new Error(`unhandled error variant: ${JSON.stringify(x)}`);
}

// ---------------------------------------------------------------------
// Tool checks / preflight
// ---------------------------------------------------------------------

const REQUIRED_TOOLS = ['pnpm', 'mix', 'node', 'git'] as const;

async function checkTool(name: string): Promise<boolean> {
  try {
    await execFileP('which', [name]);
    return true;
  } catch {
    return false;
  }
}

export async function preflight(): Promise<Result.Result<void, CommonE2EError>> {
  if (process.env.ANTHROPIC_API_KEY) {
    console.warn(
      'preflight: unsetting ANTHROPIC_API_KEY to force Pro/Max subscription auth',
    );
    delete process.env.ANTHROPIC_API_KEY;
  }
  const toolChecks = await Promise.all(
    REQUIRED_TOOLS.map(async (tool) => ({ tool, ok: await checkTool(tool) })),
  );
  const missing = toolChecks.filter((r) => !r.ok).map((r) => r.tool);
  if (missing.length > 0) {
    return Result.fail({ kind: 'ToolMissing', tools: missing });
  }
  return Result.succeed(undefined);
}

// ---------------------------------------------------------------------
// Child-process helper
// ---------------------------------------------------------------------

export function runChild(
  command: string,
  args: ReadonlyArray<string>,
  options: { cwd?: string } = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd ?? process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? -1));
  });
}

// ---------------------------------------------------------------------
// Build / install
// ---------------------------------------------------------------------

export async function buildClaudeAppServer(): Promise<Result.Result<void, CommonE2EError>> {
  const code = await runChild('pnpm', ['build:claude-app-server'], { cwd: REPO_ROOT });
  if (code !== 0) {
    return Result.fail({ kind: 'BuildFailed', phase: 'claude-app-server', code });
  }
  return Result.succeed(undefined);
}

export async function buildSymphony(): Promise<Result.Result<void, CommonE2EError>> {
  const code = await runChild('mix', ['compile'], {
    cwd: path.join(REPO_ROOT, 'apps/symphony'),
  });
  if (code !== 0) {
    return Result.fail({ kind: 'BuildFailed', phase: 'symphony', code });
  }
  return Result.succeed(undefined);
}

export async function installClaudeAppServer(): Promise<Result.Result<void, CommonE2EError>> {
  const code = await runChild('pnpm', ['dev:install'], { cwd: REPO_ROOT });
  if (code !== 0) {
    return Result.fail({ kind: 'InstallFailed', code });
  }
  return Result.succeed(undefined);
}

// ---------------------------------------------------------------------
// Workspace cleanup / verify (used by both tracker variants)
// ---------------------------------------------------------------------

export async function cleanWorkspaceAt(
  workspacePath: string,
): Promise<Result.Result<void, CommonE2EError>> {
  await rm(workspacePath, { recursive: true, force: true });
  return Result.succeed(undefined);
}

export async function verifyWorkspaceHello(
  workspacePath: string,
): Promise<Result.Result<void, CommonE2EError>> {
  const helloPath = path.join(workspacePath, 'tmp/hello.js');
  if (!existsSync(helloPath)) {
    return Result.fail({
      kind: 'VerifyFailed',
      check: 'fileExists',
      detail: `${helloPath} does not exist`,
      workspacePath,
    });
  }
  let stdout: string;
  try {
    const r = await execFileP('node', [helloPath]);
    stdout = r.stdout;
  } catch (err) {
    return Result.fail({
      kind: 'VerifyFailed',
      check: 'nodeOutput',
      detail: `node ${helloPath} failed: ${err instanceof Error ? err.message : String(err)}`,
      workspacePath,
    });
  }
  if (stdout !== 'Hello, World!\n') {
    return Result.fail({
      kind: 'VerifyFailed',
      check: 'nodeOutput',
      detail: `expected "Hello, World!\\n", got ${JSON.stringify(stdout)}`,
      workspacePath,
    });
  }
  try {
    const r = await execFileP('git', [
      '-C',
      workspacePath,
      'log',
      '--oneline',
      '--',
      'tmp/hello.js',
    ]);
    if (r.stdout.trim().length === 0) {
      return Result.fail({
        kind: 'VerifyFailed',
        check: 'gitCommitted',
        detail: 'no commits touch tmp/hello.js',
        workspacePath,
      });
    }
  } catch (err) {
    return Result.fail({
      kind: 'VerifyFailed',
      check: 'gitCommitted',
      detail: `git log failed: ${err instanceof Error ? err.message : String(err)}`,
      workspacePath,
    });
  }
  return Result.succeed(undefined);
}

// ---------------------------------------------------------------------
// Symphony subprocess management
// ---------------------------------------------------------------------

export type SymphonyOutcome =
  | { kind: 'terminal' }
  | { kind: 'timeout' }
  | { kind: 'interrupted' }
  | { kind: 'exited'; code: number };

export async function killGracefully(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  child.kill('SIGTERM');
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) return;
    await delay(100);
  }
  if (child.exitCode === null) child.kill('SIGKILL');
}

export function spawnSymphony(params: {
  workflowPath: string;
  tag: string;
}): Result.Result<ChildProcess, CommonE2EError> {
  const workflowAbs = path.resolve(REPO_ROOT, params.workflowPath);
  const symphonyDir = path.join(REPO_ROOT, 'apps/symphony');
  const logStream = createWriteStream(SYMPHONY_LOG_PATH, { flags: 'a' });
  logStream.write(`\n=== ${new Date().toISOString()} ${params.tag} ===\n`);
  let child: ChildProcess;
  try {
    child = spawn(
      './bin/symphony',
      [
        '--i-understand-that-this-will-be-running-without-the-usual-guardrails',
        workflowAbs,
      ],
      { cwd: symphonyDir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (err) {
    return Result.fail({
      kind: 'SymphonySpawnFailed',
      cause: err instanceof Error ? err.message : String(err),
    });
  }
  child.stdout?.pipe(logStream, { end: false });
  child.stderr?.pipe(logStream, { end: false });
  child.once('exit', () => logStream.end());
  return Result.succeed(child);
}

// ---------------------------------------------------------------------
// Polling loop (parameterised on a tracker-specific status fn)
// ---------------------------------------------------------------------

export async function runSymphonyUntilTerminal<E extends { kind: string }>(params: {
  child: ChildProcess;
  pollIntervalMs: number;
  initialDelayMs: number;
  timeoutMs: number;
  pollStatus: () => Promise<Result.Result<{ state: string; terminal: boolean }, E>>;
}): Promise<Result.Result<void, CommonE2EError | E>> {
  let interrupted = false;
  const onSigint = () => {
    interrupted = true;
  };
  process.once('SIGINT', onSigint);

  const deadline = Date.now() + params.timeoutMs;
  let outcome: SymphonyOutcome | null = null;
  let lastPollErrorKind: string | null = null;

  try {
    await delay(params.initialDelayMs);
    while (Date.now() < deadline) {
      if (interrupted) {
        outcome = { kind: 'interrupted' };
        break;
      }
      if (params.child.exitCode !== null) {
        outcome = { kind: 'exited', code: params.child.exitCode };
        break;
      }
      const status = await params.pollStatus();
      if (Result.isFailure(status)) {
        lastPollErrorKind = status.error.kind;
        console.warn(`  (poll error: ${status.error.kind}, retrying)`);
      } else if (status.value.terminal) {
        console.log(`  issue reached "${status.value.state}", exiting symphony`);
        outcome = { kind: 'terminal' };
        break;
      } else {
        console.log(`  status="${status.value.state}", waiting...`);
      }
      await delay(params.pollIntervalMs);
    }
    if (!outcome) outcome = { kind: 'timeout' };
  } finally {
    process.off('SIGINT', onSigint);
    await killGracefully(params.child);
  }

  switch (outcome.kind) {
    case 'terminal':
      return Result.succeed(undefined);
    case 'timeout':
      return Result.fail({
        kind: 'SymphonyTimedOut',
        logPath: SYMPHONY_LOG_PATH,
        lastPollErrorKind,
      });
    case 'interrupted':
      return Result.fail({ kind: 'Interrupted' });
    case 'exited':
      return Result.fail({ kind: 'SymphonyExitedUnexpectedly', code: outcome.code });
    default:
      return assertNever(outcome);
  }
}

// ---------------------------------------------------------------------
// Error rendering for common variants
// ---------------------------------------------------------------------

export function reportCommonError(error: CommonE2EError): number {
  switch (error.kind) {
    case 'ConfigError':
      console.error('FAIL: invalid config');
      for (const issue of error.issues) console.error(`  - ${issue}`);
      return 2;
    case 'ToolMissing':
      console.error(`FAIL: missing required tools: ${error.tools.join(', ')}`);
      return 2;
    case 'BuildFailed':
      console.error(`FAIL: build of ${error.phase} exited with code ${error.code}`);
      return 1;
    case 'InstallFailed':
      console.error(`FAIL: pnpm dev:install exited with code ${error.code}`);
      return 1;
    case 'SymphonySpawnFailed':
      console.error(`FAIL: symphony spawn failed: ${error.cause}`);
      return 1;
    case 'SymphonyExitedUnexpectedly':
      console.error(`FAIL: symphony exited unexpectedly with code ${error.code}`);
      return 1;
    case 'SymphonyTimedOut':
      console.error(`FAIL: symphony timed out; see ${error.logPath}`);
      if (error.lastPollErrorKind) {
        console.error(`  last poll error: ${error.lastPollErrorKind}`);
      }
      return 1;
    case 'VerifyFailed':
      console.error(`FAIL: verification (${error.check}): ${error.detail}`);
      console.error(`  workspace: ${error.workspacePath}`);
      return 1;
    case 'Interrupted':
      console.error('FAIL: interrupted');
      return 130;
    default:
      return assertNever(error);
  }
}
```

- [ ] **Step 2: Rename `scripts/e2e.ts` to `scripts/e2e.claude-linear.ts`**

```bash
cd /workspace && git mv scripts/e2e.ts scripts/e2e.claude-linear.ts
```

- [ ] **Step 3: Rewrite `scripts/e2e.claude-linear.ts` to use the common module**

Open `/workspace/scripts/e2e.claude-linear.ts` and replace its entire content with the following. The Linear-specific GraphQL + env schema stay; everything else is imported from `./lib/e2e-common.ts`.

```ts
#!/usr/bin/env node
// scripts/e2e.claude-linear.ts
//
// End-to-end test for the Linear tracker + Claude backend pipeline.
// Imports tracker-agnostic helpers from ./lib/e2e-common.

import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { Result } from '@praha/byethrow';
import * as v from 'valibot';

import {
  buildClaudeAppServer,
  buildSymphony,
  cleanWorkspaceAt,
  installClaudeAppServer,
  preflight,
  REPO_ROOT,
  reportCommonError,
  runSymphonyUntilTerminal,
  spawnSymphony,
  verifyWorkspaceHello,
  type CommonE2EError,
} from './lib/e2e-common.js';

const execFileP = promisify(execFile);

// =====================================================================
// Env (secrets only)
// =====================================================================

const EnvSchema = v.object({
  LINEAR_API_KEY: v.pipe(v.string(), v.minLength(1, 'LINEAR_API_KEY is required')),
});
type Env = v.InferOutput<typeof EnvSchema>;

// =====================================================================
// Linear-specific error variants
// =====================================================================

type LinearE2EError =
  | { kind: 'LinearHttpError'; status: number; body: string }
  | { kind: 'LinearGraphQLError'; errors: ReadonlyArray<{ message: string }> }
  | { kind: 'LinearResponseInvalid'; issues: ReadonlyArray<string> }
  | { kind: 'StateNotFound'; want: string; available: ReadonlyArray<string> };

type E2EError = CommonE2EError | LinearE2EError;

// =====================================================================
// Linear GraphQL schemas
// =====================================================================

const GraphQLErrorEnvelopeSchema = v.object({
  errors: v.optional(v.array(v.object({ message: v.string() }))),
});

const StateNodeSchema = v.object({ id: v.string(), name: v.string() });

const IssueResponseSchema = v.object({
  data: v.object({
    issue: v.object({
      id: v.string(),
      identifier: v.string(),
      team: v.object({
        states: v.object({ nodes: v.array(StateNodeSchema) }),
      }),
    }),
  }),
});

const ResetResponseSchema = v.object({
  data: v.object({
    issueUpdate: v.object({
      success: v.boolean(),
      issue: v.object({ state: v.object({ name: v.string() }) }),
    }),
  }),
});

const StatusResponseSchema = v.object({
  data: v.object({
    issue: v.object({ state: v.object({ name: v.string() }) }),
  }),
});

type IssueWithStates = v.InferOutput<typeof IssueResponseSchema>['data']['issue'];

// =====================================================================
// Config (from scripts/e2e.config.json's "linear" section — landed in Task 4)
// =====================================================================

const LinearConfigSchema = v.object({
  issueKey: v.pipe(v.string(), v.minLength(1)),
  resetStateName: v.pipe(v.string(), v.minLength(1)),
  workflowPath: v.pipe(v.string(), v.minLength(1)),
  workspaceRoot: v.pipe(v.string(), v.minLength(1)),
  timeoutSeconds: v.pipe(v.number(), v.minValue(1)),
  terminalStates: v.array(v.string()),
});
type LinearConfig = v.InferOutput<typeof LinearConfigSchema>;

// =====================================================================
// Linear GraphQL helper
// =====================================================================

const LINEAR_ENDPOINT = 'https://api.linear.app/graphql';

async function linearGraphql<TOutput>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
  schema: v.GenericSchema<unknown, TOutput>,
): Promise<Result.Result<TOutput, LinearE2EError>> {
  let res: Response;
  try {
    res = await fetch(LINEAR_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    return Result.fail({
      kind: 'LinearHttpError',
      status: 0,
      body: err instanceof Error ? err.message : String(err),
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '<unreadable>');
    return Result.fail({ kind: 'LinearHttpError', status: res.status, body });
  }
  const json = (await res.json().catch(() => null)) as unknown;
  const envelope = v.safeParse(GraphQLErrorEnvelopeSchema, json);
  if (envelope.success && envelope.output.errors && envelope.output.errors.length > 0) {
    return Result.fail({ kind: 'LinearGraphQLError', errors: envelope.output.errors });
  }
  const parsed = v.safeParse(schema, json);
  if (!parsed.success) {
    const issues = parsed.issues.map(
      (i) => `${i.path?.map((p) => String(p.key)).join('.') ?? '<root>'}: ${i.message}`,
    );
    return Result.fail({ kind: 'LinearResponseInvalid', issues });
  }
  return Result.succeed(parsed.output);
}

const FETCH_ISSUE_QUERY = `
  query GetIssue($id: String!) {
    issue(id: $id) {
      id
      identifier
      team {
        states {
          nodes { id name }
        }
      }
    }
  }
`;

const RESET_MUTATION = `
  mutation Reset($id: String!, $stateId: String!) {
    issueUpdate(id: $id, input: { stateId: $stateId }) {
      success
      issue { state { name } }
    }
  }
`;

const STATUS_QUERY = `
  query GetStatus($id: String!) {
    issue(id: $id) { state { name } }
  }
`;

async function fetchIssue(
  apiKey: string,
  issueKey: string,
): Promise<Result.Result<IssueWithStates, LinearE2EError>> {
  const r = await linearGraphql(apiKey, FETCH_ISSUE_QUERY, { id: issueKey }, IssueResponseSchema);
  if (Result.isFailure(r)) return r;
  return Result.succeed(r.value.data.issue);
}

async function resetIssueToTodo(
  apiKey: string,
  issue: IssueWithStates,
  resetStateName: string,
): Promise<Result.Result<void, LinearE2EError>> {
  const stateNode = issue.team.states.nodes.find((s) => s.name === resetStateName);
  if (!stateNode) {
    return Result.fail({
      kind: 'StateNotFound',
      want: resetStateName,
      available: issue.team.states.nodes.map((s) => s.name),
    });
  }
  const r = await linearGraphql(
    apiKey,
    RESET_MUTATION,
    { id: issue.id, stateId: stateNode.id },
    ResetResponseSchema,
  );
  if (Result.isFailure(r)) return r;
  if (!r.value.data.issueUpdate.success) {
    return Result.fail({
      kind: 'LinearGraphQLError',
      errors: [{ message: 'issueUpdate returned success=false' }],
    });
  }
  return Result.succeed(undefined);
}

function pollStatusFactory(
  apiKey: string,
  issueKey: string,
  terminalStates: ReadonlySet<string>,
): () => Promise<Result.Result<{ state: string; terminal: boolean }, LinearE2EError>> {
  return async () => {
    const r = await linearGraphql(apiKey, STATUS_QUERY, { id: issueKey }, StatusResponseSchema);
    if (Result.isFailure(r)) return r;
    const name = r.value.data.issue.state.name;
    return Result.succeed({ state: name, terminal: terminalStates.has(name) });
  };
}

// =====================================================================
// Linear-specific error rendering
// =====================================================================

function reportError(error: E2EError): number {
  switch (error.kind) {
    case 'LinearHttpError':
      console.error(`FAIL: Linear HTTP ${error.status}: ${error.body}`);
      return 1;
    case 'LinearGraphQLError':
      console.error('FAIL: Linear GraphQL errors:');
      for (const e of error.errors) console.error(`  - ${e.message}`);
      return 1;
    case 'LinearResponseInvalid':
      console.error('FAIL: Linear response did not match schema:');
      for (const i of error.issues) console.error(`  - ${i}`);
      return 1;
    case 'StateNotFound':
      console.error(`FAIL: state "${error.want}" not found in team`);
      console.error(`  available: ${error.available.join(', ')}`);
      return 1;
    default:
      return reportCommonError(error);
  }
}

// =====================================================================
// Config load
// =====================================================================

import { readFile } from 'node:fs/promises';

async function loadConfig(): Promise<Result.Result<LinearConfig, E2EError>> {
  const cfgPath = path.join(REPO_ROOT, 'scripts/e2e.config.json');
  let raw: string;
  try {
    raw = await readFile(cfgPath, 'utf8');
  } catch (err) {
    return Result.fail({
      kind: 'ConfigError',
      issues: [`failed to read ${cfgPath}: ${err instanceof Error ? err.message : String(err)}`],
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return Result.fail({
      kind: 'ConfigError',
      issues: [`invalid JSON in ${cfgPath}: ${err instanceof Error ? err.message : String(err)}`],
    });
  }
  const obj = parsed as { linear?: unknown };
  if (!obj || typeof obj !== 'object' || !('linear' in obj)) {
    return Result.fail({ kind: 'ConfigError', issues: ['scripts/e2e.config.json must have a "linear" section'] });
  }
  const result = v.safeParse(LinearConfigSchema, obj.linear);
  if (result.success) return Result.succeed(result.output);
  const issues = result.issues.map(
    (i) => `linear.${i.path?.map((p) => String(p.key)).join('.') ?? '<root>'}: ${i.message}`,
  );
  return Result.fail({ kind: 'ConfigError', issues });
}

function parseEnv(): Result.Result<Env, E2EError> {
  const result = v.safeParse(EnvSchema, process.env);
  if (result.success) return Result.succeed(result.output);
  const issues = result.issues.map(
    (i) => `${i.path?.map((p) => p.key).join('.') ?? '<root>'}: ${i.message}`,
  );
  return Result.fail({ kind: 'ConfigError', issues });
}

// =====================================================================
// Main
// =====================================================================

async function main(): Promise<number> {
  const envResult = parseEnv();
  if (Result.isFailure(envResult)) return reportError(envResult.error);
  const env = envResult.value;

  const cfgResult = await loadConfig();
  if (Result.isFailure(cfgResult)) return reportError(cfgResult.error);
  const cfg = cfgResult.value;

  const workspacePath = path.join(cfg.workspaceRoot, cfg.issueKey);
  const terminalStates = new Set(cfg.terminalStates);

  const result = await Result.pipe(
    Result.succeed(undefined as void),
    Result.andThrough(() => {
      console.log('→ preflight');
      return preflight();
    }),
    Result.andThrough(() => {
      console.log(`→ clean workspace ${workspacePath}`);
      return cleanWorkspaceAt(workspacePath);
    }),
    Result.andThrough(() => {
      console.log('→ build claude-app-server');
      return buildClaudeAppServer();
    }),
    Result.andThrough(() => {
      console.log('→ build symphony');
      return buildSymphony();
    }),
    Result.andThrough(() => {
      console.log('→ install claude-app-server (pnpm dev:install)');
      return installClaudeAppServer();
    }),
    Result.andThen(() => {
      console.log(`→ fetch Linear issue ${cfg.issueKey}`);
      return fetchIssue(env.LINEAR_API_KEY, cfg.issueKey);
    }),
    Result.andThrough((issue) => {
      console.log(`→ reset issue ${issue.identifier} to "${cfg.resetStateName}"`);
      return resetIssueToTodo(env.LINEAR_API_KEY, issue, cfg.resetStateName);
    }),
    Result.andThen(() => {
      console.log('→ run symphony until issue reaches terminal state');
      const spawnResult = spawnSymphony({ workflowPath: cfg.workflowPath, tag: cfg.issueKey });
      if (Result.isFailure(spawnResult)) return Promise.resolve(spawnResult);
      const pollStatus = pollStatusFactory(env.LINEAR_API_KEY, cfg.issueKey, terminalStates);
      return runSymphonyUntilTerminal({
        child: spawnResult.value,
        pollIntervalMs: 10_000,
        initialDelayMs: 10_000,
        timeoutMs: cfg.timeoutSeconds * 1000,
        pollStatus,
      });
    }),
    Result.andThen(() => {
      console.log('→ verify workspace');
      return verifyWorkspaceHello(workspacePath);
    }),
  );

  if (Result.isFailure(result)) return reportError(result.error);

  console.log('→ cleanup workspace (success)');
  const cleanResult = await cleanWorkspaceAt(workspacePath);
  if (Result.isFailure(cleanResult)) {
    console.warn(`  (cleanup warning: ${cleanResult.error.kind} — workspace may remain)`);
  }
  console.log('PASS');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('FAIL: unexpected exception:', err);
    process.exit(1);
  },
);
```

Note: This file references `scripts/e2e.config.json` which does not yet exist — it lands in Task 4. After this task, attempting to run `pnpm e2e:claude-linear` would fail with `ConfigError`. That's expected; Task 4 makes it work again.

- [ ] **Step 4: Update `tsdown.config.ts`**

Replace `/workspace/tsdown.config.ts` contents with:

```ts
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['scripts/e2e.claude-linear.ts'],
  outDir: 'scripts/dist',
  format: 'esm',
  platform: 'node',
  target: 'node20',
  dts: false,
  clean: true,
});
```

GitHub entry is added in Task 5 — keep this commit refactor-only.

- [ ] **Step 5: Update `package.json` scripts**

In `/workspace/package.json`, replace the two `e2e` script lines:

```json
"e2e:build": "tsdown",
"e2e": "pnpm e2e:build && node scripts/dist/e2e.mjs"
```

with:

```json
"e2e:build": "tsdown",
"e2e:claude-linear": "pnpm e2e:build && node scripts/dist/e2e.claude-linear.mjs",
"e2e": "pnpm e2e:claude-linear"
```

(`pnpm e2e:claude-github` is added in Task 5; for this commit `pnpm e2e` still means "Linear E2E only".)

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /workspace && pnpm e2e:build 2>&1 | tail -15
```

Expected: tsdown builds successfully and writes `scripts/dist/e2e.claude-linear.mjs`. Type errors would surface here. No runtime test (config file does not yet exist).

If tsdown errors say `Cannot find module './lib/e2e-common.js'`, double-check that `scripts/lib/e2e-common.ts` was created in Step 1 and the import path uses `.js` suffix (NodeNext ESM resolution).

- [ ] **Step 7: Commit**

```bash
cd /workspace && git add -A scripts/ tsdown.config.ts package.json
git status --short
```

Confirm staged contents (1 rename, 1 new `lib/e2e-common.ts`, 2 modifications), then commit:

```bash
git commit -m "$(cat <<'EOF'
refactor(scripts): extract e2e common module and rename e2e.ts

Tracker 非依存の preflight/build/install/spawn/verify/polling/共通エラー
表示を scripts/lib/e2e-common.ts へ抽出。scripts/e2e.ts を
scripts/e2e.claude-linear.ts にリネームし、Linear 固有の GraphQL と env
スキーマだけを残す。本コミット時点では scripts/e2e.config.json 未配備
のため `pnpm e2e:claude-linear` は ConfigError となる (Task 4 で配備)。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Introduce `scripts/e2e.config.json` and migrate Linear non-secret env

**Files:**
- Create: `scripts/e2e.config.json`
- Modify: `docs/e2e_testing.md` (will be done in Task 10 with the full doc sweep — for now, just the config file)

**Goal:** make `pnpm e2e:claude-linear` work again with the new config-based wiring. Verify by running the script in dry-fail mode (without `LINEAR_API_KEY` set) to confirm it loads the config and reports a clean env error.

- [ ] **Step 1: Create `scripts/e2e.config.json`**

Determine the existing Linear values. The previous `scripts/e2e.ts` defaults plus prior milestone (`docs/milestones/01-claude-minimal.md`) say:
- workspace root: `/tmp/concert-e2e/workspaces`
- reset state: `Todo`
- timeout: `300`
- terminal states: `Done`, `Closed`, `Cancelled`, `Canceled`, `Duplicate` (the previous `TERMINAL_STATES` set)
- issueKey: was passed via `E2E_LINEAR_ISSUE_KEY` env. The Milestone 1 doc says the test issue is `CYFY-5` in Linear project `concert-3f96fb9d18cf`.

Confirm with the user before writing if `CYFY-5` is the correct value for the Linear issue identifier the GraphQL `issue(id: $id)` query expects. The script uses it interchangeably for the GraphQL `id` arg (works with either the UUID or the public identifier).

Write `/workspace/scripts/e2e.config.json` with:

```json
{
  "linear": {
    "issueKey": "CYFY-5",
    "resetStateName": "Todo",
    "workflowPath": "apps/symphony/examples/workflow.claude-linear.md",
    "workspaceRoot": "/tmp/concert-e2e/workspaces",
    "timeoutSeconds": 300,
    "terminalStates": ["Done", "Closed", "Cancelled", "Canceled", "Duplicate"]
  },
  "github": {
    "projectOwner": "babie",
    "projectNumber": 3,
    "repo": "<owner>/<repo>",
    "issueNumber": 0,
    "resetStateName": "Todo",
    "statusFieldName": "Status",
    "workflowPath": "apps/symphony/examples/workflow.claude-github.md",
    "workspaceRoot": "/tmp/concert-e2e-github/workspaces",
    "timeoutSeconds": 300,
    "terminalStates": ["Done"]
  }
}
```

The `github.repo` and `github.issueNumber` are placeholders. Ask the user to fill in the actual values before Task 7 (running the GitHub E2E). The Linear values come from the existing M1 setup.

- [ ] **Step 2: Verify config load path is correct (Linear smoke)**

```bash
cd /workspace && pnpm e2e:build 2>&1 | tail -3
```

Expected: tsdown succeeds.

```bash
cd /workspace && unset LINEAR_API_KEY; node scripts/dist/e2e.claude-linear.mjs 2>&1 | head -20
```

Expected: prints `FAIL: invalid config` followed by `LINEAR_API_KEY: LINEAR_API_KEY is required` and exits with code 2. This confirms:
1. The config file is found and parsed successfully (no `failed to read` error).
2. The Linear section's schema validation passes.
3. The env parser correctly catches the missing `LINEAR_API_KEY`.

If the output is `failed to read scripts/e2e.config.json` or a JSON parse error, fix the config file before continuing.

- [ ] **Step 3: Commit**

```bash
cd /workspace && git add scripts/e2e.config.json
git commit -m "$(cat <<'EOF'
chore(scripts): introduce e2e.config.json and migrate Linear non-secret env

Issue 設定や workspace root 等の non-secret な E2E 設定値を 1 ファイル
にまとめ、PAT / API key だけが env で渡される構成に。Linear 側は既存
defaults (workflowPath は Task 1 のリネーム後、terminalStates は旧
TERMINAL_STATES 定数の中身)。GitHub 側は projectOwner / projectNumber
のみ確定し、repo / issueNumber は実機 E2E 直前にユーザが埋める
プレースホルダ。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add `scripts/e2e.claude-github.ts` and wire it into pnpm scripts

**Files:**
- Create: `scripts/e2e.claude-github.ts`
- Modify: `tsdown.config.ts`
- Modify: `package.json`

**Architecture:** GitHub Project (v2) GraphQL is more involved than Linear (Project nodes / fields / item nodes / single-select option values). The script does one discovery query (resolve `projectId` / `statusFieldId` / `optionIds` / `itemId`) followed by reset + polling + completion-detection, all against `api.github.com/graphql`.

GitHub's terminal-state detection is simpler than Linear's: a project item has one `Status` single-select value, and the config provides the terminal name list (default `["Done"]`).

- [ ] **Step 1: Create `scripts/e2e.claude-github.ts`**

Write `/workspace/scripts/e2e.claude-github.ts` with:

```ts
#!/usr/bin/env node
// scripts/e2e.claude-github.ts
//
// End-to-end test for the GitHub Projects (v2) tracker + Claude backend pipeline.
// Imports tracker-agnostic helpers from ./lib/e2e-common.

import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import { Result } from '@praha/byethrow';
import * as v from 'valibot';

import {
  buildClaudeAppServer,
  buildSymphony,
  cleanWorkspaceAt,
  installClaudeAppServer,
  preflight,
  REPO_ROOT,
  reportCommonError,
  runSymphonyUntilTerminal,
  spawnSymphony,
  verifyWorkspaceHello,
  type CommonE2EError,
} from './lib/e2e-common.js';

// =====================================================================
// Env (secrets only)
// =====================================================================

const EnvSchema = v.object({
  GITHUB_TOKEN: v.pipe(v.string(), v.minLength(1, 'GITHUB_TOKEN is required')),
});
type Env = v.InferOutput<typeof EnvSchema>;

// =====================================================================
// GitHub-specific error variants
// =====================================================================

type GitHubE2EError =
  | { kind: 'GitHubHttpError'; status: number; body: string }
  | { kind: 'GitHubGraphQLError'; errors: ReadonlyArray<{ message: string }> }
  | { kind: 'GitHubResponseInvalid'; issues: ReadonlyArray<string> }
  | { kind: 'ProjectNotFound'; owner: string; number: number }
  | { kind: 'ProjectItemNotFound'; issueNumber: number }
  | { kind: 'StatusFieldNotFound'; fieldName: string }
  | { kind: 'StatusOptionNotFound'; optionName: string; available: ReadonlyArray<string> };

type E2EError = CommonE2EError | GitHubE2EError;

// =====================================================================
// Config
// =====================================================================

const GitHubConfigSchema = v.object({
  projectOwner: v.pipe(v.string(), v.minLength(1)),
  projectNumber: v.pipe(v.number(), v.minValue(1)),
  repo: v.pipe(v.string(), v.regex(/^[^/]+\/[^/]+$/, 'repo must be owner/name')),
  issueNumber: v.pipe(v.number(), v.minValue(1)),
  resetStateName: v.pipe(v.string(), v.minLength(1)),
  statusFieldName: v.pipe(v.string(), v.minLength(1)),
  workflowPath: v.pipe(v.string(), v.minLength(1)),
  workspaceRoot: v.pipe(v.string(), v.minLength(1)),
  timeoutSeconds: v.pipe(v.number(), v.minValue(1)),
  terminalStates: v.array(v.string()),
});
type GitHubConfig = v.InferOutput<typeof GitHubConfigSchema>;

async function loadConfig(): Promise<Result.Result<GitHubConfig, E2EError>> {
  const cfgPath = path.join(REPO_ROOT, 'scripts/e2e.config.json');
  let raw: string;
  try {
    raw = await readFile(cfgPath, 'utf8');
  } catch (err) {
    return Result.fail({
      kind: 'ConfigError',
      issues: [`failed to read ${cfgPath}: ${err instanceof Error ? err.message : String(err)}`],
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return Result.fail({
      kind: 'ConfigError',
      issues: [`invalid JSON in ${cfgPath}: ${err instanceof Error ? err.message : String(err)}`],
    });
  }
  const obj = parsed as { github?: unknown };
  if (!obj || typeof obj !== 'object' || !('github' in obj)) {
    return Result.fail({ kind: 'ConfigError', issues: ['scripts/e2e.config.json must have a "github" section'] });
  }
  const result = v.safeParse(GitHubConfigSchema, obj.github);
  if (result.success) return Result.succeed(result.output);
  const issues = result.issues.map(
    (i) => `github.${i.path?.map((p) => String(p.key)).join('.') ?? '<root>'}: ${i.message}`,
  );
  return Result.fail({ kind: 'ConfigError', issues });
}

function parseEnv(): Result.Result<Env, E2EError> {
  const result = v.safeParse(EnvSchema, process.env);
  if (result.success) return Result.succeed(result.output);
  const issues = result.issues.map(
    (i) => `${i.path?.map((p) => p.key).join('.') ?? '<root>'}: ${i.message}`,
  );
  return Result.fail({ kind: 'ConfigError', issues });
}

// =====================================================================
// GitHub GraphQL
// =====================================================================

const GITHUB_ENDPOINT = 'https://api.github.com/graphql';

const GraphQLErrorEnvelopeSchema = v.object({
  errors: v.optional(v.array(v.object({ message: v.string() }))),
});

async function githubGraphql<TOutput>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  schema: v.GenericSchema<unknown, TOutput>,
): Promise<Result.Result<TOutput, GitHubE2EError>> {
  let res: Response;
  try {
    res = await fetch(GITHUB_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'concert-e2e',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    return Result.fail({
      kind: 'GitHubHttpError',
      status: 0,
      body: err instanceof Error ? err.message : String(err),
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '<unreadable>');
    return Result.fail({ kind: 'GitHubHttpError', status: res.status, body });
  }
  const json = (await res.json().catch(() => null)) as unknown;
  const envelope = v.safeParse(GraphQLErrorEnvelopeSchema, json);
  if (envelope.success && envelope.output.errors && envelope.output.errors.length > 0) {
    return Result.fail({ kind: 'GitHubGraphQLError', errors: envelope.output.errors });
  }
  const parsed = v.safeParse(schema, json);
  if (!parsed.success) {
    const issues = parsed.issues.map(
      (i) => `${i.path?.map((p) => String(p.key)).join('.') ?? '<root>'}: ${i.message}`,
    );
    return Result.fail({ kind: 'GitHubResponseInvalid', issues });
  }
  return Result.succeed(parsed.output);
}

// ---------- discovery ----------

const StatusOptionSchema = v.object({ id: v.string(), name: v.string() });

const ProjectFieldSchema = v.union([
  v.object({
    __typename: v.literal('ProjectV2SingleSelectField'),
    id: v.string(),
    name: v.string(),
    options: v.array(StatusOptionSchema),
  }),
  v.object({
    __typename: v.union([
      v.literal('ProjectV2Field'),
      v.literal('ProjectV2IterationField'),
    ]),
  }),
]);

const ProjectItemSchema = v.object({
  id: v.string(),
  content: v.nullable(
    v.union([
      v.object({
        __typename: v.literal('Issue'),
        number: v.number(),
        title: v.string(),
        repository: v.object({ nameWithOwner: v.string() }),
      }),
      v.object({
        __typename: v.union([
          v.literal('PullRequest'),
          v.literal('DraftIssue'),
        ]),
      }),
    ]),
  ),
});

const DiscoveryResponseSchema = v.object({
  data: v.object({
    user: v.nullable(
      v.object({
        projectV2: v.nullable(
          v.object({
            id: v.string(),
            fields: v.object({ nodes: v.array(ProjectFieldSchema) }),
            items: v.object({ nodes: v.array(ProjectItemSchema) }),
          }),
        ),
      }),
    ),
  }),
});

const DISCOVERY_QUERY = `
  query Discover($owner: String!, $number: Int!) {
    user(login: $owner) {
      projectV2(number: $number) {
        id
        fields(first: 50) {
          nodes {
            __typename
            ... on ProjectV2SingleSelectField {
              id
              name
              options { id name }
            }
          }
        }
        items(first: 100) {
          nodes {
            id
            content {
              __typename
              ... on Issue {
                number
                title
                repository { nameWithOwner }
              }
            }
          }
        }
      }
    }
  }
`;

type Discovered = {
  projectId: string;
  fieldId: string;
  optionIdByName: ReadonlyMap<string, string>;
  itemId: string;
};

async function discover(
  token: string,
  cfg: GitHubConfig,
): Promise<Result.Result<Discovered, GitHubE2EError>> {
  const r = await githubGraphql(
    token,
    DISCOVERY_QUERY,
    { owner: cfg.projectOwner, number: cfg.projectNumber },
    DiscoveryResponseSchema,
  );
  if (Result.isFailure(r)) return r;
  const project = r.value.data.user?.projectV2 ?? null;
  if (!project) {
    return Result.fail({
      kind: 'ProjectNotFound',
      owner: cfg.projectOwner,
      number: cfg.projectNumber,
    });
  }
  const statusField = project.fields.nodes.find(
    (f) =>
      f.__typename === 'ProjectV2SingleSelectField' && f.name === cfg.statusFieldName,
  );
  if (!statusField || statusField.__typename !== 'ProjectV2SingleSelectField') {
    return Result.fail({ kind: 'StatusFieldNotFound', fieldName: cfg.statusFieldName });
  }
  const optionIdByName = new Map(statusField.options.map((o) => [o.name, o.id]));
  if (!optionIdByName.has(cfg.resetStateName)) {
    return Result.fail({
      kind: 'StatusOptionNotFound',
      optionName: cfg.resetStateName,
      available: [...optionIdByName.keys()],
    });
  }
  for (const term of cfg.terminalStates) {
    if (!optionIdByName.has(term)) {
      return Result.fail({
        kind: 'StatusOptionNotFound',
        optionName: term,
        available: [...optionIdByName.keys()],
      });
    }
  }
  const expectedRepo = cfg.repo;
  const item = project.items.nodes.find(
    (n) =>
      n.content !== null &&
      n.content.__typename === 'Issue' &&
      n.content.number === cfg.issueNumber &&
      n.content.repository.nameWithOwner === expectedRepo,
  );
  if (!item) {
    return Result.fail({ kind: 'ProjectItemNotFound', issueNumber: cfg.issueNumber });
  }
  return Result.succeed({
    projectId: project.id,
    fieldId: statusField.id,
    optionIdByName,
    itemId: item.id,
  });
}

// ---------- reset mutation ----------

const ResetResponseSchema = v.object({
  data: v.object({
    updateProjectV2ItemFieldValue: v.object({
      projectV2Item: v.object({ id: v.string() }),
    }),
  }),
});

const RESET_MUTATION = `
  mutation Reset($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(
      input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }
    ) {
      projectV2Item { id }
    }
  }
`;

async function resetIssueToTodo(
  token: string,
  disc: Discovered,
  resetStateName: string,
): Promise<Result.Result<void, GitHubE2EError>> {
  const optionId = disc.optionIdByName.get(resetStateName);
  if (!optionId) {
    return Result.fail({
      kind: 'StatusOptionNotFound',
      optionName: resetStateName,
      available: [...disc.optionIdByName.keys()],
    });
  }
  const r = await githubGraphql(
    token,
    RESET_MUTATION,
    {
      projectId: disc.projectId,
      itemId: disc.itemId,
      fieldId: disc.fieldId,
      optionId,
    },
    ResetResponseSchema,
  );
  if (Result.isFailure(r)) return r;
  return Result.succeed(undefined);
}

// ---------- polling ----------

const StatusResponseSchema = v.object({
  data: v.object({
    node: v.nullable(
      v.object({
        fieldValueByName: v.nullable(
          v.union([
            v.object({
              __typename: v.literal('ProjectV2ItemFieldSingleSelectValue'),
              name: v.nullable(v.string()),
            }),
            v.object({
              __typename: v.union([
                v.literal('ProjectV2ItemFieldTextValue'),
                v.literal('ProjectV2ItemFieldNumberValue'),
                v.literal('ProjectV2ItemFieldDateValue'),
                v.literal('ProjectV2ItemFieldIterationValue'),
              ]),
            }),
          ]),
        ),
      }),
    ),
  }),
});

const STATUS_QUERY = `
  query Status($itemId: ID!, $statusFieldName: String!) {
    node(id: $itemId) {
      ... on ProjectV2Item {
        fieldValueByName(name: $statusFieldName) {
          __typename
          ... on ProjectV2ItemFieldSingleSelectValue {
            name
          }
        }
      }
    }
  }
`;

function pollStatusFactory(
  token: string,
  itemId: string,
  statusFieldName: string,
  terminalStates: ReadonlySet<string>,
): () => Promise<Result.Result<{ state: string; terminal: boolean }, GitHubE2EError>> {
  return async () => {
    const r = await githubGraphql(
      token,
      STATUS_QUERY,
      { itemId, statusFieldName },
      StatusResponseSchema,
    );
    if (Result.isFailure(r)) return r;
    const fv = r.value.data.node?.fieldValueByName ?? null;
    if (!fv) {
      return Result.succeed({ state: '<unset>', terminal: false });
    }
    if (fv.__typename !== 'ProjectV2ItemFieldSingleSelectValue') {
      return Result.succeed({ state: `<${fv.__typename}>`, terminal: false });
    }
    const name = fv.name ?? '<null>';
    return Result.succeed({ state: name, terminal: terminalStates.has(name) });
  };
}

// =====================================================================
// Error rendering
// =====================================================================

function reportError(error: E2EError): number {
  switch (error.kind) {
    case 'GitHubHttpError':
      console.error(`FAIL: GitHub HTTP ${error.status}: ${error.body}`);
      return 1;
    case 'GitHubGraphQLError':
      console.error('FAIL: GitHub GraphQL errors:');
      for (const e of error.errors) console.error(`  - ${e.message}`);
      return 1;
    case 'GitHubResponseInvalid':
      console.error('FAIL: GitHub response did not match schema:');
      for (const i of error.issues) console.error(`  - ${i}`);
      return 1;
    case 'ProjectNotFound':
      console.error(`FAIL: project not found: owner=${error.owner} number=${error.number}`);
      return 1;
    case 'ProjectItemNotFound':
      console.error(`FAIL: project item for issue #${error.issueNumber} not found`);
      console.error('  (check that the issue is added to the project and assignee matches)');
      return 1;
    case 'StatusFieldNotFound':
      console.error(`FAIL: status field "${error.fieldName}" not found in project`);
      return 1;
    case 'StatusOptionNotFound':
      console.error(`FAIL: status option "${error.optionName}" not found`);
      console.error(`  available: ${error.available.join(', ')}`);
      return 1;
    default:
      return reportCommonError(error);
  }
}

// =====================================================================
// Main
// =====================================================================

async function main(): Promise<number> {
  const envResult = parseEnv();
  if (Result.isFailure(envResult)) return reportError(envResult.error);
  const env = envResult.value;

  const cfgResult = await loadConfig();
  if (Result.isFailure(cfgResult)) return reportError(cfgResult.error);
  const cfg = cfgResult.value;

  const workspaceKey = `${cfg.projectOwner}-${cfg.projectNumber}-${cfg.issueNumber}`;
  const workspacePath = path.join(cfg.workspaceRoot, workspaceKey);
  const terminalStates = new Set(cfg.terminalStates);

  const result = await Result.pipe(
    Result.succeed(undefined as void),
    Result.andThrough(() => {
      console.log('→ preflight');
      return preflight();
    }),
    Result.andThrough(() => {
      console.log(`→ clean workspace ${workspacePath}`);
      return cleanWorkspaceAt(workspacePath);
    }),
    Result.andThrough(() => {
      console.log('→ build claude-app-server');
      return buildClaudeAppServer();
    }),
    Result.andThrough(() => {
      console.log('→ build symphony');
      return buildSymphony();
    }),
    Result.andThrough(() => {
      console.log('→ install claude-app-server (pnpm dev:install)');
      return installClaudeAppServer();
    }),
    Result.andThen(() => {
      console.log(
        `→ discover GitHub project (owner=${cfg.projectOwner} number=${cfg.projectNumber} issue=#${cfg.issueNumber})`,
      );
      return discover(env.GITHUB_TOKEN, cfg);
    }),
    Result.andThrough((disc) => {
      console.log(
        `  resolved: projectId=${disc.projectId} fieldId=${disc.fieldId} itemId=${disc.itemId}`,
      );
      console.log(`→ reset issue #${cfg.issueNumber} to "${cfg.resetStateName}"`);
      return resetIssueToTodo(env.GITHUB_TOKEN, disc, cfg.resetStateName);
    }),
    Result.andThen((disc) => {
      console.log('→ run symphony until issue reaches terminal state');
      const spawnResult = spawnSymphony({
        workflowPath: cfg.workflowPath,
        tag: `${cfg.repo}#${cfg.issueNumber}`,
      });
      if (Result.isFailure(spawnResult)) return Promise.resolve(spawnResult);
      const pollStatus = pollStatusFactory(
        env.GITHUB_TOKEN,
        disc.itemId,
        cfg.statusFieldName,
        terminalStates,
      );
      return runSymphonyUntilTerminal({
        child: spawnResult.value,
        pollIntervalMs: 10_000,
        initialDelayMs: 10_000,
        timeoutMs: cfg.timeoutSeconds * 1000,
        pollStatus,
      });
    }),
    Result.andThen(() => {
      console.log('→ verify workspace');
      return verifyWorkspaceHello(workspacePath);
    }),
  );

  if (Result.isFailure(result)) return reportError(result.error);

  console.log('→ cleanup workspace (success)');
  const cleanResult = await cleanWorkspaceAt(workspacePath);
  if (Result.isFailure(cleanResult)) {
    console.warn(`  (cleanup warning: ${cleanResult.error.kind} — workspace may remain)`);
  }
  console.log('PASS');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('FAIL: unexpected exception:', err);
    process.exit(1);
  },
);
```

Note on the `workspaceKey` calculation: GitHub workspace dirs are keyed by `<owner>-<projectNumber>-<issueNumber>`. The actual branch / directory name Symphony picks is derived from `Github.Adapter.normalize_issue_node/1`; depending on that helper's output, the verify path may need adjustment. We will revisit in Task 13 if `verifyWorkspaceHello` reports `fileExists` for the wrong path. For now, use this best-guess and watch the actual workspace directory name when Symphony runs.

- [ ] **Step 2: Update `tsdown.config.ts` to include the GitHub entry**

Replace `/workspace/tsdown.config.ts` contents with:

```ts
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['scripts/e2e.claude-linear.ts', 'scripts/e2e.claude-github.ts'],
  outDir: 'scripts/dist',
  format: 'esm',
  platform: 'node',
  target: 'node20',
  dts: false,
  clean: true,
});
```

- [ ] **Step 3: Update `package.json` scripts**

In `/workspace/package.json`, replace the existing e2e scripts with:

```json
"e2e:build": "tsdown",
"e2e:claude-linear": "pnpm e2e:build && node scripts/dist/e2e.claude-linear.mjs",
"e2e:claude-github": "pnpm e2e:build && node scripts/dist/e2e.claude-github.mjs",
"e2e": "pnpm e2e:claude-linear && pnpm e2e:claude-github"
```

- [ ] **Step 4: Verify the build produces both entrypoints**

```bash
cd /workspace && pnpm e2e:build 2>&1 | tail -15
```

Expected: tsdown writes both `scripts/dist/e2e.claude-linear.mjs` and `scripts/dist/e2e.claude-github.mjs`.

```bash
cd /workspace && ls -la scripts/dist/
```

Expected: both `.mjs` files present.

- [ ] **Step 5: Smoke-test the GitHub script's env validation**

```bash
cd /workspace && unset GITHUB_TOKEN; node scripts/dist/e2e.claude-github.mjs 2>&1 | head -10
```

Expected: `FAIL: invalid config` then `GITHUB_TOKEN: GITHUB_TOKEN is required` then exit code 2.

This confirms the env / config loader is wired correctly. The full E2E run (which needs `GITHUB_TOKEN` + real repo / issue number values in `e2e.config.json`) is deferred to Task 13.

- [ ] **Step 6: Commit**

```bash
cd /workspace && git add scripts/e2e.claude-github.ts tsdown.config.ts package.json
git commit -m "$(cat <<'EOF'
feat(scripts): add e2e.claude-github.ts for automated GitHub Project E2E

GitHub Projects (v2) GraphQL でプロジェクト / Status field / option /
issue node を discovery し、Status を Todo に reset、Symphony を起動して
terminal (Done) 検出まで polling、workspace verify までを 1 スクリプトで
こなす。`pnpm e2e` は linear → github の順で両方走らせる構成に。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add ADR-0013 (tracker block split by kind)

**Files:**
- Create: `docs/adr/0013-tracker-block-split-by-kind.md`
- Modify: `docs/adr/README.md` (索引追加は Task 8 で ADR-0014 と一緒に commit する。本タスクでは新規ファイルのみ)

**Note:** ADR-0013 と ADR-0014 を別 commit にする理由は spec の作業順序で「独立 1 判断ずつ」と決めたため。README 索引更新は両 ADR が揃ったあと Task 8 で 1 度だけ行う。

- [ ] **Step 1: Create the ADR**

Write `/workspace/docs/adr/0013-tracker-block-split-by-kind.md` with:

```markdown
# 13. `tracker:` ブロックを kind 別に分割する

## ステータス

Accepted

決定日: 2026-05-14

## コンテキスト

Milestone 1 までは `tracker:` 単一ブロックに `kind` と Linear 固有設定 (`api_key` / `endpoint` / `project_slug` / `assignee`) が混在していた。Milestone 2 で GitHub Projects (v2) を追加するにあたり、kind 固有フィールド (`project_owner` / `project_number` 等) がさらに増えることが見えてきた。

Milestone 1 では既に [ADR-0004](0004-agent-type-backend-selection.md) で `agent.type` の値に応じて `claude:` / `codex:` の per-kind ブロックを切り替えるパターンを確立済み。tracker 側だけ単一ブロックに kind 別 if/else を抱えると、`agent.type` パターンとの構造的一貫性が崩れる。また、Schema validation や error メッセージが kind 横断で絡まり、レビューしづらい。

本家追従不要 ([ADR-0007](0007-no-upstream-tracking.md)) のため、本家 Symphony `SPEC.md` のスキーマと乖離する破壊的変更を許容できる。

## 決定

`tracker:` ブロックは **共通フィールドのみ** を持つ:

- `kind` (`linear` / `github` / `memory`)
- `active_states` / `terminal_states`
- `doing_state` / `done_state` (Milestone 2 Phase 3 で追加、`pickup_state` / `success_state` からリネーム)

kind 固有設定は per-kind block に分離:

- `linear:` ブロック — `api_key` / `endpoint` / `project_slug` / `assignee`
- `github:` ブロック — `api_key` / `endpoint` / `project_owner` / `project_number` / `assignee`
- `memory` — 専用ブロック不要 (テスト用)

`tracker.kind` の値で読まれるブロックを切り替える ([ADR-0004](0004-agent-type-backend-selection.md) の `agent.type` パターンと対称)。

## 結果

- **良い影響**:
  - `agent.type` パターンとの構造的一貫性が取れる
  - kind 追加時の影響範囲が明確 (新ブロック追加 + dispatch 拡張のみ)
  - Schema validation が kind ごとに分離されてレビューしやすい (`Github` / `Linear` の embed 単位)
  - Phase 3 で追加した `doing_state` / `done_state` のような「tracker 共通」フィールドの居場所が自然に決まる
- **悪い影響 / トレードオフ**:
  - 既存 WORKFLOW.md (`workflow.claude.md` 等) を破壊的に sweep する必要があった (Milestone 2 Phase 1 で完了)
  - 本家 Symphony `SPEC.md` のスキーマと乖離 ([ADR-0007](0007-no-upstream-tracking.md) 方針なので許容)
- **影響範囲**:
  - `apps/symphony/lib/symphony_elixir/config/schema.ex` (`Tracker` embed の縮小、`Linear` / `Github` 新規 embed)
  - `apps/symphony/examples/workflow.*.md` (全 sample)
  - `apps/symphony/WORKFLOW.md`
  - `docs/architecture.md` / `docs/protocol.md` / 両 `CLAUDE.md`
```

- [ ] **Step 2: Verify rendering (cursory)**

```bash
cd /workspace && head -5 docs/adr/0013-tracker-block-split-by-kind.md
```

Expected: shows `# 13. tracker: ブロックを kind 別に分割する` as the first non-empty line.

- [ ] **Step 3: Commit**

```bash
cd /workspace && git add docs/adr/0013-tracker-block-split-by-kind.md
git commit -m "$(cat <<'EOF'
docs(adr): add ADR-0013 tracker block split by kind

Milestone 2 Phase 1 の事後ドキュメント化。`tracker:` 共通フィールド +
`linear:` / `github:` per-kind block の設計判断を `agent.type`
(ADR-0004) との対称性で記録。索引追加は ADR-0014 と一緒に Task 8 で。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Add ADR-0014 (Symphony-owned state transitions)

**Files:**
- Create: `docs/adr/0014-symphony-owned-state-transitions.md`

- [ ] **Step 1: Create the ADR**

Write `/workspace/docs/adr/0014-symphony-owned-state-transitions.md` with:

```markdown
# 14. state transition を Symphony 側に集約する

## ステータス

Accepted

決定日: 2026-05-15

## コンテキスト

本家 Symphony は backend (Codex) に `linear_graphql` 動的ツールを供給し、LLM がプロンプト指示に従って `issueUpdate` mutation を発行する設計だった。Milestone 1 の Claude backend 移植時点では、Claude 側でも同等のプロンプト (curl で issueUpdate を叩く手順) を埋め込む方式を踏襲していた。

Milestone 2 で GitHub Projects (v2) 対応を進めるにあたり、この方式は次の問題を抱えるようになった:

- backend ごとに Linear / GitHub 両 API クライアントを抱えるのは非合理 (`claude-app-server` には MCP 動的ツール機構が未実装)
- LLM が状態遷移を忘れる / 誤遷移するリスク
- 状態遷移ごとに LLM プロンプトに API 手順を埋め込むことで毎回トークンを消費
- GitHub Projects (v2) は Project / Field / Option / Item の id 解決が必要で、prompt に埋め込むには重い

## 決定

WORKFLOW.md に `tracker.doing_state` / `tracker.done_state` が指定されている場合、**Symphony orchestrator が `Tracker.update_issue_state/2` で直接 mutation する** ([ADR-0013](0013-tracker-block-split-by-kind.md) の共通フィールドに位置づけ)。

発火タイミング:

- **doing**: `spawn_issue_on_worker_host` で worker spawn が `{:ok, pid}` を返した直後
- **done**: `:DOWN reason == :normal` 受信 AND `last_codex_event == :turn_completed` AND refresh 後 issue が active states に居ない (三条件 AND)

mutation 失敗時は 3 試行 retry (250ms / 1s backoff) の後に warning ログのみで継続 (best-effort)。`doing_state` / `done_state` 未設定なら完全 no-op (本家 Symphony との後方互換維持、Linear ユーザの prompt 方式運用も継続可能)。

`linear_graphql` 動的ツールは legacy 経路として当面残す (M3 以降で議論)。LLM が prompt 指示通り先に Linear API を叩いた場合も、Symphony 側は refresh で current_state を取得して idempotent no-op になる。

詳細設計: [`docs/superpowers/specs/2026-05-15-m2-phase3-design.md`](../superpowers/specs/2026-05-15-m2-phase3-design.md)

## 結果

- **良い影響**:
  - LLM トークン削減 (状態遷移指示をプロンプトから削除可能)
  - 責務の明確化 (LLM = コード実装、Symphony = issue 操作)
  - 遷移忘れ・誤遷移リスクの排除
  - backend ごとの tracker クライアント実装が不要 (`claude-app-server` に MCP 動的ツールを後付けせずに GitHub 対応可能)
  - tracker kind 切替時、prompt の書き換えが不要になる
- **悪い影響 / トレードオフ**:
  - 「LLM が自律的に判断して状態を変える」ユースケース (例: 実装不能と判断して別ラベル付与) は backend 側で別途仕組みが必要
  - mutation 失敗時の recovery は best-effort (warning ログのみ)。起動時 sweep / polling 補正 / 失敗時コメントは M3 以降に送る
  - `linear_graphql` 経路と Symphony 経路の二重化が当面続く (M3 で legacy 撤去判断)
- **影響範囲**:
  - `apps/symphony/lib/symphony_elixir/orchestrator.ex` (`maybe_doing_transition/1` / `handle_backend_finished/2` / `attempt_done_transition/2` / `tracker_update_with_retry/2`)
  - `apps/symphony/lib/symphony_elixir/config/schema.ex` (`Tracker` embed の `doing_state` / `done_state`)
  - `apps/symphony/examples/workflow.claude-github.md` (Symphony 経路、curl 手順なし)
  - `docs/protocol.md` (`linear_graphql` 言及箇所に legacy 注記)
  - tracker mutation の責務に関わる将来判断
```

- [ ] **Step 2: Commit**

```bash
cd /workspace && git add docs/adr/0014-symphony-owned-state-transitions.md
git commit -m "$(cat <<'EOF'
docs(adr): add ADR-0014 Symphony-owned state transitions

Milestone 2 Phase 3 の事後ドキュメント化。`tracker.doing_state` /
`tracker.done_state` 経由の自動遷移、3 条件 AND の done 判定、
linear_graphql との後方互換維持の判断を記録。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Update `docs/adr/README.md` index

**Files:**
- Modify: `docs/adr/README.md`

- [ ] **Step 1: Add two index rows**

In `/workspace/docs/adr/README.md`, locate the table that ends with the `ADR-0012` row. Append exactly two new rows so the table ends:

```
| [ADR-0012](0012-adr-format.md) | ADR は Michael Nygard 形式・`docs/adr/` 配下で管理する | Accepted |
| [ADR-0013](0013-tracker-block-split-by-kind.md) | `tracker:` ブロックを kind 別に分割する | Accepted |
| [ADR-0014](0014-symphony-owned-state-transitions.md) | state transition を Symphony 側に集約する | Accepted |
```

Use Edit to insert exactly the two new lines after the ADR-0012 row. Don't reformat the rest of the file.

- [ ] **Step 2: Commit**

```bash
cd /workspace && git add docs/adr/README.md
git commit -m "$(cat <<'EOF'
docs(adr): add ADR-0013 and ADR-0014 to index

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Sweep root docs for GitHub support (README / architecture / protocol / root CLAUDE.md)

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/protocol.md`
- Modify: `CLAUDE.md`

**Important:** don't introduce new sections; modify existing prose minimally. Each edit should be the smallest change that reflects the new tracker.kind / doing_state / done_state reality. Frozen records remain frozen.

- [ ] **Step 1: README sweep**

In `/workspace/README.md`, edit only the lines listed below; leave the rest of the file alone.

- L46-50 (Milestone 2 section): change `**Milestone 2（次の予定）**: GitHub Project 対応` to:

  ```markdown
  **Milestone 2（完了、2026-05-15）**: GitHub Project 対応

  - WORKFLOW.md `tracker.kind` で Linear / GitHub Projects (v2) を切り替え可能 ([ADR-0013](docs/adr/0013-tracker-block-split-by-kind.md))
  - state 遷移は Symphony が `tracker.doing_state` / `tracker.done_state` を使って自動発火 ([ADR-0014](docs/adr/0014-symphony-owned-state-transitions.md))
  - 実 GitHub Project での E2E が PASS（詳細は [`docs/milestones/02-github-tracker.md`](docs/milestones/02-github-tracker.md)）
  ```

  Then change the next paragraph (around L51) from `state 別 backend 切替・passthrough 機構などの高度な機能は **Milestone 3 以降**` to remain as-is.

- L55-60 (必要なもの section): add a line for `GITHUB_TOKEN` after `LINEAR_API_KEY`:

  ```markdown
  - **Linear API key** — `LINEAR_API_KEY` 環境変数にセット (Linear tracker を使う場合)
  - **GitHub Personal Access Token** — `GITHUB_TOKEN` 環境変数にセット。classic PAT (`ghp_...`) を `repo` + `project` scope で発行 (GitHub Projects v2 を使う場合)
  ```

  (Replace the existing `Linear API key` bullet with both.)

- L73 (Quick-start step 3 comment block): change

  ```
  # 3. WORKFLOW.md を用意（apps/symphony/examples/workflow.claude-linear.md を参考に）
  #    - tracker.project_slug を Linear のテストプロジェクトに合わせる
  ```

  to:

  ```
  # 3. WORKFLOW.md を用意（apps/symphony/examples/workflow.claude-linear.md または
  #    workflow.claude-github.md を参考に）
  #    - Linear なら linear.project_slug をテストプロジェクトに合わせる
  #    - GitHub なら github.project_owner / project_number を合わせる
  ```

- L79: already updated in Task 1 (no-op confirmation).

- L82 (E2E 言及): change

  ```
  E2E テスト（`tmp/hello.js` を作って実行確認するシナリオ）は [`docs/e2e_testing.md`](docs/e2e_testing.md) を参照。`pnpm e2e` (→ `scripts/e2e.ts`) で自動化されています。
  ```

  to:

  ```
  E2E テスト（`tmp/hello.js` を作って実行確認するシナリオ）は [`docs/e2e_testing.md`](docs/e2e_testing.md) を参照。Linear / GitHub 両 tracker 向けに `pnpm e2e:claude-linear` / `pnpm e2e:claude-github` を用意しており、`pnpm e2e` で両方順番に走ります。test issue 設定は `scripts/e2e.config.json` に置きます (PAT / API key は env のまま)。
  ```

- [ ] **Step 2: docs/architecture.md sweep**

In `/workspace/docs/architecture.md`:

- L9 周辺 (序文): change `(Linear ボードを駆動する Codex 専用オーケストレーター)` to `(issue tracker を駆動する Codex / Claude オーケストレーター)` (削除 + 1 ステップ表現で `Linear ボードを駆動する` を `issue tracker (Linear / GitHub Projects) を駆動する` に)
- L21 (アプリ表): change `tracker（Linear）` to `tracker (Linear / GitHub Projects)`
- L32 周辺 (構成図 ASCII art): change `Linear (issue tracker)` to `Tracker (Linear / GitHub Projects)`
- L160 周辺 (`linear_graphql` 動的ツールの説明): append a sentence:

  ```
  なお Milestone 2 Phase 3 以降、Symphony は `tracker.doing_state` / `tracker.done_state` 設定時に自動で issue 状態を更新する ([ADR-0014](adr/0014-symphony-owned-state-transitions.md))。動的ツール経路は本家 Symphony 互換のための legacy として残しているが、新規 backend (claude-app-server) は実装していない。
  ```

  Place the sentence as a paragraph immediately after the existing `linear_graphql` description.

- [ ] **Step 3: docs/protocol.md sweep**

In `/workspace/docs/protocol.md`, locate each of L302 / L391 / L397 / L540 / L543 (or their current locations — content may have shifted) where `linear_graphql` is mentioned. Add a one-paragraph legacy note **once** at the top of §5.4 (or whichever section first introduces dynamic tools):

```markdown
> 注意 (M2 Phase 3 以降): Symphony は `tracker.doing_state` / `tracker.done_state` 設定時に自動で issue 状態を更新する ([ADR-0014](adr/0014-symphony-owned-state-transitions.md))。動的ツール経路 (`linear_graphql` 等) は本家 Symphony 互換のための legacy として残しているが、`claude-app-server` は MCP 動的ツール機構を実装していないため Claude backend では機能しない。
```

Do not delete or restructure the existing `linear_graphql` descriptions; the legacy note suffices.

- [ ] **Step 4: Root CLAUDE.md sweep**

In `/workspace/CLAUDE.md`, locate the section titled "**両アプリにまたがる仕様（凍結事項）**" → "**WORKFLOW.md スキーマ**". Confirm whether `tracker.kind` and per-kind block are already described. If yes, append a paragraph mentioning `doing_state` / `done_state`:

```markdown
- **tracker.kind と per-kind block** ([ADR-0013](docs/adr/0013-tracker-block-split-by-kind.md)): `tracker:` は共通フィールドのみ (`kind` / `active_states` / `terminal_states` / `doing_state` / `done_state`)、kind 固有設定は `linear:` / `github:` ブロックに分離。
- **state 遷移は Symphony 主導** ([ADR-0014](docs/adr/0014-symphony-owned-state-transitions.md)): `tracker.doing_state` / `tracker.done_state` 設定時、orchestrator が `Tracker.update_issue_state/2` で直接 mutation する。未設定なら no-op (Linear の prompt 方式運用とも互換)。
```

If neither bullet is already there, insert them as new bullets in the appropriate location. If the file already has equivalent prose, just adjust references to point at the ADRs.

- [ ] **Step 5: Verify nothing broke**

```bash
cd /workspace && rg -n "Linear ボードを駆動する" -- 'docs/' 'README.md' 'CLAUDE.md' 2>&1
```

Expected: no hits (this phrasing has been swept).

```bash
cd /workspace && rg -n "tracker（Linear）|Linear \(issue tracker\)" -- 'docs/architecture.md' 2>&1
```

Expected: no hits.

- [ ] **Step 6: Commit**

```bash
cd /workspace && git add README.md docs/architecture.md docs/protocol.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: sweep README / architecture / protocol / root CLAUDE.md for GitHub support

Milestone 2 完了に伴い、Linear 前提だった表現を tracker 抽象化に
書き換え。linear_graphql 動的ツールには legacy 注記を追加し、
ADR-0013 / ADR-0014 へのリンクを張る。frozen records は触らない。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Sweep `apps/symphony/CLAUDE.md` and `docs/e2e_testing.md` for GitHub E2E flow

**Files:**
- Modify: `apps/symphony/CLAUDE.md`
- Modify: `docs/e2e_testing.md`

**Note:** Task 1 already swept `workflow.claude.md` → `workflow.claude-linear.md` in these files. This task adds the GitHub flow descriptions.

- [ ] **Step 1: apps/symphony/CLAUDE.md updates**

In `/workspace/apps/symphony/CLAUDE.md`, locate the section "**tracker.kind と per-kind ブロック**" (around L21). Update the `kind: github` description:

- Change `adapter 実装は Milestone 2 Phase 2 で対応` to `adapter 実装は `Github.Adapter` (Milestone 2 Phase 2 完了)`.

Then locate the Milestone 1 section header (around L96). After the Milestone 1 description block ends, add a brief "Milestone 2 完了" reference:

```markdown
### Milestone 2 完了 (2026-05-15)

GitHub Projects (v2) を tracker として扱えるように対応。詳細は [`../docs/milestones/02-github-tracker.md`](../../docs/milestones/02-github-tracker.md)。 サンプル設定: [`examples/workflow.claude-github.md`](examples/workflow.claude-github.md)。
```

Place it after the existing Milestone 1 paragraph and before the "Phase 1" subheadings, so it serves as a forward-looking marker without disturbing the Phase 1 / Phase 2 task tracking.

- [ ] **Step 2: docs/e2e_testing.md updates**

In `/workspace/docs/e2e_testing.md`:

- Change the top-level goal sentence (L3) to mention both trackers:

  Before:
  > `concert` モノレポの受け入れテスト（End-to-End）手順。Milestone 1 のゴールは **`examples/workflow.claude-linear.md` で Linear issue 1件が claude-app-server 経由で処理される** こと。

  After:
  > `concert` モノレポの受け入れテスト（End-to-End）手順。Linear および GitHub Projects (v2) 両 tracker について、`examples/workflow.claude-linear.md` / `examples/workflow.claude-github.md` の issue 1 件が `claude-app-server` 経由で処理されることを確認する。

- Replace the env-vars section (around L163) that lists `E2E_LINEAR_*` env vars with a config.json description:

  Before (illustrative; actual content may differ):
  ```
  | `E2E_WORKFLOW_PATH` | 省略可 | `apps/symphony/examples/workflow.claude-linear.md` | Symphony に渡す workflow ファイルパス（リポジトリルートからの相対パス） |
  ```

  After: replace the whole env-var table with two sub-sections:

  ```markdown
  #### 環境変数 (シークレット)

  | 変数 | 必須 | 説明 |
  |---|---|---|
  | `LINEAR_API_KEY` | Linear E2E のみ必須 | Linear API key |
  | `GITHUB_TOKEN` | GitHub E2E のみ必須 | classic PAT (`ghp_...`、`repo` + `project` scope) |

  #### `scripts/e2e.config.json` (non-secret 設定)

  - `linear.issueKey` / `linear.resetStateName` / `linear.workflowPath` / `linear.workspaceRoot` / `linear.timeoutSeconds` / `linear.terminalStates`
  - `github.projectOwner` / `github.projectNumber` / `github.repo` / `github.issueNumber` / `github.resetStateName` / `github.statusFieldName` / `github.workflowPath` / `github.workspaceRoot` / `github.timeoutSeconds` / `github.terminalStates`

  PAT / API key 以外は全部このファイルにコミットして OK。
  ```

- Add a new "GitHub E2E の事前準備" section near the existing Linear setup section:

  ```markdown
  ### GitHub E2E の事前準備

  1. classic PAT (`ghp_...`) を `repo` + `project` scope で発行し、`GITHUB_TOKEN` env にセット。fine-grained PAT は user-owned ProjectV2 に未対応 (GitHub の既知制限)。
  2. test repository に test issue を 1 件作成。description には Linear 版と同じく「Create a file at `tmp/hello.js` that prints `Hello, World!` when run with `node`. Commit the change.」のような実装可能なタスクを書く。
  3. test Project (Projects v2) に issue を Items として追加。
  4. Project の Status field option (`Todo` / `In Progress` / `Done`) が `e2e.config.json` の `github.resetStateName` / `github.terminalStates` と一致しているか確認。
  5. issue の assignee を PAT 所有者にセット。`workflow.claude-github.md` の `github.assignee: me` が有効になる条件。
  6. `scripts/e2e.config.json` の `github.repo` / `github.issueNumber` を実値で埋める。
  ```

- Update the `pnpm e2e` invocation example (around L197) to call out both scripts:

  ```markdown
  # 個別: Linear E2E のみ
  pnpm e2e:claude-linear

  # 個別: GitHub E2E のみ
  pnpm e2e:claude-github

  # 両方順番 (`pnpm test` と同パターン)
  pnpm e2e
  ```

- [ ] **Step 3: Verify there are no remaining `E2E_LINEAR_*` env-var references in live docs**

```bash
cd /workspace && rg -n "E2E_LINEAR_\|E2E_WORKFLOW_PATH\|E2E_WORKSPACE_ROOT\|E2E_TIMEOUT_SECONDS" -- 'docs/' 'README.md' 'CLAUDE.md' 'apps/symphony/CLAUDE.md' 'apps/symphony/README.md' 2>&1
```

Expected: no hits.

- [ ] **Step 4: Commit**

```bash
cd /workspace && git add apps/symphony/CLAUDE.md docs/e2e_testing.md
git commit -m "$(cat <<'EOF'
docs(e2e): document GitHub E2E preparation and new pnpm e2e scripts

apps/symphony/CLAUDE.md には Milestone 2 完了マーカーと GitHub adapter
実装済み旨を追記。docs/e2e_testing.md は env-var 表を config.json
ベースに置き換え、GitHub E2E の事前準備手順を新設し、pnpm e2e:* の
使い分けを明示。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Create `docs/milestones/02-github-tracker.md` scaffolding

**Files:**
- Create: `docs/milestones/02-github-tracker.md`

**Note:** E2E execution log fields are placeholders here. Task 14 fills them in after the real run.

- [ ] **Step 1: Resolve Phase 1 / 2 / 3 merge commits**

```bash
cd /workspace && git log --oneline --merges 2>&1 | head -10
```

Note the merge commit SHAs (short) for `feat/m2-phase1` / `feat/m2-phase2` / `feat/m2-phase3` to embed in the milestone doc. From the head of this conversation the Phase 3 merge is `bf2cbf7`. Confirm Phase 1 / 2 merges by inspecting recent git log entries.

- [ ] **Step 2: Write the milestone doc**

Create `/workspace/docs/milestones/02-github-tracker.md`. Use the structure below; replace `<P1-SHA>` / `<P2-SHA>` with the actual merge commit short SHAs from Step 1, and leave the Phase 4 / E2E placeholders as-is (Task 14 fills them).

```markdown
# Milestone 2: GitHub Project 対応

**ステータス:** 完了 (YYYY-MM-DD)  ← Task 14 で確定

WORKFLOW.md の `tracker.kind` で Linear / GitHub Projects (v2) を切り替えられる状態をゴールとしたマイルストーン。実 GitHub Project (`babie` / Project #3) を使った自動 E2E (`pnpm e2e:claude-github`) が PASS した時点で完了とした。

> このファイルは完了済みマイルストーンの記録。進行中・将来のタスクは [`TODO.md`](../../TODO.md) 参照。

---

## 横断する設計指針 (Milestone 2 時点での凍結事項)

- `tracker.kind` で per-kind block 切替 ([ADR-0013](../adr/0013-tracker-block-split-by-kind.md))
- state mutation は Symphony が担当 ([ADR-0014](../adr/0014-symphony-owned-state-transitions.md))
- GitHub Adapter は Linear adapter のミラー (Octokit 非依存、生 GraphQL POST)
- PAT 認証のみ (env `GITHUB_TOKEN` + `github.api_key` フォールバック)

---

## Phase 1: tracker スキーマの kind 別分割

**完了 (2026-05-14、merge commit `<P1-SHA>`).** spec: [`2026-05-14-m2-phase1-design.md`](../superpowers/specs/2026-05-14-m2-phase1-design.md)

- [x] `config/schema.ex` の Tracker embed を縮小 (kind / active_states / terminal_states / doing_state / done_state)
- [x] 新規 Linear embed (既存フィールドを移動)
- [x] 新規 Github embed (フィールド宣言のみ、実体は Phase 2)
- [x] Cross-field validation の kind 別実装
- [x] 既存 example / fixture WORKFLOW.md を新形式に sweep
- [x] doc 系 (`docs/architecture.md` / `docs/protocol.md` / ルート `CLAUDE.md`) のスキーマ例を新形式に
- [x] 既存 Linear 経路のテストが緑のまま通る

---

## Phase 2: GitHub Adapter 実装

**完了 (2026-05-14、merge commit `<P2-SHA>`).** spec: [`2026-05-14-m2-phase2-design.md`](../superpowers/specs/2026-05-14-m2-phase2-design.md)

- [x] `github/client.ex` + Req.Test ベースのテスト
- [x] `github/issue.ex` / `github/queries.ex`
- [x] `github/project_meta.ex` (`:persistent_term` キャッシュ、Status field option name→id 解決)
- [x] `github/adapter.ex` (Tracker 5 callback、Req.Test で検証)
- [x] `tracker.ex` adapter dispatch に `"github"` を追加
- [x] 起動時 validation: `doing_state` / `done_state` が Status option として実在することを確認
- [x] `iex` で `Tracker.fetch_candidate_issues/0` 等が動く (2026-05-14 実機検証済、[`docs/superpowers/plans/2026-05-14-m2-phase2-github-adapter.md`](../superpowers/plans/2026-05-14-m2-phase2-github-adapter.md) 末尾参照)

---

## Phase 3: Orchestrator 連携 + 自動遷移

**完了 (2026-05-15、merge commit bf2cbf7).** spec: [`2026-05-15-m2-phase3-design.md`](../superpowers/specs/2026-05-15-m2-phase3-design.md)

- [x] `maybe_doing_transition/1` を `spawn_issue_on_worker_host` で呼ぶ
- [x] `handle_backend_finished/2` で `turn/completed` + subprocess exit 統合判定して `maybe_done_transition/1` を呼ぶ
- [x] MockTrackerAdapter ベースの結合テストで遷移呼び出しを検証 (orchestrator_doing/done_transition_test.exs)
- [x] 異常系 (exit != 0、status: failed、network 失敗) の no-op をテスト

---

## Phase 4: 実機 E2E + ドキュメント整備

**完了 (YYYY-MM-DD、merge commit ...).** spec: [`2026-05-15-m2-phase4-design.md`](../superpowers/specs/2026-05-15-m2-phase4-design.md)

- [x] `examples/workflow.claude-github.md` 整備
- [x] 既存 `workflow.claude.md` → `workflow.claude-linear.md` リネーム
- [x] `scripts/e2e.claude-github.ts` + `scripts/lib/e2e-common.ts` + `scripts/e2e.config.json` 新規
- [x] `scripts/e2e.ts` → `scripts/e2e.claude-linear.ts` リネーム + 共通部分抽出
- [x] `package.json` の `e2e:*` script 整備
- [x] ADR-0013 / ADR-0014 執筆
- [x] README.md / docs/architecture.md / docs/protocol.md / 両 CLAUDE.md / docs/e2e_testing.md sweep
- [x] 実機 E2E PASS (`pnpm e2e:claude-github`、Todo → In Progress → Done 自動遷移確認)
- [x] TODO.md の M3 派生課題反映 (L134 / L142 削除)

### 実機 E2E 実行ログ

(Task 14 で埋める。プレースホルダ:)

- 対象: `<owner>/<repo>` の Project #N、issue #X (`<title>`)
- コマンド: `pnpm e2e:claude-github`
- 観測:
  - discovery query で projectId / fieldId / Todo optionId / itemId 解決
  - reset mutation で Status を Todo に
  - Symphony 起動後、Status: Todo → In Progress (Symphony が `updateProjectV2ItemFieldValue` 発火)
  - workspace `/tmp/concert-e2e-github/workspaces/<key>` で `tmp/hello.js` 作成 + commit
  - `turn/completed` 受信後、Status: In Progress → Done (Symphony が同 mutation)
  - `verifyWorkspaceHello` で `node tmp/hello.js` の出力確認 PASS
  - スクリプト exit code 0
- 所要時間: 約 X 分

---

## Milestone 2 完了条件

- [x] Phase 1〜4 完了
- [x] `mix test` 全緑 (Phase 3 時点 240+ tests, 0 failures, 2 skipped)
- [x] 実 GitHub Project で issue 処理が動く (`pnpm e2e:claude-github` exit 0)
- [x] ADR-0013 / ADR-0014 起票済み

---

## Milestone 3 以降に送った課題

- 起動時 sweep / polling 補正 / 失敗時コメント ([Phase 3 spec](../superpowers/specs/2026-05-15-m2-phase3-design.md) の Recovery 境界)
- 複数 repo を 1 Project に紐づける運用ノウハウ (TODO.md の M3 派生課題)
- GitHub App 認証 (PAT は M2 のみ、長期運用には App)
- `github_graphql` 動的ツール (`claude-app-server` の MCP 動的ツール提供を実装し、Linear 同様 backend から叩けるように)
- PR-based 完了検知 (Issue が PR にリンクされ PR が merge されたら自動 Done)
- M3 以降の詳細は [`TODO.md`](../../TODO.md) を参照
```

- [ ] **Step 3: Commit**

```bash
cd /workspace && git add docs/milestones/02-github-tracker.md
git commit -m "$(cat <<'EOF'
docs(milestones): create 02-github-tracker.md scaffolding

Phase 1〜3 の完了マーカー + Phase 4 のチェックリストを書き起こす。
Phase 4 実機 E2E 実行ログとマージ日付は Task 14 で埋める。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Update `TODO.md` for Phase 4 completion and M3 follow-ups

**Files:**
- Modify: `TODO.md`

- [ ] **Step 1: Tick Phase 4 checklist**

In `/workspace/TODO.md`, locate the "### Phase 4: 実機 E2E + ドキュメント整備" section (around L57). Set the spec line to:

```markdown
spec: [`docs/superpowers/specs/2026-05-15-m2-phase4-design.md`](docs/superpowers/specs/2026-05-15-m2-phase4-design.md)
```

Then mark all Phase 4 checklist items `[x]`:

```markdown
- [x] `examples/workflow.claude-github.md` を整備
- [x] テスト用 GitHub Project + repo + issue を用意 (`scripts/e2e.config.json` に固定)
- [x] 自動 E2E (`pnpm e2e:claude-github` で Todo → In Progress → Done)
- [x] ADR-0013 (tracker ブロック分割) 執筆
- [x] ADR-0014 (Symphony が state transition を担当する選択) 執筆
- [x] `README.md` / `docs/architecture.md` / `docs/protocol.md` / `CLAUDE.md` の最終 sweep
- [x] `docs/milestones/02-github-tracker.md` 作成、M2 完了マーク
- [x] M3 以降に送る課題を `TODO.md` Milestone 3 以降に反映（複数 repo / GitHub App / `github_graphql` 動的ツール / 失敗時 comment / max_attempts / PR-based 完了検知）
```

(Phase 4 originally had a "手動実機 E2E" item — replace with the automated phrasing above.)

- [ ] **Step 2: Add a M2 closing line**

Immediately after the Phase 4 block (and before the `---` divider that ends Milestone 2), insert:

```markdown
---

**Milestone 2 完了 (YYYY-MM-DD):** 詳細は [`docs/milestones/02-github-tracker.md`](docs/milestones/02-github-tracker.md) を参照。Task 14 で YYYY-MM-DD を確定。
```

The YYYY-MM-DD placeholder is filled by Task 14.

- [ ] **Step 3: Remove resolved derived-issue lines**

In `/workspace/TODO.md` around L132〜L142 ("GitHub Adapter 派生課題（M2 Phase 2 完了後の宿題）" section):

- Delete the bullet that mentions `fine-grained PAT は user-owned ProjectV2 非対応` がドキュメント化されたことを示すため (L134) — the documentation is now in `workflow.claude-github.md` and `docs/e2e_testing.md`.
- Delete the bullet that mentions `E2E 自動化（現状は手動 iex、scripts/e2e.ts から GitHub 経路もカバー）` (L142) — now satisfied by `e2e.claude-github.ts`.
- Keep the rest of the bullets (assignee: me 運用ノウハウ, normalize_issue_node helper 統合, 複数 repo, GitHub App, github_graphql 動的ツール, 失敗時 comment / max_attempts, PR-based 完了検知).

- [ ] **Step 4: Verify TODO.md is internally consistent**

```bash
cd /workspace && rg -n "fine-grained PAT\|E2E 自動化\|Phase 4" -- 'TODO.md' 2>&1 | head -20
```

Expected: no hits for `fine-grained PAT` or the removed E2E line; Phase 4 references are still present (Phase 4 section header etc.).

- [ ] **Step 5: Commit**

```bash
cd /workspace && git add TODO.md
git commit -m "$(cat <<'EOF'
chore(repo): mark M2 Phase 4 complete and queue M3 follow-ups

Phase 4 全項目 [x]、Milestone 2 全体に完了マーカー (日付は Task 14 で確定)。
派生課題セクションから fine-grained PAT のドキュメント化 (Phase 4 で対応済) と
E2E 自動化 (e2e.claude-github.ts で対応済) を削除。残りは M3 に持ち越し。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Run the real GitHub E2E and iterate until it passes

**Files:** none (interactive). User-driven step with assistant support.

**Goal:** `pnpm e2e:claude-github` exits 0. Any bug found during this run is fixed on the same branch with appropriate commits before Task 14.

- [ ] **Step 1: User fills in `scripts/e2e.config.json` GitHub placeholders**

Ask the user for:
- `github.repo` (the `owner/name` of the repo containing the test issue)
- `github.issueNumber` (the issue number in that repo)

Edit `scripts/e2e.config.json` with the actual values:

```json
"repo": "babie/<actual-repo>",
"issueNumber": <N>,
```

If `e2e.config.json` differs from the committed version, commit the change:

```bash
cd /workspace && git add scripts/e2e.config.json
git commit -m "$(cat <<'EOF'
chore(scripts): set actual GitHub E2E repo and issue number

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If the placeholder values were already correct (unlikely), skip the commit.

- [ ] **Step 2: User sets `GITHUB_TOKEN` env var in the container shell**

Ask the user how their `GITHUB_TOKEN` is provided to the container (direnv `.env.local`, devcontainer env, manual `export`). Confirm `echo $GITHUB_TOKEN | wc -c` returns a non-trivial length (e.g., > 30) without leaking the value.

- [ ] **Step 3: Run the E2E**

```bash
cd /workspace && pnpm e2e:claude-github 2>&1 | tee /tmp/e2e-github-run.log
```

Expected on success:
- preflight passes
- discovery prints `projectId=PVT_... fieldId=PVTSSF_... itemId=PVTI_...`
- reset succeeds
- polling shows `status="Todo"` → `status="In Progress"` → `issue reached "Done"`
- verify passes
- `PASS` printed, exit 0

- [ ] **Step 4: If the run fails, classify the failure**

Read the stderr / `/tmp/e2e-github-run.log` to determine the failure mode:

| Symptom | Likely cause | Fix |
|---|---|---|
| `FAIL: invalid config` with `github.repo` schema error | Placeholder not filled | Re-edit `scripts/e2e.config.json` |
| `GitHubHttpError 401` | PAT invalid or missing scope | User re-issues PAT, re-export `GITHUB_TOKEN` |
| `ProjectNotFound` | `projectOwner` or `projectNumber` wrong, or PAT scope missing `project` | Verify with `gh project list --owner babie` or similar |
| `ProjectItemNotFound` | Issue not added to project, or wrong issue number, or wrong repo | Add the issue to project in GitHub UI, or correct config |
| `StatusFieldNotFound` / `StatusOptionNotFound` | Project field name differs from config (`statusFieldName` / `resetStateName`) | Update config to match Project setup, or adjust Project Status options |
| `SymphonyTimedOut` | Symphony took longer than `timeoutSeconds`. Check `scripts/e2e.symphony.log` for the actual progression | Either bump timeout in config, or investigate Symphony logs for a hang |
| `VerifyFailed fileExists` with wrong path | Workspace key mismatch — `e2e.claude-github.ts` computes `${projectOwner}-${projectNumber}-${issueNumber}` but Symphony's branch is derived from `Github.Adapter.normalize_issue_node`. | Inspect actual workspace dir (`ls /tmp/concert-e2e-github/workspaces/`) and adjust `workspaceKey` formula in `scripts/e2e.claude-github.ts` to match |
| Anything else | Read symphony log, classify, ask user if unclear | — |

Fix the underlying issue, commit if it's a code/config change, re-run from Step 3. Repeat until PASS.

- [ ] **Step 5: When PASS, capture key facts for the milestone doc**

Record:
- Date of the successful run (UTC; equals the `YYYY-MM-DD` placeholder)
- `owner/repo`, issue number, issue title
- Exact `pnpm e2e:claude-github` invocation
- discovery output line (projectId / fieldId / itemId)
- Status transitions observed (timestamps if convenient)
- workspace path used + presence of `tmp/hello.js` + commit SHA
- Total run duration (approx)

Put them aside for Task 14.

- [ ] **Step 6: (Optional) Run Linear regression**

If the user wants to confirm no regression in the Linear path:

```bash
cd /workspace && pnpm e2e:claude-linear 2>&1 | tail -20
```

Expected: `PASS`. If it fails, fix on this branch (likely env-var / config migration issues from Task 4).

This step is optional — Phase 4 cleared Phase 4 by the GitHub E2E. Linear is unchanged behaviour, but a smoke run reassures.

---

## Task 14: Record E2E results and close Milestone 2

**Files:**
- Modify: `docs/milestones/02-github-tracker.md`
- Modify: `TODO.md` (date placeholder)

- [ ] **Step 1: Fill in `docs/milestones/02-github-tracker.md`**

Replace the `YYYY-MM-DD` placeholder at the top (status line and Phase 4 header) with the date of the successful E2E run. Also replace `merge commit ...` for Phase 4 with `merge commit <to be set after squash/merge>` — or leave as `(determined at merge)` if the branch is still being reviewed.

Fill in the "実機 E2E 実行ログ" section with the captured facts from Task 13 Step 5. Replace each placeholder (`<owner>/<repo>`, `#X`, `<title>`, `<key>`, `X 分`) with actual values.

If a non-trivial code-change commit landed in this branch as part of Task 13 (e.g., workspaceKey formula adjustment), reference it briefly in the notes.

- [ ] **Step 2: Update `TODO.md` closing date**

Edit the line added in Task 12 Step 2:

```markdown
**Milestone 2 完了 (YYYY-MM-DD):** 詳細は ...
```

Replace `YYYY-MM-DD` with the actual completion date.

- [ ] **Step 3: Sanity check the branch**

```bash
cd /workspace && git status --short
```

Expected: only `docs/milestones/02-github-tracker.md` and `TODO.md` modified.

```bash
cd /workspace && git log --oneline main..feat/m2-phase4 2>&1
```

Expected: 12+ commits on the branch (Tasks 1–13), in the order matching the spec.

- [ ] **Step 4: Final regression check**

```bash
cd /workspace/apps/symphony && mix test 2>&1 | tail -5
```

Expected: identical pass count to pre-Phase-4 baseline (240+ tests, 0 failures, 2 skipped).

```bash
cd /workspace && pnpm test:claude-app-server 2>&1 | tail -5
```

Expected: same pass count as baseline.

```bash
cd /workspace && pnpm e2e:build 2>&1 | tail -3
```

Expected: build succeeds.

- [ ] **Step 5: Commit milestone close**

```bash
cd /workspace && git add docs/milestones/02-github-tracker.md TODO.md
git commit -m "$(cat <<'EOF'
docs(milestones): record M2 Phase 4 E2E results and close milestone

実機 GitHub Project (`<owner>/<repo>` Project #<N>) で
`pnpm e2e:claude-github` が PASS。詳細ログを milestone doc に焼き付け、
TODO.md の Milestone 2 完了日を確定。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Final branch summary**

```bash
cd /workspace && git log --oneline main..feat/m2-phase4
```

Confirm the commit list looks reasonable. The branch is now ready for merge to `main`. The user decides timing of merge (see the spec's "PR 構造" — 1 本 branch でまとめて main へ).

---

## Self-Review (run after writing the plan)

Run this as a final pre-flight check:

1. **Spec coverage:** every spec section has corresponding task(s)?
   - `examples/workflow.claude-github.md` → Task 2 ✓
   - Rename `workflow.claude.md` → Task 1 ✓
   - `scripts/lib/e2e-common.ts` extract → Task 3 ✓
   - `scripts/e2e.claude-github.ts` → Task 5 ✓
   - `scripts/e2e.config.json` → Task 4 ✓
   - `package.json` scripts → Task 3 + Task 5 ✓
   - tsdown config → Task 3 + Task 5 ✓
   - ADR-0013 → Task 6 ✓
   - ADR-0014 → Task 7 ✓
   - `docs/adr/README.md` index → Task 8 ✓
   - README / architecture / protocol / root CLAUDE.md sweep → Task 9 ✓
   - apps/symphony/CLAUDE.md + e2e_testing.md sweep → Task 10 ✓
   - `docs/milestones/02-github-tracker.md` scaffold → Task 11 ✓
   - TODO.md update → Task 12 ✓
   - Real E2E run → Task 13 ✓
   - Milestone close → Task 14 ✓

2. **Placeholder scan:** the only intentional placeholders are `YYYY-MM-DD` in milestone doc / TODO line (Task 14 fills), `<P1-SHA>` / `<P2-SHA>` (Task 11 Step 1 resolves), `<owner>/<repo>` / `<N>` in config and E2E log (Task 13–14 fill). All are flagged in their tasks.

3. **Type consistency check:**
   - `CommonE2EError` defined in `e2e-common.ts`, imported as `type CommonE2EError` in Linear / GitHub scripts. ✓
   - `verifyWorkspaceHello` and `cleanWorkspaceAt` take a `workspacePath: string` arg — matched in both call sites. ✓
   - `spawnSymphony` accepts `{ workflowPath, tag }` — matched. ✓
   - `runSymphonyUntilTerminal` polls via a `pollStatus` callback returning `Result<{ state; terminal }, E>` — matched in both factories. ✓
   - GitHub `Discovered` struct produces `{ projectId; fieldId; optionIdByName; itemId }` — used consistently in `resetIssueToTodo` (`disc.itemId`/`disc.projectId`/`disc.fieldId`) and `pollStatusFactory` (`disc.itemId`). ✓
   - GitHub `optionIdByName` is `ReadonlyMap<string, string>` — `get` and spreading `keys()` consistent. ✓

If any of these turn up wrong during execution, fix inline; don't re-review the whole plan.

---

## Execution Handoff

When this plan is implemented, all 14 tasks must run in order. Task 1–12 are mechanical edits; Task 13 is interactive (real E2E). Task 14 closes the milestone after PASS.

Two execution options:

1. **Subagent-Driven (recommended for plan tasks 1–12, 14)** — fresh subagent per task, review between tasks. Task 13 is best driven inline since it requires user-supplied secrets and may iterate on bug fixes.
2. **Inline Execution** — all tasks in this session.
