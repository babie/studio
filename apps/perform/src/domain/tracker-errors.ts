// apps/perform/src/domain/tracker-errors.ts
export type TrackerError =
  | Readonly<{ kind: "unknown-state"; state: string }>
  | Readonly<{ kind: "issue-not-found"; id: string }>
  | Readonly<{ kind: "linear-http"; status: number; bodyExcerpt: string }>
  | Readonly<{ kind: "linear-graphql-errors"; messages: ReadonlyArray<string> }>
  | Readonly<{ kind: "linear-response-invalid"; issues: ReadonlyArray<string> }>
  | Readonly<{ kind: "linear-network"; cause: string }>
  | Readonly<{ kind: "linear-state-not-found"; stateName: string }>
  | Readonly<{ kind: "linear-config"; cause: string }>
  | Readonly<{ kind: "github-http"; status: number; bodyExcerpt: string }>
  | Readonly<{ kind: "github-graphql-errors"; messages: ReadonlyArray<string> }>
  | Readonly<{ kind: "github-response-invalid"; issues: ReadonlyArray<string> }>
  | Readonly<{ kind: "github-network"; cause: string }>
  | Readonly<{ kind: "github-project-not-found"; owner: string; number: number }>
  | Readonly<{ kind: "github-status-field-not-found"; fieldName: string }>
  | Readonly<{
      kind: "github-status-option-not-found";
      optionName: string;
      available: ReadonlyArray<string>;
    }>
  | Readonly<{ kind: "github-no-project-item"; issueIdentifier: string }>
  | Readonly<{ kind: "github-config"; cause: string }>
  | Readonly<{ kind: "unsupported-tracker-kind"; kind_: string }>
  | Readonly<{ kind: "tracker-timeout"; operation: string; timeoutMs: number }>;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("domain/tracker-errors", () => {
    it("discriminates github variants", () => {
      const e: TrackerError = { kind: "github-http", status: 401, bodyExcerpt: "x" };
      expect(e.kind).toBe("github-http");
    });
    it("discriminates tracker-timeout", () => {
      const e: TrackerError = {
        kind: "tracker-timeout",
        operation: "fetchCandidates",
        timeoutMs: 15000,
      };
      expect(e.kind).toBe("tracker-timeout");
    });
  });
}
