// apps/perform/src/observability/render/sparkline.ts
//
// Algorithm originally ported from apps/symphony/lib/symphony_elixir/status_dashboard.ex
// (tps_graph / throttled_tps / rolling_tps / update_token_samples) — Elixir
// retired in M3 Phase 7.

import { THROUGHPUT_GRAPH_COLUMNS } from "../runtime-config.js";

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

/** Sample of [timestampMs, cumulativeTotalTokens]. */
export type TokenSample = readonly [number, number];

/**
 * Build a sparkline for the throughput window.
 *
 * Algorithm (matches symphony's `tps_graph`):
 * 1. Prepend `[now, currentTokens]` to samples, prune samples outside the graph
 *    window, sort oldest-first.
 * 2. Compute per-consecutive-pair instantaneous TPS values with their end
 *    timestamp.
 * 3. Epoch-align buckets: `activeBucketStart = floor(now / bucketMs) * bucketMs`.
 *    The graph spans `THROUGHPUT_GRAPH_COLUMNS` buckets ending at `activeBucketStart + bucketMs`.
 * 4. Each bucket averages the TPS values whose end timestamp falls in the bucket
 *    (`[start, end)` for all but the last; `[start, end]` for the last bucket).
 * 5. Scale each bucket to a sparkline block: `round(value / maxTps * 7)`.
 *
 * @param samples   stored token samples (may be in any order).
 * @param now       wall-clock ms (right edge of the graph).
 * @param currentTokens  current cumulative token count (prepended before computing).
 * @param windowMs  total graph window in ms.
 * Returns exactly THROUGHPUT_GRAPH_COLUMNS characters.
 */
export const sparkline = (
  samples: ReadonlyArray<TokenSample>,
  now: number,
  currentTokens: number,
  windowMs: number,
): string => {
  const bucketMs = windowMs / THROUGHPUT_GRAPH_COLUMNS;
  // Epoch-aligned bucket that contains `now`.
  const activeBucketStart = Math.floor(now / bucketMs) * bucketMs;
  const graphWindowStart = activeBucketStart - (THROUGHPUT_GRAPH_COLUMNS - 1) * bucketMs;

  // Prepend current sample, prune, sort oldest-first.
  const pruneMs = windowMs;
  const cutoff = now - pruneMs;
  const sorted = [[now, currentTokens] as TokenSample, ...samples]
    .filter(([t]) => t >= cutoff)
    .sort((a, b) => a[0] - b[0]);

  // Compute per-consecutive-pair TPS values (end_timestamp, tps).
  const rates: Array<[number, number]> = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const [startMs, startTokens] = sorted[i]!;
    const [endMs, endTokens] = sorted[i + 1]!;
    const elapsedMs = endMs - startMs;
    const deltaTokens = Math.max(0, endTokens - startTokens);
    const tps = elapsedMs <= 0 ? 0 : (deltaTokens / elapsedMs) * 1000;
    rates.push([endMs, tps]);
  }

  // Bucket the TPS values.
  const bucketedTps: number[] = [];
  for (let bucketIdx = 0; bucketIdx < THROUGHPUT_GRAPH_COLUMNS; bucketIdx++) {
    const bucketStart = graphWindowStart + bucketIdx * bucketMs;
    const bucketEnd = bucketStart + bucketMs;
    const isLastBucket = bucketIdx === THROUGHPUT_GRAPH_COLUMNS - 1;

    const values = rates
      .filter(([t]) => inBucket(t, bucketStart, bucketEnd, isLastBucket))
      .map(([, tps]) => tps);

    bucketedTps.push(values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);
  }

  const maxTps = Math.max(...bucketedTps);

  return bucketedTps
    .map((value) => {
      const index = maxTps <= 0 ? 0 : Math.round((value / maxTps) * (BLOCKS.length - 1));
      return BLOCKS[Math.min(BLOCKS.length - 1, index)]!;
    })
    .join("");
};

function inBucket(
  timestamp: number,
  bucketStart: number,
  bucketEnd: number,
  isLastBucket: boolean,
): boolean {
  return isLastBucket
    ? timestamp >= bucketStart && timestamp <= bucketEnd
    : timestamp >= bucketStart && timestamp < bucketEnd;
}

/**
 * Prune samples older than `now - max(throughputWindowMs, graphWindowMs)` and
 * prepend the new `[now, totalTokens]` sample.
 *
 * Mirrors symphony's `update_token_samples` (prepend then `prune_graph_samples`).
 *
 * @param samples        existing samples (any order).
 * @param now            current wall-clock ms.
 * @param totalTokens    current cumulative token count.
 * @param throughputWindowMs  rolling-TPS window (e.g. 5_000).
 * @param graphWindowMs  sparkline graph window (e.g. 600_000).
 */
export const updateTokenSamples = (
  samples: ReadonlyArray<TokenSample>,
  now: number,
  totalTokens: number,
  throughputWindowMs: number,
  graphWindowMs: number,
): ReadonlyArray<TokenSample> => {
  const cutoff = now - Math.max(throughputWindowMs, graphWindowMs);
  const kept = samples.filter(([t]) => t >= cutoff);
  return [[now, totalTokens], ...kept];
};

/**
 * Throughput (tokens/sec) averaged over the last `throughputWindowMs`.
 *
 * Mirrors symphony's `rolling_tps`: prepends `[now, currentTokens]`, prunes to
 * `throughputWindowMs`, then computes `(currentTokens - oldestTokens) / elapsedSec`.
 *
 * @param samples        stored token samples (any order).
 * @param now            current wall-clock ms.
 * @param currentTokens  current cumulative token count.
 * @param throughputWindowMs  rolling window in ms (e.g. 5_000).
 */
export const rollingTps = (
  samples: ReadonlyArray<TokenSample>,
  now: number,
  currentTokens: number,
  throughputWindowMs: number,
): number => {
  const cutoff = now - throughputWindowMs;
  const pruned = [[now, currentTokens] as TokenSample, ...samples]
    .filter(([t]) => t >= cutoff)
    .sort((a, b) => a[0] - b[0]);

  if (pruned.length < 2) return 0;

  const [startMs, startTokens] = pruned[0]!;
  const elapsedMs = now - startMs;
  const deltaTokens = Math.max(0, currentTokens - startTokens);

  return elapsedMs <= 0 ? 0 : (deltaTokens / elapsedMs) * 1000;
};

/**
 * Throughput (tokens/sec) throttled to update at most once per second.
 *
 * Mirrors symphony's `throttled_tps`.
 *
 * @param lastSecond     previously cached second (or null).
 * @param lastValue      previously cached TPS value (or null).
 * @param now            current wall-clock ms.
 * @param samples        stored token samples.
 * @param currentTokens  current cumulative token count.
 * @param throughputWindowMs  rolling window in ms (e.g. 5_000).
 */
export const throttledTps = (
  lastSecond: number | null,
  lastValue: number | null,
  now: number,
  samples: ReadonlyArray<TokenSample>,
  currentTokens: number,
  throughputWindowMs: number,
): { second: number; value: number } => {
  const second = Math.floor(now / 1000);
  if (lastSecond === second && lastValue !== null) return { second, value: lastValue };
  return { second, value: rollingTps(samples, now, currentTokens, throughputWindowMs) };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("observability/render/sparkline", () => {
    const WINDOW = 600_000; // 10 min graph window
    const TPS_WINDOW = 5_000;

    it("empty samples → all ▁", () => {
      expect(sparkline([], 1000, 0, WINDOW)).toBe("▁".repeat(24));
    });

    it("single sample (no history) → all ▁", () => {
      // With only the prepended current sample, there are no consecutive pairs → all 0 → all ▁
      expect(sparkline([], 60_000, 100, WINDOW)).toBe("▁".repeat(24));
    });

    it("monotonic constant tokens → all ▁", () => {
      const s: TokenSample[] = [
        [1000, 5],
        [2000, 5],
        [3000, 5],
      ];
      expect(sparkline(s, 3000, 5, WINDOW)).toBe("▁".repeat(24));
    });

    it("returns exactly 24 characters", () => {
      const s: TokenSample[] = Array.from(
        { length: 12 },
        (_, i) => [i * 50_000, i * 100] as TokenSample,
      );
      const out = sparkline(s, 600_000, 1200, WINDOW);
      expect(out.length).toBe(24);
      expect([...out].every((c) => "▁▂▃▄▅▆▇█".includes(c))).toBe(true);
    });

    it("rising series: last bucket should be █ (highest block)", () => {
      // Uniform activity in each bucket → all same height → all █ when max is same
      // More targeted: concentrate all tokens in the last bucket
      const bucketMs = WINDOW / 24;
      const activeBucketStart = Math.floor(600_000 / bucketMs) * bucketMs;
      const lastBucketMid = activeBucketStart + bucketMs / 2;
      const s: TokenSample[] = [
        [lastBucketMid - 1000, 0],
        [lastBucketMid + 1000, 1000],
      ];
      const out = sparkline(s, 600_000, 1000, WINDOW);
      expect(out.length).toBe(24);
      expect(out[out.length - 1]).toBe("█");
    });

    it("updateTokenSamples prepends and prunes", () => {
      const s: TokenSample[] = [
        [100, 5],
        [200, 6],
      ];
      // With throughputWindowMs=5000, graphWindowMs=600000, cutoff = 700000 - 600000 = 100000
      // Both samples at 100 and 200 are below cutoff → pruned
      const next = updateTokenSamples(s, 700_000, 10, TPS_WINDOW, WINDOW);
      expect(next).toEqual([[700_000, 10]]);
    });

    it("updateTokenSamples keeps samples within window", () => {
      const s: TokenSample[] = [
        [700_000 - 300_000, 5], // at 400_000 — within 600_000 window
        [100, 1], // too old → pruned
      ];
      const next = updateTokenSamples(s, 700_000, 10, TPS_WINDOW, WINDOW);
      expect(next).toEqual([
        [700_000, 10],
        [400_000, 5],
      ]);
    });

    it("rollingTps returns 0 with only one sample", () => {
      expect(rollingTps([], 5000, 50, TPS_WINDOW)).toBe(0);
    });

    it("rollingTps computes tokens/sec over window", () => {
      // 50 tokens over 5 seconds = 10 tps
      const s: TokenSample[] = [[0, 0]];
      const result = rollingTps(s, 5000, 50, TPS_WINDOW);
      expect(result).toBeCloseTo(10, 5);
    });

    it("throttledTps caches per second", () => {
      const s: TokenSample[] = [[1000, 0]];
      const r1 = throttledTps(null, null, 6000, s, 50, TPS_WINDOW);
      // Same second (6000ms = second 6), different sub-second time → returns cached
      const r2 = throttledTps(r1.second, r1.value, 6500, s, 50, TPS_WINDOW);
      expect(r2.value).toBe(r1.value);
      expect(r2.second).toBe(r1.second);
    });

    it("throttledTps recomputes on new second", () => {
      const s: TokenSample[] = [[1000, 0]];
      const r1 = throttledTps(null, null, 6000, s, 50, TPS_WINDOW);
      // Advance to next second
      const r2 = throttledTps(r1.second, r1.value, 7000, s, 70, TPS_WINDOW);
      expect(r2.second).toBe(7);
    });
  });
}
