export type PollingConfig = Readonly<{
  /** How often (ms) the orchestrator polls for new issues. Default 5_000. */
  intervalMs: number;
}>;

if (import.meta.vitest) {
  const { describe, it, expect } = await import("vitest");
  describe("domain/polling-config", () => {
    it("has intervalMs", () => {
      const p: PollingConfig = { intervalMs: 5_000 };
      expect(p.intervalMs).toBe(5_000);
    });
  });
}
