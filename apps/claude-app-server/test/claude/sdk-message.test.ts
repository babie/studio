import { describe, expect, it } from "vitest";
import { SdkMessage } from "../../src/claude/sdk-message.js";

describe("SdkMessage.parse", () => {
  it("parses system.init into SystemInit", () => {
    const parsed = SdkMessage.parse({
      type: "system",
      subtype: "init",
      session_id: "sess-abc",
      model: "claude-opus-4-7",
      cwd: "/tmp",
      tools: [],
      mcp_servers: [],
      apiKeySource: "oauth",
      permissionMode: "default",
      slash_commands: [],
      output_style: "default",
      skills: [],
      plugins: [],
      claude_code_version: "x",
      uuid: "u",
    });
    expect(parsed).toHaveLength(1);
    const msg = parsed[0];
    expect(msg?.kind).toBe("SystemInit");
    if (msg?.kind === "SystemInit") {
      expect(msg.sessionId).toBe("sess-abc");
    }
  });

  it("parses assistant message with text content into AssistantText", () => {
    const parsed = SdkMessage.parse({
      type: "assistant",
      message: { content: [{ type: "text", text: "hello" }] },
      session_id: "s",
      parent_tool_use_id: null,
      uuid: "u",
    });
    expect(parsed).toHaveLength(1);
    const msg = parsed[0];
    expect(msg?.kind).toBe("AssistantText");
    if (msg?.kind === "AssistantText") {
      expect(msg.text).toBe("hello");
    }
  });

  it("yields multiple text blocks in assistant content as separate AssistantText messages", () => {
    const parsed = SdkMessage.parse({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "foo" },
          { type: "text", text: " bar" },
        ],
      },
      session_id: "s",
      parent_tool_use_id: null,
      uuid: "u",
    });
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.kind).toBe("AssistantText");
    expect(parsed[1]?.kind).toBe("AssistantText");
    if (parsed[0]?.kind === "AssistantText") {
      expect(parsed[0].text).toBe("foo");
    }
    if (parsed[1]?.kind === "AssistantText") {
      expect(parsed[1].text).toBe(" bar");
    }
  });

  it("parses assistant message with tool_use into AssistantToolUse", () => {
    const parsed = SdkMessage.parse({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } }],
      },
      session_id: "s",
      parent_tool_use_id: null,
      uuid: "u",
    });
    expect(parsed).toHaveLength(1);
    const msg = parsed[0];
    expect(msg?.kind).toBe("AssistantToolUse");
    if (msg?.kind === "AssistantToolUse") {
      expect(msg.toolUseId).toBe("tu_1");
      expect(msg.name).toBe("Bash");
    }
  });

  it("parses user tool_result into UserToolResult", () => {
    const parsed = SdkMessage.parse({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "tu_1", content: "ok" }],
      },
      session_id: "s",
      parent_tool_use_id: null,
    });
    expect(parsed).toHaveLength(1);
    const msg = parsed[0];
    expect(msg?.kind).toBe("UserToolResult");
    if (msg?.kind === "UserToolResult") {
      expect(msg.toolUseId).toBe("tu_1");
    }
  });

  it("parses result success into ResultSuccess", () => {
    const parsed = SdkMessage.parse({
      type: "result",
      subtype: "success",
      result: "4",
      session_id: "s",
      uuid: "u",
      duration_ms: 1,
      duration_api_ms: 1,
      is_error: false,
      num_turns: 1,
      stop_reason: null,
      total_cost_usd: 0,
      usage: {},
      modelUsage: {},
      permission_denials: [],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.kind).toBe("ResultSuccess");
  });

  it("parses result error subtypes into ResultError", () => {
    const parsed = SdkMessage.parse({
      type: "result",
      subtype: "error_during_execution",
      session_id: "s",
      uuid: "u",
      duration_ms: 1,
      duration_api_ms: 1,
      is_error: true,
      num_turns: 1,
      stop_reason: null,
      total_cost_usd: 0,
      usage: {},
      modelUsage: {},
      permission_denials: [],
      errors: ["boom"],
    });
    expect(parsed).toHaveLength(1);
    const msg = parsed[0];
    expect(msg?.kind).toBe("ResultError");
    if (msg?.kind === "ResultError") {
      expect(msg.errors).toEqual(["boom"]);
    }
  });

  it("returns Unknown for unrecognized message types", () => {
    const parsed = SdkMessage.parse({ type: "status", anything: 1 });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.kind).toBe("Unknown");
  });

  it("returns Unknown for assistant message with empty content", () => {
    const parsed = SdkMessage.parse({
      type: "assistant",
      message: { content: [] },
      session_id: "s",
      parent_tool_use_id: null,
      uuid: "u",
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.kind).toBe("Unknown");
  });

  it("yields text then tool_use in order when both appear in one assistant message", () => {
    const parsed = SdkMessage.parse({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "let me run" },
          { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } },
        ],
      },
      session_id: "s",
      parent_tool_use_id: null,
      uuid: "u",
    });
    expect(parsed.map((m) => m.kind)).toEqual(["AssistantText", "AssistantToolUse"]);
  });

  it("yields multiple tool_use blocks in order", () => {
    const parsed = SdkMessage.parse({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } },
          { type: "tool_use", id: "tu_2", name: "Read", input: { file_path: "/a" } },
        ],
      },
      session_id: "s",
      parent_tool_use_id: null,
      uuid: "u",
    });
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.kind).toBe("AssistantToolUse");
    expect(parsed[1]?.kind).toBe("AssistantToolUse");
  });

  it("yields multiple tool_result blocks from a user message in order", () => {
    const parsed = SdkMessage.parse({
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tu_1", content: "ok1" },
          { type: "tool_result", tool_use_id: "tu_2", content: "ok2" },
        ],
      },
      session_id: "s",
      parent_tool_use_id: null,
      uuid: "u",
    });
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.kind).toBe("UserToolResult");
    expect(parsed[1]?.kind).toBe("UserToolResult");
  });

  it("returns [Unknown] for unrecognized payloads", () => {
    const parsed = SdkMessage.parse({ type: "wat" });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.kind).toBe("Unknown");
  });

  it("skips unknown content blocks in assistant message but keeps known ones", () => {
    const parsed = SdkMessage.parse({
      type: "assistant",
      message: {
        content: [
          { type: "thinking", text: "internal" },
          { type: "text", text: "visible" },
        ],
      },
      session_id: "s",
      parent_tool_use_id: null,
      uuid: "u",
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.kind).toBe("AssistantText");
  });

  it("parses rate_limit_event (status: allowed) into RateLimit", () => {
    const parsed = SdkMessage.parse({
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed", utilization: 0.1 },
      session_id: "s",
      uuid: "u",
    });
    expect(parsed).toHaveLength(1);
    const msg = parsed[0];
    expect(msg?.kind).toBe("RateLimit");
    if (msg?.kind === "RateLimit") {
      expect(msg.status).toBe("allowed");
    }
  });

  it("parses rate_limit_event with rate_limit_info.status: rejected as rejected", () => {
    const parsed = SdkMessage.parse({
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", rateLimitType: "five_hour" },
      session_id: "s",
      uuid: "u",
    });
    expect(parsed).toHaveLength(1);
    const msg = parsed[0];
    expect(msg?.kind).toBe("RateLimit");
    if (msg?.kind === "RateLimit") {
      expect(msg.status).toBe("rejected");
    }
  });

  it("parses rate_limit_event with overageStatus: rejected as rejected even if status is allowed", () => {
    const parsed = SdkMessage.parse({
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed", overageStatus: "rejected" },
      session_id: "s",
      uuid: "u",
    });
    expect(parsed).toHaveLength(1);
    const msg = parsed[0];
    expect(msg?.kind).toBe("RateLimit");
    if (msg?.kind === "RateLimit") {
      expect(msg.status).toBe("rejected");
    }
  });

  it("defaults RateLimit status to 'allowed' when rate_limit_info.status is missing", () => {
    const parsed = SdkMessage.parse({
      type: "rate_limit_event",
      rate_limit_info: {},
      session_id: "s",
      uuid: "u",
    });
    expect(parsed).toHaveLength(1);
    const msg = parsed[0];
    expect(msg?.kind).toBe("RateLimit");
    if (msg?.kind === "RateLimit") {
      expect(msg.status).toBe("allowed");
    }
  });

  it("falls back to overageStatus when rate_limit_info.status is missing (non-rejected case)", () => {
    const parsed = SdkMessage.parse({
      type: "rate_limit_event",
      rate_limit_info: { overageStatus: "allowed_warning" },
      session_id: "s",
      uuid: "u",
    });
    expect(parsed).toHaveLength(1);
    const msg = parsed[0];
    expect(msg?.kind).toBe("RateLimit");
    if (msg?.kind === "RateLimit") {
      expect(msg.status).toBe("allowed_warning");
    }
  });
});
