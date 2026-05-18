import { spawn } from "node:child_process";
import type { Result } from "@praha/byethrow";
import type { Issue } from "../domain/issue.js";
import type { WorkspaceError } from "../domain/workspace-errors.js";

export const DEFAULT_HOOK_TIMEOUT_MS = 60_000;
const OUTPUT_TAIL_BYTES = 32 * 1024;

export type HookName = "before_run" | "after_create" | "before_remove" | "after_run";

export type HookEnv = Readonly<{
  ISSUE_ID: string;
  ISSUE_IDENTIFIER: string;
  ISSUE_TITLE: string;
}>;

export const buildHookEnv = (issue: Issue): HookEnv => ({
  ISSUE_ID: issue.id,
  ISSUE_IDENTIFIER: issue.identifier,
  ISSUE_TITLE: issue.title,
});

export type RunHookParams = Readonly<{
  command: string;
  cwd: string;
  env: HookEnv;
  hookName: HookName;
  timeoutMs?: number;
}>;

export type HookSuccess = Readonly<{
  stdoutTail: string;
  stderrTail: string;
  durationMs: number;
}>;

export const runHook = (
  params: RunHookParams,
): Promise<Result.Result<HookSuccess, WorkspaceError>> => {
  return new Promise((resolve) => {
    const timeoutMs = params.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
    const t0 = Date.now();
    const child = spawn("bash", ["-lc", params.command], {
      cwd: params.cwd,
      env: { ...process.env, ...params.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdoutBuf = "";
    let stderrBuf = "";
    child.stdout?.on("data", (c: Buffer) => {
      stdoutBuf = (stdoutBuf + c.toString("utf8")).slice(-OUTPUT_TAIL_BYTES);
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderrBuf = (stderrBuf + c.toString("utf8")).slice(-OUTPUT_TAIL_BYTES);
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // ignore
          }
        }, 1_000);
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.on("exit", (code, _signal) => {
      clearTimeout(timer);
      const elapsed = Date.now() - t0;
      if (timedOut) {
        resolve({
          type: "Failure",
          error: { kind: "hook-timeout", hook: params.hookName, timeoutMs },
        });
        return;
      }
      if (code === 0) {
        resolve({
          type: "Success",
          value: { stdoutTail: stdoutBuf, stderrTail: stderrBuf, durationMs: elapsed },
        });
      } else {
        resolve({
          type: "Failure",
          error: {
            kind: "hook-failed",
            hook: params.hookName,
            exitCode: code ?? -1,
            stderrTail: stderrBuf,
          },
        });
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        type: "Failure",
        error: {
          kind: "hook-failed",
          hook: params.hookName,
          exitCode: -1,
          stderrTail: err.message,
        },
      });
    });
  });
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  const { tmpdir } = await import("node:os");
  const { mkdtemp } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const env: HookEnv = { ISSUE_ID: "X-1", ISSUE_IDENTIFIER: "X-1", ISSUE_TITLE: "t" };

  describe("workspace/hooks", () => {
    it("runs a successful hook and captures stdout", async () => {
      const cwd = await mkdtemp(join(tmpdir(), "perform-hooks-"));
      const r = await runHook({
        command: 'echo "hi $ISSUE_ID"',
        cwd,
        env,
        hookName: "after_create",
      });
      if (r.type !== "Success") throw new Error("expected success");
      expect(r.value.stdoutTail.trim()).toBe("hi X-1");
    });

    it("returns hook-failed with stderrTail on non-zero exit", async () => {
      const cwd = await mkdtemp(join(tmpdir(), "perform-hooks-"));
      const r = await runHook({
        command: 'echo "boom" >&2; exit 7',
        cwd,
        env,
        hookName: "before_run",
      });
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("hook-failed");
      if (r.error.kind === "hook-failed") {
        expect(r.error.exitCode).toBe(7);
        expect(r.error.stderrTail).toContain("boom");
      }
    });

    it("times out and returns hook-timeout", async () => {
      const cwd = await mkdtemp(join(tmpdir(), "perform-hooks-"));
      const r = await runHook({
        command: "sleep 5",
        cwd,
        env,
        hookName: "after_run",
        timeoutMs: 100,
      });
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("hook-timeout");
    }, 10_000);

    it("buildHookEnv extracts issue fields", async () => {
      const v = await import("valibot");
      const { IssueId, IssueIdentifier, IssueStateName } = await import("../domain/issue.js");
      const e = buildHookEnv({
        id: v.parse(IssueId.schema, "X-1"),
        identifier: v.parse(IssueIdentifier.schema, "X-1"),
        title: "T",
        description: "",
        state: v.parse(IssueStateName.schema, "Todo"),
        priority: null,
        createdAt: null,
        assigneeId: null,
        assignedToWorker: true,
        blockedBy: [],
      });
      expect(e.ISSUE_ID).toBe("X-1");
      expect(e.ISSUE_TITLE).toBe("T");
    });
  });
}
