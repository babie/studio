import * as v from "valibot";
import type { Dispatcher, HandlerContext, RequestHandler } from "../jsonrpc/dispatcher.js";
import { InvalidParamsError } from "../jsonrpc/invalid-params-error.js";
import { TurnId, ThreadId } from "../util/ids.js";

const TextInputSchema = v.object({
  type: v.literal("text"),
  text: v.string(),
});

const TurnStartParamsSchema = v.looseObject({
  threadId: v.string(),
  input: v.array(v.union([TextInputSchema, v.unknown()])),
});

const TurnInterruptParamsSchema = v.looseObject({
  threadId: v.string(),
});

const requireThread = (ctx: HandlerContext, threadId: string) => {
  const parsedId = ThreadId.parse(threadId);
  if (parsedId.type !== "Success") {
    throw new InvalidParamsError(`threadId is not a valid ThreadId: ${threadId}`);
  }
  const thread = ctx.threads.get(parsedId.value);
  if (!thread) {
    throw new InvalidParamsError(`unknown threadId: ${threadId}`);
  }
  return thread;
};

const turnStartHandler: RequestHandler = async (raw, ctx) => {
  const parsed = v.safeParse(TurnStartParamsSchema, raw ?? {});
  if (!parsed.success) {
    throw new InvalidParamsError(parsed.issues.map((i) => i.message).join("; "));
  }
  const thread = requireThread(ctx, parsed.output.threadId);

  // input から text のみを抽出 (protocol.md: Symphony は text のみ送る前提)
  const textInputs = parsed.output.input.flatMap((item) => {
    const r = v.safeParse(TextInputSchema, item);
    return r.success ? [r.output] : [];
  });

  const turnId = TurnId.fresh();
  const abortController = new AbortController();
  ctx.threads.setCurrentTurn(thread.id, { id: turnId, abort: abortController });

  // 非同期で SDK 呼び出し開始 (await しない)
  void ctx.session
    .runTurn({
      thread,
      turnId,
      input: textInputs,
      abortController,
      cli: ctx.cli,
      threads: ctx.threads,
      sendNotification: (msg) => ctx.sendNotification(msg.method, msg.params),
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`runTurn unexpected throw: ${message}\n`);
    });

  return {
    turn: {
      id: turnId,
      status: "inProgress",
      items: [],
      error: null,
    },
  };
};

const turnInterruptHandler: RequestHandler = async (raw, ctx) => {
  const parsed = v.safeParse(TurnInterruptParamsSchema, raw ?? {});
  if (!parsed.success) {
    throw new InvalidParamsError(parsed.issues.map((i) => i.message).join("; "));
  }
  const thread = requireThread(ctx, parsed.output.threadId);
  thread.currentTurn?.abort.abort();
  return {};
};

export const registerTurnHandlers = (dispatcher: Dispatcher): void => {
  dispatcher.registerRequest("turn/start", turnStartHandler);
  dispatcher.registerRequest("turn/interrupt", turnInterruptHandler);
};
