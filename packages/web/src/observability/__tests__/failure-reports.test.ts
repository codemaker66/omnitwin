import { afterEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ captureWarning: vi.fn((_message: string, _tags: Readonly<Record<string, string>>) => Promise.resolve()) }));
vi.mock("../sentry.js", () => sentry);

const { reportFailure, resetFailureReportsForTests } = await import("../failure-reports.js");

afterEach(() => {
  resetFailureReportsForTests();
  sentry.captureWarning.mockClear();
});

describe("failure reports", () => {
  it("sends each kind once per page, as a warning with its tags", () => {
    reportFailure("device-lost", { surface: "planner", backend: "webgpu", detail: "The graphics device was destroyed" });
    reportFailure("device-lost", { surface: "planner", backend: "webgpu", detail: "again" });
    reportFailure("save-failed", { status: 409 });

    expect(sentry.captureWarning).toHaveBeenCalledTimes(2);
    expect(sentry.captureWarning).toHaveBeenNthCalledWith(1, "Venviewer failure: device-lost",
      { failure: "device-lost", surface: "planner", backend: "webgpu", detail: "The graphics device was destroyed" });
    expect(sentry.captureWarning).toHaveBeenNthCalledWith(2, "Venviewer failure: save-failed", { failure: "save-failed", status: "409" });
  });

  it("leaves out tags it was not given, and keeps each to Sentry's 200 characters", () => {
    reportFailure("gpu-error", { surface: "walk", detail: "x".repeat(500), backend: undefined });
    const [, tags] = sentry.captureWarning.mock.calls[0] ?? [];
    expect(tags).toEqual({ failure: "gpu-error", surface: "walk", detail: "x".repeat(200) });
  });

  it("never throws into the failure it reports, whatever Sentry does", async () => {
    sentry.captureWarning.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    expect(() => { reportFailure("renderer-failed"); }).not.toThrow();
    await Promise.resolve();
  });
});
