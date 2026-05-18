import type { Result } from "@praha/byethrow";
import * as v from "valibot";
import { Dispatcher, type HandlerContext } from "./jsonrpc/dispatcher.js";
import { OutgoingNotification } from "./jsonrpc/outgoing-message.js";
import { schemaResult, type ValidationError } from "./jsonrpc/schema-result.js";
import { readMessages, writeMessage } from "./jsonrpc/transport.js";
import { registerHandlers } from "./handlers/index.js";
import { Threads } from "./state/threads.js";
import { Session } from "./claude/session.js";

const ServerOptionsSchema = v.object({
  model: v.optional(v.string()),
  permissionMode: v.optional(v.picklist(["default", "acceptEdits", "bypassPermissions"])),
  allowedTools: v.optional(v.array(v.string())),
});

export type ServerOptions = v.InferOutput<typeof ServerOptionsSchema>;

export const ServerOptions: Readonly<{
  schema: typeof ServerOptionsSchema;
  parse: (raw: unknown) => Result.Result<ServerOptions, ValidationError>;
}> = {
  schema: ServerOptionsSchema,
  parse: schemaResult(ServerOptionsSchema),
} as const;

export type ServerDeps = Readonly<{
  session: Session;
}>;

export const runServer = async (opts: ServerOptions, deps: ServerDeps): Promise<void> => {
  delete process.env.ANTHROPIC_API_KEY;

  const dispatcher = Dispatcher.create();
  registerHandlers(dispatcher);

  const ctx: HandlerContext = {
    sendNotification: (method, params) =>
      writeMessage(process.stdout, OutgoingNotification.of(method, params)),
    cli: opts,
    threads: Threads.create(),
    session: deps.session,
  };

  for await (const message of readMessages(process.stdin)) {
    const response = await dispatcher.dispatch(message, ctx);
    if (response !== null) writeMessage(process.stdout, response);
  }
};
