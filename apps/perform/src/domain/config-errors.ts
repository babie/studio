// apps/perform/src/domain/config-errors.ts
import type { StandardSchemaV1 } from "@standard-schema/spec";

export type ConfigError =
  | Readonly<{ kind: "file-not-found"; path: string }>
  | Readonly<{ kind: "frontmatter-missing"; path: string }>
  | Readonly<{ kind: "yaml-parse-failed"; path: string; cause: string }>
  | Readonly<{
      kind: "schema-violation";
      path: string;
      issues: ReadonlyArray<StandardSchemaV1.Issue>;
    }>
  | Readonly<{ kind: "invariant-violation"; path: string; cause: string }>
  | Readonly<{ kind: "logging-path-not-absolute"; path: string }>;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("domain/config-errors", () => {
    it("discriminates by kind", () => {
      const e: ConfigError = { kind: "file-not-found", path: "/x.md" };
      expect(e.kind).toBe("file-not-found");
    });
  });
}
