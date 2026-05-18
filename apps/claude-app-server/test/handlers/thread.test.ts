import { describe, expect, it, vi } from "vitest";
import { Dispatcher } from "../../src/jsonrpc/dispatcher.js";
import { Threads } from "../../src/state/threads.js";
import { registerThreadHandlers } from "../../src/handlers/thread.js";
import type { Session } from "../../src/claude/session.js";

const makeCtx = () => {
  const sendNotification = vi.fn();
  return {
    sendNotification,
    cli: {},
    threads: Threads.create(),
    session: { runTurn: vi.fn() } satisfies Session,
  };
};

const dispatch = async (params: unknown) => {
  const d = Dispatcher.create();
  registerThreadHandlers(d);
  const ctx = makeCtx();
  const res = await d.dispatch(
    { kind: "Request", id: 1 as never, method: "thread/start", params },
    ctx,
  );
  return { res, ctx };
};

describe("thread/start", () => {
  it("returns thread.id starting with thr_", async () => {
    const { res } = await dispatch({});
    expect(res?.kind).toBe("Success");
    if (res?.kind === "Success") {
      expect((res.result as { thread: { id: string } }).thread.id.startsWith("thr_")).toBe(true);
    }
  });

  it("sends a thread/started notification with the same id", async () => {
    const { res, ctx } = await dispatch({});
    const sentMethod = (ctx.sendNotification as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    const sentParams = (ctx.sendNotification as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(sentMethod).toBe("thread/started");
    if (res?.kind === "Success") {
      expect((sentParams as { threadId: string }).threadId).toBe(
        (res.result as { thread: { id: string } }).thread.id,
      );
    }
  });

  it("stores the thread in ctx.threads", async () => {
    const { res, ctx } = await dispatch({});
    if (res?.kind !== "Success") throw new Error("expected success");
    const id = (res.result as { thread: { id: string } }).thread.id;
    expect(ctx.threads.get(id as never)).toBeDefined();
  });

  it("uses params.cwd when provided", async () => {
    const { res, ctx } = await dispatch({ cwd: "/work" });
    if (res?.kind !== "Success") throw new Error("expected success");
    const id = (res.result as { thread: { id: string } }).thread.id;
    expect(ctx.threads.get(id as never)?.options.cwd).toBe("/work");
  });

  it("ignores Codex-origin and unknown params fields (approvalPolicy, sandboxPolicy.writableRoots, networkAccess, effort, etc.)", async () => {
    const { res } = await dispatch({
      cwd: "/w",
      model: "claude-opus-4-7",
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: ["/tmp", "/work"],
        networkAccess: true,
      },
      effort: "low",
      bogus: true,
    });
    expect(res?.kind).toBe("Success");
  });

  it("rejects non-object params with InvalidParams (-32602)", async () => {
    const { res } = await dispatch("not-an-object");
    expect(res?.kind).toBe("Error");
    if (res?.kind === "Error") {
      expect(res.error.code).toBe(-32602);
    }
  });
});
