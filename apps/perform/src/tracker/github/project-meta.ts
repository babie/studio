// apps/perform/src/tracker/github/project-meta.ts
import type { Result } from "@praha/byethrow";
import * as v from "valibot";
import type { TrackerError } from "../../domain/tracker-errors.js";
import type { GithubTrackerConfig } from "../../domain/tracker-config.js";
import { githubQuery, type GithubClientDeps } from "./client.js";
import { Sensitive } from "../../util/sensitive.js";
import {
  PROJECT_META_USER_QUERY,
  PROJECT_META_ORG_QUERY,
  VIEWER_QUERY,
  ProjectMetaUserResponseSchema,
  ProjectMetaOrgResponseSchema,
  ViewerResponseSchema,
  isSingleSelectField,
} from "./queries.js";

export type GithubProjectMeta = Readonly<{
  projectId: string;
  statusFieldId: string;
  statusOptions: ReadonlyMap<string, string>;
  viewerLogin: string;
}>;

type ProjectInner = v.InferOutput<typeof ProjectMetaUserResponseSchema>["data"]["user"] extends infer U
  ? U extends null
    ? never
    : U extends { projectV2: infer P }
      ? P extends null
        ? never
        : P
      : never
  : never;

const findStatusField = (
  inner: ProjectInner,
): Result.Result<{ fieldId: string; options: ReadonlyMap<string, string> }, TrackerError> => {
  for (const node of inner.fields.nodes) {
    if (!isSingleSelectField(node)) continue;
    if (node.name !== "Status") continue;
    const options = new Map(node.options.map((o) => [o.name, o.id]));
    return { type: "Success", value: { fieldId: node.id, options } };
  }
  return { type: "Failure", error: { kind: "github-status-field-not-found", fieldName: "Status" } };
};

const validateOptions = (
  options: ReadonlyMap<string, string>,
  required: ReadonlyArray<string>,
): Result.Result<void, TrackerError> => {
  for (const name of required) {
    if (!options.has(name)) {
      return {
        type: "Failure",
        error: {
          kind: "github-status-option-not-found",
          optionName: name,
          available: [...options.keys()],
        },
      };
    }
  }
  return { type: "Success", value: undefined };
};

export const warmupGithubProjectMeta = async (
  clientDeps: GithubClientDeps,
  config: GithubTrackerConfig,
): Promise<Result.Result<GithubProjectMeta, TrackerError>> => {
  // 1. Try user scope first
  const userR = await githubQuery(
    clientDeps,
    PROJECT_META_USER_QUERY,
    { owner: config.projectOwner, number: config.projectNumber },
    ProjectMetaUserResponseSchema,
  );
  if (userR.type === "Failure") return userR;

  let inner: ProjectInner | null = null;
  const userPayload = userR.value.data.user;
  if (userPayload !== null && userPayload.projectV2 !== null) {
    inner = userPayload.projectV2 as ProjectInner;
  } else {
    // 2. Fall back to org scope
    const orgR = await githubQuery(
      clientDeps,
      PROJECT_META_ORG_QUERY,
      { owner: config.projectOwner, number: config.projectNumber },
      ProjectMetaOrgResponseSchema,
    );
    if (orgR.type === "Failure") return orgR;
    const orgPayload = orgR.value.data.organization;
    if (orgPayload !== null && orgPayload.projectV2 !== null) {
      inner = orgPayload.projectV2 as ProjectInner;
    }
  }

  if (inner === null) {
    return {
      type: "Failure",
      error: {
        kind: "github-project-not-found",
        owner: config.projectOwner,
        number: config.projectNumber,
      },
    };
  }

  // 3. Find Status SingleSelect field + option name→id map
  const statusR = findStatusField(inner);
  if (statusR.type === "Failure") return statusR;
  const { fieldId, options } = statusR.value;

  // 4. Validate that configured state names exist as options
  const requiredAll: string[] = [...config.activeStates, ...config.terminalStates];
  if (config.doingState !== undefined) requiredAll.push(config.doingState);
  if (config.doneState !== undefined) requiredAll.push(config.doneState);
  const validateR = validateOptions(options, requiredAll);
  if (validateR.type === "Failure") return validateR;

  // 5. Fetch viewer.login (used for assignee="me" + future branch_name)
  const viewerR = await githubQuery(clientDeps, VIEWER_QUERY, {}, ViewerResponseSchema);
  if (viewerR.type === "Failure") return viewerR;

  return {
    type: "Success",
    value: {
      projectId: inner.id,
      statusFieldId: fieldId,
      statusOptions: options,
      viewerLogin: viewerR.value.data.viewer.login,
    },
  };
};

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  const baseConfig: GithubTrackerConfig = {
    kind: "github",
    activeStates: ["Todo"],
    terminalStates: ["Done"],
    apiKey: Sensitive.of("ghp_t"),
    projectOwner: "babie",
    projectNumber: 3,
  };

  const baseDeps = (fetchImpl: typeof globalThis.fetch): GithubClientDeps => ({
    endpoint: "https://api.github.com/graphql",
    apiKey: Sensitive.of("ghp_t"),
    fetch: fetchImpl,
  });

  const makeFetch = (bodies: ReadonlyArray<{ status?: number; json: unknown }>) => {
    let i = 0;
    return vi.fn(async () => {
      const next = bodies[i++];
      if (!next) throw new Error(`unexpected extra fetch (idx=${i - 1})`);
      return new Response(JSON.stringify(next.json), { status: next.status ?? 200 });
    }) as unknown as typeof globalThis.fetch;
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
            { id: "opt_in", name: "In Progress" },
            { id: "opt_done", name: "Done" },
          ],
        },
      ],
    },
  };

  describe("tracker/github/project-meta", () => {
    it("succeeds via user scope and fetches viewer", async () => {
      const fetchFn = makeFetch([
        { json: { data: { user: { projectV2: projectV2OK } } } },
        { json: { data: { viewer: { login: "babie" } } } },
      ]);
      const r = await warmupGithubProjectMeta(baseDeps(fetchFn), baseConfig);
      if (r.type !== "Success") throw new Error("expected success");
      expect(r.value.projectId).toBe("PVT_1");
      expect(r.value.statusFieldId).toBe("FLD_1");
      expect(r.value.viewerLogin).toBe("babie");
      expect((fetchFn as any).mock.calls.length).toBe(2); // user + viewer (no org call)
    });

    it("falls back to org scope when user.projectV2 is null", async () => {
      const fetchFn = makeFetch([
        { json: { data: { user: { projectV2: null } } } },
        { json: { data: { organization: { projectV2: projectV2OK } } } },
        { json: { data: { viewer: { login: "babie" } } } },
      ]);
      const r = await warmupGithubProjectMeta(baseDeps(fetchFn), baseConfig);
      if (r.type !== "Success") throw new Error("expected success");
      expect((fetchFn as any).mock.calls.length).toBe(3); // user → org → viewer
    });

    it("falls back to org scope when user is null", async () => {
      const fetchFn = makeFetch([
        { json: { data: { user: null } } },
        { json: { data: { organization: { projectV2: projectV2OK } } } },
        { json: { data: { viewer: { login: "babie" } } } },
      ]);
      const r = await warmupGithubProjectMeta(baseDeps(fetchFn), baseConfig);
      if (r.type !== "Success") throw new Error("expected success");
    });

    it("returns github-project-not-found when both scopes are null", async () => {
      const fetchFn = makeFetch([
        { json: { data: { user: null } } },
        { json: { data: { organization: null } } },
      ]);
      const r = await warmupGithubProjectMeta(baseDeps(fetchFn), baseConfig);
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("github-project-not-found");
    });

    it("returns github-status-field-not-found when Status SingleSelect missing", async () => {
      const fetchFn = makeFetch([
        {
          json: {
            data: {
              user: {
                projectV2: {
                  id: "PVT_1",
                  title: "p",
                  fields: { nodes: [{ __typename: "ProjectV2Field" }] },
                },
              },
            },
          },
        },
      ]);
      const r = await warmupGithubProjectMeta(baseDeps(fetchFn), baseConfig);
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("github-status-field-not-found");
    });

    it("returns github-status-option-not-found when configured state missing", async () => {
      const fetchFn = makeFetch([
        {
          json: {
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
                        options: [{ id: "opt_todo", name: "Todo" }],
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      ]);
      const r = await warmupGithubProjectMeta(baseDeps(fetchFn), baseConfig);
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("github-status-option-not-found");
      if (r.error.kind === "github-status-option-not-found") {
        expect(r.error.optionName).toBe("Done");
        expect(r.error.available).toEqual(["Todo"]);
      }
    });

    it("also validates doing_state/done_state when configured", async () => {
      const cfg: GithubTrackerConfig = {
        ...baseConfig,
        doingState: "Wonky",
      };
      const fetchFn = makeFetch([
        { json: { data: { user: { projectV2: projectV2OK } } } },
      ]);
      const r = await warmupGithubProjectMeta(baseDeps(fetchFn), cfg);
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("github-status-option-not-found");
      if (r.error.kind === "github-status-option-not-found") {
        expect(r.error.optionName).toBe("Wonky");
      }
    });

    it("propagates github-http when viewer query fails", async () => {
      const fetchFn = makeFetch([
        { json: { data: { user: { projectV2: projectV2OK } } } },
        { status: 401, json: { message: "Bad credentials" } },
      ]);
      const r = await warmupGithubProjectMeta(baseDeps(fetchFn), baseConfig);
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("github-http");
    });
  });
}
