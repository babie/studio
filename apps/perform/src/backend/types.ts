import type { Result } from "@praha/byethrow";
import type { Issue } from "../domain/issue.js";
import type { AgentConfig } from "../domain/agent-config.js";
import type { BackendError } from "../domain/backend-errors.js";
import type { ServerNotification } from "./jsonrpc/messages.js";

export type StartSessionParams = Readonly<{
  workspace: string;
  issue: Issue;
  agentConfig: AgentConfig;
}>;

export type RunTurnParams = Readonly<{
  prompt: string;
  turnNumber: number;
  maxTurns: number;
  signal: AbortSignal;
  onNotification: (n: ServerNotification) => void;
}>;

export type TurnResult = Readonly<{
  completed: true;
}>;

export type SessionExitInfo = Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
}>;

export type BackendSession = Readonly<{
  runTurn: (params: RunTurnParams) => Promise<Result.Result<TurnResult, BackendError>>;
  shutdown: (opts?: { gracePeriodMs?: number }) => Promise<void>;
  interrupt: () => Promise<void>;
  readonly exitPromise: Promise<SessionExitInfo>;
}>;

export type Backend = Readonly<{
  readonly type: "claude" | "codex" | "mock";
  startSession: (
    params: StartSessionParams,
  ) => Promise<Result.Result<BackendSession, BackendError>>;
}>;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("backend/types", () => {
    it("shape compiles with all three backend types", () => {
      const fake: Backend = {
        type: "mock",
        startSession: async () => ({
          type: "Success",
          value: {
            runTurn: async () => ({ type: "Success", value: { completed: true } }),
            shutdown: async () => {},
            interrupt: async () => {},
            exitPromise: Promise.resolve({ code: 0, signal: null }),
          },
        }),
      };
      expect(fake.type).toBe("mock");
    });
  });
}
