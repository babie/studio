export const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
  clearAndHome: "\x1b[2J\x1b[H",
  cursorHide: "\x1b[?25l",
  cursorShow: "\x1b[?25h",
} as const;

export const colorize = (text: string, color: string): string => `${color}${text}${ANSI.reset}`;

/** Format an integer with comma-separated thousands (matches symphony format_count/1).
 *  Examples: 999 → "999", 1234 → "1,234", 1234567 → "1,234,567". */
export const formatCount = (n: number): string => {
  const int = Math.trunc(n);
  const sign = int < 0 ? "-" : "";
  const unsigned = Math.abs(int).toString();
  const grouped = unsigned.replace(/(\d)(?=(\d{3})+$)/g, "$1,");
  return sign + grouped;
};

/** Format runtime seconds (>= 0) as "Xm Ys" (matches symphony format_runtime_seconds/1).
 *  Symphony always emits "Xm Ys" — even 0 → "0m 0s". */
export const formatRuntimeSeconds = (s: number): string => {
  const sec = Math.max(0, Math.floor(s));
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${m}m ${r}s`;
};

/** Format tps as an integer with comma-separated thousands (matches symphony format_tps/1).
 *  Symphony truncates (floor) and groups thousands: 13.7 → "13", 1234.5 → "1,234". */
export const formatTps = (tps: number): string => formatCount(Math.trunc(tps));

/** Truncate a string to max display width, appending "…" if shortened.
 *  Display width is measured in code points (close enough for ASCII + CJK). */
export const truncate = (s: string, max: number): string => {
  if (max <= 0) return "";
  const arr = Array.from(s);
  if (arr.length <= max) return s;
  if (max === 1) return "…";
  return arr.slice(0, max - 1).join("") + "…";
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe("observability/render/format", () => {
    it("ANSI.bold equals \\x1b[1m", () => {
      expect(ANSI.bold).toBe("\x1b[1m");
    });
    it("ANSI.reset equals \\x1b[0m", () => {
      expect(ANSI.reset).toBe("\x1b[0m");
    });
    it("ANSI.dim equals \\x1b[2m", () => {
      expect(ANSI.dim).toBe("\x1b[2m");
    });
    it("colorize wraps with ANSI reset", () => {
      expect(colorize("x", ANSI.green)).toBe("\x1b[32mx\x1b[0m");
    });
    // formatCount: comma-separated thousands (symphony format_count/1)
    it("formatCount: under 1k is raw", () => expect(formatCount(999)).toBe("999"));
    it("formatCount: 1234 → 1,234", () => expect(formatCount(1234)).toBe("1,234"));
    it("formatCount: 12345 → 12,345", () => expect(formatCount(12345)).toBe("12,345"));
    it("formatCount: 1234567 → 1,234,567", () => expect(formatCount(1234567)).toBe("1,234,567"));
    it("formatCount: 0 → 0", () => expect(formatCount(0)).toBe("0"));
    // formatRuntimeSeconds: always Xm Ys (symphony format_runtime_seconds/1)
    it("formatRuntimeSeconds: 0 → 0m 0s", () => expect(formatRuntimeSeconds(0)).toBe("0m 0s"));
    it("formatRuntimeSeconds: 90 → 1m 30s", () => expect(formatRuntimeSeconds(90)).toBe("1m 30s"));
    it("formatRuntimeSeconds: 3700 → 1h 1m not used — always Xm Ys", () => {
      // symphony: 3700s = 61m 40s
      expect(formatRuntimeSeconds(3700)).toBe("61m 40s");
    });
    it("formatRuntimeSeconds: 59 → 0m 59s", () => expect(formatRuntimeSeconds(59)).toBe("0m 59s"));
    // formatTps: truncated integer, comma-grouped (symphony format_tps/1)
    it("formatTps: 0 → 0", () => expect(formatTps(0)).toBe("0"));
    it("formatTps: 13.71 → 13 (truncated)", () => expect(formatTps(13.71)).toBe("13"));
    it("formatTps: 25.4 → 25 (truncated)", () => expect(formatTps(25.4)).toBe("25"));
    it("formatTps: 1234.9 → 1,234 (truncated + comma)", () =>
      expect(formatTps(1234.9)).toBe("1,234"));
    // truncate
    it("truncate: short stays", () => expect(truncate("ab", 5)).toBe("ab"));
    it("truncate: long truncated with …", () => expect(truncate("abcdef", 4)).toBe("abc…"));
    it("truncate: CJK code points", () => expect(truncate("にほんご123", 4)).toBe("にほん…"));
    it("truncate: max=0 returns empty", () => expect(truncate("abc", 0)).toBe(""));
    it("truncate: max=1 returns ellipsis", () => expect(truncate("abc", 1)).toBe("…"));
  });
}
