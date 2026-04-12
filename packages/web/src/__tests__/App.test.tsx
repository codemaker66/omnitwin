import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// Mock @react-three/fiber — happy-dom has no WebGL context.
const CanvasMock = vi.hoisted(() =>
  vi.fn(({ children }: { children?: React.ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  )),
);

vi.mock("@react-three/fiber", () => ({
  Canvas: CanvasMock,
  useThree: () => ({
    camera: {
      position: { x: 0, y: 0, z: 0, set: vi.fn(), copy: vi.fn() },
      quaternion: { setFromEuler: vi.fn() },
      lookAt: vi.fn(),
    },
    gl: { domElement: document.createElement("canvas") },
    invalidate: vi.fn(),
  }),
  useFrame: vi.fn(),
}));

vi.mock("@react-three/drei", () => ({
  OrbitControls: vi.fn(() => null),
  Html: vi.fn(({ children }: { children?: React.ReactNode }) => children),
}));

import { App } from "../App.js";

/** Extract the props object from the first CanvasMock call. */
function getCanvasProps(): Record<string, unknown> {
  const firstCall = CanvasMock.mock.calls[0];
  if (firstCall === undefined) {
    throw new Error("Canvas was never called");
  }
  return firstCall[0] as Record<string, unknown>;
}

describe("App", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  it("renders without crashing", () => {
    const { getByTestId } = render(<App />);
    expect(getByTestId("r3f-canvas")).toBeDefined();
  });

  it("passes frameloop='demand' to Canvas", () => {
    CanvasMock.mockClear();
    render(<App />);
    const props = getCanvasProps();
    expect(props["frameloop"]).toBe("demand");
  });

  it("caps DPR at [1, 2] to prevent Retina overdraw", () => {
    CanvasMock.mockClear();
    render(<App />);
    const props = getCanvasProps();
    expect(props["dpr"]).toEqual([1, 2]);
  });

  it("requests high-performance GPU preference", () => {
    CanvasMock.mockClear();
    render(<App />);
    const props = getCanvasProps();
    const gl = props["gl"] as Record<string, unknown>;
    expect(gl["powerPreference"]).toBe("high-performance");
    expect(gl["antialias"]).toBe(true);
  });

  it("configures camera with 45° FOV for architectural view", () => {
    CanvasMock.mockClear();
    render(<App />);
    const props = getCanvasProps();
    const camera = props["camera"] as Record<string, unknown>;
    expect(camera["fov"]).toBe(55);
    expect(camera["near"]).toBe(0.1);
    expect(camera["far"]).toBe(200);
  });

  it("uses neutral background colour", () => {
    CanvasMock.mockClear();
    render(<App />);
    expect(CanvasMock).toHaveBeenCalled();
  });
});
