import { describe, expect, it } from "vitest";
import {
  HUMAN_POV_MAX_PITCH_RAD,
  computeHumanPovLookAngles,
  isHumanPovExitKey,
  isHumanPovPointerButton,
} from "../human-pov-camera.js";

describe("human POV camera controls", () => {
  it("turns from the starting eye-point angles instead of orbiting a room target", () => {
    const next = computeHumanPovLookAngles(
      { yaw: 0.5, pitch: 0.1 },
      { deltaX: 100, deltaY: -25 },
    );

    expect(next.yaw).toBeLessThan(0.5);
    expect(next.pitch).toBeGreaterThan(0.1);
  });

  it("clamps pitch to a human neck range", () => {
    const lookingUp = computeHumanPovLookAngles(
      { yaw: 0, pitch: 0 },
      { deltaX: 0, deltaY: -10000 },
    );
    const lookingDown = computeHumanPovLookAngles(
      { yaw: 0, pitch: 0 },
      { deltaX: 0, deltaY: 10000 },
    );

    expect(lookingUp.pitch).toBe(HUMAN_POV_MAX_PITCH_RAD);
    expect(lookingDown.pitch).toBe(-HUMAN_POV_MAX_PITCH_RAD);
  });

  it("only starts human look on right-button pointer input", () => {
    expect(isHumanPovPointerButton(2)).toBe(true);
    expect(isHumanPovPointerButton(0)).toBe(false);
    expect(isHumanPovPointerButton(1)).toBe(false);
  });

  it("uses Escape as the explicit exit back to planner camera mode", () => {
    expect(isHumanPovExitKey("Escape")).toBe(true);
    expect(isHumanPovExitKey("KeyE")).toBe(false);
  });
});
