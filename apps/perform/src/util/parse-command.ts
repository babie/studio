/**
 * Splits a POSIX-style shell command into an argv array.
 * Supports single quotes, double quotes, and backslash escapes.
 * Does NOT support: variable expansion, glob expansion, command substitution.
 * Throws TypeError on unterminated quotes.
 */
export const parseCommandLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  let started = false;
  while (i < line.length) {
    const ch = line[i];
    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        cur += ch;
      }
      i += 1;
      continue;
    }
    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      } else if (ch === "\\" && i + 1 < line.length) {
        const next = line[i + 1];
        if (next === '"' || next === "\\" || next === "$" || next === "`" || next === "\n") {
          cur += next;
          i += 2;
          continue;
        }
        cur += ch;
      } else {
        cur += ch;
      }
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      started = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      started = true;
      i += 1;
      continue;
    }
    if (ch === "\\" && i + 1 < line.length) {
      cur += line[i + 1];
      started = true;
      i += 2;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n") {
      if (started) {
        out.push(cur);
        cur = "";
        started = false;
      }
      i += 1;
      continue;
    }
    cur += ch;
    started = true;
    i += 1;
  }
  if (inSingle || inDouble) {
    throw new TypeError(`parseCommandLine: unterminated ${inSingle ? "single" : "double"} quote in: ${line}`);
  }
  if (started) out.push(cur);
  return out;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("util/parse-command", () => {
    it("splits a simple command", () => {
      expect(parseCommandLine("claude-app-server --model claude-opus-4-7")).toEqual([
        "claude-app-server",
        "--model",
        "claude-opus-4-7",
      ]);
    });

    it("respects double quotes containing spaces", () => {
      expect(parseCommandLine('codex --config "model=gpt-5.5"')).toEqual([
        "codex",
        "--config",
        "model=gpt-5.5",
      ]);
    });

    it("respects single quotes (no escape inside)", () => {
      expect(parseCommandLine(`codex --config 'model="gpt-5.5"'`)).toEqual([
        "codex",
        "--config",
        'model="gpt-5.5"',
      ]);
    });

    it("supports backslash escape outside quotes", () => {
      expect(parseCommandLine("foo bar\\ baz")).toEqual(["foo", "bar baz"]);
    });

    it("collapses multiple whitespace", () => {
      expect(parseCommandLine("a   b\t\tc")).toEqual(["a", "b", "c"]);
    });

    it("throws on unterminated quote", () => {
      expect(() => parseCommandLine('foo "bar')).toThrow(/unterminated/);
    });
  });
}
