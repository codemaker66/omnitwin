import { afterEach, describe, expect, it } from "vitest";
import { profilerClipboardReport } from "../perf-runtime.js";

function reportedBundle(search: string): unknown {
  window.history.replaceState(null, "", `/plan/layout-1${search}`);
  const report = JSON.parse(profilerClipboardReport()) as { page: { splatBundle: unknown }; definitions: Record<string, string> };
  expect(report.definitions["splatBundle"]).toMatch(/SH degree/u);
  return report.page.splatBundle;
}

afterEach(() => { window.history.replaceState(null, "", "/"); });

describe("the profiler report's device-day cut", () => {
  it("names the cut the address names, so equal splat counts are told apart", () => {
    expect(reportedBundle("?splatBundle=l2-2m-sh1&profiler=1")).toBe("l2-2m-sh1");
    expect(reportedBundle("?profiler=1&splatBundle=l2-1.5m")).toBe("l2-1.5m");
  });

  it.each(["", "?splatBundle=", "?splatBundle=..%2Fl2-2m", "?splatBundle=https%3A%2F%2Fexample.com%2Fx.sog", `?splatBundle=${"a".repeat(40)}`])(
    "reports null for %s",
    (search) => {
      expect(reportedBundle(search)).toBeNull();
    },
  );
});
