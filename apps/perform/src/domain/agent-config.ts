import type { BackendConfig } from "./backend-config.js";

export type AgentConfig = Readonly<{
  backend: BackendConfig;
  maxConcurrentAgents: number;
  maxTurns: number;
  /** Maximum cumulative backoff delay (ms) for retrying a failed agent run. Default 300_000 (5 min). */
  maxRetryBackoffMs: number;
  /** Milliseconds of no progress before a running agent is considered stalled. Default 1_800_000 (30 min). */
  agentSessionStallTimeoutMs: number;
  /** Per-state cap on concurrent agents (e.g. { "In Progress": 2 }). Default {}. */
  maxConcurrentAgentsByState: Readonly<Record<string, number>>;
}>;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("domain/agent-config", () => {
    it("composes backend with concurrency / turn limits", () => {
      const config: AgentConfig = {
        backend: { type: "mock", delayMs: 0 },
        maxConcurrentAgents: 1,
        maxTurns: 1,
        maxRetryBackoffMs: 300_000,
        agentSessionStallTimeoutMs: 1_800_000,
        maxConcurrentAgentsByState: {},
      };
      expect(config.backend.type).toBe("mock");
      expect(config.maxConcurrentAgents).toBe(1);
      expect(config.maxRetryBackoffMs).toBe(300_000);
      expect(config.agentSessionStallTimeoutMs).toBe(1_800_000);
      expect(config.maxConcurrentAgentsByState).toEqual({});
    });
  });
}
