import { Liquid } from "liquidjs";
import type { Result } from "@praha/byethrow";
import type { Issue } from "../domain/issue.js";
import type { PromptError } from "../domain/prompt-errors.js";

const engine = new Liquid({ strictVariables: true, strictFilters: true });

export type BuildPromptContext = Readonly<{
  issue: Issue;
  attempt?: number;
}>;

export const buildPrompt = async (
  template: string,
  context: BuildPromptContext,
): Promise<Result.Result<string, PromptError>> => {
  let tpl;
  try {
    tpl = engine.parse(template);
  } catch (err) {
    return {
      type: "Failure",
      error: { kind: "template-parse-failed", cause: err instanceof Error ? err.message : String(err) },
    };
  }
  try {
    const issueAsRecord: Record<string, unknown> = {
      id: context.issue.id,
      identifier: context.issue.identifier,
      title: context.issue.title,
      description: context.issue.description,
      state: context.issue.state,
    };
    const rendered = await engine.render(tpl, {
      issue: issueAsRecord,
      attempt: context.attempt ?? null,
    });
    return { type: "Success", value: String(rendered) };
  } catch (err) {
    return {
      type: "Failure",
      error: { kind: "render-failed", cause: err instanceof Error ? err.message : String(err) },
    };
  }
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  const v = await import("valibot");
  const { IssueId, IssueIdentifier, IssueStateName } = await import("../domain/issue.js");

  const issue = {
    id: v.parse(IssueId.schema, "M-1"),
    identifier: v.parse(IssueIdentifier.schema, "M-1"),
    title: "Hello",
    description: "World",
    state: v.parse(IssueStateName.schema, "Todo"),
    priority: null,
    createdAt: null,
    assigneeId: null,
    assignedToWorker: true,
    blockedBy: [],
  } as const satisfies Issue;

  describe("prompt/builder", () => {
    it("renders {{ issue.* }} placeholders", async () => {
      const r = await buildPrompt(
        "Issue {{ issue.identifier }} ({{ issue.title }}): {{ issue.description }}",
        { issue },
      );
      if (r.type !== "Success") throw new Error("expected success");
      expect(r.value).toBe("Issue M-1 (Hello): World");
    });

    it("fails render on missing variable (strict)", async () => {
      const r = await buildPrompt("{{ issue.assignee.name }}", { issue });
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("render-failed");
    });

    it("fails parse on malformed template", async () => {
      const r = await buildPrompt("{{ unterminated", { issue });
      if (r.type !== "Failure") throw new Error("expected failure");
      // liquidjs may surface this at parse OR render time depending on version.
      expect(["template-parse-failed", "render-failed"]).toContain(r.error.kind);
    });

    it("exposes attempt when provided", async () => {
      const r = await buildPrompt("attempt={{ attempt }}", { issue, attempt: 2 });
      if (r.type !== "Success") throw new Error("expected success");
      expect(r.value).toBe("attempt=2");
    });
  });
}
