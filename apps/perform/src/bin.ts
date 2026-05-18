#!/usr/bin/env node
import { Command } from "commander";
import { GUARDRAIL_FLAG, runCli } from "./cli/run.js";

const program = new Command()
  .name("perform")
  .description("Perform — agent orchestrator for memory/linear/github trackers")
  .version("0.1.0")
  .argument("<workflow>", "path to WORKFLOW.md")
  .option(GUARDRAIL_FLAG, "acknowledge that perform runs agents without per-tool prompts")
  .option("--no-dashboard", "disable the TUI dashboard (logs go to stderr)");

program.action(async (workflow: string) => {
  const opts = program.opts() as Record<string, unknown>;
  const flagKey = GUARDRAIL_FLAG.replace(/^--/, "").replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
  const dashboardEnabled = opts.dashboard !== false;
  await runCli({
    workflowPath: workflow,
    guardrailAccepted: Boolean(opts[flagKey]),
    noDashboard: !dashboardEnabled,
  });
});

await program.parseAsync(process.argv);
