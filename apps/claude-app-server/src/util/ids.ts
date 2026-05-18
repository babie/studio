import { randomUUID } from "node:crypto";
import type { Result } from "@praha/byethrow";
import * as v from "valibot";
import { schemaResult, type ValidationError } from "../jsonrpc/schema-result.js";

const makeBranded = <Brand extends string>(brand: Brand, prefix: string) => {
  const schema = v.pipe(
    v.string(),
    v.minLength(prefix.length + 1),
    v.check((s) => s.startsWith(prefix), `must start with "${prefix}"`),
    v.brand(brand),
  );
  type T = v.InferOutput<typeof schema>;
  return {
    schema,
    parse: schemaResult(schema) as (raw: unknown) => Result.Result<T, ValidationError>,
    fresh: (): T => `${prefix}${randomUUID()}` as T,
  } as const;
};

const ThreadIdImpl = makeBranded("ThreadId", "thr_");
export type ThreadId = v.InferOutput<typeof ThreadIdImpl.schema>;
export const ThreadId = ThreadIdImpl;

const TurnIdImpl = makeBranded("TurnId", "turn_");
export type TurnId = v.InferOutput<typeof TurnIdImpl.schema>;
export const TurnId = TurnIdImpl;

const ItemIdImpl = makeBranded("ItemId", "item_");
export type ItemId = v.InferOutput<typeof ItemIdImpl.schema>;
export const ItemId = ItemIdImpl;

// Claude SDK が払い出す session_id。prefix は持たないので minLength(1) のみ。
const SessionIdSchema = v.pipe(v.string(), v.minLength(1), v.brand("SessionId"));
export type SessionId = v.InferOutput<typeof SessionIdSchema>;
export const SessionId: Readonly<{
  schema: typeof SessionIdSchema;
  parse: (raw: unknown) => Result.Result<SessionId, ValidationError>;
}> = {
  schema: SessionIdSchema,
  parse: schemaResult(SessionIdSchema),
} as const;
