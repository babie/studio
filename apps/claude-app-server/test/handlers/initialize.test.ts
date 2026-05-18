import { describe, expect, it, vi } from "vitest";
import { initializeHandler, initializedHandler } from "../../src/handlers/initialize.js";
import type { HandlerContext } from "../../src/jsonrpc/dispatcher.js";
import { Threads } from "../../src/state/threads.js";

const makeCtx = (): HandlerContext => ({
  sendNotification: vi.fn(),
  cli: {},
  threads: Threads.create(),
  session: { runTurn: vi.fn().mockResolvedValue(undefined) },
});

describe("initializeHandler", () => {
  it("returns userAgent / platformFamily / platformOs", async () => {
    const result = await initializeHandler({}, makeCtx());
    expect(result).toEqual(
      expect.objectContaining({
        userAgent: expect.stringMatching(/^claude-app-server\//),
        platformFamily: expect.any(String),
        platformOs: expect.any(String),
      }),
    );
  });

  it("ignores unknown params (does not throw)", async () => {
    await expect(
      initializeHandler(
        {
          capabilities: { experimentalApi: true },
          clientInfo: { name: "test", title: "Test", version: "0.1.0" },
        },
        makeCtx(),
      ),
    ).resolves.toBeDefined();
  });
});

describe("initializedHandler", () => {
  it("does not throw and returns void", async () => {
    await expect(initializedHandler({}, makeCtx())).resolves.toBeUndefined();
  });
});
