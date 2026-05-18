import * as v from "valibot";
import type { ItemId } from "../util/ids.js";

export type ToolItemType = "commandExecution" | "fileChange" | "mcpToolCall";

const dispatch = (name: string): ToolItemType => {
  switch (name) {
    case "Bash":
      return "commandExecution";
    case "Edit":
    case "Write":
    case "MultiEdit":
      return "fileChange";
    default:
      return "mcpToolCall";
  }
};

const normalizeToolResultContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (
        block !== null &&
        typeof block === "object" &&
        "type" in block &&
        (block as { type: unknown }).type === "text" &&
        "text" in block &&
        typeof (block as { text: unknown }).text === "string"
      ) {
        parts.push((block as { text: string }).text);
      } else {
        parts.push(JSON.stringify(block));
      }
    }
    return parts.join("");
  }
  return JSON.stringify(content);
};

const BashInputSchema = v.object({
  command: v.optional(v.string()),
});

const EditInputSchema = v.object({
  file_path: v.string(),
  old_string: v.string(),
  new_string: v.string(),
});

const WriteInputSchema = v.object({
  file_path: v.string(),
  content: v.string(),
});

const MultiEditInputSchema = v.object({
  file_path: v.string(),
  edits: v.array(v.object({ old_string: v.string(), new_string: v.string() })),
});

const buildEditDiff = (oldStr: string, newStr: string): string => `< ${oldStr}\n> ${newStr}`;

export type StartedItem = Readonly<Record<string, unknown>> &
  Readonly<{ id: ItemId; type: ToolItemType; status: "inProgress" }>;

export type CompletedStatus = "completed" | "failed";

export type CompletedItem = Readonly<Record<string, unknown>> &
  Readonly<{ id: ItemId; type: ToolItemType; status: CompletedStatus }>;

const buildFileChangeStarted = (args: {
  itemId: ItemId;
  name: string;
  input: unknown;
}): StartedItem => {
  if (args.name === "Edit") {
    const r = v.safeParse(EditInputSchema, args.input);
    if (!r.success) {
      return {
        id: args.itemId,
        type: "fileChange",
        status: "inProgress",
        changes: [{ path: "", kind: "edit", diff: "" }],
      };
    }
    return {
      id: args.itemId,
      type: "fileChange",
      status: "inProgress",
      changes: [
        {
          path: r.output.file_path,
          kind: "edit",
          diff: buildEditDiff(r.output.old_string, r.output.new_string),
        },
      ],
    };
  }
  if (args.name === "Write") {
    const r = v.safeParse(WriteInputSchema, args.input);
    if (!r.success) {
      return {
        id: args.itemId,
        type: "fileChange",
        status: "inProgress",
        changes: [{ path: "", kind: "create", diff: "" }],
      };
    }
    return {
      id: args.itemId,
      type: "fileChange",
      status: "inProgress",
      changes: [{ path: r.output.file_path, kind: "create", diff: `> ${r.output.content}` }],
    };
  }
  // MultiEdit
  const r = v.safeParse(MultiEditInputSchema, args.input);
  if (!r.success) {
    return {
      id: args.itemId,
      type: "fileChange",
      status: "inProgress",
      changes: [{ path: "", kind: "edit", diff: "" }],
    };
  }
  const diff = r.output.edits.map((e) => buildEditDiff(e.old_string, e.new_string)).join("\n---\n");
  return {
    id: args.itemId,
    type: "fileChange",
    status: "inProgress",
    changes: [{ path: r.output.file_path, kind: "edit", diff }],
  };
};

const buildBashStarted = (args: { itemId: ItemId; input: unknown; cwd: string }): StartedItem => {
  const parsed = v.safeParse(BashInputSchema, args.input);
  const command = parsed.success ? (parsed.output.command ?? "") : "";
  return {
    id: args.itemId,
    type: "commandExecution",
    command: ["bash", "-c", command],
    cwd: args.cwd,
    status: "inProgress",
    commandActions: [],
    aggregatedOutput: "",
    exitCode: null,
    durationMs: null,
  };
};

export type BuildStartedArgs = Readonly<{
  itemId: ItemId;
  name: string;
  input: unknown;
  cwd: string;
}>;

const buildStarted = (args: BuildStartedArgs): StartedItem => {
  const itemType = dispatch(args.name);
  switch (itemType) {
    case "commandExecution":
      return buildBashStarted({ itemId: args.itemId, input: args.input, cwd: args.cwd });
    case "fileChange":
      return buildFileChangeStarted({ itemId: args.itemId, name: args.name, input: args.input });
    case "mcpToolCall":
      return {
        id: args.itemId,
        type: "mcpToolCall",
        server: "claude-builtin",
        tool: args.name,
        arguments: args.input,
        status: "inProgress",
      };
  }
};

const buildBashCompleted = (
  started: StartedItem,
  content: string,
  isError: boolean,
): CompletedItem => ({
  ...started,
  status: isError ? "failed" : "completed",
  aggregatedOutput: content,
});

export type BuildCompletedArgs = Readonly<{
  started: StartedItem;
  content: string;
  isError: boolean;
}>;

const buildCompleted = (args: BuildCompletedArgs): CompletedItem => {
  switch (args.started.type) {
    case "commandExecution":
      return buildBashCompleted(args.started, args.content, args.isError);
    case "fileChange":
      return { ...args.started, status: args.isError ? "failed" : "completed" };
    case "mcpToolCall":
      return {
        ...args.started,
        status: args.isError ? "failed" : "completed",
        result: args.content,
      };
  }
};

export const ToolItem = {
  dispatch,
  normalizeToolResultContent,
  buildStarted,
  buildCompleted,
} as const;
