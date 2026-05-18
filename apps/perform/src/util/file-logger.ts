import { mkdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import pino, { type Logger as PinoLogger, type TransportTargetOptions } from "pino";
// pino-roll types: import via default
import type { Logger } from "../orchestrator/orchestrator.js";

export type FileLoggerOptions = Readonly<{
  path: string;            // absolute path required
  maxSizeMb: number;       // default 10
  maxFiles: number;        // default 5
  prettyStderr?: boolean;  // if true, also pipe to stderr via pino-pretty (PERFORM_DEBUG=1)
}>;

export const createFileLogger = (opts: FileLoggerOptions): Logger => {
  if (!isAbsolute(opts.path)) {
    throw new Error(`file-logger path must be absolute: ${opts.path}`);
  }
  mkdirSync(dirname(opts.path), { recursive: true });

  const targets: TransportTargetOptions[] = [
    {
      target: "pino-roll",
      level: "trace",
      options: {
        file: opts.path,
        size: `${opts.maxSizeMb}m`,
        limit: { count: opts.maxFiles },
        mkdir: true,
      },
    },
  ];
  if (opts.prettyStderr) {
    targets.push({
      target: "pino-pretty",
      level: "info",
      options: { destination: 2, colorize: true, translateTime: "SYS:HH:MM:ss.l" },
    });
  }
  const pinoLogger: PinoLogger = pino({ level: "trace" }, pino.transport({ targets }));

  return {
    info: (msg: string) => pinoLogger.info(msg),
    warn: (msg: string) => pinoLogger.warn(msg),
    error: (err: unknown) => {
      if (err instanceof Error) {
        pinoLogger.error({ err: { name: err.name, message: err.message, stack: err.stack } }, err.message);
      } else if (typeof err === "object" && err !== null) {
        pinoLogger.error({ err }, "error object");
      } else {
        pinoLogger.error(String(err));
      }
    },
  };
};

if (import.meta.vitest) {
  const { describe, it, expect } = await import("vitest");
  const { tmpdir } = await import("node:os");
  const { mkdtemp, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const setTimeoutP = (ms: number) => new Promise((r) => setTimeout(r, ms));

  describe("util/file-logger", () => {
    it("rejects relative paths", () => {
      expect(() => createFileLogger({ path: "log/x.log", maxSizeMb: 10, maxFiles: 5 })).toThrow(/absolute/);
    });

    it("writes JSON lines containing msg + level", async () => {
      const { readdir } = await import("node:fs/promises");
      const dir = await mkdtemp(join(tmpdir(), "flog-"));
      const path = join(dir, "out.log");
      const log = createFileLogger({ path, maxSizeMb: 10, maxFiles: 5 });
      log.info("hello world");
      await setTimeoutP(500); // pino-roll flush
      // pino-roll appends numbers to file names (out.log.1, out.log.2, ...)
      const entries = await readdir(dir);
      const logFile = entries.find((f) => f.startsWith("out.log"));
      if (!logFile) throw new Error(`no log file in ${dir}: ${entries.join(", ")}`);
      const content = await readFile(join(dir, logFile), "utf-8");
      expect(content).toMatch(/"msg":"hello world"/);
      expect(content).toMatch(/"level":30/); // pino level for info
    });
  });
}
