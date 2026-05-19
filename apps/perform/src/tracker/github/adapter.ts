// apps/perform/src/tracker/github/adapter.ts
import { Result } from "@praha/byethrow";
import * as v from "valibot";
import type { Logger } from "../../orchestrator/orchestrator.js";
import type { TrackerError } from "../../domain/tracker-errors.js";
import type { GithubTrackerConfig } from "../../domain/tracker-config.js";
import { Sensitive } from "../../util/sensitive.js";
import { type Issue, IssueId, IssueIdentifier, IssueStateName } from "../../domain/issue.js";
import type { Tracker } from "../types.js";
import {
  DEFAULT_GITHUB_ENDPOINT,
  githubQuery,
  githubMutation,
  type GithubClientDeps,
} from "./client.js";
import { warmupGithubProjectMeta, type GithubProjectMeta } from "./project-meta.js";
import {
  POLL_ITEMS_QUERY,
  PollItemsResponseSchema,
  ISSUES_BY_IDS_QUERY,
  IssuesByIdsResponseSchema,
  ADD_COMMENT_MUTATION,
  AddCommentResponseSchema,
  UPDATE_ITEM_STATUS_MUTATION,
  UpdateItemStatusResponseSchema,
  isSingleSelectFieldValue,
  isIssueContent,
  isIssueByIdNode,
  IssueContentSchema,
} from "./queries.js";
import type { PollItemNode, IssueByIdNode } from "./queries.js";

type AssigneeFilter = Readonly<{ kind: "none" }> | Readonly<{ kind: "login"; login: string }>;

const resolveAssigneeFilter = (
  assignee: string | undefined,
  viewerLogin: string,
): AssigneeFilter => {
  if (assignee === undefined) return { kind: "none" };
  const trimmed = assignee.trim();
  if (trimmed === "") return { kind: "none" };
  if (trimmed === "me") return { kind: "login", login: viewerLogin };
  return { kind: "login", login: trimmed };
};

/** Symphony parity: priority maps from a ProjectV2 single-select field "Priority" with options "P1".."P4". */
const PRIORITY_OPTION_REGEX = /^P([1-4])$/;

const priorityFromFieldValues = (
  fieldValues: { nodes: ReadonlyArray<unknown> } | null | undefined,
): 1 | 2 | 3 | 4 | null => {
  if (!fieldValues) return null;
  for (const fv of fieldValues.nodes) {
    if (!isSingleSelectFieldValue(fv as any)) continue;
    const ssv = fv as { field: { name: string }; name: string | null };
    if (ssv.field.name !== "Priority") continue;
    const match = PRIORITY_OPTION_REGEX.exec(ssv.name ?? "");
    if (match) return Number(match[1]) as 1 | 2 | 3 | 4;
  }
  return null;
};

const extractStatusRaw = (fieldValues: PollItemNode["fieldValues"]): string | null => {
  for (const fv of fieldValues.nodes) {
    if (!isSingleSelectFieldValue(fv)) continue;
    if (fv.field.name !== "Status") continue;
    if (typeof fv.name === "string" && fv.name.length > 0) return fv.name;
  }
  return null;
};

const firstAssigneeLogin = (
  assignees: { nodes: ReadonlyArray<{ login: string }> } | null | undefined,
): string | null => {
  if (!assignees) return null;
  const node = assignees.nodes[0];
  return node ? node.login : null;
};

const toIssueFromPollItem = (
  meta: GithubProjectMeta,
  item: PollItemNode & { content: IssueContentNarrowed },
  state: string,
  assigneeFilter: AssigneeFilter,
): Issue => {
  const identifier = `${item.content.repository.nameWithOwner}#${item.content.number}`;
  const assigneeLogin = firstAssigneeLogin(item.content.assignees);
  return {
    id: v.parse(IssueId.schema, item.content.id),
    identifier: v.parse(IssueIdentifier.schema, identifier),
    title: item.content.title,
    description: item.content.body ?? "",
    state: v.parse(IssueStateName.schema, state),
    priority: priorityFromFieldValues(item.fieldValues),
    createdAt: item.content.createdAt ? new Date(item.content.createdAt) : null,
    assigneeId: assigneeLogin,
    assignedToWorker:
      assigneeFilter.kind === "none" ? true : assigneeLogin === assigneeFilter.login,
    blockedBy: [],
    extra: { kind: "github", projectId: meta.projectId, projectItemId: item.id },
  };
};

const PAGE_SIZE = 50;

const fetchAllProjectItems = async (
  clientDeps: GithubClientDeps,
  projectId: string,
): Promise<Result.Result<ReadonlyArray<PollItemNode>, TrackerError>> => {
  const acc: PollItemNode[] = [];
  let cursor: string | null = null;
  type PollItemsResult = Result.Result<v.InferOutput<typeof PollItemsResponseSchema>, TrackerError>;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r: PollItemsResult = await githubQuery(
      clientDeps,
      POLL_ITEMS_QUERY,
      { projectId, first: PAGE_SIZE, after: cursor },
      PollItemsResponseSchema,
    );
    if (r.type === "Failure") return r;
    const node: v.InferOutput<typeof PollItemsResponseSchema>["data"]["node"] = r.value.data.node;
    if (!node) {
      return {
        type: "Failure",
        error: { kind: "github-config", cause: `project node ${projectId} not visible` },
      };
    }
    for (const item of node.items.nodes) acc.push(item);
    if (!node.items.pageInfo.hasNextPage) break;
    cursor = node.items.pageInfo.endCursor;
    if (cursor === null) break;
  }
  return { type: "Success", value: acc };
};

type IssueContentNarrowed = v.InferOutput<typeof IssueContentSchema>;

const hasIssueContent = (
  item: PollItemNode,
): item is PollItemNode & { content: IssueContentNarrowed } =>
  item.content !== null && isIssueContent(item.content);

const filterAndNormalize = (
  meta: GithubProjectMeta,
  items: ReadonlyArray<PollItemNode>,
  stateAllow: ReadonlySet<string>,
  assigneeFilter: AssigneeFilter,
): ReadonlyArray<Issue> => {
  const out: Issue[] = [];
  for (const item of items) {
    if (!hasIssueContent(item)) continue;
    const state = extractStatusRaw(item.fieldValues);
    if (state === null) continue;
    if (!stateAllow.has(state)) continue;
    if (assigneeFilter.kind === "login") {
      const login = firstAssigneeLogin(item.content.assignees);
      if (login !== assigneeFilter.login) continue;
    }
    out.push(toIssueFromPollItem(meta, item, state, assigneeFilter));
  }
  return out;
};

const ISSUES_BY_IDS_BATCH = 50;

const extractStatusFromProjectItem = (
  fieldValues: IssueByIdNode["projectItems"]["nodes"][number]["fieldValues"],
): string | null => {
  for (const fv of fieldValues.nodes) {
    if (!isSingleSelectFieldValue(fv)) continue;
    if (fv.field.name !== "Status") continue;
    if (typeof fv.name === "string" && fv.name.length > 0) return fv.name;
  }
  return null;
};

const toIssueFromIssueNode = (
  meta: GithubProjectMeta,
  node: IssueByIdNode,
  assigneeFilter: AssigneeFilter,
): Issue | null => {
  const matching = node.projectItems.nodes.find((pi) => pi.project.id === meta.projectId);
  if (!matching) return null;
  const state = extractStatusFromProjectItem(matching.fieldValues);
  if (state === null) return null;
  const identifier = `${node.repository.nameWithOwner}#${node.number}`;
  const assigneeLogin = firstAssigneeLogin(node.assignees);
  return {
    id: v.parse(IssueId.schema, node.id),
    identifier: v.parse(IssueIdentifier.schema, identifier),
    title: node.title,
    description: node.body ?? "",
    state: v.parse(IssueStateName.schema, state),
    priority: priorityFromFieldValues(matching.fieldValues),
    createdAt: node.createdAt ? new Date(node.createdAt) : null,
    assigneeId: assigneeLogin,
    assignedToWorker:
      assigneeFilter.kind === "none" ? true : assigneeLogin === assigneeFilter.login,
    blockedBy: [],
    extra: { kind: "github", projectId: meta.projectId, projectItemId: matching.id },
  };
};

const fetchIssuesByIds = async (
  clientDeps: GithubClientDeps,
  meta: GithubProjectMeta,
  ids: ReadonlyArray<string>,
  assigneeFilter: AssigneeFilter,
): Promise<Result.Result<ReadonlyArray<Issue>, TrackerError>> => {
  if (ids.length === 0) return { type: "Success", value: [] };
  const uniq = Array.from(new Set(ids));
  const acc: Issue[] = [];
  for (let i = 0; i < uniq.length; i += ISSUES_BY_IDS_BATCH) {
    const batch = uniq.slice(i, i + ISSUES_BY_IDS_BATCH);
    const r = await githubQuery(
      clientDeps,
      ISSUES_BY_IDS_QUERY,
      { ids: batch },
      IssuesByIdsResponseSchema,
    );
    if (r.type === "Failure") return r;
    for (const raw of r.value.data.nodes) {
      if (raw === null) continue;
      if (!isIssueByIdNode(raw)) continue;
      const issue = toIssueFromIssueNode(meta, raw, assigneeFilter);
      if (issue !== null) acc.push(issue);
    }
  }
  const order = new Map(uniq.map((id, idx) => [id, idx] as const));
  acc.sort(
    (a, b) =>
      (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
  return { type: "Success", value: acc };
};

const createCommentImpl = async (
  clientDeps: GithubClientDeps,
  issueId: string,
  body: string,
): Promise<Result.Result<void, TrackerError>> => {
  const r = await githubMutation(
    clientDeps,
    ADD_COMMENT_MUTATION,
    { subjectId: issueId, body },
    AddCommentResponseSchema,
  );
  if (r.type === "Failure") return r;
  return { type: "Success", value: undefined };
};

const RETRY_DELAYS_MS: ReadonlyArray<number> = [250, 1000];
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const doUpdateItemStatus = async (
  clientDeps: GithubClientDeps,
  vars: { projectId: string; itemId: string; fieldId: string; optionId: string },
): Promise<Result.Result<void, TrackerError>> => {
  const r = await githubMutation(
    clientDeps,
    UPDATE_ITEM_STATUS_MUTATION,
    vars,
    UpdateItemStatusResponseSchema,
  );
  if (r.type === "Failure") return r;
  return { type: "Success", value: undefined };
};

const resolveStatusOption = (
  meta: GithubProjectMeta,
  issue: Issue,
  stateName: string,
): Result.Result<{ projectId: string; itemId: string; optionId: string }, TrackerError> => {
  if (issue.extra?.kind !== "github") {
    return {
      type: "Failure",
      error: { kind: "github-no-project-item", issueIdentifier: issue.identifier },
    };
  }
  const optionId = meta.statusOptions.get(stateName);
  if (!optionId) {
    return {
      type: "Failure",
      error: {
        kind: "github-status-option-not-found",
        optionName: stateName,
        available: [...meta.statusOptions.keys()],
      },
    };
  }
  return {
    type: "Success",
    value: { projectId: issue.extra.projectId, itemId: issue.extra.projectItemId, optionId },
  };
};

const retryUpdateItemStatus = async (
  clientDeps: GithubClientDeps,
  fieldId: string,
  vars: { projectId: string; itemId: string; optionId: string },
  logger: Logger,
  issueIdentifier: string,
): Promise<Result.Result<void, TrackerError>> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await doUpdateItemStatus(clientDeps, { fieldId, ...vars });
    if (r.type === "Success") return r;
    if (attempt < RETRY_DELAYS_MS.length) {
      logger.info(
        `[github] updateIssueState retry ${attempt + 1}/3 after ${RETRY_DELAYS_MS[attempt]}ms (issue=${issueIdentifier})`,
      );
      await delay(RETRY_DELAYS_MS[attempt]!);
    }
  }
  logger.warn(
    `[github] updateIssueState failed after 3 attempts (issue=${issueIdentifier}); continuing best-effort per ADR-0014`,
  );
  return { type: "Success", value: undefined };
};

const updateStateWithRetry = (
  clientDeps: GithubClientDeps,
  meta: GithubProjectMeta,
  logger: Logger,
  issue: Issue,
  stateName: string,
): Promise<Result.Result<void, TrackerError>> =>
  Result.pipe(
    resolveStatusOption(meta, issue, stateName),
    Result.andThen((vars) =>
      retryUpdateItemStatus(clientDeps, meta.statusFieldId, vars, logger, issue.identifier),
    ),
  );

export const createGithubTracker = async (
  config: GithubTrackerConfig,
  deps: { logger: Logger; fetch?: typeof globalThis.fetch },
): Promise<Result.Result<Tracker, TrackerError>> => {
  const clientDeps: GithubClientDeps = {
    endpoint: config.endpoint ?? DEFAULT_GITHUB_ENDPOINT,
    apiKey: config.apiKey,
    ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
  };

  const metaR = await warmupGithubProjectMeta(clientDeps, config);
  if (metaR.type === "Failure") return metaR;
  const meta = metaR.value;
  const assigneeFilter = resolveAssigneeFilter(config.assignee, meta.viewerLogin);

  return {
    type: "Success",
    value: {
      fetchCandidateIssues: async () => {
        const itemsR = await fetchAllProjectItems(clientDeps, meta.projectId);
        if (itemsR.type === "Failure") return itemsR;
        const allow = new Set<string>(config.activeStates);
        return {
          type: "Success",
          value: filterAndNormalize(meta, itemsR.value, allow, assigneeFilter),
        };
      },
      fetchIssuesByStates: async (states) => {
        if (states.length === 0) return { type: "Success", value: [] };
        const itemsR = await fetchAllProjectItems(clientDeps, meta.projectId);
        if (itemsR.type === "Failure") return itemsR;
        const allow = new Set<string>(states);
        return {
          type: "Success",
          value: filterAndNormalize(meta, itemsR.value, allow, { kind: "none" }),
        };
      },
      fetchIssueStatesByIds: (ids) => fetchIssuesByIds(clientDeps, meta, ids, assigneeFilter),
      createComment: (issueId, body) => createCommentImpl(clientDeps, issueId, body),
      updateIssueState: (issue, state) =>
        updateStateWithRetry(clientDeps, meta, deps.logger, issue, state),
    },
  };
};

export const __internal__ = {
  resolveAssigneeFilter,
  extractStatusRaw,
  firstAssigneeLogin,
  priorityFromFieldValues,
  toIssueFromPollItem,
  toIssueFromIssueNode,
  extractStatusFromProjectItem,
};

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

  const baseConfig: GithubTrackerConfig = {
    kind: "github",
    activeStates: ["Todo"],
    terminalStates: ["Done"],
    apiKey: Sensitive.of("ghp_t"),
    projectOwner: "babie",
    projectNumber: 3,
  };

  const projectV2OK = {
    id: "PVT_1",
    title: "p",
    fields: {
      nodes: [
        {
          __typename: "ProjectV2SingleSelectField",
          id: "FLD_1",
          name: "Status",
          options: [
            { id: "opt_todo", name: "Todo" },
            { id: "opt_done", name: "Done" },
          ],
        },
      ],
    },
  };

  const makeFetch = (bodies: ReadonlyArray<{ status?: number; json: unknown }>) => {
    let i = 0;
    return vi.fn(async () => {
      const next = bodies[i++];
      if (!next) throw new Error(`unexpected extra fetch (idx=${i - 1})`);
      return new Response(JSON.stringify(next.json), { status: next.status ?? 200 });
    }) as unknown as typeof globalThis.fetch;
  };

  describe("tracker/github/adapter — construction + assignee resolution", () => {
    it("resolveAssigneeFilter returns 'none' for undefined / empty", () => {
      expect(__internal__.resolveAssigneeFilter(undefined, "babie").kind).toBe("none");
      expect(__internal__.resolveAssigneeFilter("", "babie").kind).toBe("none");
      expect(__internal__.resolveAssigneeFilter("   ", "babie").kind).toBe("none");
    });

    it("resolveAssigneeFilter('me') maps to viewerLogin", () => {
      const r = __internal__.resolveAssigneeFilter("me", "babie");
      expect(r.kind).toBe("login");
      if (r.kind === "login") expect(r.login).toBe("babie");
    });

    it("resolveAssigneeFilter(literal) uses the literal login", () => {
      const r = __internal__.resolveAssigneeFilter("alice", "babie");
      if (r.kind === "login") expect(r.login).toBe("alice");
    });

    it("createGithubTracker propagates warmup Failure", async () => {
      const fetchFn = makeFetch([
        { json: { data: { user: null } } },
        { json: { data: { organization: null } } },
      ]);
      const r = await createGithubTracker(baseConfig, { logger: silentLogger, fetch: fetchFn });
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("github-project-not-found");
    });

    it("createGithubTracker succeeds when warmup succeeds (fetchCandidateIssues returns empty list)", async () => {
      const emptyPollPage = {
        data: {
          node: {
            items: {
              nodes: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      };
      const fetchFn = makeFetch([
        { json: { data: { user: { projectV2: projectV2OK } } } },
        { json: { data: { viewer: { login: "babie" } } } },
        { json: emptyPollPage },
      ]);
      const r = await createGithubTracker(
        { ...baseConfig, assignee: "me" },
        { logger: silentLogger, fetch: fetchFn },
      );
      if (r.type !== "Success") throw new Error("expected success");
      const c = await r.value.fetchCandidateIssues();
      if (c.type !== "Success") throw new Error("expected success");
      expect(c.value).toEqual([]);
    });
  });

  describe("tracker/github/adapter — pure helpers", () => {
    it("extractStatusRaw picks the Status SingleSelect value", () => {
      const fieldValues = {
        nodes: [
          { __typename: "ProjectV2ItemFieldTextValue" },
          {
            __typename: "ProjectV2ItemFieldSingleSelectValue",
            field: { name: "Status" },
            name: "Todo",
            optionId: "opt_todo",
          },
        ],
      } as any;
      expect(__internal__.extractStatusRaw(fieldValues)).toBe("Todo");
    });

    it("extractStatusRaw returns null when no SingleSelect Status value present", () => {
      const fieldValues = {
        nodes: [{ __typename: "ProjectV2ItemFieldTextValue" }],
      } as any;
      expect(__internal__.extractStatusRaw(fieldValues)).toBeNull();
    });

    it("firstAssigneeLogin returns first node login", () => {
      const a = { nodes: [{ login: "alice" }, { login: "bob" }] } as any;
      expect(__internal__.firstAssigneeLogin(a)).toBe("alice");
    });

    it("firstAssigneeLogin returns null when empty / missing", () => {
      expect(__internal__.firstAssigneeLogin({ nodes: [] } as any)).toBeNull();
      expect(__internal__.firstAssigneeLogin(undefined as any)).toBeNull();
    });

    it("priorityFromFieldValues maps P1..P4 to 1..4 and returns null otherwise", () => {
      const mk = (name: string, fieldName = "Priority") => ({
        __typename: "ProjectV2ItemFieldSingleSelectValue" as const,
        name,
        field: { __typename: "ProjectV2SingleSelectField" as const, name: fieldName },
      });
      expect(__internal__.priorityFromFieldValues({ nodes: [mk("P1")] })).toBe(1);
      expect(__internal__.priorityFromFieldValues({ nodes: [mk("P2")] })).toBe(2);
      expect(__internal__.priorityFromFieldValues({ nodes: [mk("P3")] })).toBe(3);
      expect(__internal__.priorityFromFieldValues({ nodes: [mk("P4")] })).toBe(4);
      expect(__internal__.priorityFromFieldValues({ nodes: [mk("P5")] })).toBeNull();
      expect(__internal__.priorityFromFieldValues({ nodes: [mk("High", "Priority")] })).toBeNull();
      expect(__internal__.priorityFromFieldValues({ nodes: [mk("P1", "OtherField")] })).toBeNull();
      expect(__internal__.priorityFromFieldValues({ nodes: [] })).toBeNull();
      expect(__internal__.priorityFromFieldValues(null)).toBeNull();
    });

    it("toIssueFromPollItem builds branded Issue with extra=github", () => {
      const meta: GithubProjectMeta = {
        projectId: "PVT_1",
        statusFieldId: "FLD_1",
        statusOptions: new Map([["Todo", "opt_todo"]]),
        viewerLogin: "babie",
      };
      const item = {
        id: "PVTI_1",
        content: {
          __typename: "Issue",
          id: "I_1",
          number: 1,
          title: "t",
          body: null,
          repository: { nameWithOwner: "babie/studio" },
        },
        fieldValues: { nodes: [] },
      } as any;
      const issue = __internal__.toIssueFromPollItem(meta, item, "Todo", { kind: "none" });
      expect(issue.identifier).toBe("babie/studio#1");
      expect(issue.description).toBe("");
      expect(issue.extra?.kind).toBe("github");
      if (issue.extra?.kind === "github") {
        expect(issue.extra.projectId).toBe("PVT_1");
        expect(issue.extra.projectItemId).toBe("PVTI_1");
      }
    });

    it("toIssueFromPollItem populates priority/createdAt/assigneeId/assignedToWorker/blockedBy", () => {
      const meta: GithubProjectMeta = {
        projectId: "PVT_1",
        statusFieldId: "FLD_1",
        statusOptions: new Map([["Todo", "opt_todo"]]),
        viewerLogin: "babie",
      };
      const item = {
        id: "PVTI_1",
        content: {
          __typename: "Issue",
          id: "I_1",
          number: 1,
          title: "t",
          body: "desc",
          createdAt: "2024-01-01T00:00:00Z",
          repository: { nameWithOwner: "babie/studio" },
          assignees: { nodes: [{ login: "alice" }] },
        },
        fieldValues: {
          nodes: [
            {
              __typename: "ProjectV2ItemFieldSingleSelectValue",
              field: { name: "Priority" },
              name: "P2",
            },
          ],
        },
      } as any;
      const issueNone = __internal__.toIssueFromPollItem(meta, item, "Todo", { kind: "none" });
      expect(issueNone.priority).toBe(2);
      expect(issueNone.createdAt).toEqual(new Date("2024-01-01T00:00:00Z"));
      expect(issueNone.assigneeId).toBe("alice");
      expect(issueNone.assignedToWorker).toBe(true); // kind=none → always true
      expect(issueNone.blockedBy).toEqual([]);

      const issueLogin = __internal__.toIssueFromPollItem(meta, item, "Todo", {
        kind: "login",
        login: "alice",
      });
      expect(issueLogin.assignedToWorker).toBe(true); // assignee matches

      const issueOther = __internal__.toIssueFromPollItem(meta, item, "Todo", {
        kind: "login",
        login: "bob",
      });
      expect(issueOther.assignedToWorker).toBe(false); // assignee does not match
    });
  });

  describe("tracker/github/adapter — fetchCandidateIssues / fetchIssuesByStates", () => {
    const pollPage = (
      nodes: ReadonlyArray<{
        id: string;
        content: any;
        state?: string | null;
        assigneeLogin?: string;
      }>,
      hasNext: boolean,
      endCursor: string | null,
    ) => ({
      data: {
        node: {
          items: {
            nodes: nodes.map((n) => ({
              id: n.id,
              content:
                n.content === null
                  ? null
                  : {
                      ...n.content,
                      ...(n.assigneeLogin
                        ? { assignees: { nodes: [{ login: n.assigneeLogin }] } }
                        : {}),
                    },
              fieldValues: {
                nodes:
                  n.state === undefined || n.state === null
                    ? []
                    : [
                        {
                          __typename: "ProjectV2ItemFieldSingleSelectValue",
                          field: { name: "Status" },
                          name: n.state,
                          optionId: `opt_${n.state}`,
                        },
                      ],
              },
            })),
            pageInfo: { hasNextPage: hasNext, endCursor },
          },
        },
      },
    });
    const issueContent = (id: string, number: number) => ({
      __typename: "Issue",
      id,
      number,
      title: `t-${number}`,
      body: null,
      repository: { nameWithOwner: "babie/studio" },
    });

    it("paginates across two pages and merges results", async () => {
      const fetchFn = makeFetch([
        { json: { data: { user: { projectV2: projectV2OK } } } },
        { json: { data: { viewer: { login: "babie" } } } },
        {
          json: pollPage(
            [{ id: "PVTI_1", content: issueContent("I_1", 1), state: "Todo" }],
            true,
            "c1",
          ),
        },
        {
          json: pollPage(
            [{ id: "PVTI_2", content: issueContent("I_2", 2), state: "Todo" }],
            false,
            null,
          ),
        },
      ]);
      const r = await createGithubTracker(baseConfig, { logger: silentLogger, fetch: fetchFn });
      if (r.type !== "Success") throw new Error("expected success");
      const c = await r.value.fetchCandidateIssues();
      if (c.type !== "Success") throw new Error("expected success");
      expect(c.value.map((i) => i.identifier)).toEqual(["babie/studio#1", "babie/studio#2"]);
    });

    it("excludes PullRequest / DraftIssue / null content", async () => {
      const fetchFn = makeFetch([
        { json: { data: { user: { projectV2: projectV2OK } } } },
        { json: { data: { viewer: { login: "babie" } } } },
        {
          json: pollPage(
            [
              { id: "PVTI_1", content: issueContent("I_1", 1), state: "Todo" },
              { id: "PVTI_2", content: { __typename: "PullRequest" }, state: "Todo" },
              { id: "PVTI_3", content: { __typename: "DraftIssue" }, state: "Todo" },
              { id: "PVTI_4", content: null, state: "Todo" },
            ],
            false,
            null,
          ),
        },
      ]);
      const r = await createGithubTracker(baseConfig, { logger: silentLogger, fetch: fetchFn });
      if (r.type !== "Success") throw new Error("expected success");
      const c = await r.value.fetchCandidateIssues();
      if (c.type !== "Success") throw new Error("expected success");
      expect(c.value.length).toBe(1);
      expect(c.value[0]!.id).toBe("I_1");
    });

    it("filters by activeStates", async () => {
      const fetchFn = makeFetch([
        { json: { data: { user: { projectV2: projectV2OK } } } },
        { json: { data: { viewer: { login: "babie" } } } },
        {
          json: pollPage(
            [
              { id: "PVTI_1", content: issueContent("I_1", 1), state: "Todo" },
              { id: "PVTI_2", content: issueContent("I_2", 2), state: "Done" },
            ],
            false,
            null,
          ),
        },
      ]);
      const r = await createGithubTracker(baseConfig, { logger: silentLogger, fetch: fetchFn });
      if (r.type !== "Success") throw new Error("expected success");
      const c = await r.value.fetchCandidateIssues();
      if (c.type !== "Success") throw new Error("expected success");
      expect(c.value.map((i) => i.id)).toEqual(["I_1"]);
    });

    it("filters by assignee login when assigneeFilter is set", async () => {
      const fetchFn = makeFetch([
        { json: { data: { user: { projectV2: projectV2OK } } } },
        { json: { data: { viewer: { login: "babie" } } } },
        {
          json: pollPage(
            [
              {
                id: "PVTI_1",
                content: issueContent("I_1", 1),
                state: "Todo",
                assigneeLogin: "babie",
              },
              {
                id: "PVTI_2",
                content: issueContent("I_2", 2),
                state: "Todo",
                assigneeLogin: "alice",
              },
              { id: "PVTI_3", content: issueContent("I_3", 3), state: "Todo" /* no assignees */ },
            ],
            false,
            null,
          ),
        },
      ]);
      const r = await createGithubTracker(
        { ...baseConfig, assignee: "me" },
        { logger: silentLogger, fetch: fetchFn },
      );
      if (r.type !== "Success") throw new Error("expected success");
      const c = await r.value.fetchCandidateIssues();
      if (c.type !== "Success") throw new Error("expected success");
      expect(c.value.map((i) => i.id)).toEqual(["I_1"]);
    });

    it("fetchIssuesByStates ignores assignee filter", async () => {
      const fetchFn = makeFetch([
        { json: { data: { user: { projectV2: projectV2OK } } } },
        { json: { data: { viewer: { login: "babie" } } } },
        {
          json: pollPage(
            [
              {
                id: "PVTI_1",
                content: issueContent("I_1", 1),
                state: "Done",
                assigneeLogin: "alice",
              },
              {
                id: "PVTI_2",
                content: issueContent("I_2", 2),
                state: "Todo",
                assigneeLogin: "babie",
              },
            ],
            false,
            null,
          ),
        },
      ]);
      const r = await createGithubTracker(
        { ...baseConfig, assignee: "me" },
        { logger: silentLogger, fetch: fetchFn },
      );
      if (r.type !== "Success") throw new Error("expected success");
      const c = await r.value.fetchIssuesByStates([v.parse(IssueStateName.schema, "Done")]);
      if (c.type !== "Success") throw new Error("expected success");
      expect(c.value.map((i) => i.id)).toEqual(["I_1"]);
    });

    it("fetchIssuesByStates([]) returns []", async () => {
      const fetchFn = makeFetch([
        { json: { data: { user: { projectV2: projectV2OK } } } },
        { json: { data: { viewer: { login: "babie" } } } },
      ]);
      const r = await createGithubTracker(baseConfig, { logger: silentLogger, fetch: fetchFn });
      if (r.type !== "Success") throw new Error("expected success");
      const c = await r.value.fetchIssuesByStates([]);
      if (c.type !== "Success") throw new Error("expected success");
      expect(c.value).toEqual([]);
    });
  });

  describe("tracker/github/adapter — fetchIssueStatesByIds", () => {
    const issueByIdNode = (
      id: string,
      number: number,
      state: string | null,
      opts: { projectId?: string; projectItemId?: string } = {},
    ) => ({
      __typename: "Issue",
      id,
      number,
      title: `t-${number}`,
      body: null,
      repository: { nameWithOwner: "babie/studio" },
      projectItems: {
        nodes: [
          {
            id: opts.projectItemId ?? `PVTI_${number}`,
            project: { id: opts.projectId ?? "PVT_1" },
            fieldValues: {
              nodes:
                state === null
                  ? []
                  : [
                      {
                        __typename: "ProjectV2ItemFieldSingleSelectValue",
                        field: { name: "Status" },
                        name: state,
                      },
                    ],
            },
          },
        ],
      },
    });

    it("returns issues in requested id order, filtering to meta.projectId", async () => {
      const fetchFn = makeFetch([
        { json: { data: { user: { projectV2: projectV2OK } } } },
        { json: { data: { viewer: { login: "babie" } } } },
        {
          json: {
            data: {
              nodes: [
                issueByIdNode("I_3", 3, "Done"),
                issueByIdNode("I_1", 1, "Todo"),
                issueByIdNode("I_2", 2, "Done"),
              ],
            },
          },
        },
      ]);
      const r = await createGithubTracker(baseConfig, { logger: silentLogger, fetch: fetchFn });
      if (r.type !== "Success") throw new Error("expected success");
      const out = await r.value.fetchIssueStatesByIds([
        v.parse(IssueId.schema, "I_1"),
        v.parse(IssueId.schema, "I_2"),
        v.parse(IssueId.schema, "I_3"),
      ]);
      if (out.type !== "Success") throw new Error("expected success");
      expect(out.value.map((i) => i.id)).toEqual(["I_1", "I_2", "I_3"]);
    });

    it("skips nodes whose projectItems do not match meta.projectId", async () => {
      const fetchFn = makeFetch([
        { json: { data: { user: { projectV2: projectV2OK } } } },
        { json: { data: { viewer: { login: "babie" } } } },
        {
          json: {
            data: {
              nodes: [
                issueByIdNode("I_1", 1, "Todo"),
                issueByIdNode("I_2", 2, "Todo", { projectId: "PVT_OTHER" }),
                null,
                { __typename: "PullRequest" },
              ],
            },
          },
        },
      ]);
      const r = await createGithubTracker(baseConfig, { logger: silentLogger, fetch: fetchFn });
      if (r.type !== "Success") throw new Error("expected success");
      const out = await r.value.fetchIssueStatesByIds([
        v.parse(IssueId.schema, "I_1"),
        v.parse(IssueId.schema, "I_2"),
      ]);
      if (out.type !== "Success") throw new Error("expected success");
      expect(out.value.map((i) => i.id)).toEqual(["I_1"]);
    });

    it("[]: returns [] without network", async () => {
      const fetchFn = makeFetch([
        { json: { data: { user: { projectV2: projectV2OK } } } },
        { json: { data: { viewer: { login: "babie" } } } },
      ]);
      const r = await createGithubTracker(baseConfig, { logger: silentLogger, fetch: fetchFn });
      if (r.type !== "Success") throw new Error("expected success");
      const out = await r.value.fetchIssueStatesByIds([]);
      if (out.type !== "Success") throw new Error("expected success");
      expect(out.value).toEqual([]);
      expect((fetchFn as any).mock.calls.length).toBe(2); // only warmup
    });
  });

  describe("tracker/github/adapter — createComment", () => {
    it("returns Success on data.addComment", async () => {
      const fetchFn = makeFetch([
        { json: { data: { user: { projectV2: projectV2OK } } } },
        { json: { data: { viewer: { login: "babie" } } } },
        { json: { data: { addComment: { clientMutationId: null } } } },
      ]);
      const r = await createGithubTracker(baseConfig, { logger: silentLogger, fetch: fetchFn });
      if (r.type !== "Success") throw new Error("expected success");
      const c = await r.value.createComment(v.parse(IssueId.schema, "I_1"), "hello");
      if (c.type !== "Success") throw new Error("expected success");
    });

    it("propagates github-graphql-errors from errors envelope", async () => {
      const fetchFn = makeFetch([
        { json: { data: { user: { projectV2: projectV2OK } } } },
        { json: { data: { viewer: { login: "babie" } } } },
        { json: { errors: [{ message: "subject is locked" }] } },
      ]);
      const r = await createGithubTracker(baseConfig, { logger: silentLogger, fetch: fetchFn });
      if (r.type !== "Success") throw new Error("expected success");
      const c = await r.value.createComment(v.parse(IssueId.schema, "I_1"), "hello");
      if (c.type !== "Failure") throw new Error("expected failure");
      expect(c.error.kind).toBe("github-graphql-errors");
    });
  });

  describe("tracker/github/adapter — updateIssueState retry", () => {
    const issueWithExtra = {
      id: v.parse(IssueId.schema, "I_1"),
      identifier: v.parse(IssueIdentifier.schema, "babie/studio#1"),
      title: "t",
      description: "",
      state: v.parse(IssueStateName.schema, "Todo"),
      priority: null,
      createdAt: null,
      assigneeId: null,
      assignedToWorker: true,
      blockedBy: [],
      extra: { kind: "github", projectId: "PVT_1", projectItemId: "PVTI_1" },
    } as const satisfies Issue;
    const issueNoExtra = {
      id: v.parse(IssueId.schema, "I_2"),
      identifier: v.parse(IssueIdentifier.schema, "babie/studio#2"),
      title: "t",
      description: "",
      state: v.parse(IssueStateName.schema, "Todo"),
      priority: null,
      createdAt: null,
      assigneeId: null,
      assignedToWorker: true,
      blockedBy: [],
    } as const satisfies Issue;

    it("succeeds on first attempt", async () => {
      const fetchFn = makeFetch([
        { json: { data: { user: { projectV2: projectV2OK } } } },
        { json: { data: { viewer: { login: "babie" } } } },
        { json: { data: { updateProjectV2ItemFieldValue: { clientMutationId: null } } } },
      ]);
      const r = await createGithubTracker(baseConfig, { logger: silentLogger, fetch: fetchFn });
      if (r.type !== "Success") throw new Error("expected success");
      const u = await r.value.updateIssueState(
        issueWithExtra,
        v.parse(IssueStateName.schema, "Done"),
      );
      if (u.type !== "Success") throw new Error("expected success");
      expect((fetchFn as any).mock.calls.length).toBe(3); // 2 warmup + 1 mutation
    });

    it("falls back to ok(undefined) + warn after 3 consecutive failures", async () => {
      const fetchFn = makeFetch([
        { json: { data: { user: { projectV2: projectV2OK } } } },
        { json: { data: { viewer: { login: "babie" } } } },
        { status: 500, json: { message: "server error" } },
        { status: 500, json: { message: "server error" } },
        { status: 500, json: { message: "server error" } },
      ]);
      const warnings: string[] = [];
      const logger: Logger = { info: () => {}, warn: (m) => warnings.push(m), error: () => {} };
      const r = await createGithubTracker(baseConfig, { logger, fetch: fetchFn });
      if (r.type !== "Success") throw new Error("expected success");

      vi.useFakeTimers();
      const promise = r.value.updateIssueState(
        issueWithExtra,
        v.parse(IssueStateName.schema, "Done"),
      );
      await vi.advanceTimersByTimeAsync(250);
      await vi.advanceTimersByTimeAsync(1000);
      vi.useRealTimers();
      const u = await promise;
      if (u.type !== "Success") throw new Error("expected best-effort success");
      expect((fetchFn as any).mock.calls.length).toBe(5); // 2 warmup + 3 mutation attempts
      expect(warnings.some((w) => w.includes("failed after 3 attempts"))).toBe(true);
    });

    it("returns github-no-project-item when issue.extra is missing (no retries)", async () => {
      const fetchFn = makeFetch([
        { json: { data: { user: { projectV2: projectV2OK } } } },
        { json: { data: { viewer: { login: "babie" } } } },
      ]);
      const r = await createGithubTracker(baseConfig, { logger: silentLogger, fetch: fetchFn });
      if (r.type !== "Success") throw new Error("expected success");
      const u = await r.value.updateIssueState(
        issueNoExtra,
        v.parse(IssueStateName.schema, "Done"),
      );
      if (u.type !== "Failure") throw new Error("expected failure");
      expect(u.error.kind).toBe("github-no-project-item");
      expect((fetchFn as any).mock.calls.length).toBe(2); // warmup only, no mutation attempted
    });

    it("returns github-status-option-not-found when state name is unknown (no retries)", async () => {
      const fetchFn = makeFetch([
        { json: { data: { user: { projectV2: projectV2OK } } } },
        { json: { data: { viewer: { login: "babie" } } } },
      ]);
      const r = await createGithubTracker(baseConfig, { logger: silentLogger, fetch: fetchFn });
      if (r.type !== "Success") throw new Error("expected success");
      const u = await r.value.updateIssueState(
        issueWithExtra,
        v.parse(IssueStateName.schema, "Wonky"),
      );
      if (u.type !== "Failure") throw new Error("expected failure");
      expect(u.error.kind).toBe("github-status-option-not-found");
      expect((fetchFn as any).mock.calls.length).toBe(2);
    });
  });
}
