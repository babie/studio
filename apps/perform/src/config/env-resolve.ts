import type { Result } from "@praha/byethrow";

const ENV_REF_RE = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;

export type EnvResolveError =
  | Readonly<{ kind: "missing-env"; var: string }>
  | Readonly<{ kind: "empty-env"; var: string }>;

/**
 * Resolves a `$VAR_NAME` reference against the environment.
 * - `$LINEAR_API_KEY`-style strings are expanded.
 * - Strings not matching the pattern are returned as-is (treated as literals).
 * - `$1FOO` and similar invalid identifiers are NOT matched (returned as-is).
 * Symphony-compatible (`config/schema.ex` resolve_env_value).
 */
export const resolveEnvRef = (
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): Result.Result<string, EnvResolveError> => {
  const m = ENV_REF_RE.exec(value);
  if (!m) return { type: "Success", value };
  const name = m[1]!;
  const raw = env[name];
  if (raw === undefined) return { type: "Failure", error: { kind: "missing-env", var: name } };
  if (raw === "") return { type: "Failure", error: { kind: "empty-env", var: name } };
  return { type: "Success", value: raw };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("config/env-resolve", () => {
    it("returns literal string unchanged", () => {
      const r = resolveEnvRef("lin_abc123", {});
      if (r.type !== "Success") throw new Error("expected success");
      expect(r.value).toBe("lin_abc123");
    });

    it("expands $VAR to env value", () => {
      const r = resolveEnvRef("$LINEAR_API_KEY", { LINEAR_API_KEY: "lin_xxx" });
      if (r.type !== "Success") throw new Error("expected success");
      expect(r.value).toBe("lin_xxx");
    });

    it("returns missing-env when var is undefined", () => {
      const r = resolveEnvRef("$LINEAR_API_KEY", {});
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("missing-env");
      if (r.error.kind === "missing-env") expect(r.error.var).toBe("LINEAR_API_KEY");
    });

    it("returns empty-env when var is empty string", () => {
      const r = resolveEnvRef("$LINEAR_API_KEY", { LINEAR_API_KEY: "" });
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("empty-env");
    });

    it("treats $1FOO as literal (does not match regex)", () => {
      const r = resolveEnvRef("$1FOO", { "1FOO": "bad" });
      if (r.type !== "Success") throw new Error("expected success");
      expect(r.value).toBe("$1FOO");
    });

    it("treats ${VAR} as literal (only $VAR form is supported)", () => {
      const r = resolveEnvRef("${LINEAR_API_KEY}", { LINEAR_API_KEY: "x" });
      if (r.type !== "Success") throw new Error("expected success");
      expect(r.value).toBe("${LINEAR_API_KEY}");
    });
  });
}
