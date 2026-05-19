import * as v from "valibot";

// ──────────────────────────────────────────────────────────────────────────
// Query / mutation strings (camelCase variables, matching Linear's GraphQL)
// ──────────────────────────────────────────────────────────────────────────

/** Issue list filtered by project + states only (no assignee filter). Use when
 *  `linear.assignee` is undefined. */
export const LIST_ISSUES_QUERY = `
  query PerformListIssues(
    $projectSlug: String!,
    $stateNames: [String!]!,
    $first: Int!,
    $after: String
  ) {
    issues(
      filter: {
        project: { slugId: { eq: $projectSlug } },
        state: { name: { in: $stateNames } }
      },
      first: $first,
      after: $after
    ) {
      nodes {
        id identifier title description state { name }
        priority
        createdAt
        assignee { id }
        inverseRelations(first: 50) {
          nodes {
            type
            issue { id state { name } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

/** Issue list filtered by project + states + a concrete assignee id. Use when
 *  `linear.assignee` is set (either a literal user id or resolved from "me").
 *  Separate from `LIST_ISSUES_QUERY` because Linear's `{ id: { eq: null } }`
 *  is interpreted as "unassigned", not "no filter". */
export const LIST_ISSUES_BY_ASSIGNEE_QUERY = `
  query PerformListIssuesByAssignee(
    $projectSlug: String!,
    $stateNames: [String!]!,
    $first: Int!,
    $after: String,
    $assigneeId: ID!
  ) {
    issues(
      filter: {
        project: { slugId: { eq: $projectSlug } },
        state: { name: { in: $stateNames } },
        assignee: { id: { eq: $assigneeId } }
      },
      first: $first,
      after: $after
    ) {
      nodes {
        id identifier title description state { name }
        priority
        createdAt
        assignee { id }
        inverseRelations(first: 50) {
          nodes {
            type
            issue { id state { name } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const LIST_ISSUES_BY_IDS_QUERY = `
  query PerformListIssuesByIds($ids: [ID!]!, $first: Int!) {
    issues(filter: { id: { in: $ids } }, first: $first) {
      nodes {
        id identifier title description state { name }
        priority
        createdAt
        assignee { id }
      }
    }
  }
`;

export const VIEWER_QUERY = `
  query PerformViewer { viewer { id } }
`;

export const RESOLVE_STATE_ID_QUERY = `
  query PerformResolveStateId($issueId: String!, $stateName: String!) {
    issue(id: $issueId) {
      team {
        states(filter: { name: { eq: $stateName } }, first: 1) {
          nodes { id }
        }
      }
    }
  }
`;

export const UPDATE_STATE_MUTATION = `
  mutation PerformUpdateIssueState($issueId: String!, $stateId: String!) {
    issueUpdate(id: $issueId, input: { stateId: $stateId }) { success }
  }
`;

export const CREATE_COMMENT_MUTATION = `
  mutation PerformCreateComment($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) { success }
  }
`;

// ──────────────────────────────────────────────────────────────────────────
// Response schemas (valibot)
// ──────────────────────────────────────────────────────────────────────────

const IssueNodeSchema = v.object({
  id: v.string(),
  identifier: v.string(),
  title: v.string(),
  description: v.nullable(v.string()),
  state: v.object({ name: v.string() }),
  priority: v.nullable(v.number()),
  createdAt: v.string(),
  assignee: v.nullable(v.object({ id: v.string() })),
  // inverseRelations is only present in LIST_ISSUES_QUERY / LIST_ISSUES_BY_ASSIGNEE_QUERY.
  // LIST_ISSUES_BY_IDS_QUERY (used for reconcile) omits it for efficiency.
  inverseRelations: v.optional(
    v.object({
      nodes: v.array(
        v.object({
          type: v.string(),
          issue: v.object({
            id: v.string(),
            state: v.object({ name: v.string() }),
          }),
        }),
      ),
    }),
  ),
});
export type LinearIssueNode = v.InferOutput<typeof IssueNodeSchema>;

export const ListIssuesResponseSchema = v.object({
  data: v.object({
    issues: v.object({
      nodes: v.array(IssueNodeSchema),
      pageInfo: v.object({
        hasNextPage: v.boolean(),
        endCursor: v.nullable(v.string()),
      }),
    }),
  }),
});

export const ListIssuesByIdsResponseSchema = v.object({
  data: v.object({
    issues: v.object({
      nodes: v.array(IssueNodeSchema),
    }),
  }),
});

export const ViewerResponseSchema = v.object({
  data: v.object({
    viewer: v.object({ id: v.string() }),
  }),
});

export const ResolveStateIdResponseSchema = v.object({
  data: v.object({
    issue: v.nullable(
      v.object({
        team: v.object({
          states: v.object({
            nodes: v.array(v.object({ id: v.string() })),
          }),
        }),
      }),
    ),
  }),
});

export const UpdateStateResponseSchema = v.object({
  data: v.object({
    issueUpdate: v.object({ success: v.boolean() }),
  }),
});

export const CreateCommentResponseSchema = v.object({
  data: v.object({
    commentCreate: v.object({ success: v.boolean() }),
  }),
});

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("tracker/linear/queries", () => {
    it("ListIssuesResponseSchema accepts a happy-path response", () => {
      const raw = {
        data: {
          issues: {
            nodes: [
              {
                id: "id1",
                identifier: "CYFY-5",
                title: "t",
                description: "d",
                state: { name: "Todo" },
                priority: 2,
                createdAt: "2026-01-01T00:00:00Z",
                assignee: { id: "user_1" },
                inverseRelations: {
                  nodes: [{ type: "blocks", issue: { id: "id2", state: { name: "In Progress" } } }],
                },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      };
      expect(v.safeParse(ListIssuesResponseSchema, raw).success).toBe(true);
    });

    it("ListIssuesResponseSchema accepts description=null and nullable fields", () => {
      const raw = {
        data: {
          issues: {
            nodes: [
              {
                id: "id1",
                identifier: "CYFY-5",
                title: "t",
                description: null,
                state: { name: "Todo" },
                priority: null,
                createdAt: "2026-01-01T00:00:00Z",
                assignee: null,
                inverseRelations: { nodes: [] },
              },
            ],
            pageInfo: { hasNextPage: true, endCursor: "cur" },
          },
        },
      };
      expect(v.safeParse(ListIssuesResponseSchema, raw).success).toBe(true);
    });

    it("ListIssuesByIdsResponseSchema accepts nodes without inverseRelations", () => {
      const raw = {
        data: {
          issues: {
            nodes: [
              {
                id: "id1",
                identifier: "CYFY-5",
                title: "t",
                description: "d",
                state: { name: "Todo" },
                priority: null,
                createdAt: "2026-01-01T00:00:00Z",
                assignee: null,
              },
            ],
          },
        },
      };
      expect(v.safeParse(ListIssuesByIdsResponseSchema, raw).success).toBe(true);
    });

    it("ResolveStateIdResponseSchema accepts an empty states.nodes", () => {
      const raw = { data: { issue: { team: { states: { nodes: [] } } } } };
      expect(v.safeParse(ResolveStateIdResponseSchema, raw).success).toBe(true);
    });

    it("ResolveStateIdResponseSchema accepts issue=null (issue not found)", () => {
      const raw = { data: { issue: null } };
      expect(v.safeParse(ResolveStateIdResponseSchema, raw).success).toBe(true);
    });
  });
}
