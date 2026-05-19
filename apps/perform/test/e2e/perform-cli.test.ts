import { describe, it, expect, beforeAll } from "vitest";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const performRoot = resolve(__dirname, "../..");
const binPath = join(performRoot, "dist/bin.js");
const examplePath = join(performRoot, "examples/workflow.mock-memory.md");

describe("e2e: perform CLI with workflow.mock-memory.md", () => {
  beforeAll(() => {
    // Ensure dist is fresh.
    execSync("pnpm build", { cwd: performRoot, stdio: "inherit" });
  }, 60_000);

  it("prints expected state-transition log and exits 0", async () => {
    const child = spawn(
      "node",
      [
        binPath,
        "--i-understand-that-this-will-be-running-without-the-usual-guardrails",
        examplePath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));

    const code: number = await new Promise((res) => {
      child.on("exit", (c) => res(c ?? 0));
    });

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/\[orchestrator\] picked MEMORY-1 \(Todo\)/);
    expect(stdout).toMatch(/\[orchestrator\] MEMORY-1 -> Done/);
    expect(stdout).toMatch(/\[orchestrator\] picked MEMORY-2 \(Todo\)/);
    expect(stdout).toMatch(/\[orchestrator\] MEMORY-2 -> Done/);
    expect(stdout).toMatch(/total=2 completed=2 failed=0/);
  }, 30_000);

  it("refuses to run without the guardrail flag (exit 2)", async () => {
    const child = spawn("node", [binPath, examplePath], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c) => (stderr += c.toString()));
    const code: number = await new Promise((res) => child.on("exit", (c) => res(c ?? 0)));
    expect(code).toBe(2);
    expect(stderr).toMatch(/guardrail/i);
  }, 30_000);
});
