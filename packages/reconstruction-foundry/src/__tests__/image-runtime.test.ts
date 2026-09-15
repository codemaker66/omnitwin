import { afterEach, describe, expect, it, vi } from "vitest";
import { getImageDecoderRuntime } from "../webp.js";

afterEach(() => { vi.restoreAllMocks(); });

describe("native image runtime diagnostics", () => {
  it("excludes network reporting, restores the setting and omits unrelated report data", () => {
    const runtimeReport = process.report as NonNullable<typeof process.report> & { excludeNetwork?: boolean };
    const previous = runtimeReport.excludeNetwork;
    vi.spyOn(runtimeReport, "getReport").mockImplementation(() => {
      expect(runtimeReport.excludeNetwork).toBe(true);
      return { header: {}, sharedObjects: ["/lib/ld-musl-x86_64.so.1", "/app/libvips.so"],
        environmentVariables: { SECRET: "must-not-log" }, javascriptStack: { message: "private-stack" } };
    });
    const diagnostic = getImageDecoderRuntime();
    expect(runtimeReport.excludeNetwork).toBe(previous);
    expect(diagnostic.libc.family).toBe("musl");
    expect(diagnostic.versions.sharp).toBeTruthy();
    expect(JSON.stringify(diagnostic)).not.toMatch(/SECRET|must-not-log|private-stack|environmentVariables/);
  });

  it("preserves service startup and restores network settings when report collection throws", () => {
    const runtimeReport = process.report as NonNullable<typeof process.report> & { excludeNetwork?: boolean };
    const previous = runtimeReport.excludeNetwork;
    vi.spyOn(runtimeReport, "getReport").mockImplementation(() => { throw new Error("report unavailable"); });
    const diagnostic = getImageDecoderRuntime();
    expect(diagnostic.reportAvailable).toBe(false);
    expect(diagnostic.libc.family).toBe("unknown");
    expect(diagnostic.versions.sharp).toBeTruthy();
    expect(runtimeReport.excludeNetwork).toBe(previous);
  });
});
