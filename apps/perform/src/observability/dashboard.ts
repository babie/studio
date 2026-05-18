// apps/conductor/src/observability/dashboard.ts
import type { ObservabilityState } from "./state.js";
import type { EventBus } from "./event-bus.js";
import { formatSnapshot, type FormatRuntimeContext } from "./render/snapshot.js";
import { ANSI } from "./render/format.js";
import {
  MINIMUM_IDLE_RERENDER_MS,
  THROUGHPUT_WINDOW_MS,
  THROUGHPUT_GRAPH_WINDOW_MS,
  DEFAULT_TERMINAL_COLUMNS,
} from "./runtime-config.js";
import {
  type TokenSample,
  throttledTps,
  updateTokenSamples,
} from "./render/sparkline.js";

export type DashboardOptions = Readonly<{
  state: ObservabilityState;
  bus: EventBus;
  refreshMs: number;
  renderIntervalMs: number;
  runtimeContext: FormatRuntimeContext;
  renderFn?: (content: string) => void;
  getTerminalColumns?: () => number;
  now?: () => number;
}>;

const totalTokens = (snap: ReturnType<ObservabilityState["getSnapshot"]>): number =>
  snap.type === "ok" ? snap.data.codexTotals.totalTokens : 0;

export class Dashboard {
  private readonly opts: DashboardOptions;
  private readonly renderFn: (s: string) => void;
  private readonly getTerminalColumns: () => number;
  private readonly now: () => number;
  private tickTimer: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private tokenSamples: ReadonlyArray<TokenSample> = [];
  private lastTpsSecond: number | null = null;
  private lastTpsValue: number | null = null;
  private lastRenderedContent: string | null = null;
  private lastRenderedAtMs: number | null = null;
  private pendingContent: string | null = null;
  private lastSnapshotFingerprint: string | null = null;
  private busOff: (() => void) | null = null;
  private running = false;

  constructor(opts: DashboardOptions) {
    this.opts = opts;
    this.renderFn = opts.renderFn ?? ((s) => process.stdout.write(s));
    this.getTerminalColumns =
      opts.getTerminalColumns ?? (() => process.stdout.columns ?? DEFAULT_TERMINAL_COLUMNS);
    this.now = opts.now ?? Date.now;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.renderFn(ANSI.cursorHide);
    this.renderNow();
    this.tickTimer = setInterval(() => this.renderNow(), this.opts.refreshMs);
    this.busOff = this.opts.bus.on("stateChanged", () => this.renderNow());
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.busOff) { this.busOff(); this.busOff = null; }
    this.opts.bus.flush();
    if (this.pendingContent != null) this.writeRender(this.pendingContent, this.now());
    this.renderFn(ANSI.cursorShow + "\n");
  }

  private renderNow(): void {
    const now = this.now();
    const snapshot = this.opts.state.getSnapshot(now);
    const currentTokens = totalTokens(snapshot);
    this.tokenSamples = updateTokenSamples(
      this.tokenSamples, now, currentTokens, THROUGHPUT_WINDOW_MS, THROUGHPUT_GRAPH_WINDOW_MS,
    );
    const { second, value: tps } = throttledTps(
      this.lastTpsSecond, this.lastTpsValue, now, this.tokenSamples, currentTokens, THROUGHPUT_WINDOW_MS,
    );
    this.lastTpsSecond = second;
    this.lastTpsValue = tps;
    const fingerprint = JSON.stringify(snapshot);
    const idleRerender =
      this.lastRenderedAtMs != null && now - this.lastRenderedAtMs >= MINIMUM_IDLE_RERENDER_MS;
    if (fingerprint === this.lastSnapshotFingerprint && !idleRerender) return;
    this.lastSnapshotFingerprint = fingerprint;
    const content = formatSnapshot(snapshot, tps, this.getTerminalColumns(), this.opts.runtimeContext);
    this.enqueueRender(content, now);
  }

  private enqueueRender(content: string, now: number): void {
    if (content === this.lastRenderedContent) return;
    if (this.canRenderNow(now)) {
      this.writeRender(content, now);
    } else {
      this.pendingContent = content;
      this.scheduleFlush(now);
    }
  }

  private canRenderNow(now: number): boolean {
    if (this.lastRenderedAtMs == null) return true;
    return now - this.lastRenderedAtMs >= this.opts.renderIntervalMs;
  }

  private scheduleFlush(now: number): void {
    if (this.flushTimer != null) return;
    const since = this.lastRenderedAtMs == null ? this.opts.renderIntervalMs : now - this.lastRenderedAtMs;
    const delay = Math.max(1, this.opts.renderIntervalMs - since);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.pendingContent != null) {
        this.writeRender(this.pendingContent, this.now());
      }
    }, delay);
  }

  private writeRender(content: string, now: number): void {
    this.renderFn(ANSI.clearAndHome + content + "\n");
    this.lastRenderedContent = content;
    this.lastRenderedAtMs = now;
    this.pendingContent = null;
  }
}

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  const { ObservabilityState } = await import("./state.js");
  const { EventBus } = await import("./event-bus.js");
  describe("observability/dashboard", () => {
    it("start writes cursor hide + initial frame, stop writes cursor show + newline", () => {
      const writes: string[] = [];
      const state = new ObservabilityState();
      const bus = new EventBus(2);
      state.attachBus(bus);
      const d = new Dashboard({
        state, bus, refreshMs: 1000, renderIntervalMs: 16,
        runtimeContext: { projectLink: { kind: "memory" }, maxAgents: 2 },
        renderFn: (s) => writes.push(s),
        getTerminalColumns: () => 115,
        now: () => 1_000_000,
      });
      d.start();
      d.stop();
      expect(writes[0]).toBe(ANSI.cursorHide);
      expect(writes[writes.length - 1]).toBe(ANSI.cursorShow + "\n");
      expect(writes.some((w) => w.includes("PERFORM STATUS"))).toBe(true);
    });
    it("skips duplicate render when fingerprint matches and not idle", () => {
      const writes: string[] = [];
      const state = new ObservabilityState();
      const bus = new EventBus(2);
      state.attachBus(bus);
      let clock = 1_000_000;
      const d = new Dashboard({
        state, bus, refreshMs: 1000, renderIntervalMs: 16,
        runtimeContext: { projectLink: { kind: "memory" }, maxAgents: 2 },
        renderFn: (s) => writes.push(s),
        getTerminalColumns: () => 115,
        now: () => clock,
      });
      d.start();
      const initialWriteCount = writes.length;
      // No state change, advance clock 100ms (< MINIMUM_IDLE_RERENDER_MS=1000)
      clock += 100;
      d.stop();
      // Should be at most: initial frame (cursor hide + 1 write) + final flush (1 cursor show). No mid-frame render.
      expect(writes.length).toBeLessThanOrEqual(initialWriteCount + 1);
    });
  });
}
