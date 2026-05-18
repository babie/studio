// apps/perform/test/integration/tracker-github-flow.test.ts
import { describe, it, expect, vi } from "vitest";
import * as v from "valibot";
import { createGithubTracker } from "../../src/tracker/github/adapter.js";
import type { Logger } from "../../src/orchestrator/orchestrator.js";
import type { GithubTrackerConfig } from "../../src/domain/tracker-config.js";
import { IssueId, IssueIdentifier, IssueStateName, type Issue } from "../../src/domain/issue.js";
import { Sensitive } from "../../src/util/sensitive.js";

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const cfg: GithubTrackerConfig = {
  kind: "github",
  activeStates: ["Todo"],
  terminalStates: ["Done"],
  apiKey: Sensitive.of("ghp_test"),
  projectOwner: "babie",
  projectNumber: 3,
  assignee: "me",
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

const issueContent = (id: string, number: number, login = "babie") => ({
  __typename: "Issue",
  id,
  number,
  title: `t-${number}`,
  body: "b",
  repository: { nameWithOwner: "babie/studio" },
  assignees: { nodes: [{ login }] },
});

const pollPage = (
  nodes: ReadonlyArray<{ id: string; content: any; state: string }>,
  hasNext: boolean,
  endCursor: string | null,
) => ({
  data: {
    node: {
      items: {
        nodes: nodes.map((n) => ({
          id: n.id,
          content: n.content,
          fieldValues: {
            nodes: [
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

const makeFetch = (bodies: ReadonlyArray<{ status?: number; json: unknown }>) => {
  let i = 0;
  return vi.fn(async (_url: any, _init: any) => {
    const next = bodies[i++];
    if (!next) throw new Error(`unexpected extra fetch (idx=${i - 1})`);
    return new Response(JSON.stringify(next.json), { status: next.status ?? 200 });
  }) as unknown as typeof globalThis.fetch;
};

describe("integration: GitHub tracker flow", () => {
  it("happy path (user scope): warmup + fetchCandidateIssues + updateIssueState", async () => {
    const fetchFn = makeFetch([
      { json: { data: { user: { projectV2: projectV2OK } } } },
      { json: { data: { viewer: { login: "babie" } } } },
      { json: pollPage([{ id: "PVTI_1", content: issueContent("I_1", 1), state: "Todo" }], false, null) },
      { json: { data: { updateProjectV2ItemFieldValue: { clientMutationId: null } } } },
    ]);
    const t = await createGithubTracker(cfg, { logger: silentLogger, fetch: fetchFn });
    if (t.type !== "Success") throw new Error("expected tracker success");

    const candidates = await t.value.fetchCandidateIssues();
    if (candidates.type !== "Success") throw new Error("expected candidates success");
    expect(candidates.value.length).toBe(1);
    expect(candidates.value[0]!.identifier).toBe("babie/studio#1");
    expect(candidates.value[0]!.extra?.kind).toBe("github");

    const u = await t.value.updateIssueState(
      candidates.value[0]!,
      v.parse(IssueStateName.schema, "Done"),
    );
    if (u.type !== "Success") throw new Error("expected update success");

    expect((fetchFn as any).mock.calls.length).toBe(4);

    // Verify the mutation variables
    const mutationBody = JSON.parse((fetchFn as any).mock.calls[3][1].body);
    expect(mutationBody.variables.projectId).toBe("PVT_1");
    expect(mutationBody.variables.itemId).toBe("PVTI_1");
    expect(mutationBody.variables.fieldId).toBe("FLD_1");
    expect(mutationBody.variables.optionId).toBe("opt_done");
  });

  it("org fallback: user null → org returns project, then warmup proceeds", async () => {
    const fetchFn = makeFetch([
      { json: { data: { user: null } } },
      { json: { data: { organization: { projectV2: projectV2OK } } } },
      { json: { data: { viewer: { login: "babie" } } } },
      { json: pollPage([{ id: "PVTI_1", content: issueContent("I_1", 1), state: "Todo" }], false, null) },
    ]);
    const t = await createGithubTracker(cfg, { logger: silentLogger, fetch: fetchFn });
    if (t.type !== "Success") throw new Error("expected success");
    const c = await t.value.fetchCandidateIssues();
    if (c.type !== "Success") throw new Error("expected success");
    expect(c.value.length).toBe(1);
  });

  it("best-effort: updateIssueState returns ok after 3 consecutive 500s + warn", async () => {
    const warnings: string[] = [];
    const logger: Logger = { info: () => {}, warn: (m) => warnings.push(m), error: () => {} };
    const fetchFn = makeFetch([
      { json: { data: { user: { projectV2: projectV2OK } } } },
      { json: { data: { viewer: { login: "babie" } } } },
      { status: 500, json: {} },
      { status: 500, json: {} },
      { status: 500, json: {} },
    ]);
    const t = await createGithubTracker(cfg, { logger, fetch: fetchFn });
    if (t.type !== "Success") throw new Error("expected success");

    const issue: Issue = {
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
    };

    vi.useFakeTimers();
    const promise = t.value.updateIssueState(issue, v.parse(IssueStateName.schema, "Done"));
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    const u = await promise;

    if (u.type !== "Success") throw new Error("expected best-effort success");
    expect((fetchFn as any).mock.calls.length).toBe(5);
    expect(warnings.some((w) => w.includes("failed after 3 attempts"))).toBe(true);
  });

  it("updateIssueState without Issue.extra returns github-no-project-item", async () => {
    const fetchFn = makeFetch([
      { json: { data: { user: { projectV2: projectV2OK } } } },
      { json: { data: { viewer: { login: "babie" } } } },
    ]);
    const t = await createGithubTracker(cfg, { logger: silentLogger, fetch: fetchFn });
    if (t.type !== "Success") throw new Error("expected success");

    const issueNoExtra: Issue = {
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
    };

    const u = await t.value.updateIssueState(issueNoExtra, v.parse(IssueStateName.schema, "Done"));
    if (u.type !== "Failure") throw new Error("expected failure");
    expect(u.error.kind).toBe("github-no-project-item");
    expect((fetchFn as any).mock.calls.length).toBe(2); // warmup only
  });
});
