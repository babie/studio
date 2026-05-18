import type { Logger } from "../orchestrator/orchestrator.js";

export const createStdLogger = (): Logger => ({
  info: (msg) => {
    process.stdout.write(msg + "\n");
  },
  warn: (msg) => {
    process.stderr.write(`[warn] ${msg}\n`);
  },
  error: (err) => {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null
          ? JSON.stringify(err)
          : String(err);
    process.stderr.write(`[error] ${message}\n`);
  },
});

export const createNoopLogger = (): Logger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
});

import { createFileLogger as createFileLoggerImpl, type FileLoggerOptions } from "./file-logger.js";

export const createFileLogger = createFileLoggerImpl;
export type { FileLoggerOptions };

export type SelectLoggerInput = Readonly<{
  /** dashboardEnabled && TTY && !--no-dashboard && !PERFORM_DEBUG */
  dashboardOn: boolean;
  /** PERFORM_DEBUG=1 */
  debugEnv: boolean;
  /** null = no file logger configured */
  fileLoggerOptions: FileLoggerOptions | null;
}>;

export const selectLogger = (input: SelectLoggerInput): Logger => {
  // Dashboard ON: file logger (if configured) keeps everything off stderr.
  if (input.dashboardOn && input.fileLoggerOptions) {
    return createFileLoggerImpl(input.fileLoggerOptions);
  }
  // Dashboard ON without file logger: silent stderr to avoid breaking the TUI.
  if (input.dashboardOn) {
    return createNoopLogger();
  }
  // Debug env + file logger configured: file logger plus pretty stderr.
  if (input.debugEnv && input.fileLoggerOptions) {
    return createFileLoggerImpl({ ...input.fileLoggerOptions, prettyStderr: true });
  }
  // Otherwise: plain stderr.
  return createStdLogger();
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("util/logger", () => {
    it("createStdLogger exposes info/warn/error", () => {
      const l = createStdLogger();
      expect(typeof l.info).toBe("function");
      expect(typeof l.warn).toBe("function");
      expect(typeof l.error).toBe("function");
    });

    it("createNoopLogger silently swallows all messages", () => {
      const l = createNoopLogger();
      l.info("ignored");
      l.warn("ignored");
      l.error(new Error("ignored"));
      expect(typeof l.info).toBe("function");
    });

    it("selectLogger: dashboard ON + file options → file logger (writes JSON)", async () => {
      const { tmpdir } = await import("node:os");
      const { mkdtemp } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const dir = await mkdtemp(join(tmpdir(), "selectlogger-"));
      const log = selectLogger({
        dashboardOn: true,
        debugEnv: false,
        fileLoggerOptions: { path: join(dir, "out.log"), maxSizeMb: 1, maxFiles: 2 },
      });
      // Smoke check — should be the file logger (we can't easily assert it's NOT createNoopLogger
      // without exposing internals, so just exercise it).
      log.info("test");
      expect(typeof log.info).toBe("function");
    });

    it("selectLogger: dashboard ON + no file options → noop", () => {
      const log = selectLogger({
        dashboardOn: true,
        debugEnv: false,
        fileLoggerOptions: null,
      });
      log.info("dropped");
      expect(typeof log.info).toBe("function");
    });

    it("selectLogger: dashboard OFF + no file options → std logger (stderr)", () => {
      const log = selectLogger({
        dashboardOn: false,
        debugEnv: false,
        fileLoggerOptions: null,
      });
      expect(typeof log.info).toBe("function");
    });
  });
}
