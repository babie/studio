import { Result } from "@praha/byethrow";
import * as v from "valibot";
import type { Logger } from "../../orchestrator/orchestrator.js";
import type { TrackerError } from "../../domain/tracker-errors.js";
import type { LinearTrackerConfig } from "../../domain/tracker-config.js";
import { Sensitive } from "../../util/sensitive.js";
import {
  type Issue,
  IssueId,
  IssueIdentifier,
  IssueStateName,
} from "../../domain/issue.js";
import type { Tracker } from "../types.js";
import {
  DEFAULT_LINEAR_ENDPOINT,
  linearQuery,
  linearMutation,
  type LinearClientDeps,
  type LinearClientError,
  type LinearClientResultError,
} from "./client.js";
import {
  type LinearIssueNode,
  VIEWER_QUERY,
  ViewerResponseSchema,
  LIST_ISSUES_QUERY,
  LIST_ISSUES_BY_ASSIGNEE_QUERY,
  LIST_ISSUES_BY_IDS_QUERY,
  ListIssuesResponseSchema,
  ListIssuesByIdsResponseSchema,
  CREATE_COMMENT_MUTATION,
  CreateCommentResponseSchema,
  RESOLVE_STATE_ID_QUERY,
  ResolveStateIdResponseSchema,
  UPDATE_STATE_MUTATION,
  UpdateStateResponseSchema,
} from "./queries.js";

type AssigneeFilter =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "id"; id: string }>;

/** Resolves an assignee setting to either no filter or a concrete user id.
 *  - undefined → none
 *  - "me" → look up viewer.id once (caller is responsible for caching)
 *  - any other string → treated as a literal user id */
const resolveAssigneeFilter = async (
  clientDeps: LinearClientDeps,
  assignee: string | undefined,
): Promise<Result.Result<AssigneeFilter, LinearClientResultError>> => {
  if (assignee === undefined) return { type: "Success", value: { kind: "none" } };
  const trimmed = assignee.trim();
  if (trimmed === "") return { type: "Success", value: { kind: "none" } };
  if (trimmed === "me") {
    const r = await linearQuery(clientDeps, VIEWER_QUERY, {}, ViewerResponseSchema);
    if (r.type === "Failure") return r;
    return { type: "Success", value: { kind: "id", id: r.value.data.viewer.id } };
  }
  return { type: "Success", value: { kind: "id", id: trimmed } };
};

/** Normalize a Linear GraphQL node into our domain `Issue`. */
const toIssue = (node: LinearIssueNode, assigneeFilter: AssigneeFilter): Issue => {
  const priority = node.priority != null && [1, 2, 3, 4].includes(node.priority)
    ? (node.priority as 1 | 2 | 3 | 4)
    : null;
  const assigneeId = node.assignee?.id ?? null;
  const assignedToWorker = assigneeFilter.kind === "none"
    ? true
    : assigneeId === assigneeFilter.id;
  return {
    id: v.parse(IssueId.schema, node.id),
    identifier: v.parse(IssueIdentifier.schema, node.identifier),
    title: node.title,
    description: node.description ?? "",
    state: v.parse(IssueStateName.schema, node.state.name),
    priority,
    createdAt: new Date(node.createdAt),
    assigneeId,
    assignedToWorker,
    blockedBy: (node.inverseRelations?.nodes ?? [])
      .filter((n) => n.type.toLowerCase().trim() === "blocks")
      .map((n) => ({
        id: v.parse(IssueId.schema, n.issue.id),
        state: v.parse(IssueStateName.schema, n.issue.state.name),
      })),
  };
};

const PAGE_SIZE = 50;

const listIssuesByStates = async (
  clientDeps: LinearClientDeps,
  projectSlug: string,
  states: ReadonlyArray<string>,
  assigneeFilter: AssigneeFilter,
): Promise<Result.Result<ReadonlyArray<Issue>, TrackerError>> => {
  if (states.length === 0) return { type: "Success", value: [] };
  const acc: Issue[] = [];
  let cursor: string | null = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const baseVars: Record<string, unknown> = {
      projectSlug,
      stateNames: [...states],
      first: PAGE_SIZE,
      after: cursor,
    };
    const r = assigneeFilter.kind === "id"
      ? await linearQuery(clientDeps, LIST_ISSUES_BY_ASSIGNEE_QUERY, { ...baseVars, assigneeId: assigneeFilter.id }, ListIssuesResponseSchema)
      : await linearQuery(clientDeps, LIST_ISSUES_QUERY, baseVars, ListIssuesResponseSchema);
    if (r.type === "Failure") return r;
    for (const node of r.value.data.issues.nodes) acc.push(toIssue(node, assigneeFilter));
    if (!r.value.data.issues.pageInfo.hasNextPage) break;
    cursor = r.value.data.issues.pageInfo.endCursor;
    if (cursor === null) break;  // defensive: hasNextPage but no cursor
  }
  return { type: "Success", value: acc };
};

const fetchIssuesByIds = async (
  clientDeps: LinearClientDeps,
  ids: ReadonlyArray<string>,
  assigneeFilter: AssigneeFilter,
): Promise<Result.Result<ReadonlyArray<Issue>, TrackerError>> => {
  if (ids.length === 0) return { type: "Success", value: [] };
  const uniq = Array.from(new Set(ids));
  const acc: Issue[] = [];
  for (let i = 0; i < uniq.length; i += PAGE_SIZE) {
    const batch = uniq.slice(i, i + PAGE_SIZE);
    const r = await linearQuery(clientDeps, LIST_ISSUES_BY_IDS_QUERY, {
      ids: batch,
      first: batch.length,
    }, ListIssuesByIdsResponseSchema);
    if (r.type === "Failure") return r;
    for (const node of r.value.data.issues.nodes) acc.push(toIssue(node, assigneeFilter));
  }
  const order = new Map(uniq.map((id, idx) => [id, idx] as const));
  acc.sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  return { type: "Success", value: acc };
};

const createComment = async (
  clientDeps: LinearClientDeps,
  issueId: string,
  body: string,
): Promise<Result.Result<void, TrackerError>> => {
  const r = await linearMutation(clientDeps, CREATE_COMMENT_MUTATION, {
    issueId,
    body,
  }, CreateCommentResponseSchema);
  if (r.type === "Failure") return r;
  if (r.value.data.commentCreate.success !== true) {
    return { type: "Failure", error: { kind: "linear-graphql-errors", messages: ["commentCreate returned success=false"] } };
  }
  return { type: "Success", value: undefined };
};

const RETRY_DELAYS_MS: ReadonlyArray<number> = [250, 1000];
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const resolveStateId = async (
  clientDeps: LinearClientDeps,
  issueId: string,
  stateName: string,
): Promise<Result.Result<string, TrackerError>> => {
  const r = await linearQuery(clientDeps, RESOLVE_STATE_ID_QUERY, {
    issueId,
    stateName,
  }, ResolveStateIdResponseSchema);
  if (r.type === "Failure") return r;
  const node = r.value.data.issue?.team.states.nodes[0];
  if (!node) {
    return { type: "Failure", error: { kind: "linear-state-not-found", stateName } };
  }
  return { type: "Success", value: node.id };
};

const doUpdateState = async (
  clientDeps: LinearClientDeps,
  issueId: string,
  stateId: string,
): Promise<Result.Result<void, TrackerError>> => {
  const r = await linearMutation(clientDeps, UPDATE_STATE_MUTATION, {
    issueId,
    stateId,
  }, UpdateStateResponseSchema);
  if (r.type === "Failure") return r;
  if (r.value.data.issueUpdate.success !== true) {
    return { type: "Failure", error: { kind: "linear-graphql-errors", messages: ["issueUpdate returned success=false"] } };
  }
  return { type: "Success", value: undefined };
};

const retryUpdateState = async (
  clientDeps: LinearClientDeps,
  issueId: string,
  stateId: string,
  logger: Logger,
  issueIdentifier: string,
): Promise<Result.Result<void, TrackerError>> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await doUpdateState(clientDeps, issueId, stateId);
    if (r.type === "Success") return r;
    if (attempt < RETRY_DELAYS_MS.length) {
      logger.info(
        `[linear] updateIssueState retry ${attempt + 1}/3 after ${RETRY_DELAYS_MS[attempt]}ms (issue=${issueIdentifier})`,
      );
      await delay(RETRY_DELAYS_MS[attempt]!);
    }
  }
  logger.warn(
    `[linear] updateIssueState failed after 3 attempts (issue=${issueIdentifier}); continuing best-effort per ADR-0014`,
  );
  return { type: "Success", value: undefined };
};

/** 3-attempt retry (250ms, 1s) → best-effort ok(undefined) + warn log on final failure.
 *  Per ADR-0014, transient mutation failures must not abort agent execution. */
const updateStateWithRetry = (
  clientDeps: LinearClientDeps,
  logger: Logger,
  issue: Issue,
  stateName: string,
): Promise<Result.Result<void, TrackerError>> =>
  Result.pipe(
    resolveStateId(clientDeps, issue.id, stateName),
    Result.andThen((stateId) =>
      retryUpdateState(clientDeps, issue.id, stateId, logger, issue.identifier),
    ),
  );

/** Public entry point. Constructs a Tracker for the Linear backend.
 *  Resolves assignee="me" once (viewer query) and memoizes for the lifetime of the tracker. */
export const createLinearTracker = async (
  config: LinearTrackerConfig,
  deps: { logger: Logger; fetch?: typeof globalThis.fetch },
): Promise<Result.Result<Tracker, TrackerError>> => {
  const clientDeps: LinearClientDeps = {
    endpoint: config.endpoint ?? DEFAULT_LINEAR_ENDPOINT,
    apiKey: config.apiKey,
    ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
  };

  const filterR = await resolveAssigneeFilter(clientDeps, config.assignee);
  if (filterR.type === "Failure") return filterR;
  const assigneeFilter = filterR.value;

  return {
    type: "Success",
    value: {
      fetchCandidateIssues: () =>
        listIssuesByStates(clientDeps, config.projectSlug, config.activeStates, assigneeFilter),
      fetchIssuesByStates: (states) =>
        listIssuesByStates(clientDeps, config.projectSlug, states, assigneeFilter),
      fetchIssueStatesByIds: (ids) =>
        fetchIssuesByIds(clientDeps, ids, assigneeFilter),
      createComment: (issueId, body) =>
        createComment(clientDeps, issueId, body),
      updateIssueState: (issue, state) =>
        updateStateWithRetry(clientDeps, deps.logger, issue, state),
    },
  };
};

// Internal helpers exposed for adjacent modules within tracker/linear/
export const __internal__ = {
  resolveAssigneeFilter,
  toIssue,
};

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
  const baseCfg = (extra: Partial<LinearTrackerConfig> = {}): LinearTrackerConfig => ({
    kind: "linear",
    activeStates: ["Todo"],
    terminalStates: ["Done"],
    apiKey: Sensitive.of("lin_test"),
    projectSlug: "studio-xxx",
    ...extra,
  });

  describe("tracker/linear/adapter — viewer/assignee resolution", () => {
    it("does not call fetch when assignee is undefined", async () => {
      const fetchFn = vi.fn();
      const r = await createLinearTracker(baseCfg(), { logger: silentLogger, fetch: fetchFn as any });
      if (r.type !== "Success") throw new Error("expected success");
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("resolves assignee=\"me\" via viewer query exactly once", async () => {
      const fetchFn = vi.fn(async () =>
        new Response(JSON.stringify({ data: { viewer: { id: "user_me_id" } } }), { status: 200 })
      ) as unknown as typeof globalThis.fetch;
      const r = await createLinearTracker(baseCfg({ assignee: "me" }), { logger: silentLogger, fetch: fetchFn });
      if (r.type !== "Success") throw new Error("expected success");
      expect((fetchFn as any).mock.calls.length).toBe(1);
    });

    it("treats literal assignee value as id without calling viewer", async () => {
      const fetchFn = vi.fn();
      const r = await createLinearTracker(baseCfg({ assignee: "user_abc" }), { logger: silentLogger, fetch: fetchFn as any });
      if (r.type !== "Success") throw new Error("expected success");
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("propagates Failure when viewer query fails", async () => {
      const fetchFn = vi.fn(async () =>
        new Response("nope", { status: 401 })
      ) as unknown as typeof globalThis.fetch;
      const r = await createLinearTracker(baseCfg({ assignee: "me" }), { logger: silentLogger, fetch: fetchFn });
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("linear-http");
    });
  });

  describe("tracker/linear/adapter — Issue normalization", () => {
    it("toIssue maps description=null to empty string", () => {
      const issue = __internal__.toIssue({
        id: "id1",
        identifier: "CYFY-5",
        title: "t",
        description: null,
        state: { name: "Todo" },
        priority: null,
        createdAt: "2026-01-01T00:00:00Z",
        assignee: null,
      }, { kind: "none" });
      expect(issue.description).toBe("");
      expect(issue.identifier).toBe("CYFY-5");
      expect(issue.state).toBe("Todo");
    });

    it("toIssue populates priority, createdAt, assigneeId, assignedToWorker, blockedBy", () => {
      const issue = __internal__.toIssue({
        id: "id2",
        identifier: "CYFY-6",
        title: "t2",
        description: "d",
        state: { name: "In Progress" },
        priority: 2,
        createdAt: "2026-05-01T12:00:00Z",
        assignee: { id: "user_42" },
        inverseRelations: {
          nodes: [{ type: "blocks", issue: { id: "id1", state: { name: "Todo" } } }],
        },
      }, { kind: "id", id: "user_42" });
      expect(issue.priority).toBe(2);
      expect(issue.createdAt).toEqual(new Date("2026-05-01T12:00:00Z"));
      expect(issue.assigneeId).toBe("user_42");
      expect(issue.assignedToWorker).toBe(true);
      expect(issue.blockedBy).toHaveLength(1);
      expect(issue.blockedBy[0]?.id).toBe("id1");
    });

    it("toIssue sets assignedToWorker=false when assignee does not match filter", () => {
      const issue = __internal__.toIssue({
        id: "id3",
        identifier: "CYFY-7",
        title: "t3",
        description: "d",
        state: { name: "Todo" },
        priority: null,
        createdAt: "2026-01-01T00:00:00Z",
        assignee: { id: "user_other" },
      }, { kind: "id", id: "user_42" });
      expect(issue.assignedToWorker).toBe(false);
    });
  });

  describe("tracker/linear/adapter — updateIssueState retry", () => {
    const issueAtTodo = {
      id: v.parse(IssueId.schema, "id1"),
      identifier: v.parse(IssueIdentifier.schema, "CYFY-5"),
      title: "t",
      description: "",
      state: v.parse(IssueStateName.schema, "Todo"),
      priority: null,
      createdAt: null,
      assigneeId: null,
      assignedToWorker: true,
      blockedBy: [],
    } as const satisfies Issue;

    const STATE_RESOLVE_OK = { data: { issue: { team: { states: { nodes: [{ id: "state_done" }] } } } } };
    const UPDATE_OK = { data: { issueUpdate: { success: true } } };
    const UPDATE_FAIL = { data: { issueUpdate: { success: false } } };

    const makeFetch = (bodies: ReadonlyArray<unknown>) => {
      let i = 0;
      return vi.fn(async () => {
        const body = bodies[i++];
        if (body === undefined) throw new Error("unexpected extra fetch");
        return new Response(JSON.stringify(body), { status: 200 });
      }) as unknown as typeof globalThis.fetch;
    };

    it("succeeds on first attempt (1 resolveStateId + 1 mutation)", async () => {
      const fetchFn = makeFetch([STATE_RESOLVE_OK, UPDATE_OK]);
      const r = await createLinearTracker(baseCfg(), { logger: silentLogger, fetch: fetchFn });
      if (r.type !== "Success") throw new Error("expected success");
      const u = await r.value.updateIssueState(issueAtTodo, v.parse(IssueStateName.schema, "Done"));
      if (u.type !== "Success") throw new Error("expected success");
      expect((fetchFn as any).mock.calls.length).toBe(2);
    });

    it("retries up to 3 times and falls back to ok(undefined) + warn", async () => {
      const fetchFn = makeFetch([STATE_RESOLVE_OK, UPDATE_FAIL, UPDATE_FAIL, UPDATE_FAIL]);
      const warnings: string[] = [];
      const logger: Logger = { info: () => {}, warn: (m) => warnings.push(m), error: () => {} };
      const r = await createLinearTracker(baseCfg(), { logger, fetch: fetchFn });
      if (r.type !== "Success") throw new Error("expected success");

      vi.useFakeTimers();
      const promise = r.value.updateIssueState(issueAtTodo, v.parse(IssueStateName.schema, "Done"));
      await vi.advanceTimersByTimeAsync(250);
      await vi.advanceTimersByTimeAsync(1000);
      vi.useRealTimers();
      const u = await promise;
      if (u.type !== "Success") throw new Error("expected best-effort success");
      expect((fetchFn as any).mock.calls.length).toBe(4); // 1 resolve + 3 update attempts
      expect(warnings.some((w) => w.includes("failed after 3 attempts"))).toBe(true);
    });

    it("returns linear-state-not-found when team has no matching state (no retries)", async () => {
      const fetchFn = makeFetch([
        { data: { issue: { team: { states: { nodes: [] } } } } },
      ]);
      const r = await createLinearTracker(baseCfg(), { logger: silentLogger, fetch: fetchFn });
      if (r.type !== "Success") throw new Error("expected success");
      const u = await r.value.updateIssueState(issueAtTodo, v.parse(IssueStateName.schema, "Done"));
      if (u.type !== "Failure") throw new Error("expected failure");
      expect(u.error.kind).toBe("linear-state-not-found");
      expect((fetchFn as any).mock.calls.length).toBe(1); // only the resolve query, no retries
    });
  });

  describe("tracker/linear/adapter — fetch callbacks", () => {
    const makeFetch = (responses: ReadonlyArray<unknown>) => {
      let i = 0;
      return vi.fn(async () => {
        const body = responses[i++];
        if (body === undefined) throw new Error("unexpected extra fetch call");
        return new Response(JSON.stringify(body), { status: 200 });
      }) as unknown as typeof globalThis.fetch;
    };
    const nodeOf = (id: string, identifier: string, state: string) => ({
      id, identifier, title: "t", description: "d", state: { name: state },
      priority: null, createdAt: "2026-01-01T00:00:00Z", assignee: null,
    });

    it("fetchCandidateIssues returns flattened issues across pages (no assignee filter)", async () => {
      const fetchFn = makeFetch([
        { data: { issues: { nodes: [nodeOf("a", "CYFY-1", "Todo")], pageInfo: { hasNextPage: true, endCursor: "c1" } } } },
        { data: { issues: { nodes: [nodeOf("b", "CYFY-2", "Todo")], pageInfo: { hasNextPage: false, endCursor: null } } } },
      ]);
      const r = await createLinearTracker(baseCfg(), { logger: silentLogger, fetch: fetchFn });
      if (r.type !== "Success") throw new Error("expected success");
      const issues = await r.value.fetchCandidateIssues();
      if (issues.type !== "Success") throw new Error("expected success");
      expect(issues.value.map((i) => i.id)).toEqual(["a", "b"]);
      // Verify it used LIST_ISSUES_QUERY (no assigneeId variable)
      const firstReqBody = JSON.parse((fetchFn as any).mock.calls[0][1].body);
      expect(firstReqBody.variables).not.toHaveProperty("assigneeId");
    });

    it("fetchCandidateIssues uses LIST_ISSUES_BY_ASSIGNEE_QUERY when assignee=me resolved", async () => {
      const fetchFn = makeFetch([
        { data: { viewer: { id: "user_me" } } },
        { data: { issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } },
      ]);
      const r = await createLinearTracker(baseCfg({ assignee: "me" }), { logger: silentLogger, fetch: fetchFn });
      if (r.type !== "Success") throw new Error("expected success");
      await r.value.fetchCandidateIssues();
      const issuesReqBody = JSON.parse((fetchFn as any).mock.calls[1][1].body);
      expect(issuesReqBody.variables.assigneeId).toBe("user_me");
    });

    it("fetchIssueStatesByIds preserves the requested id order", async () => {
      const fetchFn = makeFetch([
        { data: { issues: { nodes: [nodeOf("c", "CYFY-3", "Done"), nodeOf("a", "CYFY-1", "Todo"), nodeOf("b", "CYFY-2", "InProgress")] } } },
      ]);
      const r = await createLinearTracker(baseCfg(), { logger: silentLogger, fetch: fetchFn });
      if (r.type !== "Success") throw new Error("expected success");
      const out = await r.value.fetchIssueStatesByIds([
        v.parse(IssueId.schema, "a"),
        v.parse(IssueId.schema, "b"),
        v.parse(IssueId.schema, "c"),
      ]);
      if (out.type !== "Success") throw new Error("expected success");
      expect(out.value.map((i) => i.id)).toEqual(["a", "b", "c"]);
    });

    it("createComment returns Failure when success=false", async () => {
      const fetchFn = makeFetch([
        { data: { commentCreate: { success: false } } },
      ]);
      const r = await createLinearTracker(baseCfg(), { logger: silentLogger, fetch: fetchFn });
      if (r.type !== "Success") throw new Error("expected success");
      const c = await r.value.createComment(v.parse(IssueId.schema, "id1"), "hi");
      if (c.type !== "Failure") throw new Error("expected failure");
      expect(c.error.kind).toBe("linear-graphql-errors");
    });
  });
}
