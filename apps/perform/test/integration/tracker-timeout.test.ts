import { describe, it, expect, vi } from "vitest";
import { linearQuery } from "../../src/tracker/linear/client.js";
import { githubQuery } from "../../src/tracker/github/client.js";
import { Sensitive } from "../../src/util/sensitive.js";
import * as v from "valibot";

const DUMMY_SCHEMA = v.object({ data: v.object({ ok: v.boolean() }) });

describe("tracker timeout (Linear)", () => {
  it("returns tracker-timeout when fetch hangs past the deadline", async () => {
    const fetchFn = vi.fn(async (_url: any, init: any) => {
      await new Promise<void>((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const r = await linearQuery(
      { endpoint: "https://api.linear.app/graphql", apiKey: Sensitive.of("k"), fetch: fetchFn, timeoutMs: 50 },
      "query Q { ok }",
      {},
      DUMMY_SCHEMA,
    );
    expect(r.type).toBe("Failure");
    if (r.type === "Failure") {
      expect(r.error.kind).toBe("tracker-timeout");
    }
  });
});

describe("tracker timeout (GitHub)", () => {
  it("returns tracker-timeout when fetch hangs past the deadline", async () => {
    const fetchFn = vi.fn(async (_url: any, init: any) => {
      await new Promise<void>((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const r = await githubQuery(
      { endpoint: "https://api.github.com/graphql", apiKey: Sensitive.of("k"), fetch: fetchFn, timeoutMs: 50 },
      "query Q { ok }",
      {},
      DUMMY_SCHEMA,
    );
    expect(r.type).toBe("Failure");
    if (r.type === "Failure") {
      expect(r.error.kind).toBe("tracker-timeout");
    }
  });
});
