import { describe, it, expect } from "vitest";
import { extractCodexUsage } from "../../src/backend/jsonrpc/messages.js";

describe("codex turn/completed usage parsing", () => {
  it("extracts a realistic codex payload", () => {
    const params = {
      thread: { id: "thr_abc" },
      usage: { input_tokens: 1024, output_tokens: 512, total_tokens: 1536 },
      finishReason: "stop",
    };
    expect(extractCodexUsage(params)).toEqual({ inputTokens: 1024, outputTokens: 512, totalTokens: 1536 });
  });

  it("returns null for a claude payload without usage", () => {
    const params = { thread: { id: "thr_def" }, finishReason: "stop" };
    expect(extractCodexUsage(params)).toBeNull();
  });

  it("survives malformed usage (non-numeric)", () => {
    expect(extractCodexUsage({ usage: { input_tokens: "x", output_tokens: 0 } })).toBeNull();
  });
});
