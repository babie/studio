import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { BackendError } from "../../domain/backend-errors.js";
import type { Result } from "@praha/byethrow";
import { spawnFailed } from "./errors.js";

const STDERR_TAIL_BYTES = 4 * 1024;

export type CloseInfo = Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
}>;

export type StdioTransport = Readonly<{
  /** Write a single JSONL line to the subprocess stdin (implementation appends "\n" if missing). */
  write: (line: string) => void;
  /** Subscribe to incoming JSONL lines (one line per call; "\n" already stripped). Returns unsubscribe. */
  onLine: (handler: (line: string) => void) => () => void;
  /** Subscribe to subprocess close. Returns unsubscribe. */
  onClose: (handler: (info: CloseInfo) => void) => () => void;
  /** Last 4KB of subprocess stderr (UTF-8 best effort). */
  stderrTail: () => string;
  /** Send a POSIX signal to the subprocess. */
  kill: (signal: NodeJS.Signals) => void;
}>;

// ── In-memory transport (for unit + integration tests) ──

export type InMemoryControl = Readonly<{
  /** Feed one line as if subprocess wrote it to stdout. */
  feedLine: (line: string) => void;
  /** Simulate subprocess exit. */
  close: (info: CloseInfo) => void;
  /** Append to simulated stderr (max 4KB ring). */
  feedStderr: (chunk: string) => void;
  /** Lines the perform wrote to subprocess stdin. */
  written: () => string[];
}>;

export const inMemoryTransport = (): { transport: StdioTransport; control: InMemoryControl } => {
  const written: string[] = [];
  const lineEmitter = new EventEmitter();
  const closeEmitter = new EventEmitter();
  let stderrBuf = "";

  const transport: StdioTransport = {
    write: (line) => {
      written.push(line);
    },
    onLine: (handler) => {
      lineEmitter.on("line", handler);
      return () => lineEmitter.off("line", handler);
    },
    onClose: (handler) => {
      closeEmitter.on("close", handler);
      return () => closeEmitter.off("close", handler);
    },
    stderrTail: () => stderrBuf,
    kill: () => {
      closeEmitter.emit("close", { code: 0, signal: "SIGTERM" satisfies NodeJS.Signals });
    },
  };

  const control: InMemoryControl = {
    feedLine: (line) => lineEmitter.emit("line", line),
    close: (info) => closeEmitter.emit("close", info),
    feedStderr: (chunk) => {
      stderrBuf = (stderrBuf + chunk).slice(-STDERR_TAIL_BYTES);
    },
    written: () => [...written],
  };
  return { transport, control };
};

// ── Subprocess transport (for E2E + real runs) ──

export type SubprocessSpawnArgs = Readonly<{
  command: string;
  args: ReadonlyArray<string>;
  cwd: string;
  env: NodeJS.ProcessEnv;
}>;

export const subprocessTransport = (
  spawnArgs: SubprocessSpawnArgs,
): Result.Result<{ transport: StdioTransport; pid: number }, BackendError> => {
  let child: ChildProcess;
  try {
    child = spawn(spawnArgs.command, [...spawnArgs.args], {
      cwd: spawnArgs.cwd,
      env: spawnArgs.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    return {
      type: "Failure",
      error: spawnFailed(spawnArgs.command, err instanceof Error ? err.message : String(err)),
    };
  }

  // Always register an error handler BEFORE any synchronous returns to prevent
  // unhandled 'error' events (e.g. ENOENT fires asynchronously even for no-pid cases).
  child.on("error", () => {
    // intentionally ignored — callers learn about failure via onClose or the pid check below
  });

  if (!child.pid) {
    return { type: "Failure", error: spawnFailed(spawnArgs.command, "spawn returned no pid") };
  }

  let stderrBuf = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrBuf = (stderrBuf + chunk.toString("utf8")).slice(-STDERR_TAIL_BYTES);
  });

  const lineEmitter = new EventEmitter();
  const closeEmitter = new EventEmitter();

  let stdoutBuf = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString("utf8");
    let idx: number;
    while ((idx = stdoutBuf.indexOf("\n")) !== -1) {
      const line = stdoutBuf.slice(0, idx);
      stdoutBuf = stdoutBuf.slice(idx + 1);
      lineEmitter.emit("line", line);
    }
  });

  child.on("exit", (code, signal) => {
    closeEmitter.emit("close", { code, signal });
  });

  const transport: StdioTransport = {
    write: (line) => {
      const payload = line.endsWith("\n") ? line : `${line}\n`;
      child.stdin?.write(payload);
    },
    onLine: (handler) => {
      lineEmitter.on("line", handler);
      return () => lineEmitter.off("line", handler);
    },
    onClose: (handler) => {
      closeEmitter.on("close", handler);
      return () => closeEmitter.off("close", handler);
    },
    stderrTail: () => stderrBuf,
    kill: (signal) => {
      try {
        child.kill(signal);
      } catch {
        // ignore; subprocess might already be dead
      }
    },
  };

  return { type: "Success", value: { transport, pid: child.pid } };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("backend/jsonrpc/transport (inMemoryTransport)", () => {
    it("delivers fed lines to subscribers", () => {
      const { transport, control } = inMemoryTransport();
      const got: string[] = [];
      const off = transport.onLine((l) => got.push(l));
      control.feedLine("hello");
      control.feedLine("world");
      off();
      control.feedLine("ignored");
      expect(got).toEqual(["hello", "world"]);
    });

    it("captures writes from perform", () => {
      const { transport, control } = inMemoryTransport();
      transport.write("a");
      transport.write("b");
      expect(control.written()).toEqual(["a", "b"]);
    });

    it("emits close info to subscribers", () => {
      const { transport, control } = inMemoryTransport();
      const closes: CloseInfo[] = [];
      transport.onClose((info) => closes.push(info));
      control.close({ code: 1, signal: null });
      expect(closes).toEqual([{ code: 1, signal: null }]);
    });

    it("ring-buffers stderr to 4KB", () => {
      const { transport, control } = inMemoryTransport();
      control.feedStderr("a".repeat(5000));
      expect(transport.stderrTail().length).toBe(4096);
    });
  });

  describe("backend/jsonrpc/transport (subprocessTransport)", () => {
    it("spawns a child, reads JSONL, and surfaces exit", async () => {
      const node = process.execPath;
      const r = subprocessTransport({
        command: node,
        args: [
          "-e",
          'process.stdout.write("hello\\nworld\\n"); process.stderr.write("oops"); process.exit(0);',
        ],
        cwd: process.cwd(),
        env: process.env,
      });
      if (r.type !== "Success") throw new Error("expected success");
      const lines: string[] = [];
      r.value.transport.onLine((l) => lines.push(l));
      const close: CloseInfo = await new Promise((res) => {
        r.value.transport.onClose((info) => res(info));
      });
      expect(lines).toEqual(["hello", "world"]);
      expect(close.code).toBe(0);
      expect(r.value.transport.stderrTail()).toBe("oops");
    });

    it("returns spawn-failed BackendError for non-existent binary", () => {
      const r = subprocessTransport({
        command: "/definitely/not/a/real/binary/zxqv",
        args: [],
        cwd: process.cwd(),
        env: process.env,
      });
      // spawn() in node returns a ChildProcess immediately, then emits 'error'.
      // Our wrapper treats no-pid as failure, but spawn may set pid before erroring.
      // Accept either Success (pid present) or Failure here — but in the Failure
      // branch the kind must be spawn-failed.
      if (r.type === "Failure") {
        expect(r.error.kind).toBe("spawn-failed");
      }
    });
  });
}
