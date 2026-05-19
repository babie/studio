// apps/perform/src/observability/render/project-link.ts
//
// Algorithm originally ported from apps/symphony/lib/symphony_elixir/status_dashboard.ex
// (format_project_link_lines/0 and format_project_refresh_line/1) — Elixir
// retired in M3 Phase 7.
//
// Output was originally byte-for-byte calibrated against captured ANSI
// goldens in apps/conductor/test/fixtures/dashboard/*.txt (Phase 5,
// retired alongside symphony in Phase 7).
//
// All Phase 5 goldens used tracker.kind: memory so the memory path (returns [])
// was golden-verified.  The linear/github paths are runtime-only but must
// faithfully mirror symphony's format_project_link_lines/0 logic.
//
// Refresh line format (from symphony source + goldens):
//   checking: true       → "│ Next refresh: " bold + "checking now…" cyan
//   nextPollInMs integer → "│ Next refresh: " bold + "<Ns>" cyan
//                          where N = ceil(due_in_ms / 1000) = div(due+999, 1000)
//   otherwise            → "│ Next refresh: " bold + "n/a" gray

import { ANSI, colorize } from "./format.js";
import type { PollingState } from "../../domain/observability-snapshot.js";

// ---------------------------------------------------------------------------
// Project link lines
// ---------------------------------------------------------------------------

export type ProjectLinkInput = Readonly<
  | { kind: "memory" }
  | { kind: "linear"; projectSlug: string | null }
  | { kind: "github"; projectOwner: string | null; projectNumber: number | null }
>;

const linearProjectUrl = (slug: string): string => `https://linear.app/project/${slug}/issues`;

const githubProjectUrl = (owner: string, number: number): string =>
  `https://github.com/orgs/${owner}/projects/${number}`;

/**
 * Render 0 or 1 project link lines.
 *
 * Mirrors symphony's format_project_link_lines/0:
 * - memory → [] (symphony only supports linear, memory has no project URL)
 * - linear with non-empty slug → ["│ Project: " bold + url cyan]
 * - linear with null/empty slug → ["│ Project: " bold + "n/a" gray]
 * - github with owner+number → ["│ Project: " bold + url cyan]
 * - github with missing fields → ["│ Project: " bold + "n/a" gray]
 *
 * Note: symphony also renders a "│ Dashboard: " line when an HTTP server is
 * bound. perform has no HTTP server in M3, so that line is never emitted.
 */
export const renderProjectLinkLines = (input: ProjectLinkInput): ReadonlyArray<string> => {
  if (input.kind === "memory") {
    return [];
  }

  const label = colorize("│ Project: ", ANSI.bold);

  if (input.kind === "linear") {
    const { projectSlug } = input;
    if (typeof projectSlug === "string" && projectSlug !== "") {
      return [label + colorize(linearProjectUrl(projectSlug), ANSI.cyan)];
    }
    return [label + colorize("n/a", ANSI.gray)];
  }

  // github
  const { projectOwner, projectNumber } = input;
  if (
    typeof projectOwner === "string" &&
    projectOwner !== "" &&
    typeof projectNumber === "number"
  ) {
    return [label + colorize(githubProjectUrl(projectOwner, projectNumber), ANSI.cyan)];
  }
  return [label + colorize("n/a", ANSI.gray)];
};

// ---------------------------------------------------------------------------
// Refresh line
// ---------------------------------------------------------------------------

/**
 * Render the "│ Next refresh: ..." line.
 *
 * Mirrors symphony's format_project_refresh_line/1:
 *   %{checking?: true}              → "│ Next refresh: " bold + "checking now…" cyan
 *   %{next_poll_in_ms: integer}     → "│ Next refresh: " bold + "<Ns>" cyan
 *                                     N = ceil(due_in_ms / 1000) using integer division:
 *                                     div(due_in_ms + 999, 1000), clamped to >= 0
 *   _                               → "│ Next refresh: " bold + "n/a" gray
 *
 * The ellipsis in "checking now…" is the Unicode character U+2026 (…), not
 * three ASCII dots.
 */
export const renderProjectRefreshLine = (polling: PollingState): string => {
  const label = colorize("│ Next refresh: ", ANSI.bold);

  if (polling.checking) {
    return label + colorize("checking now…", ANSI.cyan);
  }

  if (typeof polling.nextPollInMs === "number") {
    const dueInMs = Math.max(polling.nextPollInMs, 0);
    const seconds = Math.trunc((dueInMs + 999) / 1000);
    return label + colorize(`${seconds}s`, ANSI.cyan);
  }

  return label + colorize("n/a", ANSI.gray);
};

// ---------------------------------------------------------------------------
// In-source tests
// ---------------------------------------------------------------------------

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  // -------------------------------------------------------------------------
  // renderProjectLinkLines
  // -------------------------------------------------------------------------
  describe("renderProjectLinkLines", () => {
    it("memory → []", () => {
      expect(renderProjectLinkLines({ kind: "memory" })).toEqual([]);
    });

    it("linear with slug → one line with cyan URL", () => {
      const lines = renderProjectLinkLines({ kind: "linear", projectSlug: "my-proj" });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe(
        "\x1b[1m│ Project: \x1b[0m\x1b[36mhttps://linear.app/project/my-proj/issues\x1b[0m",
      );
    });

    it("linear with null slug → one line with gray n/a", () => {
      const lines = renderProjectLinkLines({ kind: "linear", projectSlug: null });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe("\x1b[1m│ Project: \x1b[0m\x1b[90mn/a\x1b[0m");
    });

    it("linear with empty string slug → gray n/a", () => {
      const lines = renderProjectLinkLines({ kind: "linear", projectSlug: "" });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("n/a");
    });

    it("github with owner+number → one line with cyan GitHub URL", () => {
      const lines = renderProjectLinkLines({
        kind: "github",
        projectOwner: "acme",
        projectNumber: 7,
      });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe(
        "\x1b[1m│ Project: \x1b[0m\x1b[36mhttps://github.com/orgs/acme/projects/7\x1b[0m",
      );
    });

    it("github with null owner → gray n/a", () => {
      const lines = renderProjectLinkLines({
        kind: "github",
        projectOwner: null,
        projectNumber: 7,
      });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("n/a");
    });

    it("github with null number → gray n/a", () => {
      const lines = renderProjectLinkLines({
        kind: "github",
        projectOwner: "acme",
        projectNumber: null,
      });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("n/a");
    });
  });

  // -------------------------------------------------------------------------
  // renderProjectRefreshLine — golden-verified cases
  // -------------------------------------------------------------------------
  describe("renderProjectRefreshLine", () => {
    // -----------------------------------------------------------------------
    // { checking: false, nextPollInMs: null, pollIntervalMs: 5000 }
    // → appears in empty.txt and retry-only.txt
    // Golden bytes: \x1b[1m│ Next refresh: \x1b[0m\x1b[90mn/a\x1b[0m
    // -----------------------------------------------------------------------
    it("null nextPollInMs → gray n/a (empty.txt / retry-only.txt golden)", () => {
      const line = renderProjectRefreshLine({
        checking: false,
        nextPollInMs: null,
        pollIntervalMs: 5000,
      });
      expect(line).toBe("\x1b[1m│ Next refresh: \x1b[0m\x1b[90mn/a\x1b[0m");
    });

    // -----------------------------------------------------------------------
    // { checking: false, nextPollInMs: 4500, pollIntervalMs: 5000 }
    // → appears in narrow-terminal.txt, one-running-claude.txt, one-running-codex.txt, rate-limited.txt
    // Golden bytes: \x1b[1m│ Next refresh: \x1b[0m\x1b[36m5s\x1b[0m
    // ceil(4500 / 1000) = 5
    // -----------------------------------------------------------------------
    it("nextPollInMs: 4500 → cyan 5s (narrow-terminal / one-running-codex golden)", () => {
      const line = renderProjectRefreshLine({
        checking: false,
        nextPollInMs: 4500,
        pollIntervalMs: 5000,
      });
      expect(line).toBe("\x1b[1m│ Next refresh: \x1b[0m\x1b[36m5s\x1b[0m");
    });

    // -----------------------------------------------------------------------
    // { checking: false, nextPollInMs: 3000, pollIntervalMs: 5000 }
    // → appears in multi-running.txt
    // Golden bytes: \x1b[1m│ Next refresh: \x1b[0m\x1b[36m3s\x1b[0m
    // ceil(3000 / 1000) = 3
    // -----------------------------------------------------------------------
    it("nextPollInMs: 3000 → cyan 3s (multi-running.txt golden)", () => {
      const line = renderProjectRefreshLine({
        checking: false,
        nextPollInMs: 3000,
        pollIntervalMs: 5000,
      });
      expect(line).toBe("\x1b[1m│ Next refresh: \x1b[0m\x1b[36m3s\x1b[0m");
    });

    // -----------------------------------------------------------------------
    // { checking: true, nextPollInMs: 0, pollIntervalMs: 5000 }
    // Not in Phase 5 goldens (all fixtures have checking: false), but must
    // faithfully mirror symphony's format_project_refresh_line(%{checking?: true}).
    // Symphony: colorize("│ Next refresh: ", @ansi_bold) <> colorize("checking now…", @ansi_cyan)
    // The ellipsis is U+2026, not three ASCII dots.
    // -----------------------------------------------------------------------
    it("checking: true → cyan 'checking now…' with Unicode ellipsis", () => {
      const line = renderProjectRefreshLine({
        checking: true,
        nextPollInMs: 0,
        pollIntervalMs: 5000,
      });
      expect(line).toBe("\x1b[1m│ Next refresh: \x1b[0m\x1b[36mchecking now…\x1b[0m");
      // Ensure it's the Unicode ellipsis (…), not three ASCII dots (...)
      expect(line).toContain("checking now…");
      expect(line).not.toContain("checking now...");
    });

    // -----------------------------------------------------------------------
    // Boundary: nextPollInMs: 0 (not checking) → 0s
    // -----------------------------------------------------------------------
    it("nextPollInMs: 0 → cyan 0s", () => {
      const line = renderProjectRefreshLine({
        checking: false,
        nextPollInMs: 0,
        pollIntervalMs: 5000,
      });
      expect(line).toBe("\x1b[1m│ Next refresh: \x1b[0m\x1b[36m0s\x1b[0m");
    });

    // -----------------------------------------------------------------------
    // Boundary: nextPollInMs: 1000 → exactly 1s (no ceiling needed)
    // -----------------------------------------------------------------------
    it("nextPollInMs: 1000 → cyan 1s", () => {
      const line = renderProjectRefreshLine({
        checking: false,
        nextPollInMs: 1000,
        pollIntervalMs: 5000,
      });
      expect(line).toBe("\x1b[1m│ Next refresh: \x1b[0m\x1b[36m1s\x1b[0m");
    });

    // -----------------------------------------------------------------------
    // Boundary: nextPollInMs: 1001 → 2s (ceiling)
    // -----------------------------------------------------------------------
    it("nextPollInMs: 1001 → cyan 2s (ceiling)", () => {
      const line = renderProjectRefreshLine({
        checking: false,
        nextPollInMs: 1001,
        pollIntervalMs: 5000,
      });
      expect(line).toBe("\x1b[1m│ Next refresh: \x1b[0m\x1b[36m2s\x1b[0m");
    });

    // -----------------------------------------------------------------------
    // Boundary: negative nextPollInMs → clamped to 0 → 0s
    // -----------------------------------------------------------------------
    it("negative nextPollInMs → clamped → 0s", () => {
      const line = renderProjectRefreshLine({
        checking: false,
        nextPollInMs: -500,
        pollIntervalMs: 5000,
      });
      expect(line).toBe("\x1b[1m│ Next refresh: \x1b[0m\x1b[36m0s\x1b[0m");
    });
  });
}
