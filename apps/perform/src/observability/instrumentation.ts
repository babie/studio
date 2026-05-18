// apps/conductor/src/observability/instrumentation.ts
import type { RateLimits } from "../domain/observability-snapshot.js";

export type TurnEvent =
  | Readonly<{ kind: "thread-started"; sessionId: string }>
  | Readonly<{ kind: "turn-started" }>
  | Readonly<{ kind: "item-started"; itemType: string }>
  | Readonly<{ kind: "agent-message"; text: string }>
  | Readonly<{ kind: "command-execution"; command: string }>
  | Readonly<{ kind: "file-change"; path: string }>
  | Readonly<{ kind: "item-completed" }>
  | Readonly<{
      kind: "turn-completed";
      usage?: Readonly<{ inputTokens: number; outputTokens: number; totalTokens: number }>;
    }>;

export type ObservabilityHooks = Readonly<{
  onIssueStart: (
    issueId: string,
    identifier: string,
    state: string,
    pid: number | null,
    workspacePath: string | null,
  ) => void;
  onIssueEnd: (issueId: string) => void;
  onTurnEvent: (issueId: string, event: TurnEvent) => void;
  onRetryScheduled: (
    issueId: string,
    attempt: number,
    dueAtMs: number,
    error: string | null,
  ) => void;
  onRetryComplete: (issueId: string) => void;
  onRateLimitObserved: (rateLimits: RateLimits) => void;
  onPollingTick: (nextPollInMs: number | null, intervalMs: number, checking: boolean) => void;
}>;

export const NULL_HOOKS: ObservabilityHooks = {
  onIssueStart: () => {},
  onIssueEnd: () => {},
  onTurnEvent: () => {},
  onRetryScheduled: () => {},
  onRetryComplete: () => {},
  onRateLimitObserved: () => {},
  onPollingTick: () => {},
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("observability/instrumentation", () => {
    it("NULL_HOOKS provides every method as no-op", () => {
      expect(typeof NULL_HOOKS.onIssueStart).toBe("function");
      expect(typeof NULL_HOOKS.onTurnEvent).toBe("function");
      NULL_HOOKS.onIssueStart("x", "y", "z", null, null);
      NULL_HOOKS.onTurnEvent("x", { kind: "turn-started" });
    });
  });
}
