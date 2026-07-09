import { beforeEach, describe, expect, it } from "vitest";
import {
  FIRST_LIGHT_FOV_OFFSET_DEG,
  FIRST_LIGHT_PITCH_OFFSET_RAD,
  FIRST_LIGHT_YAW_OFFSET_RAD,
  firstLightEligible,
  firstLightSeen,
  markFirstLightSeen,
} from "../first-light.js";

// -----------------------------------------------------------------------------
// first-light — the establishing reveal's pure logic (SS++ phase 1). Pins the
// eligibility gate (pristine first entries only), the once-per-session latch,
// and the taste constraint that the whole crane stays a whisper (<15°).
// -----------------------------------------------------------------------------

const pristine = {
  hasNodeParam: false,
  hasLookParam: false,
  hasModeParam: false,
  reducedMotion: false,
  seenThisSession: false,
};

describe("firstLightEligible", () => {
  it("runs on a pristine, motion-tolerant first entry", () => {
    expect(firstLightEligible(pristine)).toBe(true);
  });

  it("stays out of the way of every arrival with intent", () => {
    expect(firstLightEligible({ ...pristine, hasNodeParam: true })).toBe(false);
    expect(firstLightEligible({ ...pristine, hasLookParam: true })).toBe(false);
    expect(firstLightEligible({ ...pristine, hasModeParam: true })).toBe(false);
  });

  it("skips under reduced motion and after it has already played", () => {
    expect(firstLightEligible({ ...pristine, reducedMotion: true })).toBe(false);
    expect(firstLightEligible({ ...pristine, seenThisSession: true })).toBe(false);
  });
});

describe("session latch", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("latches once and reads back", () => {
    expect(firstLightSeen()).toBe(false);
    markFirstLightSeen();
    expect(firstLightSeen()).toBe(true);
  });
});

describe("choreography restraint", () => {
  it("the whole crane is a whisper — under 15 degrees, a few degrees of fov", () => {
    const yawDeg = (FIRST_LIGHT_YAW_OFFSET_RAD * 180) / Math.PI;
    const pitchDeg = (FIRST_LIGHT_PITCH_OFFSET_RAD * 180) / Math.PI;
    expect(yawDeg).toBeLessThan(15);
    expect(pitchDeg).toBeLessThan(15);
    expect(FIRST_LIGHT_FOV_OFFSET_DEG).toBeLessThanOrEqual(5);
  });
});
