import { describe, expect, it, vi } from "vitest";
import { Dispatcher, type HandlerContext } from "../../src/jsonrpc/dispatcher.js";
import { Threads } from "../../src/state/threads.js";
import { registerStub, registerStubs } from "../../src/handlers/stub.js";
import type { Session } from "../../src/claude/session.js";

const makeCtx = (): HandlerContext => ({
  sendNotification: vi.fn(),
  cli: {},
  threads: Threads.create(),
  session: { runTurn: vi.fn() } satisfies Session,
});

describe("registerStubs", () => {
  it("answers mcpServerStatus/list with { servers: [] }", async () => {
    const d = Dispatcher.create();
    registerStubs(d);
    const res = await d.dispatch(
      { kind: "Request", id: 1 as never, method: "mcpServerStatus/list", params: {} },
      makeCtx(),
    );
    expect(res?.kind).toBe("Success");
    if (res?.kind === "Success") {
      expect(res.result).toEqual({ servers: [] });
    }
  });

  it("leaves other unregistered methods to dispatcher default (-32601)", async () => {
    const d = Dispatcher.create();
    registerStubs(d);
    const res = await d.dispatch(
      { kind: "Request", id: 2 as never, method: "account/login", params: {} },
      makeCtx(),
    );
    expect(res?.kind).toBe("Error");
    if (res?.kind === "Error") {
      expect(res.error.code).toBe(-32601);
    }
  });
});

describe("registerStub", () => {
  it("registers an arbitrary method with a static response", async () => {
    const d = Dispatcher.create();
    registerStub(d, "thread/resume", { thread: { id: "thr_dummy" } });
    const res = await d.dispatch(
      { kind: "Request", id: 3 as never, method: "thread/resume", params: {} },
      makeCtx(),
    );
    expect(res?.kind).toBe("Success");
    if (res?.kind === "Success") {
      expect(res.result).toEqual({ thread: { id: "thr_dummy" } });
    }
  });
});
