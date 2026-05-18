import { DispatchError } from "./dispatch-error.js";
import { isInvalidParamsError } from "./invalid-params-error.js";
import type { IncomingMessage, Notification, Request } from "./incoming-message.js";
import { ErrorResponse, type OutgoingMessage, SuccessResponse } from "./outgoing-message.js";
import { assertNever } from "../util/assert-never.js";
import type { ServerOptions } from "../server.js";
import type { Session } from "../claude/session.js";
import type { Threads } from "../state/threads.js";

export type HandlerContext = Readonly<{
  sendNotification: (method: string, params: unknown) => void;
  cli: ServerOptions;
  threads: Threads;
  session: Session;
}>;

/**
 * Phase 1 keeps params/result as `unknown`. Handlers are responsible for
 * narrowing `params` (typically via a valibot schema). When a per-method
 * schema mechanism lands in Phase 2, the handler signature will be tightened.
 */
export type RequestHandler = (params: unknown, ctx: HandlerContext) => Promise<unknown> | unknown;

export type NotificationHandler = (params: unknown, ctx: HandlerContext) => Promise<void> | void;

export type Dispatcher = Readonly<{
  registerRequest: (method: string, handler: RequestHandler) => void;
  registerNotification: (method: string, handler: NotificationHandler) => void;
  dispatch: (msg: IncomingMessage, ctx: HandlerContext) => Promise<OutgoingMessage | null>;
}>;

const dispatchRequest = async (
  req: Request,
  ctx: HandlerContext,
  handlers: ReadonlyMap<string, RequestHandler>,
): Promise<OutgoingMessage> => {
  const handler = handlers.get(req.method);
  if (!handler) {
    return ErrorResponse.of(
      req.id,
      DispatchError.toErrorPayload({ kind: "MethodNotFound", method: req.method }),
    );
  }
  try {
    const result = await handler(req.params, ctx);
    return SuccessResponse.of(req.id, result);
  } catch (err) {
    if (isInvalidParamsError(err)) {
      return ErrorResponse.of(
        req.id,
        DispatchError.toErrorPayload({ kind: "InvalidParams", message: err.message }),
      );
    }
    return ErrorResponse.of(
      req.id,
      DispatchError.toErrorPayload({ kind: "InternalError", cause: err }),
    );
  }
};

const dispatchNotification = async (
  notif: Notification,
  ctx: HandlerContext,
  handlers: ReadonlyMap<string, NotificationHandler>,
): Promise<void> => {
  const handler = handlers.get(notif.method);
  if (!handler) return;
  try {
    await handler(notif.params, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`notification handler error (${notif.method}): ${message}\n`);
  }
};

export const Dispatcher = {
  create: (): Dispatcher => {
    const requestHandlers = new Map<string, RequestHandler>();
    const notificationHandlers = new Map<string, NotificationHandler>();

    return {
      registerRequest: (method, handler) => {
        requestHandlers.set(method, handler);
      },
      registerNotification: (method, handler) => {
        notificationHandlers.set(method, handler);
      },
      dispatch: async (msg, ctx) => {
        switch (msg.kind) {
          case "ParseError":
            return ErrorResponse.of(null, DispatchError.toErrorPayload({ kind: "ParseError" }));
          case "InvalidMessage":
            return ErrorResponse.of(null, DispatchError.toErrorPayload({ kind: "InvalidRequest" }));
          case "Request":
            return await dispatchRequest(msg, ctx, requestHandlers);
          case "Notification":
            await dispatchNotification(msg, ctx, notificationHandlers);
            return null;
          default:
            return assertNever(msg);
        }
      },
    };
  },
} as const;
