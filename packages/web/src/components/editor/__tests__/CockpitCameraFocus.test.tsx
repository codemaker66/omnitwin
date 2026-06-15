import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, act } from "@testing-library/react";

interface FrameState {
  readonly camera: {
    readonly position: { x: number; z: number };
  };
  readonly controls: {
    readonly target: { x: number; z: number };
    readonly update: () => void;
  } | null;
  readonly invalidate: () => void;
}

type FrameCallback = () => void;

const r3fMock = vi.hoisted(() => ({
  cameraPosition: { x: 10, z: 20 },
  controlsTarget: { x: 0, z: 0 },
  controlsUpdate: vi.fn(),
  invalidate: vi.fn(),
  frameCallbacks: [] as FrameCallback[],
  controlsEnabled: true,
}));

vi.mock("@react-three/fiber", () => ({
  useThree: <T,>(selector: (state: FrameState) => T): T => selector({
    camera: { position: r3fMock.cameraPosition },
    controls: r3fMock.controlsEnabled
      ? { target: r3fMock.controlsTarget, update: r3fMock.controlsUpdate }
      : null,
    invalidate: r3fMock.invalidate,
  }),
  useFrame: (callback: FrameCallback) => {
    r3fMock.frameCallbacks.push(callback);
  },
}));

const { useCockpitStore } = await import("../../../stores/cockpit-store.js");
const { CockpitCameraFocus } = await import("../CockpitCameraFocus.js");

function resetR3fMock(): void {
  r3fMock.cameraPosition.x = 10;
  r3fMock.cameraPosition.z = 20;
  r3fMock.controlsTarget.x = 0;
  r3fMock.controlsTarget.z = 0;
  r3fMock.controlsUpdate.mockClear();
  r3fMock.invalidate.mockClear();
  r3fMock.frameCallbacks.length = 0;
  r3fMock.controlsEnabled = true;
}

describe("CockpitCameraFocus", () => {
  beforeEach(() => {
    useCockpitStore.getState().reset();
    resetR3fMock();
  });

  afterEach(() => {
    cleanup();
    useCockpitStore.getState().reset();
    resetR3fMock();
  });

  it("moves the orbit target and camera by the same first-frame delta", () => {
    render(<CockpitCameraFocus />);

    act(() => {
      useCockpitStore.getState().requestFocus(5, -5);
    });
    act(() => {
      r3fMock.frameCallbacks[0]?.();
    });

    expect(r3fMock.controlsTarget.x).toBeCloseTo(0.8, 5);
    expect(r3fMock.controlsTarget.z).toBeCloseTo(-0.8, 5);
    expect(r3fMock.cameraPosition.x).toBeCloseTo(10.8, 5);
    expect(r3fMock.cameraPosition.z).toBeCloseTo(19.2, 5);
    expect(r3fMock.controlsUpdate).toHaveBeenCalledTimes(1);
    expect(r3fMock.invalidate).toHaveBeenCalled();
  });

  it("does not throw if OrbitControls are not registered yet", () => {
    r3fMock.controlsEnabled = false;
    render(<CockpitCameraFocus />);

    act(() => {
      useCockpitStore.getState().requestFocus(5, -5);
    });

    expect(() => {
      act(() => {
        r3fMock.frameCallbacks[0]?.();
      });
    }).not.toThrow();
    expect(r3fMock.controlsUpdate).not.toHaveBeenCalled();
  });
});
