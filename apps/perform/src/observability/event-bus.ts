// apps/conductor/src/observability/event-bus.ts
import { EventEmitter } from "node:events";

export type EventName = "stateChanged";

const DEFAULT_DEBOUNCE_MS = 16;

/** Typed wrapper around Node EventEmitter with a debounce so high-frequency
 *  emit() calls coalesce into one delivery per debounce window. */
export class EventBus {
  private readonly emitter = new EventEmitter();
  private debounceTimer: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;
  private readonly pending = new Set<EventName>();

  constructor(debounceMs: number = DEFAULT_DEBOUNCE_MS) {
    this.debounceMs = debounceMs;
  }

  emit(event: EventName): void {
    this.pending.add(event);
    if (this.debounceTimer != null) return;
    this.debounceTimer = setTimeout(() => {
      const drained = Array.from(this.pending);
      this.pending.clear();
      this.debounceTimer = null;
      for (const e of drained) this.emitter.emit(e);
    }, this.debounceMs);
  }

  on(event: EventName, handler: () => void): () => void {
    this.emitter.on(event, handler);
    return () => this.emitter.off(event, handler);
  }

  /** Cancel any pending debounced emits. Used by Dashboard.stop(). */
  flush(): void {
    if (this.debounceTimer != null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
      this.pending.clear();
    }
  }
}

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;
  describe("observability/event-bus", () => {
    it("coalesces multiple emits within the debounce window", async () => {
      const bus = new EventBus(10);
      let count = 0;
      bus.on("stateChanged", () => { count++; });
      bus.emit("stateChanged");
      bus.emit("stateChanged");
      bus.emit("stateChanged");
      expect(count).toBe(0);
      await new Promise((r) => setTimeout(r, 25));
      expect(count).toBe(1);
    });
    it("off() unsubscribes", async () => {
      const bus = new EventBus(5);
      let count = 0;
      const off = bus.on("stateChanged", () => { count++; });
      off();
      bus.emit("stateChanged");
      await new Promise((r) => setTimeout(r, 15));
      expect(count).toBe(0);
    });
    it("flush cancels pending without firing handler", async () => {
      const bus = new EventBus(50);
      const handler = vi.fn();
      bus.on("stateChanged", handler);
      bus.emit("stateChanged");
      bus.flush();
      await new Promise((r) => setTimeout(r, 70));
      expect(handler).not.toHaveBeenCalled();
    });
  });
}
