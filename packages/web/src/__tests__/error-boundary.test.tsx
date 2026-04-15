import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { AppErrorBoundary, classifyError } from "../error-boundary.js";

// ---------------------------------------------------------------------------
// classifyError — pure function, fully tested in isolation
// ---------------------------------------------------------------------------

describe("classifyError", () => {
  it("classifies a fetch TypeError as network", () => {
    const err = new TypeError("Failed to fetch");
    expect(classifyError(err)).toBe("network");
  });

  it("classifies a TypeError mentioning network as network", () => {
    const err = new TypeError("network request failed");
    expect(classifyError(err)).toBe("network");
  });

  it("classifies a generic Error mentioning NetworkError as network", () => {
    const err = new Error("NetworkError when attempting to fetch resource");
    expect(classifyError(err)).toBe("network");
  });

  it("classifies a plain runtime Error as render", () => {
    const err = new Error("Cannot read properties of undefined");
    expect(classifyError(err)).toBe("render");
  });

  it("classifies a TypeError unrelated to network as render", () => {
    const err = new TypeError("foo is not a function");
    expect(classifyError(err)).toBe("render");
  });

  it("classifies null as render", () => {
    expect(classifyError(null)).toBe("render");
  });
});

// ---------------------------------------------------------------------------
// AppErrorBoundary — render-time integration
//
// React logs caught errors to console.error during a boundary catch. We
// silence that noise so the test output stays clean; the boundary still
// runs its own console.error, which we also silence here.
// ---------------------------------------------------------------------------

class Thrower extends Component<{ readonly error: Error; readonly children?: ReactNode }> {
  override render(): ReactNode {
    throw this.props.error;
  }
}

describe("AppErrorBoundary", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => { /* silence */ });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    cleanup();
  });

  it("shows the network heading + 'Try again' CTA when a fetch error escapes a child", () => {
    const { getByText, getByTestId } = render(
      <AppErrorBoundary>
        <Thrower error={new TypeError("Failed to fetch")} />
      </AppErrorBoundary>,
    );
    expect(getByTestId("error-boundary-network")).toBeDefined();
    expect(getByText("Couldn't reach the server")).toBeDefined();
    expect(getByText("Check your internet connection, then try again.")).toBeDefined();
    expect(getByText("Try again")).toBeDefined();
  });

  it("shows the render heading + error message + 'Reload Page' CTA for an arbitrary render error", () => {
    const { getByText, getByTestId } = render(
      <AppErrorBoundary>
        <Thrower error={new Error("scene graph corrupted")} />
      </AppErrorBoundary>,
    );
    expect(getByTestId("error-boundary-render")).toBeDefined();
    expect(getByText("Something went wrong")).toBeDefined();
    expect(getByText("scene graph corrupted")).toBeDefined();
    expect(getByText("Reload Page")).toBeDefined();
  });

  it("renders children when no error has occurred", () => {
    const { getByText } = render(
      <AppErrorBoundary>
        <div>safe content</div>
      </AppErrorBoundary>,
    );
    expect(getByText("safe content")).toBeDefined();
  });
});
