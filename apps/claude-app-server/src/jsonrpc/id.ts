import type { Result } from "@praha/byethrow";
import * as v from "valibot";
import { schemaResult, type ValidationError } from "./schema-result.js";

const IdSchema = v.pipe(v.union([v.number(), v.string()]), v.brand("JsonRpcId"));

export type Id = v.InferOutput<typeof IdSchema>;

export const Id: Readonly<{
  schema: typeof IdSchema;
  parse: (raw: unknown) => Result.Result<Id, ValidationError>;
}> = {
  schema: IdSchema,
  parse: schemaResult(IdSchema),
} as const;
