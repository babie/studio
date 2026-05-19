import type { Result } from "@praha/byethrow";
import type { MockBackend } from "../domain/backend-config.js";
import type { BackendError } from "../domain/backend-errors.js";
import type { Backend, BackendSession, SessionExitInfo, StartSessionParams } from "./types.js";
import type { Issue } from "../domain/issue.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const createMockBackend = (config: MockBackend): Backend => ({
  type: "mock",
  startSession: async (
    _params: StartSessionParams,
  ): Promise<Result.Result<BackendSession, BackendError>> => {
    let resolveExit!: (info: SessionExitInfo) => void;
    const exitPromise = new Promise<SessionExitInfo>((res) => {
      resolveExit = res;
    });
    const session: BackendSession = {
      runTurn: async () => {
        if (config.delayMs && config.delayMs > 0) await sleep(config.delayMs);
        if (config.exitMidTurn) {
          resolveExit({ code: 1, signal: null });
          return {
            type: "Failure",
            error: { kind: "session-exited-mid-turn", exitCode: 1, signal: null },
          };
        }
        if (config.forceFail) {
          return {
            type: "Failure",
            error: { kind: "mock-forced-failure", reason: "configured force_fail" },
          };
        }
        return { type: "Success", value: { completed: true } };
      },
      shutdown: async () => {
        resolveExit({ code: 0, signal: null });
      },
      interrupt: async () => {
        resolveExit({ code: null, signal: "SIGTERM" });
      },
      exitPromise,
    };
    return { type: "Success", value: session };
  },
});

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  const v = await import("valibot");
  const { IssueId, IssueIdentifier, IssueStateName } = await import("../domain/issue.js");

  const issue = {
    id: v.parse(IssueId.schema, "M-1"),
    identifier: v.parse(IssueIdentifier.schema, "M-1"),
    title: "t",
    description: "",
    state: v.parse(IssueStateName.schema, "Todo"),
    priority: null,
    createdAt: null,
    assigneeId: null,
    assignedToWorker: true,
    blockedBy: [],
  } as const satisfies Issue;
  const agentConfig = {
    backend: { type: "mock" as const },
    maxConcurrentAgents: 1,
    maxTurns: 1,
    maxRetryBackoffMs: 300_000,
    agentSessionStallTimeoutMs: 1_800_000,
    maxConcurrentAgentsByState: {},
  };
  const ctrl = new AbortController();

  describe("backend/mock", () => {
    it("returns completed=true by default", async () => {
      const b = createMockBackend({ type: "mock" });
      const s = await b.startSession({ workspace: "/tmp", issue, agentConfig });
      if (s.type !== "Success") throw new Error("expected success");
      const r = await s.value.runTurn({
        prompt: "x",
        turnNumber: 1,
        maxTurns: 1,
        signal: ctrl.signal,
        onNotification: () => {},
      });
      if (r.type !== "Success") throw new Error("expected success");
      expect(r.value.completed).toBe(true);
    });

    it("respects forceFail", async () => {
      const b = createMockBackend({ type: "mock", forceFail: true });
      const s = await b.startSession({ workspace: "/tmp", issue, agentConfig });
      if (s.type !== "Success") throw new Error("expected success");
      const r = await s.value.runTurn({
        prompt: "x",
        turnNumber: 1,
        maxTurns: 1,
        signal: ctrl.signal,
        onNotification: () => {},
      });
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("mock-forced-failure");
    });

    it("honours delayMs > 0 within timing tolerance", async () => {
      const b = createMockBackend({ type: "mock", delayMs: 20 });
      const s = await b.startSession({ workspace: "/tmp", issue, agentConfig });
      if (s.type !== "Success") throw new Error("expected success");
      const t0 = Date.now();
      await s.value.runTurn({
        prompt: "x",
        turnNumber: 1,
        maxTurns: 1,
        signal: ctrl.signal,
        onNotification: () => {},
      });
      const elapsed = Date.now() - t0;
      expect(elapsed).toBeGreaterThanOrEqual(15);
    });

    it("exitPromise resolves with code 0 on shutdown", async () => {
      const b = createMockBackend({ type: "mock" });
      const s = await b.startSession({ workspace: "/tmp", issue, agentConfig });
      if (s.type !== "Success") throw new Error("expected success");
      await s.value.shutdown();
      const info = await s.value.exitPromise;
      expect(info.code).toBe(0);
    });

    it("exitMidTurn=true returns session-exited-mid-turn Failure and resolves exitPromise", async () => {
      const b = createMockBackend({ type: "mock", exitMidTurn: true });
      const s = await b.startSession({ workspace: "/tmp", issue, agentConfig });
      if (s.type !== "Success") throw new Error("expected success");
      const r = await s.value.runTurn({
        prompt: "x",
        turnNumber: 1,
        maxTurns: 1,
        signal: new AbortController().signal,
        onNotification: () => {},
      });
      expect(r.type).toBe("Failure");
      if (r.type === "Failure") expect(r.error.kind).toBe("session-exited-mid-turn");
      const info = await s.value.exitPromise;
      expect(info.code).toBe(1);
    });
  });
}
