import { describe, expect, it, vi } from "vitest";
import { Dispatcher, type HandlerContext } from "../../src/jsonrpc/dispatcher.js";
import { Id } from "../../src/jsonrpc/id.js";
import type { IncomingMessage } from "../../src/jsonrpc/incoming-message.js";

const makeCtx = (): HandlerContext => ({ sendNotification: vi.fn() });

// branded Id を test 用に作るヘルパー
const idOf = (raw: number | string): Id => {
  const parsed = Id.schema["~standard"].validate(raw);
  if (parsed instanceof Promise) throw new Error("sync only");
  if (parsed.issues) throw new Error(`invalid id: ${raw}`);
  return parsed.value;
};

const request = (id: Id, method: string, params?: unknown): IncomingMessage =>
  ({ kind: "Request", id, method, params }) as const satisfies IncomingMessage;

const notification = (method: string, params?: unknown): IncomingMessage =>
  ({ kind: "Notification", method, params }) as const satisfies IncomingMessage;

describe("Dispatcher", () => {
  it("routes a registered request to its handler and returns a Success response", async () => {
    const d = Dispatcher.create();
    d.registerRequest("hello", () => ({ greeting: "hi" }));
    const res = await d.dispatch(request(idOf(1), "hello"), makeCtx());
    expect(res).toEqual({ kind: "Success", id: 1, result: { greeting: "hi" } });
  });

  it("returns Method not found error for an unregistered request", async () => {
    const d = Dispatcher.create();
    const res = await d.dispatch(request(idOf(7), "missing"), makeCtx());
    expect(res).toEqual({
      kind: "Error",
      id: 7,
      error: { code: -32601, message: "Method not found: missing" },
    });
  });

  it("returns Internal error when a request handler throws", async () => {
    const d = Dispatcher.create();
    d.registerRequest("boom", () => {
      throw new Error("kaboom");
    });
    const res = await d.dispatch(request(idOf(9), "boom"), makeCtx());
    expect(res).toEqual({
      kind: "Error",
      id: 9,
      error: { code: -32603, message: "kaboom" },
    });
  });

  it("returns null for a notification (no response written)", async () => {
    const d = Dispatcher.create();
    const handler = vi.fn();
    d.registerNotification("ping", handler);
    const res = await d.dispatch(notification("ping", { x: 1 }), makeCtx());
    expect(res).toBeNull();
    expect(handler).toHaveBeenCalledWith({ x: 1 }, expect.any(Object));
  });

  it("returns null when a notification handler throws", async () => {
    const d = Dispatcher.create();
    d.registerNotification("ping", () => {
      throw new Error("ignored");
    });
    const res = await d.dispatch(notification("ping"), makeCtx());
    expect(res).toBeNull();
  });

  it("returns null and ignores unregistered notifications", async () => {
    const d = Dispatcher.create();
    const res = await d.dispatch(notification("anything"), makeCtx());
    expect(res).toBeNull();
  });

  it("returns ParseError code for ParseError kind", async () => {
    const d = Dispatcher.create();
    const res = await d.dispatch({ kind: "ParseError", line: "not-json" }, makeCtx());
    expect(res).toEqual({
      kind: "Error",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  });

  it("returns InvalidRequest code for InvalidMessage kind", async () => {
    const d = Dispatcher.create();
    const res = await d.dispatch({ kind: "InvalidMessage", issues: [] }, makeCtx());
    expect(res).toEqual({
      kind: "Error",
      id: null,
      error: { code: -32600, message: "Invalid Request" },
    });
  });
});
