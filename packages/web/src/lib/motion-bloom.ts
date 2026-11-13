// ---------------------------------------------------------------------------
// Bloom in motion
//
// On a profile that pauses bloom while the view moves (`bloomInMotion` in
// lib/render-quality.ts), the pipeline asks each drawn frame for bloom's
// weight. While a hand is on the view or the camera moved since the frame
// before, the weight is 0 and bloom's twelve passes are skipped: about half of
// a slowed phone's frame (perf study, 25 Oct 2026). Once the view is still,
// the glow returns on the detent spring, most of the way in 150 ms, rather
// than popping in.
// ---------------------------------------------------------------------------

import type { Camera } from "three";
import { SPRING_PRESETS, isSpringSettled, stepSpring, type SpringState } from "./springs.js";

/** Close enough to full glow to stop drawing frames for it. */
const RETURNED = 0.005;

/** Bloom's weight frame by frame on a profile that pauses it in motion. */
export class MotionBloom {
  private readonly spring: SpringState = { value: 1, velocity: 0 };
  /** When the return last stepped, ms, or null when it is not under way. */
  private steppedAt: number | null = null;

  /** Whether the glow is on its way back, so frames must follow until it is home. */
  get returning(): boolean {
    return this.steppedAt !== null;
  }

  /**
   * Bloom's weight, 0 to 1, for a frame drawn at `now` (ms): 0 while `moving`,
   * and from the first still frame, however long the hand rested, the return
   * on the detent spring.
   */
  frame(now: number, moving: boolean): number {
    const spring = this.spring;
    if (moving) {
      spring.value = 0;
      spring.velocity = 0;
      this.steppedAt = null;
      return 0;
    }
    const seconds = this.steppedAt === null ? 0 : (now - this.steppedAt) / 1000;
    stepSpring(spring, 1, seconds, SPRING_PRESETS.detent);
    if (isSpringSettled(spring, 1, RETURNED)) {
      spring.value = 1;
      spring.velocity = 0;
      this.steppedAt = null;
      return 1;
    }
    this.steppedAt = now;
    return Math.min(1, Math.max(0, spring.value));
  }
}

/** A camera this close to where it was has not visibly moved: metres, and the rotation's and lens's own units. */
const POSE_EPSILON = 1e-6;
/** Position (3), orientation (4) and the projection matrix (16). */
const POSE_LENGTH = 23;

/** Whether a camera moved between the frames it is shown: its position, orientation or lens. */
export class CameraPoseWatch {
  private readonly last = new Float64Array(POSE_LENGTH);
  private primed = false;

  /** Whether `camera` moved since the last call; false on the first. */
  changed(camera: Camera): boolean {
    const { position, quaternion } = camera;
    const lens = camera.projectionMatrix.elements;
    let moved = false;
    const take = (index: number, value: number): void => {
      if (Math.abs(value - (this.last[index] ?? 0)) > POSE_EPSILON) moved = true;
      this.last[index] = value;
    };
    take(0, position.x);
    take(1, position.y);
    take(2, position.z);
    take(3, quaternion.x);
    take(4, quaternion.y);
    take(5, quaternion.z);
    take(6, quaternion.w);
    for (let index = 0; index < 16; index++) take(7 + index, lens[index] ?? 0);
    const primed = this.primed;
    this.primed = true;
    return primed && moved;
  }
}
