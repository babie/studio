import type { Issue } from "./issue.js";
import type { Sensitive } from "../util/sensitive.js";

type TrackerCommon = Readonly<{
  activeStates: ReadonlyArray<string>;
  terminalStates: ReadonlyArray<string>;
  doingState?: string;
  doneState?: string;
}>;

export type MemoryTrackerConfig = TrackerCommon &
  Readonly<{
    kind: "memory";
    issues: ReadonlyArray<Issue>;
  }>;

export type LinearTrackerConfig = TrackerCommon &
  Readonly<{
    kind: "linear";
    apiKey: Sensitive<string>;
    endpoint?: string;
    projectSlug: string;
    assignee?: string;
  }>;

export type GithubTrackerConfig = TrackerCommon &
  Readonly<{
    kind: "github";
    apiKey: Sensitive<string>;
    endpoint?: string;
    projectOwner: string;
    projectNumber: number;
    assignee?: string;
  }>;

export type TrackerConfig = MemoryTrackerConfig | LinearTrackerConfig | GithubTrackerConfig;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  const { Sensitive } = await import("../util/sensitive.js");

  describe("domain/tracker-config", () => {
    it("composes a memory tracker with issues", () => {
      const cfg: TrackerConfig = {
        kind: "memory",
        activeStates: ["Todo"],
        terminalStates: ["Done", "Closed"],
        doingState: "In Progress",
        doneState: "Done",
        issues: [],
      };
      expect(cfg.kind).toBe("memory");
    });

    it("composes a linear tracker", () => {
      const cfg: TrackerConfig = {
        kind: "linear",
        activeStates: ["Todo"],
        terminalStates: ["Done"],
        apiKey: Sensitive.of("lin_xxx"),
        projectSlug: "studio-xxx",
      };
      expect(cfg.kind).toBe("linear");
    });

    it("composes a github tracker", () => {
      const cfg: TrackerConfig = {
        kind: "github",
        activeStates: ["Todo"],
        terminalStates: ["Done"],
        apiKey: Sensitive.of("ghp_xxx"),
        projectOwner: "babie",
        projectNumber: 1,
      };
      expect(cfg.kind).toBe("github");
    });
  });
}
