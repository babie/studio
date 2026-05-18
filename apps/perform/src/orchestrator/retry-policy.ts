/**
 * Symphony parity:
 *   continuation_retry_delay_ms = 1_000   (1s)
 *   failure_retry_base_ms       = 10_000  (10s)
 *   failure_retry_max_power     = 10      (2^10 = 1024 ×)
 *   max_retry_backoff_ms        configurable, default 300_000 (5 min)
 */

export const CONTINUATION_RETRY_DELAY_MS = 1_000;
export const FAILURE_RETRY_BASE_MS = 10_000;
export const FAILURE_RETRY_MAX_POWER = 10;

export type RetryDelayType = "continuation" | "failure";

export const continuationDelay = (): number => CONTINUATION_RETRY_DELAY_MS;

export const failureDelay = (attempt: number, maxBackoffMs: number): number => {
  if (attempt < 1) return FAILURE_RETRY_BASE_MS;
  const power = Math.min(attempt - 1, FAILURE_RETRY_MAX_POWER);
  return Math.min(FAILURE_RETRY_BASE_MS * (1 << power), maxBackoffMs);
};

export const retryDelay = (
  attempt: number,
  delayType: RetryDelayType,
  maxBackoffMs: number,
): number => {
  if (delayType === "continuation" && attempt === 1) return continuationDelay();
  return failureDelay(attempt, maxBackoffMs);
};

if (import.meta.vitest) {
  const { describe, it, expect } = await import("vitest");

  describe("orchestrator/retry-policy", () => {
    it("continuation attempt 1 returns 1000ms", () => {
      expect(retryDelay(1, "continuation", 300_000)).toBe(1_000);
    });

    it("failure attempt 1 returns 10s base", () => {
      expect(retryDelay(1, "failure", 300_000)).toBe(10_000);
    });

    it("failure attempt 2 returns 20s (2x)", () => {
      expect(retryDelay(2, "failure", 300_000)).toBe(20_000);
    });

    it("failure attempt 3 returns 40s (4x)", () => {
      expect(retryDelay(3, "failure", 300_000)).toBe(40_000);
    });

    it("failure cap honoured at maxBackoffMs", () => {
      expect(retryDelay(20, "failure", 300_000)).toBe(300_000);
    });

    it("failure capped at 2^10 × base when below maxBackoffMs", () => {
      expect(retryDelay(15, "failure", 100_000_000)).toBe(10_000 * (1 << 10));
    });

    it("continuation with attempt >1 falls back to failure delay (rare)", () => {
      expect(retryDelay(2, "continuation", 300_000)).toBe(20_000);
    });

    it("attempt < 1 falls back to base", () => {
      expect(failureDelay(0, 300_000)).toBe(10_000);
      expect(failureDelay(-5, 300_000)).toBe(10_000);
    });
  });
}
