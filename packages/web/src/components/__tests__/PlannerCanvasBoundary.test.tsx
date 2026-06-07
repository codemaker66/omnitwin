import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlannerCanvasBoundary } from "../PlannerCanvasBoundary.js";

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

  it("shows a graceful 2D-planner fallback when the 3D canvas throws", () => {
    // The boundary logs a warning and React logs the caught error; silence both.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    shouldThrow = true;
    render(
      <PlannerCanvasBoundary>
        <MaybeBoom />
      </PlannerCanvasBoundary>,
    );

    // Routes to the WebGL-free 2D planner.
    const link = screen.getByRole("link", { name: /2D planner/i });
    expect(link.getAttribute("href")).toBe("/blueprint");
    // Honest, SAFE copy — names WebGL, makes no unsupported claim.
    expect(screen.getByText(/WebGL/i)).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();

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
