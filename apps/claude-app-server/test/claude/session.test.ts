import { describe, expect, it } from "vitest";
import { Session, type RunTurnArgs } from "../../src/claude/session.js";
import { Threads } from "../../src/state/threads.js";
import type { OutgoingNotification } from "../../src/jsonrpc/outgoing-message.js";
import type { TurnId } from "../../src/util/ids.js";

type AnyAsyncGen = AsyncGenerator<unknown, void, unknown>;
type MockQuery = (args: { prompt: string; options: unknown }) => AnyAsyncGen;

const makeArgs = (mockQuery: MockQuery) => {
  const threads = Threads.create();
  const thread = threads.start({
    cwd: "/tmp",
    permissionMode: "bypassPermissions",
  });
  const turnId = "turn_test" as TurnId;
  const sent: OutgoingNotification[] = [];
  const args: RunTurnArgs = {
    thread,
    turnId,
    input: [{ type: "text", text: "hi" }],
    abortController: new AbortController(),
    cli: {},
    threads,
    sendNotification: (n) => {
      sent.push(n);
    },
  };
  const session = Session.create({
    query: mockQuery as unknown as Parameters<typeof Session.create>[0]["query"],
  });
  return { args, sent, session };
};

const completedTurnError = (sent: OutgoingNotification[]) => {
  const ev = sent.find((n) => n.method === "turn/completed");
  if (!ev) throw new Error("turn/completed not sent");
  const turn = (ev.params as { turn: { error: unknown; status: string } }).turn;
  return { turn };
};

describe("Session.runTurn / usage limit", () => {
  it("flags codexErrorInfo:UsageLimitExceeded when rate_limit_event(rejected) precedes ResultError", async () => {
    const mockQuery: MockQuery = async function* () {
      yield {
        type: "system",
        subtype: "init",
        session_id: "s",
        uuid: "u",
      };
      yield {
        type: "rate_limit_event",
        rate_limit_info: { status: "rejected" },
        session_id: "s",
        uuid: "u",
      };
      yield {
        type: "result",
        subtype: "error_during_execution",
        session_id: "s",
        uuid: "u",
        duration_ms: 1,
        duration_api_ms: 1,
        is_error: true,
        num_turns: 1,
        stop_reason: null,
        total_cost_usd: 0,
        usage: {},
        modelUsage: {},
        permission_denials: [],
        errors: ["rate limited"],
      };
    };
    const { args, sent, session } = makeArgs(mockQuery);
    await session.runTurn(args);
    const { turn } = completedTurnError(sent);
    expect(turn.status).toBe("failed");
    expect(turn.error).toMatchObject({ codexErrorInfo: "UsageLimitExceeded" });
  });

  it("flags codexErrorInfo:UsageLimitExceeded when query() throws with 'rate limit' in message", async () => {
    const mockQuery: MockQuery = async function* () {
      yield {
        type: "system",
        subtype: "init",
        session_id: "s",
        uuid: "u",
      };
      throw new Error("hit rate limit on the API");
    };
    const { args, sent, session } = makeArgs(mockQuery);
    await session.runTurn(args);
    const { turn } = completedTurnError(sent);
    expect(turn.status).toBe("failed");
    expect(turn.error).toMatchObject({ codexErrorInfo: "UsageLimitExceeded" });
  });

  it("flags codexErrorInfo:UsageLimitExceeded when ResultError errors contains 'usage limit'", async () => {
    const mockQuery: MockQuery = async function* () {
      yield { type: "system", subtype: "init", session_id: "s", uuid: "u" };
      yield {
        type: "result",
        subtype: "error_during_execution",
        session_id: "s",
        uuid: "u",
        duration_ms: 1,
        duration_api_ms: 1,
        is_error: true,
        num_turns: 1,
        stop_reason: null,
        total_cost_usd: 0,
        usage: {},
        modelUsage: {},
        permission_denials: [],
        errors: ["account usage limit reached"],
      };
    };
    const { args, sent, session } = makeArgs(mockQuery);
    await session.runTurn(args);
    const { turn } = completedTurnError(sent);
    expect(turn.error).toMatchObject({ codexErrorInfo: "UsageLimitExceeded" });
  });

  it("does NOT add codexErrorInfo for generic ResultError without rate-limit hints", async () => {
    const mockQuery: MockQuery = async function* () {
      yield { type: "system", subtype: "init", session_id: "s", uuid: "u" };
      yield {
        type: "result",
        subtype: "error_during_execution",
        session_id: "s",
        uuid: "u",
        duration_ms: 1,
        duration_api_ms: 1,
        is_error: true,
        num_turns: 1,
        stop_reason: null,
        total_cost_usd: 0,
        usage: {},
        modelUsage: {},
        permission_denials: [],
        errors: ["something else broke"],
      };
    };
    const { args, sent, session } = makeArgs(mockQuery);
    await session.runTurn(args);
    const { turn } = completedTurnError(sent);
    expect(turn.status).toBe("failed");
    const err = turn.error as { message: string; codexErrorInfo?: string } | null;
    expect(err?.message).toContain("something else broke");
    expect(err?.codexErrorInfo).toBeUndefined();
  });

  it("ignores rate_limit_event with status:allowed (no UsageLimitExceeded)", async () => {
    const mockQuery: MockQuery = async function* () {
      yield { type: "system", subtype: "init", session_id: "s", uuid: "u" };
      yield {
        type: "rate_limit_event",
        rate_limit_info: { status: "allowed", utilization: 0.2 },
        session_id: "s",
        uuid: "u",
      };
      yield {
        type: "result",
        subtype: "success",
        session_id: "s",
        uuid: "u",
        duration_ms: 1,
        duration_api_ms: 1,
        is_error: false,
        num_turns: 1,
        stop_reason: null,
        total_cost_usd: 0,
        result: "ok",
        usage: {},
        modelUsage: {},
        permission_denials: [],
      };
    };
    const { args, sent, session } = makeArgs(mockQuery);
    await session.runTurn(args);
    const ev = sent.find((n) => n.method === "turn/completed");
    if (!ev) throw new Error("turn/completed not sent");
    const turn = (ev.params as { turn: { status: string; error: unknown } }).turn;
    expect(turn.status).toBe("completed");
    expect(turn.error).toBeNull();
  });
});
