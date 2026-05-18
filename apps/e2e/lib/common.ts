// apps/e2e/lib/common.ts
//
// Tracker-agnostic helpers for E2E scripts. The Linear and GitHub
// variants import from this module and extend the error union with
// their own tracker-specific variants.

import { execFile, spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import type { ChildProcess } from 'node:child_process';
import { Result } from '@praha/byethrow';
import yaml from 'js-yaml';

const execFileP = promisify(execFile);

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
export const BACKEND_LOG_PATH = path.join(REPO_ROOT, 'apps/e2e/backend.log');

// ---------------------------------------------------------------------
// Common error variants
// ---------------------------------------------------------------------

export type CommonE2EError =
  | { kind: 'ConfigError'; issues: ReadonlyArray<string> }
  | { kind: 'ToolMissing'; tools: ReadonlyArray<string> }
  | { kind: 'BackendSpawnFailed'; cause: string }
  | { kind: 'BackendExitedUnexpectedly'; code: number }
  | {
      kind: 'BackendTimedOut';
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

const REQUIRED_TOOLS = ['pnpm', 'node', 'git', 'claude-app-server'] as const;

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
// Backend command resolution
// ---------------------------------------------------------------------

export type BackendCommand = Readonly<{
  /** Absolute or repo-relative executable path (resolved against `cwd` if set). */
  cmd: string;
  /** Args prefix that always precedes the workflow path. */
  args: ReadonlyArray<string>;
  /** Working directory for the subprocess. Omit only when `cmd` is resolved via PATH (no relative path component). */
  cwd?: string;
}>;

const GUARDRAIL_FLAG = "--i-understand-that-this-will-be-running-without-the-usual-guardrails";

/** Returns the perform launcher used by both E2E flows. */
export const resolveBackendCommand = (): BackendCommand => ({
  cmd: "perform",
  args: ["--no-dashboard", GUARDRAIL_FLAG],
});

// ---------------------------------------------------------------------
// Backend subprocess management
// ---------------------------------------------------------------------

export type BackendOutcome =
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

export function spawnBackend(params: {
  workflowPath: string;
  tag: string;
  backend: BackendCommand;
}): Result.Result<ChildProcess, CommonE2EError> {
  const workflowAbs = path.resolve(REPO_ROOT, params.workflowPath);
  const logStream = createWriteStream(BACKEND_LOG_PATH, { flags: 'a' });
  logStream.write(`\n=== ${new Date().toISOString()} ${params.tag} ===\n`);
  let child: ChildProcess;
  try {
    child = spawn(
      params.backend.cmd,
      [...params.backend.args, workflowAbs],
      { cwd: params.backend.cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (err) {
    return Result.fail({
      kind: 'BackendSpawnFailed',
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

export async function runBackendUntilTerminal<E extends { kind: string }>(params: {
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
  let outcome: BackendOutcome | null = null;
  let lastPollErrorKind: string | null = null;

  try {
    await delay(params.initialDelayMs);
    while (Date.now() < deadline) {
      if (interrupted) {
        outcome = { kind: 'interrupted' };
        break;
      }
      if (params.child.exitCode !== null) {
        // Perform is one-shot: it processes its candidates and exits.
        // Before declaring an "unexpected exit", give the tracker a final
        // chance to surface the terminal state (the mutation may have
        // landed just before exit).
        if (params.child.exitCode === 0) {
          const finalStatus = await params.pollStatus();
          if (!Result.isFailure(finalStatus) && finalStatus.value.terminal) {
            console.log(`  child exited(0); issue reached "${finalStatus.value.state}"`);
            outcome = { kind: 'terminal' };
            break;
          }
        }
        outcome = { kind: 'exited', code: params.child.exitCode };
        break;
      }
      const status = await params.pollStatus();
      if (Result.isFailure(status)) {
        lastPollErrorKind = status.error.kind;
        console.warn(`  (poll error: ${status.error.kind}, retrying)`);
      } else if (status.value.terminal) {
        console.log(`  issue reached "${status.value.state}", exiting backend`);
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
        kind: 'BackendTimedOut',
        logPath: BACKEND_LOG_PATH,
        lastPollErrorKind,
      });
    case 'interrupted':
      return Result.fail({ kind: 'Interrupted' });
    case 'exited':
      return Result.fail({ kind: 'BackendExitedUnexpectedly', code: outcome.code });
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
    case 'BackendSpawnFailed':
      console.error(`FAIL: backend spawn failed: ${error.cause}`);
      return 1;
    case 'BackendExitedUnexpectedly':
      console.error(`FAIL: backend exited unexpectedly with code ${error.code}`);
      return 1;
    case 'BackendTimedOut':
      console.error(`FAIL: backend timed out; see ${error.logPath}`);
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

// ---------------------------------------------------------------------
// Workflow front-matter parser (single source of truth for tracker / workspace)
// ---------------------------------------------------------------------

export type WorkflowFrontmatter = {
  tracker?: {
    kind?: string;
    active_states?: ReadonlyArray<string>;
    terminal_states?: ReadonlyArray<string>;
    doing_state?: string;
    done_state?: string;
  };
  linear?: {
    project_slug?: string;
    api_key?: string;
    assignee?: string;
  };
  github?: {
    project_owner?: string;
    project_number?: number;
    api_key?: string;
    assignee?: string;
  };
  workspace?: {
    root?: string;
  };
  [key: string]: unknown;
};

export async function parseWorkflowFrontmatter(
  workflowPath: string,
): Promise<Result.Result<WorkflowFrontmatter, CommonE2EError>> {
  const absPath = path.isAbsolute(workflowPath)
    ? workflowPath
    : path.join(REPO_ROOT, workflowPath);

  let raw: string;
  try {
    raw = await readFile(absPath, 'utf8');
  } catch (err) {
    return Result.fail({
      kind: 'ConfigError',
      issues: [
        `failed to read workflow ${absPath}: ${err instanceof Error ? err.message : String(err)}`,
      ],
    });
  }

  // Front-matter is delimited by `---` at the start of the file.
  // Content after the second `---` is the prompt body (markdown), which we ignore.
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    return Result.fail({
      kind: 'ConfigError',
      issues: [`workflow ${absPath} has no YAML front-matter`],
    });
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(match[1]);
  } catch (err) {
    return Result.fail({
      kind: 'ConfigError',
      issues: [
        `failed to parse YAML front-matter in ${absPath}: ${err instanceof Error ? err.message : String(err)}`,
      ],
    });
  }

  if (!parsed || typeof parsed !== 'object') {
    return Result.fail({
      kind: 'ConfigError',
      issues: [`workflow ${absPath} front-matter is not an object`],
    });
  }

  return Result.succeed(parsed as WorkflowFrontmatter);
}
