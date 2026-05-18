import { describe, expect, it } from "vitest";
import { resolveThreadOptions, toSdkOptions } from "../../src/claude/session-options.js";
import type { ServerOptions } from "../../src/server.js";
import { SessionId } from "../../src/util/ids.js";

const cli = (over: Partial<ServerOptions> = {}): ServerOptions => ({ ...over });

describe("resolveThreadOptions", () => {
  it("uses CLI cwd default = process.cwd() when params has no cwd", () => {
    const r = resolveThreadOptions({ cli: cli(), params: {} });
    expect(r.cwd).toBe(process.cwd());
  });

  it("params.cwd overrides CLI default", () => {
    const r = resolveThreadOptions({ cli: cli(), params: { cwd: "/work" } });
    expect(r.cwd).toBe("/work");
  });

  it("maps sandboxPolicy.type to permissionMode (workspaceWrite -> acceptEdits)", () => {
    const r = resolveThreadOptions({
      cli: cli(),
      params: { sandboxPolicy: { type: "workspaceWrite" } },
    });
    expect(r.permissionMode).toBe("acceptEdits");
  });

  it("maps dangerFullAccess -> bypassPermissions", () => {
    const r = resolveThreadOptions({
      cli: cli(),
      params: { sandboxPolicy: { type: "dangerFullAccess" } },
    });
    expect(r.permissionMode).toBe("bypassPermissions");
  });

  it("maps readOnly -> default", () => {
    const r = resolveThreadOptions({
      cli: cli(),
      params: { sandboxPolicy: { type: "readOnly" } },
    });
    expect(r.permissionMode).toBe("default");
  });

  it("uses CLI permissionMode when params has no sandboxPolicy", () => {
    const r = resolveThreadOptions({
      cli: cli({ permissionMode: "bypassPermissions" }),
      params: {},
    });
    expect(r.permissionMode).toBe("bypassPermissions");
  });

  it("falls back to 'default' when neither CLI nor params specify", () => {
    const r = resolveThreadOptions({ cli: cli(), params: {} });
    expect(r.permissionMode).toBe("default");
  });

  it("passes through CLI model when params lacks model", () => {
    const r = resolveThreadOptions({ cli: cli({ model: "claude-opus-4-7" }), params: {} });
    expect(r.model).toBe("claude-opus-4-7");
  });

  it("params.model overrides CLI model", () => {
    const r = resolveThreadOptions({
      cli: cli({ model: "claude-opus-4-7" }),
      params: { model: "claude-sonnet-4-6" },
    });
    expect(r.model).toBe("claude-sonnet-4-6");
  });

  it("passes through CLI allowedTools", () => {
    const r = resolveThreadOptions({
      cli: cli({ allowedTools: ["Bash"] }),
      params: {},
    });
    expect(r.allowedTools).toEqual(["Bash"]);
  });

  it("ignores unknown params fields (does not throw)", () => {
    const r = resolveThreadOptions({
      cli: cli(),
      params: { approvalPolicy: "never", arbitraryField: 1 },
    });
    expect(r.permissionMode).toBe("default");
  });
});

describe("toSdkOptions", () => {
  const baseThread = {
    cwd: "/w",
    permissionMode: "bypassPermissions" as const,
  };

  it("includes cwd / permissionMode / abortController", () => {
    const abort = new AbortController();
    const opts = toSdkOptions({ thread: baseThread, abortController: abort });
    expect(opts.cwd).toBe("/w");
    expect(opts.permissionMode).toBe("bypassPermissions");
    expect(opts.abortController).toBe(abort);
  });

  it("attaches canUseTool that allows every tool", async () => {
    const opts = toSdkOptions({ thread: baseThread, abortController: new AbortController() });
    const decision = await opts.canUseTool("Bash", { command: "ls" }, {} as never);
    expect(decision).toEqual({ behavior: "allow", updatedInput: { command: "ls" } });
  });

  it("passes resume when provided", () => {
    const sid = SessionId.parse("sess-1");
    if (sid.type !== "Success") throw new Error("setup");
    const opts = toSdkOptions({
      thread: baseThread,
      abortController: new AbortController(),
      resume: sid.value,
    });
    expect(opts.resume).toBe("sess-1");
  });

  it("omits resume when undefined", () => {
    const opts = toSdkOptions({
      thread: baseThread,
      abortController: new AbortController(),
    });
    expect(opts.resume).toBeUndefined();
  });

  it("includes model and allowedTools when present", () => {
    const opts = toSdkOptions({
      thread: { ...baseThread, model: "claude-opus-4-7", allowedTools: ["Bash"] },
      abortController: new AbortController(),
    });
    expect(opts.model).toBe("claude-opus-4-7");
    expect(opts.allowedTools).toEqual(["Bash"]);
  });
});
