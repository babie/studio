import { describe, expect, it } from "vitest";
import { ItemId, SessionId, ThreadId, TurnId } from "../../src/util/ids.js";

describe("ThreadId", () => {
  it("fresh() returns string starting with thr_", () => {
    const id = ThreadId.fresh();
    expect(typeof id).toBe("string");
    expect(id.startsWith("thr_")).toBe(true);
  });

  it("fresh() returns unique values", () => {
    expect(ThreadId.fresh()).not.toBe(ThreadId.fresh());
  });

  it("parse() accepts strings starting with thr_", () => {
    const id = ThreadId.fresh();
    expect(ThreadId.parse(id).type).toBe("Success");
  });

  it("parse() rejects strings without thr_ prefix", () => {
    const result = ThreadId.parse("xxx");
    expect(result.type).toBe("Failure");
  });

  it("parse() rejects non-string values", () => {
    expect(ThreadId.parse(123).type).toBe("Failure");
    expect(ThreadId.parse(null).type).toBe("Failure");
  });
});

describe("TurnId", () => {
  it("fresh() returns string starting with turn_", () => {
    expect(TurnId.fresh().startsWith("turn_")).toBe(true);
  });
});

describe("ItemId", () => {
  it("fresh() returns string starting with item_", () => {
    expect(ItemId.fresh().startsWith("item_")).toBe(true);
  });
});

describe("SessionId", () => {
  it("parse() accepts any non-empty string", () => {
    const result = SessionId.parse("any-uuid-from-sdk");
    expect(result.type).toBe("Success");
  });

  it("parse() rejects empty string", () => {
    expect(SessionId.parse("").type).toBe("Failure");
  });
});
