/**
 * Exhaustiveness check for discriminated unions inside `switch` statements.
 * Calling this from a `default:` branch makes adding a new variant a compile error.
 *
 * @example
 *   switch (err.kind) {
 *     case "a": return ...;
 *     case "b": return ...;
 *     default: return assertNever(err);
 *   }
 */
export const assertNever = (x: never): never => {
  throw new Error(`assertNever: unexpected variant: ${JSON.stringify(x)}`);
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("util/assert-never", () => {
    it("throws with the offending value embedded", () => {
      expect(() => assertNever({ kind: "x" } as never)).toThrow(/unexpected variant.*"x"/);
    });
  });
}
