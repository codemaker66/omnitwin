import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// Drive the component purely through the useThree selector: it reads
// performance.current (1 at rest, < 1 while the camera moves), viewport.initialDpr,
// setDpr, and invalidate. We assert the demand-safe behaviour: every time the
// regression factor changes, the renderer DPR is rescaled AND a frame is
// requested so the new resolution actually paints.
const r3f = vi.hoisted(() => ({
  current: 1,
  initialDpr: 1.2,
  setDpr: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@react-three/fiber", () => ({
  useThree: <T,>(selector: (state: unknown) => T): T =>
    selector({
      performance: { current: r3f.current },
      viewport: { initialDpr: r3f.initialDpr },
      setDpr: r3f.setDpr,
      invalidate: r3f.invalidate,
    }),
}));

const { AdaptiveResolution, adaptiveDprForPerformance } = await import("../AdaptiveResolution.js");

describe("AdaptiveResolution", () => {
  afterEach(() => {
    cleanup();
    r3f.current = 1;
    r3f.initialDpr = 1.2;
    r3f.setDpr.mockClear();
    r3f.invalidate.mockClear();
  });

  it("renders at full device pixel ratio when the camera is at rest", () => {
    r3f.current = 1;
    render(<AdaptiveResolution />);
    expect(r3f.setDpr).toHaveBeenCalledWith(1.2);
  });

  it("drops the pixel ratio while the camera is regressing (moving)", () => {
    r3f.current = 0.65;
    render(<AdaptiveResolution />);
    // 0.65 * 1.2 — roughly half the fragment cost during motion.
    expect(r3f.setDpr).toHaveBeenCalledWith(0.78);
  });

  it("requests a frame on every resolution change so demand-mode repaints", () => {
    r3f.current = 1;
    render(<AdaptiveResolution />);
    expect(r3f.invalidate).toHaveBeenCalled();
  });

  it("clamps adaptive DPR to the route budget", () => {
    expect(adaptiveDprForPerformance({
      current: 1,
      initialDpr: 3,
      minDpr: 1,
      maxDpr: 2,
    })).toBe(2);
    expect(adaptiveDprForPerformance({
      current: 0.4,
      initialDpr: 2,
      minDpr: 1,
      maxDpr: 2,
    })).toBe(1);
  });

  it("does not rescale the renderer while disabled for fixed lean viewports", () => {
    render(<AdaptiveResolution enabled={false} minDpr={1} maxDpr={1} />);
    expect(r3f.setDpr).not.toHaveBeenCalled();
    expect(r3f.invalidate).not.toHaveBeenCalled();
  });
});
