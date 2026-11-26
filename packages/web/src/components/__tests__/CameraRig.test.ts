import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  DAMPING_FACTOR,
  DAMPING_SETTLE_FRAMES,
  MAX_ZOOM_FRAME_DELTA_SECONDS,
  PAN_SPEED,
  ZOOM_FRICTION,
  ZOOM_VELOCITY_THRESHOLD,
  computeKeyboardPanStep,
  computePanBounds,
  computeZoomFrameScale,
  holdOrbitTarget,
  zoomWhileFingersDown,
} from "../../lib/camera-rig.js";

describe("CameraRig source guards", () => {
  it("keeps planner navigation tuned for immediate post-input response", () => {
    expect(DAMPING_FACTOR).toBeGreaterThanOrEqual(0.18);
    expect(DAMPING_SETTLE_FRAMES).toBeLessThanOrEqual(24);
    expect(ZOOM_FRICTION).toBeGreaterThanOrEqual(0.14);
    expect(ZOOM_VELOCITY_THRESHOLD).toBeLessThanOrEqual(0.001);
  });

  it("suppresses the browser context menu for right-drag orbit outside human POV mode", async () => {
    const source = await readFile("src/components/CameraRig.tsx", "utf8");
    const handlerMatch = /function onContextMenu\(event: MouseEvent\): void \{[\s\S]*?\n {4}\}/u.exec(source);
    const handler = handlerMatch?.[0] ?? "";

    expect(handler).toContain("event.preventDefault();");
    expect(handler).not.toContain("humanPovActiveRef");
    expect(source).toContain('canvas.addEventListener("contextmenu", onContextMenu);');
  });

  it("keeps right-button mouse orbit at every width, compact windows included", async () => {
    const source = await readFile("src/components/CameraRig.tsx", "utf8");

    expect(source).toContain("RIGHT: 0 as number");
    expect(source).not.toContain("smoothControls ? 0 : -1");
  });

  it("does not emit OrbitControls performance regression events when planner DPR is fixed", async () => {
    const source = await readFile("src/components/CameraRig.tsx", "utf8");

    expect(source).toContain("regress={false}");
    expect(source).not.toContain("regress={smoothControls}");
  });

  it("marks camera interaction active only on OrbitControls start/end boundaries", async () => {
    const source = await readFile("src/components/CameraRig.tsx", "utf8");

    expect(source).toContain("setCameraInteractionActive(true)");
    expect(source).toContain("setCameraInteractionActive(false)");
    expect(source).toContain("onStart={markCameraInteractionActive}");
    expect(source).toContain("onEnd={markCameraInteractionSettling}");
    expect(source).not.toContain("setCameraInteractionActive(true);\\n    invalidate();");
  });

  it("caps an idle demand-render frame before applying wheel zoom", () => {
    expect(computeZoomFrameScale(1 / 60)).toBeCloseTo(1);
    expect(computeZoomFrameScale(1 / 30)).toBeCloseTo(2);
    // Two idle seconds must not become 120 frames of zoom in one step.
    expect(computeZoomFrameScale(2)).toBeCloseTo(MAX_ZOOM_FRAME_DELTA_SECONDS * 60);
    expect(computeZoomFrameScale(Number.NaN)).toBe(0);
    expect(computeZoomFrameScale(-1)).toBe(0);
  });

  it("applies the capped scale in the inertial zoom step", async () => {
    const source = await readFile("src/components/CameraRig.tsx", "utf8");

    expect(source).toContain("zoomVelocity.current * computeZoomFrameScale(delta)");
    expect(source).not.toContain("zoomVelocity.current * delta * 60");
  });

  it("caps an idle demand-render frame before panning on held arrows", () => {
    expect(computeKeyboardPanStep(1 / 60, 1)).toBeCloseTo(PAN_SPEED / 60);
    expect(computeKeyboardPanStep(1 / 60, 0.5)).toBeCloseTo(PAN_SPEED / 120);
    // Two idle seconds must not throw the view 20 m in one step.
    expect(computeKeyboardPanStep(2, 1)).toBeCloseTo(PAN_SPEED * MAX_ZOOM_FRAME_DELTA_SECONDS);
    expect(computeKeyboardPanStep(Number.NaN, 1)).toBe(0);
    expect(computeKeyboardPanStep(-1, 1)).toBe(0);
  });

  it("applies the capped step in the keyboard pan", async () => {
    const source = await readFile("src/components/CameraRig.tsx", "utf8");

    expect(source).toContain("const speed = computeKeyboardPanStep(delta, speedScale);");
    expect(source).not.toContain("PAN_SPEED * speedScale * delta");
  });

  it("gives every wheel one zoom path: OrbitControls zooms only for a finger's pinch", async () => {
    const source = await readFile("src/components/CameraRig.tsx", "utf8");

    expect(source).toContain("enableZoom={false}");
    expect(source).toContain("zoomWhileFingersDown(window,");
    expect(source).not.toContain("useIsTouchDevice");
  });
});

describe("computePanBounds", () => {
  it("is the floor plan with a fifth of each side as margin, and as far below the floor and above the ceiling as that reaches across", () => {
    expect(computePanBounds({ width: 20, length: 10, height: 7 })).toEqual({
      minX: -14, maxX: 14, minY: -14, maxY: 21, minZ: -7, maxZ: 7,
    });
  });

  it("follows an outline drawn off the room's origin: its own box, with the same margin", () => {
    expect(computePanBounds({ width: 20, length: 10, height: 3 }, { minX: 0, maxX: 20, minZ: 0, maxZ: 10 })).toEqual({
      minX: -4, maxX: 24, minY: -14, maxY: 17, minZ: -2, maxZ: 12,
    });
  });
});

describe("holdOrbitTarget", () => {
  const bounds = computePanBounds({ width: 20, length: 10, height: 7 });
  const point = (x: number, y: number, z: number): { x: number; y: number; z: number } => ({ x, y, z });

  it("leaves a target inside the bounds alone", () => {
    const target = point(3, 1, -2);
    const camera = point(3, 12, 10);
    expect(holdOrbitTarget(target, camera, bounds, point(0, 1, 0))).toBe(false);
    expect(target).toEqual(point(3, 1, -2));
    expect(camera).toEqual(point(3, 12, 10));
  });

  it("stops a target at each bound it passed and moves the camera by the same correction", () => {
    const target = point(20, -16, 9);
    const camera = point(20, -5, 21);
    expect(holdOrbitTarget(target, camera, bounds, point(13, 1, 6))).toBe(true);
    expect(target).toEqual(point(14, -14, 7));
    expect(camera, "the camera keeps its offset from the target").toEqual(point(14, -3, 19));

    const other = point(-16, 23, -8);
    const otherCamera = point(-16, 33, 4);
    expect(holdOrbitTarget(other, otherCamera, bounds, point(-13, 20, -6))).toBe(true);
    expect(other, "the opposite bound on each axis").toEqual(point(-14, 21, -7));
    expect(otherCamera).toEqual(point(-14, 31, 5));
  });

  it("holds each axis on its own, so the rest of a pan slides along a bound", () => {
    const target = point(16, 2, 4);
    const camera = point(16, 12, 16);
    holdOrbitTarget(target, camera, bounds, point(14, 2, 1));
    expect(target).toEqual(point(14, 2, 4));
    expect(camera).toEqual(point(14, 12, 16));
  });

  it("never pulls in a target that code left outside, and lets a pan carry it no further out", () => {
    // A glide left the target high above and in front of the room.
    const from = point(0, 40, -60);
    const stays = point(0, 40, -60);
    expect(holdOrbitTarget(stays, point(0, 60, -80), bounds, from), "where code left it").toBe(false);

    const further = point(2, 45, -70);
    const camera = point(2, 65, -50);
    holdOrbitTarget(further, camera, bounds, from);
    expect(further, "no higher and no further in front than it was").toEqual(point(2, 40, -60));
    expect(camera).toEqual(point(2, 60, -40));

    const back = point(0, 30, -50);
    expect(holdOrbitTarget(back, point(0, 50, -30), bounds, from), "a pan back towards the room").toBe(false);
    expect(back).toEqual(point(0, 30, -50));
  });
});

describe("zoomWhileFingersDown", () => {
  function pointer(type: string, pointerType: string, pointerId: number): PointerEvent {
    return new PointerEvent(type, { pointerType, pointerId });
  }

  it("turns zoom on at the first finger and off when the last one lifts", () => {
    const target = new EventTarget();
    const calls: boolean[] = [];
    const stop = zoomWhileFingersDown(target, (on) => { calls.push(on); });

    target.dispatchEvent(pointer("pointerdown", "touch", 1));
    target.dispatchEvent(pointer("pointerdown", "touch", 2));
    target.dispatchEvent(pointer("pointerup", "touch", 1));
    expect(calls).toEqual([true]);

    target.dispatchEvent(pointer("pointercancel", "touch", 2));
    expect(calls).toEqual([true, false]);
    stop();
  });

  it("ignores the mouse, the pen and a lift it never saw go down", () => {
    const target = new EventTarget();
    const calls: boolean[] = [];
    const stop = zoomWhileFingersDown(target, (on) => { calls.push(on); });

    target.dispatchEvent(pointer("pointerdown", "mouse", 1));
    target.dispatchEvent(pointer("pointerdown", "pen", 2));
    target.dispatchEvent(pointer("pointerup", "touch", 3));
    expect(calls).toEqual([]);
    stop();
  });

  it("forgets every finger when the window loses focus", () => {
    const target = new EventTarget();
    const calls: boolean[] = [];
    const stop = zoomWhileFingersDown(target, (on) => { calls.push(on); });

    target.dispatchEvent(pointer("pointerdown", "touch", 1));
    target.dispatchEvent(new Event("blur"));
    expect(calls).toEqual([true, false]);
    // The dropped finger's id is gone: the next finger turns the zoom on and off again.
    target.dispatchEvent(pointer("pointerdown", "touch", 2));
    target.dispatchEvent(pointer("pointerup", "touch", 2));
    expect(calls).toEqual([true, false, true, false]);
    // A blur with no finger down changes nothing.
    target.dispatchEvent(new Event("blur"));
    expect(calls).toHaveLength(4);
    stop();
  });

  it("stops listening once unsubscribed", () => {
    const target = new EventTarget();
    const calls: boolean[] = [];
    zoomWhileFingersDown(target, (on) => { calls.push(on); })();

    target.dispatchEvent(pointer("pointerdown", "touch", 1));
    expect(calls).toEqual([]);
  });
});
