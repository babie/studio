import type { Result } from "@praha/byethrow";
import type { StandardSchemaV1 } from "@standard-schema/spec";

export type ValidationError = Readonly<{
  kind: "ValidationError";
  issues: ReadonlyArray<StandardSchemaV1.Issue>;
}>;

// byethrow Results are plain tagged-object unions by design (see the
// Success<T> / Failure<E> type docs in @praha/byethrow). Result.succeed/fail
// auto-detect Promise inputs and return a conditional ResultFor type, which
// TS cannot simplify when T is itself a generic parameter. The plain object
// form below is the canonical equivalent that sidesteps that conditional.
export const schemaResult =
  <T>(schema: StandardSchemaV1<unknown, T>) =>
  (raw: unknown): Result.Result<T, ValidationError> => {
    const result = schema["~standard"].validate(raw);
    if (result instanceof Promise) {
      throw new TypeError("Schema validation must be synchronous");
    }
    if (result.issues) {
      return {
        type: "Failure",
        error: { kind: "ValidationError", issues: result.issues },
      };
    }
    return { type: "Success", value: result.value };
  };
