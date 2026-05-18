export type HooksConfig = Readonly<{
  beforeRun?: string;
  afterCreate?: string;
  beforeRemove?: string;
  afterRun?: string;
  /** Per-hook timeout in milliseconds. Default is 60_000 if unset. */
  timeoutMs?: number;
}>;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("domain/hooks-config", () => {
    it("captures all four hook commands and timeout_ms", () => {
      const cfg: HooksConfig = {
        beforeRun: "echo before-run",
        afterCreate: "git init",
        beforeRemove: "echo before-remove",
        afterRun: "echo after-run",
        timeoutMs: 30_000,
      };
      expect(cfg.afterCreate).toBe("git init");
      expect(cfg.timeoutMs).toBe(30_000);
    });

    it("allows all fields to be absent (optional)", () => {
      const cfg: HooksConfig = {};
      expect(cfg.beforeRun).toBeUndefined();
    });
  });
}
