import * as v from "valibot";
import type { IssueExtra } from "./issue-extra.js";

const IssueIdSchema = v.pipe(v.string(), v.minLength(1), v.brand("IssueId"));
export type IssueId = v.InferOutput<typeof IssueIdSchema>;
export const IssueId: Readonly<{
  schema: typeof IssueIdSchema;
}> = {
  schema: IssueIdSchema,
} as const;

const IssueIdentifierSchema = v.pipe(v.string(), v.minLength(1), v.brand("IssueIdentifier"));
export type IssueIdentifier = v.InferOutput<typeof IssueIdentifierSchema>;
export const IssueIdentifier: Readonly<{
  schema: typeof IssueIdentifierSchema;
}> = {
  schema: IssueIdentifierSchema,
} as const;

const IssueStateNameSchema = v.pipe(v.string(), v.minLength(1), v.brand("IssueStateName"));
export type IssueStateName = v.InferOutput<typeof IssueStateNameSchema>;
export const IssueStateName: Readonly<{
  schema: typeof IssueStateNameSchema;
}> = {
  schema: IssueStateNameSchema,
} as const;

const PriorityValueSchema = v.union([v.literal(1), v.literal(2), v.literal(3), v.literal(4)]);
export type PriorityValue = v.InferOutput<typeof PriorityValueSchema>;
export const PriorityValue: Readonly<{ schema: typeof PriorityValueSchema }> = {
  schema: PriorityValueSchema,
} as const;

export type BlockedByRef = Readonly<{
  id: IssueId;
  state: IssueStateName;
}>;

export type Issue = Readonly<{
  id: IssueId;
  identifier: IssueIdentifier;
  title: string;
  description: string;
  state: IssueStateName;
  priority: PriorityValue | null;
  createdAt: Date | null;
  assigneeId: string | null;
  assignedToWorker: boolean;
  blockedBy: ReadonlyArray<BlockedByRef>;
  extra?: IssueExtra;
}>;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("domain/issue", () => {
    it("brands a valid string via the schema", () => {
      const id = v.parse(IssueId.schema, "MEMORY-1");
      expect(id).toBe("MEMORY-1");
    });

    it("rejects empty strings via the schema", () => {
      expect(() => v.parse(IssueId.schema, "")).toThrow();
    });

    it("constructs an Issue from branded fields", () => {
      const issue: Issue = {
        id: v.parse(IssueId.schema, "MEMORY-1"),
        identifier: v.parse(IssueIdentifier.schema, "MEMORY-1"),
        title: "Sample",
        description: "desc",
        state: v.parse(IssueStateName.schema, "Todo"),
        priority: null,
        createdAt: null,
        assigneeId: null,
        assignedToWorker: true,
        blockedBy: [],
      };
      expect(issue.title).toBe("Sample");
      expect(issue.state).toBe("Todo");
    });

    it("Issue.extra is optional and undefined when omitted", () => {
      const issue: Issue = {
        id: v.parse(IssueId.schema, "M-1"),
        identifier: v.parse(IssueIdentifier.schema, "M-1"),
        title: "t",
        description: "d",
        state: v.parse(IssueStateName.schema, "Todo"),
        priority: null,
        createdAt: null,
        assigneeId: null,
        assignedToWorker: true,
        blockedBy: [],
      };
      expect(issue.extra).toBeUndefined();
    });

    it("Issue.extra carries github project item metadata when set", () => {
      const issue: Issue = {
        id: v.parse(IssueId.schema, "I_x"),
        identifier: v.parse(IssueIdentifier.schema, "babie/studio#1"),
        title: "t",
        description: "d",
        state: v.parse(IssueStateName.schema, "Todo"),
        priority: null,
        createdAt: null,
        assigneeId: null,
        assignedToWorker: true,
        blockedBy: [],
        extra: { kind: "github", projectId: "PVT_x", projectItemId: "PVTI_y" },
      };
      expect(issue.extra?.kind).toBe("github");
    });

    it("PriorityValue accepts 1-4 only", () => {
      expect(v.parse(PriorityValue.schema, 1)).toBe(1);
      expect(v.parse(PriorityValue.schema, 4)).toBe(4);
      expect(() => v.parse(PriorityValue.schema, 5)).toThrow();
      expect(() => v.parse(PriorityValue.schema, 0)).toThrow();
    });

    it("Issue carries priority/createdAt/assigneeId/assignedToWorker/blockedBy", () => {
      const issue: Issue = {
        id: v.parse(IssueId.schema, "M-1"),
        identifier: v.parse(IssueIdentifier.schema, "M-1"),
        title: "t",
        description: "d",
        state: v.parse(IssueStateName.schema, "Todo"),
        priority: v.parse(PriorityValue.schema, 2),
        createdAt: new Date("2026-05-01T00:00:00Z"),
        assigneeId: "user_42",
        assignedToWorker: true,
        blockedBy: [
          {
            id: v.parse(IssueId.schema, "M-2"),
            state: v.parse(IssueStateName.schema, "In Progress"),
          },
        ],
      };
      expect(issue.priority).toBe(2);
      expect(issue.blockedBy.length).toBe(1);
      expect(issue.assignedToWorker).toBe(true);
    });
  });
}
