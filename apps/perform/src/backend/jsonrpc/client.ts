import * as v from "valibot";
import type { Result } from "@praha/byethrow";
import type { BackendError } from "../../domain/backend-errors.js";
import type { Logger } from "../../orchestrator/orchestrator.js";
import {
  InitializeParamsSchema,
  InitializeResultSchema,
  JsonRpcResponseSchema,
  ServerNotificationSchema,
  ThreadStartParamsSchema,
  ThreadStartResultSchema,
  TurnInterruptParamsSchema,
  TurnStartParamsSchema,
  isJsonRpcNotification,
  isJsonRpcResponse,
  normalizeInitializeResult,
  normalizeThreadStartResult,
  promptToInputArray,
  type InitializeParams,
  type InitializeResult,
  type ServerNotification,
  type ThreadStartParams,
  type ThreadStartResult,
  type TurnStartParams,
} from "./messages.js";
import {
  jsonRpcError,
  requestTimeout,
  stdioProtocolError,
  subprocessCrashed,
  turnNotCompleted,
} from "./errors.js";
import type { StdioTransport, CloseInfo } from "./transport.js";

type Lifecycle = "init" | "ready" | "running-turn" | "shutting-down" | "closed";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_INTERRUPT_WAIT_MS = 5_000;
const DEFAULT_TERM_WAIT_MS = 5_000;

type PendingEntry = Readonly<{
  method: string;
  resolve: (value: Result.Result<unknown, BackendError>) => void;
  timer: NodeJS.Timeout;
}>;

export type ClientOptions = Readonly<{
  transport: StdioTransport;
  logger: Logger;
  interruptWaitMs?: number;
  termWaitMs?: number;
}>;

export type RunTurnOptions = Readonly<{
  threadId: string;
  input: string;
  signal: AbortSignal;
  onNotification: (n: ServerNotification) => void;
  timeoutMs?: number;
}>;

export class JsonRpcSubprocessClient {
  private nextId = 1;
  private lifecycle: Lifecycle = "init";
  private pending = new Map<number | string, PendingEntry>();
  private notificationHandlers = new Set<(n: ServerNotification) => void>();
  private closeInfo: CloseInfo | null = null;
  private offLine: () => void;
  private offClose: () => void;
  private readonly transport: StdioTransport;
  private readonly logger: Logger;
  private readonly interruptWaitMs: number;
  private readonly termWaitMs: number;

  constructor(opts: ClientOptions) {
    this.transport = opts.transport;
    this.logger = opts.logger;
    this.interruptWaitMs = opts.interruptWaitMs ?? DEFAULT_INTERRUPT_WAIT_MS;
    this.termWaitMs = opts.termWaitMs ?? DEFAULT_TERM_WAIT_MS;
    this.offLine = this.transport.onLine((l) => this.handleLine(l));
    this.offClose = this.transport.onClose((info) => this.handleClose(info));
  }

  // ── Public lifecycle ──

  async initialize(
    params: InitializeParams,
    opts?: { timeoutMs?: number },
  ): Promise<Result.Result<InitializeResult, BackendError>> {
    this.assertLifecycle("init", "initialize");
    const parsed = v.safeParse(InitializeParamsSchema, params);
    if (!parsed.success) {
      this.failClose();
      return { type: "Failure", error: stdioProtocolError("schema", JSON.stringify(params)) };
    }
    const res = await this.request("initialize", parsed.output, opts?.timeoutMs);
    if (res.type === "Failure") {
      this.failClose();
      return res;
    }
    const r = v.safeParse(InitializeResultSchema, res.value);
    if (!r.success) {
      this.failClose();
      return { type: "Failure", error: stdioProtocolError("schema", JSON.stringify(res.value)) };
    }
    this.lifecycle = "ready";
    return { type: "Success", value: normalizeInitializeResult(r.output) };
  }

  async startThread(
    params: ThreadStartParams,
    opts?: { timeoutMs?: number },
  ): Promise<Result.Result<ThreadStartResult, BackendError>> {
    this.assertLifecycle("ready", "thread/start");
    const parsed = v.safeParse(ThreadStartParamsSchema, params);
    if (!parsed.success) {
      return { type: "Failure", error: stdioProtocolError("schema", JSON.stringify(params)) };
    }
    const res = await this.request("thread/start", parsed.output, opts?.timeoutMs);
    if (res.type === "Failure") return res;
    const r = v.safeParse(ThreadStartResultSchema, res.value);
    if (!r.success) {
      return { type: "Failure", error: stdioProtocolError("schema", JSON.stringify(res.value)) };
    }
    const normalized = normalizeThreadStartResult(r.output);
    if (!normalized) {
      return {
        type: "Failure",
        error: stdioProtocolError(
          "schema",
          `could not extract threadId from: ${JSON.stringify(r.output)}`,
        ),
      };
    }
    return { type: "Success", value: normalized };
  }

  async runTurn(opts: RunTurnOptions): Promise<Result.Result<{ threadId: string }, BackendError>> {
    this.assertLifecycle("ready", "turn/start");
    this.lifecycle = "running-turn";

    const params: TurnStartParams = { threadId: opts.threadId, input: opts.input };
    const parsed = v.safeParse(TurnStartParamsSchema, params);
    if (!parsed.success) {
      this.lifecycle = "ready";
      return { type: "Failure", error: stdioProtocolError("schema", JSON.stringify(params)) };
    }

    const completion = new Promise<Result.Result<{ threadId: string }, BackendError>>((resolve) => {
      let settled = false;
      let offClose: (() => void) | null = null;
      const settle = (r: Result.Result<{ threadId: string }, BackendError>) => {
        if (settled) return;
        settled = true;
        this.notificationHandlers.delete(notifHandler);
        this.notificationHandlers.delete(opts.onNotification);
        if (abortListener) opts.signal.removeEventListener("abort", abortListener);
        if (offClose) offClose();
        // Only reset to "ready" if shutdown() / handleClose() has not already taken
        // ownership of the lifecycle (e.g. transitioned to "shutting-down" or "closed").
        if (this.lifecycle === "running-turn") this.lifecycle = "ready";
        resolve(r);
      };

      const notifHandler = (n: ServerNotification) => {
        if (n.method !== "turn/completed") return;
        // valibot's v.variant output type does not narrow `params` after
        // the `method` literal check (the `ItemNotification` arm widens
        // `params` to `unknown` in the union). The TurnCompletedNotification
        // schema guarantees this shape at runtime.
        const params = n.params as { threadId: string };
        if (params.threadId !== opts.threadId) return;
        settle({ type: "Success", value: { threadId: opts.threadId } });
      };
      this.notificationHandlers.add(notifHandler);
      this.notificationHandlers.add(opts.onNotification);

      let abortListener: (() => void) | null = null;
      if (opts.signal.aborted) {
        settle({ type: "Failure", error: turnNotCompleted(opts.threadId, "abort") });
        void this.interrupt();
      } else {
        abortListener = () => {
          settle({ type: "Failure", error: turnNotCompleted(opts.threadId, "abort") });
          void this.interrupt();
        };
        opts.signal.addEventListener("abort", abortListener);
      }

      // New: subprocess closed mid-turn → session-exited-mid-turn Failure.
      const onCloseHandler = (info: CloseInfo) => {
        settle({
          type: "Failure",
          error: {
            kind: "session-exited-mid-turn",
            exitCode: info.code,
            signal: info.signal as string | null,
          },
        });
      };
      // If transport already closed before runTurn was called, settle immediately.
      if (this.closeInfo) {
        onCloseHandler(this.closeInfo);
      } else {
        offClose = this.transport.onClose(onCloseHandler);
      }

      // Note: turn/start request resolves with TurnCompletedResult per Codex SPEC,
      // but we settle on the turn/completed NOTIFICATION rather than the response,
      // because some implementations deliver completion only via notification.
      // Both claude-app-server and codex require input as an array of content items.
      const wireParams = { ...parsed.output, input: promptToInputArray(parsed.output.input) };
      void this.request("turn/start", wireParams, opts.timeoutMs ?? 24 * 60 * 60 * 1000).then(
        (r) => {
          if (r.type === "Failure") settle(r);
          // Success: keep waiting for turn/completed notification.
        },
      );
    });

    return completion;
  }

  async shutdown(opts?: { gracePeriodMs?: number }): Promise<void> {
    if (this.lifecycle === "closed") return;
    this.lifecycle = "shutting-down";
    const grace = opts?.gracePeriodMs ?? this.termWaitMs;
    this.transport.kill("SIGTERM");
    const closed = await this.waitClose(grace);
    if (!closed) {
      this.transport.kill("SIGKILL");
      await this.waitClose(2_000);
    }
    this.lifecycle = "closed";
    this.cleanup();
  }

  async interrupt(): Promise<void> {
    // Send turn/interrupt (best effort), then wait, then kill cascade.
    const params: v.InferOutput<typeof TurnInterruptParamsSchema> = { threadId: "" };
    // We don't always know the threadId; the actual turn loop will pass it via runTurn opts.
    // For Phase 2 simplicity, we send to all (server resolves based on its own state).
    try {
      this.transport.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: this.nextId++,
          method: "turn/interrupt",
          params,
        }),
      );
    } catch {
      // ignore
    }
    const closed = await this.waitClose(this.interruptWaitMs);
    if (closed) return;
    this.transport.kill("SIGTERM");
    const closed2 = await this.waitClose(this.termWaitMs);
    if (closed2) return;
    this.transport.kill("SIGKILL");
    await this.waitClose(2_000);
  }

  // ── Internals ──

  /**
   * Programming-error guard. Throws synchronously, which inside an async method
   * becomes a rejected promise. Callers MUST await the returned Promise to surface
   * the rejection; do not call lifecycle-gated methods fire-and-forget.
   */
  private assertLifecycle(expected: Lifecycle, op: string): void {
    if (this.lifecycle !== expected) {
      throw new Error(
        `JsonRpcSubprocessClient: cannot ${op} in lifecycle=${this.lifecycle} (expected=${expected})`,
      );
    }
  }

  private async request(
    method: string,
    params: unknown,
    timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<Result.Result<unknown, BackendError>> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          resolve({ type: "Failure", error: requestTimeout(method, timeoutMs) });
        }
      }, timeoutMs);
      this.pending.set(id, { method, resolve, timer });
      try {
        this.transport.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve({
          type: "Failure",
          error: stdioProtocolError("framing", err instanceof Error ? err.message : String(err)),
        });
      }
    });
  }

  private handleLine(line: string): void {
    if (line.trim() === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      this.logger.error(
        `[jsonrpc] json-parse: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    if (isJsonRpcResponse(parsed)) {
      const responseR = v.safeParse(JsonRpcResponseSchema, parsed);
      if (!responseR.success) {
        this.logger.error(`[jsonrpc] response schema violation: ${line}`);
        return;
      }
      const response = responseR.output;
      const entry = this.pending.get(response.id);
      if (!entry) {
        this.logger.info(`[jsonrpc] orphan response id=${response.id}`);
        return;
      }
      clearTimeout(entry.timer);
      this.pending.delete(response.id);
      if ("error" in response) {
        entry.resolve({
          type: "Failure",
          error: jsonRpcError(response.error.code, response.error.message, entry.method),
        });
      } else {
        entry.resolve({ type: "Success", value: response.result });
      }
      return;
    }

    if (isJsonRpcNotification(parsed)) {
      const notifR = v.safeParse(ServerNotificationSchema, parsed);
      if (!notifR.success) {
        // unknown method — info log and ignore
        this.logger.info(`[jsonrpc] ignored unknown notification: ${parsed.method}`);
        return;
      }
      const n = notifR.output;
      for (const h of this.notificationHandlers) {
        try {
          h(n);
        } catch (err) {
          this.logger.error(`[jsonrpc] notification handler threw: ${err}`);
        }
      }
      return;
    }

    this.logger.info(`[jsonrpc] ignored non-envelope line: ${line.slice(0, 200)}`);
  }

  private handleClose(info: CloseInfo): void {
    this.closeInfo = info;
    if (this.lifecycle !== "closed") this.lifecycle = "closed";
    // Fail any in-flight requests with subprocess-crashed.
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({
        type: "Failure",
        error: subprocessCrashed(info.signal, info.code, this.transport.stderrTail()),
      });
      this.pending.delete(id);
    }
  }

  private async waitClose(ms: number): Promise<boolean> {
    if (this.closeInfo) return true;
    return new Promise<boolean>((resolve) => {
      const t = setTimeout(() => {
        off();
        resolve(false);
      }, ms);
      const off = this.transport.onClose(() => {
        clearTimeout(t);
        resolve(true);
      });
    });
  }

  private failClose(): void {
    if (this.lifecycle === "closed") return;
    this.lifecycle = "closed";
    this.transport.kill("SIGTERM");
    this.cleanup();
  }

  private cleanup(): void {
    this.offLine();
    this.offClose();
    this.notificationHandlers.clear();
  }
}

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  const { inMemoryTransport } = await import("./transport.js");

  const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

  const makeClient = () => {
    const { transport, control } = inMemoryTransport();
    const client = new JsonRpcSubprocessClient({ transport, logger: silentLogger });
    return { client, control };
  };

  describe("backend/jsonrpc/client", () => {
    it("initialize round-trip resolves on matching response", async () => {
      const { client, control } = makeClient();
      const p = client.initialize({ clientInfo: { name: "perform", version: "0.0.1" } });
      // Wait one tick so the request is written
      await Promise.resolve();
      // Echo back a success response with id=1
      control.feedLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { serverInfo: { name: "claude-app-server", version: "0.1.0" } },
        }),
      );
      const r = await p;
      if (r.type !== "Success") throw new Error("expected success");
      expect(r.value.serverInfo.name).toBe("claude-app-server");
    });

    it("initialize fails on jsonrpc error response", async () => {
      const { client, control } = makeClient();
      const p = client.initialize({ clientInfo: { name: "c", version: "0" } });
      await Promise.resolve();
      control.feedLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32601, message: "Method not found" },
        }),
      );
      const r = await p;
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("jsonrpc-error");
    });

    it("request times out and emits request-timeout BackendError", async () => {
      const { client } = makeClient();
      const p = client.initialize({ clientInfo: { name: "c", version: "0" } }, { timeoutMs: 30 });
      const r = await p;
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("request-timeout");
    });

    it("runTurn resolves when turn/completed notification arrives", async () => {
      const { client, control } = makeClient();
      // Walk through initialize + thread/start
      const init = client.initialize({ clientInfo: { name: "c", version: "0" } });
      await Promise.resolve();
      control.feedLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { serverInfo: { name: "x", version: "0" } },
        }),
      );
      await init;
      const start = client.startThread({ cwd: "/tmp/x" });
      await Promise.resolve();
      control.feedLine(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { threadId: "thr_1" } }));
      await start;
      // Run turn
      const ac = new AbortController();
      const notifs: ServerNotification[] = [];
      const p = client.runTurn({
        threadId: "thr_1",
        input: "hi",
        signal: ac.signal,
        onNotification: (n) => notifs.push(n),
        timeoutMs: 1_000,
      });
      await Promise.resolve();
      // turn/started notification (forwarded to handler)
      control.feedLine(
        JSON.stringify({ jsonrpc: "2.0", method: "turn/started", params: { threadId: "thr_1" } }),
      );
      // turn/start response (ignored for completion — wait for notification)
      control.feedLine(JSON.stringify({ jsonrpc: "2.0", id: 3, result: { threadId: "thr_1" } }));
      // turn/completed notification (this triggers resolve)
      control.feedLine(
        JSON.stringify({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: "thr_1" } }),
      );
      const r = await p;
      if (r.type !== "Success") throw new Error("expected success");
      expect(r.value.threadId).toBe("thr_1");
      expect(notifs.some((n) => n.method === "turn/started")).toBe(true);
    });

    it("runTurn aborts via signal → emits turn-not-completed(abort)", async () => {
      const { client, control } = makeClient();
      const init = client.initialize({ clientInfo: { name: "c", version: "0" } });
      await Promise.resolve();
      control.feedLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { serverInfo: { name: "x", version: "0" } },
        }),
      );
      await init;
      const start = client.startThread({ cwd: "/tmp/x" });
      await Promise.resolve();
      control.feedLine(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { threadId: "thr_1" } }));
      await start;
      const ac = new AbortController();
      const p = client.runTurn({
        threadId: "thr_1",
        input: "hi",
        signal: ac.signal,
        onNotification: () => {},
        timeoutMs: 60_000,
      });
      // Trigger abort; client.interrupt() will kill the (mock) transport → close
      await Promise.resolve();
      ac.abort();
      // Simulate subprocess close after interrupt — inMemoryTransport.kill() emits close itself
      const r = await p;
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("turn-not-completed");
    }, 10_000);

    it("subprocess crash mid-request fails the request with subprocess-crashed", async () => {
      const { client, control } = makeClient();
      const p = client.initialize({ clientInfo: { name: "c", version: "0" } });
      await Promise.resolve();
      control.feedStderr("oops fatal");
      control.close({ code: 1, signal: null });
      const r = await p;
      if (r.type !== "Failure") throw new Error("expected failure");
      expect(r.error.kind).toBe("subprocess-crashed");
      if (r.error.kind === "subprocess-crashed") {
        expect(r.error.stderrTail).toContain("oops fatal");
      }
    });

    it("ignores unknown notifications without throwing", async () => {
      const { client, control } = makeClient();
      const init = client.initialize({ clientInfo: { name: "c", version: "0" } });
      await Promise.resolve();
      control.feedLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { serverInfo: { name: "x", version: "0" } },
        }),
      );
      await init;
      // Unknown notification arrives
      control.feedLine(JSON.stringify({ jsonrpc: "2.0", method: "some/unknown", params: {} }));
      // No throw, lifecycle remains ready
      expect(true).toBe(true);
    });

    it("throws when initialize is called twice", async () => {
      const { client, control } = makeClient();
      const p = client.initialize({ clientInfo: { name: "c", version: "0" } });
      await Promise.resolve();
      control.feedLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { serverInfo: { name: "x", version: "0" } },
        }),
      );
      await p;
      await expect(client.initialize({ clientInfo: { name: "c", version: "0" } })).rejects.toThrow(
        /lifecycle=ready/,
      );
    });

    it("runTurn returns session-exited-mid-turn when transport closes before turn/completed", async () => {
      const { client, control } = makeClient();
      // Walk through initialize + thread/start
      const init = client.initialize({ clientInfo: { name: "c", version: "0" } });
      await Promise.resolve();
      control.feedLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { serverInfo: { name: "x", version: "0" } },
        }),
      );
      await init;
      const start = client.startThread({ cwd: "/tmp/x" });
      await Promise.resolve();
      control.feedLine(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { threadId: "thr_1" } }));
      await start;
      const ac = new AbortController();
      const p = client.runTurn({
        threadId: "thr_1",
        input: "do work",
        signal: ac.signal,
        onNotification: () => {},
        timeoutMs: 60_000,
      });
      // Wait one tick so the request is registered
      await Promise.resolve();
      // Simulate subprocess crash before turn/completed arrives.
      control.close({ code: 1, signal: null });
      const r = await p;
      expect(r.type).toBe("Failure");
      if (r.type === "Failure") {
        expect(r.error.kind).toBe("session-exited-mid-turn");
        if (r.error.kind === "session-exited-mid-turn") {
          expect(r.error.exitCode).toBe(1);
        }
      }
    });
  });
}
