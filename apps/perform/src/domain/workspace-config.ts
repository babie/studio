export type WorkspaceConfig = Readonly<{
  root: string;
}>;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("domain/workspace-config", () => {
    it("holds only the workspace root path", () => {
      const cfg: WorkspaceConfig = { root: "/tmp/ws" };
      expect(cfg.root).toBe("/tmp/ws");
    });
  });
}
