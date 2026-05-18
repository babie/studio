import { load as yamlLoad, YAMLException } from "js-yaml";
import type { Result } from "@praha/byethrow";
import type { ConfigError } from "../domain/config-errors.js";
import type { WorkflowConfig } from "../domain/workflow-config.js";
import { splitFrontmatter } from "./loader.js";
import { parseWorkflowYaml } from "./schema.js";

export const parseWorkflow = (
  path: string,
  raw: string,
): Result.Result<WorkflowConfig, ConfigError> => {
  const split = splitFrontmatter(path, raw);
  if (split.type === "Failure") return split;

  let yamlObject: unknown;
  try {
    yamlObject = yamlLoad(split.value.frontmatter);
  } catch (err) {
    const cause = err instanceof YAMLException ? err.message : String(err);
    return { type: "Failure", error: { kind: "yaml-parse-failed", path, cause } };
  }

  const parsed = parseWorkflowYaml(yamlObject);
  if (parsed.type === "Failure") {
    if (parsed.error.kind === "schema-violation") {
      return {
        type: "Failure",
        error: { kind: "schema-violation", path, issues: parsed.error.issues },
      };
    }
    if (parsed.error.kind === "logging-path-not-absolute") {
      return {
        type: "Failure",
        error: { kind: "logging-path-not-absolute", path: parsed.error.path },
      };
    }
    return {
      type: "Failure",
      error: { kind: "invariant-violation", path, cause: parsed.error.cause },
    };
  }

  return {
    type: "Success",
    value: { ...parsed.value, prompt: split.value.body },
  };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("config/parser", () => {
    it("parses a complete mock-memory WORKFLOW.md", () => {
      const raw = `---
agent:
  type: mock
  max_concurrent_agents: 1
  max_turns: 1
mock:
  delay_ms: 0
tracker:
  kind: memory
  active_states: [Todo]
  terminal_states: [Done]
  doing_state: In Progress
  done_state: Done
memory:
  issues:
    - id: M-1
      identifier: M-1
      title: Sample
      description: ""
      state: Todo
---
Prompt body here.
`;
      const result = parseWorkflow("inline.md", raw);
      if (result.type !== "Success") throw new Error("unexpected failure");
      expect(result.value.agent.backend.type).toBe("mock");
      expect(result.value.prompt.trim()).toBe("Prompt body here.");
      expect(result.value.tracker.kind).toBe("memory");
    });

    it("reports yaml-parse-failed on invalid YAML", () => {
      const raw = "---\nfoo: : :\n---\nbody";
      const result = parseWorkflow("inline.md", raw);
      if (result.type !== "Failure") throw new Error("expected failure");
      expect(result.error.kind).toBe("yaml-parse-failed");
    });

    it("reports schema-violation on missing required fields", () => {
      const raw = "---\nagent: { type: mock }\ntracker: { kind: memory }\n---\n";
      const result = parseWorkflow("inline.md", raw);
      if (result.type !== "Failure") throw new Error("expected failure");
      expect(result.error.kind).toBe("schema-violation");
    });

    it("reports invariant-violation when agent.type=claude lacks claude block", () => {
      const raw = `---
agent:
  type: claude
  max_concurrent_agents: 1
  max_turns: 1
tracker:
  kind: memory
  active_states: []
  terminal_states: []
---
`;
      const result = parseWorkflow("inline.md", raw);
      if (result.type !== "Failure") throw new Error("expected failure");
      expect(result.error.kind).toBe("invariant-violation");
    });
  });
}
