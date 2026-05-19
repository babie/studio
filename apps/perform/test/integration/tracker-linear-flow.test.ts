import { describe, it, expect, vi } from "vitest";
import * as v from "valibot";
import { createLinearTracker } from "../../src/tracker/linear/adapter.js";
import type { Logger } from "../../src/orchestrator/orchestrator.js";
import type { LinearTrackerConfig } from "../../src/domain/tracker-config.js";
import { IssueId, IssueIdentifier, IssueStateName, type Issue } from "../../src/domain/issue.js";
import { Sensitive } from "../../src/util/sensitive.js";

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const cfg: LinearTrackerConfig = {
  kind: "linear",
  activeStates: ["Todo"],
  terminalStates: ["Done"],
  apiKey: Sensitive.of("lin_test"),
  projectSlug: "studio-xxx",
  assignee: "me",
};

const nodeOf = (id: string, identifier: string, state: string) => ({
  id,
  identifier,
  title: "t",
  description: "d",
  state: { name: state },
  priority: null,
  createdAt: "2026-01-01T00:00:00Z",
  assignee: null,
});

const issueAt = (id: string, identifier: string, state: string): Issue => ({
  id: v.parse(IssueId.schema, id),
  identifier: v.parse(IssueIdentifier.schema, identifier),
  title: "t",
  description: "d",
  state: v.parse(IssueStateName.schema, state),
  priority: null,
  createdAt: null,
  assigneeId: null,
  assignedToWorker: true,
  blockedBy: [],
});

const makeFetch = (bodies: ReadonlyArray<{ status?: number; json: unknown }>) => {
  let i = 0;
  return vi.fn(async (_url: any, _init: any) => {
    const next = bodies[i++];
    if (!next) throw new Error(`unexpected extra fetch (idx=${i - 1})`);
    return new Response(JSON.stringify(next.json), { status: next.status ?? 200 });
  }) as unknown as typeof globalThis.fetch;
};

describe("integration: Linear tracker flow", () => {
  it("happy path: viewer + fetchCandidateIssues + updateIssueState", async () => {
    const fetchFn = makeFetch([
      { json: { data: { viewer: { id: "user_me" } } } },
      {
        json: {
          data: {
            issues: {
              nodes: [nodeOf("a", "CYFY-1", "Todo")],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
      { json: { data: { issue: { team: { states: { nodes: [{ id: "state_done" }] } } } } } },
      { json: { data: { issueUpdate: { success: true } } } },
    ]);

    const t = await createLinearTracker(cfg, { logger: silentLogger, fetch: fetchFn });
    if (t.type !== "Success") throw new Error("expected tracker success");

    const candidates = await t.value.fetchCandidateIssues();
    if (candidates.type !== "Success") throw new Error("expected candidates success");
    expect(candidates.value.length).toBe(1);

    const u = await t.value.updateIssueState(
      candidates.value[0]!,
      v.parse(IssueStateName.schema, "Done"),
    );
    if (u.type !== "Success") throw new Error("expected update success");

    expect((fetchFn as any).mock.calls.length).toBe(4);

    // Verify the viewer's id was sent as the issues filter assigneeId
    const issueListBody = JSON.parse((fetchFn as any).mock.calls[1][1].body);
    expect(issueListBody.variables.assigneeId).toBe("user_me");
  });

  it("best-effort: updateIssueState returns ok after 3 consecutive 500s + warn log", async () => {
    const warnings: string[] = [];
    const logger: Logger = { info: () => {}, warn: (m) => warnings.push(m), error: () => {} };
    const fetchFn = makeFetch([
      { json: { data: { viewer: { id: "user_me" } } } },
      { json: { data: { issue: { team: { states: { nodes: [{ id: "state_done" }] } } } } } },
      { status: 500, json: {} },
      { status: 500, json: {} },
      { status: 500, json: {} },
    ]);

    const t = await createLinearTracker(cfg, { logger, fetch: fetchFn });
    if (t.type !== "Success") throw new Error("expected tracker success");

    vi.useFakeTimers();
    const promise = t.value.updateIssueState(
      issueAt("id1", "CYFY-5", "Todo"),
      v.parse(IssueStateName.schema, "Done"),
    );
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    const u = await promise;

    if (u.type !== "Success") throw new Error("expected best-effort success");
    expect((fetchFn as any).mock.calls.length).toBe(5);
    expect(warnings.some((w) => w.includes("failed after 3 attempts"))).toBe(true);
  });
});
