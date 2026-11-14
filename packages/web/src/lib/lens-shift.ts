import { PerspectiveCamera } from "three";

// ---------------------------------------------------------------------------
// A view camera's rise and fall, for a perspective camera
//
// An architectural photographer keeps the camera level, so every upright in a
// room stays upright in the picture, and moves the picture across the lens
// instead of tilting the camera. three.js has that movement sideways only
// (filmOffset). This gives it both ways, measured in pictures: a fall of 0.5
// looks half a picture's height below the camera's axis.
//
// The shift is applied where the camera builds its projection, so it holds
// under everything that rebuilds it: a resize, and temporal anti-aliasing,
// which sets and clears a view offset on every frame it draws (TRAANode), so
// a shift written as a view offset is gone by the next frame. Only the two
// terms that place the picture on the lens change. Depth is as it was, so the
// passes that read it see the same scene.
// ---------------------------------------------------------------------------

export interface LensShift {
  /** Pictures to the right of the camera's axis (0: centred). */
  readonly x: number;
  /** Pictures below the camera's axis (0: centred). */
  readonly y: number;
}

const CENTRED: LensShift = { x: 0, y: 0 };
const shifts = new WeakMap<PerspectiveCamera, LensShift>();

function updateShiftedProjection(this: PerspectiveCamera): void {
  PerspectiveCamera.prototype.updateProjectionMatrix.call(this);
  const shift = shifts.get(this);
  if (shift === undefined || (shift.x === 0 && shift.y === 0)) return;
  // (right + left) / (right - left) and (top + bottom) / (top - bottom): the
  // frustum moved by a share of its own width and of its own height.
  const elements = this.projectionMatrix.elements;
  elements[8] += 2 * shift.x;
  elements[9] -= 2 * shift.y;
  this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
}

/** The camera's shift: centred unless one was set. */
export function lensShift(camera: PerspectiveCamera): LensShift {
  return shifts.get(camera) ?? CENTRED;
}

/** Moves the picture across the lens, and rebuilds the projection. */
export function setLensShift(camera: PerspectiveCamera, shift: LensShift): void {
  shifts.set(camera, { x: shift.x, y: shift.y });
  camera.updateProjectionMatrix = updateShiftedProjection;
  camera.updateProjectionMatrix();
}

/** Centres the lens, and hands the camera its own projection back. */
export function clearLensShift(camera: PerspectiveCamera): void {
  shifts.delete(camera);
  Reflect.deleteProperty(camera, "updateProjectionMatrix");
  camera.updateProjectionMatrix();
}
