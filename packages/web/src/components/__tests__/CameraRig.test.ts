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

  it("emits OrbitControls performance regression, because planner DPR is no longer fixed", async () => {
    const source = await readFile("src/components/CameraRig.tsx", "utf8");

    // T-618 replaced the fixed planner DPR with PlannerAdaptiveResolution,
    // which reads R3F's performance signal. OrbitControls' own touch gestures
    // never reach the rig's wheel handler, so `regress` is the only path that
    // sees a pinch-zoom; without it a two-finger zoom on a phone would render
    // at full resolution throughout.
    expect(/\n\s*regress\r?\n/u.test(source)).toBe(true);
    expect(source).not.toContain("regress={false}");
    expect(source).not.toContain("regress={smoothControls}");
  });

  it("holds the camera still while an object drag owns the pointer", async () => {
    const source = await readFile("src/components/CameraRig.tsx", "utf8");

    // Touch has one button, so one finger has to mean both "orbit the room"
    // and "move this table". SelectionSystem takes the lock inside the same
    // pointerdown; the rig has to honour it in BOTH places, or the per-frame
    // arbitration hands orbit back on the very next frame and the room turns
    // under the finger.
    expect(source).toContain("subscribePlannerCameraLock");
    expect(source).toContain("|| plannerCameraLocked()");
    // Module state outlives the tree: a planner that unmounts mid-drag must
    // not leave the next one unable to orbit.
    expect(source).toContain("useEffect(() => resetPlannerCameraLock, [])");
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
