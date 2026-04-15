import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Component, type ReactNode } from "react";
import { render, cleanup } from "@testing-library/react";
import { MeshErrorBoundary } from "../FurnitureProxy.js";

// ---------------------------------------------------------------------------
// MeshErrorBoundary — pinning the containment guarantee:
//   - A failing child renders the procedural fallback INSTEAD of escaping
//     up the tree (which would crash the whole canvas via the root boundary).
//   - A meshUrl change resets the boundary so a corrected URL is retried.
//   - The componentDidCatch hook logs the failure (we silence the spy).
// ---------------------------------------------------------------------------

class Thrower extends Component<{ readonly error: Error }> {
  override render(): ReactNode {
    throw this.props.error;
  }
}

describe("MeshErrorBoundary", () => {
  let consoleErrSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React logs every caught error to console.error; the boundary itself
    // also calls console.warn. Silence both so the test output stays clean.
    consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => { /* silence */ });
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => { /* silence */ });
  });

  afterEach(() => {
    consoleErrSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    cleanup();
  });

  it("renders the fallback when a child throws", () => {
    const { getByText } = render(
      <MeshErrorBoundary fallback={<div>procedural-fallback</div>} meshUrl="/models/missing.glb">
        <Thrower error={new Error("404")} />
      </MeshErrorBoundary>,
    );
    expect(getByText("procedural-fallback")).toBeDefined();
  });

  it("renders children when no error has occurred", () => {
    const { getByText } = render(
      <MeshErrorBoundary fallback={<div>procedural-fallback</div>} meshUrl="/models/ok.glb">
        <div>real-mesh</div>
      </MeshErrorBoundary>,
    );
    expect(getByText("real-mesh")).toBeDefined();
  });

  it("logs a warning with the failing meshUrl when it catches", () => {
    render(
      <MeshErrorBoundary fallback={<div>procedural-fallback</div>} meshUrl="/models/missing.glb">
        <Thrower error={new Error("not-found")} />
      </MeshErrorBoundary>,
    );
    const warned = consoleWarnSpy.mock.calls.some((call) => {
      const first = call[0];
      return typeof first === "string" && first.includes("/models/missing.glb");
    });
    expect(warned).toBe(true);
  });

  it("resets on meshUrl change so a corrected URL is retried", () => {
    const { getByText, rerender } = render(
      <MeshErrorBoundary fallback={<div>procedural-fallback</div>} meshUrl="/models/missing.glb">
        <Thrower error={new Error("404")} />
      </MeshErrorBoundary>,
    );
    expect(getByText("procedural-fallback")).toBeDefined();

    // Caller swaps in a working URL — boundary should recover and try again.
    rerender(
      <MeshErrorBoundary fallback={<div>procedural-fallback</div>} meshUrl="/models/working.glb">
        <div>real-mesh</div>
      </MeshErrorBoundary>,
    );
    expect(getByText("real-mesh")).toBeDefined();
  });
});
