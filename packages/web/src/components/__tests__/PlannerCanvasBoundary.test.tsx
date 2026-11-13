import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlannerCanvasBoundary } from "../PlannerCanvasBoundary.js";
import { PlannerWorkContext } from "../scene/planner-work.js";

const reports = vi.hoisted(() => ({ reportFailure: vi.fn() }));
vi.mock("../../observability/failure-reports.js", () => reports);

afterEach(() => {
  cleanup();
});

// A child that throws on first render (simulating a WebGL context failure),
// then renders cleanly after the flag flips — used to prove the "Try 3D again"
// retry path recovers.
let shouldThrow = true;
function MaybeBoom(): React.ReactElement {
  if (shouldThrow) throw new Error("Error creating WebGL context");
  return <div>3d scene mounted</div>;
}

describe("PlannerCanvasBoundary", () => {
  it("renders children when the canvas mounts cleanly", () => {
    render(
      <PlannerCanvasBoundary>
        <div>3d scene mounted</div>
      </PlannerCanvasBoundary>,
    );
    expect(screen.getByText("3d scene mounted")).toBeTruthy();
  });

  it("continues in the planner's own 2D view of this layout, in place, when the 3D canvas throws", () => {
    // The boundary logs a warning and React logs the caught error; silence both.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const continueIn2d = vi.fn();
    const before = window.location.href;

    shouldThrow = true;
    render(
      <PlannerWorkContext.Provider value={{ continueIn2d }}>
        <PlannerCanvasBoundary>
          <MaybeBoom />
        </PlannerCanvasBoundary>
      </PlannerWorkContext.Provider>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Your layout is safe");
    // /blueprint opened a demonstration plan, not this layout.
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue in 2D" }));
    expect(continueIn2d).toHaveBeenCalledOnce();
    expect(window.location.href).toBe(before);
    // Sentry hears what failed by its name only: an error's message may quote what the planner held.
    expect(reports.reportFailure).toHaveBeenCalledWith("planner-canvas-fallback", { error: "Error" });

    warn.mockRestore();
    error.mockRestore();
  });

  it("offers no 2D view while the editor allows none", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    shouldThrow = true;
    render(
      <PlannerWorkContext.Provider value={{ continueIn2d: null }}>
        <PlannerCanvasBoundary>
          <MaybeBoom />
        </PlannerCanvasBoundary>
      </PlannerWorkContext.Provider>,
    );
    expect(screen.getByRole("alert").textContent).not.toContain("2D");
    expect(screen.queryByRole("button", { name: "Continue in 2D" })).toBeNull();
    expect(screen.getByRole("button", { name: /try 3d again/i })).toBeTruthy();

    warn.mockRestore();
    error.mockRestore();
  });

  it("recovers and re-renders the scene when the user retries", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    shouldThrow = true;
    render(
      <PlannerCanvasBoundary>
        <MaybeBoom />
      </PlannerCanvasBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();

    // Next mount succeeds; "Try 3D again" clears the error state.
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: /try 3d again/i }));
    expect(screen.getByText("3d scene mounted")).toBeTruthy();

    warn.mockRestore();
    error.mockRestore();
  });
});
