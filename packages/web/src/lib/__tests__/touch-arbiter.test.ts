// One state machine owns every touch on the room (spec-card-dock §10.1, law 12): a swipe looks
// round even with a card in hand, a second finger walks and zooms and never places, a quick tap
// places under the finger, a hold raises the ghost above it, and a held piece lifts.
import { describe, expect, it } from "vitest";
import {
  FingerTrail,
  GHOST_RAISE_PX,
  GHOST_RAISE_SHORT_PX,
  HOLD_RING_DELAY_MS,
  LIFT_HOLD_MS,
  LIFT_OFF_JITTER_MS,
  PLACE_HOLD_MS,
  TOUCH_SLOP_PX,
  TouchArbiter,
  ghostRaisePx,
} from "../touch-arbiter.js";

const FIRST = 1;
const SECOND = 2;

function pressed(arbiter: TouchArbiter, { armed = false, onPiece = false, at = 0, x = 100, y = 400 } = {}): void {
  arbiter.press({ pointerId: FIRST, at, x, y, armed, onPiece });
}

describe("TouchArbiter", () => {
  it("waits on a fresh press: nothing placed, lifted or looked at yet", () => {
    const arbiter = new TouchArbiter();
    expect(arbiter.mode).toBe("idle");
    pressed(arbiter, { armed: true });
    expect(arbiter.mode).toBe("pending");
  });

  it("looks round on a swipe before 150 ms, even with a card in hand", () => {
    const arbiter = new TouchArbiter();
    pressed(arbiter, { armed: true });
    expect(arbiter.move(FIRST, 40, 100 + TOUCH_SLOP_PX - 1, 400)).toBe("pending");
    expect(arbiter.move(FIRST, 60, 100 + TOUCH_SLOP_PX + 1, 400)).toBe("orbit");
    expect(arbiter.release(FIRST, 300, 160, 400)).toEqual({ kind: "none" });
    expect(arbiter.mode).toBe("idle");
  });

  it("places under the finger on a quick tap when armed, and selects on one when not", () => {
    const armed = new TouchArbiter();
    pressed(armed, { armed: true });
    armed.move(FIRST, 50, 103, 402);
    expect(armed.release(FIRST, PLACE_HOLD_MS - 1, 103, 402)).toEqual({ kind: "tap", armed: true, x: 103, y: 402 });

    const empty = new TouchArbiter();
    pressed(empty, { onPiece: true });
    expect(empty.release(FIRST, 120, 100, 400)).toEqual({ kind: "tap", armed: false, x: 100, y: 400 });
  });

  it("raises the ghost once an armed press holds 150 ms within the slop, and lifting places it there", () => {
    const arbiter = new TouchArbiter();
    pressed(arbiter, { armed: true });
    expect(arbiter.tick(PLACE_HOLD_MS - 1)).toBe("pending");
    expect(arbiter.tick(PLACE_HOLD_MS)).toBe("place");
    // The finger slides; the ghost follows above it.
    expect(arbiter.move(FIRST, 200, 180, 360)).toBe("place");
    expect(arbiter.finger).toEqual({ x: 180, y: 360 });
    expect(arbiter.release(FIRST, 400, 181, 361)).toEqual({ kind: "place", at: 400 });
    expect(arbiter.mode).toBe("idle");
  });

  it("raises the ghost from a late event's own time, though the timer that should have fired ran late", () => {
    const arbiter = new TouchArbiter();
    pressed(arbiter, { armed: true });
    // A busy page delivers the first move at 180 ms, already 30 px away: the press held still until then.
    expect(arbiter.move(FIRST, 180, 130, 400)).toBe("place");
  });

  it("places nothing once a second finger lands, wherever the first was", () => {
    for (const before of ["pending", "place", "orbit"] as const) {
      const arbiter = new TouchArbiter();
      pressed(arbiter, { armed: true });
      if (before === "place") arbiter.tick(PLACE_HOLD_MS);
      if (before === "orbit") arbiter.move(FIRST, 20, 140, 400);
      expect(arbiter.mode).toBe(before);
      expect(arbiter.press({ pointerId: SECOND, at: 250, x: 220, y: 500, armed: true, onPiece: false })).toBe("two");
      expect(arbiter.release(SECOND, 600, 220, 520)).toEqual({ kind: "none" });
      expect(arbiter.mode).toBe("two");
      expect(arbiter.fingers).toBe(1);
      expect(arbiter.release(FIRST, 620, 100, 400)).toEqual({ kind: "none" });
      expect(arbiter.mode).toBe("idle");
      expect(arbiter.idle).toBe(true);
      expect(arbiter.fingers).toBe(0);
    }
  });

  it("lifts a piece held 300 ms within the slop when nothing is armed, and lifting the finger drops it", () => {
    const arbiter = new TouchArbiter();
    pressed(arbiter, { onPiece: true });
    expect(arbiter.tick(LIFT_HOLD_MS - 1)).toBe("pending");
    expect(arbiter.tick(LIFT_HOLD_MS)).toBe("lift");
    expect(arbiter.move(FIRST, 400, 160, 380)).toBe("lift");
    expect(arbiter.release(FIRST, 600, 160, 380)).toEqual({ kind: "drop" });
  });

  it("returns a lifted piece when a second finger lands", () => {
    const arbiter = new TouchArbiter();
    pressed(arbiter, { onPiece: true });
    arbiter.tick(LIFT_HOLD_MS);
    expect(arbiter.press({ pointerId: SECOND, at: 400, x: 200, y: 500, armed: false, onPiece: false })).toBe("two");
    expect(arbiter.liftCancelled).toBe(true);
  });

  it("looks round on a slow swipe when nothing is armed, before a hold could lift", () => {
    const arbiter = new TouchArbiter();
    pressed(arbiter, { onPiece: true });
    expect(arbiter.move(FIRST, 220, 120, 400)).toBe("orbit");
  });

  it("never lifts empty floor: a long still press there is a tap", () => {
    const arbiter = new TouchArbiter();
    pressed(arbiter);
    expect(arbiter.tick(LIFT_HOLD_MS + 200)).toBe("pending");
    expect(arbiter.release(FIRST, LIFT_HOLD_MS + 300, 101, 400)).toEqual({ kind: "tap", armed: false, x: 101, y: 400 });
  });

  it("shows the hold ring only on a piece that could lift, after 100 ms, filling over the next 200", () => {
    const arbiter = new TouchArbiter();
    pressed(arbiter, { onPiece: true });
    expect(arbiter.holdProgress(HOLD_RING_DELAY_MS - 1)).toBeNull();
    expect(arbiter.holdProgress(HOLD_RING_DELAY_MS)).toBe(0);
    expect(arbiter.holdProgress(HOLD_RING_DELAY_MS + 100)).toBeCloseTo(0.5, 6);
    arbiter.tick(LIFT_HOLD_MS);
    expect(arbiter.holdProgress(LIFT_HOLD_MS)).toBeNull();

    const armed = new TouchArbiter();
    pressed(armed, { armed: true, onPiece: true });
    expect(armed.holdProgress(140)).toBeNull();
  });

  it("forgets the gesture when the browser cancels the touch", () => {
    const arbiter = new TouchArbiter();
    pressed(arbiter, { onPiece: true });
    arbiter.tick(LIFT_HOLD_MS);
    arbiter.cancel();
    expect(arbiter.mode).toBe("idle");
    expect(arbiter.liftCancelled).toBe(true);
  });

  it("ignores pointers it never saw pressed", () => {
    const arbiter = new TouchArbiter();
    expect(arbiter.move(9, 10, 50, 50)).toBe("idle");
    expect(arbiter.release(9, 20, 50, 50)).toEqual({ kind: "none" });
  });
});

describe("FingerTrail", () => {
  it("gives where the finger was 40 ms before it lifted, past the roll of a finger leaving the glass", () => {
    const trail = new FingerTrail();
    trail.record(1000, 100, 400);
    trail.record(1016, 110, 400);
    trail.record(1032, 120, 400);
    // The finger rolls 9 px in its last 16 ms.
    trail.record(1048, 129, 404);
    expect(trail.at(1048 - LIFT_OFF_JITTER_MS)).toEqual({ x: 100, y: 400 });
    expect(trail.at(1040)).toEqual({ x: 120, y: 400 });
  });

  it("gives the first point when the press is younger than the jitter, and nothing before any", () => {
    const trail = new FingerTrail();
    expect(trail.at(50)).toBeNull();
    trail.record(1000, 100, 400);
    expect(trail.at(900)).toEqual({ x: 100, y: 400 });
    trail.clear();
    expect(trail.at(1000)).toBeNull();
  });

  it("keeps only the recent past", () => {
    const trail = new FingerTrail();
    for (let at = 0; at < 10_000; at += 8) trail.record(at, at, 0);
    expect(trail.size).toBeLessThanOrEqual(64);
    expect(trail.at(9_990)?.x).toBe(9_984);
  });
});

describe("ghostRaisePx", () => {
  it("raises the ghost 64 px above the finger, 56 on a phone under 700 px tall", () => {
    expect(ghostRaisePx(852)).toBe(GHOST_RAISE_PX);
    expect(ghostRaisePx(699)).toBe(GHOST_RAISE_SHORT_PX);
    expect(GHOST_RAISE_PX).toBe(64);
    expect(GHOST_RAISE_SHORT_PX).toBe(56);
  });
});
