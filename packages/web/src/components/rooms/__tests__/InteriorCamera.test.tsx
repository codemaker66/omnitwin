import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The camera's smoothing and containment are covered by interior-camera.test.ts
// on the pure functions. What this file pins is the component's report of
// MOTION: the one signal the renderer uses to trade detail for frame rate.
const fiber = vi.hoisted(() => {
  const frames: ((state: unknown, delta: number) => void)[] = [];
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "clientWidth", { value: 1600, configurable: true });
  Object.defineProperty(canvas, "clientHeight", { value: 900, configurable: true });
  Object.assign(canvas, {
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    hasPointerCapture: () => false,
  });
  const camera = {
    fov: 48,
    position: { set: () => undefined },
    rotation: { order: "XYZ", set: () => undefined },
  };
  const gl = { domElement: canvas, getPixelRatio: () => 1, setPixelRatio: () => undefined };
  const state = { camera, gl, invalidate: () => undefined };
  return {
    frames,
    canvas,
    useThree: (selector: (s: typeof state) => unknown) => selector(state),
    useFrame: (callback: (state: unknown, delta: number) => void) => {
      frames.push(callback);
    },
  };
});
vi.mock("@react-three/fiber", () => ({ useThree: fiber.useThree, useFrame: fiber.useFrame }));

import { InteriorCamera } from "../InteriorCamera.js";

const SPAWN = { position: [0, 1.6, 0] as [number, number, number], yaw: 0 };
const BOUNDS = {
  min: [-5, 0.5, -5] as [number, number, number],
  max: [5, 3, 5] as [number, number, number],
};

function frame(count = 1): void {
  for (let i = 0; i < count; i += 1) {
    for (const callback of fiber.frames) callback({}, 1 / 60);
  }
}

function pointer(type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fiber.canvas.dispatchEvent(event);
}

describe("InteriorCamera motion report", () => {
  beforeEach(() => {
    fiber.frames.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it("reports rest on the first frame when the view starts where it will stay", () => {
    const onMotionChange = vi.fn();
    render(<InteriorCamera spawn={SPAWN} bounds={BOUNDS} onMotionChange={onMotionChange} />);

    frame();

    expect(onMotionChange).toHaveBeenCalledTimes(1);
    expect(onMotionChange).toHaveBeenLastCalledWith(false);
  });

  it("reports motion once a drag moves the look target, and rest again once the look settles", () => {
    const onMotionChange = vi.fn();
    render(<InteriorCamera spawn={SPAWN} bounds={BOUNDS} onMotionChange={onMotionChange} />);
    frame();
    onMotionChange.mockClear();

    pointer("pointerdown", 800, 450);
    pointer("pointermove", 1000, 450);
    frame();
    expect(onMotionChange).toHaveBeenCalledTimes(1);
    expect(onMotionChange).toHaveBeenLastCalledWith(true);

    pointer("pointerup", 1000, 450);
    frame(300);
    expect(onMotionChange).toHaveBeenCalledTimes(2);
    expect(onMotionChange).toHaveBeenLastCalledWith(false);
  });

  it("says nothing at all when nobody is listening", () => {
    expect(() => {
      render(<InteriorCamera spawn={SPAWN} bounds={BOUNDS} />);
      pointer("pointerdown", 800, 450);
      pointer("pointermove", 900, 450);
      frame(5);
    }).not.toThrow();
  });
});

describe("InteriorCamera keeps the viewer's place", () => {
  beforeEach(() => {
    fiber.frames.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  // The live Grand Hall walk "rubberbanded back to the starting view" on every
  // move (2026-09-04): the scene re-rendered on a progress tick, handed the
  // camera a fresh-but-equal spawn object, and the re-seat effect fired on the
  // new identity. Equal values must mean the same place.
  it("does not return to the spawn when re-rendered with an equal but new spawn and bounds", () => {
    const { rerender } = render(<InteriorCamera spawn={SPAWN} bounds={BOUNDS} />);
    frame();
    pointer("pointerdown", 800, 450);
    pointer("pointermove", 400, 450);
    pointer("pointerup", 400, 450);
    frame(240);
    const turned = window.__roomCamera?.yaw ?? 0;
    expect(Math.abs(turned)).toBeGreaterThan(0.1);

    rerender(
      <InteriorCamera
        spawn={{ position: [...SPAWN.position] as [number, number, number], yaw: SPAWN.yaw }}
        bounds={{
          min: [...BOUNDS.min] as [number, number, number],
          max: [...BOUNDS.max] as [number, number, number],
        }}
      />,
    );
    frame(240);

    expect(window.__roomCamera?.yaw).toBeCloseTo(turned, 6);
  });

  it("re-seats the view when the spawn genuinely changes, as it does on a new room", () => {
    const { rerender } = render(<InteriorCamera spawn={SPAWN} bounds={BOUNDS} />);
    frame();
    pointer("pointerdown", 800, 450);
    pointer("pointermove", 400, 450);
    pointer("pointerup", 400, 450);
    frame(240);
    expect(Math.abs(window.__roomCamera?.yaw ?? 0)).toBeGreaterThan(0.1);

    rerender(<InteriorCamera spawn={{ position: [2, 1.6, -1], yaw: 1 }} bounds={BOUNDS} />);
    frame(240);

    expect(window.__roomCamera?.yaw).toBeCloseTo(1, 6);
    expect(window.__roomCamera?.position[0]).toBeCloseTo(2, 6);
  });
});
