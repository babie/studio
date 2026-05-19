// apps/perform/src/domain/workspace-errors.ts
export type WorkspaceError =
  | Readonly<{ kind: "path-unsafe"; path: string }>
  | Readonly<{ kind: "create-failed"; path: string; cause: string }>
  | Readonly<{
      kind: "hook-failed";
      hook: "before_run" | "after_create" | "before_remove" | "after_run";
      exitCode: number;
      stderrTail: string;
    }>
  | Readonly<{ kind: "hook-timeout"; hook: string; timeoutMs: number }>;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("domain/workspace-errors", () => {
    it("discriminates hook-failed", () => {
      const e: WorkspaceError = {
        kind: "hook-failed",
        hook: "after_create",
        exitCode: 1,
        stderrTail: "x",
      };
      expect(e.hook).toBe("after_create");
    });
  });
}
