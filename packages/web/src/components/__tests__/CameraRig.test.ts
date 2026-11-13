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
  computeZoomFrameScale,
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
