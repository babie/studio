import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createFileLogger } from "../../src/util/file-logger.js";

const setTimeoutP = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("file-logger rotation", () => {
  it("rotates when file exceeds max_size_mb (using 1MB cap + chunked writes)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flog-rot-"));
    const path = join(dir, "rot.log");
    const log = createFileLogger({ path, maxSizeMb: 1, maxFiles: 3 });

    // Write enough content to cross the 1MB rotation boundary at least once.
    const big = "x".repeat(900); // ~1KB per pino line incl. JSON overhead
    for (let i = 0; i < 1300; i += 1) log.info(big);
    await setTimeoutP(1000); // pino-roll flush + rotate

    const entries = await readdir(dir);
    // pino-roll v4 uses "Extension Last Format": rot.1.log, rot.2.log, ...
    const rotated = entries.filter((f) => /^rot\.\d+\.log$/.test(f));
    expect(rotated.length).toBeGreaterThanOrEqual(2);
    expect(rotated.length).toBeLessThanOrEqual(4);
  });
});
