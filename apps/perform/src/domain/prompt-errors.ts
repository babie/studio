// apps/perform/src/domain/prompt-errors.ts
export type PromptError =
  | Readonly<{ kind: "template-parse-failed"; cause: string }>
  | Readonly<{ kind: "render-failed"; cause: string; missingVariables?: ReadonlyArray<string> }>;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("domain/prompt-errors", () => {
    it("discriminates render-failed with missingVariables", () => {
      const e: PromptError = { kind: "render-failed", cause: "x", missingVariables: ["a"] };
      expect(e.kind).toBe("render-failed");
    });
  });
}
