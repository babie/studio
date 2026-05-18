/**
 * Continuation prompt used for turns 2..maxTurns of an AgentRunner loop.
 * Verbatim from symphony's agent_runner.ex build_turn_prompt/4 for turn>1.
 * Do NOT pass through liquidjs — symphony composes this from raw Elixir.
 */
export const buildContinuationPrompt = (turnNumber: number, maxTurns: number): string => {
  return [
    "Continuation guidance:",
    "",
    "- The previous Codex turn completed normally, but the Linear issue is still in an active state.",
    `- This is continuation turn #${turnNumber} of ${maxTurns} for the current agent run.`,
    "- Resume from the current workspace and workpad state instead of restarting from scratch.",
    "- The original task instructions and prior turn context are already present in this thread, so do not restate them before acting.",
    "- Focus on the remaining ticket work and do not end the turn while the issue stays active unless you are truly blocked.",
  ].join("\n");
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("prompt/continuation", () => {
    it("includes turn number and max", () => {
      const out = buildContinuationPrompt(2, 5);
      expect(out).toContain("turn #2 of 5");
    });
    it("starts with the continuation header", () => {
      const out = buildContinuationPrompt(3, 5);
      expect(out.split("\n")[0]).toBe("Continuation guidance:");
    });
  });
}
