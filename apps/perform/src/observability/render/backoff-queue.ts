// apps/perform/src/observability/render/backoff-queue.ts
//
// Algorithm originally ported from apps/symphony/lib/symphony_elixir/status_dashboard.ex
// (format_retry_rows/1, format_retry_summary/1, next_in_words/1,
//  format_retry_error/1, closing_border/0) — Elixir retired in M3 Phase 7.
//
// Output was originally byte-for-byte calibrated against captured ANSI
// goldens in apps/conductor/test/fixtures/dashboard/*.txt (Phase 5,
// retired alongside symphony in Phase 7).

import { ANSI, colorize } from "./format.js";
import type { RetryEntry } from "../../domain/observability-snapshot.js";

// ---------------------------------------------------------------------------
// next_in_words — mirrors symphony's next_in_words/1
//
// Converts due_in_ms to a human-readable "N.MMMsec" string:
//   secs   = div(due_in_ms, 1000)
//   millis = rem(due_in_ms, 1000)
//   result = "#{secs}.#{String.pad_leading(millis, 3, "0")}s"
//
// Examples: 500  → "0.500s"
//           3200 → "3.200s"
//           65000 → "65.000s"
// ---------------------------------------------------------------------------
const nextInWords = (dueInMs: number): string => {
  const ms = Math.max(0, Math.trunc(dueInMs));
  const secs = Math.trunc(ms / 1000);
  const millis = ms % 1000;
  const millisStr = millis.toString().padStart(3, "0");
  return `${secs}.${millisStr}s`;
};

// ---------------------------------------------------------------------------
// format_retry_error — mirrors symphony's format_retry_error/1
//
// Sanitizes newlines and collapses whitespace, then truncates at 96
// code-points with the U+2026 ellipsis (from format.ts truncate/2).
// Returns "" for null/undefined/empty error.
//
// Note: symphony uses its own truncate/2 which appends "..." (3 ASCII dots),
// but the symphony status_dashboard truncate/2 is:
//   defp truncate(value, max) when byte_size(value) > max do
//     value |> String.slice(0, max) |> Kernel.<>("...")
//   end
// That truncate is used for rate-limit buckets (header.ts / symphonyTruncate).
//
// For retry errors, symphony calls format_retry_error which calls:
//   " " <> colorize("error=#{truncate(sanitized, 96)}", @ansi_dim)
// This is the same `truncate/2` function. However in the goldens the errors
// are short enough that truncation never triggers, so we replicate the
// symphony behaviour exactly: byte-slice at 96 + append "..." if needed.
// ---------------------------------------------------------------------------
const formatRetryError = (error: string | null): string => {
  if (error === null || error === undefined) return "";

  const sanitized = error
    .replace(/\\r\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\n/g, " ")
    .replace(/\r\n/g, " ")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (sanitized === "") return "";

  // Symphony's truncate/2 for error strings: byte-slice at 96 + "..."
  // (Same function used in header rate-limit truncation, NOT the U+2026 one.)
  const truncated = (() => {
    const bytes = Buffer.byteLength(sanitized, "utf8");
    if (bytes <= 96) return sanitized;
    return Buffer.from(sanitized, "utf8").subarray(0, 96).toString("utf8") + "...";
  })();

  return " " + colorize(`error=${truncated}`, ANSI.dim);
};

// ---------------------------------------------------------------------------
// format_retry_summary — mirrors symphony's format_retry_summary/1
//
// Column layout (matches golden bytes):
//   "│  " + orange("↻") + " " + red(identifier) + " " +
//   yellow("attempt=N") + dim(" in ") + cyan(nextInWords(dueInMs)) +
//   formatRetryError(error)
// ---------------------------------------------------------------------------
const formatRetrySummary = (entry: RetryEntry): string => {
  const identifier = entry.identifier ?? entry.issueId;
  const attempt = entry.attempt ?? 0;
  const dueInMs = entry.dueInMs ?? 0;
  const error = formatRetryError(entry.error);

  return (
    "│  " +
    colorize("↻", ANSI.yellow) +
    " " +
    colorize(identifier, ANSI.red) +
    " " +
    colorize(`attempt=${attempt}`, ANSI.yellow) +
    colorize(" in ", ANSI.dim) +
    colorize(nextInWords(dueInMs), ANSI.cyan) +
    error
  );
};

// ---------------------------------------------------------------------------
// renderBackoffRows — mirrors symphony's format_retry_rows/1
//
// When retrying == []  → ["│  " + gray("No queued retries")]
// Otherwise           → one row per entry, sorted ascending by dueInMs
//
// Note: symphony does Enum.sort_by(& &1.due_in_ms) then Enum.map_join(", ", ...)
// then String.split(", ") to produce a list. The round-trip through join/split
// is a no-op when entries have no commas, so we just sort + map directly.
// ---------------------------------------------------------------------------
export const renderBackoffRows = (retrying: ReadonlyArray<RetryEntry>): ReadonlyArray<string> => {
  if (retrying.length === 0) {
    return ["│  " + colorize("No queued retries", ANSI.gray)];
  }

  return [...retrying]
    .sort((a, b) => (a.dueInMs ?? 0) - (b.dueInMs ?? 0))
    .map(formatRetrySummary);
};

// ---------------------------------------------------------------------------
// closingBorder — mirrors symphony's closing_border/0
//
// Symphony: defp closing_border, do: "╰─"
// This is a plain (uncolored) two-character string.
// ---------------------------------------------------------------------------
export const closingBorder = (): string => "╰─";

// ---------------------------------------------------------------------------
// In-source tests
// ---------------------------------------------------------------------------

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  // Helper: strip ANSI escapes for plain-text assertions
  const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

  describe("observability/render/backoff-queue", () => {
    // -----------------------------------------------------------------------
    // closingBorder — golden: "╰─" (U+2570 U+2500, no color)
    // -----------------------------------------------------------------------
    it("closingBorder returns exact golden bytes", () => {
      expect(closingBorder()).toBe("╰─");
      // No ANSI escapes
      expect(closingBorder()).not.toContain("\x1b[");
    });

    // -----------------------------------------------------------------------
    // renderBackoffRows — empty state
    // Golden (empty.txt):
    //   "│  \x1b[90mNo queued retries\x1b[0m"
    // -----------------------------------------------------------------------
    it("empty retrying → single gray 'No queued retries' row (empty.txt golden)", () => {
      const rows = renderBackoffRows([]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toBe("│  \x1b[90mNo queued retries\x1b[0m");
    });

    // -----------------------------------------------------------------------
    // renderBackoffRows — multi-running.txt golden
    // One entry: CYFY-7, attempt=2, dueInMs=3200, error="timeout"
    // Expected row: "│  \x1b[33m↻\x1b[0m \x1b[31mCYFY-7\x1b[0m \x1b[33mattempt=2\x1b[0m\x1b[2m in \x1b[0m\x1b[36m3.200s\x1b[0m \x1b[2merror=timeout\x1b[0m"
    // -----------------------------------------------------------------------
    it("single entry matches multi-running.txt golden bytes", () => {
      const rows = renderBackoffRows([
        {
          issueId: "id-7",
          identifier: "CYFY-7",
          attempt: 2,
          dueInMs: 3200,
          error: "timeout",
          workerHost: null,
          workspacePath: null,
        },
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toBe(
        "│  \x1b[33m↻\x1b[0m \x1b[31mCYFY-7\x1b[0m \x1b[33mattempt=2\x1b[0m\x1b[2m in \x1b[0m\x1b[36m3.200s\x1b[0m \x1b[2merror=timeout\x1b[0m",
      );
    });

    // -----------------------------------------------------------------------
    // renderBackoffRows — retry-only.txt golden
    // Two entries: identifier="M-1" attempt=1 dueInMs=500 error="connection refused"
    //              identifier="M-2" attempt=3 dueInMs=65000 error="rate limited"
    // (sorted by dueInMs ascending → 500 first, 65000 second)
    // -----------------------------------------------------------------------
    it("two entries match retry-only.txt golden bytes", () => {
      const rows = renderBackoffRows([
        {
          issueId: "M-2",
          identifier: "M-2",
          attempt: 3,
          dueInMs: 65_000,
          error: "rate limited",
          workerHost: null,
          workspacePath: null,
        },
        {
          issueId: "M-1",
          identifier: "M-1",
          attempt: 1,
          dueInMs: 500,
          error: "connection refused",
          workerHost: null,
          workspacePath: null,
        },
      ]);
      expect(rows).toHaveLength(2);
      // Sorted by dueInMs: 500 first
      expect(rows[0]).toBe(
        "│  \x1b[33m↻\x1b[0m \x1b[31mM-1\x1b[0m \x1b[33mattempt=1\x1b[0m\x1b[2m in \x1b[0m\x1b[36m0.500s\x1b[0m \x1b[2merror=connection refused\x1b[0m",
      );
      expect(rows[1]).toBe(
        "│  \x1b[33m↻\x1b[0m \x1b[31mM-2\x1b[0m \x1b[33mattempt=3\x1b[0m\x1b[2m in \x1b[0m\x1b[36m65.000s\x1b[0m \x1b[2merror=rate limited\x1b[0m",
      );
    });

    // -----------------------------------------------------------------------
    // nextInWords via renderBackoffRows (structural invariants)
    // -----------------------------------------------------------------------
    it("row contains identifier, attempt, dueIn, error (plain text)", () => {
      const rows = renderBackoffRows([
        {
          issueId: "ISSUE-42",
          identifier: "ISSUE-42",
          attempt: 5,
          dueInMs: 12_345,
          error: "oops",
          workerHost: null,
          workspacePath: null,
        },
      ]);
      expect(rows).toHaveLength(1);
      const plain = stripAnsi(rows[0]!);
      expect(plain).toContain("ISSUE-42");
      expect(plain).toContain("attempt=5");
      expect(plain).toContain("12.345s");
      expect(plain).toContain("error=oops");
    });

    it("row with null error has no 'error=' text", () => {
      const rows = renderBackoffRows([
        {
          issueId: "ISSUE-1",
          identifier: "ISSUE-1",
          attempt: 1,
          dueInMs: 1000,
          error: null,
          workerHost: null,
          workspacePath: null,
        },
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).not.toContain("error=");
    });

    it("null identifier falls back to issueId", () => {
      const rows = renderBackoffRows([
        {
          issueId: "raw-id-99",
          identifier: null,
          attempt: 1,
          dueInMs: 0,
          error: null,
          workerHost: null,
          workspacePath: null,
        },
      ]);
      expect(rows[0]).toContain("raw-id-99");
    });

    it("sorts entries by dueInMs ascending", () => {
      const rows = renderBackoffRows([
        {
          issueId: "B",
          identifier: "B",
          attempt: 1,
          dueInMs: 5000,
          error: null,
          workerHost: null,
          workspacePath: null,
        },
        {
          issueId: "A",
          identifier: "A",
          attempt: 1,
          dueInMs: 1000,
          error: null,
          workerHost: null,
          workspacePath: null,
        },
      ]);
      expect(stripAnsi(rows[0]!)).toContain("A");
      expect(stripAnsi(rows[1]!)).toContain("B");
    });

    // -----------------------------------------------------------------------
    // error sanitization
    // -----------------------------------------------------------------------
    it("error with newlines is sanitized to single line", () => {
      const rows = renderBackoffRows([
        {
          issueId: "X",
          identifier: "X",
          attempt: 1,
          dueInMs: 0,
          error: "line1\nline2",
          workerHost: null,
          workspacePath: null,
        },
      ]);
      const plain = stripAnsi(rows[0]!);
      expect(plain).toContain("error=line1 line2");
    });
  });
}
