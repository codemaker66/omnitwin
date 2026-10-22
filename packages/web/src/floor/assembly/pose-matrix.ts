// ---------------------------------------------------------------------------
// A Grand Assembly pose as the matrix a piece is drawn with.
//
//   M = T(x, y, z) · Lean · Roll · Ry(yaw) · Pivot(sx, sy, sz about pivotY) · S(saved scale)
//
// Lean tips the top toward (leanX, leanZ) about the base, as the planner's
// own carry lean does (lib/furniture-motion.ts); Roll tips the piece about a
// horizontal axis through a point above its base (a round set down from its
// edge). At rest every factor but T, Ry and the saved scale is the identity,
// so M is the saved transform.
// ---------------------------------------------------------------------------

import { Matrix4, Quaternion, Vector3 } from "three";
import type { PiecePose } from "./engine.js";

const lean = new Quaternion();
const roll = new Quaternion();
const turn = new Quaternion();
const axis = new Vector3();
const place = new Vector3();
const size = new Vector3();
const up = new Vector3(0, 1, 0);
const step = new Matrix4();

export function composePieceMatrix(pose: PiecePose, savedScale: number, target: Matrix4): Matrix4 {
  // Pivot scale and the saved scale: T(0, p, 0) · S · T(0, -p, 0) · S(saved).
  target.makeScale(pose.sx * savedScale, pose.sy * savedScale, pose.sz * savedScale);
  if (pose.pivotY !== 0) target.elements[13] = pose.pivotY * (1 - pose.sy);
  // Turn.
  turn.setFromAxisAngle(up, pose.yaw);
  target.premultiply(step.makeRotationFromQuaternion(turn));
  // Roll about (axis) through (0, rollPivot, 0).
  if (pose.roll !== 0) {
    axis.set(pose.rollAxisX, 0, pose.rollAxisZ);
    if (axis.lengthSq() > 1e-12) {
      axis.normalize();
      roll.setFromAxisAngle(axis, pose.roll);
      target.premultiply(step.makeTranslation(0, -pose.rollPivot, 0));
      target.premultiply(step.makeRotationFromQuaternion(roll));
      target.premultiply(step.makeTranslation(0, pose.rollPivot, 0));
    }
  }
  // Lean about the base: the top moves along (leanX, leanZ).
  const angle = Math.hypot(pose.leanX, pose.leanZ);
  if (angle > 1e-9) {
    axis.set(pose.leanZ / angle, 0, -pose.leanX / angle);
    lean.setFromAxisAngle(axis, angle);
    target.premultiply(step.makeRotationFromQuaternion(lean));
  }
  target.premultiply(step.makeTranslation(pose.x, pose.y, pose.z));
  return target;
}

/** The saved transform, composed as the planner's instanced layer composes it. */
export function savedPieceMatrix(x: number, y: number, z: number, rotationY: number, scale: number, target: Matrix4): Matrix4 {
  turn.setFromAxisAngle(up, rotationY);
  return target.compose(place.set(x, y, z), turn, size.set(scale, scale, scale));
}
