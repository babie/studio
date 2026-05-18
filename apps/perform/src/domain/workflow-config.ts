import type { AgentConfig } from "./agent-config.js";
import type { TrackerConfig } from "./tracker-config.js";
import type { WorkspaceConfig } from "./workspace-config.js";
import type { HooksConfig } from "./hooks-config.js";
import type { ObservabilityConfig } from "../observability/runtime-config.js";
import type { PollingConfig } from "./polling-config.js";
import type { LoggingConfig } from "./logging-config.js";

export type WorkflowConfig = Readonly<{
  agent: AgentConfig;
  tracker: TrackerConfig;
  workspace?: WorkspaceConfig;
  hooks?: HooksConfig;
  /** Raw markdown body following the YAML front matter — rendered by prompt/builder.ts. */
  prompt: string;
  observability: ObservabilityConfig;
  /** Polling interval for new issues. Always populated with defaults when YAML omits the block. */
  polling: PollingConfig;
  /** File logger config. null = no file logger (e.g. in tests without a logging: block). */
  logging: LoggingConfig | null;
}>;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("domain/workflow-config", () => {
    it("aggregates agent / tracker / workspace / hooks / prompt", () => {
      const cfg: WorkflowConfig = {
        agent: {
          backend: { type: "mock" },
          maxConcurrentAgents: 1,
          maxTurns: 1,
          maxRetryBackoffMs: 300_000,
          agentSessionStallTimeoutMs: 1_800_000,
          maxConcurrentAgentsByState: {},
        },
        tracker: {
          kind: "memory",
          activeStates: ["Todo"],
          terminalStates: ["Done"],
          issues: [],
        },
        workspace: { root: "/tmp/ws" },
        hooks: { afterCreate: "git init", timeoutMs: 30_000 },
        prompt: "hello",
        observability: { dashboardEnabled: true, refreshMs: 1000, renderIntervalMs: 16 },
        polling: { intervalMs: 5_000 },
        logging: null,
      };
      expect(cfg.prompt).toBe("hello");
      expect(cfg.hooks?.afterCreate).toBe("git init");
      expect(cfg.polling.intervalMs).toBe(5_000);
    });
  });
}
