import * as v from "valibot";

const SystemInitSchema = v.object({
  type: v.literal("system"),
  subtype: v.literal("init"),
  session_id: v.string(),
});

const TextBlockSchema = v.object({
  type: v.literal("text"),
  text: v.string(),
});

const ToolUseBlockSchema = v.object({
  type: v.literal("tool_use"),
  id: v.string(),
  name: v.string(),
  input: v.unknown(),
});

const ToolResultBlockSchema = v.object({
  type: v.literal("tool_result"),
  tool_use_id: v.string(),
  content: v.unknown(),
  is_error: v.optional(v.boolean()),
});

const AssistantSchema = v.object({
  type: v.literal("assistant"),
  message: v.object({
    content: v.array(v.union([TextBlockSchema, ToolUseBlockSchema, v.unknown()])),
  }),
  session_id: v.string(),
});

const UserSchema = v.object({
  type: v.literal("user"),
  message: v.object({
    content: v.array(v.union([ToolResultBlockSchema, v.unknown()])),
  }),
  session_id: v.string(),
});

const ResultSuccessSchema = v.object({
  type: v.literal("result"),
  subtype: v.literal("success"),
  session_id: v.string(),
  result: v.string(),
});

const ResultErrorSubtypeSchema = v.picklist([
  "error_during_execution",
  "error_max_turns",
  "error_max_budget_usd",
  "error_max_structured_output_retries",
]);

const ResultErrorSchema = v.object({
  type: v.literal("result"),
  subtype: ResultErrorSubtypeSchema,
  session_id: v.string(),
  errors: v.optional(v.array(v.string())),
});

const RateLimitStatusSchema = v.picklist(["allowed", "allowed_warning", "rejected"]);

const RateLimitInfoSchema = v.looseObject({
  status: v.optional(RateLimitStatusSchema),
  overageStatus: v.optional(RateLimitStatusSchema),
});

const RateLimitEventSchema = v.object({
  type: v.literal("rate_limit_event"),
  rate_limit_info: RateLimitInfoSchema,
  session_id: v.string(),
});

export type SdkMessage =
  | Readonly<{ kind: "SystemInit"; sessionId: string }>
  | Readonly<{ kind: "AssistantText"; text: string; sessionId: string }>
  | Readonly<{
      kind: "AssistantToolUse";
      toolUseId: string;
      name: string;
      input: unknown;
      sessionId: string;
    }>
  | Readonly<{
      kind: "UserToolResult";
      toolUseId: string;
      content: unknown;
      isError: boolean;
      sessionId: string;
    }>
  | Readonly<{ kind: "ResultSuccess"; sessionId: string; resultText: string }>
  | Readonly<{
      kind: "ResultError";
      sessionId: string;
      subtype: v.InferOutput<typeof ResultErrorSubtypeSchema>;
      errors: ReadonlyArray<string>;
    }>
  | Readonly<{
      kind: "RateLimit";
      status: "allowed" | "allowed_warning" | "rejected";
      sessionId: string;
    }>
  | Readonly<{ kind: "Unknown"; raw: unknown }>;

const parseAssistantBlocks = (raw: unknown): SdkMessage[] => {
  const r = v.safeParse(AssistantSchema, raw);
  if (!r.success) return [];
  const out: SdkMessage[] = [];
  for (const block of r.output.message.content) {
    const tb = v.safeParse(TextBlockSchema, block);
    if (tb.success) {
      out.push({
        kind: "AssistantText",
        text: tb.output.text,
        sessionId: r.output.session_id,
      });
      continue;
    }
    const tu = v.safeParse(ToolUseBlockSchema, block);
    if (tu.success) {
      out.push({
        kind: "AssistantToolUse",
        toolUseId: tu.output.id,
        name: tu.output.name,
        input: tu.output.input,
        sessionId: r.output.session_id,
      });
      continue;
    }
    // 未知ブロックは黙殺
  }
  return out;
};

const parseUserBlocks = (raw: unknown): SdkMessage[] => {
  const r = v.safeParse(UserSchema, raw);
  if (!r.success) return [];
  const out: SdkMessage[] = [];
  for (const block of r.output.message.content) {
    const tr = v.safeParse(ToolResultBlockSchema, block);
    if (tr.success) {
      out.push({
        kind: "UserToolResult",
        toolUseId: tr.output.tool_use_id,
        content: tr.output.content,
        isError: tr.output.is_error ?? false,
        sessionId: r.output.session_id,
      });
    }
  }
  return out;
};

export const SdkMessage = {
  parse: (raw: unknown): SdkMessage[] => {
    const sysInit = v.safeParse(SystemInitSchema, raw);
    if (sysInit.success) return [{ kind: "SystemInit", sessionId: sysInit.output.session_id }];

    const resOk = v.safeParse(ResultSuccessSchema, raw);
    if (resOk.success)
      return [
        {
          kind: "ResultSuccess",
          sessionId: resOk.output.session_id,
          resultText: resOk.output.result,
        },
      ];

    const resErr = v.safeParse(ResultErrorSchema, raw);
    if (resErr.success)
      return [
        {
          kind: "ResultError",
          sessionId: resErr.output.session_id,
          subtype: resErr.output.subtype,
          errors: resErr.output.errors ?? [],
        },
      ];

    const rl = v.safeParse(RateLimitEventSchema, raw);
    if (rl.success) {
      const info = rl.output.rate_limit_info;
      const rejected = info.status === "rejected" || info.overageStatus === "rejected";
      const status = rejected ? "rejected" : (info.status ?? info.overageStatus ?? "allowed");
      return [{ kind: "RateLimit", status, sessionId: rl.output.session_id }];
    }

    const asst = parseAssistantBlocks(raw);
    if (asst.length > 0) return asst;

    const user = parseUserBlocks(raw);
    if (user.length > 0) return user;

    return [{ kind: "Unknown", raw }];
  },
} as const;
