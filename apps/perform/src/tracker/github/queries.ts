// apps/perform/src/tracker/github/queries.ts
import * as v from "valibot";

// ──────────────────────────────────────────────────────────────────────────
// GraphQL query / mutation strings (1:1 port of symphony's queries.ex
// in apps/symphony/lib/symphony_elixir/github/, Elixir retired in M3 Phase 7).
// ──────────────────────────────────────────────────────────────────────────

export const PROJECT_META_USER_QUERY = `
  query PerformGithubProjectMetaUser($owner: String!, $number: Int!) {
    user(login: $owner) {
      projectV2(number: $number) {
        id
        title
        fields(first: 50) {
          nodes {
            __typename
            ... on ProjectV2SingleSelectField {
              id
              name
              options { id name }
            }
          }
        }
      }
    }
  }
`;

export const PROJECT_META_ORG_QUERY = `
  query PerformGithubProjectMetaOrg($owner: String!, $number: Int!) {
    organization(login: $owner) {
      projectV2(number: $number) {
        id
        title
        fields(first: 50) {
          nodes {
            __typename
            ... on ProjectV2SingleSelectField {
              id
              name
              options { id name }
            }
          }
        }
      }
    }
  }
`;

export const VIEWER_QUERY = `
  query PerformGithubViewer { viewer { login } }
`;

export const POLL_ITEMS_QUERY = `
  query PerformGithubPollItems($projectId: ID!, $first: Int!, $after: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: $first, after: $after) {
          nodes {
            id
            content {
              __typename
              ... on Issue {
                id
                number
                title
                body
                url
                repository { nameWithOwner }
                assignees(first: 10) { nodes { login } }
                labels(first: 20) { nodes { name } }
                createdAt
                updatedAt
              }
            }
            fieldValues(first: 20) {
              nodes {
                __typename
                ... on ProjectV2ItemFieldSingleSelectValue {
                  field { ... on ProjectV2SingleSelectField { name } }
                  name
                  optionId
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

export const ISSUES_BY_IDS_QUERY = `
  query PerformGithubIssuesById($ids: [ID!]!) {
    nodes(ids: $ids) {
      __typename
      ... on Issue {
        id
        number
        title
        body
        url
        repository { nameWithOwner }
        projectItems(first: 10) {
          nodes {
            id
            project { id }
            fieldValues(first: 20) {
              nodes {
                __typename
                ... on ProjectV2ItemFieldSingleSelectValue {
                  field { ... on ProjectV2SingleSelectField { name } }
                  name
                }
              }
            }
          }
        }
        assignees(first: 10) { nodes { login } }
        labels(first: 20) { nodes { name } }
        createdAt
        updatedAt
      }
    }
  }
`;

export const ADD_COMMENT_MUTATION = `
  mutation PerformGithubAddComment($subjectId: ID!, $body: String!) {
    addComment(input: { subjectId: $subjectId, body: $body }) {
      clientMutationId
    }
  }
`;

export const UPDATE_ITEM_STATUS_MUTATION = `
  mutation PerformGithubUpdateItemStatus(
    $projectId: ID!,
    $itemId: ID!,
    $fieldId: ID!,
    $optionId: String!
  ) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId,
      itemId: $itemId,
      fieldId: $fieldId,
      value: { singleSelectOptionId: $optionId }
    }) {
      clientMutationId
    }
  }
`;

// ──────────────────────────────────────────────────────────────────────────
// Response schemas (valibot)
// ──────────────────────────────────────────────────────────────────────────

export const SingleSelectFieldSchema = v.object({
  __typename: v.literal("ProjectV2SingleSelectField"),
  id: v.string(),
  name: v.string(),
  options: v.array(v.object({ id: v.string(), name: v.string() })),
});

// Catch-all for non-SingleSelect field types (ProjectV2Field, ProjectV2IterationField, etc.)
const OtherProjectFieldSchema = v.object({
  __typename: v.string(),
});

export const ProjectFieldSchema = v.variant("__typename", [
  SingleSelectFieldSchema,
  OtherProjectFieldSchema,
]);

/** Type predicate: narrows `ProjectFieldSchema` output to the SingleSelect arm.
 *  See [[feedback-valibot-variant-narrowing-limit]] for why the explicit predicate
 *  is required (the catch-all arm widens `__typename` to `string`). */
export const isSingleSelectField = (
  node: v.InferOutput<typeof ProjectFieldSchema>,
): node is v.InferOutput<typeof SingleSelectFieldSchema> =>
  node.__typename === "ProjectV2SingleSelectField";

// Re-export the inferred SingleSelect node type for project-meta.ts consumers.
export type SingleSelectFieldNode = v.InferOutput<typeof SingleSelectFieldSchema>;

const ProjectMetaInnerSchema = v.object({
  id: v.string(),
  title: v.string(),
  fields: v.object({ nodes: v.array(ProjectFieldSchema) }),
});

export const ProjectMetaUserResponseSchema = v.object({
  data: v.object({
    user: v.nullable(
      v.object({
        projectV2: v.nullable(ProjectMetaInnerSchema),
      }),
    ),
  }),
});

export const ProjectMetaOrgResponseSchema = v.object({
  data: v.object({
    organization: v.nullable(
      v.object({
        projectV2: v.nullable(ProjectMetaInnerSchema),
      }),
    ),
  }),
});

export const ViewerResponseSchema = v.object({
  data: v.object({
    viewer: v.object({ login: v.string() }),
  }),
});

export const SingleSelectFieldValueSchema = v.object({
  __typename: v.literal("ProjectV2ItemFieldSingleSelectValue"),
  field: v.object({ name: v.string() }),
  name: v.nullable(v.string()),
  optionId: v.optional(v.nullable(v.string())),
});

// Other __typename variants are passed through as a catch-all so PollItems can
// contain any ProjectV2ItemField* shape without breaking validation.
const OtherFieldValueSchema = v.object({
  __typename: v.string(),
});

export const FieldValueSchema = v.variant("__typename", [
  SingleSelectFieldValueSchema,
  OtherFieldValueSchema,
]);

/** Type predicate: narrows a parsed `FieldValueSchema` value to the SingleSelect
 *  arm. Required because the `Other` catch-all arm uses `__typename: v.string()`,
 *  which widens the union and prevents direct discriminated-union narrowing.
 *  See [[feedback-valibot-variant-narrowing-limit]]. */
export const isSingleSelectFieldValue = (
  fv: v.InferOutput<typeof FieldValueSchema>,
): fv is v.InferOutput<typeof SingleSelectFieldValueSchema> =>
  fv.__typename === "ProjectV2ItemFieldSingleSelectValue";

const FieldValuesSchema = v.object({ nodes: v.array(FieldValueSchema) });

const AssigneesSchema = v.object({
  nodes: v.array(v.object({ login: v.string() })),
});

const LabelsSchema = v.object({
  nodes: v.array(v.object({ name: v.string() })),
});

export const IssueContentSchema = v.object({
  __typename: v.literal("Issue"),
  id: v.string(),
  number: v.number(),
  title: v.string(),
  body: v.nullable(v.string()),
  url: v.optional(v.string()),
  repository: v.object({ nameWithOwner: v.string() }),
  assignees: v.optional(AssigneesSchema),
  labels: v.optional(LabelsSchema),
  createdAt: v.optional(v.nullable(v.string())),
  updatedAt: v.optional(v.nullable(v.string())),
});

// Catch-all for non-Issue content (PullRequest, DraftIssue, etc.) so PollItems
// can carry them without breaking validation.
const OtherContentSchema = v.object({
  __typename: v.string(),
});

const ContentSchema = v.nullable(v.variant("__typename", [IssueContentSchema, OtherContentSchema]));

/** Type predicate: narrows a parsed PollItem content value to the Issue arm.
 *  See [[feedback-valibot-variant-narrowing-limit]] for why an explicit
 *  predicate is required (the catch-all arm widens `__typename` to `string`). */
export const isIssueContent = (
  content: v.InferOutput<typeof IssueContentSchema> | v.InferOutput<typeof OtherContentSchema>,
): content is v.InferOutput<typeof IssueContentSchema> => content.__typename === "Issue";

export const PollItemNodeSchema = v.object({
  id: v.string(),
  content: ContentSchema,
  fieldValues: FieldValuesSchema,
});

export type PollItemNode = v.InferOutput<typeof PollItemNodeSchema>;

export const PollItemsResponseSchema = v.object({
  data: v.object({
    node: v.nullable(
      v.object({
        items: v.object({
          nodes: v.array(PollItemNodeSchema),
          pageInfo: v.object({
            hasNextPage: v.boolean(),
            endCursor: v.nullable(v.string()),
          }),
        }),
      }),
    ),
  }),
});

const ProjectItemRefSchema = v.object({
  id: v.string(),
  project: v.object({ id: v.string() }),
  fieldValues: FieldValuesSchema,
});

const IssueByIdNodeSchema = v.object({
  __typename: v.literal("Issue"),
  id: v.string(),
  number: v.number(),
  title: v.string(),
  body: v.nullable(v.string()),
  url: v.optional(v.string()),
  repository: v.object({ nameWithOwner: v.string() }),
  projectItems: v.object({ nodes: v.array(ProjectItemRefSchema) }),
  assignees: v.optional(AssigneesSchema),
  labels: v.optional(LabelsSchema),
  createdAt: v.optional(v.nullable(v.string())),
  updatedAt: v.optional(v.nullable(v.string())),
});

const OtherNodeSchema = v.object({
  __typename: v.string(),
});

export const IssuesByIdsResponseSchema = v.object({
  data: v.object({
    nodes: v.array(v.nullable(v.variant("__typename", [IssueByIdNodeSchema, OtherNodeSchema]))),
  }),
});

export type IssueByIdNode = v.InferOutput<typeof IssueByIdNodeSchema>;

/** Type predicate: narrows an `IssuesByIdsResponseSchema` node to the Issue arm. */
export const isIssueByIdNode = (
  node: v.InferOutput<typeof IssueByIdNodeSchema> | v.InferOutput<typeof OtherNodeSchema>,
): node is IssueByIdNode => node.__typename === "Issue";

export const AddCommentResponseSchema = v.object({
  data: v.object({
    addComment: v.object({
      clientMutationId: v.nullable(v.string()),
    }),
  }),
});

export const UpdateItemStatusResponseSchema = v.object({
  data: v.object({
    updateProjectV2ItemFieldValue: v.object({
      clientMutationId: v.nullable(v.string()),
    }),
  }),
});

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("tracker/github/queries — response schemas", () => {
    it("PollItemsResponseSchema accepts a happy-path response", () => {
      const raw = {
        data: {
          node: {
            items: {
              nodes: [
                {
                  id: "PVTI_1",
                  content: {
                    __typename: "Issue",
                    id: "I_1",
                    number: 1,
                    title: "t",
                    body: "b",
                    repository: { nameWithOwner: "babie/studio" },
                  },
                  fieldValues: {
                    nodes: [
                      {
                        __typename: "ProjectV2ItemFieldSingleSelectValue",
                        field: { name: "Status" },
                        name: "Todo",
                        optionId: "opt_todo",
                      },
                    ],
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      };
      expect(v.safeParse(PollItemsResponseSchema, raw).success).toBe(true);
    });

    it("PollItemsResponseSchema accepts body=null", () => {
      const raw = {
        data: {
          node: {
            items: {
              nodes: [
                {
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
                },
              ],
              pageInfo: { hasNextPage: true, endCursor: "cur" },
            },
          },
        },
      };
      expect(v.safeParse(PollItemsResponseSchema, raw).success).toBe(true);
    });

    it("PollItemsResponseSchema accepts PullRequest / DraftIssue contents", () => {
      const raw = {
        data: {
          node: {
            items: {
              nodes: [
                {
                  id: "PVTI_1",
                  content: { __typename: "PullRequest" },
                  fieldValues: { nodes: [] },
                },
                {
                  id: "PVTI_2",
                  content: { __typename: "DraftIssue" },
                  fieldValues: { nodes: [] },
                },
                {
                  id: "PVTI_3",
                  content: null,
                  fieldValues: { nodes: [] },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      };
      expect(v.safeParse(PollItemsResponseSchema, raw).success).toBe(true);
    });

    it("PollItemsResponseSchema accepts non-SingleSelect field values", () => {
      const raw = {
        data: {
          node: {
            items: {
              nodes: [
                {
                  id: "PVTI_1",
                  content: {
                    __typename: "Issue",
                    id: "I_1",
                    number: 1,
                    title: "t",
                    body: null,
                    repository: { nameWithOwner: "babie/studio" },
                  },
                  fieldValues: {
                    nodes: [
                      { __typename: "ProjectV2ItemFieldTextValue" },
                      { __typename: "ProjectV2ItemFieldNumberValue" },
                      {
                        __typename: "ProjectV2ItemFieldSingleSelectValue",
                        field: { name: "Status" },
                        name: "Todo",
                        optionId: "x",
                      },
                    ],
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      };
      expect(v.safeParse(PollItemsResponseSchema, raw).success).toBe(true);
    });

    it("ProjectMetaUserResponseSchema accepts user=null", () => {
      const raw = { data: { user: null } };
      expect(v.safeParse(ProjectMetaUserResponseSchema, raw).success).toBe(true);
    });

    it("ProjectMetaUserResponseSchema accepts user.projectV2=null", () => {
      const raw = { data: { user: { projectV2: null } } };
      expect(v.safeParse(ProjectMetaUserResponseSchema, raw).success).toBe(true);
    });

    it("ProjectMetaUserResponseSchema accepts a SingleSelect Status field", () => {
      const raw = {
        data: {
          user: {
            projectV2: {
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
                  { __typename: "ProjectV2Field" },
                ],
              },
            },
          },
        },
      };
      expect(v.safeParse(ProjectMetaUserResponseSchema, raw).success).toBe(true);
    });

    it("IssuesByIdsResponseSchema accepts mixed Issue / null / other nodes", () => {
      const raw = {
        data: {
          nodes: [
            {
              __typename: "Issue",
              id: "I_1",
              number: 1,
              title: "t",
              body: null,
              repository: { nameWithOwner: "babie/studio" },
              projectItems: {
                nodes: [
                  {
                    id: "PVTI_1",
                    project: { id: "PVT_1" },
                    fieldValues: { nodes: [] },
                  },
                ],
              },
            },
            null,
            { __typename: "PullRequest" },
          ],
        },
      };
      expect(v.safeParse(IssuesByIdsResponseSchema, raw).success).toBe(true);
    });

    it("FieldValue narrows via __typename when parsed (SingleSelect arm has field/name)", () => {
      const raw = {
        __typename: "ProjectV2ItemFieldSingleSelectValue",
        field: { name: "Status" },
        name: "Todo",
        optionId: "opt_todo",
      };
      const r = v.safeParse(FieldValueSchema, raw);
      if (!r.success) throw new Error("expected success");
      // The OtherFieldValueSchema catch-all arm (`__typename: string`) is a
      // supertype of the literal, so tsc cannot narrow the union via ===.
      // Extract the SingleSelect arm explicitly to prove the shape is accessible.
      type SingleSelect = v.InferOutput<typeof SingleSelectFieldValueSchema>;
      if (r.output.__typename === "ProjectV2ItemFieldSingleSelectValue") {
        const ss = r.output as SingleSelect;
        expect(ss.field.name).toBe("Status");
        expect(ss.name).toBe("Todo");
      }
    });

    it("isSingleSelectFieldValue narrows the SingleSelect arm", () => {
      const ss = {
        __typename: "ProjectV2ItemFieldSingleSelectValue",
        field: { name: "Status" },
        name: "Todo",
      };
      const text = { __typename: "ProjectV2ItemFieldTextValue" };
      const parsedSs = v.safeParse(FieldValueSchema, ss);
      const parsedTx = v.safeParse(FieldValueSchema, text);
      if (!parsedSs.success || !parsedTx.success) throw new Error("expected success");
      expect(isSingleSelectFieldValue(parsedSs.output)).toBe(true);
      expect(isSingleSelectFieldValue(parsedTx.output)).toBe(false);
    });

    it("isSingleSelectField narrows ProjectField via __typename", () => {
      const ss = {
        __typename: "ProjectV2SingleSelectField",
        id: "FLD_1",
        name: "Status",
        options: [],
      };
      const other = { __typename: "ProjectV2Field" };
      const parsedSs = v.safeParse(ProjectFieldSchema, ss);
      const parsedOther = v.safeParse(ProjectFieldSchema, other);
      if (!parsedSs.success || !parsedOther.success) throw new Error("expected success");
      expect(isSingleSelectField(parsedSs.output)).toBe(true);
      expect(isSingleSelectField(parsedOther.output)).toBe(false);
    });

    it("isIssueContent narrows PollItem content via __typename", () => {
      const issue = {
        __typename: "Issue",
        id: "I_1",
        number: 1,
        title: "t",
        body: null,
        repository: { nameWithOwner: "o/r" },
      };
      const pr = { __typename: "PullRequest" };
      const parsedIssue = v.safeParse(IssueContentSchema, issue);
      const parsedPr = v.safeParse(
        v.variant("__typename", [IssueContentSchema, v.object({ __typename: v.string() })]),
        pr,
      );
      if (!parsedIssue.success || !parsedPr.success) throw new Error("expected success");
      expect(isIssueContent(parsedIssue.output)).toBe(true);
      expect(isIssueContent(parsedPr.output)).toBe(false);
    });

    it("isIssueByIdNode narrows IssuesByIds node via __typename", () => {
      const issue = {
        __typename: "Issue",
        id: "I_1",
        number: 1,
        title: "t",
        body: null,
        repository: { nameWithOwner: "o/r" },
        projectItems: { nodes: [] },
      };
      const pr = { __typename: "PullRequest" };
      const parsed = v.safeParse(IssuesByIdsResponseSchema, { data: { nodes: [issue, pr] } });
      if (!parsed.success) throw new Error("expected success");
      const [first, second] = parsed.output.data.nodes;
      if (first === null || second === null) throw new Error("expected non-null");
      expect(isIssueByIdNode(first)).toBe(true);
      expect(isIssueByIdNode(second)).toBe(false);
    });
  });
}
