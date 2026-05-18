// apps/perform/src/observability/state.ts
import {
  type ObservabilityData,
  type ObservabilitySnapshot,
  type RunningEntry,
  type RetryEntry,
  type CodexTotals,
  type RateLimits,
  type PollingState,
  EMPTY_CODEX_TOTALS,
} from "../domain/observability-snapshot.js";
import type { ObservabilityHooks, TurnEvent } from "./instrumentation.js";

const MESSAGE_PREVIEW_MAX = 100;

const previewMessage = (text: string): string =>
  text.length > MESSAGE_PREVIEW_MAX ? text.slice(0, MESSAGE_PREVIEW_MAX) + "…" : text;

export interface EventBusEmitter {
  emit(event: "stateChanged"): void;
}

export class ObservabilityState implements ObservabilityHooks {
  private running = new Map<string, RunningEntry>();
  private retrying = new Map<string, RetryEntry>();
  private codexTotals: CodexTotals = { ...EMPTY_CODEX_TOTALS };
  private startTimeMs: number | null = null;
  private rateLimits: RateLimits | null = null;
  private polling: PollingState = { checking: false, nextPollInMs: null, pollIntervalMs: 5_000 };
  private bus: EventBusEmitter | null = null;

  attachBus(bus: EventBusEmitter): void {
    this.bus = bus;
  }

  getSnapshot(now: number = Date.now()): ObservabilitySnapshot {
    const running: RunningEntry[] = [];
    for (const e of this.running.values()) {
      running.push({ ...e, runtimeSeconds: Math.floor((now - e.startedAt.getTime()) / 1000) });
    }
    const totals: CodexTotals = {
      ...this.codexTotals,
      secondsRunning:
        this.startTimeMs == null ? 0 : Math.floor((now - this.startTimeMs) / 1000),
    };
    const data: ObservabilityData = {
      running, retrying: [...this.retrying.values()],
      codexTotals: totals, rateLimits: this.rateLimits, polling: this.polling,
    };
    return { type: "ok", data };
  }

  // ─── ObservabilityHooks ───

  onIssueStart(
    issueId: string, identifier: string, state: string,
    pid: number | null, workspacePath: string | null,
  ): void {
    const now = new Date();
    if (this.startTimeMs == null) this.startTimeMs = now.getTime();
    const existing = this.running.get(issueId);
    const entry: RunningEntry = {
      issueId, identifier, state,
      workerHost: null, workspacePath,
      sessionId: existing?.sessionId ?? null,
      codexAppServerPid: pid ?? existing?.codexAppServerPid ?? null,
      codexInputTokens: existing?.codexInputTokens ?? 0,
      codexOutputTokens: existing?.codexOutputTokens ?? 0,
      codexTotalTokens: existing?.codexTotalTokens ?? 0,
      turnCount: existing?.turnCount ?? 0,
      startedAt: existing?.startedAt ?? now,
      lastCodexTimestamp: existing?.lastCodexTimestamp ?? null,
      lastCodexMessage: existing?.lastCodexMessage ?? null,
      lastCodexEvent: existing?.lastCodexEvent ?? null,
      runtimeSeconds: existing?.runtimeSeconds ?? 0,
    };
    this.running.set(issueId, entry);
    this.bus?.emit("stateChanged");
  }

  onIssueEnd(issueId: string): void {
    this.running.delete(issueId);
    this.retrying.delete(issueId);
    this.bus?.emit("stateChanged");
  }

  onTurnEvent(issueId: string, event: TurnEvent): void {
    const entry = this.running.get(issueId);
    if (!entry) return;
    const now = new Date();
    let next: RunningEntry = { ...entry, lastCodexTimestamp: now };
    switch (event.kind) {
      case "thread-started":
        next = { ...next, sessionId: event.sessionId, lastCodexEvent: "thread started" };
        break;
      case "turn-started":
        next = { ...next, turnCount: next.turnCount + 1, lastCodexEvent: "turn started" };
        break;
      case "item-started":
        next = { ...next, lastCodexEvent: event.itemType };
        break;
      case "agent-message":
        next = { ...next, lastCodexMessage: previewMessage(event.text), lastCodexEvent: "agent message" };
        break;
      case "command-execution":
        next = { ...next, lastCodexEvent: `cmd: ${event.command}` };
        break;
      case "file-change":
        next = { ...next, lastCodexEvent: `edit: ${event.path}` };
        break;
      case "item-completed":
        next = { ...next, lastCodexEvent: "item done" };
        break;
      case "turn-completed":
        if (event.usage) {
          next = {
            ...next,
            codexInputTokens: next.codexInputTokens + event.usage.inputTokens,
            codexOutputTokens: next.codexOutputTokens + event.usage.outputTokens,
            codexTotalTokens: next.codexTotalTokens + event.usage.totalTokens,
          };
          this.codexTotals = {
            inputTokens: this.codexTotals.inputTokens + event.usage.inputTokens,
            outputTokens: this.codexTotals.outputTokens + event.usage.outputTokens,
            totalTokens: this.codexTotals.totalTokens + event.usage.totalTokens,
            secondsRunning: this.codexTotals.secondsRunning,
          };
        }
        next = { ...next, lastCodexEvent: "turn done" };
        break;
    }
    this.running.set(issueId, next);
    this.bus?.emit("stateChanged");
  }

  onRetryScheduled(issueId: string, attempt: number, dueAtMs: number, error: string | null): void {
    const existing = this.retrying.get(issueId);
    const identifier = existing?.identifier ?? this.running.get(issueId)?.identifier ?? null;
    this.retrying.set(issueId, {
      issueId, attempt, dueInMs: Math.max(0, dueAtMs - Date.now()),
      identifier, error,
      workerHost: null,
      workspacePath: this.running.get(issueId)?.workspacePath ?? null,
    });
    this.bus?.emit("stateChanged");
  }

  onRetryComplete(issueId: string): void {
    this.retrying.delete(issueId);
    this.bus?.emit("stateChanged");
  }

  onRateLimitObserved(rateLimits: RateLimits): void {
    this.rateLimits = rateLimits;
    this.bus?.emit("stateChanged");
  }

  onPollingTick(nextPollInMs: number | null, intervalMs: number, checking: boolean): void {
    this.polling = { checking, nextPollInMs, pollIntervalMs: intervalMs };
    this.bus?.emit("stateChanged");
  }
}

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("observability/state", () => {
    it("onIssueStart/onIssueEnd adds/removes a running entry", () => {
      const s = new ObservabilityState();
      s.onIssueStart("id1", "M-1", "Todo", 12345, "/tmp/x");
      let snap = s.getSnapshot();
      expect(snap.type).toBe("ok");
      if (snap.type !== "ok") return;
      expect(snap.data.running.length).toBe(1);
      s.onIssueEnd("id1");
      snap = s.getSnapshot();
      if (snap.type !== "ok") return;
      expect(snap.data.running.length).toBe(0);
    });
    it("turn-completed with usage adds to per-entry and global totals", () => {
      const s = new ObservabilityState();
      s.onIssueStart("id1", "M-1", "Todo", 1, "/tmp/x");
      s.onTurnEvent("id1", { kind: "turn-completed", usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } });
      const snap = s.getSnapshot();
      if (snap.type !== "ok") return;
      expect(snap.data.codexTotals.totalTokens).toBe(150);
      expect(snap.data.running[0]!.codexTotalTokens).toBe(150);
    });
    it("turn-completed without usage leaves tokens at 0 (claude path)", () => {
      const s = new ObservabilityState();
      s.onIssueStart("id1", "M-1", "Todo", 1, "/tmp/x");
      s.onTurnEvent("id1", { kind: "turn-completed" });
      const snap = s.getSnapshot();
      if (snap.type !== "ok") return;
      expect(snap.data.codexTotals.totalTokens).toBe(0);
    });
    it("agent-message truncates preview to 100 + …", () => {
      const s = new ObservabilityState();
      s.onIssueStart("id1", "M-1", "Todo", 1, "/tmp/x");
      const long = "x".repeat(150);
      s.onTurnEvent("id1", { kind: "agent-message", text: long });
      const snap = s.getSnapshot();
      if (snap.type !== "ok") return;
      expect(snap.data.running[0]!.lastCodexMessage!.endsWith("…")).toBe(true);
      expect(snap.data.running[0]!.lastCodexMessage!.length).toBe(101);
    });
    it("emits stateChanged when bus is attached", () => {
      const events: string[] = [];
      const bus = { emit: (e: "stateChanged") => events.push(e) };
      const s = new ObservabilityState();
      s.attachBus(bus);
      s.onIssueStart("id1", "M-1", "Todo", 1, "/tmp/x");
      expect(events.length).toBeGreaterThan(0);
    });
  });
}
