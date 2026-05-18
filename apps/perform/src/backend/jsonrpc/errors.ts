import type { BackendError } from "../../domain/backend-errors.js";

export const stdioProtocolError = (
  phase: "framing" | "json-parse" | "schema",
  raw: string,
): BackendError => ({ kind: "stdio-protocol-error", phase, raw });

export const jsonRpcError = (code: number, message: string, method?: string): BackendError =>
  method !== undefined
    ? { kind: "jsonrpc-error", code, message, method }
    : { kind: "jsonrpc-error", code, message };

export const requestTimeout = (method: string, timeoutMs: number): BackendError => ({
  kind: "request-timeout",
  method,
  timeoutMs,
});

export const subprocessCrashed = (
  signal: NodeJS.Signals | null,
  exitCode: number | null,
  stderrTail: string,
): BackendError => ({ kind: "subprocess-crashed", signal, exitCode, stderrTail });

export const turnNotCompleted = (
  threadId: string,
  reason: "abort" | "exit-before-complete",
): BackendError => ({ kind: "turn-not-completed", threadId, reason });

export const spawnFailed = (command: string, cause: string): BackendError => ({
  kind: "spawn-failed",
  command,
  cause,
});

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("backend/jsonrpc/errors", () => {
    it("builds stdio-protocol-error", () => {
      const e = stdioProtocolError("framing", "garbage");
      expect(e.kind).toBe("stdio-protocol-error");
      if (e.kind === "stdio-protocol-error") expect(e.phase).toBe("framing");
    });
    it("builds jsonrpc-error with optional method", () => {
      const noMethod = jsonRpcError(-32601, "Method not found");
      expect(noMethod.kind).toBe("jsonrpc-error");
      if (noMethod.kind === "jsonrpc-error") expect(noMethod.method).toBeUndefined();
      const withMethod = jsonRpcError(-32601, "x", "thread/start");
      expect(withMethod.kind).toBe("jsonrpc-error");
      if (withMethod.kind === "jsonrpc-error") expect(withMethod.method).toBe("thread/start");
    });
    it("builds request-timeout", () => {
      const e = requestTimeout("initialize", 30_000);
      expect(e.kind).toBe("request-timeout");
    });
    it("builds turn-not-completed", () => {
      const e = turnNotCompleted("thr_1", "abort");
      expect(e.kind).toBe("turn-not-completed");
    });
  });
}
