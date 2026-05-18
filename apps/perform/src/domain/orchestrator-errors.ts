// apps/perform/src/domain/orchestrator-errors.ts
import type { ConfigError } from "./config-errors.js";
import type { TrackerError } from "./tracker-errors.js";
import type { BackendError } from "./backend-errors.js";
import type { WorkspaceError } from "./workspace-errors.js";
import type { PromptError } from "./prompt-errors.js";

export type OrchestratorError =
  | Readonly<{ kind: "config"; error: ConfigError }>
  | Readonly<{ kind: "tracker"; error: TrackerError }>
  | Readonly<{ kind: "backend"; error: BackendError }>
  | Readonly<{ kind: "workspace"; error: WorkspaceError }>
  | Readonly<{ kind: "prompt"; error: PromptError }>
  | Readonly<{ kind: "guardrail-missing"; flag: string }>
  | Readonly<{ kind: "stall-restart"; issueId: string; elapsedMs: number }>;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("domain/orchestrator-errors", () => {
    it("nests sub-errors by kind", () => {
      const e: OrchestratorError = { kind: "workspace", error: { kind: "create-failed", path: "/x", cause: "perm" } };
      expect(e.kind).toBe("workspace");
    });
    it("supports guardrail-missing", () => {
      const e: OrchestratorError = { kind: "guardrail-missing", flag: "--i-understand-..." };
      expect(e.kind).toBe("guardrail-missing");
    });
    it("supports session-exited-mid-turn from backend", () => {
      const e: OrchestratorError = {
        kind: "backend",
        error: { kind: "session-exited-mid-turn", exitCode: 1, signal: null },
      };
      expect(e.kind).toBe("backend");
    });
    it("supports aborted from backend", () => {
      const e: OrchestratorError = { kind: "backend", error: { kind: "aborted" } };
      expect(e.error.kind).toBe("aborted");
    });
    it("supports tracker-timeout", () => {
      const e: OrchestratorError = {
        kind: "tracker",
        error: { kind: "tracker-timeout", operation: "fetchCandidates", timeoutMs: 15000 },
      };
      expect(e.error.kind).toBe("tracker-timeout");
    });
    it("supports stall-restart", () => {
      const e: OrchestratorError = { kind: "stall-restart", issueId: "M-1", elapsedMs: 1_900_000 };
      expect(e.kind).toBe("stall-restart");
    });
  });
}
