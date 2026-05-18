import { ErrorCode } from "./error-code.js";
import type { ErrorPayload } from "./outgoing-message.js";

export type DispatchError =
  | Readonly<{ kind: "ParseError" }>
  | Readonly<{ kind: "InvalidRequest" }>
  | Readonly<{ kind: "MethodNotFound"; method: string }>
  | Readonly<{ kind: "InvalidParams"; message: string }>
  | Readonly<{ kind: "InternalError"; cause: unknown }>;

export const DispatchError = {
  toErrorPayload: (err: DispatchError): ErrorPayload => {
    switch (err.kind) {
      case "ParseError":
        return { code: ErrorCode.ParseError, message: "Parse error" };
      case "InvalidRequest":
        return { code: ErrorCode.InvalidRequest, message: "Invalid Request" };
      case "MethodNotFound":
        return {
          code: ErrorCode.MethodNotFound,
          message: `Method not found: ${err.method}`,
        };
      case "InvalidParams":
        return { code: ErrorCode.InvalidParams, message: `Invalid params: ${err.message}` };
      case "InternalError":
        return {
          code: ErrorCode.InternalError,
          message: err.cause instanceof Error ? err.cause.message : String(err.cause),
        };
    }
  },
} as const;
