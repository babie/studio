// NOTE: This file uses `type` (not `kind`) as the discriminant intentionally,
// because the YAML schema (`agent.type: "claude" | "codex" | "mock"`) is the
// user-facing contract and we want a 1:1 mapping between YAML and TS shapes.
// Codex's `turn_sandbox_policy` payload (sent over JSON-RPC) also uses `type`,
// so swapping in `kind` would force a translation layer on both ends.
//
// See TODO.md (M4+) for the plan to unify on `kind` across the codebase.

export type ClaudeBackend = Readonly<{
  type: "claude";
  command: string;
}>;

export type CodexSandboxPolicy =
  | Readonly<{ type: "workspaceWrite" }>
  | Readonly<{ type: "readOnly" }>
  | Readonly<{ type: "dangerFullAccess" }>;

export type CodexBackend = Readonly<{
  type: "codex";
  command: string;
  approvalPolicy: "never" | "untrusted" | "on-failure";
  threadSandbox: "workspace-write" | "read-only" | "danger-full-access";
  turnSandboxPolicy: CodexSandboxPolicy;
}>;

export type MockBackend = Readonly<{
  type: "mock";
  delayMs?: number;
  forceFail?: boolean;
  exitMidTurn?: boolean;  // test-only — README does NOT advertise
}>;

export type BackendConfig = ClaudeBackend | CodexBackend | MockBackend;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("domain/backend-config", () => {
    it("discriminates by `type`", () => {
      const mock: BackendConfig = { type: "mock", delayMs: 0 };
      expect(mock.type).toBe("mock");
    });

    it("admits claude and codex shapes", () => {
      const claude: BackendConfig = { type: "claude", command: "claude-app-server" };
      const codex: BackendConfig = {
        type: "codex",
        command: "codex app-server",
        approvalPolicy: "never",
        threadSandbox: "workspace-write",
        turnSandboxPolicy: { type: "workspaceWrite" },
      };
      expect(claude.type).toBe("claude");
      expect(codex.type).toBe("codex");
    });
  });
}
