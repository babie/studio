import type { Result } from "@praha/byethrow";
import type { Logger } from "../orchestrator/orchestrator.js";
import type { TrackerError } from "../domain/tracker-errors.js";
import type { TrackerConfig } from "../domain/tracker-config.js";
import type { Tracker } from "./types.js";
import { createMemoryTracker } from "./memory.js";
import { createLinearTracker } from "./linear/adapter.js";
import { createGithubTracker } from "./github/adapter.js";
import { assertNever } from "../util/assert-never.js";
import { Sensitive } from "../util/sensitive.js";

export const createTracker = async (
  config: TrackerConfig,
  deps: { logger: Logger; fetch?: typeof globalThis.fetch },
): Promise<Result.Result<Tracker, TrackerError>> => {
  switch (config.kind) {
    case "memory":
      return { type: "Success", value: createMemoryTracker(config) };
    case "linear":
      return await createLinearTracker(config, deps);
    case "github":
      return await createGithubTracker(config, deps);
    default:
      return assertNever(config);
  }
};

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

  describe("tracker/factory", () => {
    it("constructs a memory tracker synchronously (no fetch)", async () => {
      const r = await createTracker(
        { kind: "memory", activeStates: ["Todo"], terminalStates: ["Done"], issues: [] },
        { logger: silent },
      );
      if (r.type !== "Success") throw new Error("expected success");
      expect(typeof r.value.fetchCandidateIssues).toBe("function");
    });

    it("dispatches to createGithubTracker for github kind", async () => {
      const callCount = { n: 0 };
      const fetchSeq = vi.fn(async () => {
        callCount.n++;
        const body =
          callCount.n === 1 ? { data: { user: null } } : { data: { organization: null } };
        return new Response(JSON.stringify(body), { status: 200 });
      }) as unknown as typeof globalThis.fetch;
      const r = await createTracker(
        {
          kind: "github",
          activeStates: ["Todo"],
          terminalStates: ["Done"],
          apiKey: Sensitive.of("ghp_x"),
          projectOwner: "o",
          projectNumber: 1,
        },
        { logger: silent, fetch: fetchSeq },
      );
      if (r.type !== "Failure") throw new Error("expected failure (project not found)");
      expect(r.error.kind).toBe("github-project-not-found");
      expect(callCount.n).toBe(2);
    });
  });
}
