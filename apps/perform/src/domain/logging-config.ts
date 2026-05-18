export type LoggingConfig = Readonly<{
  file: Readonly<{
    /** Absolute path to the log file. */
    path: string;
    /** Max size of a single log file in MB before rotation. Default 10. */
    maxSizeMb: number;
    /** Max number of rotated log files to keep. Default 5. */
    maxFiles: number;
  }>;
}>;

if (import.meta.vitest) {
  const { describe, it, expect } = await import("vitest");
  describe("domain/logging-config", () => {
    it("requires absolute path-shaped string", () => {
      const c: LoggingConfig = { file: { path: "/var/log/x.log", maxSizeMb: 10, maxFiles: 5 } };
      expect(c.file.path).toMatch(/^\//);
    });
  });
}
