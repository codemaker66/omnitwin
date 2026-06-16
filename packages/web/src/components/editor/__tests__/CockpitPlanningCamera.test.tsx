import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, act } from "@testing-library/react";
import type { SpaceDimensions } from "@omnitwin/types";

type FrameCallback = () => void;

const r3fMock = vi.hoisted(() => ({
  cameraPosition: { x: 0, y: 2, z: 20 },
  controlsTarget: { x: 0, y: 0, z: 0 },
  controlsUpdate: vi.fn(),
  invalidate: vi.fn(),
  size: { width: 1600, height: 800 },
  frameCallbacks: [] as FrameCallback[],
  controlsEnabled: true,
}));

vi.mock("@react-three/fiber", () => ({
  useThree: <T,>(selector: (state: unknown) => T): T => selector({
    camera: { position: r3fMock.cameraPosition, type: "PerspectiveCamera", fov: 55 },
    controls: r3fMock.controlsEnabled
      ? { target: r3fMock.controlsTarget, update: r3fMock.controlsUpdate }
      : null,
    size: r3fMock.size,
    invalidate: r3fMock.invalidate,
  }),
  useFrame: (callback: FrameCallback) => {
    r3fMock.frameCallbacks.push(callback);
  },
}));

const { useCockpitStore } = await import("../../../stores/cockpit-store.js");
const { useRoomDimensionsStore } = await import("../../../stores/room-dimensions-store.js");
const { CockpitPlanningCamera } = await import("../CockpitPlanningCamera.js");

const GRAND_HALL_RENDER: SpaceDimensions = { width: 42, length: 21, height: 7 };

function resetR3fMock(): void {
  r3fMock.cameraPosition.x = 0;
  r3fMock.cameraPosition.y = 2;
  r3fMock.cameraPosition.z = 20;
  r3fMock.controlsTarget.x = 0;
  r3fMock.controlsTarget.y = 0;
  r3fMock.controlsTarget.z = 0;
  r3fMock.controlsUpdate.mockClear();
  r3fMock.invalidate.mockClear();
  r3fMock.frameCallbacks.length = 0;
  r3fMock.controlsEnabled = true;
}

describe("CockpitPlanningCamera", () => {
  beforeEach(() => {
    useCockpitStore.getState().reset();
    useRoomDimensionsStore.getState().setDimensions(GRAND_HALL_RENDER);
    resetR3fMock();
  });

  afterEach(() => {
    cleanup();
    useCockpitStore.getState().reset();
    resetR3fMock();
  });

  it("lifts the camera toward an elevated planning pose when the Flow lens opens", () => {
    render(<CockpitPlanningCamera />);

    act(() => {
      useCockpitStore.getState().setMode("flow");
    });
    act(() => {
      r3fMock.frameCallbacks[0]?.();
    });

    // Eased up off the floor (toward the framed planning pose) without snapping.
    expect(r3fMock.cameraPosition.y).toBeGreaterThan(2);
    expect(r3fMock.cameraPosition.y).toBeLessThan(20);
    expect(r3fMock.controlsUpdate).toHaveBeenCalled();
    expect(r3fMock.invalidate).toHaveBeenCalled();
  });

  it("does not reframe when switching to a non-Flow lens", () => {
    render(<CockpitPlanningCamera />);

    act(() => {
      useCockpitStore.getState().setMode("evidence");
    });
    act(() => {
      r3fMock.frameCallbacks[0]?.();
    });

    expect(r3fMock.cameraPosition.y).toBe(2);
    expect(r3fMock.controlsUpdate).not.toHaveBeenCalled();
  });

  it("does not throw if OrbitControls are not registered yet", () => {
    r3fMock.controlsEnabled = false;
    render(<CockpitPlanningCamera />);

    act(() => {
      useCockpitStore.getState().setMode("flow");
    });

    expect(() => {
      act(() => {
        r3fMock.frameCallbacks[0]?.();
      });
    }).not.toThrow();
    expect(r3fMock.controlsUpdate).not.toHaveBeenCalled();
  });
});
