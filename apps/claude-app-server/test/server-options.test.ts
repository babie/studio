import { describe, expect, it } from "vitest";
import { Result } from "@praha/byethrow";
import { ServerOptions } from "../src/server.js";

describe("ServerOptions.parse", () => {
  it("accepts valid permissionMode", () => {
    const r = ServerOptions.parse({ permissionMode: "bypassPermissions" });
    expect(Result.isSuccess(r)).toBe(true);
  });

  it("rejects invalid permissionMode", () => {
    const r = ServerOptions.parse({ permissionMode: "bogus" });
    expect(Result.isFailure(r)).toBe(true);
  });

  it("accepts undefined options", () => {
    const r = ServerOptions.parse({});
    expect(Result.isSuccess(r)).toBe(true);
  });

  it("accepts all valid permissionMode values", () => {
    for (const mode of ["default", "acceptEdits", "bypassPermissions"]) {
      const r = ServerOptions.parse({ permissionMode: mode });
      expect(Result.isSuccess(r)).toBe(true);
    }
  });

  it("accepts model string", () => {
    const r = ServerOptions.parse({ model: "claude-opus-4-7" });
    expect(Result.isSuccess(r)).toBe(true);
  });

  it("accepts allowedTools array", () => {
    const r = ServerOptions.parse({ allowedTools: ["Bash", "Read"] });
    expect(Result.isSuccess(r)).toBe(true);
  });

  it("failure result contains issues array", () => {
    const r = ServerOptions.parse({ permissionMode: "bogus" });
    expect(Result.isFailure(r)).toBe(true);
    if (Result.isFailure(r)) {
      expect(r.error.kind).toBe("ValidationError");
      expect(r.error.issues.length).toBeGreaterThan(0);
    }
  });
});
