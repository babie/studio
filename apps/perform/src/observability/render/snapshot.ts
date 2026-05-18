// apps/perform/src/observability/render/snapshot.ts
//
// Composes all sub-renderers into a complete TUI frame.
// Output was originally byte-for-byte calibrated against captured ANSI
// goldens in apps/conductor/test/fixtures/dashboard/*.txt (Phase 5,
// retired alongside symphony in Phase 7).
//
// Algorithm originally ported from apps/symphony/lib/symphony_elixir/status_dashboard.ex
// format_snapshot_content/2 — both the :ok and :error branches.
// Elixir retired in M3 Phase 7.

import { ANSI, colorize } from "./format.js";
import { renderHeader } from "./header.js";
import { renderProjectLinkLines, renderProjectRefreshLine } from "./project-link.js";
import type { ProjectLinkInput } from "./project-link.js";
import {
  renderRunningLines,
  runningEventWidth,
} from "./running-table.js";
import { renderBackoffRows, closingBorder } from "./backoff-queue.js";
import { renderOffline } from "./offline.js";
import type { ObservabilitySnapshot } from "../../domain/observability-snapshot.js";

// ---------------------------------------------------------------------------
// FormatRuntimeContext — caller-supplied context (not in snapshot)
// ---------------------------------------------------------------------------

export type FormatRuntimeContext = Readonly<{
  projectLink: ProjectLinkInput;
  maxAgents: number;
}>;

// ---------------------------------------------------------------------------
// formatSnapshot — main entry point
//
// Mirrors symphony's format_snapshot_content/2:
//
//   :ok branch  → full dashboard (header + project + table + backoff)
//   :error branch → offline frame (header + unavailable + tps + project + refresh + border)
//
// Returns a single string; all lines joined with "\n" (no trailing newline).
// ---------------------------------------------------------------------------

export const formatSnapshot = (
  snapshot: ObservabilitySnapshot,
  tps: number,
  terminalColumns: number,
  ctx: FormatRuntimeContext,
): string => {
  const projectLinkLines = renderProjectLinkLines(ctx.projectLink);

  // ── :error branch ─────────────────────────────────────────────────────────
  // Symphony calls format_project_refresh_line(nil) for the error branch,
  // which maps to the "otherwise" clause → gray "n/a".
  if (snapshot.type === "error") {
    const offlineRefreshLine = renderProjectRefreshLine({
      checking: false,
      nextPollInMs: null,
      pollIntervalMs: 5_000,
    });
    return renderOffline({ tps, projectLinkLines, refreshLine: offlineRefreshLine });
  }

  // ── :ok branch ────────────────────────────────────────────────────────────
  const { running, retrying, codexTotals, rateLimits, polling } = snapshot.data;
  const eventWidth = runningEventWidth(terminalColumns);

  const lines: string[] = [
    // Header: ╭─ PERFORM STATUS + agents / throughput / runtime / tokens / rate-limits
    ...renderHeader({
      agentCount: running.length,
      maxAgents: ctx.maxAgents,
      tps,
      codexTotals,
      rateLimits,
    }),
    // Project link (0 or 1 lines depending on tracker kind)
    ...projectLinkLines,
    // Refresh line
    renderProjectRefreshLine(polling),
    // Running section header
    colorize("├─ Running", ANSI.bold),
    // Running lines: handles both empty ("│  No active agents", "│") and
    // non-empty ("│", header, separator, ...rows, "│") cases
    ...renderRunningLines(running, eventWidth),
    // Backoff section header
    colorize("├─ Backoff queue", ANSI.bold),
    "│",
    // Backoff rows (empty state: "│  No queued retries")
    ...renderBackoffRows(retrying),
    // Closing border
    closingBorder(),
  ];

  return lines.join("\n");
};

// ---------------------------------------------------------------------------
// In-source tests
// ---------------------------------------------------------------------------

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("observability/render/snapshot", () => {
    // -------------------------------------------------------------------------
    // Sanity 1: error snapshot contains "snapshot unavailable" and ends with "╰─"
    // -------------------------------------------------------------------------
    it('error snapshot contains "snapshot unavailable" and ends with "╰─"', () => {
      const result = formatSnapshot(
        { type: "error" },
        0,
        115,
        { projectLink: { kind: "linear", projectSlug: null }, maxAgents: 2 },
      );
      expect(result).toContain("snapshot unavailable");
      expect(result.endsWith("╰─")).toBe(true);
    });

    // -------------------------------------------------------------------------
    // Sanity 2: ok snapshot with empty running/retrying contains section markers
    // -------------------------------------------------------------------------
    it("ok empty snapshot contains ├─ Running and ├─ Backoff queue markers", () => {
      const result = formatSnapshot(
        {
          type: "ok",
          data: {
            running: [],
            retrying: [],
            codexTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0, secondsRunning: 0 },
            rateLimits: null,
            polling: { checking: false, nextPollInMs: null, pollIntervalMs: 5_000 },
          },
        },
        0,
        115,
        { projectLink: { kind: "memory" }, maxAgents: 2 },
      );
      expect(result).toContain("├─ Running");
      expect(result).toContain("├─ Backoff queue");
    });
  });
}
