import type { OutgoingNotification } from "../jsonrpc/outgoing-message.js";
import { OutgoingNotification as OutgoingNotificationM } from "../jsonrpc/outgoing-message.js";
import { ItemId, type ItemId as ItemIdT, type ThreadId, type TurnId } from "../util/ids.js";
import type { SdkMessage } from "./sdk-message.js";
import { ToolItem, type StartedItem, type ToolItemType } from "./tool-item.js";
import { assertNever } from "../util/assert-never.js";

export type PendingTool = Readonly<{
  itemId: ItemIdT;
  itemType: ToolItemType;
  startedItem: StartedItem;
}>;

export type MapperState = Readonly<{
  currentAgentMessage?: Readonly<{ itemId: ItemIdT; text: string }>;
  pendingTools: ReadonlyMap<string, PendingTool>;
}>;

export type MapperCtx = Readonly<{
  threadId: ThreadId;
  turnId: TurnId;
  cwd: string;
}>;

export type MapResult = Readonly<{
  state: MapperState;
  notifications: ReadonlyArray<OutgoingNotification>;
}>;

const itemStarted = (
  ctx: MapperCtx,
  item: Readonly<{ id: ItemIdT; type: string; text: string }>,
): OutgoingNotification =>
  OutgoingNotificationM.of("item/started", {
    threadId: ctx.threadId,
    turnId: ctx.turnId,
    item: { id: item.id, type: item.type, text: item.text, status: "inProgress" },
  });

const agentMessageDelta = (ctx: MapperCtx, itemId: ItemIdT, delta: string): OutgoingNotification =>
  OutgoingNotificationM.of("item/agentMessage/delta", {
    threadId: ctx.threadId,
    turnId: ctx.turnId,
    itemId,
    delta,
  });

const itemCompleted = (
  ctx: MapperCtx,
  item: Readonly<{ id: ItemIdT; type: string; text: string }>,
): OutgoingNotification =>
  OutgoingNotificationM.of("item/completed", {
    threadId: ctx.threadId,
    turnId: ctx.turnId,
    item: { id: item.id, type: item.type, text: item.text, status: "completed" },
  });

const closeCurrent = (
  state: MapperState,
  ctx: MapperCtx,
): { state: MapperState; notifications: OutgoingNotification[] } => {
  if (!state.currentAgentMessage) return { state, notifications: [] };
  const closed = itemCompleted(ctx, {
    id: state.currentAgentMessage.itemId,
    type: "agentMessage",
    text: state.currentAgentMessage.text,
  });
  return {
    state: { ...state, currentAgentMessage: undefined },
    notifications: [closed],
  };
};

const openAgentMessage = (
  state: MapperState,
  ctx: MapperCtx,
  text: string,
): { state: MapperState; notifications: OutgoingNotification[] } => {
  const itemId = ItemId.fresh();
  return {
    state: { ...state, currentAgentMessage: { itemId, text } },
    notifications: [
      itemStarted(ctx, { id: itemId, type: "agentMessage", text: "" }),
      agentMessageDelta(ctx, itemId, text),
    ],
  };
};

export type CloseReason = "completed" | "failed" | "interrupted";

const initialState = (): MapperState => ({ pendingTools: new Map() });

const map = (msg: SdkMessage, state: MapperState, ctx: MapperCtx): MapResult => {
  switch (msg.kind) {
    case "SystemInit":
      return { state, notifications: [] };
    case "AssistantText": {
      const closed = closeCurrent(state, ctx);
      const opened = openAgentMessage(closed.state, ctx, msg.text);
      return {
        state: opened.state,
        notifications: [...closed.notifications, ...opened.notifications],
      };
    }
    case "AssistantToolUse": {
      const closed = closeCurrent(state, ctx);
      const itemId = ItemId.fresh();
      const startedItem = ToolItem.buildStarted({
        itemId,
        name: msg.name,
        input: msg.input,
        cwd: ctx.cwd,
      });
      const started = OutgoingNotificationM.of("item/started", {
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        item: startedItem,
      });
      const newPending = new Map(closed.state.pendingTools);
      newPending.set(msg.toolUseId, {
        itemId,
        itemType: startedItem.type,
        startedItem,
      });
      return {
        state: { ...closed.state, pendingTools: newPending },
        notifications: [...closed.notifications, started],
      };
    }
    case "UserToolResult": {
      const pending = state.pendingTools.get(msg.toolUseId);
      if (!pending) return { state, notifications: [] };
      const contentStr = ToolItem.normalizeToolResultContent(msg.content);
      const completedItem = ToolItem.buildCompleted({
        started: pending.startedItem,
        content: contentStr,
        isError: msg.isError,
      });
      const notification = OutgoingNotificationM.of("item/completed", {
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        item: completedItem,
      });
      const newPending = new Map(state.pendingTools);
      newPending.delete(msg.toolUseId);
      return {
        state: { ...state, pendingTools: newPending },
        notifications: [notification],
      };
    }
    case "RateLimit":
      return { state, notifications: [] };
    case "ResultSuccess":
    case "ResultError":
      return { state, notifications: [] };
    case "Unknown":
      return { state, notifications: [] };
    default:
      return assertNever(msg);
  }
};

const closeAll = (state: MapperState, ctx: MapperCtx, reason: CloseReason): MapResult => {
  const notifications: OutgoingNotification[] = [];

  if (state.currentAgentMessage) {
    notifications.push(
      OutgoingNotificationM.of("item/completed", {
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        item: {
          id: state.currentAgentMessage.itemId,
          type: "agentMessage",
          text: state.currentAgentMessage.text,
          status: reason,
        },
      }),
    );
  }

  for (const [, pending] of state.pendingTools) {
    notifications.push(
      OutgoingNotificationM.of("item/completed", {
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        item: { ...pending.startedItem, status: reason },
      }),
    );
  }

  return {
    state: { pendingTools: new Map(), currentAgentMessage: undefined },
    notifications,
  };
};

export const EventMapper = {
  initialState,
  map,
  closeAll,
} as const;
