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
  let pixelRatio = 1;
  const gl = {
    domElement: canvas,
    getPixelRatio: () => pixelRatio,
    setPixelRatio: vi.fn((value: number) => { pixelRatio = value; }),
  };
  const state = { camera, gl, invalidate: () => undefined };
  return {
    frames,
    canvas,
    gl,
    useThree: (selector: (s: typeof state) => unknown) => selector(state),
    useFrame: (callback: (state: unknown, delta: number) => void) => {
      frames.push(callback);
    },
  };
});
vi.mock("@react-three/fiber", () => ({ useThree: fiber.useThree, useFrame: fiber.useFrame }));

import { InteriorCamera } from "../InteriorCamera.js";
import { plannerKeyboardNavigationEnabled } from "../../../lib/planner-room-arrival.js";
import { useMarkupStore } from "../../../stores/markup-store.js";
import { useSelectionStore } from "../../../stores/selection-store.js";

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

function pointer(type: string, x: number, y: number, button = 0): void {
  const event = new MouseEvent(type, { clientX: x, clientY: y, button, bubbles: true });
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

describe("InteriorCamera wheel", () => {
  beforeEach(() => { fiber.frames.length = 0; });
  afterEach(() => { cleanup(); });

  function wheel(deltaY: number, deltaMode = 0): void {
    const event = new Event("wheel", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "deltaY", { value: deltaY });
    Object.defineProperty(event, "deltaMode", { value: deltaMode });
    fiber.canvas.dispatchEvent(event);
  }

  it("walks a mouse notch forward, as it always did", () => {
    render(<InteriorCamera spawn={SPAWN} bounds={BOUNDS} />);
    frame();
    const before = window.__roomCamera?.position[2] ?? 0;

    wheel(-100);
    frame(240);

    expect((window.__roomCamera?.position[2] ?? 0) - before).toBeCloseTo(-0.55, 2);
  });

  // A trackpad flick is one gesture reported as a stream of tiny events. Stepping
  // a fixed distance per event sent the viewer 11.3 m across the live room.
  it("walks a trackpad flick about one notch in total, not one notch per event", () => {
    render(<InteriorCamera spawn={SPAWN} bounds={BOUNDS} />);
    frame();
    const before = window.__roomCamera?.position[2] ?? 0;

    for (let i = 0; i < 25; i += 1) wheel(-4);
    frame(240);

    const travelled = Math.abs((window.__roomCamera?.position[2] ?? 0) - before);
    expect(travelled).toBeGreaterThan(0.3);
    expect(travelled).toBeLessThan(1);
  });
});

describe("InteriorCamera canvas-owned resolution", () => {
  beforeEach(() => {
    fiber.frames.length = 0;
    fiber.gl.setPixelRatio(2);
    fiber.gl.setPixelRatio.mockClear();
  });
  afterEach(() => { cleanup(); });

  it("never resizes the canvas at rest, in motion, or after a display change and unmount", () => {
    const { unmount } = render(<InteriorCamera spawn={SPAWN} bounds={BOUNDS} managePixelRatio={false} />);
    frame();
    pointer("pointerdown", 800, 450);
    pointer("pointermove", 1000, 450);
    frame(2);
    pointer("pointerup", 1000, 450);
    frame(240);
    expect(fiber.gl.setPixelRatio).not.toHaveBeenCalled();

    // Model the sole Canvas owner reacting to a different native display DPR.
    fiber.gl.setPixelRatio(3);
    fiber.gl.setPixelRatio.mockClear();
    unmount();
    expect(fiber.gl.getPixelRatio()).toBe(3);
    expect(fiber.gl.setPixelRatio).not.toHaveBeenCalled();
  });

  it("preserves standalone camera resolution changes and restores its mount value", () => {
    const { unmount } = render(<InteriorCamera spawn={SPAWN} bounds={BOUNDS} settledDpr={2} motionDpr={1} />);
    frame();
    pointer("pointerdown", 800, 450);
    pointer("pointermove", 1000, 450);
    frame();
    expect(fiber.gl.getPixelRatio()).toBe(1);
    unmount();
    expect(fiber.gl.getPixelRatio()).toBe(2);
  });
});

describe("editable planner interior", () => {
  beforeEach(() => { fiber.frames.length = 0; });
  afterEach(() => { cleanup(); document.body.replaceChildren(); });

  it("reserves left drag for furniture and uses right drag to look", () => {
    render(<InteriorCamera spawn={SPAWN} bounds={BOUNDS} inputPolicy="planner" />);
    frame();
    pointer("pointerdown", 800, 450);
    pointer("pointermove", 1100, 450);
    pointer("pointerup", 1100, 450);
    frame(200);
    expect(window.__roomCamera?.yaw).toBe(0);
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    pointer("pointerdown", 800, 450, 2);
    pointer("pointermove", 1100, 450, 2);
    pointer("pointerup", 1100, 450, 2);
    frame(200);
    expect(Math.abs(window.__roomCamera?.yaw ?? 0)).toBeGreaterThan(0.1);
    expect(window.__roomCamera?.position).toEqual(SPAWN.position);
  });

  it("ignores typing and stops an already-held movement key when an input gains focus", () => {
    render(<InteriorCamera spawn={SPAWN} bounds={BOUNDS} inputPolicy="planner" />);
    frame();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    frame(3);
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    const before = window.__roomCamera?.position;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    frame(200);
    expect(window.__roomCamera?.position).toEqual(before);
  });

  it("does not move or look behind an open modal", () => {
    render(<InteriorCamera spawn={SPAWN} bounds={BOUNDS} inputPolicy="planner" />);
    frame();
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    document.body.append(modal);
    pointer("pointerdown", 800, 450, 2);
    pointer("pointermove", 1100, 450, 2);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    frame(200);
    expect(window.__roomCamera?.position).toEqual(SPAWN.position);
    expect(window.__roomCamera?.yaw).toBe(0);
  });

  it("leaves modified editing shortcuts with the editor", () => {
    render(<InteriorCamera spawn={SPAWN} bounds={BOUNDS} inputPolicy="planner" />);
    frame();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "d", metaKey: true }));
    frame(100);
    expect(window.__roomCamera?.position).toEqual(SPAWN.position);
  });

  it("preserves pitch through equal-value rerenders and restores it with Home", () => {
    const spawn = { ...SPAWN, pitch: 0.0784 };
    const { rerender } = render(<InteriorCamera spawn={spawn} bounds={BOUNDS} inputPolicy="planner" />);
    frame();
    expect(window.__roomCamera?.pitch).toBeCloseTo(0.0784);
    pointer("pointerdown", 800, 450, 2);
    pointer("pointermove", 900, 600, 2);
    pointer("pointerup", 900, 600, 2);
    frame(200);
    const turned = window.__roomCamera?.pitch;
    expect(turned).not.toBeCloseTo(0.0784);
    rerender(<InteriorCamera spawn={{ ...spawn, position: [...spawn.position] }} bounds={BOUNDS} inputPolicy="planner" />);
    frame(200);
    expect(window.__roomCamera?.pitch).toBe(turned);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));
    frame(200);
    expect(window.__roomCamera?.pitch).toBeCloseTo(0.0784);
  });

  it("yields all camera writes immediately when another owner takes over", () => {
    let owns = true;
    render(<InteriorCamera spawn={SPAWN} bounds={BOUNDS} inputPolicy="planner" ownsCamera={() => owns} />);
    frame();
    const before = window.__roomCamera;
    owns = false;
    pointer("pointerdown", 800, 450, 2);
    pointer("pointermove", 1200, 450, 2);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    frame(200);
    expect(window.__roomCamera).toBe(before);
  });

  function touch(type: string, x: number, y: number, pointerId = 42, isPrimary = true): void {
    const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true });
    Object.defineProperties(event, {
      pointerId: { value: pointerId }, pointerType: { value: "touch" }, isPrimary: { value: isPrimary },
    });
    fiber.canvas.dispatchEvent(event);
  }

  it("preserves touch taps for selection and consumes moved touch gestures as looking", () => {
    render(<InteriorCamera spawn={SPAWN} bounds={BOUNDS} inputPolicy="planner" />);
    const selectionUp = vi.fn();
    const selectionMove = vi.fn();
    fiber.canvas.addEventListener("pointerup", selectionUp);
    fiber.canvas.addEventListener("pointermove", selectionMove);
    try {
      frame();
      touch("pointerdown", 800, 450);
      touch("pointerup", 800, 450);
      expect(selectionUp).toHaveBeenCalledTimes(1);
      touch("pointerdown", 800, 450);
      touch("pointermove", 1000, 450);
      touch("pointermove", 1100, 450);
      touch("pointerup", 1100, 450);
      frame(200);
      expect(Math.abs(window.__roomCamera?.yaw ?? 0)).toBeGreaterThan(0.1);
      expect(selectionMove).not.toHaveBeenCalled();
      expect(selectionUp).toHaveBeenCalledTimes(1);
    } finally {
      fiber.canvas.removeEventListener("pointerup", selectionUp);
      fiber.canvas.removeEventListener("pointermove", selectionMove);
    }
  });

  it("leaves touch gestures to an active placement or drawing tool", () => {
    render(<InteriorCamera spawn={SPAWN} bounds={BOUNDS} inputPolicy="planner" touchLookEnabled={() => false} />);
    frame();
    touch("pointerdown", 800, 450);
    touch("pointermove", 1100, 450);
    touch("pointerup", 1100, 450);
    frame(200);
    expect(window.__roomCamera?.yaw).toBe(0);
  });

  it("suppresses the second finger's release even after the navigation finger lifts", () => {
    render(<InteriorCamera spawn={SPAWN} bounds={BOUNDS} inputPolicy="planner" />);
    const selectionUp = vi.fn();
    fiber.canvas.addEventListener("pointerup", selectionUp);
    try {
      frame();
      touch("pointerdown", 800, 450);
      touch("pointerdown", 1000, 450, 43, false);
      touch("pointermove", 1100, 450);
      touch("pointerup", 1100, 450);
      touch("pointerup", 1000, 450, 43, false);
      expect(selectionUp).not.toHaveBeenCalled();
    } finally { fiber.canvas.removeEventListener("pointerup", selectionUp); }
  });

  it("cancels queued and held movement when D opens drawing or a furniture edit takes ownership", () => {
    render(<InteriorCamera spawn={SPAWN} bounds={BOUNDS} inputPolicy="planner"
      keyboardNavigationEnabled={plannerKeyboardNavigationEnabled} />);
    // Register after the camera deliberately: even if it receives D first,
    // the frame must observe the drawing shortcut's actual store transition.
    const drawingShortcut = (event: KeyboardEvent): void => {
      if (event.code === "KeyD") useMarkupStore.getState().setActive(true);
    };
    window.addEventListener("keydown", drawingShortcut);
    try {
      frame();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d", code: "KeyD" }));
      frame(100);
      expect(useMarkupStore.getState().active).toBe(true);
      expect(window.__roomCamera?.position).toEqual(SPAWN.position);
      useMarkupStore.getState().setActive(false);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", code: "KeyW" }));
      frame(3);
      const before = window.__roomCamera?.position;
      useSelectionStore.getState().select("editing-fixture");
      frame(100);
      expect(window.__roomCamera?.position).toEqual(before);
    } finally {
      window.removeEventListener("keydown", drawingShortcut);
      useMarkupStore.getState().setActive(false);
      useSelectionStore.getState().clearSelection();
    }
  });
});
