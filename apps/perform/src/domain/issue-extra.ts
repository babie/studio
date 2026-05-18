export type IssueExtra =
  | Readonly<{ kind: "github"; projectId: string; projectItemId: string }>;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("domain/issue-extra", () => {
    it("narrows by kind discriminant", () => {
      const e: IssueExtra = {
        kind: "github",
        projectId: "PVT_x",
        projectItemId: "PVTI_y",
      };
      expect(e.kind).toBe("github");
      if (e.kind === "github") {
        expect(e.projectId).toBe("PVT_x");
        expect(e.projectItemId).toBe("PVTI_y");
      }
    });
  });
}
