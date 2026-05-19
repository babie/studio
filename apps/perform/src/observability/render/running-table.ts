/**
 * Running-table renderer — mirrors symphony's format_running_summary/2,
 * running_table_header_row/1, and running_table_separator_row/1.
 *
 * Column layout (left-aligned unless noted):
 *   ID(8)  STAGE(14)  PID(8)  AGE/TURN(12)  TOKENS(10,right)  SESSION(14)  EVENT(dynamic)
 *
 * Separated by single spaces → 6 spaces between 7 columns.
 * separator_width = fixed_running_width + event_width + 6
 *
 * Row chrome: "│ ● " (4 visible chars); header/separator prefix: "│   " (4 visible chars).
 */

import { ANSI, colorize, formatCount, formatRuntimeSeconds } from "./format.js";
import type { RunningEntry } from "../../domain/observability-snapshot.js";

// ── Column widths (mirror @running_* module attributes in symphony) ──────────

const ID_WIDTH = 8;
const STAGE_WIDTH = 14;
const PID_WIDTH = 8;
const AGE_WIDTH = 12;
const TOKENS_WIDTH = 10;
const SESSION_WIDTH = 14;
const EVENT_DEFAULT_WIDTH = 44;
const EVENT_MIN_WIDTH = 12;
const ROW_CHROME_WIDTH = 10;

/** Sum of all fixed column widths (no spaces, no event). */
const FIXED_RUNNING_WIDTH =
  ID_WIDTH + STAGE_WIDTH + PID_WIDTH + AGE_WIDTH + TOKENS_WIDTH + SESSION_WIDTH;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Truncate a string to `width` chars, appending "..." (three ASCII dots, like
 * symphony's `truncate_plain/2`) if it exceeds the limit.
 */
const truncatePlain = (s: string, width: number): string => {
  if (s.length <= width) return s;
  return s.slice(0, width - 3) + "...";
};

/**
 * Format a cell: trim whitespace / newlines, truncate with "..." if too wide,
 * then pad to `width`.  align: "left" (default) or "right".
 * Mirrors symphony's `format_cell/3`.
 */
const formatCell = (value: string, width: number, align: "left" | "right" = "left"): string => {
  const cleaned = value.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  const truncated = truncatePlain(cleaned, width);
  return align === "right" ? truncated.padStart(width) : truncated.padEnd(width);
};

/**
 * Compact a session ID the same way symphony does:
 * if longer than 10 chars → first 4 + "..." + last 6.
 * null / non-string → "n/a".
 */
const compactSessionId = (sessionId: string | null): string => {
  if (sessionId === null) return "n/a";
  if (sessionId.length > 10) {
    return sessionId.slice(0, 4) + "..." + sessionId.slice(-6);
  }
  return sessionId;
};

/**
 * Format runtime seconds + turn count in symphony's "Xm Ys / N" format.
 * When turn_count is 0 (or falsy), just "Xm Ys".
 */
const formatRuntimeAndTurns = (runtimeSeconds: number, turnCount: number): string => {
  const base = formatRuntimeSeconds(runtimeSeconds);
  if (turnCount > 0) return `${base} / ${turnCount}`;
  return base;
};

/**
 * Determine the status color for a running entry based on its last event,
 * mirroring symphony's `status_color` logic inside `format_running_summary/2`.
 */
const statusColor = (lastCodexEvent: string | null): string => {
  switch (lastCodexEvent) {
    case null:
    case "none":
      return ANSI.red;
    case "codex/event/token_count":
      return ANSI.yellow;
    case "codex/event/task_started":
      return ANSI.green;
    case "turn_completed":
      return ANSI.magenta;
    default:
      return ANSI.blue;
  }
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute the event-column width for a given terminal width.
 * Mirrors symphony's `running_event_width/1`.
 *
 * When `terminalColumns` is null the caller must supply the effective terminal
 * width (symphony uses `:io.columns()` or `COLUMNS` env or 120 as default).
 * This function requires an explicit value; pass `120` for the "no terminal"
 * default (which yields EVENT_DEFAULT_WIDTH = 44).
 */
export const runningEventWidth = (terminalColumns: number): number =>
  Math.max(EVENT_MIN_WIDTH, terminalColumns - FIXED_RUNNING_WIDTH - ROW_CHROME_WIDTH);

/**
 * Render the header row for the running table.
 * Output: "│   " + gray("ID       STAGE  … EVENT<padding>")
 */
const renderRunningTableHeader = (eventWidth: number): string => {
  const header = [
    formatCell("ID", ID_WIDTH),
    formatCell("STAGE", STAGE_WIDTH),
    formatCell("PID", PID_WIDTH),
    formatCell("AGE / TURN", AGE_WIDTH),
    formatCell("TOKENS", TOKENS_WIDTH),
    formatCell("SESSION", SESSION_WIDTH),
    formatCell("EVENT", eventWidth),
  ].join(" ");

  return "│   " + colorize(header, ANSI.gray);
};

/**
 * Render the separator row (─ repeated) for the running table.
 * Output: "│   " + gray("─" * separatorWidth)
 */
const renderRunningTableSeparator = (eventWidth: number): string => {
  const separatorWidth = FIXED_RUNNING_WIDTH + eventWidth + 6;
  return "│   " + colorize("─".repeat(separatorWidth), ANSI.gray);
};

/**
 * Render a single running-agent row.
 * Output: "│ ●(color) id(cyan) stage(color) pid(yellow) age(magenta) tokens(yellow) session(cyan) event(color)"
 */
const renderRunningRow = (row: RunningEntry, eventWidth: number): string => {
  const color = statusColor(row.lastCodexEvent);

  const id = formatCell(row.identifier ?? "unknown", ID_WIDTH);
  const stage = formatCell(row.state ?? "unknown", STAGE_WIDTH);
  const pid = formatCell(
    row.codexAppServerPid !== null ? String(row.codexAppServerPid) : "n/a",
    PID_WIDTH,
  );
  const age = formatCell(
    formatRuntimeAndTurns(row.runtimeSeconds ?? 0, row.turnCount ?? 0),
    AGE_WIDTH,
  );
  const tokens = formatCell(formatCount(row.codexTotalTokens ?? 0), TOKENS_WIDTH, "right");
  const session = formatCell(compactSessionId(row.sessionId), SESSION_WIDTH);
  const event = formatCell(row.lastCodexMessage ?? "none", eventWidth);

  return (
    "│ " +
    colorize("●", color) +
    " " +
    colorize(id, ANSI.cyan) +
    " " +
    colorize(stage, color) +
    " " +
    colorize(pid, ANSI.yellow) +
    " " +
    colorize(age, ANSI.magenta) +
    " " +
    colorize(tokens, ANSI.yellow) +
    " " +
    colorize(session, ANSI.cyan) +
    " " +
    colorize(event, color)
  );
};

/**
 * Render all lines for the running section body (no section header "├─ Running").
 * Returns an array of lines (each without trailing newline).
 *
 * Both empty and non-empty cases always emit the table header and separator rows.
 * - When `running` is empty:  ["│", header, separator, "│  " + gray("No active agents"), "│"]
 * - Otherwise:                ["│", header, separator, ...rows (sorted), "│"]
 *
 * Mirrors symphony's format_running_table/2 which renders header+separator
 * unconditionally, then either the "No active agents" placeholder or the
 * sorted agent rows.
 */
export const renderRunningLines = (
  running: ReadonlyArray<RunningEntry>,
  eventWidth: number,
): ReadonlyArray<string> => {
  const header = renderRunningTableHeader(eventWidth);
  const separator = renderRunningTableSeparator(eventWidth);

  if (running.length === 0) {
    return ["│", header, separator, "│  " + colorize("No active agents", ANSI.gray), "│"];
  }

  const sorted = [...running].sort((a, b) =>
    (a.identifier ?? "").localeCompare(b.identifier ?? ""),
  );

  return ["│", header, separator, ...sorted.map((e) => renderRunningRow(e, eventWidth)), "│"];
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  // ── fixture helpers ────────────────────────────────────────────────────────

  const makeEntry = (overrides: Partial<RunningEntry>): RunningEntry => ({
    issueId: "X-1",
    identifier: "X-1",
    state: "In Progress",
    workerHost: null,
    workspacePath: null,
    sessionId: null,
    codexAppServerPid: null,
    codexInputTokens: 0,
    codexOutputTokens: 0,
    codexTotalTokens: 0,
    turnCount: 0,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    lastCodexTimestamp: null,
    lastCodexMessage: null,
    lastCodexEvent: null,
    runtimeSeconds: 0,
    ...overrides,
  });

  // ── one-running-codex fixture entry ────────────────────────────────────────

  const cyfy5: RunningEntry = makeEntry({
    issueId: "CYFY-5",
    identifier: "CYFY-5",
    state: "In Progress",
    codexAppServerPid: 12345,
    codexInputTokens: 800,
    codexOutputTokens: 434,
    codexTotalTokens: 1234,
    runtimeSeconds: 90,
    turnCount: 2,
    sessionId: "thr_abc12345",
    lastCodexEvent: "item done",
    lastCodexMessage: "Implementing feature foo bar baz",
    startedAt: new Date("2026-05-17T10:00:00Z"),
    lastCodexTimestamp: new Date("2026-05-17T10:01:30Z"),
    workspacePath: "/tmp/ws/CYFY-5",
  });

  // ── narrow-terminal fixture entry ─────────────────────────────────────────

  const cyfy99: RunningEntry = makeEntry({
    issueId: "CYFY-99",
    identifier: "CYFY-99",
    state: "In Progress",
    codexAppServerPid: 9999,
    codexInputTokens: 50,
    codexOutputTokens: 20,
    codexTotalTokens: 70,
    runtimeSeconds: 5,
    turnCount: 1,
    sessionId: "thr_short1",
    lastCodexEvent: "agent message",
    lastCodexMessage:
      "very long event description that should be truncated when terminal is narrow",
    startedAt: new Date("2026-05-17T10:00:00Z"),
    lastCodexTimestamp: new Date("2026-05-17T10:00:05Z"),
    workspacePath: "/tmp/ws/CYFY-99",
  });

  describe("observability/render/running-table", () => {
    // ── runningEventWidth ────────────────────────────────────────────────────

    it("runningEventWidth(120) returns EVENT_DEFAULT_WIDTH (44)", () => {
      expect(runningEventWidth(120)).toBe(44);
    });

    it("runningEventWidth(115) returns 39 (used for goldens at COLUMNS=115)", () => {
      expect(runningEventWidth(115)).toBe(39);
    });

    it("runningEventWidth(60) returns EVENT_MIN_WIDTH (12)", () => {
      expect(runningEventWidth(60)).toBe(EVENT_MIN_WIDTH);
    });

    it("runningEventWidth(50) clamps to EVENT_MIN_WIDTH (12)", () => {
      expect(runningEventWidth(50)).toBe(EVENT_MIN_WIDTH);
    });

    // ── compactSessionId ─────────────────────────────────────────────────────

    it("compactSessionId(null) → 'n/a'", () => {
      expect(compactSessionId(null)).toBe("n/a");
    });

    it("compactSessionId short (≤10) passes through", () => {
      expect(compactSessionId("thr_short1")).toBe("thr_short1");
    });

    it("compactSessionId long (>10) → first4 + ... + last6", () => {
      // 'thr_abc12345' length = 12
      expect(compactSessionId("thr_abc12345")).toBe("thr_...c12345");
    });

    // ── formatRuntimeAndTurns ────────────────────────────────────────────────

    it("formatRuntimeAndTurns(90, 2) → '1m 30s / 2'", () => {
      expect(formatRuntimeAndTurns(90, 2)).toBe("1m 30s / 2");
    });

    it("formatRuntimeAndTurns(5, 0) → '0m 5s'", () => {
      expect(formatRuntimeAndTurns(5, 0)).toBe("0m 5s");
    });

    // ── header row ───────────────────────────────────────────────────────────

    it("renderRunningTableHeader(39) matches one-running-codex golden line 10", () => {
      const golden =
        "│   \x1b[90mID       STAGE          PID      AGE / TURN   TOKENS     SESSION        EVENT                                  \x1b[0m";
      expect(renderRunningTableHeader(39)).toBe(golden);
    });

    it("renderRunningTableHeader(12) matches narrow-terminal golden line 10", () => {
      const golden =
        "│   \x1b[90mID       STAGE          PID      AGE / TURN   TOKENS     SESSION        EVENT       \x1b[0m";
      expect(renderRunningTableHeader(12)).toBe(golden);
    });

    // ── separator row ────────────────────────────────────────────────────────

    it("renderRunningTableSeparator(39) matches one-running-codex golden line 11", () => {
      const golden =
        "│   \x1b[90m───────────────────────────────────────────────────────────────────────────────────────────────────────────────\x1b[0m";
      expect(renderRunningTableSeparator(39)).toBe(golden);
    });

    it("renderRunningTableSeparator(12) matches narrow-terminal golden line 11", () => {
      const golden =
        "│   \x1b[90m────────────────────────────────────────────────────────────────────────────────────\x1b[0m";
      expect(renderRunningTableSeparator(12)).toBe(golden);
    });

    // ── data rows ────────────────────────────────────────────────────────────

    it("renderRunningRow(cyfy5, 39) matches one-running-codex golden line 12", () => {
      const golden =
        "│ \x1b[34m●\x1b[0m \x1b[36mCYFY-5  \x1b[0m \x1b[34mIn Progress   \x1b[0m \x1b[33m12345   \x1b[0m \x1b[35m1m 30s / 2  \x1b[0m \x1b[33m     1,234\x1b[0m \x1b[36mthr_...c12345 \x1b[0m \x1b[34mImplementing feature foo bar baz       \x1b[0m";
      expect(renderRunningRow(cyfy5, 39)).toBe(golden);
    });

    it("renderRunningRow(cyfy99, 12) matches narrow-terminal golden line 12", () => {
      const golden =
        "│ \x1b[34m●\x1b[0m \x1b[36mCYFY-99 \x1b[0m \x1b[34mIn Progress   \x1b[0m \x1b[33m9999    \x1b[0m \x1b[35m0m 5s / 1   \x1b[0m \x1b[33m        70\x1b[0m \x1b[36mthr_short1    \x1b[0m \x1b[34mvery long...\x1b[0m";
      expect(renderRunningRow(cyfy99, 12)).toBe(golden);
    });

    // ── empty running list ────────────────────────────────────────────────────

    it("renderRunningLines([]) returns header+separator+'No active agents' lines (empty.txt golden)", () => {
      const lines = renderRunningLines([], 39);
      // ["│", header, separator, "│  No active agents", "│"]
      expect(lines).toHaveLength(5);
      expect(lines[0]).toBe("│");
      // lines[1] = header, lines[2] = separator (verified by other tests)
      expect(lines[3]).toBe("│  \x1b[90mNo active agents\x1b[0m");
      expect(lines[4]).toBe("│");
    });

    // ── multi-row sort order ─────────────────────────────────────────────────

    it("renderRunningLines sorts by identifier", () => {
      const b = makeEntry({ identifier: "CYFY-6", state: "In Progress" });
      const a = makeEntry({ identifier: "CYFY-5", state: "In Progress" });
      const lines = renderRunningLines([b, a], 39);
      // rows: │, header, sep, CYFY-5 row, CYFY-6 row, │
      expect(lines).toHaveLength(6);
      const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
      // index 0=│, 1=header, 2=sep, 3=CYFY-5, 4=CYFY-6, 5=│
      expect(stripAnsi(lines[3] ?? "")).toMatch(/^│ ● CYFY-5 /);
      expect(stripAnsi(lines[4] ?? "")).toMatch(/^│ ● CYFY-6 /);
    });
  });
}
