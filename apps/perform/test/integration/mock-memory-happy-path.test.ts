import { describe, it, expect } from "vitest";
import { parseWorkflow } from "../../src/config/parser.js";
import { createMemoryTracker } from "../../src/tracker/memory.js";
import { createMockBackend } from "../../src/backend/mock.js";
import { runOrchestrator } from "../../src/orchestrator/orchestrator.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as v from "valibot";
import { IssueStateName } from "../../src/domain/issue.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplePath = join(__dirname, "../../examples/workflow.mock-memory.md");

describe("integration: mock-memory happy path", () => {
  it("drives 2 issues through Todo → Done", async () => {
    const raw = await readFile(examplePath, "utf8");
    const parsed = parseWorkflow(examplePath, raw);
    if (parsed.type !== "Success") throw new Error("expected schema success");

    const config = parsed.value;
    if (config.tracker.kind !== "memory") throw new Error("expected memory tracker");
    if (config.agent.backend.type !== "mock") throw new Error("expected mock backend");

    const tracker = createMemoryTracker(config.tracker);
    const backend = createMockBackend(config.agent.backend);
    const captured: string[] = [];

    const result = await runOrchestrator({
      tracker,
      backend,
      config,
      logger: { info: (m) => captured.push(m), warn: () => {}, error: () => {} },
      signal: new AbortController().signal,
    });

    if (result.type !== "Success") throw new Error("expected success");
    expect(result.value.total).toBe(2);
    expect(result.value.completed).toBe(2);
    expect(result.value.failed).toBe(0);

    const final = await tracker.fetchIssuesByStates([v.parse(IssueStateName.schema, "Done")]);
    if (final.type !== "Success") throw new Error("unexpected tracker failure");
    expect(final.value.map((i) => i.identifier).sort()).toEqual(["MEMORY-1", "MEMORY-2"]);

    expect(captured.some((l) => l.includes("MEMORY-1 -> Done"))).toBe(true);
    expect(captured.some((l) => l.includes("MEMORY-2 -> Done"))).toBe(true);
  });
});
