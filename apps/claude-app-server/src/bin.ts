#!/usr/bin/env node
import { Result } from "@praha/byethrow";
import { Command } from "commander";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { ServerOptions, runServer } from "./server.js";
import { Session } from "./claude/session.js";

const program = new Command()
  .name("claude-app-server")
  .description("Codex App Server compatible JSON-RPC server backed by Claude (stdio JSONL)")
  .option("--model <name>", "Claude model name (e.g. claude-opus-4-7)")
  .option("--permission-mode <mode>", "default | acceptEdits | bypassPermissions")
  .option("--allowed-tools <list>", "comma-separated tool allowlist", (v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .parse();

const parsed = ServerOptions.parse(program.opts());
if (Result.isFailure(parsed)) {
  const message = parsed.error.issues
    .map((i) => {
      const path =
        i.path
          ?.map((p) => (typeof p === "object" && p !== null && "key" in p ? p.key : p))
          .join(".") ?? "(root)";
      return `  ${path}: ${i.message}`;
    })
    .join("\n");
  process.stderr.write(`invalid options:\n${message}\n`);
  process.exit(2);
}

runServer(parsed.value, { session: Session.create({ query }) }).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`fatal: ${message}\n`);
  process.exit(1);
});
