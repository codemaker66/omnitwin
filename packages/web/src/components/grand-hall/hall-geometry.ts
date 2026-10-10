// ---------------------------------------------------------------------------
// The Grand Hall's geometry — one geometry per material, light baked in
//
// Pure: no DOM, no renderer. The room is two parts: the floor, ceiling and
// dome, built from the measured spec on first use, and the walls, built from
// the scan's relief once it has loaded (flat photographs until then). Both
// are cached per page because the room never changes.
// ---------------------------------------------------------------------------

import type { BufferGeometry } from "three";
import { HallBuilders, type HallGeometryStats, type HallMaterialKey } from "./hall-builders.js";
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH } from "./hall-spec.js";
import { buildHallWalls } from "./hall-walls.js";
import { buildHallCeiling } from "./hall-ceiling.js";
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

/** The floor, the coffered ceiling and the dome. */
export function buildHallGeometry(): HallGeometry {
  return timed((hb) => {
    buildFloor(hb);
    buildHallCeiling(hb);
  });
}

/** The four walls: the scan's relief, or flat photographs without it. */
export function buildHallWallGeometry(relief: WallRelief | null): HallGeometry {
  return timed((hb) => { buildHallWalls(hb, relief); });
}

let cachedRoom: HallGeometry | null = null;
let cachedFlatWalls: HallGeometry | null = null;
const cachedWalls = new WeakMap<WallRelief, HallGeometry>();

/** The floor, ceiling and dome, built on first use and shared by every canvas. */
export function hallGeometry(): HallGeometry {
  cachedRoom ??= buildHallGeometry();
  return cachedRoom;
}

/** The walls for a relief (or flat without one), built once each. */
export function hallWallGeometry(relief: WallRelief | null): HallGeometry {
  if (relief === null) {
    cachedFlatWalls ??= buildHallWallGeometry(null);
    return cachedFlatWalls;
  }
  let walls = cachedWalls.get(relief);
  if (walls === undefined) {
    walls = buildHallWallGeometry(relief);
    cachedWalls.set(relief, walls);
  }
  return walls;
}
