export type RunningEntry = Readonly<{
  issueId: string;
  identifier: string;
  state: string;
  workerHost: string | null;
  workspacePath: string | null;
  sessionId: string | null;
  codexAppServerPid: number | null;
  codexInputTokens: number;
  codexOutputTokens: number;
  codexTotalTokens: number;
  turnCount: number;
  startedAt: Date;
  lastCodexTimestamp: Date | null;
  lastCodexMessage: string | null;
  lastCodexEvent: string | null;
  runtimeSeconds: number;
}>;

export type RetryEntry = Readonly<{
  issueId: string;
  attempt: number;
  dueInMs: number;
  identifier: string | null;
  error: string | null;
  workerHost: string | null;
  workspacePath: string | null;
}>;

export type CodexTotals = Readonly<{
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  secondsRunning: number;
}>;

export type RateLimitInfo = Readonly<{
  usedPercent: number;
  resetsInMs: number;
}>;

export type RateLimits = Readonly<{
  primary: RateLimitInfo | null;
  secondary: RateLimitInfo | null;
}>;

export type PollingState = Readonly<{
  checking: boolean;
  nextPollInMs: number | null;
  pollIntervalMs: number;
}>;

export type ObservabilityData = Readonly<{
  running: ReadonlyArray<RunningEntry>;
  retrying: ReadonlyArray<RetryEntry>;
  codexTotals: CodexTotals;
  rateLimits: RateLimits | null;
  polling: PollingState;
}>;

export type ObservabilitySnapshot =
  | Readonly<{ type: "ok"; data: ObservabilityData }>
  | Readonly<{ type: "error" }>;

export const EMPTY_CODEX_TOTALS: CodexTotals = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  secondsRunning: 0,
} as const;

export const EMPTY_DATA: ObservabilityData = {
  running: [],
  retrying: [],
  codexTotals: EMPTY_CODEX_TOTALS,
  rateLimits: null,
  polling: { checking: false, nextPollInMs: null, pollIntervalMs: 5_000 },
} as const;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("domain/observability-snapshot", () => {
    it("EMPTY_DATA has zero totals and empty arrays", () => {
      expect(EMPTY_DATA.running.length).toBe(0);
      expect(EMPTY_DATA.retrying.length).toBe(0);
      expect(EMPTY_DATA.codexTotals.totalTokens).toBe(0);
    });
  });
}
