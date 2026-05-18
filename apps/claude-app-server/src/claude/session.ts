import { AbortError, query } from "@anthropic-ai/claude-agent-sdk";
import { EventMapper, type CloseReason, type MapperState } from "./event-mapper.js";
import { SdkMessage } from "./sdk-message.js";
import { toSdkOptions } from "./session-options.js";
import { OutgoingNotification } from "../jsonrpc/outgoing-message.js";
import { SessionId, type TurnId } from "../util/ids.js";
import type { Threads, ThreadState } from "../state/threads.js";
import type { ServerOptions } from "../server.js";

export type TurnInput = Readonly<{ type: "text"; text: string }>;

export type RunTurnArgs = Readonly<{
  thread: ThreadState;
  turnId: TurnId;
  input: ReadonlyArray<TurnInput>;
  abortController: AbortController;
  cli: ServerOptions;
  threads: Threads;
  sendNotification: (msg: OutgoingNotification) => void;
}>;

export type Session = Readonly<{
  runTurn: (args: RunTurnArgs) => Promise<void>;
}>;

type SessionDeps = Readonly<{
  query: typeof query;
}>;

const promptFrom = (input: ReadonlyArray<TurnInput>): string => input.map((i) => i.text).join("\n");

type TurnError = Readonly<{ message: string; codexErrorInfo?: string }> | null;

// Authoritative signal is `rate_limit_event(rejected)` captured into
// `usageLimitHit`. This regex is a best-effort fallback when only an
// error message is available (no preceding rate_limit_event).
const usageLimitPattern = /rate.?limit|usage.?limit|quota/i;

const toUsageLimitError = (message: string): TurnError => ({
  message,
  codexErrorInfo: "UsageLimitExceeded",
});

const turnSnapshot = (
  args: RunTurnArgs,
  status: "inProgress" | "completed" | "failed" | "interrupted",
  error: TurnError,
) => ({
  id: args.turnId,
  status,
  items: [],
  error,
});

export const Session = {
  create: (deps: SessionDeps): Session => ({
    runTurn: async (args) => {
      const { thread, threads, sendNotification, abortController } = args;

      sendNotification(
        OutgoingNotification.of("turn/started", {
          threadId: thread.id,
          turn: turnSnapshot(args, "inProgress", null),
        }),
      );

      const sdkOpts = toSdkOptions({
        thread: thread.options,
        resume: thread.sessionId,
        abortController,
      });

      let mapperState: MapperState = EventMapper.initialState();
      const mapCtx = { threadId: thread.id, turnId: args.turnId, cwd: thread.options.cwd };

      let status: "completed" | "failed" | "interrupted" = "completed";
      let error: TurnError = null;
      let usageLimitHit = false;

      try {
        for await (const raw of deps.query({ prompt: promptFrom(args.input), options: sdkOpts })) {
          for (const parsed of SdkMessage.parse(raw)) {
            if (parsed.kind === "SystemInit") {
              const sid = SessionId.parse(parsed.sessionId);
              if (sid.type === "Success") threads.setSessionId(thread.id, sid.value);
            }
            if (parsed.kind === "RateLimit" && parsed.status === "rejected") {
              usageLimitHit = true;
            }
            const r = EventMapper.map(parsed, mapperState, mapCtx);
            mapperState = r.state;
            for (const n of r.notifications) sendNotification(n);

            if (parsed.kind === "ResultError") {
              status = "failed";
              const message = parsed.errors.join("; ") || `result error: ${parsed.subtype}`;
              const matched = usageLimitHit || usageLimitPattern.test(message);
              error = matched ? toUsageLimitError(message) : { message };
            }
          }
        }
      } catch (err) {
        if (err instanceof AbortError || (err instanceof Error && err.name === "AbortError")) {
          status = "interrupted";
        } else {
          status = "failed";
          const message = err instanceof Error ? err.message : String(err);
          const matched = usageLimitHit || usageLimitPattern.test(message);
          error = matched ? toUsageLimitError(message) : { message };
        }
      } finally {
        const reason: CloseReason = status;
        const closed = EventMapper.closeAll(mapperState, mapCtx, reason);
        for (const n of closed.notifications) sendNotification(n);

        threads.clearCurrentTurn(thread.id);
        sendNotification(
          OutgoingNotification.of("turn/completed", {
            threadId: thread.id,
            turn: turnSnapshot(args, status, error),
          }),
        );
      }
    },
  }),
} as const;
