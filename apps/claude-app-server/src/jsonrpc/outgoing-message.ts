// File grouping rationale: kamae の "one concept per file" を厳密に取れば
// SuccessResponse / ErrorResponse / OutgoingNotification / ErrorPayload は別ファイルに
// 分けるべきだが、これら 4 つは OutgoingMessage discriminated union のメンバーとして
// 常に一緒に利用される設計上一体の概念。各バリアントに companion 固有のロジックが増えた
// 段階で再評価する。
import type { Id } from "./id.js";
import { assertNever } from "../util/assert-never.js";

// --- SuccessResponse ---

export type SuccessResponse = Readonly<{
  kind: "Success";
  id: Id;
  result: unknown;
}>;

export const SuccessResponse = {
  of: (id: Id, result: unknown): SuccessResponse => ({
    kind: "Success",
    id,
    result,
  }),
} as const;

// --- ErrorResponse ---

export type ErrorPayload = Readonly<{
  code: number;
  message: string;
  data?: unknown;
}>;

export type ErrorResponse = Readonly<{
  kind: "Error";
  id: Id | null;
  error: ErrorPayload;
}>;

export const ErrorResponse = {
  of: (id: Id | null, error: ErrorPayload): ErrorResponse => ({
    kind: "Error",
    id,
    error,
  }),
} as const;

// --- OutgoingNotification ---

export type OutgoingNotification = Readonly<{
  kind: "Notification";
  method: string;
  params?: unknown;
}>;

export const OutgoingNotification = {
  of: (method: string, params: unknown): OutgoingNotification => ({
    kind: "Notification",
    method,
    params,
  }),
} as const;

// --- OutgoingMessage union ---

export type OutgoingMessage = SuccessResponse | ErrorResponse | OutgoingNotification;

/**
 * Strips the `kind` discriminator and returns the JSON-RPC wire-format object.
 */
export const toWire = (msg: OutgoingMessage): unknown => {
  switch (msg.kind) {
    case "Success":
      return { id: msg.id, result: msg.result };
    case "Error":
      return { id: msg.id, error: msg.error };
    case "Notification":
      return msg.params === undefined
        ? { method: msg.method }
        : { method: msg.method, params: msg.params };
    default:
      return assertNever(msg);
  }
};
