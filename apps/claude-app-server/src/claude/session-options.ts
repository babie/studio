import type { CanUseTool, Options as SdkQueryOptions } from "@anthropic-ai/claude-agent-sdk";
import type { ServerOptions } from "../server.js";
import type { ResolvedThreadOptions } from "../state/threads.js";
import type { SessionId } from "../util/ids.js";

export type ThreadStartParams = Readonly<{
  cwd?: string;
  model?: string;
  sandboxPolicy?: Readonly<{ type?: string }>;
  // それ以外のフィールドは無視 (Symphony からの不明フィールド)
  [k: string]: unknown;
}>;

const sandboxToPermission = (
  type: string | undefined,
): ResolvedThreadOptions["permissionMode"] | undefined => {
  switch (type) {
    case "dangerFullAccess":
      return "bypassPermissions";
    case "workspaceWrite":
      return "acceptEdits";
    case "readOnly":
      return "default";
    default:
      return undefined;
  }
};

export const resolveThreadOptions = (args: {
  cli: ServerOptions;
  params: ThreadStartParams;
}): ResolvedThreadOptions => {
  const fromSandbox = sandboxToPermission(args.params.sandboxPolicy?.type);
  const permissionMode = fromSandbox ?? args.cli.permissionMode ?? "default";
  return {
    cwd: args.params.cwd ?? process.cwd(),
    permissionMode,
    model: args.params.model ?? args.cli.model,
    allowedTools: args.cli.allowedTools,
  };
};

const allowAll: CanUseTool = async (_tool, input) => ({
  behavior: "allow",
  updatedInput: input,
});

export type SdkOptions = SdkQueryOptions & Readonly<{ canUseTool: CanUseTool }>;

export const toSdkOptions = (args: {
  thread: ResolvedThreadOptions;
  resume?: SessionId;
  abortController: AbortController;
}): SdkOptions => {
  const out: SdkOptions = {
    cwd: args.thread.cwd,
    permissionMode: args.thread.permissionMode,
    abortController: args.abortController,
    canUseTool: allowAll,
    ...(args.thread.model ? { model: args.thread.model } : {}),
    ...(args.thread.allowedTools ? { allowedTools: [...args.thread.allowedTools] } : {}),
    ...(args.resume ? { resume: args.resume } : {}),
  };
  return out;
};
