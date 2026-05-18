import type { Result } from "@praha/byethrow";
import type { StandardSchemaV1 } from "@standard-schema/spec";

export type ValidationFailure = Readonly<{
  issues: ReadonlyArray<StandardSchemaV1.Issue>;
}>;

export const schemaResult =
  <T>(schema: StandardSchemaV1<unknown, T>) =>
  (raw: unknown): Result.Result<T, ValidationFailure> => {
    const result = schema["~standard"].validate(raw);
    if (result instanceof Promise) {
      throw new TypeError("Schema validation must be synchronous");
    }
    if (result.issues) {
      return { type: "Failure", error: { issues: result.issues } };
    }
    return { type: "Success", value: result.value };
  };
