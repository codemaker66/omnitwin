import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { PerspectiveCamera } from "three";
import { runtimeAssetCameraViewForRoom } from "../../../lib/runtime-package-resolution.js";
import { GrandHallCapturedCamera } from "../GrandHallCapturedCamera.js";

const fiberMocks = vi.hoisted(() => ({
  useFrame: vi.fn(),
  useThree: vi.fn(),
}));

vi.mock("@react-three/fiber", () => fiberMocks);
vi.mock("@react-three/drei", () => ({ OrbitControls: () => null }));

const invalidate = vi.fn();
const canvas = document.createElement("canvas");
const camera = new PerspectiveCamera();

function pointerEvent(
  type: string,
  values: { readonly pointerId: number; readonly button?: number; readonly movementX?: number; readonly movementY?: number },
): Event {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    pointerId: { value: values.pointerId },
    button: { value: values.button ?? 0 },
    movementX: { value: values.movementX ?? 0 },
    movementY: { value: values.movementY ?? 0 },
  });
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperties(canvas, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => false) },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
  fiberMocks.useThree.mockReturnValue({
    camera,
    gl: { domElement: canvas },
    invalidate,
  });
});

afterEach(() => { cleanup(); });

describe("GrandHallCapturedCamera human diagnostic mode", () => {
  it("invalidates on key release so opposing-key cancellation can resume movement", () => {
    render(
      <GrandHallCapturedCamera
        mode="human"
        view={runtimeAssetCameraViewForRoom("grand-hall")}
        smoothControls={false}
      />,
    );

    fireEvent.keyDown(window, { key: "w" });
    fireEvent.keyDown(window, { key: "s" });
    invalidate.mockClear();
    fireEvent.keyUp(window, { key: "s" });

    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("stops rotating after pointer capture is lost or the window blurs", () => {
    const rotationSet = vi.spyOn(camera.rotation, "set");
    render(
      <GrandHallCapturedCamera
        mode="human"
        view={runtimeAssetCameraViewForRoom("grand-hall")}
        smoothControls={false}
      />,
    );

    fireEvent(canvas, pointerEvent("pointerdown", { pointerId: 7 }));
    rotationSet.mockClear();
    fireEvent(canvas, pointerEvent("pointermove", { pointerId: 7, movementX: 4 }));
    expect(rotationSet).toHaveBeenCalledTimes(1);

    fireEvent(canvas, pointerEvent("lostpointercapture", { pointerId: 7 }));
    rotationSet.mockClear();
    fireEvent(canvas, pointerEvent("pointermove", { pointerId: 7, movementX: 4 }));
    expect(rotationSet).not.toHaveBeenCalled();

    fireEvent(canvas, pointerEvent("pointerdown", { pointerId: 8 }));
    fireEvent(window, new Event("blur"));
    fireEvent(canvas, pointerEvent("pointermove", { pointerId: 8, movementX: 4 }));
    expect(rotationSet).not.toHaveBeenCalled();
  });
});
