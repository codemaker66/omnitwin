// ---------------------------------------------------------------------------
// A Grand Assembly pose as the matrix a piece is drawn with.
//
//   M = T(x, y, z) · Lean · [T(0, p, 0) · Tilt · Grow · T(0, -p, 0)] · Squash · Ry(yaw) · S(saved scale)
//
// Squash keeps the piece's volume about its base (the planner's own set-down,
// lib/furniture-motion.ts); Grow and Tilt act about a point p above the base,
// so a piece can grow out of a point of light and tip like a falling leaf
// about its own middle; Lean tips the top about the base, as a carried piece
// trails its hand. At rest every factor but T, Ry and the saved scale is the
// identity, so M is the saved transform.
// ---------------------------------------------------------------------------

import { Matrix4, Quaternion, Vector3 } from "three";
import type { PiecePose } from "./engine.js";

const rotation = new Quaternion();
const axis = new Vector3();
const place = new Vector3();
const size = new Vector3();
const up = new Vector3(0, 1, 0);
const step = new Matrix4();

export function composePieceMatrix(pose: PiecePose, savedScale: number, target: Matrix4): Matrix4 {
  // Squash about the base on the saved scale. It is symmetric about the
  // vertical, so it commutes with the turn.
  const spread = 1 - pose.squash * 0.5;
  target.makeScale(spread * savedScale, (1 + pose.squash) * savedScale, spread * savedScale);
  rotation.setFromAxisAngle(up, pose.yaw);
  target.premultiply(step.makeRotationFromQuaternion(rotation));
  // Grow and tilt about the pivot.
  const tilt = Math.hypot(pose.tiltX, pose.tiltZ);
  if (pose.grow !== 1 || tilt > 1e-9) {
    target.premultiply(step.makeTranslation(0, -pose.pivot, 0));
    if (pose.grow !== 1) target.premultiply(step.makeScale(pose.grow, pose.grow, pose.grow));
    if (tilt > 1e-9) {
      axis.set(pose.tiltX / tilt, 0, pose.tiltZ / tilt);
      rotation.setFromAxisAngle(axis, tilt);
      target.premultiply(step.makeRotationFromQuaternion(rotation));
    }
    target.premultiply(step.makeTranslation(0, pose.pivot, 0));
  }
  // Lean about the base: the top moves along (leanX, leanZ).
  const angle = Math.hypot(pose.leanX, pose.leanZ);
  if (angle > 1e-9) {
    axis.set(pose.leanZ / angle, 0, -pose.leanX / angle);
    rotation.setFromAxisAngle(axis, angle);
    target.premultiply(step.makeRotationFromQuaternion(rotation));
  }
  target.premultiply(step.makeTranslation(pose.x, pose.y, pose.z));
  return target;
}

/** The saved transform, composed as the planner's instanced layer composes it. */
export function savedPieceMatrix(x: number, y: number, z: number, rotationY: number, scale: number, target: Matrix4): Matrix4 {
  rotation.setFromAxisAngle(up, rotationY);
  return target.compose(place.set(x, y, z), rotation, size.set(scale, scale, scale));
}

/**
 * The rotation vector that tips a piece's top toward the horizontal direction
 * (dx, dz) by `angle` radians: about up × direction.
 */
export function tiltToward(dx: number, dz: number, angle: number): { readonly x: number; readonly z: number } {
  const length = Math.hypot(dx, dz);
  if (length < 1e-9) return { x: 0, z: 0 };
  return { x: (dz / length) * angle, z: (-dx / length) * angle };
}
