/**
 * Opaque wrapper for PII / secrets. Reveals the underlying value only via
 * `.reveal()`; any string coercion (toString, JSON.stringify) emits "*****".
 *
 * Per kamae §4 (boundary-defense.md PII Protection), apply at the schema
 * boundary so the entire downstream pipeline sees the wrapped type.
 */
export type Sensitive<T> = Readonly<{
  readonly __sensitive: true;
  reveal: () => T;
  toString: () => string;
  toJSON: () => string;
}>;

export const Sensitive = {
  of: <T>(value: T): Sensitive<T> => ({
    __sensitive: true,
    reveal: () => value,
    toString: () => "*****",
    toJSON: () => "*****",
  }),
} as const;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("util/sensitive", () => {
    it("reveal() returns the original value", () => {
      const s = Sensitive.of("secret");
      expect(s.reveal()).toBe("secret");
    });
    it("toString returns ***** mask", () => {
      expect(String(Sensitive.of("secret"))).toBe("*****");
    });
    it("JSON.stringify emits ***** mask (no leak through stringify)", () => {
      expect(JSON.stringify({ apiKey: Sensitive.of("ghp_xxx") })).toBe('{"apiKey":"*****"}');
    });
    it("string concatenation triggers toString (also masked)", () => {
      expect(`key=${Sensitive.of("xxx")}`).toBe("key=*****");
    });
  });
}
