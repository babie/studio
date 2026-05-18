import { describe, expect, it } from "vitest";
import { ToolItem } from "../../src/claude/tool-item.js";
import { ItemId } from "../../src/util/ids.js";

describe("ToolItem.dispatch", () => {
  it("returns commandExecution for Bash", () => {
    expect(ToolItem.dispatch("Bash")).toBe("commandExecution");
  });
  it("returns fileChange for Edit / Write / MultiEdit", () => {
    expect(ToolItem.dispatch("Edit")).toBe("fileChange");
    expect(ToolItem.dispatch("Write")).toBe("fileChange");
    expect(ToolItem.dispatch("MultiEdit")).toBe("fileChange");
  });
  it("returns mcpToolCall for everything else", () => {
    expect(ToolItem.dispatch("Read")).toBe("mcpToolCall");
    expect(ToolItem.dispatch("Glob")).toBe("mcpToolCall");
    expect(ToolItem.dispatch("Grep")).toBe("mcpToolCall");
    expect(ToolItem.dispatch("WebFetch")).toBe("mcpToolCall");
    expect(ToolItem.dispatch("SomeFutureTool")).toBe("mcpToolCall");
  });
});

describe("ToolItem.normalizeToolResultContent", () => {
  it("returns the string as-is when content is a string", () => {
    expect(ToolItem.normalizeToolResultContent("hello")).toBe("hello");
  });
  it("concatenates text blocks when content is an array of blocks", () => {
    const out = ToolItem.normalizeToolResultContent([
      { type: "text", text: "foo " },
      { type: "text", text: "bar" },
    ]);
    expect(out).toBe("foo bar");
  });
  it("falls back to JSON.stringify for non-text blocks in array", () => {
    const out = ToolItem.normalizeToolResultContent([{ type: "image", source: { url: "x" } }]);
    expect(out).toContain("image");
  });
  it("falls back to JSON.stringify for unknown content shapes", () => {
    expect(ToolItem.normalizeToolResultContent({ weird: true })).toBe('{"weird":true}');
  });
});

describe("ToolItem.buildStarted (Bash)", () => {
  it("builds a commandExecution started item from Bash tool_use", () => {
    const itemId = ItemId.fresh();
    const item = ToolItem.buildStarted({
      itemId,
      name: "Bash",
      input: { command: "ls -la", description: "list files" },
      cwd: "/tmp/ws",
    });
    expect(item).toEqual({
      id: itemId,
      type: "commandExecution",
      command: ["bash", "-c", "ls -la"],
      cwd: "/tmp/ws",
      status: "inProgress",
      commandActions: [],
      aggregatedOutput: "",
      exitCode: null,
      durationMs: null,
    });
  });
  it("falls back to empty string when Bash command is missing", () => {
    const itemId = ItemId.fresh();
    const item = ToolItem.buildStarted({
      itemId,
      name: "Bash",
      input: {},
      cwd: "/tmp",
    });
    expect((item as { command: string[] }).command).toEqual(["bash", "-c", ""]);
  });
});

describe("ToolItem.buildCompleted (Bash)", () => {
  it("populates aggregatedOutput and status: completed on success", () => {
    const itemId = ItemId.fresh();
    const started = ToolItem.buildStarted({
      itemId,
      name: "Bash",
      input: { command: "echo hi" },
      cwd: "/tmp",
    });
    const completed = ToolItem.buildCompleted({
      started,
      content: "hi\n",
      isError: false,
    });
    expect(completed).toMatchObject({
      id: itemId,
      type: "commandExecution",
      status: "completed",
      aggregatedOutput: "hi\n",
      exitCode: null,
    });
  });
  it("sets status: failed when is_error is true", () => {
    const itemId = ItemId.fresh();
    const started = ToolItem.buildStarted({
      itemId,
      name: "Bash",
      input: { command: "false" },
      cwd: "/tmp",
    });
    const completed = ToolItem.buildCompleted({
      started,
      content: "error: x",
      isError: true,
    });
    expect(completed).toMatchObject({
      status: "failed",
      aggregatedOutput: "error: x",
    });
  });
});

describe("ToolItem.buildStarted (fileChange)", () => {
  it("maps Edit to fileChange with kind:edit and simple diff", () => {
    const itemId = ItemId.fresh();
    const item = ToolItem.buildStarted({
      itemId,
      name: "Edit",
      input: { file_path: "/a.ts", old_string: "old", new_string: "new" },
      cwd: "/tmp",
    });
    expect(item).toMatchObject({
      id: itemId,
      type: "fileChange",
      status: "inProgress",
      changes: [{ path: "/a.ts", kind: "edit", diff: "< old\n> new" }],
    });
  });

  it("maps Write to fileChange with kind:create", () => {
    const itemId = ItemId.fresh();
    const item = ToolItem.buildStarted({
      itemId,
      name: "Write",
      input: { file_path: "/b.ts", content: "hello\nworld" },
      cwd: "/tmp",
    });
    expect(item).toMatchObject({
      type: "fileChange",
      changes: [{ path: "/b.ts", kind: "create", diff: "> hello\nworld" }],
    });
  });

  it("maps MultiEdit to fileChange with diff joined by ---", () => {
    const itemId = ItemId.fresh();
    const item = ToolItem.buildStarted({
      itemId,
      name: "MultiEdit",
      input: {
        file_path: "/c.ts",
        edits: [
          { old_string: "a1", new_string: "b1" },
          { old_string: "a2", new_string: "b2" },
        ],
      },
      cwd: "/tmp",
    });
    expect(item).toMatchObject({
      type: "fileChange",
      changes: [{ path: "/c.ts", kind: "edit", diff: "< a1\n> b1\n---\n< a2\n> b2" }],
    });
  });
});

describe("ToolItem.buildCompleted (fileChange)", () => {
  it("preserves changes from started and sets status:completed", () => {
    const itemId = ItemId.fresh();
    const started = ToolItem.buildStarted({
      itemId,
      name: "Edit",
      input: { file_path: "/x", old_string: "o", new_string: "n" },
      cwd: "/tmp",
    });
    const completed = ToolItem.buildCompleted({
      started,
      content: "File updated",
      isError: false,
    });
    expect(completed).toMatchObject({
      type: "fileChange",
      status: "completed",
      changes: started.changes,
    });
  });

  it("sets status:failed on is_error", () => {
    const itemId = ItemId.fresh();
    const started = ToolItem.buildStarted({
      itemId,
      name: "Write",
      input: { file_path: "/x", content: "x" },
      cwd: "/tmp",
    });
    const completed = ToolItem.buildCompleted({
      started,
      content: "permission denied",
      isError: true,
    });
    expect((completed as { status: string }).status).toBe("failed");
  });
});

describe("ToolItem.buildStarted (mcpToolCall)", () => {
  it("wraps Read into mcpToolCall with claude-builtin server", () => {
    const itemId = ItemId.fresh();
    const item = ToolItem.buildStarted({
      itemId,
      name: "Read",
      input: { file_path: "/x.ts" },
      cwd: "/tmp",
    });
    expect(item).toMatchObject({
      id: itemId,
      type: "mcpToolCall",
      server: "claude-builtin",
      tool: "Read",
      arguments: { file_path: "/x.ts" },
      status: "inProgress",
    });
  });

  it("wraps unknown tool names into mcpToolCall", () => {
    const itemId = ItemId.fresh();
    const item = ToolItem.buildStarted({
      itemId,
      name: "SomeFutureTool",
      input: { x: 1 },
      cwd: "/tmp",
    });
    expect(item).toMatchObject({
      type: "mcpToolCall",
      tool: "SomeFutureTool",
      arguments: { x: 1 },
    });
  });
});

describe("ToolItem.buildCompleted (mcpToolCall)", () => {
  it("sets result and status:completed on success", () => {
    const itemId = ItemId.fresh();
    const started = ToolItem.buildStarted({
      itemId,
      name: "Read",
      input: { file_path: "/x" },
      cwd: "/tmp",
    });
    const completed = ToolItem.buildCompleted({
      started,
      content: "file contents",
      isError: false,
    });
    expect(completed).toMatchObject({
      type: "mcpToolCall",
      status: "completed",
      result: "file contents",
    });
  });

  it("sets status:failed on is_error", () => {
    const itemId = ItemId.fresh();
    const started = ToolItem.buildStarted({
      itemId,
      name: "Glob",
      input: { pattern: "*.ts" },
      cwd: "/tmp",
    });
    const completed = ToolItem.buildCompleted({
      started,
      content: "not found",
      isError: true,
    });
    expect((completed as { status: string }).status).toBe("failed");
  });
});
