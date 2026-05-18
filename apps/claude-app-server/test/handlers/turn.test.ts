import { describe, expect, it, vi } from "vitest";
import { Dispatcher, type HandlerContext } from "../../src/jsonrpc/dispatcher.js";
import { Threads } from "../../src/state/threads.js";
import { registerThreadHandlers } from "../../src/handlers/thread.js";
import { registerTurnHandlers } from "../../src/handlers/turn.js";

const makeCtx = (runTurn = vi.fn().mockResolvedValue(undefined)) => {
  const sendNotification = vi.fn();
  const ctx: HandlerContext = {
    sendNotification,
    cli: {},
    threads: Threads.create(),
    session: { runTurn },
  };
  return { ctx, sendNotification, runTurn };
};

const startThread = async (d: Dispatcher, ctx: HandlerContext) => {
  const res = await d.dispatch(
    { kind: "Request", id: 1 as never, method: "thread/start", params: {} },
    ctx,
  );
  if (res?.kind !== "Success") throw new Error("setup");
  return (res.result as { thread: { id: string } }).thread.id;
};

describe("turn/start", () => {
  it("returns a turn with status:inProgress and id starting with turn_", async () => {
    const d = Dispatcher.create();
    registerThreadHandlers(d);
    registerTurnHandlers(d);
    const { ctx } = makeCtx();
    const threadId = await startThread(d, ctx);

    const res = await d.dispatch(
      {
        kind: "Request",
        id: 2 as never,
        method: "turn/start",
        params: { threadId, input: [{ type: "text", text: "hi" }] },
      },
      ctx,
    );
    expect(res?.kind).toBe("Success");
    if (res?.kind === "Success") {
      const turn = (res.result as { turn: { id: string; status: string } }).turn;
      expect(turn.id.startsWith("turn_")).toBe(true);
      expect(turn.status).toBe("inProgress");
    }
  });

  it("calls session.runTurn with thread + turnId + input + abortController", async () => {
    const d = Dispatcher.create();
    registerThreadHandlers(d);
    registerTurnHandlers(d);
    const { ctx, runTurn } = makeCtx();
    const threadId = await startThread(d, ctx);

    await d.dispatch(
      {
        kind: "Request",
        id: 2 as never,
        method: "turn/start",
        params: { threadId, input: [{ type: "text", text: "hi" }] },
      },
      ctx,
    );

    // turn/start レスポンスは同期、runTurn は非同期で呼ばれる
    expect(runTurn).toHaveBeenCalledTimes(1);
    const args = runTurn.mock.calls[0]?.[0];
    expect(args.thread.id).toBe(threadId);
    expect(args.turnId.startsWith("turn_")).toBe(true);
    expect(args.input).toEqual([{ type: "text", text: "hi" }]);
    expect(args.abortController).toBeInstanceOf(AbortController);
  });

  it("registers the turn as currentTurn on the thread", async () => {
    const d = Dispatcher.create();
    registerThreadHandlers(d);
    registerTurnHandlers(d);
    // runTurn を pending のまま保留して、ハンドラ終了時点の state を見る
    let resolve!: () => void;
    const runTurn = vi.fn().mockImplementation(() => new Promise<void>((r) => (resolve = r)));
    const { ctx } = makeCtx(runTurn);
    const threadId = await startThread(d, ctx);

    await d.dispatch(
      {
        kind: "Request",
        id: 2 as never,
        method: "turn/start",
        params: { threadId, input: [{ type: "text", text: "hi" }] },
      },
      ctx,
    );

    expect(ctx.threads.get(threadId as never)?.currentTurn).toBeDefined();
    resolve(); // cleanup
  });

  it("rejects unknown threadId with InvalidParams", async () => {
    const d = Dispatcher.create();
    registerThreadHandlers(d);
    registerTurnHandlers(d);
    const { ctx } = makeCtx();
    const res = await d.dispatch(
      {
        kind: "Request",
        id: 2 as never,
        method: "turn/start",
        params: { threadId: "thr_unknown", input: [{ type: "text", text: "x" }] },
      },
      ctx,
    );
    expect(res?.kind).toBe("Error");
    if (res?.kind === "Error") expect(res.error.code).toBe(-32602);
  });

  it("ignores Codex-origin and unknown params fields on turn/start", async () => {
    const d = Dispatcher.create();
    registerThreadHandlers(d);
    registerTurnHandlers(d);
    const { ctx } = makeCtx();
    const threadId = await startThread(d, ctx);

    const res = await d.dispatch(
      {
        kind: "Request",
        id: 2 as never,
        method: "turn/start",
        params: {
          threadId,
          input: [{ type: "text", text: "hi" }],
          approvalPolicy: "never",
          sandboxPolicy: { type: "workspaceWrite", writableRoots: ["/tmp"], networkAccess: true },
          effort: "low",
          bogus: 42,
        },
      },
      ctx,
    );
    expect(res?.kind).toBe("Success");
  });

  it("rejects missing input with InvalidParams", async () => {
    const d = Dispatcher.create();
    registerThreadHandlers(d);
    registerTurnHandlers(d);
    const { ctx } = makeCtx();
    const threadId = await startThread(d, ctx);
    const res = await d.dispatch(
      {
        kind: "Request",
        id: 2 as never,
        method: "turn/start",
        params: { threadId },
      },
      ctx,
    );
    expect(res?.kind).toBe("Error");
    if (res?.kind === "Error") expect(res.error.code).toBe(-32602);
  });
});

describe("turn/interrupt", () => {
  it("aborts the currentTurn AbortController and returns {}", async () => {
    const d = Dispatcher.create();
    registerThreadHandlers(d);
    registerTurnHandlers(d);
    let resolve!: () => void;
    const runTurn = vi.fn().mockImplementation(() => new Promise<void>((r) => (resolve = r)));
    const { ctx } = makeCtx(runTurn);
    const threadId = await startThread(d, ctx);

    await d.dispatch(
      {
        kind: "Request",
        id: 2 as never,
        method: "turn/start",
        params: { threadId, input: [{ type: "text", text: "hi" }] },
      },
      ctx,
    );

    const abort = ctx.threads.get(threadId as never)?.currentTurn?.abort;
    expect(abort?.signal.aborted).toBe(false);

    const res = await d.dispatch(
      {
        kind: "Request",
        id: 3 as never,
        method: "turn/interrupt",
        params: { threadId },
      },
      ctx,
    );
    expect(res?.kind).toBe("Success");
    if (res?.kind === "Success") expect(res.result).toEqual({});
    expect(abort?.signal.aborted).toBe(true);
    resolve();
  });

  it("succeeds with no currentTurn (idempotent)", async () => {
    const d = Dispatcher.create();
    registerThreadHandlers(d);
    registerTurnHandlers(d);
    const { ctx } = makeCtx();
    const threadId = await startThread(d, ctx);
    const res = await d.dispatch(
      {
        kind: "Request",
        id: 3 as never,
        method: "turn/interrupt",
        params: { threadId },
      },
      ctx,
    );
    expect(res?.kind).toBe("Success");
  });

  it("rejects unknown threadId with InvalidParams", async () => {
    const d = Dispatcher.create();
    registerThreadHandlers(d);
    registerTurnHandlers(d);
    const { ctx } = makeCtx();
    const res = await d.dispatch(
      {
        kind: "Request",
        id: 3 as never,
        method: "turn/interrupt",
        params: { threadId: "thr_unknown" },
      },
      ctx,
    );
    expect(res?.kind).toBe("Error");
    if (res?.kind === "Error") expect(res.error.code).toBe(-32602);
  });
});
