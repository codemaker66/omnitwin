import { describe, expect, it, vi } from "vitest";
import { toRealWorld, toRenderSpace } from "../../constants/scale.js";
import { roomGeometries } from "../../data/room-geometries.js";
import { BANQUET_CHAIR_CLEARANCE_M, planBanquetFill } from "../auto-fill.js";
import { getCatalogueItem, getCatalogueItemBySlug, type CatalogueItem } from "../catalogue.js";
import { DEFAULT_PLANNER_ROUND_TABLE_SLUG } from "../furniture-defaults.js";
import { computeRotatedFootprint } from "../placement.js";
import {
  INNER_CORNER_CLEARANCE_M,
  bandedWalls,
  discKeepsBand,
  discWithinFloor,
  innerCornersOf,
  roomFloorOf,
  type RoomFloor,
} from "../room-floor.js";
import { banquetSeatsPerTable, createTableGroup, tableGroupPlanningRadius } from "../table-group.js";
import { footprintInsideWalls, insideWalls, TOUCHING, type Walls } from "./walls-the-slow-way.js";

// ---------------------------------------------------------------------------
// T-760. A banquet fill in the Saloon, the Reception Room and the Robert Adam
// Room keeps the 0.6 m band along every run of wall and comes no nearer than
// INNER_CORNER_CLEARANCE_M to a pier or step corner (Blake's decision, 26
// November 2026), and it leaves no room for one more group: after the fill, a
// search of the floor finds nowhere another round could stand under the same
// rules. Where a piece may stand is judged here the slow way (walls sampled a
// centimetre at a time, lib/__tests__/walls-the-slow-way), not by the
// planner's own geometry.
// ---------------------------------------------------------------------------

type Point = readonly [number, number];

const SHAPED_ROOMS = [
  { name: "Saloon", guests: 60 },
  { name: "Reception Room", guests: 80 },
  { name: "Robert Adam Room", guests: 60 },
] as const;

function wallsOf(name: string): Walls {
  const geometry = roomGeometries[name];
  if (geometry === undefined) throw new Error(`no geometry for ${name}`);
  return geometry.wallPolygon.map(([x, z]) => [toRenderSpace(x), toRenderSpace(z)] as const);
}

function floorOf(name: string): RoomFloor {
  const geometry = roomGeometries[name];
  const floor = geometry === undefined ? undefined : roomFloorOf(geometry.wallPolygon);
  if (floor === undefined) throw new Error(`${name} has no floor of its own`);
  return floor;
}

function piece(slug: string): CatalogueItem {
  const found = getCatalogueItemBySlug(slug);
  if (found === undefined) throw new Error(`no catalogue item ${slug}`);
  return found;
}

/**
 * The inner corners, the slow way: each corner where walking the walls turns
 * back into the room by 45 degrees or more. The room is on the side the
 * winding count says, tested a centimetre off the middle of the wall in.
 */
function innerCornersSlow(walls: Walls): Point[] {
  const corners: Point[] = [];
  walls.forEach((corner, i) => {
    const before = walls[(i - 1 + walls.length) % walls.length] ?? corner;
    const after = walls[(i + 1) % walls.length] ?? corner;
    const inX = corner[0] - before[0];
    const inZ = corner[1] - before[1];
    const length = Math.hypot(inX, inZ);
    // The room's side of the wall coming in: left (+1) or right (−1) of the way walked.
    const leftX = (before[0] + corner[0]) / 2 - (inZ / length) * 0.01;
    const leftZ = (before[1] + corner[1]) / 2 + (inX / length) * 0.01;
    const roomOnLeft = insideWalls(walls, leftX, leftZ);
    const outX = after[0] - corner[0];
    const outZ = after[1] - corner[1];
    const cross = inX * outZ - inZ * outX;
    const turnsAway = roomOnLeft ? cross < 0 : cross > 0;
    const degrees = (Math.atan2(Math.abs(cross), inX * outX + inZ * outZ) * 180) / Math.PI;
    if (turnsAway && degrees >= 45 - 1e-9) corners.push(corner);
  });
  return corners;
}

/** Every centimetre of every wall, with the clearance a group keeps from it: `corner` within the band of an inner corner, the band elsewhere. */
function wallSamples(walls: Walls, band: number, corner: number): { readonly x: number; readonly z: number; readonly clearance: number }[] {
  const corners = innerCornersSlow(walls);
  const samples: { x: number; z: number; clearance: number }[] = [];
  walls.forEach(([ax, az], i) => {
    const [bx, bz] = walls[(i + 1) % walls.length] ?? [ax, az];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.01));
    for (let s = 0; s <= steps; s += 1) {
      const x = ax + ((bx - ax) * s) / steps;
      const z = az + ((bz - az) * s) / steps;
      const nearCorner = corners.some(([cx, cz]) => Math.hypot(x - cx, z - cz) <= band + 1e-9);
      samples.push({ x, z, clearance: nearCorner ? corner : band });
    }
  });
  return samples;
}

/** Whether a round of `radius` centred at (x, z) stands inside the walls, keeping each sample's clearance from it. */
function roundKeeps(walls: Walls, samples: ReturnType<typeof wallSamples>, x: number, z: number, radius: number): boolean {
  if (!insideWalls(walls, x, z)) return false;
  // A centimetre between samples brings a wall at most 0.05 mm nearer than its nearest sample at these distances.
  return samples.every((sample) => Math.hypot(x - sample.x, z - sample.z) >= radius + sample.clearance - 1e-4);
}

/** A spot on a grid of `step` (offset from the walls' bounds) where one more round could stand beside `centres`, or null. */
function oneMoreRound(walls: Walls, samples: ReturnType<typeof wallSamples>, radius: number, spacing: number, centres: readonly Point[], step: number, offset: number): Point | null {
  const xs = walls.map(([x]) => x);
  const zs = walls.map(([, z]) => z);
  for (let x = Math.min(...xs) + offset; x <= Math.max(...xs); x += step) {
    for (let z = Math.min(...zs) + offset; z <= Math.max(...zs); z += step) {
      if (!centres.every(([cx, cz]) => Math.hypot(x - cx, z - cz) >= spacing - 1e-6)) continue;
      if (roundKeeps(walls, samples, x, z, radius)) return [x, z];
    }
  }
  return null;
}

/** The fill a room's Lay out sets for its guests, banquet rounds of the planner's table and seats, on the room's own floor. */
function fillOf(name: string, guests: number, fill: typeof planBanquetFill = planBanquetFill): ReturnType<typeof planBanquetFill> {
  const table = piece(DEFAULT_PLANNER_ROUND_TABLE_SLUG);
  const floor = floorOf(name);
  return fill(table, guests, banquetSeatsPerTable(table), toRealWorld(floor.maxX - floor.minX), toRealWorld(floor.maxZ - floor.minZ), { floor });
}

describe("the inner corners a fill may come near (INNER_CORNER_CLEARANCE_M)", () => {
  it("are the corners of the piers, the steps and the recesses, and not the vertices that draw a curve", () => {
    for (const { name } of SHAPED_ROOMS) {
      const slow = innerCornersSlow(wallsOf(name)).map(([x, z]) => `${x.toFixed(3)},${z.toFixed(3)}`).sort();
      const planner = innerCornersOf(floorOf(name)).map(([x, z]) => `${x.toFixed(3)},${z.toFixed(3)}`).sort();
      expect(planner, name).toEqual(slow);
    }
    // The Saloon's eight alcove mouths, the Reception Room's two step corners, the Robert Adam Room's step and its four door recesses.
    expect(innerCornersOf(floorOf("Saloon"))).toHaveLength(8);
    expect(innerCornersOf(floorOf("Reception Room"))).toHaveLength(2);
    const adam = innerCornersOf(floorOf("Robert Adam Room")).map(([x, z]) => [toRealWorld(x), toRealWorld(z)]);
    expect(adam).toHaveLength(5);
    // The curved wall (x −5.7 to −4.5, z 4.2 to 8.2) keeps the full band: none of its vertices is an inner corner.
    expect(adam.some(([x, z]) => x !== undefined && z !== undefined && x < -4.4 && z > 4.1 && z < 8.3)).toBe(false);
  });

  it("let a round come to the clearance across a step corner, and keep the band along the run of wall beside it", () => {
    const floor = floorOf("Reception Room");
    const radius = 1.5;
    const band = toRenderSpace(BANQUET_CHAIR_CLEARANCE_M);
    const corner = toRenderSpace(INNER_CORNER_CLEARANCE_M);
    // Across the step corner at (3.65, 1.0), on its bisector, from the upper floor.
    const across = (gap: number): boolean => {
      const away = (radius + gap) / Math.SQRT2;
      return discKeepsBand(floor, toRenderSpace(3.65 - away), toRenderSpace(1.0 - away), toRenderSpace(radius), band, corner);
    };
    expect(across(INNER_CORNER_CLEARANCE_M + 0.001)).toBe(true);
    expect(across(INNER_CORNER_CLEARANCE_M - 0.001)).toBe(false);
    // Facing the lower section's side wall (x = 3.65) halfway down it: the band, not the corner's clearance.
    const facing = (gap: number): boolean => discKeepsBand(floor, toRenderSpace(3.65 - radius - gap), toRenderSpace(3.5), toRenderSpace(radius), band, corner);
    expect(facing(BANQUET_CHAIR_CLEARANCE_M + 0.001)).toBe(true);
    expect(facing(BANQUET_CHAIR_CLEARANCE_M - 0.001)).toBe(false);
  });

  it("with the clearance set to the band, keep the band from every wall, as a disc on the floor did before", () => {
    for (const { name } of SHAPED_ROOMS) {
      const floor = floorOf(name);
      const band = toRenderSpace(BANQUET_CHAIR_CLEARANCE_M);
      const radius = toRenderSpace(1.5);
      expect(bandedWalls(floor, band, band).every((wall) => wall.clearance === band), name).toBe(true);
      for (let x = floor.minX; x <= floor.maxX; x += 0.25) {
        for (let z = floor.minZ; z <= floor.maxZ; z += 0.25) {
          expect(discKeepsBand(floor, x, z, radius, band, band), `${name} (${x.toFixed(2)}, ${z.toFixed(2)})`).toBe(discWithinFloor(floor, x, z, radius + band));
        }
      }
    }
  });
});

/**
 * The fill's maximality and walls, for one clearance at the inner corners:
 * the fill as it is laid (`fill`), judged by a clearance of `corner` metres.
 */
function judgeTheFill(fill: typeof planBanquetFill, corner: number): void {
  const table = piece(DEFAULT_PLANNER_ROUND_TABLE_SLUG);
  const seats = banquetSeatsPerTable(table);
  const radius = tableGroupPlanningRadius(table, seats);
  const spacing = 2 * radius + BANQUET_CHAIR_CLEARANCE_M;
  for (const { name, guests } of SHAPED_ROOMS) {
    const walls = wallsOf(name);
    const plan = fillOf(name, guests, fill);
    expect(plan, name).not.toBeNull();
    if (plan === null) continue;
    // More guests than the room takes, so the fill is the room's whole fill.
    expect(plan.meetsTarget, name).toBe(false);
    const centres: Point[] = plan.tables.map((t) => [toRenderSpace(t.xM), toRenderSpace(t.zM)] as const);
    const samples = wallSamples(walls, toRenderSpace(BANQUET_CHAIR_CLEARANCE_M), toRenderSpace(corner));

    // Every round keeps the walls' clearances, and the aisle between rings is kept.
    for (const [x, z] of centres) expect(roundKeeps(walls, samples, x, z, toRenderSpace(radius)), `${name}: the round at (${x.toFixed(2)}, ${z.toFixed(2)})`).toBe(true);
    centres.forEach(([ax, az], i) => {
      for (const [bx, bz] of centres.slice(i + 1)) {
        expect(Math.hypot(ax - bx, az - bz), `${name}: rounds at (${ax.toFixed(2)}, ${az.toFixed(2)}) and (${bx.toFixed(2)}, ${bz.toFixed(2)})`).toBeGreaterThanOrEqual(toRenderSpace(spacing) - 1e-6);
      }
    });

    // Every piece set, table and chair, stands wholly inside the walls.
    for (const t of plan.tables) {
      for (const placed of createTableGroup(table.id, toRenderSpace(t.xM), toRenderSpace(t.zM), t.rotationY, seats)) {
        const item = getCatalogueItem(placed.catalogueItemId);
        if (item === undefined) throw new Error(`no catalogue item ${placed.catalogueItemId}`);
        const { halfW, halfD } = computeRotatedFootprint(item, placed.rotationY, placed.scale);
        expect(footprintInsideWalls(walls, placed.x, placed.z, halfW, halfD, TOUCHING), `${name}: ${item.slug} at (${placed.x.toFixed(2)}, ${placed.z.toFixed(2)})`).toBe(true);
      }
    }

    // No room for one more: a round is the same disc at every turn, and the fill sets its rounds square,
    // so a 10 cm grid set off the fill's own (and a 2.5 cm one set off again) is searched for one spot.
    for (const [step, offset] of [[0.1, 0.03], [0.025, 0.0125]] as const) {
      const extra = oneMoreRound(walls, samples, toRenderSpace(radius), toRenderSpace(spacing), centres, toRenderSpace(step), toRenderSpace(offset));
      expect(extra === null ? null : extra.map((v) => Number(toRealWorld(v).toFixed(3))), `${name}: one more round fits beside the ${String(centres.length)} the fill set (grid ${String(step)} m)`).toBeNull();
    }
  }
}

describe("a banquet fill on a shaped room's floor", () => {
  it(`leaves no room for one more round, at the inner corners' clearance (${String(INNER_CORNER_CLEARANCE_M)} m)`, () => {
    judgeTheFill(planBanquetFill, INNER_CORNER_CLEARANCE_M);
  }, 120_000);

  for (const corner of [0.3, 0.6]) {
    it(`leaves no room for one more round with the inner corners' clearance set to ${String(corner)} m`, async () => {
      vi.resetModules();
      vi.doMock("../room-floor.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../room-floor.js")>()), INNER_CORNER_CLEARANCE_M: corner }));
      try {
        const { planBanquetFill: fillAt } = await import("../auto-fill.js");
        judgeTheFill(fillAt, corner);
      } finally {
        vi.doUnmock("../room-floor.js");
        vi.resetModules();
      }
    }, 120_000);
  }

  it("seats what the rooms' floors take: 40 in the Saloon, 50 in the Reception Room and 50 in the Robert Adam Room", () => {
    const seated = Object.fromEntries(SHAPED_ROOMS.map(({ name, guests }) => [name, fillOf(name, guests)?.chairs ?? 0]));
    expect(seated).toEqual({ Saloon: 40, "Reception Room": 50, "Robert Adam Room": 50 });
  });
});
