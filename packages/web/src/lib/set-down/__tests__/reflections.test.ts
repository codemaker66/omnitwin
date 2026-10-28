import { describe, expect, it } from "vitest";
import type { RoomGeometry } from "../../../data/room-geometries.js";
import { ROOM_ACOUSTICS, UNCALIBRATED, type RoomAcoustics } from "../rooms.js";
import {
  earlyReflections,
  lateralAzimuth,
  reflectionRoomFor,
  wallReflections,
  type ReflectionRoom,
  type Vec3,
} from "../reflections.js";

const SPEED_OF_SOUND = 343;

function geometry(wallPolygon: readonly (readonly [number, number])[], ceilingHeight: number): RoomGeometry {
  return { wallPolygon, ceilingHeight, features: [], hasDome: false, domeRadius: 0 };
}

/** 10 m along x, 6 m along z, 3 m high, centred on the origin. */
const BOX = geometry(
  [
    [-5, -3],
    [5, -3],
    [5, 3],
    [-5, 3],
  ],
  3,
);

/** An L: the full 10 m width for z < 0, and only the x < 0 half for z > 0. */
const L_SHAPE = geometry(
  [
    [-5, -3],
    [5, -3],
    [5, 0],
    [0, 0],
    [0, 3],
    [-5, 3],
  ],
  3,
);

function room(geom: RoomGeometry, floor: ReflectionRoom["floor"] = "oak-boards-joists"): ReflectionRoom {
  return { geometry: geom, wall: "plaster-masonry", floor, ceiling: "plaster-lath" };
}

const SOURCE: Vec3 = { x: 1, y: 0, z: 0 };
const EAR = { position: { x: -1, y: 1.5, z: 0 }, right: { x: 1, y: 0, z: 0 } } as const;

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

describe("earlyReflections in a 10 x 6 x 3 m box", () => {
  const reflections = earlyReflections(room(BOX), SOURCE, EAR);
  const direct = distance(SOURCE, EAR.position);

  it("delays the floor reflection by its image path less the direct path", () => {
    const image = { x: 1, y: -0, z: 0 };
    const expected = (distance(image, EAR.position) - direct) / SPEED_OF_SOUND;
    const firstOrder = reflections.filter((r) => r.order === 1);
    expect(firstOrder.some((r) => Math.abs(r.delaySeconds - expected) <= 1e-6)).toBe(true);
  });

  it("delays a raised source's floor reflection by its image path", () => {
    const raised: Vec3 = { x: 1, y: 0.4, z: 0.5 };
    const expected =
      (distance({ x: 1, y: -0.4, z: 0.5 }, EAR.position) - distance(raised, EAR.position)) / SPEED_OF_SOUND;
    const found = earlyReflections(room(BOX), raised, EAR).filter((r) => r.order === 1);
    expect(found.some((r) => Math.abs(r.delaySeconds - expected) <= 1e-6)).toBe(true);
  });

  it("finds 6 first-order and 12 second-order reflections", () => {
    expect(reflections.filter((r) => r.order === 1)).toHaveLength(6);
    expect(reflections.filter((r) => r.order === 2)).toHaveLength(12);
  });

  it("keeps every gain below 1 and every delay at or after the direct sound", () => {
    for (const r of reflections) {
      expect(r.delaySeconds).toBeGreaterThanOrEqual(0);
      for (const g of r.gain) {
        expect(Number.isFinite(g)).toBe(true);
        expect(g).toBeGreaterThan(0);
        expect(g).toBeLessThan(1);
      }
    }
  });

  it("makes the strongest second bounce weaker at 1 kHz than the strongest first", () => {
    const first = Math.max(...reflections.filter((r) => r.order === 1).map((r) => r.gain[3]));
    const second = Math.max(...reflections.filter((r) => r.order === 2).map((r) => r.gain[3]));
    expect(second).toBeLessThan(first);
  });

  it("puts the right wall to the right and the left wall to the left", () => {
    // From a source at x = 2, the x = +5 wall's image is at x = 8 and the x = -5 wall's at x = -12.
    const source: Vec3 = { x: 2, y: 0, z: 0 };
    const fromSource = earlyReflections(room(BOX), source, EAR);
    const toImage = (x: number): number =>
      (distance({ x, y: 0, z: 0 }, EAR.position) - distance(source, EAR.position)) / SPEED_OF_SOUND;
    const right = fromSource.find((r) => r.order === 1 && Math.abs(r.delaySeconds - toImage(8)) < 1e-9);
    const left = fromSource.find((r) => r.order === 1 && Math.abs(r.delaySeconds - toImage(-12)) < 1e-9);
    expect(right?.azimuthRad).toBeGreaterThan(0);
    expect(left?.azimuthRad).toBeLessThan(0);
  });

  it("makes a carpet floor's reflection darker at 4 kHz than an oak floor's", () => {
    const floorDelay = 0; // The source sits on the floor, so its image path equals the direct path.
    const floorGain = (floor: ReflectionRoom["floor"]): number => {
      const found = earlyReflections(room(BOX, floor), SOURCE, EAR).find(
        (r) => r.order === 1 && Math.abs(r.delaySeconds - floorDelay) <= 1e-9,
      );
      expect(found).toBeDefined();
      return found?.gain[5] ?? Number.NaN;
    };
    expect(floorGain("carpet-on-underlay")).toBeLessThan(floorGain("oak-boards-joists"));
  });

  it("returns nothing rather than NaN for a non-finite position", () => {
    expect(earlyReflections(room(BOX), { x: Number.NaN, y: 0, z: 0 }, EAR)).toEqual([]);
  });

  it("stays finite when the source is at the ear and the ear has no right", () => {
    const at = earlyReflections(room(BOX), EAR.position, { position: EAR.position, right: { x: 0, y: 0, z: 0 } });
    expect(at.length).toBeGreaterThan(0);
    for (const r of at) {
      expect(Number.isFinite(r.delaySeconds)).toBe(true);
      expect(Number.isFinite(r.azimuthRad)).toBe(true);
      for (const g of r.gain) expect(Number.isFinite(g)).toBe(true);
    }
  });
});

describe("lateralAzimuth", () => {
  const right: Vec3 = { x: 1, y: 0, z: 0 };

  it("reads straight ahead as 0, the right as +90° and the left as -90°", () => {
    expect(lateralAzimuth({ x: 0, y: 0, z: -3 }, right)).toBeCloseTo(0, 12);
    expect(lateralAzimuth({ x: 2, y: 0, z: 0 }, right)).toBeCloseTo(Math.PI / 2, 12);
    expect(lateralAzimuth({ x: -2, y: 0, z: 0 }, right)).toBeCloseTo(-Math.PI / 2, 12);
  });

  it("reads behind beyond ±90°, mirrored about the ear's axis", () => {
    expect(Math.abs(lateralAzimuth({ x: 0, y: 0, z: 3 }, right))).toBeCloseTo(Math.PI, 12);
    const behindRight = lateralAzimuth({ x: 1, y: 0, z: 1 }, right);
    expect(behindRight).toBeCloseTo((3 * Math.PI) / 4, 12);
    expect(lateralAzimuth({ x: -1, y: 0, z: 1 }, right)).toBeCloseTo((-3 * Math.PI) / 4, 12);
  });

  it("keeps sin(azimuth) the unit direction's part along the right, whatever the height or scale", () => {
    const direction: Vec3 = { x: 2, y: -1.5, z: -6 };
    const lateral = 2 / Math.hypot(2, 1.5, 6);
    expect(Math.sin(lateralAzimuth(direction, { x: 4, y: 0, z: 0 }))).toBeCloseTo(lateral, 12);
  });

  it("stays finite for a zero direction or a zero right", () => {
    expect(lateralAzimuth({ x: 0, y: 0, z: 0 }, right)).toBe(0);
    expect(Number.isFinite(lateralAzimuth({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0 }))).toBe(true);
  });
});

describe("earlyReflections' azimuths", () => {
  it("pans a front wall's reflection by its true lateral cosine, and a back wall's behind", () => {
    // Ahead of an ear whose right is +x is -z. The z = -3 wall's image is at
    // (1, 0, -6), the z = +3 wall's at (1, 0, 6): both 2 m right of the ear
    // over a 6.5 m path, so each has a lateral cosine of 2 / 6.5 (about 18°).
    const reflections = earlyReflections(room(BOX), SOURCE, EAR);
    const imageDelay = (distance({ x: 1, y: 0, z: -6 }, EAR.position) - distance(SOURCE, EAR.position)) / SPEED_OF_SOUND;
    const sideWalls = reflections.filter((r) => r.order === 1 && Math.abs(r.delaySeconds - imageDelay) < 1e-9);
    expect(sideWalls).toHaveLength(2);
    const front = sideWalls.find((r) => Math.cos(r.azimuthRad) > 0);
    const back = sideWalls.find((r) => Math.cos(r.azimuthRad) < 0);
    expect(Math.abs(Math.sin(front?.azimuthRad ?? Number.NaN))).toBeCloseTo(2 / 6.5, 12);
    expect(Math.abs(Math.sin(back?.azimuthRad ?? Number.NaN))).toBeCloseTo(2 / 6.5, 12);
    expect(front?.azimuthRad).toBeCloseTo(Math.asin(2 / 6.5), 12);
  });
});

describe("earlyReflections that cannot happen", () => {
  it("drops every image for an ear above the ceiling", () => {
    // The floor and ceiling need both ends between them; every second bounce
    // needs both inside the room; and each wall's bounce would land on its
    // plane above the ceiling. None of them is reshaped into a copy at zero
    // delay or unit gain: there is nothing left.
    const ear = { position: { x: 0, y: 10, z: 0 }, right: { x: 1, y: 0, z: 0 } } as const;
    const source: Vec3 = { x: 1, y: 0.5, z: 0.5 };
    expect(wallReflections(BOX.wallPolygon, source, ear.position).length).toBeGreaterThan(0);
    expect(earlyReflections(room(BOX), source, ear)).toEqual([]);
  });

  it("keeps every image for an ear just under the ceiling", () => {
    const ear = { position: { x: 0, y: 2.95, z: 0 }, right: { x: 1, y: 0, z: 0 } } as const;
    const reflections = earlyReflections(room(BOX), { x: 1, y: 0.5, z: 0.5 }, ear);
    expect(reflections.filter((r) => r.order === 1)).toHaveLength(6);
    expect(reflections.filter((r) => r.order === 2)).toHaveLength(12);
    for (const r of reflections) {
      expect(r.delaySeconds).toBeGreaterThan(0);
      for (const g of r.gain) expect(g).toBeLessThan(1);
    }
  });

  it("drops the wall between and every second bounce for a source outside the outline", () => {
    const source: Vec3 = { x: 8, y: 0.5, z: 0 };
    const reflections = earlyReflections(room(BOX), source, EAR);
    expect(reflections.filter((r) => r.order === 2)).toHaveLength(0);
    // The x = +5 wall (edge 1) stands between the source and the ear.
    expect(wallReflections(BOX.wallPolygon, source, EAR.position).map((w) => w.edge)).not.toContain(1);
    for (const r of reflections) {
      expect(r.delaySeconds).toBeGreaterThanOrEqual(0);
      for (const g of r.gain) {
        expect(g).toBeGreaterThan(0);
        expect(g).toBeLessThan(1);
      }
    }
  });
});

describe("earlyReflections in an L-shaped room", () => {
  const source: Vec3 = { x: 3, y: 0.5, z: -2 };
  const ear = { position: { x: -3, y: 1.5, z: 2 }, right: { x: 1, y: 0, z: 0 } } as const;
  const edges = L_SHAPE.wallPolygon.length;

  it("keeps only walls whose reflection point lies on the wall", () => {
    const reflections = earlyReflections(room(L_SHAPE), source, ear);
    const firstOrder = reflections.filter((r) => r.order === 1);
    expect(firstOrder.length).toBeLessThanOrEqual(edges + 2);
    // The two inner edges of the L face away from the pair.
    expect(firstOrder).toHaveLength(6);
    expect(reflections.filter((r) => r.order === 2)).toHaveLength(0);
  });

  it("puts every wall reflection point on its own edge", () => {
    const walls = wallReflections(L_SHAPE.wallPolygon, source, ear.position);
    expect(walls.map((w) => w.edge)).toEqual([0, 1, 4, 5]);
    for (const { edge, point } of walls) {
      const a = L_SHAPE.wallPolygon[edge];
      const b = L_SHAPE.wallPolygon[(edge + 1) % edges];
      if (a === undefined || b === undefined) throw new Error("edge out of range");
      const ex = b[0] - a[0], ez = b[1] - a[1];
      const along = ((point.x - a[0]) * ex + (point.z - a[1]) * ez) / (ex * ex + ez * ez);
      const off = Math.abs((point.x - a[0]) * ez - (point.z - a[1]) * ex) / Math.hypot(ex, ez);
      expect(along).toBeGreaterThanOrEqual(0);
      expect(along).toBeLessThanOrEqual(1);
      expect(off).toBeLessThan(1e-9);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(L_SHAPE.ceilingHeight);
    }
  });
});

describe("reflectionRoomFor", () => {
  it("takes the largest total area of each role's materials", () => {
    const acoustics: RoomAcoustics = {
      slug: "test-room",
      volumeM3: 180,
      surfaces: [
        { material: "carpet-on-underlay", areaM2: 50, role: "floor" },
        { material: "oak-boards-joists", areaM2: 80, role: "floor" },
        { material: "carpet-on-underlay", areaM2: 40, role: "floor" },
        { material: "hardwood-panelling", areaM2: 30, role: "wall" },
        { material: "plaster-masonry", areaM2: 60, role: "wall" },
        { material: "plaster-lath", areaM2: 60, role: "ceiling" },
        { material: "sash-glazing", areaM2: 500, role: "opening" },
      ],
      calibration: UNCALIBRATED,
      source: "test",
    };
    const result = reflectionRoomFor(acoustics, BOX);
    expect(result.geometry).toBe(BOX);
    expect(result.floor).toBe("carpet-on-underlay");
    expect(result.wall).toBe("plaster-masonry");
    expect(result.ceiling).toBe("plaster-lath");
  });

  it("names a material for every role of every surveyed room", () => {
    for (const acoustics of Object.values(ROOM_ACOUSTICS)) {
      const result = reflectionRoomFor(acoustics, BOX);
      for (const role of ["floor", "wall", "ceiling"] as const) {
        const materials = acoustics.surfaces.filter((s) => s.role === role).map((s) => s.material);
        expect(materials).toContain(result[role]);
      }
    }
  });
});
