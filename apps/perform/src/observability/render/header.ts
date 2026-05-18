// apps/conductor/src/observability/render/header.ts
//
// Algorithm originally ported from apps/symphony/lib/symphony_elixir/status_dashboard.ex
// (format_snapshot_content header section + format_rate_limits) — Elixir
// retired in M3 Phase 7.
//
// Output was originally byte-for-byte calibrated against captured ANSI
// goldens in apps/conductor/test/fixtures/dashboard/*.txt (Phase 5,
// retired alongside symphony in Phase 7).

import { ANSI, colorize, formatCount, formatRuntimeSeconds, formatTps } from "./format.js";
import type { CodexTotals, RateLimits, RateLimitInfo } from "../../domain/observability-snapshot.js";

export type HeaderInput = Readonly<{
  agentCount: number;
  maxAgents: number;
  tps: number;
  codexTotals: CodexTotals;
  rateLimits: RateLimits | null;
}>;

// ---------------------------------------------------------------------------
// Rate limit formatting — mirrors symphony's format_rate_limits/1 and
// format_rate_limit_bucket/1.
//
// Symphony stores rate_limits with atom keys (Elixir side) so inspect/1
// renders them as `%{used_percent: ..., resets_in_ms: ...}`.
// Our TS RateLimitInfo has camelCase keys {usedPercent, resetsInMs}, which
// map to the Elixir atom-key snake_case names used_percent / resets_in_ms.
//
// Since RateLimitInfo has no remaining/limit fields, format_rate_limit_bucket
// always falls through to the inspect-then-truncate path.  We replicate that
// path by formatting the bucket as an Elixir-style map literal (atom-key
// notation), then truncating at 40 bytes (first 40 bytes + "..."), matching
// symphony's `truncate/2` behaviour:
//
//   defp truncate(value, max) when byte_size(value) > max do
//     value |> String.slice(0, max) |> Kernel.<>("...")
//   end
// ---------------------------------------------------------------------------

/**
 * Format a float/integer value the same way Elixir's inspect/1 would.
 * Integers print without decimal point; floats always keep their decimal.
 */
const elixirInspectNumber = (n: number): string => {
  if (Number.isInteger(n)) return n.toString();
  return n.toString(); // JS float-to-string matches Elixir for simple cases (e.g. 92.5)
};

/**
 * Produce an Elixir-style inspect string for a RateLimitInfo, matching the
 * atom-key map format that symphony's inspect/1 emits.
 *
 * Key order: symphony captured goldens show `used_percent` before
 * `resets_in_ms` for the %{used_percent: 92.5, resets_in_ms: 4500000} case.
 * Elixir small-map ordering is implementation-defined but the golden is the
 * authoritative source — we hard-code used_percent first.
 */
const elixirInspectBucket = (bucket: RateLimitInfo): string =>
  `%{used_percent: ${elixirInspectNumber(bucket.usedPercent)}, resets_in_ms: ${elixirInspectNumber(bucket.resetsInMs)}}`;

/**
 * Symphony-compatible truncate: if byte length > max, take first `max` bytes
 * and append "..." (three ASCII dots — NOT the unicode ellipsis "…").
 */
const symphonyTruncate = (s: string, max: number): string => {
  const bytes = Buffer.byteLength(s, "utf8");
  if (bytes <= max) return s;
  // Slice to max bytes.  Since our strings are ASCII-only in practice, this
  // is the same as character-slicing; but we use Buffer for correctness.
  return Buffer.from(s, "utf8").subarray(0, max).toString("utf8") + "...";
};

/**
 * Format a rate-limit bucket.
 *
 * Mirrors symphony's format_rate_limit_bucket/1.  Our domain RateLimitInfo
 * has only usedPercent/resetsInMs (no remaining/limit), so we always fall
 * through to the inspect-then-truncate path.
 */
const formatRateLimitBucket = (bucket: RateLimitInfo | null): string => {
  if (bucket === null) return "n/a";
  // RateLimitInfo has no remaining/limit — fall through to inspect fallback.
  const inspected = elixirInspectBucket(bucket);
  return symphonyTruncate(inspected, 40);
};

/**
 * Format the rate limits line content (everything after "│ Rate Limits: ").
 *
 * Mirrors symphony's format_rate_limits/1:
 * - nil  → colorize("unavailable", gray)
 * - map  → limit_id | primary bucket | secondary bucket | credits
 *
 * Our RateLimits domain type has no limit_id/limit_name, so limit_id
 * defaults to "unknown" (symphony fallback).
 * Our RateLimits has no credits field, so credits defaults to "credits n/a".
 */
const formatRateLimits = (rl: RateLimits | null): string => {
  if (rl === null) return colorize("unavailable", ANSI.gray);

  // limit_id: no limit_id/limit_name in our type → "unknown"
  const limitId = "unknown";
  const primary = formatRateLimitBucket(rl.primary);
  const secondary = formatRateLimitBucket(rl.secondary);
  const credits = "credits n/a";

  return (
    colorize(limitId, ANSI.yellow) +
    colorize(" | ", ANSI.gray) +
    colorize(`primary ${primary}`, ANSI.cyan) +
    colorize(" | ", ANSI.gray) +
    colorize(`secondary ${secondary}`, ANSI.cyan) +
    colorize(" | ", ANSI.gray) +
    colorize(credits, ANSI.green)
  );
};

/**
 * Render the dashboard header section.
 *
 * Returns one string per line; the caller joins with "\n".
 * Line order matches symphony's format_snapshot_content:
 *   0: ╭─ PERFORM STATUS
 *   1: │ Agents: N/M
 *   2: │ Throughput: X tps
 *   3: │ Runtime: Xm Ys
 *   4: │ Tokens: in X | out Y | total Z
 *   5: │ Rate Limits: ...
 */
export const renderHeader = (input: HeaderInput): ReadonlyArray<string> => {
  const { agentCount, maxAgents, tps, codexTotals, rateLimits } = input;
  return [
    colorize("╭─ PERFORM STATUS", ANSI.bold),
    colorize("│ Agents: ", ANSI.bold) +
      colorize(`${agentCount}`, ANSI.green) +
      colorize("/", ANSI.gray) +
      colorize(`${maxAgents}`, ANSI.gray),
    colorize("│ Throughput: ", ANSI.bold) + colorize(`${formatTps(tps)} tps`, ANSI.cyan),
    colorize("│ Runtime: ", ANSI.bold) +
      colorize(formatRuntimeSeconds(codexTotals.secondsRunning), ANSI.magenta),
    colorize("│ Tokens: ", ANSI.bold) +
      colorize(`in ${formatCount(codexTotals.inputTokens)}`, ANSI.yellow) +
      colorize(" | ", ANSI.gray) +
      colorize(`out ${formatCount(codexTotals.outputTokens)}`, ANSI.yellow) +
      colorize(" | ", ANSI.gray) +
      colorize(`total ${formatCount(codexTotals.totalTokens)}`, ANSI.yellow),
    colorize("│ Rate Limits: ", ANSI.bold) + formatRateLimits(rateLimits),
  ];
};

// Re-export helpers for use in parity tests.
export { formatRateLimits };

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("observability/render/header", () => {
    // -----------------------------------------------------------------------
    // Basic structure + format correctness (derived from one-running-codex.txt)
    // -----------------------------------------------------------------------
    it("renders agents / throughput / runtime / tokens structure", () => {
      const lines = renderHeader({
        agentCount: 1,
        maxAgents: 2,
        tps: 13.7,
        codexTotals: { inputTokens: 800, outputTokens: 434, totalTokens: 1234, secondsRunning: 90 },
        rateLimits: null,
      });
      expect(lines).toHaveLength(6);
      // Line 0: header title
      expect(lines[0]).toContain("PERFORM STATUS");
      // Line 1: agents N/M
      expect(lines[1]).toContain("1");
      expect(lines[1]).toContain("/");
      expect(lines[1]).toContain("2");
      // Line 2: throughput — formatTps(13.7) === "13" (truncated)
      expect(lines[2]).toContain("13 tps");
      // Line 3: runtime — formatRuntimeSeconds(90) === "1m 30s"
      expect(lines[3]).toContain("1m 30s");
      // Line 4: tokens — formatCount(1234) === "1,234"
      expect(lines[4]).toContain("in 800");
      expect(lines[4]).toContain("out 434");
      expect(lines[4]).toContain("total 1,234");
    });

    // -----------------------------------------------------------------------
    // Rate limits: null → "unavailable" (one-running-codex.txt / empty.txt)
    // -----------------------------------------------------------------------
    it('formats null rate limits as "unavailable" (gray) per symphony golden', () => {
      const lines = renderHeader({
        agentCount: 0,
        maxAgents: 2,
        tps: 0,
        codexTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0, secondsRunning: 0 },
        rateLimits: null,
      });
      // The line should contain the gray-colored "unavailable" string.
      const rateLimitLine = lines[5]!;
      expect(rateLimitLine).toContain("unavailable");
      // Should be wrapped in gray (ANSI.gray = \x1b[90m)
      expect(rateLimitLine).toContain("\x1b[90munavailable\x1b[0m");
    });

    // -----------------------------------------------------------------------
    // Rate limits: present → "unknown | primary %{...} | secondary n/a | credits n/a"
    // Matches rate-limited.txt golden bytes.
    // -----------------------------------------------------------------------
    it("formats present rate limits with inspect fallback (rate-limited.txt golden)", () => {
      const lines = renderHeader({
        agentCount: 0,
        maxAgents: 2,
        tps: 0,
        codexTotals: { inputTokens: 100, outputTokens: 50, totalTokens: 150, secondsRunning: 10 },
        rateLimits: {
          primary: { usedPercent: 92.5, resetsInMs: 4_500_000 },
          secondary: null,
        },
      });
      const rl = lines[5]!;
      // limit_id fallback: "unknown" (yellow)
      expect(rl).toContain("\x1b[33munknown\x1b[0m");
      // primary bucket: inspect fallback truncated at 40 bytes + "..."
      // Full: "%{used_percent: 92.5, resets_in_ms: 4500000}" = 45 bytes
      // Truncated: "%{used_percent: 92.5, resets_in_ms: 4500" + "..." (40 bytes + 3 dots)
      expect(rl).toContain("primary %{used_percent: 92.5, resets_in_ms: 4500...");
      // secondary: null → "n/a"
      expect(rl).toContain("secondary n/a");
      // credits: always n/a
      expect(rl).toContain("credits n/a");
    });

    // -----------------------------------------------------------------------
    // ANSI color codes match symphony's golden bytes (spot-check line 0)
    // -----------------------------------------------------------------------
    it("line 0 is bold PERFORM STATUS with reset", () => {
      const lines = renderHeader({
        agentCount: 0,
        maxAgents: 2,
        tps: 0,
        codexTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0, secondsRunning: 0 },
        rateLimits: null,
      });
      expect(lines[0]).toBe("\x1b[1m╭─ PERFORM STATUS\x1b[0m");
    });

    // -----------------------------------------------------------------------
    // zero / boundary values (empty.txt golden)
    // -----------------------------------------------------------------------
    it("handles zero totals — empty.txt golden values", () => {
      const lines = renderHeader({
        agentCount: 0,
        maxAgents: 2,
        tps: 0,
        codexTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0, secondsRunning: 0 },
        rateLimits: null,
      });
      expect(lines[2]).toContain("0 tps");
      expect(lines[3]).toContain("0m 0s");
      expect(lines[4]).toContain("in 0");
      expect(lines[4]).toContain("out 0");
      expect(lines[4]).toContain("total 0");
    });

    // -----------------------------------------------------------------------
    // symphonyTruncate helper: >40 bytes → first 40 + "..."
    // -----------------------------------------------------------------------
    it("inspect bucket truncates at 40 bytes for large resetsInMs", () => {
      // %{used_percent: 92.5, resets_in_ms: 4500000} = 45 bytes
      // truncated: "%{used_percent: 92.5, resets_in_ms: 4500" = 40 chars + "..."
      const rl = formatRateLimits({
        primary: { usedPercent: 92.5, resetsInMs: 4_500_000 },
        secondary: null,
      });
      expect(rl).toContain("%{used_percent: 92.5, resets_in_ms: 4500...");
    });

    it("inspect bucket not truncated when <= 40 bytes", () => {
      // %{used_percent: 0, resets_in_ms: 0} = 36 bytes → no truncation
      const rl = formatRateLimits({
        primary: { usedPercent: 0, resetsInMs: 0 },
        secondary: null,
      });
      expect(rl).toContain("%{used_percent: 0, resets_in_ms: 0}");
      expect(rl).not.toContain("...");
    });
  });
}
