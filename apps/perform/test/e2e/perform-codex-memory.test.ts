import { describe, it, expect, beforeAll } from "vitest";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const performRoot = resolve(__dirname, "../..");
const binPath = join(performRoot, "dist/bin.js");
const examplePath = join(performRoot, "examples/workflow.codex-memory.md");

const FLAG = "--i-understand-that-this-will-be-running-without-the-usual-guardrails";

const skipIfMissing = (): string | null => {
  try {
    execSync("command -v codex", { stdio: "ignore" });
  } catch {
    return "codex CLI not in PATH";
  }
  return null;
};

describe("e2e: perform → codex with Memory tracker", () => {
  beforeAll(() => {
    execSync("pnpm build", { cwd: performRoot, stdio: "inherit" });
  }, 60_000);

  it(
    "drives 1 Memory issue to Done via real codex app-server",
    async () => {
      const reason = skipIfMissing();
      if (reason) {
        console.warn(`[skip] ${reason}`);
        return;
      }
      const child = spawn("node", [binPath, FLAG, examplePath], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c) => (stdout += c.toString()));
      child.stderr.on("data", (c) => (stderr += c.toString()));

      const code: number = await new Promise((res) => {
        child.on("exit", (c) => res(c ?? 0));
      });

      if (code !== 0) {
        console.error("stdout:", stdout);
        console.error("stderr:", stderr);
      }
      expect(code).toBe(0);
      expect(stdout).toMatch(/\[orchestrator\] picked MEMORY-1 \(Todo\)/);
      expect(stdout).toMatch(/\[backend codex\] thread-started/);
      expect(stdout).toMatch(/\[backend codex\] turn-completed/);
      expect(stdout).toMatch(/\[orchestrator\] MEMORY-1 -> Done/);
      expect(stdout).toMatch(/total=1 completed=1 failed=0/);
    },
    120_000,
  );
});
