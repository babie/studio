import { describe, expect, it } from "vitest";
import { DispatchError } from "../../src/jsonrpc/dispatch-error.js";

describe("DispatchError.toErrorPayload", () => {
  it("ParseError → code -32700", () => {
    const payload = DispatchError.toErrorPayload({ kind: "ParseError" });
    expect(payload.code).toBe(-32700);
    expect(payload.message).toBe("Parse error");
  });

  it("InvalidRequest → code -32600", () => {
    const payload = DispatchError.toErrorPayload({ kind: "InvalidRequest" });
    expect(payload.code).toBe(-32600);
    expect(payload.message).toBe("Invalid Request");
  });

  it("MethodNotFound → code -32601 with method name", () => {
    const payload = DispatchError.toErrorPayload({ kind: "MethodNotFound", method: "foo/bar" });
    expect(payload.code).toBe(-32601);
    expect(payload.message).toContain("foo/bar");
  });

  it("InternalError with Error instance → uses .message", () => {
    const payload = DispatchError.toErrorPayload({
      kind: "InternalError",
      cause: new Error("something went wrong"),
    });
    expect(payload.code).toBe(-32603);
    expect(payload.message).toBe("something went wrong");
  });

  it("InternalError with non-Error cause → uses String()", () => {
    const payload = DispatchError.toErrorPayload({
      kind: "InternalError",
      cause: 42,
    });
    expect(payload.code).toBe(-32603);
    expect(payload.message).toBe("42");
  });
});

describe("DispatchError InvalidParams", () => {
  it("toErrorPayload maps InvalidParams to code -32602 with details", () => {
    const payload = DispatchError.toErrorPayload({
      kind: "InvalidParams",
      message: "params.cwd must be a string",
    });
    expect(payload.code).toBe(-32602);
    expect(payload.message).toContain("params.cwd must be a string");
  });
});
