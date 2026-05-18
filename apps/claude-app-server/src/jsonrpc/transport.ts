import type { Readable, Writable } from "node:stream";
import { Result } from "@praha/byethrow";
import { IncomingMessage, InvalidMessage, ParseError } from "./incoming-message.js";
import { type OutgoingMessage, toWire } from "./outgoing-message.js";

const parseJsonLine = (line: string): Result.Result<unknown, ParseError> => {
  try {
    return Result.succeed(JSON.parse(line) as unknown);
  } catch {
    return Result.fail(ParseError.of(line));
  }
};

const classify = (raw: unknown): IncomingMessage => {
  const parsed = IncomingMessage.parseRequestOrNotification(raw);
  return Result.isSuccess(parsed) ? parsed.value : InvalidMessage.of(parsed.error.issues);
};

export async function* readMessages(stream: Readable): AsyncGenerator<IncomingMessage> {
  let buffer = "";
  stream.setEncoding("utf8");
  for await (const chunk of stream) {
    if (typeof chunk !== "string") {
      process.stderr.write(`unexpected non-string chunk from stdin\n`);
      continue;
    }
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      const trimmed = line.replace(/\r$/, "");
      if (trimmed.length === 0) continue;
      const parsed = parseJsonLine(trimmed);
      yield Result.isSuccess(parsed) ? classify(parsed.value) : parsed.error;
    }
  }
  // Flush any tail without a trailing newline
  const tail = buffer.replace(/\r$/, "").trim();
  if (tail.length > 0) {
    const parsed = parseJsonLine(tail);
    yield Result.isSuccess(parsed) ? classify(parsed.value) : parsed.error;
  }
}

export const writeMessage = (stream: Writable, msg: OutgoingMessage): void => {
  stream.write(JSON.stringify(toWire(msg)) + "\n");
};
