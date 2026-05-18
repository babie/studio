import * as v from "valibot";

// ─── Request payload schemas (what perform SENDS) ───
export const InitializeParamsSchema = v.object({
  clientInfo: v.object({
    name: v.string(),
    version: v.string(),
  }),
});
export type InitializeParams = v.InferOutput<typeof InitializeParamsSchema>;

export const ThreadStartParamsSchema = v.object({
  cwd: v.string(),
  // Codex-specific (ignored by claude-app-server)
  approvalPolicy: v.optional(v.picklist(["never", "untrusted", "on-failure"])),
  threadSandbox: v.optional(v.picklist(["workspace-write", "read-only", "danger-full-access"])),
  turnSandboxPolicy: v.optional(
    v.variant("type", [
      v.object({ type: v.literal("workspaceWrite") }),
      v.object({ type: v.literal("readOnly") }),
      v.object({ type: v.literal("dangerFullAccess") }),
    ]),
  ),
});
export type ThreadStartParams = v.InferOutput<typeof ThreadStartParamsSchema>;

// Both claude-app-server and codex require input as an array of content items.
// We accept a string internally and convert it to the wire format on send.
export const TurnStartParamsSchema = v.object({
  threadId: v.string(),
  input: v.string(),
});
export type TurnStartParams = v.InferOutput<typeof TurnStartParamsSchema>;

/** Convert a plain-text prompt string to the wire array format accepted by both
 *  claude-app-server and codex app-server. */
export const promptToInputArray = (text: string): Array<{ type: string; text: string }> => [
  { type: "text", text },
];

export const TurnInterruptParamsSchema = v.object({
  threadId: v.string(),
});
export type TurnInterruptParams = v.InferOutput<typeof TurnInterruptParamsSchema>;

// ─── Response payload schemas (what perform RECEIVES) ───
// Real servers (claude-app-server, codex) may return different shapes.
// InitializeResult accepts any object and we extract name/version best-effort.
export const InitializeResultSchema = v.record(v.string(), v.unknown());
export type InitializeResult = {
  serverInfo: { name: string; version: string };
};

/** Normalize the raw initialize result from any server into our canonical shape. */
export const normalizeInitializeResult = (raw: Record<string, unknown>): InitializeResult => {
  // claude-app-server: { userAgent: "claude-app-server/0.1.0", ... }
  if (typeof raw.userAgent === "string") {
    const match = raw.userAgent.match(/^([^/]+)\/(\S+)/);
    return { serverInfo: { name: match?.[1] ?? "claude-app-server", version: match?.[2] ?? "unknown" } };
  }
  // If it has serverInfo already (e.g. from a future spec-conformant server)
  if (typeof raw.serverInfo === "object" && raw.serverInfo !== null) {
    const si = raw.serverInfo as Record<string, unknown>;
    return { serverInfo: { name: String(si.name ?? "unknown"), version: String(si.version ?? "unknown") } };
  }
  return { serverInfo: { name: "unknown", version: "unknown" } };
};

// ThreadStart result: servers return {thread: {id: "..."}} or {threadId: "..."}.
export const ThreadStartResultSchema = v.record(v.string(), v.unknown());
export type ThreadStartResult = {
  threadId: string;
};

/** Normalize the raw thread/start result from any server into our canonical shape. */
export const normalizeThreadStartResult = (raw: Record<string, unknown>): ThreadStartResult | null => {
  // Codex and claude-app-server: { thread: { id: "..." } }
  if (typeof raw.thread === "object" && raw.thread !== null) {
    const t = raw.thread as Record<string, unknown>;
    if (typeof t.id === "string") return { threadId: t.id };
  }
  // Future spec-conformant: { threadId: "..." }
  if (typeof raw.threadId === "string") return { threadId: raw.threadId };
  return null;
};

export const TurnCompletedResultSchema = v.object({
  threadId: v.string(),
});
export type TurnCompletedResult = v.InferOutput<typeof TurnCompletedResultSchema>;

// ─── Notification schemas (what perform RECEIVES) ───
// jsonrpc field is optional — real servers (claude-app-server, codex) omit it.
const NotificationCommon = {
  jsonrpc: v.optional(v.string()),
};

export const InitializedNotificationSchema = v.object({
  ...NotificationCommon,
  method: v.literal("initialized"),
});
// thread/started notification: servers send {thread: {id: "..."}} or {threadId: "..."}
export const ThreadStartedNotificationSchema = v.object({
  ...NotificationCommon,
  method: v.literal("thread/started"),
  params: v.record(v.string(), v.unknown()),
});
export const TurnStartedNotificationSchema = v.object({
  ...NotificationCommon,
  method: v.literal("turn/started"),
  params: v.record(v.string(), v.unknown()),
});
export const TurnCompletedNotificationSchema = v.object({
  ...NotificationCommon,
  method: v.literal("turn/completed"),
  params: v.record(v.string(), v.unknown()),
});
// item/* notifications — leave params loose for Phase 2 (UI consumption is Phase 5)
export const ItemNotificationSchema = v.object({
  ...NotificationCommon,
  method: v.pipe(v.string(), v.regex(/^item\//)),
  params: v.unknown(),
});

export const ServerNotificationSchema = v.variant("method", [
  InitializedNotificationSchema,
  ThreadStartedNotificationSchema,
  TurnStartedNotificationSchema,
  TurnCompletedNotificationSchema,
  ItemNotificationSchema,
]);
export type ServerNotification = v.InferOutput<typeof ServerNotificationSchema>;

// ─── Envelope ───
export const JsonRpcRequestSchema = v.object({
  jsonrpc: v.literal("2.0"),
  id: v.union([v.number(), v.string()]),
  method: v.string(),
  params: v.optional(v.unknown()),
});
export type JsonRpcRequest = v.InferOutput<typeof JsonRpcRequestSchema>;

// jsonrpc field is optional — real servers (claude-app-server, codex) omit it.
export const JsonRpcSuccessResponseSchema = v.object({
  jsonrpc: v.optional(v.string()),
  id: v.union([v.number(), v.string()]),
  result: v.unknown(),
});
export const JsonRpcErrorResponseSchema = v.object({
  jsonrpc: v.optional(v.string()),
  id: v.union([v.number(), v.string()]),
  error: v.object({
    code: v.number(),
    message: v.string(),
    data: v.optional(v.unknown()),
  }),
});
export const JsonRpcResponseSchema = v.union([
  JsonRpcSuccessResponseSchema,
  JsonRpcErrorResponseSchema,
]);
export type JsonRpcResponse = v.InferOutput<typeof JsonRpcResponseSchema>;
export type JsonRpcSuccessResponse = v.InferOutput<typeof JsonRpcSuccessResponseSchema>;
export type JsonRpcErrorResponse = v.InferOutput<typeof JsonRpcErrorResponseSchema>;

export const isJsonRpcResponse = (msg: unknown): msg is JsonRpcResponse =>
  typeof msg === "object" && msg !== null && "id" in msg && ("result" in msg || "error" in msg);

export const isJsonRpcNotification = (
  msg: unknown,
): msg is { jsonrpc: "2.0"; method: string; params?: unknown } =>
  typeof msg === "object" &&
  msg !== null &&
  "method" in msg &&
  !("id" in msg);

// codex `turn/completed` includes a `usage` field with input_tokens, output_tokens, total_tokens.
// claude-app-server omits usage entirely. We use safeParse so claude-path payloads return null.
const CodexUsageSchema = v.object({
  usage: v.object({
    input_tokens: v.pipe(v.number(), v.integer(), v.minValue(0)),
    output_tokens: v.pipe(v.number(), v.integer(), v.minValue(0)),
    total_tokens: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  }),
});

export type CodexUsage = Readonly<{ inputTokens: number; outputTokens: number; totalTokens: number }>;

export const extractCodexUsage = (params: unknown): CodexUsage | null => {
  const r = v.safeParse(CodexUsageSchema, params);
  if (!r.success) return null;
  const u = r.output.usage;
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    totalTokens: u.total_tokens ?? u.input_tokens + u.output_tokens,
  };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("backend/jsonrpc/messages", () => {
    it("parses ThreadStartParams with codex extras", () => {
      const r = v.safeParse(ThreadStartParamsSchema, {
        cwd: "/tmp/x",
        approvalPolicy: "never",
        threadSandbox: "workspace-write",
        turnSandboxPolicy: { type: "workspaceWrite" },
      });
      expect(r.success).toBe(true);
    });
    it("parses ThreadStartParams without codex extras", () => {
      const r = v.safeParse(ThreadStartParamsSchema, { cwd: "/tmp/x" });
      expect(r.success).toBe(true);
    });
    it("recognizes turn/completed notification", () => {
      const r = v.safeParse(ServerNotificationSchema, {
        jsonrpc: "2.0",
        method: "turn/completed",
        params: { threadId: "thr_1" },
      });
      expect(r.success).toBe(true);
    });
    it("recognizes item/* notifications loosely", () => {
      const r = v.safeParse(ServerNotificationSchema, {
        jsonrpc: "2.0",
        method: "item/agentMessage",
        params: { whatever: 1 },
      });
      expect(r.success).toBe(true);
    });
    it("isJsonRpcResponse / isJsonRpcNotification discriminate envelopes", () => {
      expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, result: {} })).toBe(true);
      expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "x" } })).toBe(true);
      expect(isJsonRpcNotification({ jsonrpc: "2.0", method: "thread/started", params: {} })).toBe(true);
      expect(isJsonRpcNotification({ jsonrpc: "2.0", id: 1, result: {} })).toBe(false);
    });
  });

  describe("extractCodexUsage", () => {
    it("returns null for missing usage (claude path)", () => {
      expect(extractCodexUsage({})).toBeNull();
      expect(extractCodexUsage({ params: "x" })).toBeNull();
    });
    it("parses codex usage with total_tokens", () => {
      const u = extractCodexUsage({ usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } });
      expect(u).toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    });
    it("defaults total_tokens to in + out when absent", () => {
      const u = extractCodexUsage({ usage: { input_tokens: 100, output_tokens: 50 } });
      expect(u).toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    });
    it("rejects negative tokens", () => {
      expect(extractCodexUsage({ usage: { input_tokens: -1, output_tokens: 0 } })).toBeNull();
    });
  });
}
