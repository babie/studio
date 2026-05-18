import { mkdir, stat } from "node:fs/promises";
import type { Result } from "@praha/byethrow";
import type { Issue } from "../domain/issue.js";
import type { WorkspaceConfig } from "../domain/workspace-config.js";
import type { HooksConfig } from "../domain/hooks-config.js";
import type { WorkspaceError } from "../domain/workspace-errors.js";
import { workspacePathFor } from "./path.js";
import { buildHookEnv, runHook, DEFAULT_HOOK_TIMEOUT_MS } from "./hooks.js";

export type EnsureForIssueResult = Readonly<{
  path: string;
  created: boolean;
}>;

export const ensureForIssue = async (
  config: WorkspaceConfig,
  hooks: HooksConfig | undefined,
  issue: Issue,
): Promise<Result.Result<EnsureForIssueResult, WorkspaceError>> => {
  const pathR = workspacePathFor(config.root, issue.identifier);
  if (pathR.type === "Failure") return pathR;
  const target = pathR.value;

  let alreadyExists = false;
  try {
    const st = await stat(target);
    if (st.isDirectory()) {
      alreadyExists = true;
    } else {
      return { type: "Failure", error: { kind: "path-unsafe", path: target } };
    }
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      return { type: "Failure", error: { kind: "create-failed", path: target, cause: err?.message ?? String(err) } };
    }
  }

  if (!alreadyExists) {
    try {
      await mkdir(target, { recursive: true });
    } catch (err: any) {
      return { type: "Failure", error: { kind: "create-failed", path: target, cause: err?.message ?? String(err) } };
    }
    if (hooks?.afterCreate) {
      const hookR = await runHook({
        command: hooks.afterCreate,
        cwd: target,
        env: buildHookEnv(issue),
        hookName: "after_create",
        timeoutMs: hooks.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
      });
      if (hookR.type === "Failure") return hookR;
    }
  }

  return { type: "Success", value: { path: target, created: !alreadyExists } };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  const { tmpdir } = await import("node:os");
  const { mkdtemp, readdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const v = await import("valibot");
  const { IssueId, IssueIdentifier, IssueStateName } = await import("../domain/issue.js");

  const issue = {
    id: v.parse(IssueId.schema, "M-1"),
    identifier: v.parse(IssueIdentifier.schema, "M-1"),
    title: "t",
    description: "",
    state: v.parse(IssueStateName.schema, "Todo"),
    priority: null,
    createdAt: null,
    assigneeId: null,
    assignedToWorker: true,
    blockedBy: [],
  } as const satisfies Issue;

  describe("workspace/manager", () => {
    it("creates a new dir and runs after_create hook", async () => {
      const root = await mkdtemp(join(tmpdir(), "perform-wsm-"));
      const r = await ensureForIssue(
        { root },
        { afterCreate: 'echo "init" > marker.txt' },
        issue,
      );
      if (r.type !== "Success") throw new Error("expected success");
      expect(r.value.created).toBe(true);
      const entries = await readdir(r.value.path);
      expect(entries).toContain("marker.txt");
    });

    it("reuses existing dir and does NOT re-run after_create", async () => {
      const root = await mkdtemp(join(tmpdir(), "perform-wsm-"));
      const first = await ensureForIssue({ root }, { afterCreate: "echo a > m" }, issue);
      if (first.type !== "Success") throw new Error("expected success");
      await writeFile(join(first.value.path, "user-edit.txt"), "x");
      const second = await ensureForIssue({ root }, { afterCreate: "echo b > m" }, issue);
      if (second.type !== "Success") throw new Error("expected success");
      expect(second.value.created).toBe(false);
      const entries = await readdir(second.value.path);
      expect(entries).toContain("user-edit.txt");
    });

    it("propagates after_create hook failure", async () => {
      const root = await mkdtemp(join(tmpdir(), "perform-wsm-"));
      const r = await ensureForIssue({ root }, { afterCreate: "exit 9" }, issue);
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("hook-failed");
    });

    it("returns path-unsafe for relative root", async () => {
      const r = await ensureForIssue({ root: "relative/path" }, undefined, issue);
      expect(r.type).toBe("Failure");
    });
  });
}
