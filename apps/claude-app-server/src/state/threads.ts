import type { SessionId, ThreadId, TurnId } from "../util/ids.js";
import { ThreadId as ThreadIdM } from "../util/ids.js";

export type ResolvedThreadOptions = Readonly<{
  cwd: string;
  permissionMode: "default" | "acceptEdits" | "bypassPermissions";
  model?: string;
  allowedTools?: ReadonlyArray<string>;
}>;

export type TurnInProgress = Readonly<{
  id: TurnId;
  abort: AbortController;
}>;

export type ThreadState = Readonly<{
  id: ThreadId;
  options: ResolvedThreadOptions;
  sessionId?: SessionId;
  currentTurn?: TurnInProgress;
}>;

export type Threads = Readonly<{
  start: (options: ResolvedThreadOptions) => ThreadState;
  get: (id: ThreadId) => ThreadState | undefined;
  setSessionId: (id: ThreadId, sessionId: SessionId) => void;
  setCurrentTurn: (id: ThreadId, turn: TurnInProgress) => void;
  clearCurrentTurn: (id: ThreadId) => void;
}>;

export const Threads = {
  create: (): Threads => {
    const store = new Map<ThreadId, ThreadState>();

    const update = (id: ThreadId, patch: Partial<ThreadState>) => {
      const existing = store.get(id);
      if (!existing) return;
      store.set(id, { ...existing, ...patch });
    };

    return {
      start: (options) => {
        const state: ThreadState = { id: ThreadIdM.fresh(), options };
        store.set(state.id, state);
        return state;
      },
      get: (id) => store.get(id),
      setSessionId: (id, sessionId) => update(id, { sessionId }),
      setCurrentTurn: (id, turn) => update(id, { currentTurn: turn }),
      clearCurrentTurn: (id) => {
        const existing = store.get(id);
        if (!existing) return;
        const next: ThreadState = {
          id: existing.id,
          options: existing.options,
          sessionId: existing.sessionId,
        };
        store.set(id, next);
      },
    };
  },
} as const;
