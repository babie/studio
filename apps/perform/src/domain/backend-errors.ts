// apps/perform/src/domain/backend-errors.ts
export type BackendError =
  | Readonly<{ kind: "mock-forced-failure"; reason: string }>
  | Readonly<{ kind: "spawn-failed"; command: string; cause: string }>
  | Readonly<{
      kind: "stdio-protocol-error";
      phase: "framing" | "json-parse" | "schema";
      raw: string;
    }>
  | Readonly<{ kind: "jsonrpc-error"; code: number; message: string; method?: string }>
  | Readonly<{ kind: "request-timeout"; method: string; timeoutMs: number }>
  | Readonly<{
      kind: "subprocess-crashed";
      signal: NodeJS.Signals | null;
      exitCode: number | null;
      stderrTail: string;
    }>
  | Readonly<{
      kind: "turn-not-completed";
      threadId: string;
      reason: "abort" | "exit-before-complete";
    }>
  | Readonly<{ kind: "session-exited-mid-turn"; exitCode: number | null; signal: string | null }>
  | Readonly<{ kind: "aborted" }>;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("domain/backend-errors", () => {
    it("discriminates subprocess-crashed", () => {
      const e: BackendError = {
        kind: "subprocess-crashed",
        signal: "SIGTERM",
        exitCode: null,
        stderrTail: "boom",
      };
      expect(e.kind).toBe("subprocess-crashed");
    });
    it("discriminates session-exited-mid-turn", () => {
      const e: BackendError = { kind: "session-exited-mid-turn", exitCode: 1, signal: null };
      expect(e.kind).toBe("session-exited-mid-turn");
    });
    it("discriminates aborted", () => {
      const e: BackendError = { kind: "aborted" };
      expect(e.kind).toBe("aborted");
    });
  });
}
