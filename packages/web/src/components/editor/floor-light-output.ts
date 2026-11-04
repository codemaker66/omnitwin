import { mrt, output, vec4 } from "three/tsl";

/**
 * The planner's pass output for a mark laid on the floor (a door's clear
 * space, a clearance line and its end dots): light, not a surface. It leaves
 * the floor's own normal and motion in the pipeline's targets (alpha 0, as the
 * hall's panes do, hall-glazing.ts). Written there at full weight, the door
 * edge's clear gaps were read as a strip above the floor and darkened by the
 * occlusion.
 */
export function floorLightOutput(): ReturnType<typeof mrt> {
  return mrt({ output, normal: vec4(0, 0, 0, 0), velocity: vec4(0, 0, 0, 0) });
}
