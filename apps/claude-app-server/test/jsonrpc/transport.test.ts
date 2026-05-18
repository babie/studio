import { describe, expect, it } from "vitest";
import { Readable, Writable } from "node:stream";
import { readMessages, writeMessage } from "../../src/jsonrpc/transport.js";
import { ErrorResponse } from "../../src/jsonrpc/outgoing-message.js";
import { Id } from "../../src/jsonrpc/id.js";

function streamFromString(input: string): Readable {
  return Readable.from([Buffer.from(input, "utf8")]);
}

class CapturingWritable extends Writable {
  chunks: string[] = [];
  _write(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void) {
    this.chunks.push(chunk.toString("utf8"));
    cb();
  }
}

// branded Id を test 用に作るヘルパー
const idOf = (raw: number | string): Id => {
  const parsed = Id.schema["~standard"].validate(raw);
  if (parsed instanceof Promise) throw new Error("sync only");
  if (parsed.issues) throw new Error(`invalid id: ${raw}`);
  return parsed.value;
};

describe("readMessages", () => {
  it("yields kind-tagged Request objects on their own lines", async () => {
    const stream = streamFromString(`{"id":1,"method":"a"}\n{"id":2,"method":"b"}\n`);
    const collected = [];
    for await (const msg of readMessages(stream)) {
      collected.push(msg);
    }
    expect(collected).toEqual([
      { kind: "Request", id: 1, method: "a", params: undefined },
      { kind: "Request", id: 2, method: "b", params: undefined },
    ]);
  });

  it("yields a ParseError for malformed JSON lines", async () => {
    const stream = streamFromString(`not-json\n{"id":1,"method":"ok"}\n`);
    const collected = [];
    for await (const msg of readMessages(stream)) {
      collected.push(msg);
    }
    expect(collected).toHaveLength(2);
    expect(collected[0]).toEqual({ kind: "ParseError", line: "not-json" });
    expect(collected[1]).toEqual({
      kind: "Request",
      id: 1,
      method: "ok",
      params: undefined,
    });
  });

  it("ignores blank lines", async () => {
    const stream = streamFromString(`\n{"id":1,"method":"a"}\n\n`);
    const collected = [];
    for await (const msg of readMessages(stream)) {
      collected.push(msg);
    }
    expect(collected).toEqual([{ kind: "Request", id: 1, method: "a", params: undefined }]);
  });

  it("handles input split across chunks", async () => {
    const chunks = [`{"id":1,`, `"method":"a"}\n{"id":2,"method":"b"}\n`];
    const stream = Readable.from(chunks.map((c) => Buffer.from(c, "utf8")));
    const collected = [];
    for await (const msg of readMessages(stream)) {
      collected.push(msg);
    }
    expect(collected).toEqual([
      { kind: "Request", id: 1, method: "a", params: undefined },
      { kind: "Request", id: 2, method: "b", params: undefined },
    ]);
  });

  it("classifies a notification (no id) as a Notification", async () => {
    const stream = streamFromString(`{"method":"ping"}\n`);
    const collected = [];
    for await (const msg of readMessages(stream)) {
      collected.push(msg);
    }
    expect(collected).toEqual([{ kind: "Notification", method: "ping", params: undefined }]);
  });

  it("yields InvalidMessage for shapes that aren't request or notification", async () => {
    const stream = streamFromString(`{"foo":"bar"}\n`);
    const collected = [];
    for await (const msg of readMessages(stream)) {
      collected.push(msg);
    }
    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({ kind: "InvalidMessage" });
  });
});

describe("writeMessage", () => {
  it("strips kind from a SuccessResponse and appends LF", () => {
    const out = new CapturingWritable();
    writeMessage(out, { kind: "Success", id: idOf(1), result: {} });
    expect(out.chunks.join("")).toBe(`{"id":1,"result":{}}\n`);
  });

  it("strips kind from an ErrorResponse", () => {
    const out = new CapturingWritable();
    writeMessage(out, ErrorResponse.of(idOf(7), { code: -32601, message: "Method not found: x" }));
    expect(out.chunks.join("")).toBe(
      `{"id":7,"error":{"code":-32601,"message":"Method not found: x"}}\n`,
    );
  });

  it("strips kind from an OutgoingNotification, omitting params when undefined", () => {
    const out = new CapturingWritable();
    writeMessage(out, { kind: "Notification", method: "x", params: undefined });
    expect(out.chunks.join("")).toBe(`{"method":"x"}\n`);
  });

  it("uses LF only (no CRLF)", () => {
    const out = new CapturingWritable();
    writeMessage(out, {
      kind: "Notification",
      method: "x",
      params: { a: "b\r\nc" },
    });
    const written = out.chunks.join("");
    expect(written.endsWith("\n")).toBe(true);
    expect(written.endsWith("\r\n")).toBe(false);
  });
});
