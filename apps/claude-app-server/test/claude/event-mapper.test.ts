import { describe, expect, it } from "vitest";
import { EventMapper } from "../../src/claude/event-mapper.js";
import type { SdkMessage } from "../../src/claude/sdk-message.js";
import { ThreadId, TurnId } from "../../src/util/ids.js";

const ctx = {
  threadId: ThreadId.fresh(),
  turnId: TurnId.fresh(),
  cwd: "/tmp",
};

const initialState = EventMapper.initialState();

describe("EventMapper.map", () => {
  it("emits no notification for SystemInit", () => {
    const msg: SdkMessage = { kind: "SystemInit", sessionId: "s" };
    const { notifications } = EventMapper.map(msg, initialState, ctx);
    expect(notifications).toEqual([]);
  });

  it("opens an agentMessage item with started + delta on first AssistantText", () => {
    const msg: SdkMessage = { kind: "AssistantText", text: "hi", sessionId: "s" };
    const { state, notifications } = EventMapper.map(msg, initialState, ctx);
    expect(notifications).toHaveLength(2);
    expect(notifications[0]?.method).toBe("item/started");
    expect(notifications[1]?.method).toBe("item/agentMessage/delta");
    expect(state.currentAgentMessage?.text).toBe("hi");
    expect(state.currentAgentMessage?.itemId.startsWith("item_")).toBe(true);
  });

  it("closes the previous agentMessage item before opening a new one", () => {
    const first = EventMapper.map(
      { kind: "AssistantText", text: "a", sessionId: "s" },
      initialState,
      ctx,
    );
    const second = EventMapper.map(
      { kind: "AssistantText", text: "b", sessionId: "s" },
      first.state,
      ctx,
    );
    expect(second.notifications.map((n) => n.method)).toEqual([
      "item/completed",
      "item/started",
      "item/agentMessage/delta",
    ]);
    expect(second.state.currentAgentMessage?.text).toBe("b");
  });

  it("emits nothing on ResultSuccess (close is session responsibility)", () => {
    const opened = EventMapper.map(
      { kind: "AssistantText", text: "answer", sessionId: "s" },
      initialState,
      ctx,
    );
    const result = EventMapper.map(
      { kind: "ResultSuccess", sessionId: "s", resultText: "answer" },
      opened.state,
      ctx,
    );
    expect(result.notifications).toEqual([]);
    expect(result.state).toEqual(opened.state);
  });

  it("emits nothing on ResultError (close is session responsibility)", () => {
    const opened = EventMapper.map(
      { kind: "AssistantText", text: "x", sessionId: "s" },
      initialState,
      ctx,
    );
    const result = EventMapper.map(
      {
        kind: "ResultError",
        sessionId: "s",
        subtype: "error_during_execution",
        errors: ["boom"],
      },
      opened.state,
      ctx,
    );
    expect(result.notifications).toEqual([]);
  });

  it("closes the agentMessage item on AssistantToolUse and opens a tool item", () => {
    const opened = EventMapper.map(
      { kind: "AssistantText", text: "let me run", sessionId: "s" },
      initialState,
      ctx,
    );
    const { notifications, state } = EventMapper.map(
      { kind: "AssistantToolUse", toolUseId: "tu", name: "Bash", input: {}, sessionId: "s" },
      opened.state,
      ctx,
    );
    expect(notifications.map((n) => n.method)).toEqual(["item/completed", "item/started"]);
    expect(state.currentAgentMessage).toBeUndefined();
    expect(state.pendingTools.get("tu")?.itemType).toBe("commandExecution");
  });

  it("Unknown emits nothing and preserves state", () => {
    const opened = EventMapper.map(
      { kind: "AssistantText", text: "x", sessionId: "s" },
      initialState,
      ctx,
    );
    const { notifications, state } = EventMapper.map(
      { kind: "Unknown", raw: {} },
      opened.state,
      ctx,
    );
    expect(notifications).toEqual([]);
    expect(state).toEqual(opened.state);
  });

  it("opens commandExecution item on Bash tool_use, closing in-progress agentMessage", () => {
    const opened = EventMapper.map(
      { kind: "AssistantText", text: "running", sessionId: "s" },
      EventMapper.initialState(),
      ctx,
    );
    const next = EventMapper.map(
      {
        kind: "AssistantToolUse",
        toolUseId: "tu_1",
        name: "Bash",
        input: { command: "ls" },
        sessionId: "s",
      },
      opened.state,
      ctx,
    );
    expect(next.notifications.map((n) => n.method)).toEqual(["item/completed", "item/started"]);
    const startedParams = next.notifications[1]?.params as { item: { type: string; id: string } };
    expect(startedParams.item.type).toBe("commandExecution");
    expect(next.state.pendingTools.size).toBe(1);
    expect(next.state.pendingTools.get("tu_1")?.itemType).toBe("commandExecution");
    expect(next.state.currentAgentMessage).toBeUndefined();
  });

  it("opens 2 pending entries for two tool_use in one assistant message", () => {
    const state = EventMapper.initialState();
    const r1 = EventMapper.map(
      {
        kind: "AssistantToolUse",
        toolUseId: "tu_1",
        name: "Read",
        input: { file_path: "/a" },
        sessionId: "s",
      },
      state,
      ctx,
    );
    const r2 = EventMapper.map(
      {
        kind: "AssistantToolUse",
        toolUseId: "tu_2",
        name: "Bash",
        input: { command: "ls" },
        sessionId: "s",
      },
      r1.state,
      ctx,
    );
    expect(r2.state.pendingTools.size).toBe(2);
    expect(r2.state.pendingTools.get("tu_1")?.itemType).toBe("mcpToolCall");
    expect(r2.state.pendingTools.get("tu_2")?.itemType).toBe("commandExecution");
  });

  it("uses thread cwd when building commandExecution started", () => {
    const ctxWithCwd = { ...ctx, cwd: "/my/ws" };
    const r = EventMapper.map(
      {
        kind: "AssistantToolUse",
        toolUseId: "tu_1",
        name: "Bash",
        input: { command: "x" },
        sessionId: "s",
      },
      EventMapper.initialState(),
      ctxWithCwd,
    );
    const startedParams = r.notifications[0]?.params as { item: { cwd: string } };
    expect(startedParams.item.cwd).toBe("/my/ws");
  });

  describe("EventMapper.map - UserToolResult", () => {
    it("closes the matching pending tool item with status:completed", () => {
      const startState = EventMapper.map(
        {
          kind: "AssistantToolUse",
          toolUseId: "tu_1",
          name: "Bash",
          input: { command: "ls" },
          sessionId: "s",
        },
        EventMapper.initialState(),
        ctx,
      );
      const next = EventMapper.map(
        {
          kind: "UserToolResult",
          toolUseId: "tu_1",
          content: "file1\nfile2\n",
          isError: false,
          sessionId: "s",
        },
        startState.state,
        ctx,
      );
      expect(next.notifications.map((n) => n.method)).toEqual(["item/completed"]);
      const params = next.notifications[0]?.params as {
        item: { status: string; aggregatedOutput: string };
      };
      expect(params.item.status).toBe("completed");
      expect(params.item.aggregatedOutput).toBe("file1\nfile2\n");
      expect(next.state.pendingTools.size).toBe(0);
    });

    it("sets status:failed when tool_result.is_error indicator is present", () => {
      const startState = EventMapper.map(
        {
          kind: "AssistantToolUse",
          toolUseId: "tu_1",
          name: "Bash",
          input: { command: "false" },
          sessionId: "s",
        },
        EventMapper.initialState(),
        ctx,
      );
      const next = EventMapper.map(
        {
          kind: "UserToolResult",
          toolUseId: "tu_1",
          content: [{ type: "text", text: "boom" }],
          sessionId: "s",
          isError: true,
        },
        startState.state,
        ctx,
      );
      const params = next.notifications[0]?.params as { item: { status: string } };
      expect(params.item.status).toBe("failed");
    });

    it("silently drops tool_result for an unknown tool_use_id", () => {
      const next = EventMapper.map(
        {
          kind: "UserToolResult",
          toolUseId: "ghost",
          content: "x",
          isError: false,
          sessionId: "s",
        },
        EventMapper.initialState(),
        ctx,
      );
      expect(next.notifications).toEqual([]);
      expect(next.state.pendingTools.size).toBe(0);
    });
  });

  it("delta params include threadId/turnId/itemId/delta", () => {
    const { notifications } = EventMapper.map(
      { kind: "AssistantText", text: "hello", sessionId: "s" },
      initialState,
      ctx,
    );
    const delta = notifications[1];
    expect(delta?.params).toMatchObject({
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      delta: "hello",
    });
  });
});

describe("EventMapper.closeAll", () => {
  it("closes nothing when state is empty", () => {
    const r = EventMapper.closeAll(EventMapper.initialState(), ctx, "completed");
    expect(r.notifications).toEqual([]);
    expect(r.state.pendingTools.size).toBe(0);
  });

  it("closes only the open agentMessage when reason=completed", () => {
    const opened = EventMapper.map(
      { kind: "AssistantText", text: "answer", sessionId: "s" },
      EventMapper.initialState(),
      ctx,
    );
    const r = EventMapper.closeAll(opened.state, ctx, "completed");
    expect(r.notifications).toHaveLength(1);
    const params = r.notifications[0]?.params as { item: { type: string; status: string } };
    expect(params.item.type).toBe("agentMessage");
    expect(params.item.status).toBe("completed");
    expect(r.state.currentAgentMessage).toBeUndefined();
  });

  it("closes pending tool items with status=failed when reason=failed", () => {
    const r1 = EventMapper.map(
      {
        kind: "AssistantToolUse",
        toolUseId: "tu_1",
        name: "Bash",
        input: { command: "x" },
        sessionId: "s",
      },
      EventMapper.initialState(),
      ctx,
    );
    const r = EventMapper.closeAll(r1.state, ctx, "failed");
    expect(r.notifications).toHaveLength(1);
    const params = r.notifications[0]?.params as { item: { type: string; status: string } };
    expect(params.item.type).toBe("commandExecution");
    expect(params.item.status).toBe("failed");
    expect(r.state.pendingTools.size).toBe(0);
  });

  it("closes both agentMessage and pending tool items with reason=interrupted", () => {
    const s1 = EventMapper.map(
      { kind: "AssistantText", text: "running", sessionId: "s" },
      EventMapper.initialState(),
      ctx,
    );
    const s2 = EventMapper.map(
      {
        kind: "AssistantToolUse",
        toolUseId: "tu_1",
        name: "Bash",
        input: { command: "x" },
        sessionId: "s",
      },
      s1.state,
      ctx,
    );
    // s2 already closed the agentMessage; add a new agentMessage on top
    const s3 = EventMapper.map(
      { kind: "AssistantText", text: "more", sessionId: "s" },
      s2.state,
      ctx,
    );
    const r = EventMapper.closeAll(s3.state, ctx, "interrupted");
    const statuses = r.notifications.map(
      (n) => (n.params as { item: { status: string } }).item.status,
    );
    expect(statuses).toEqual(["interrupted", "interrupted"]);
    expect(r.state.pendingTools.size).toBe(0);
    expect(r.state.currentAgentMessage).toBeUndefined();
  });
});
