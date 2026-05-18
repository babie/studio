import { resolve, sep, isAbsolute } from "node:path";
import type { Result } from "@praha/byethrow";
import type { WorkspaceError } from "../domain/workspace-errors.js";

const UNSAFE_CHARS = /[^a-zA-Z0-9._-]/g;

export const safeIdentifier = (id: string): Result.Result<string, WorkspaceError> => {
  if (id === "" || id === "." || id === "..") {
    return { type: "Failure", error: { kind: "path-unsafe", path: id } };
  }
  if (id.includes("\0")) {
    return { type: "Failure", error: { kind: "path-unsafe", path: id } };
  }
  const safe = id.replace(UNSAFE_CHARS, "_").replace(/\.\./g, "_");
  return { type: "Success", value: safe };
};

export const workspacePathFor = (
  root: string,
  identifier: string,
): Result.Result<string, WorkspaceError> => {
  if (!isAbsolute(root)) {
    return { type: "Failure", error: { kind: "path-unsafe", path: root } };
  }
  const safeR = safeIdentifier(identifier);
  if (safeR.type === "Failure") return safeR;
  const candidate = resolve(root, safeR.value);
  const rootNormalized = resolve(root);
  if (!candidate.startsWith(rootNormalized + sep) && candidate !== rootNormalized) {
    return { type: "Failure", error: { kind: "path-unsafe", path: candidate } };
  }
  return { type: "Success", value: candidate };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("workspace/path", () => {
    it("safeIdentifier rejects empty / dotdot", () => {
      expect(safeIdentifier("").type).toBe("Failure");
      expect(safeIdentifier("..").type).toBe("Failure");
      expect(safeIdentifier(".").type).toBe("Failure");
    });
    it("safeIdentifier rejects NUL byte", () => {
      expect(safeIdentifier("a\0b").type).toBe("Failure");
    });
    it("safeIdentifier escapes path separators", () => {
      const r = safeIdentifier("LIN-12/../etc");
      if (r.type !== "Success") throw new Error("expected success after sanitisation");
      expect(r.value).not.toContain("/");
      expect(r.value).not.toContain("..");
    });
    it("workspacePathFor builds a path under root", () => {
      const r = workspacePathFor("/tmp/ws", "M-1");
      if (r.type !== "Success") throw new Error("expected success");
      expect(r.value).toBe("/tmp/ws/M-1");
    });
    it("workspacePathFor rejects relative root", () => {
      const r = workspacePathFor("tmp/ws", "M-1");
      expect(r.type).toBe("Failure");
    });
  });
}
