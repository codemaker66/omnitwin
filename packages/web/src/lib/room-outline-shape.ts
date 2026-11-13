import { Shape } from "three";
import { toRenderSpace } from "../constants/scale.js";

/**
 * The three Shape of a room outline (or a feature's) of [x, z] points in
 * metres, for a mesh laid flat by a -90 degree turn about x. That turn carries
 * a shape's y to world -z, so each point goes in as (x, -z) and the drawn
 * outline stands where the outline, and the walls built from it, stand.
 */
export function roomOutlineShape(polygon: readonly (readonly [number, number])[]): Shape {
  const shape = new Shape();
  const first = polygon[0];
  if (first === undefined) return shape;
  shape.moveTo(toRenderSpace(first[0]), -toRenderSpace(first[1]));
  for (let i = 1; i < polygon.length; i++) {
    const pt = polygon[i];
    if (pt !== undefined) {
      shape.lineTo(toRenderSpace(pt[0]), -toRenderSpace(pt[1]));
    }
  }
  shape.closePath();
  return shape;
}
