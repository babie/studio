// apps/conductor/src/observability/render/offline.ts
//
// Algorithm originally ported from the ":error" branch of
// format_snapshot_content/2 in apps/symphony/lib/symphony_elixir/status_dashboard.ex
// (lines 381-391) — Elixir retired in M3 Phase 7.
//
// Output was originally byte-for-byte calibrated against the captured
// ANSI golden apps/conductor/test/fixtures/dashboard/snapshot-unavailable.txt
// (Phase 5, retired alongside symphony in Phase 7).
//
// Symphony source (error branch):
//   [
//     colorize("╭─ SYMPHONY STATUS", @ansi_bold),
//     colorize("│ Orchestrator snapshot unavailable", @ansi_red),
//     colorize("│ Throughput: ", @ansi_bold) <> colorize("#{format_tps(tps)} tps", @ansi_cyan),
//     format_project_link_lines(),
//     format_project_refresh_line(nil),
//     closing_border()
//   ]
//   |> List.flatten() |> Enum.join("\n")

import { ANSI, colorize, formatTps } from "./format.js";
import { closingBorder } from "./backoff-queue.js";

// ---------------------------------------------------------------------------
// OfflineInput — all information needed to render the error/offline frame.
//
// projectLinkLines: output of renderProjectLinkLines (0 or 1 strings).
// refreshLine:      output of renderProjectRefreshLine.
// tps:              current throughput (0 when snapshot unavailable).
// ---------------------------------------------------------------------------

export type OfflineInput = Readonly<{
  tps: number;
  projectLinkLines: ReadonlyArray<string>;
  refreshLine: string;
}>;

// ---------------------------------------------------------------------------
// renderOffline — mirrors symphony's format_snapshot_content :error branch.
//
// Returns a single joined string (all lines joined with "\n"), matching
// symphony's Enum.join("\n") behaviour.
//
// For the snapshot-unavailable.txt golden:
//   tps           = 0
//   projectLinkLines = [bold("│ Project: ") + gray("n/a")]
//   refreshLine   = bold("│ Next refresh: ") + gray("n/a")
// ---------------------------------------------------------------------------
export const renderOffline = (input: OfflineInput): string => {
  const { tps, projectLinkLines, refreshLine } = input;

  const lines: string[] = [
    colorize("╭─ PERFORM STATUS", ANSI.bold),
    colorize("│ Orchestrator snapshot unavailable", ANSI.red),
    colorize("│ Throughput: ", ANSI.bold) + colorize(`${formatTps(tps)} tps`, ANSI.cyan),
    ...projectLinkLines,
    refreshLine,
    closingBorder(),
  ];

  return lines.join("\n");
};

// ---------------------------------------------------------------------------
// In-source tests
// ---------------------------------------------------------------------------

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  // Pre-compute the exact golden lines for snapshot-unavailable.txt
  // (linear tracker with no project slug → "│ Project: n/a" gray)
  const GOLDEN_PROJECT_LINE = "\x1b[1m│ Project: \x1b[0m\x1b[90mn/a\x1b[0m";
  const GOLDEN_REFRESH_LINE = "\x1b[1m│ Next refresh: \x1b[0m\x1b[90mn/a\x1b[0m";

  // The full golden string (matches snapshot-unavailable.txt byte-for-byte
  // when tps=0, project=n/a, refresh=n/a):
  const EXPECTED_GOLDEN =
    "\x1b[1m╭─ PERFORM STATUS\x1b[0m\n" +
    "\x1b[31m│ Orchestrator snapshot unavailable\x1b[0m\n" +
    "\x1b[1m│ Throughput: \x1b[0m\x1b[36m0 tps\x1b[0m\n" +
    GOLDEN_PROJECT_LINE +
    "\n" +
    GOLDEN_REFRESH_LINE +
    "\n" +
    "╰─";

  describe("observability/render/offline", () => {
    // -----------------------------------------------------------------------
    // Byte-level match against snapshot-unavailable.txt golden
    // -----------------------------------------------------------------------
    it("matches snapshot-unavailable.txt golden bytes exactly (tps=0, project=n/a, refresh=n/a)", () => {
      const result = renderOffline({
        tps: 0,
        projectLinkLines: [GOLDEN_PROJECT_LINE],
        refreshLine: GOLDEN_REFRESH_LINE,
      });
      expect(result).toBe(EXPECTED_GOLDEN);
    });

    // -----------------------------------------------------------------------
    // Structure: always 6 newline-separated parts when projectLinkLines has 1 entry
    // -----------------------------------------------------------------------
    it("produces 6 lines when 1 project link line is provided", () => {
      const result = renderOffline({
        tps: 0,
        projectLinkLines: [GOLDEN_PROJECT_LINE],
        refreshLine: GOLDEN_REFRESH_LINE,
      });
      const lines = result.split("\n");
      expect(lines).toHaveLength(6);
      // line 0: header
      expect(lines[0]).toBe("\x1b[1m╭─ PERFORM STATUS\x1b[0m");
      // line 1: red snapshot unavailable
      expect(lines[1]).toBe("\x1b[31m│ Orchestrator snapshot unavailable\x1b[0m");
      // line 2: throughput
      expect(lines[2]).toContain("0 tps");
      // line 3: project
      expect(lines[3]).toBe(GOLDEN_PROJECT_LINE);
      // line 4: next refresh
      expect(lines[4]).toBe(GOLDEN_REFRESH_LINE);
      // line 5: closing border
      expect(lines[5]).toBe("╰─");
    });

    // -----------------------------------------------------------------------
    // Structure: 5 lines when memory tracker (no project link lines)
    // -----------------------------------------------------------------------
    it("produces 5 lines when no project link lines (memory tracker)", () => {
      const result = renderOffline({
        tps: 0,
        projectLinkLines: [],
        refreshLine: GOLDEN_REFRESH_LINE,
      });
      const lines = result.split("\n");
      expect(lines).toHaveLength(5);
    });

    // -----------------------------------------------------------------------
    // tps is formatted via formatTps (floor, comma-grouped)
    // -----------------------------------------------------------------------
    it("formatTps applied — 13.7 → '13 tps'", () => {
      const result = renderOffline({
        tps: 13.7,
        projectLinkLines: [],
        refreshLine: GOLDEN_REFRESH_LINE,
      });
      expect(result).toContain("13 tps");
      expect(result).not.toContain("13.7 tps");
    });

    // -----------------------------------------------------------------------
    // closingBorder is the last line (no ANSI color)
    // -----------------------------------------------------------------------
    it("last line is plain '╰─' (no ANSI escapes)", () => {
      const result = renderOffline({
        tps: 0,
        projectLinkLines: [],
        refreshLine: GOLDEN_REFRESH_LINE,
      });
      const lines = result.split("\n");
      expect(lines[lines.length - 1]).toBe("╰─");
      expect(lines[lines.length - 1]).not.toContain("\x1b[");
    });

    // -----------------------------------------------------------------------
    // ANSI color spot-checks
    // -----------------------------------------------------------------------
    it("header line is bold (\\x1b[1m)", () => {
      const result = renderOffline({ tps: 0, projectLinkLines: [], refreshLine: "" });
      const lines = result.split("\n");
      expect(lines[0]).toBe("\x1b[1m╭─ PERFORM STATUS\x1b[0m");
    });

    it("'Orchestrator snapshot unavailable' line is red (\\x1b[31m)", () => {
      const result = renderOffline({ tps: 0, projectLinkLines: [], refreshLine: "" });
      const lines = result.split("\n");
      expect(lines[1]).toBe("\x1b[31m│ Orchestrator snapshot unavailable\x1b[0m");
    });

    it("throughput value is cyan (\\x1b[36m)", () => {
      const result = renderOffline({ tps: 5, projectLinkLines: [], refreshLine: "" });
      expect(result).toContain("\x1b[36m5 tps\x1b[0m");
    });
  });
}
