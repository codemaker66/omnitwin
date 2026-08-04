import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  DAMPING_FACTOR,
  DAMPING_SETTLE_FRAMES,
  ZOOM_FRICTION,
  ZOOM_VELOCITY_THRESHOLD,
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

  it("disables desktop right-button mouse orbit in lean control mode", async () => {
    const source = await readFile("src/components/CameraRig.tsx", "utf8");

    expect(source).toContain("RIGHT: (smoothControls ? 0 : -1) as number");
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
});
