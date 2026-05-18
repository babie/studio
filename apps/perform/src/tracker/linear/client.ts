import type { Result } from "@praha/byethrow";
import * as v from "valibot";
import type { TrackerError } from "../../domain/tracker-errors.js";
import { formatIssuePath } from "../../util/schema-issue.js";
import type { Sensitive } from "../../util/sensitive.js";

export const DEFAULT_LINEAR_ENDPOINT = "https://api.linear.app/graphql";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BODY_EXCERPT_BYTES = 1000;

export type LinearClientDeps = Readonly<{
  endpoint: string;
  apiKey: Sensitive<string>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}>;

// HTTP layer errors are exactly the Linear-network subset of TrackerError so
// adapter code can bubble them straight up without remapping.
export type LinearClientError = Extract<
  TrackerError,
  { kind: "linear-http" | "linear-graphql-errors" | "linear-response-invalid" | "linear-network" }
>;

// tracker-timeout is a cross-cutting error (not specific to Linear vs GitHub)
// so it lives in TrackerError rather than LinearClientError. We alias the union
// here for use in linearQuery / linearMutation return types.
export type LinearClientResultError = LinearClientError | Extract<TrackerError, { kind: "tracker-timeout" }>;

const GraphQLErrorEnvelopeSchema = v.object({
  errors: v.optional(v.array(v.object({ message: v.string() }))),
});

const truncate = (s: string): string =>
  s.length <= MAX_BODY_EXCERPT_BYTES ? s : s.slice(0, MAX_BODY_EXCERPT_BYTES) + "...<truncated>";

const linearGraphqlRequest = async <T>(
  deps: LinearClientDeps,
  query: string,
  variables: Record<string, unknown>,
  schema: v.GenericSchema<unknown, T>,
  operation?: string,
): Promise<Result.Result<T, LinearClientResultError>> => {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let res: Response;
  try {
    res = await fetchFn(deps.endpoint, {
      method: "POST",
      headers: {
        Authorization: deps.apiKey.reveal(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (timedOut) {
      return {
        type: "Failure",
        error: { kind: "tracker-timeout", operation: operation ?? "linear-request", timeoutMs },
      };
    }
    return {
      type: "Failure",
      error: { kind: "linear-network", cause: err instanceof Error ? err.message : String(err) },
    };
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const body = await res.text().catch(() => "<unreadable body>");
    return { type: "Failure", error: { kind: "linear-http", status: res.status, bodyExcerpt: truncate(body) } };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    return {
      type: "Failure",
      error: { kind: "linear-response-invalid", issues: [`<root>: failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`] },
    };
  }

  const envelope = v.safeParse(GraphQLErrorEnvelopeSchema, json);
  if (envelope.success && envelope.output.errors && envelope.output.errors.length > 0) {
    return {
      type: "Failure",
      error: { kind: "linear-graphql-errors", messages: envelope.output.errors.map((e) => e.message) },
    };
  }

  const parsed = v.safeParse(schema, json);
  if (!parsed.success) {
    const issues = parsed.issues.map((i) => `${formatIssuePath(i)}: ${i.message}`);
    return { type: "Failure", error: { kind: "linear-response-invalid", issues } };
  }

  return { type: "Success", value: parsed.output };
};

/** Query wrapper — same as `linearGraphqlRequest` but signals read-only intent. */
export const linearQuery = <T>(
  deps: LinearClientDeps,
  query: string,
  variables: Record<string, unknown>,
  schema: v.GenericSchema<unknown, T>,
  operation?: string,
): Promise<Result.Result<T, LinearClientResultError>> =>
  linearGraphqlRequest(deps, query, variables, schema, operation);

/** Mutation wrapper — same as `linearGraphqlRequest` but signals side-effect intent. */
export const linearMutation = <T>(
  deps: LinearClientDeps,
  query: string,
  variables: Record<string, unknown>,
  schema: v.GenericSchema<unknown, T>,
  operation?: string,
): Promise<Result.Result<T, LinearClientResultError>> =>
  linearGraphqlRequest(deps, query, variables, schema, operation);

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;
  const { Sensitive } = await import("../../util/sensitive.js");

  const DUMMY_SCHEMA = v.object({ data: v.object({ ok: v.boolean() }) });
  const baseDeps = (fetchImpl: typeof globalThis.fetch): LinearClientDeps => ({
    endpoint: "https://api.linear.app/graphql",
    apiKey: Sensitive.of("lin_test"),
    fetch: fetchImpl,
  });

  describe("tracker/linear/client", () => {
    it("returns Success on 200 + matching schema", async () => {
      const fetchFn = vi.fn(async () =>
        new Response(JSON.stringify({ data: { ok: true } }), { status: 200, headers: { "content-type": "application/json" } })
      ) as unknown as typeof globalThis.fetch;
      const r = await linearQuery(baseDeps(fetchFn), "query Q { ok }", {}, DUMMY_SCHEMA);
      if (r.type !== "Success") throw new Error("expected success");
      expect(r.value.data.ok).toBe(true);
    });

    it("returns linear-http on non-2xx", async () => {
      const fetchFn = vi.fn(async () =>
        new Response("not authorized", { status: 401 })
      ) as unknown as typeof globalThis.fetch;
      const r = await linearQuery(baseDeps(fetchFn), "q", {}, DUMMY_SCHEMA);
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("linear-http");
      if (r.error.kind === "linear-http") {
        expect(r.error.status).toBe(401);
        expect(r.error.bodyExcerpt).toBe("not authorized");
      }
    });

    it("returns linear-graphql-errors on errors envelope", async () => {
      const fetchFn = vi.fn(async () =>
        new Response(JSON.stringify({ errors: [{ message: "bad query" }] }), { status: 200 })
      ) as unknown as typeof globalThis.fetch;
      const r = await linearQuery(baseDeps(fetchFn), "q", {}, DUMMY_SCHEMA);
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("linear-graphql-errors");
      if (r.error.kind === "linear-graphql-errors") expect(r.error.messages[0]).toBe("bad query");
    });

    it("returns linear-response-invalid when schema mismatches", async () => {
      const fetchFn = vi.fn(async () =>
        new Response(JSON.stringify({ data: { ok: "nope" } }), { status: 200 })
      ) as unknown as typeof globalThis.fetch;
      const r = await linearQuery(baseDeps(fetchFn), "q", {}, DUMMY_SCHEMA);
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("linear-response-invalid");
    });

    it("returns linear-network when fetch throws", async () => {
      const fetchFn = vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof globalThis.fetch;
      const r = await linearQuery(baseDeps(fetchFn), "q", {}, DUMMY_SCHEMA);
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("linear-network");
      if (r.error.kind === "linear-network") expect(r.error.cause).toBe("ECONNREFUSED");
    });

    it("aborts via timeoutMs and returns tracker-timeout", async () => {
      const fetchFn = vi.fn(async (_url: any, init: any) => {
        // Wait for the abort signal; if not aborted, this would hang
        await new Promise<void>((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
        return new Response("{}", { status: 200 });
      }) as unknown as typeof globalThis.fetch;
      const r = await linearQuery(
        { endpoint: "https://x", apiKey: Sensitive.of("k"), fetch: fetchFn, timeoutMs: 10 },
        "q",
        {},
        DUMMY_SCHEMA,
      );
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("tracker-timeout");
    });

    it("returns tracker-timeout when controller aborts due to timeout", async () => {
      const fetchFn = vi.fn(async (_url: any, init: any) => {
        await new Promise<void>((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
        return new Response("{}", { status: 200 });
      }) as unknown as typeof globalThis.fetch;
      const r = await linearQuery(
        { endpoint: "https://x", apiKey: Sensitive.of("k"), fetch: fetchFn, timeoutMs: 10 },
        "q",
        {},
        DUMMY_SCHEMA,
      );
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("tracker-timeout");
      if (r.error.kind === "tracker-timeout") {
        expect(r.error.timeoutMs).toBe(10);
      }
    });
  });
}
