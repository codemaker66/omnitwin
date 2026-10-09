import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { PerspectiveCamera, Vector3 } from "three";
import { useBookmarkStore } from "../../../stores/bookmark-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useHallViewStore } from "../../../stores/hall-view-store.js";
import { HALL_CUTS, resolveHallView, wallCutHeight } from "../GrandHallModel.js";
import { HALL_MAX_FRAME_STEP, hallFrameStep } from "../hall-mood.js";
import { HALL_ELEVATION, HALL_HALF_WIDTH, HALL_HEIGHT, hallWall } from "../hall-spec.js";

const three = vi.hoisted(() => ({ state: null as null | { camera: unknown; controls: unknown; invalidate: () => void } }));
vi.mock("@react-three/fiber", () => ({
  useThree: (select: (state: unknown) => unknown) => select(three.state),
}));
const { HallViewDirector, HALL_VIEW_POSES } = await import("../HallViewDirector.js");

beforeEach(() => {
  const camera = new PerspectiveCamera();
  camera.position.set(10.2, 12.6, 13.2);
  three.state = { camera, controls: { target: new Vector3(0, 0.6, 0) }, invalidate: () => undefined };
  useCockpitStore.getState().reset();
  useBookmarkStore.setState({ transition: null, pendingNavigationId: null, activeReferenceId: null, tour: null });
  useHallViewStore.setState({ viewRequest: null, activePreset: "room" });
});
afterEach(() => { cleanup(); });

describe("the hall's view director", () => {
  it("glides to a requested framing, leaving a walk first", () => {
    useCockpitStore.setState({ walkMode: true });
    render(<HallViewDirector />);
    act(() => { useHallViewStore.getState().requestView("plan"); });
    expect(useCockpitStore.getState().walkMode).toBe(false);
    expect(useBookmarkStore.getState().transition?.toPosition).toEqual(HALL_VIEW_POSES.plan.position);
    expect(useHallViewStore.getState().viewRequest).toBeNull();
  });

  it("stops a glide under way before walking, so the walk is not handed back", () => {
    render(<HallViewDirector />);
    act(() => { useHallViewStore.getState().requestView("plan"); });
    expect(useBookmarkStore.getState().transition).not.toBeNull();
    act(() => { useHallViewStore.getState().requestView("walk"); });
    expect(useBookmarkStore.getState().transition).toBeNull();
    expect(useCockpitStore.getState().walkMode).toBe(true);
  });
});

describe("the hall's framing and cutaway", () => {
  it("reads a camera inside the room as a walk, and one looking straight down as plan", () => {
    expect(resolveHallView([0, 1.6, 0], 0.1, "overview")).toBe("walk");
    expect(resolveHallView([0, 21.5, 2.3], 0.99, "overview")).toBe("plan");
    expect(resolveHallView([10.2, 12.6, 13.2], 0.6, "overview")).toBe("overview");
  });

  it("holds plan at the threshold rather than flickering", () => {
    expect(resolveHallView([0, 21.5, 2.3], 0.92, "plan")).toBe("plan");
    expect(resolveHallView([0, 21.5, 2.3], 0.92, "overview")).toBe("overview");
  });

  it("lowers the walls the camera stands behind to the dado and keeps the far walls whole", () => {
    const camera = [0, 12, HALL_HALF_WIDTH + 8] as const;
    expect(wallCutHeight("overview", hallWall("door"), camera)).toBeCloseTo(HALL_CUTS.near, 6);
    expect(HALL_CUTS.near).toBeCloseTo(HALL_ELEVATION.dadoTop + 0.01, 6);
    expect(wallCutHeight("overview", hallWall("window"), camera)).toBeGreaterThan(HALL_HEIGHT);
    expect(wallCutHeight("plan", hallWall("window"), camera)).toBe(HALL_CUTS.plan);
    expect(wallCutHeight("walk", hallWall("door"), camera)).toBe(HALL_CUTS.none);
  });
});

describe("blends and easings", () => {
  it("do not spend the demand loop's idle gap, nor skip ahead on a stalled frame", () => {
    expect(hallFrameStep(20, true)).toBe(0);
    expect(hallFrameStep(1 / 60, false)).toBeCloseTo(1 / 60, 10);
    expect(hallFrameStep(3, false)).toBe(HALL_MAX_FRAME_STEP);
    expect(hallFrameStep(-1, false)).toBe(0);
  });

  it("keep real time on a slow device's steady frames", () => {
    // A software rasteriser draws the hall at a few frames a second; a 1.6 s
    // blend must not stretch to many times its length there.
    expect(hallFrameStep(0.2, false)).toBeCloseTo(0.2, 10);
    const frames = Math.ceil(1.6 / hallFrameStep(0.3, false));
    expect(frames).toBeLessThanOrEqual(8);
  });
});
