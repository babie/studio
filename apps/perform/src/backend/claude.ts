import type { Result } from "@praha/byethrow";
import type { ClaudeBackend } from "../domain/backend-config.js";
import type { BackendError } from "../domain/backend-errors.js";
import type { Logger } from "../orchestrator/orchestrator.js";
import { parseCommandLine } from "../util/parse-command.js";
import { subprocessTransport } from "./jsonrpc/transport.js";
import { JsonRpcSubprocessClient } from "./jsonrpc/client.js";
import type {
  Backend,
  BackendSession,
  RunTurnParams,
  SessionExitInfo,
  StartSessionParams,
  TurnResult,
} from "./types.js";

const CLIENT_NAME = "perform";
const CLIENT_VERSION = "0.1.0";

export const buildClaudeEnv = (parentEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  // Strip ANTHROPIC_API_KEY so claude-app-server uses Pro/Max OAuth (~/.claude/).
  const { ANTHROPIC_API_KEY: _stripped, ...rest } = parentEnv;
  return rest;
};

export const createClaudeBackend = (config: ClaudeBackend, logger: Logger): Backend => ({
  type: "claude",
  startSession: async (
    params: StartSessionParams,
  ): Promise<Result.Result<BackendSession, BackendError>> => {
    const argv = parseCommandLine(config.command);
    if (argv.length === 0) {
      return {
        type: "Failure",
        error: { kind: "spawn-failed", command: config.command, cause: "empty command" },
      };
    }
    const [command, ...args] = argv;
    const transportR = subprocessTransport({
      command: command!,
      args,
      cwd: params.workspace,
      env: buildClaudeEnv(process.env),
    });
    if (transportR.type === "Failure") return transportR;
    const client = new JsonRpcSubprocessClient({ transport: transportR.value.transport, logger });
    logger.info(
      `[backend claude] spawn pid=${transportR.value.pid} command=${JSON.stringify(config.command)}`,
    );

    const init = await client.initialize({
      clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
    });
    if (init.type === "Failure") {
      await client.shutdown();
      return init;
    }
    logger.info(
      `[backend claude] initialize complete server=${init.value.serverInfo.name}@${init.value.serverInfo.version}`,
    );

    const thread = await client.startThread({ cwd: params.workspace });
    if (thread.type === "Failure") {
      await client.shutdown();
      return thread;
    }
    logger.info(`[backend claude] thread-started ${thread.value.threadId}`);

    let resolveExit!: (info: SessionExitInfo) => void;
    const exitPromise = new Promise<SessionExitInfo>((res) => {
      resolveExit = res;
    });
    transportR.value.transport.onClose((info) => resolveExit(info));

    const session: BackendSession = {
      runTurn: async (rp: RunTurnParams): Promise<Result.Result<TurnResult, BackendError>> => {
        logger.info(`[backend claude] turn-started turn=${rp.turnNumber}/${rp.maxTurns}`);
        const t0 = Date.now();
        const r = await client.runTurn({
          threadId: thread.value.threadId,
          input: rp.prompt,
          signal: rp.signal,
          onNotification: rp.onNotification,
        });
        const elapsed = Date.now() - t0;
        if (r.type === "Failure") return r;
        logger.info(
          `[backend claude] turn-completed turn=${rp.turnNumber}/${rp.maxTurns} (${elapsed}ms)`,
        );
        return { type: "Success", value: { completed: true } };
      },
      shutdown: async (opts) => {
        await client.shutdown(opts);
        logger.info(`[backend claude] shutdown pid=${transportR.value.pid}`);
      },
      interrupt: async () => {
        await client.interrupt();
      },
      exitPromise,
    };
    return { type: "Success", value: session };
  },
});

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("backend/claude (env)", () => {
    it("strips ANTHROPIC_API_KEY from spawn env", () => {
      const env = buildClaudeEnv({ ANTHROPIC_API_KEY: "secret", HOME: "/h", PATH: "/p" });
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.HOME).toBe("/h");
      expect(env.PATH).toBe("/p");
    });
  });
}
