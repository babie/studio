import type { Result } from "@praha/byethrow";
import type { ConfigError } from "../domain/config-errors.js";

export type LoadedWorkflow = Readonly<{
  frontmatter: string;
  body: string;
}>;

const FRONT_DELIM = "---";

export const splitFrontmatter = (
  path: string,
  raw: string,
): Result.Result<LoadedWorkflow, ConfigError> => {
  const lines = raw.split("\n");
  if (lines[0] !== FRONT_DELIM) {
    return { type: "Failure", error: { kind: "frontmatter-missing", path } };
  }
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === FRONT_DELIM) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    return { type: "Failure", error: { kind: "frontmatter-missing", path } };
  }
  const frontmatter = lines.slice(1, closeIdx).join("\n") + "\n";
  const body = lines.slice(closeIdx + 1).join("\n");
  return { type: "Success", value: { frontmatter, body } };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("config/loader", () => {
    it("splits frontmatter from body", () => {
      const result = splitFrontmatter("path.md", "---\nfoo: 1\n---\nbody\n");
      if (result.type !== "Success") throw new Error("unexpected failure");
      expect(result.value.frontmatter).toBe("foo: 1\n");
      expect(result.value.body).toBe("body\n");
    });

    it("reports frontmatter-missing when no leading delimiter", () => {
      const result = splitFrontmatter("path.md", "no fm here\n");
      if (result.type !== "Failure") throw new Error("expected failure");
      expect(result.error.kind).toBe("frontmatter-missing");
    });

    it("reports frontmatter-missing when no closing delimiter", () => {
      const result = splitFrontmatter("path.md", "---\nfoo: 1\nbody\n");
      if (result.type !== "Failure") throw new Error("expected failure");
      expect(result.error.kind).toBe("frontmatter-missing");
    });
  });
}
