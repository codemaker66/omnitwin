import { describe, expect, it } from "vitest";
import { getCatalogueItem, getCatalogueItemBySlug } from "../catalogue.js";
import { toRealWorld } from "../../constants/scale.js";
import { createPlacedItem, type PlacedItem } from "../placement.js";
import { computeChairPositions, rearrangeTableGroup, seatCapacity, tableGroupSeatCapacity } from "../table-group.js";

type Point = readonly [number, number];

function catalogue(slug: string): NonNullable<ReturnType<typeof getCatalogueItemBySlug>> {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`Missing catalogue item ${slug}`);
  return item;
}

// Independent polygon projection: exercise the actual generated rotations and
// all four separating axes, rather than repeating the capacity calculation.
function chairRectangle(x: number, z: number, rotation: number, width: number, depth: number): readonly Point[] {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sz]) => {
    const localX = sx * width / 2;
    const localZ = sz * depth / 2;
    return [toRealWorld(x) + localX * c + localZ * s, toRealWorld(z) - localX * s + localZ * c] as const;
  });
}

function separation(a: readonly Point[], b: readonly Point[]): number {
  const gaps: number[] = [];
  for (const polygon of [a, b]) {
    for (let edge = 0; edge < 2; edge += 1) {
      const start = polygon[edge]!;
      const end = polygon[edge + 1]!;
      const dx = end[0] - start[0];
      const dz = end[1] - start[1];
      const length = Math.hypot(dx, dz);
      const project = (point: Point): number => (-dz * point[0] + dx * point[1]) / length;
      const projectedA = a.map(project);
      const projectedB = b.map(project);
      gaps.push(Math.max(Math.min(...projectedB) - Math.max(...projectedA), Math.min(...projectedA) - Math.max(...projectedB)));
    }
  }
  return Math.max(...gaps);
}

function expectNoOverlaps(rectangles: readonly (readonly Point[])[]): void {
  for (let first = 0; first < rectangles.length; first += 1) {
    for (let second = first + 1; second < rectangles.length; second += 1) {
      expect(separation(rectangles[first]!, rectangles[second]!)).toBeGreaterThanOrEqual(-1e-8);
    }
  }
}

describe("round seating respects complete rotated chair footprints", () => {
  it("caps nine saved double-size chairs before rearrangement can overlap them", () => {
    const table = createPlacedItem(catalogue("round-table-6ft").id, 0, 0, 0, "scaled-saved-group");
    const legacy = catalogue("banquet-chair");
    const saved: readonly PlacedItem[] = [table, ...Array.from({ length: 9 }, () => ({
      ...createPlacedItem(legacy.id, 0, 0, 0, table.groupId), scale: 2,
    }))];
    const unchanged = structuredClone(saved);
    const maximum = tableGroupSeatCapacity(table, saved);
    const rearranged = rearrangeTableGroup(table.id, maximum, saved);
    expectNoOverlaps(rearranged.slice(1).map((chair) => {
      const asset = getCatalogueItem(chair.catalogueItemId)!;
      return chairRectangle(chair.x, chair.z, chair.rotationY, asset.width * (chair.scale ?? 1), asset.depth * (chair.scale ?? 1));
    }));
    expect(maximum).toBe(7);
    expect(rearranged).toHaveLength(8);
    expect(saved).toEqual(unchanged);
    expect(rearranged.slice(1).map((chair) => chair.id)).toEqual(saved.slice(1, 8).map((chair) => chair.id));
  });

  it.each([
    [0.42, 0.58], [0.9, 0.9], [0.6, 1.1], [0.42, 1.5], [1.2, 0.45],
  ])("fits every permitted count for a %sm wide × %sm deep chair", (width, depth) => {
    const table = catalogue("round-table-6ft-white");
    for (const scale of [0.35, 0.6, 1, 1.5, 2]) {
      const maximum = seatCapacity(table, scale, { width, depth });
      for (let count = 1; count <= maximum; count += 1) {
        const positions = computeChairPositions(2, -3, table, 0.37, count, scale, { width, depth });
        expect(positions).toHaveLength(count);
        expectNoOverlaps(positions.map((chair) => chairRectangle(chair.x, chair.z, chair.rotationY, width, depth)));
      }
    }
  });

  it("retains the thirteen-seat ceiling and eight-chair default for unscaled Turinis", () => {
    const table = catalogue("round-table-6ft-white");
    const chair = catalogue("burgess-turini-18-3");
    expect(seatCapacity(table)).toBe(13);
    const positions = computeChairPositions(0, 0, table, 0, 8);
    expect(positions).toHaveLength(8);
    expectNoOverlaps(positions.map((position) => chairRectangle(position.x, position.z, position.rotationY, chair.width, chair.depth)));
  });
});
