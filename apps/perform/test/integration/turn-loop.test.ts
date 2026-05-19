import { describe, it, expect } from "vitest";
import * as v from "valibot";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../../src/orchestrator/agent-runner.js";
import { IssueId, IssueIdentifier, IssueStateName, type Issue } from "../../src/domain/issue.js";
import type { Backend, BackendSession } from "../../src/backend/types.js";

const silent = { info: () => {}, warn: () => {}, error: () => {} };

const makeIssue = (state: string): Issue => ({
  id: v.parse(IssueId.schema, "M-1"),
  identifier: v.parse(IssueIdentifier.schema, "M-1"),
  title: "Test",
  description: "",
  state: v.parse(IssueStateName.schema, state),
});

const makeFakeBackend = (turnPrompts: string[]): Backend => {
  return {
    type: "mock",
    startSession: async (): Promise<{ type: "Success"; value: BackendSession }> => {
      const session: BackendSession = {
        runTurn: async (params) => {
          turnPrompts.push(params.prompt);
          return { type: "Success", value: { completed: true } };
        },
        shutdown: async () => {},
        interrupt: async () => {},
        exitPromise: Promise.resolve({ code: 0, signal: null }),
      };
      return { type: "Success", value: session };
    },
  };
};

describe("integration: agent-runner turn loop", () => {
  it("turn 1 uses buildPrompt(template), turns 2+ use continuation prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "perform-int-"));
    const turnPrompts: string[] = [];
    // Tracker always returns the same (still active) issue → loop runs 3 times.
    const issue = makeIssue("Todo");
    const tracker = {
      fetchCandidateIssues: async () => ({ type: "Success" as const, value: [issue] }),
      fetchIssuesByStates: async () => ({ type: "Success" as const, value: [] }),
      fetchIssueStatesByIds: async () => ({ type: "Success" as const, value: [issue] }),
      createComment: async () => ({ type: "Success" as const, value: undefined }),
      updateIssueState: async () => ({ type: "Success" as const, value: undefined }),
    } as any;

    const r = await runAgent({
      issue,
      backend: makeFakeBackend(turnPrompts),
      tracker,
      agentConfig: {
        backend: { type: "mock" },
        maxConcurrentAgents: 1,
        maxTurns: 3,
        maxRetryBackoffMs: 300_000,
        agentSessionStallTimeoutMs: 1_800_000,
        maxConcurrentAgentsByState: {},
      },
      workspaceConfig: { root },
      terminalStates: [v.parse(IssueStateName.schema, "Done")],
      promptTemplate: "Initial: {{ issue.identifier }}",
      logger: silent,
      signal: new AbortController().signal,
    });
    if (r.type !== "Success") throw new Error("expected success");
    expect(r.value.turnsExecuted).toBe(3);
    expect(turnPrompts[0]).toBe("Initial: M-1");
    // continuation prompt format is implementation-defined; assert it contains turn marker
    expect(turnPrompts[1]).toMatch(/turn #2 of 3/);
    expect(turnPrompts[2]).toMatch(/turn #3 of 3/);
  });

  it("aborts mid-loop when signal fires; outcome reports backend turn-not-completed", async () => {
    const root = await mkdtemp(join(tmpdir(), "perform-int-"));
    const issue = makeIssue("Todo");
    const tracker = {
      fetchCandidateIssues: async () => ({ type: "Success" as const, value: [issue] }),
      fetchIssuesByStates: async () => ({ type: "Success" as const, value: [] }),
      fetchIssueStatesByIds: async () => ({ type: "Success" as const, value: [issue] }),
      createComment: async () => ({ type: "Success" as const, value: undefined }),
      updateIssueState: async () => ({ type: "Success" as const, value: undefined }),
    } as any;

    const ctrl = new AbortController();
    const backend: Backend = {
      type: "mock",
      startSession: async () => ({
        type: "Success",
        value: {
          runTurn: async ({ signal }) => {
            // Wait briefly for abort.
            await new Promise<void>((res) => {
              if (signal.aborted) return res();
              signal.addEventListener("abort", () => res(), { once: true });
              setTimeout(res, 200);
            });
            if (signal.aborted) {
              return {
                type: "Failure",
                error: { kind: "turn-not-completed", threadId: "thr_1", reason: "abort" },
              };
            }
            return { type: "Success", value: { completed: true } };
          },
          shutdown: async () => {},
          interrupt: async () => {},
          // Use a never-resolving exitPromise so the outer Promise.race in agent-runner
          // does not preempt the runTurn (which handles abort internally via signal).
          exitPromise: new Promise(() => {}),
        },
      }),
    };

    setTimeout(() => ctrl.abort(), 30);
    const r = await runAgent({
      issue,
      backend,
      tracker,
      agentConfig: {
        backend: { type: "mock" },
        maxConcurrentAgents: 1,
        maxTurns: 5,
        maxRetryBackoffMs: 300_000,
        agentSessionStallTimeoutMs: 1_800_000,
        maxConcurrentAgentsByState: {},
      },
      workspaceConfig: { root },
      terminalStates: [v.parse(IssueStateName.schema, "Done")],
      promptTemplate: "t",
      logger: silent,
      signal: ctrl.signal,
    });
    if (r.type !== "Failure") throw new Error("expected failure on abort");
    expect(r.error.kind).toBe("backend");
    if (r.error.kind === "backend") {
      expect(r.error.error.kind).toBe("turn-not-completed");
    }
  }, 5_000);
});
