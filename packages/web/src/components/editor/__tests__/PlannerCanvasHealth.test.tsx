import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import {
  MAX_PLANNER_PIXEL_RATIO,
  MOTION_PLANNER_PIXEL_RATIO,
} from "../../../lib/planner-resolution-policy.js";

// The three components under test all read R3F state through selectors, so the
// whole of @react-three/fiber can be replaced with a selector applied to a
// plain object — the same approach PlannerScene.test.tsx takes to keep scene
// children out of a real Canvas.
interface FakeGl {
  readonly domElement: HTMLCanvasElement;
  getPixelRatio: () => number;
  setPixelRatio: (ratio: number) => void;
}
const three = vi.hoisted(() => ({
  state: null as unknown,
}));
vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: unknown) => unknown) => selector(three.state),
}));

const { PlannerAdaptiveResolution, PlannerContextLossNotice, PlannerContextLossWatch } =
  await import("../PlannerCanvasHealth.js");

let pixelRatio = 1;
let setPixelRatio: Mock<(ratio: number) => void>;
let invalidate: Mock<() => void>;
let canvas: HTMLCanvasElement;

function mountState(performanceCurrent: number): void {
  canvas = document.createElement("canvas");
  setPixelRatio = vi.fn<(ratio: number) => void>((ratio: number) => { pixelRatio = ratio; });
  invalidate = vi.fn<() => void>();
  const gl: FakeGl = {
    domElement: canvas,
    getPixelRatio: () => pixelRatio,
    setPixelRatio: (ratio: number) => { setPixelRatio(ratio); },
  };
  three.state = { gl, invalidate, performance: { current: performanceCurrent } };
}

beforeEach(() => {
  pixelRatio = 1;
  mountState(1);
  useCockpitStore.setState({ cameraInteractionActive: false });
});
afterEach(() => { cleanup(); useCockpitStore.setState({ cameraInteractionActive: false }); });

describe("PlannerAdaptiveResolution", () => {
  it("rests at the display ratio capped to the ceiling", () => {
    render(<PlannerAdaptiveResolution restingRatio={3} />);
    expect(setPixelRatio).toHaveBeenCalledWith(MAX_PLANNER_PIXEL_RATIO);
  });

  it("drops to the motion ratio while the planner reports camera interaction, and wakes the demand loop", () => {
    useCockpitStore.setState({ cameraInteractionActive: true });
    render(<PlannerAdaptiveResolution restingRatio={2} />);
    expect(setPixelRatio).toHaveBeenCalledWith(MOTION_PLANNER_PIXEL_RATIO);
    // A demand loop stops asking for frames the instant the camera settles, so
    // the restore has to wake it or the room stays soft after every drag.
    expect(invalidate).toHaveBeenCalled();
  });

  it("drops to the motion ratio on R3F's regress signal alone, which is the only thing that catches pinch-zoom", () => {
    mountState(0.5);
    render(<PlannerAdaptiveResolution restingRatio={2} />);
    expect(setPixelRatio).toHaveBeenCalledWith(MOTION_PLANNER_PIXEL_RATIO);
  });

  it("never upscales a modest display: motion must not cost more than rest", () => {
    useCockpitStore.setState({ cameraInteractionActive: true });
    render(<PlannerAdaptiveResolution restingRatio={1.25} />);
    expect(setPixelRatio).toHaveBeenCalledWith(1.25);
  });

  it("writes nothing when the renderer already draws at that ratio", () => {
    pixelRatio = MAX_PLANNER_PIXEL_RATIO;
    render(<PlannerAdaptiveResolution restingRatio={2} />);
    expect(setPixelRatio).not.toHaveBeenCalled();
  });
});

describe("PlannerContextLossWatch", () => {
  it("reports a lost context and preventDefaults it, which is what makes recovery possible", () => {
    const onLost = vi.fn();
    const onRestored = vi.fn();
    render(<PlannerContextLossWatch onLost={onLost} onRestored={onRestored} />);
    const lost = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(onLost).toHaveBeenCalledTimes(1);
    // Without preventDefault the browser never sends webglcontextrestored.
    expect(lost.defaultPrevented).toBe(true);
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("clears the notice and redraws when the driver returns", () => {
    const onLost = vi.fn();
    const onRestored = vi.fn();
    render(<PlannerContextLossWatch onLost={onLost} onRestored={onRestored} />);
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalled();
  });

  it("stops listening once the canvas is gone", () => {
    const onLost = vi.fn();
    const view = render(<PlannerContextLossWatch onLost={onLost} onRestored={vi.fn()} />);
    view.unmount();
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(onLost).not.toHaveBeenCalled();
  });
});

describe("PlannerContextLossNotice", () => {
  it("says what happened, promises nothing was lost, and offers the 2D plan", () => {
    render(<PlannerContextLossNotice />);
    expect(screen.getByTestId("planner-context-lost")).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
    const fallback = screen.getByRole("link", { name: "Keep planning in 2D" });
    expect(fallback.getAttribute("href")).toBe("/blueprint");
  });
});
