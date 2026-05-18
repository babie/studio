import { describe, it, expect } from "vitest";
import { ObservabilityState } from "../../src/observability/state.js";
import { EventBus } from "../../src/observability/event-bus.js";
import { Dashboard } from "../../src/observability/dashboard.js";
import { ANSI } from "../../src/observability/render/format.js";

describe("dashboard lifecycle", () => {
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
  });

  it("re-rendering with same snapshot inside MINIMUM_IDLE_RERENDER_MS is skipped", () => {
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
    const initialWrites = writes.length;
    // No state change; advance clock 200ms (< 1000ms MINIMUM_IDLE_RERENDER_MS).
    clock += 200;
    d.stop();
    // Initial render + cursor-show. No extra mid-frame render.
    expect(writes.length).toBeLessThanOrEqual(initialWrites + 1);
  });
});
