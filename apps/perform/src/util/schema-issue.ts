/** Minimal structural type that covers both StandardSchemaV1.Issue and valibot's
 *  BaseIssue.  Both have `message: string` and optional `path` whose items have
 *  a `key` (PropertyKey in Standard Schema, unknown in valibot).  We accept the
 *  wider shape here so callers don't need a cast. */
type IssueWithPath = {
  readonly message: string;
  readonly path?: ReadonlyArray<unknown> | undefined;
};

/** Standard Schema's PathItem can be a raw PropertyKey or an object `{ key }`.
 *  Valibot adds extra fields (type, origin, input, value) but key is always present.
 *  Normalise both forms to a string segment for log/error messages. */
const segmentToString = (segment: unknown): string => {
  if (typeof segment === "string" || typeof segment === "number" || typeof segment === "symbol") {
    return String(segment);
  }
  if (typeof segment === "object" && segment !== null && "key" in segment) {
    return String((segment as { key: unknown }).key);
  }
  return "<unknown>";
};

/** Format the `.path` of a schema issue as a dotted string, or `<root>` if
 *  path is absent or empty.  Accepts both StandardSchemaV1.Issue and valibot
 *  BaseIssue without a cast at the call site. */
export const formatIssuePath = (issue: IssueWithPath): string =>
  issue.path && issue.path.length > 0 ? issue.path.map(segmentToString).join(".") : "<root>";

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("util/schema-issue", () => {
    it("formats path with string segments", () => {
      expect(formatIssuePath({ message: "x", path: ["a", "b"] })).toBe("a.b");
    });
    it("formats path with object key segments", () => {
      expect(formatIssuePath({ message: "x", path: [{ key: "a" }, { key: "b" }] })).toBe("a.b");
    });
    it("returns <root> for empty/missing path", () => {
      expect(formatIssuePath({ message: "x" })).toBe("<root>");
      expect(formatIssuePath({ message: "x", path: [] })).toBe("<root>");
    });
  });
}
