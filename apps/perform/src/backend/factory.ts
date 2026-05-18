import type { BackendConfig } from "../domain/backend-config.js";
import type { Logger } from "../orchestrator/orchestrator.js";
import { createClaudeBackend } from "./claude.js";
import { createCodexBackend } from "./codex.js";
import { createMockBackend } from "./mock.js";
import type { Backend } from "./types.js";
import { assertNever } from "../util/assert-never.js";

export const createBackend = (config: BackendConfig, logger: Logger): Backend => {
  switch (config.type) {
    case "claude":
      return createClaudeBackend(config, logger);
    case "codex":
      return createCodexBackend(config, logger);
    case "mock":
      return createMockBackend(config);
    default:
      return assertNever(config);
  }
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
  describe("backend/factory", () => {
    it("creates mock backend", () => {
      expect(createBackend({ type: "mock" }, silent).type).toBe("mock");
    });
    it("creates claude backend factory shape", () => {
      expect(createBackend({ type: "claude", command: "x" }, silent).type).toBe("claude");
    });
    it("creates codex backend factory shape", () => {
      expect(
        createBackend(
          {
            type: "codex",
            command: "x",
            approvalPolicy: "never",
            threadSandbox: "workspace-write",
            turnSandboxPolicy: { type: "workspaceWrite" },
          },
          silent,
        ).type,
      ).toBe("codex");
    });
  });
}
