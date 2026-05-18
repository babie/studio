import * as v from "valibot";
import type { Dispatcher, RequestHandler } from "../jsonrpc/dispatcher.js";
import { InvalidParamsError } from "../jsonrpc/invalid-params-error.js";
import { resolveThreadOptions, type ThreadStartParams } from "../claude/session-options.js";

const ParamsSchema = v.looseObject({
  cwd: v.optional(v.string()),
  model: v.optional(v.string()),
  sandboxPolicy: v.optional(v.looseObject({ type: v.optional(v.string()) })),
});

const threadStartHandler: RequestHandler = async (rawParams, ctx) => {
  const parsed = v.safeParse(ParamsSchema, rawParams ?? {});
  if (!parsed.success) {
    throw new InvalidParamsError(parsed.issues.map((i) => i.message).join("; "));
  }
  const resolved = resolveThreadOptions({
    cli: ctx.cli,
    params: parsed.output as ThreadStartParams,
  });
  const state = ctx.threads.start(resolved);
  ctx.sendNotification("thread/started", { threadId: state.id });
  return { thread: { id: state.id } };
};

export const registerThreadHandlers = (dispatcher: Dispatcher): void => {
  dispatcher.registerRequest("thread/start", threadStartHandler);
};
