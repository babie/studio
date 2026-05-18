// apps/conductor/src/observability/runtime-config.ts
export const MINIMUM_IDLE_RERENDER_MS = 1_000;
export const THROUGHPUT_WINDOW_MS = 5_000;
export const THROUGHPUT_GRAPH_WINDOW_MS = 600_000;
export const THROUGHPUT_GRAPH_COLUMNS = 24;
export const DEFAULT_TERMINAL_COLUMNS = 115;
export const DEFAULT_REFRESH_MS = 1_000;
export const DEFAULT_RENDER_INTERVAL_MS = 16;
export const DEFAULT_DASHBOARD_ENABLED = true;

export type ObservabilityConfig = Readonly<{
  dashboardEnabled: boolean;
  refreshMs: number;
  renderIntervalMs: number;
}>;

export const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityConfig = {
  dashboardEnabled: DEFAULT_DASHBOARD_ENABLED,
  refreshMs: DEFAULT_REFRESH_MS,
  renderIntervalMs: DEFAULT_RENDER_INTERVAL_MS,
} as const;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("observability/runtime-config", () => {
    it("defaults match symphony constants", () => {
      expect(DEFAULT_OBSERVABILITY_CONFIG.refreshMs).toBe(1000);
      expect(DEFAULT_OBSERVABILITY_CONFIG.renderIntervalMs).toBe(16);
      expect(DEFAULT_OBSERVABILITY_CONFIG.dashboardEnabled).toBe(true);
    });
  });
}
