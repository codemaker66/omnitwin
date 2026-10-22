// ---------------------------------------------------------------------------
// The Grand Hall's geometry — one geometry per material, light baked in
//
// Pure: no DOM, no renderer. The room is two parts: the floor, ceiling and
// dome, with the windows' measured glazing bars and reveals, built from the
// spec on first use, and the walls, built from the scan's relief once it has
// loaded (flat photographs until then). Both are cached per page because the
// room never changes.
// ---------------------------------------------------------------------------

import type { BufferGeometry } from "three";
import { HallBuilders, type HallGeometryStats, type HallMaterialKey } from "./hall-builders.js";
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH } from "./hall-spec.js";
import { buildHallWalls, buildHallWallsSteps } from "./hall-walls.js";
import { drain, type Steps } from "./hall-slices.js";
import { buildHallCeiling } from "./hall-ceiling.js";
import { buildGlazingBars, buildGlazingReveals } from "./hall-glazing.js";
import { buildThresholds } from "./hall-wall-body.js";
import type { WallRelief } from "./hall-relief.js";

export interface HallGeometry {
  readonly geometries: ReadonlyMap<HallMaterialKey, BufferGeometry>;
  readonly stats: HallGeometryStats;
  /** Milliseconds spent building and baking. */
  readonly buildMs: number;
}

/** Texture coordinates of a floor point in the floor orthophoto. */
export function floorUv(x: number, z: number): [number, number] {
  // Columns run with planner x; the top row is the door side (+z).
  return [(x + HALL_HALF_LENGTH) / (HALL_HALF_LENGTH * 2), (z + HALL_HALF_WIDTH) / (HALL_HALF_WIDTH * 2)];
}

/** The floor as a grid fine enough for its light pools and corner shading. */
function buildFloor(hb: HallBuilders): void {
  hb.withRole("floor", () => {
    const floor = hb.get("floor");
    const x0 = -HALL_HALF_LENGTH;
    const z0 = -HALL_HALF_WIDTH;
    floor.quadFacing(
      [x0, 0, z0], [-x0, 0, z0], [-x0, 0, -z0], [x0, 0, -z0],
      floorUv(x0, z0), floorUv(-x0, z0), floorUv(-x0, -z0), floorUv(x0, -z0),
      [0, 1, 0], 0.25,
    );
  });
}

function timed(build: (hb: HallBuilders) => void): HallGeometry {
  const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const started = now();
  const hb = new HallBuilders();
  build(hb);
  const { geometries, stats } = hb.build();
  return { geometries, stats, buildMs: now() - started };
}

/** The floor, the coffered ceiling and the dome, and the windows' glazing bars and outer reveals. */
export function buildHallGeometry(): HallGeometry {
  return timed((hb) => {
    buildFloor(hb);
    buildHallCeiling(hb);
    buildGlazingBars(hb);
    buildGlazingReveals(hb);
  });
}

/**
 * The doorways' oak thresholds, drawn with the floor's material in a mesh of
 * their own (hall-wall-body.ts): the floor's mesh stays the floor's rectangle,
 * whose edge the plinth ring repeats vertex for vertex.
 */
export function buildHallThresholdGeometry(): HallGeometry {
  return timed((hb) => { buildThresholds(hb); });
}

/** The four walls: the scan's relief, or flat photographs without it. */
export function buildHallWallGeometry(relief: WallRelief | null): HallGeometry {
  return timed((hb) => { buildHallWalls(hb, relief); });
}

let cachedRoom: HallGeometry | null = null;
let cachedThresholds: HallGeometry | null = null;
let cachedFlatWalls: HallGeometry | null = null;
const cachedWalls = new WeakMap<WallRelief, HallGeometry>();

/** The floor, ceiling and dome, built on first use and shared by every canvas. */
export function hallGeometry(): HallGeometry {
  cachedRoom ??= buildHallGeometry();
  return cachedRoom;
}

/** The doorways' thresholds, built on first use and shared by every canvas. */
export function hallThresholdGeometry(): HallGeometry {
  cachedThresholds ??= buildHallThresholdGeometry();
  return cachedThresholds;
}

/** The walls for a relief (or flat without one), built once each. */
export function hallWallGeometry(relief: WallRelief | null): HallGeometry {
  if (relief === null) {
    cachedFlatWalls ??= buildHallWallGeometry(null);
    return cachedFlatWalls;
  }
  return drain(hallWallGeometrySteps(relief));
}

/**
 * hallWallGeometry for a relief as a sliced build (hall-slices.ts), cached
 * as it is: the planner builds the walls this way when the relief arrives
 * (hall-arrival.ts), so the page never freezes for the whole build, and
 * hallWallGeometry then finds them built.
 */
export function* hallWallGeometrySteps(relief: WallRelief): Steps<HallGeometry> {
  const cached = cachedWalls.get(relief);
  if (cached !== undefined) return cached;
  const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
  let spent = 0;
  let started = now();
  const hb = new HallBuilders();
  const steps = buildHallWallsSteps(hb, relief);
  for (;;) {
    const next = steps.next();
    if (next.done === true) break;
    spent += now() - started;
    yield;
    started = now();
  }
  const { geometries, stats } = hb.build();
  const walls: HallGeometry = { geometries, stats, buildMs: spent + now() - started };
  cachedWalls.set(relief, walls);
  return walls;
}
