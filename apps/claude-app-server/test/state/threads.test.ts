import { describe, expect, it } from "vitest";
import { SessionId, ThreadId, TurnId } from "../../src/util/ids.js";
import { Threads, type ResolvedThreadOptions } from "../../src/state/threads.js";

const opts = (): ResolvedThreadOptions => ({
  cwd: "/tmp",
  permissionMode: "default",
});

describe("Threads", () => {
  it("start() returns a ThreadState with fresh id and the given options", () => {
    const threads = Threads.create();
    const state = threads.start(opts());
    expect(state.id.startsWith("thr_")).toBe(true);
    expect(state.options.cwd).toBe("/tmp");
    expect(state.sessionId).toBeUndefined();
    expect(state.currentTurn).toBeUndefined();
  });

  it("get() returns the stored state", () => {
    const threads = Threads.create();
    const state = threads.start(opts());
    expect(threads.get(state.id)).toEqual(state);
  });

  it("get() returns undefined for unknown id", () => {
    const threads = Threads.create();
    expect(threads.get("thr_unknown" as ThreadId)).toBeUndefined();
  });

  it("setSessionId() stores the sessionId on the existing state", () => {
    const threads = Threads.create();
    const state = threads.start(opts());
    const sid = SessionId.parse("sess-123");
    if (sid.type !== "Success") throw new Error("setup");
    threads.setSessionId(state.id, sid.value);
    expect(threads.get(state.id)?.sessionId).toBe(sid.value);
  });

  it("setCurrentTurn() / clearCurrentTurn() manage the in-progress turn", () => {
    const threads = Threads.create();
    const state = threads.start(opts());
    const abort = new AbortController();
    const turnId = TurnId.fresh();
    threads.setCurrentTurn(state.id, { id: turnId, abort });
    expect(threads.get(state.id)?.currentTurn?.id).toBe(turnId);
    threads.clearCurrentTurn(state.id);
    expect(threads.get(state.id)?.currentTurn).toBeUndefined();
  });

  it("setSessionId() on unknown id is a no-op (does not throw)", () => {
    const threads = Threads.create();
    const sid = SessionId.parse("x");
    if (sid.type !== "Success") throw new Error("setup");
    expect(() => threads.setSessionId("thr_unknown" as ThreadId, sid.value)).not.toThrow();
  });
});
