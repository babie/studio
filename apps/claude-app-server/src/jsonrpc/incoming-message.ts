// File grouping rationale: kamae の "one concept per file" を厳密に取れば
// Request / Notification / ParseError / InvalidMessage は別ファイルに分けるべきだが、
// これら 4 つは IncomingMessage discriminated union のメンバーとして常に一緒に
// 利用される設計上一体の概念。各バリアントに companion 固有のロジックが増えた
// 段階で再評価する。
import type { Result } from "@praha/byethrow";
import * as v from "valibot";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Id } from "./id.js";
import { schemaResult, type ValidationError } from "./schema-result.js";

// --- Request ---

export type Request = Readonly<{
  kind: "Request";
  id: Id;
  method: string;
  params: unknown;
}>;

const RequestSchema = v.pipe(
  v.object({
    id: Id.schema,
    method: v.string(),
    params: v.optional(v.unknown()),
    jsonrpc: v.optional(v.literal("2.0")),
  }),
  v.transform(
    (wire): Request => ({
      kind: "Request",
      id: wire.id,
      method: wire.method,
      params: wire.params,
    }),
  ),
);

// --- Notification ---

export type Notification = Readonly<{
  kind: "Notification";
  method: string;
  params: unknown;
}>;

const NotificationSchema = v.pipe(
  v.object({
    method: v.string(),
    params: v.optional(v.unknown()),
    jsonrpc: v.optional(v.literal("2.0")),
  }),
  v.transform(
    (wire): Notification => ({
      kind: "Notification",
      method: wire.method,
      params: wire.params,
    }),
  ),
);

// --- ParseError (constructed by transport when JSON.parse fails) ---

export type ParseError = Readonly<{
  kind: "ParseError";
  line: string;
}>;

export const ParseError = {
  of: (line: string): ParseError => ({ kind: "ParseError", line }),
} as const;

// --- InvalidMessage (received valid JSON but not a request/notification) ---

export type InvalidMessage = Readonly<{
  kind: "InvalidMessage";
  issues: ReadonlyArray<StandardSchemaV1.Issue>;
}>;

export const InvalidMessage = {
  of: (issues: ReadonlyArray<StandardSchemaV1.Issue>): InvalidMessage => ({
    kind: "InvalidMessage",
    issues,
  }),
} as const;

// --- IncomingMessage union ---

const RequestOrNotificationSchema = v.union([RequestSchema, NotificationSchema]);

export type IncomingMessage = Request | Notification | ParseError | InvalidMessage;

export const IncomingMessage: Readonly<{
  /**
   * Parses a value already parsed from JSON (i.e. not a string) into either
   * a Request or Notification. ParseError and InvalidMessage are produced by
   * the transport layer, not by this parser.
   */
  parseRequestOrNotification: (
    raw: unknown,
  ) => Result.Result<Request | Notification, ValidationError>;
}> = {
  parseRequestOrNotification: schemaResult(RequestOrNotificationSchema),
} as const;
