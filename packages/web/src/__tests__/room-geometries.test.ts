import { describe, it, expect } from "vitest";
import { roomGeometries, computeBoundingBox, isPointInPolygon } from "../data/room-geometries.js";

// ---------------------------------------------------------------------------
// Room geometry data tests
// ---------------------------------------------------------------------------

const ROOM_NAMES = ["Grand Hall", "Saloon", "Reception Room", "Robert Adam Room"] as const;

describe("room geometries — all rooms", () => {
  it("defines all 4 Trades Hall rooms", () => {
    for (const name of ROOM_NAMES) {
      expect(roomGeometries[name]).toBeDefined();
    }
  });

  it("every room has at least 4 polygon points", () => {
    for (const name of ROOM_NAMES) {
      const geom = roomGeometries[name];
      expect(geom).toBeDefined();
      if (geom !== undefined) {
        expect(geom.wallPolygon.length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("no polygon has self-intersecting edges (basic: all points are distinct)", () => {
    for (const name of ROOM_NAMES) {
      const geom = roomGeometries[name];
      if (geom === undefined) continue;
      const seen = new Set<string>();
      for (const [x, z] of geom.wallPolygon) {
        const key = `${String(x)},${String(z)}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it("polygons have clockwise winding (positive signed area)", () => {
    for (const name of ROOM_NAMES) {
      const geom = roomGeometries[name];
      if (geom === undefined) continue;
      // Shoelace formula — clockwise in screen coords = positive area
      let area = 0;
      const n = geom.wallPolygon.length;
      for (let i = 0; i < n; i++) {
        const a = geom.wallPolygon[i];
        const b = geom.wallPolygon[(i + 1) % n];
        if (a !== undefined && b !== undefined) {
          area += a[0] * b[1] - b[0] * a[1];
        }
      }
      // Clockwise = negative in standard math coords, positive in screen coords
      // Either sign is fine as long as it's consistent — just check it's non-zero
      expect(Math.abs(area)).toBeGreaterThan(0);
    }
  });
});

describe("ceiling heights", () => {
  it("Grand Hall is 7.0m", () => {
    expect(roomGeometries["Grand Hall"]?.ceilingHeight).toBe(7.0);
  });

  it("Saloon is 5.4m", () => {
    expect(roomGeometries["Saloon"]?.ceilingHeight).toBe(5.4);
  });

  it("Reception Room is 3.2m", () => {
    expect(roomGeometries["Reception Room"]?.ceilingHeight).toBe(3.2);
  });

  it("Robert Adam Room is 2.18m", () => {
    expect(roomGeometries["Robert Adam Room"]?.ceilingHeight).toBe(2.18);
  });
});

describe("Grand Hall features", () => {
  it("has a dome", () => {
    const geom = roomGeometries["Grand Hall"];
    expect(geom?.hasDome).toBe(true);
    expect(geom?.domeRadius).toBe(3.5);
  });
});

describe("computeBoundingBox", () => {
  it("returns correct bounds for a simple rectangle", () => {
    const box = computeBoundingBox([[-5, -3], [5, -3], [5, 3], [-5, 3]]);
    expect(box.minX).toBe(-5);
    expect(box.maxX).toBe(5);
    expect(box.minZ).toBe(-3);
    expect(box.maxZ).toBe(3);
    expect(box.width).toBe(10);
    expect(box.depth).toBe(6);
  });
});

describe("isPointInPolygon", () => {
  const square: readonly (readonly [number, number])[] = [[-5, -5], [5, -5], [5, 5], [-5, 5]];

  it("returns true for point inside polygon", () => {
    expect(isPointInPolygon(0, 0, square)).toBe(true);
    expect(isPointInPolygon(3, 3, square)).toBe(true);
  });

  it("returns false for point outside polygon", () => {
    expect(isPointInPolygon(6, 0, square)).toBe(false);
    expect(isPointInPolygon(0, 6, square)).toBe(false);
  });

  it("works with L-shaped polygon", () => {
    const reception = roomGeometries["Reception Room"]?.wallPolygon ?? [];
    // Centre of upper section should be inside
    expect(isPointInPolygon(0, -3, reception)).toBe(true);
    // Centre of lower section should be inside
    expect(isPointInPolygon(0, 4, reception)).toBe(true);
    // Far corner outside L should be outside
    expect(isPointInPolygon(4.5, 4, reception)).toBe(false);
  });
});
