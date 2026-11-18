import { describe, expect, it } from "vitest";
import { Matrix4, PerspectiveCamera, Vector3, WebGPUCoordinateSystem } from "three";
import { clearLensShift, lensShift, setLensShift } from "../lens-shift.js";

/** Slopes of the sight lines through the picture's edges, for a camera at the origin looking down -z. */
function edges(camera: PerspectiveCamera): { top: number; bottom: number; left: number; right: number } {
  camera.updateMatrixWorld();
  const slope = (x: number, y: number): Vector3 => {
    const point = new Vector3(x, y, 0.5).unproject(camera);
    return new Vector3(point.x / -point.z, point.y / -point.z, 0);
  };
  return { top: slope(0, 1).y, bottom: slope(0, -1).y, left: slope(-1, 0).x, right: slope(1, 0).x };
}

const HALF = Math.tan((20 * Math.PI) / 180);

describe("a view camera's rise and fall", () => {
  it("leaves a camera centred until it is asked", () => {
    const camera = new PerspectiveCamera(40, 2, 0.1, 200);
    expect(lensShift(camera)).toEqual({ x: 0, y: 0 });
    const seen = edges(camera);
    expect(seen.top).toBeCloseTo(HALF, 9);
    expect(seen.bottom).toBeCloseTo(-HALF, 9);
  });

  it("moves the picture down by that many pictures, and the camera's axis stays where it was", () => {
    const camera = new PerspectiveCamera(40, 2, 0.1, 200);
    setLensShift(camera, { x: 0, y: 0.5 });
    const seen = edges(camera);
    // Half a picture down: the top edge is the axis, the bottom edge a whole picture below it.
    expect(seen.top).toBeCloseTo(0, 9);
    expect(seen.bottom).toBeCloseTo(-2 * HALF, 9);
    expect(seen.left).toBeCloseTo(-2 * HALF, 9);
    expect(seen.right).toBeCloseTo(2 * HALF, 9);
    expect(lensShift(camera)).toEqual({ x: 0, y: 0.5 });
  });

  it("moves it sideways the same way", () => {
    const camera = new PerspectiveCamera(40, 2, 0.1, 200);
    setLensShift(camera, { x: 0.25, y: 0 });
    const seen = edges(camera);
    expect(seen.left).toBeCloseTo(-2 * HALF + 0.25 * 4 * HALF, 9);
    expect(seen.right).toBeCloseTo(2 * HALF + 0.25 * 4 * HALF, 9);
    expect(seen.top).toBeCloseTo(HALF, 9);
  });

  it("is the off-axis frustum a hand would build", () => {
    const camera = new PerspectiveCamera(36, 2.39, 0.1, 200);
    setLensShift(camera, { x: -0.1, y: 0.4 });
    const top = 0.1 * Math.tan((18 * Math.PI) / 180);
    const height = 2 * top;
    const width = 2.39 * height;
    const built = new Matrix4().makePerspective(
      -width / 2 - 0.1 * width, width / 2 - 0.1 * width, top - 0.4 * height, top - height - 0.4 * height, 0.1, 200,
    );
    camera.projectionMatrix.elements.forEach((value, index) => { expect(value).toBeCloseTo(built.elements[index] ?? NaN, 9); });
  });

  it("holds while a view offset is set and cleared, as temporal anti-aliasing does on every frame", () => {
    const camera = new PerspectiveCamera(40, 2, 0.1, 200);
    setLensShift(camera, { x: 0, y: 0.3 });
    const plain = new PerspectiveCamera(40, 2, 0.1, 200);
    for (const each of [camera, plain]) each.setViewOffset(1000, 500, 0.25, -0.25, 1000, 500);
    plain.projectionMatrix.elements.forEach((value, index) => {
      expect(camera.projectionMatrix.elements[index]).toBeCloseTo(index === 9 ? value - 0.6 : value, 12);
    });
    camera.clearViewOffset();
    expect(edges(camera).top).toBeCloseTo(HALF * (1 - 0.6), 9);
  });

  it("keeps the projection's inverse in step, so a press on the room is cast where it is seen", () => {
    const camera = new PerspectiveCamera(40, 2, 0.1, 200);
    setLensShift(camera, { x: 0.2, y: 0.7 });
    const round = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.projectionMatrixInverse);
    round.elements.forEach((value, index) => { expect(value).toBeCloseTo(index % 5 === 0 ? 1 : 0, 9); });
  });

  it("leaves depth as it was, in the renderer's own coordinates", () => {
    const camera = new PerspectiveCamera(40, 2, 0.1, 200);
    const plain = new PerspectiveCamera(40, 2, 0.1, 200);
    for (const each of [camera, plain]) each.coordinateSystem = WebGPUCoordinateSystem;
    plain.updateProjectionMatrix();
    setLensShift(camera, { x: 0, y: 1 });
    for (const index of [2, 6, 10, 14, 3, 7, 11, 15]) {
      expect(camera.projectionMatrix.elements[index]).toBe(plain.projectionMatrix.elements[index]);
    }
  });

  it("hands the camera its own projection back when cleared", () => {
    const camera = new PerspectiveCamera(40, 2, 0.1, 200);
    const before = camera.projectionMatrix.clone();
    setLensShift(camera, { x: 0, y: 0.5 });
    expect(Object.hasOwn(camera, "updateProjectionMatrix")).toBe(true);
    clearLensShift(camera);
    expect(Object.hasOwn(camera, "updateProjectionMatrix")).toBe(false);
    expect(camera.projectionMatrix.equals(before)).toBe(true);
    expect(lensShift(camera)).toEqual({ x: 0, y: 0 });
  });
});
