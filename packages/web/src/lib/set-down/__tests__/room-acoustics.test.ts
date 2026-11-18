import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { BandValues } from "../bands.js";
import { CATALOGUE_ITEMS } from "../../catalogue.js";
import { createPlacedItem, type PlacedItem } from "../../placement.js";
import {
  absorberFor,
  contentsAbsorption,
  referenceDinner,
  reverberantGain,
  reverberationTimes,
  roomAcousticsFor,
  roomConstant,
  roomState,
} from "../room-acoustics.js";
import {
  ROBERT_ADAM,
  ROOM_ACOUSTICS,
  ROOM_PLANS,
  UNCALIBRATED,
  domeGeometry,
  type RoomAcoustics,
  type RoomSlug,
} from "../rooms.js";
import { CALIBRATION_RANGE, TRACER_DIR, fittedCalibration } from "./tracer-results.js";

const NO_CONTENTS: BandValues = [0, 0, 0, 0, 0, 0, 0];
const BANDS = [0, 1, 2, 3, 4, 5, 6] as const;
const GRAND_HALL = ROOM_ACOUSTICS["grand-hall"];
const ROOM_SLUGS: readonly RoomSlug[] = [
  "grand-hall",
  "saloon",
  "robert-adam-room",
  "reception-room",
  "north-gallery",
  "south-gallery",
];

/** A placed piece by slug (the catalogue accepts a slug in place of its id). */
function piece(slug: string, x = 0, z = 0, extra: Partial<PlacedItem> = {}): PlacedItem {
  return { ...createPlacedItem(slug, x, z, 0, null, 0, `test-${slug}-${String(x)}-${String(z)}`), ...extra };
}

function timesWith(room: RoomAcoustics, items: readonly PlacedItem[]): BandValues {
  return reverberationTimes(room, contentsAbsorption(items.map(absorberFor)));
}

/** The mean of the 500 Hz and 1 kHz times. */
function midBand(rt: BandValues): number {
  return (rt[2] + rt[3]) / 2;
}

/** The room as surveyed: Eyring as calculated, without the tracer's calibration. */
function surveyed(room: RoomAcoustics): RoomAcoustics {
  return { ...room, calibration: UNCALIBRATED };
}

type Point = readonly [number, number];

const point = z.tuple([z.number(), z.number()]);
/** The parts of T-662's room config (tools/surveyed-rooms/room.schema.json) the Robert Adam Room's model rests on. */
const roomOutline = z.object({
  walls: z.object({
    vertices: z.array(point).min(3),
    segments: z.array(z.object({ id: z.string(), height: z.number(), sagitta: z.number().optional() })),
  }),
  floor: z.object({
    levels: z.array(z.object({ id: z.string(), height: z.number(), outline: z.array(point).optional() })),
  }),
  ceiling: z.object({
    height: z.number(),
    regions: z.array(z.object({ id: z.string(), height: z.number(), outline: z.array(point).min(3) })),
  }),
});

/** T-662's measured outline of the Robert Adam Room (#442), validated. */
function robertAdamOutline(): z.infer<typeof roomOutline> {
  const file = resolve(TRACER_DIR, "../surveyed-rooms/robert-adam-room.room.json");
  const outline = roomOutline.parse(JSON.parse(readFileSync(file, "utf8")));
  expect(outline.walls.segments).toHaveLength(outline.walls.vertices.length);
  return outline;
}

/** The i-th vertex, wrapping round the closed outline. */
function vertexAt(vertices: readonly Point[], i: number): Point {
  const vertex = vertices[((i % vertices.length) + vertices.length) % vertices.length];
  if (vertex === undefined) throw new Error("an outline has no vertices");
  return vertex;
}

/** A polygon's area by the shoelace formula. */
function shoelace(points: readonly Point[]): number {
  let twice = 0;
  points.forEach((a, i) => {
    const b = vertexAt(points, i + 1);
    twice += a[0] * b[1] - b[0] * a[1];
  });
  return Math.abs(twice) / 2;
}

/** The circular segment between a chord and its arc, from the chord and the arc's sagitta. */
function circularSegment(chord: number, sagitta: number): { areaM2: number; arcM: number } {
  const rise = Math.abs(sagitta);
  const radius = (chord * chord) / (8 * rise) + rise / 2;
  const angle = 2 * Math.asin(chord / (2 * radius));
  return { areaM2: ((radius * radius) / 2) * (angle - Math.sin(angle)), arcM: radius * angle };
}

/** An area in m2 agrees with the outline's to 0.01 m2 (the Robert Adam Room's test says why). */
function expectWithinOutline(model: number, outline: number): void {
  expect(Math.abs(model - outline)).toBeLessThan(0.01);
}

function areaOfRole(room: RoomAcoustics, role: RoomAcoustics["surfaces"][number]["role"]): number {
  return room.surfaces.filter((surface) => surface.role === role).reduce((sum, surface) => sum + surface.areaM2, 0);
}

/** Each factor is finite and inside the tracer fit's clamp. */
function expectCalibrationInRange(calibration: BandValues): void {
  for (const factor of calibration) {
    expect(Number.isFinite(factor)).toBe(true);
    expect(factor).toBeGreaterThanOrEqual(CALIBRATION_RANGE.min);
    expect(factor).toBeLessThanOrEqual(CALIBRATION_RANGE.max);
  }
}

describe("Trades Hall rooms", () => {
  it("gives the Grand Hall its scanned volume, dome included", () => {
    // 21.135 x 10.59 x 6.7 m = 1,499.59 m3 under the coffers, plus 50.10 m3 in
    // the dome: the integral of 2 pi r (domeHeightAt(r) - 6.7) from 0 to the
    // 3.32 m foot ring, by adaptive quadrature (scipy quad) outside this code,
    // agreeing with the review's own integration of about 50 m3.
    const scanned = 21.135 * 10.59 * 6.7 + 50.1;
    expect(Math.abs(GRAND_HALL.volumeM3 - scanned) / scanned).toBeLessThan(0.015);
  });

  it("integrates the scanned dome finely enough that halving the step moves it under 0.5 %", () => {
    const fine = domeGeometry();
    const finer = domeGeometry(2048);
    expect(Math.abs(finer.volumeM3 - fine.volumeM3) / fine.volumeM3).toBeLessThan(0.005);
    expect(Math.abs(finer.surfaceM2 - fine.surfaceM2) / fine.surfaceM2).toBeLessThan(0.005);
    // Independent figures: 50.10 m3 (quadrature) and 54.44 m2 (65,536 frusta).
    expect(fine.volumeM3).toBeCloseTo(50.1, 1);
    expect(fine.surfaceM2).toBeCloseTo(54.44, 1);
    expect(fine.openingM2).toBeCloseTo(Math.PI * 3.32 * 3.32, 9);
    const flat = GRAND_HALL.surfaces.filter((surface) => surface.role === "ceiling" && surface.dome !== true);
    expect(flat).toHaveLength(1);
    expect(flat[0]?.areaM2).toBeCloseTo(21.135 * 10.59 - fine.openingM2, 9);
    const dome = GRAND_HALL.surfaces.filter((surface) => surface.dome === true);
    expect(dome.map((surface) => [surface.role, surface.areaM2])).toEqual([["ceiling", fine.surfaceM2]]);
  });

  it("gives the dome and the coffered ceiling round it the plaster-on-lath row, and no other room a dome", () => {
    // No source gives the dome's construction, so it is EST: the lath row of
    // the ceiling it rises from, never an unsourced solid plaster (ruling R49).
    for (const surface of GRAND_HALL.surfaces.filter((s) => s.role === "ceiling")) {
      expect(surface.material).toBe("plaster-lath");
    }
    for (const slug of ROOM_SLUGS.filter((s) => s !== "grand-hall")) {
      expect(ROOM_ACOUSTICS[slug].surfaces.some((surface) => surface.dome === true)).toBe(false);
    }
  });

  it("gives the Robert Adam Room plaster-on-lath ceilings, under the timber floors above it", () => {
    // The survey puts its lower section under the Grand Hall and its upper
    // under the Saloon, whose floors are timber on joists or a timber subfloor
    // (ruling R49).
    const room = ROOM_ACOUSTICS["robert-adam-room"];
    const ceilings = room.surfaces.filter((surface) => surface.role === "ceiling");
    expect(ceilings.map((surface) => surface.material)).toEqual(["plaster-lath"]);
    // Its plan: the measured outline's whole floor (R96), recomputed below.
    expect(ceilings[0]?.areaM2).toBeCloseTo(ROBERT_ADAM.lower.floorM2 + ROBERT_ADAM.upper.floorM2, 9);
    expect(GRAND_HALL.surfaces.find((surface) => surface.role === "floor")?.material).toBe("oak-boards-joists");
    expect(ROOM_ACOUSTICS.saloon.surfaces.find((surface) => surface.role === "floor")?.material).toBe(
      "parquet-timber-subfloor",
    );
  });

  it("takes the Robert Adam Room's floors, walls and air from T-662's measured outline (R96)", () => {
    // Recomputed here from tools/surveyed-rooms/robert-adam-room.room.json by
    // polygons, independently of the 1 cm raster that gave rooms.ts its mean
    // heights. Areas agree to 0.01 m2: the outline's vertices and the screen
    // wall's sagitta are given to the millimetre, so the arc they make differs
    // from the README's circle (r 1.052 m) by a few thousandths of a m2.
    const outline = robertAdamOutline();
    const vertices = outline.walls.vertices;
    const segments = outline.walls.segments;
    const ids = segments.map((segment) => segment.id);
    const level = (id: string) => outline.floor.levels.find((entry) => entry.id === id);
    const upperFloor = level("upper")?.height ?? Number.NaN;
    const liftBay = outline.ceiling.regions.find((entry) => entry.id === "lift-bay")?.height ?? Number.NaN;
    const screen = segments.findIndex((segment) => segment.sagitta !== undefined);
    // The one curved wall bows into the room (a negative sagitta), so the
    // segment between its chord and its arc comes off the outline's floor.
    expect(segments.filter((segment) => segment.sagitta !== undefined)).toHaveLength(1);
    expect(segments[screen]?.sagitta).toBeLessThan(0);
    const chordStart = vertexAt(vertices, screen);
    const chordEnd = vertexAt(vertices, screen + 1);
    const arc = circularSegment(
      Math.hypot(chordEnd[0] - chordStart[0], chordEnd[1] - chordStart[1]),
      segments[screen]?.sagitta ?? Number.NaN,
    );
    // The upper section: from the arch's east jamb round to its west jamb,
    // closed along the top riser's line.
    const firstUpper = ids.indexOf("archjamb-e");
    const lastUpper = ids.indexOf("archjamb-w");
    expect(firstUpper).toBeGreaterThan(0);
    expect(screen).toBeGreaterThan(firstUpper);
    expect(lastUpper).toBeGreaterThan(screen);
    expect(lastUpper - firstUpper + 1).toBe(24);
    const riserZ = vertexAt(vertices, firstUpper)[1];
    const total = shoelace(vertices) - arc.areaM2;
    const upper = shoelace(vertices.slice(firstUpper, lastUpper + 2)) - arc.areaM2;
    expect(total).toBeCloseTo(164.5, 1); // README, "Whole room"
    expectWithinOutline(ROBERT_ADAM.upper.floorM2, upper);
    expectWithinOutline(ROBERT_ADAM.lower.floorM2, total - upper);
    const room = ROOM_ACOUSTICS["robert-adam-room"];
    expectWithinOutline(areaOfRole(room, "floor"), total);
    expectWithinOutline(areaOfRole(room, "ceiling"), total);
    // The steps: the alcove's width between its walls, from the first riser
    // (step-1's front) to the top one. South of the riser line, so the lower
    // section's.
    const alcove = Math.abs(vertexAt(vertices, ids.indexOf("alcove-w"))[0] - vertexAt(vertices, ids.indexOf("alcove-e"))[0]);
    const firstRiserZ = Math.min(...(level("step-1")?.outline ?? []).map((corner) => corner[1]));
    expect(alcove * (riserZ - firstRiserZ)).toBeCloseTo(3.064, 3);

    // Walls: each one's length (the screen wall's arc) times its measured
    // height above its section's floor; the lift's gate up to the bay's ceiling.
    let lowerWalls = 0;
    let upperWalls = 0;
    segments.forEach((segment, i) => {
      const a = vertexAt(vertices, i);
      const b = vertexAt(vertices, i + 1);
      const length = i === screen ? arc.arcM : Math.hypot(b[0] - a[0], b[1] - a[1]);
      const height = segment.id === "lift-head" ? liftBay : segment.height;
      if (i >= firstUpper && i <= lastUpper) upperWalls += length * (height - upperFloor);
      else lowerWalls += length * height;
    });
    expectWithinOutline(ROBERT_ADAM.lower.wallM2, lowerWalls);
    expectWithinOutline(ROBERT_ADAM.upper.wallM2, upperWalls);
    const overArch = ROBERT_ADAM.arch.widthM * (ROBERT_ADAM.arch.alcoveCeilingM - ROBERT_ADAM.arch.headM);
    expect(overArch).toBeCloseTo(1.0, 3);
    const extent = areaOfRole(room, "wall") + areaOfRole(room, "opening");
    expectWithinOutline(extent, lowerWalls + upperWalls + overArch);
    expect(room.surfaces.some((surface) => surface.material === "velour-drape")).toBe(false);

    // Air: each section's ceiling regions over its floor, by polygons. The
    // lower section's undrawn ceiling is the beams' soffit; the upper's is its
    // largest region, the flat ceiling, with the raised field and the arch's
    // head drawn over it. The model's mean heights come from a 1 cm raster,
    // rounded to the millimetre, where the cross beams override the panels
    // they overlap by 2-3 cm; the polygons count those 0.38 m2 twice, about
    // 0.15 m3 in the lower section. So each section's air agrees within 0.1 %.
    const isUpper = (corners: readonly Point[]): boolean =>
      corners.reduce((sum, corner) => sum + corner[1], 0) / corners.length > riserZ;
    const lowerRegions = outline.ceiling.regions.filter((entry) => !isUpper(entry.outline));
    const upperRegions = outline.ceiling.regions.filter((entry) => isUpper(entry.outline));
    const upperBase = upperRegions.reduce((best, entry) => (shoelace(entry.outline) > shoelace(best.outline) ? entry : best));
    const raised = outline.floor.levels.filter((entry) => entry.id !== "upper");
    const lowerAir =
      outline.ceiling.height * (total - upper) +
      lowerRegions.reduce((sum, entry) => sum + shoelace(entry.outline) * (entry.height - outline.ceiling.height), 0) -
      raised.reduce((sum, entry) => sum + (entry.outline === undefined ? 0 : shoelace(entry.outline)) * entry.height, 0);
    const upperAir =
      (upperBase.height - upperFloor) * upper +
      upperRegions
        .filter((entry) => entry !== upperBase)
        .reduce((sum, entry) => sum + shoelace(entry.outline) * (entry.height - upperBase.height), 0);
    const lowerModel = ROBERT_ADAM.lower.floorM2 * ROBERT_ADAM.lower.meanHeightM;
    const upperModel = ROBERT_ADAM.upper.floorM2 * ROBERT_ADAM.upper.meanHeightM;
    expect(Math.abs(lowerModel - lowerAir) / lowerAir).toBeLessThan(0.001);
    expect(Math.abs(upperModel - upperAir) / upperAir).toBeLessThan(0.001);
    expect(room.volumeM3).toBeCloseTo(lowerModel + upperModel, 9);
  });

  // The next two check the survey and its EST curtains against the first hand
  // estimate of 27 October (Eyring at 1 kHz: 2.14 s with the curtains drawn,
  // about 3.5 s without), so they read Eyring as calculated, before the
  // tracer's calibration (rulings R33 and R40).
  it("puts the empty Grand Hall, curtains included, between 2.0 and 2.6 s at 1 kHz, as surveyed", () => {
    const rt = reverberationTimes(surveyed(GRAND_HALL), NO_CONTENTS);
    expect(rt[3]).toBeGreaterThan(2.0);
    expect(rt[3]).toBeLessThan(2.6);
  });

  it("puts the Grand Hall without its curtains between 3.4 and 4.1 s at 1 kHz, as surveyed", () => {
    const bare: RoomAcoustics = {
      ...surveyed(GRAND_HALL),
      surfaces: GRAND_HALL.surfaces.filter((surface) => surface.material !== "velour-drape"),
    };
    expect(bare.surfaces.length).toBeLessThan(GRAND_HALL.surfaces.length);
    const rt = reverberationTimes(bare, NO_CONTENTS);
    expect(rt[3]).toBeGreaterThan(3.4);
    expect(rt[3]).toBeLessThan(4.1);
  });

  it("keeps every room's surfaces and calibration well formed, the calibration as fitted to the ray tracer", () => {
    for (const slug of ROOM_SLUGS) {
      const room = ROOM_ACOUSTICS[slug];
      expect(room.slug).toBe(slug);
      expect(room.volumeM3).toBeGreaterThan(0);
      expectCalibrationInRange(room.calibration);
      expect(room.calibration).toEqual(fittedCalibration(slug));
      expect(room.source.length).toBeGreaterThan(0);
      for (const surface of room.surfaces) {
        expect(Number.isFinite(surface.areaM2)).toBe(true);
        expect(surface.areaM2).toBeGreaterThan(0);
      }
      for (const t of reverberationTimes(room, NO_CONTENTS)) {
        expect(Number.isFinite(t)).toBe(true);
        expect(t).toBeGreaterThan(0);
      }
    }
  });

  it("makes each gallery's empty mid band under 1.0 s and under a third of the Grand Hall's, as surveyed", () => {
    // A check of the gallery materials (R13), so it reads the survey's Eyring
    // times, before the tracer's calibration (ruling R33).
    const hall = midBand(reverberationTimes(surveyed(GRAND_HALL), NO_CONTENTS));
    for (const slug of ["north-gallery", "south-gallery"] as const) {
      const gallery = midBand(reverberationTimes(surveyed(ROOM_ACOUSTICS[slug]), NO_CONTENTS));
      expect(gallery).toBeLessThan(1.0);
      expect(gallery).toBeLessThan(hall / 3);
    }
  });

  it("keeps each gallery's calibrated empty mid band under 1.0 s", () => {
    for (const slug of ["north-gallery", "south-gallery"] as const) {
      expect(midBand(reverberationTimes(ROOM_ACOUSTICS[slug], NO_CONTENTS))).toBeLessThan(1.0);
    }
  });

  it("keeps each gallery's 125 Hz time under 1.5 s", () => {
    for (const slug of ["north-gallery", "south-gallery"] as const) {
      expect(reverberationTimes(ROOM_ACOUSTICS[slug], NO_CONTENTS)[0]).toBeLessThan(1.5);
    }
  });

  it("panels the Grand Hall's dado to its scanned 1.95 m cap rail, less only each opening's part of that band", () => {
    // By hand from hall-spec.ts's openings: the five windows take only the
    // band above their sills (two arches 2.7 m wide and one 2.67 m, sills
    // 0.915 m; two windows 1.43 m wide, sills 0.935 m), and the doors take the
    // band from the floor (1.1, 1.45 and 1.08 m wide to the rail; the fire
    // exit, 1.06 m wide, to its 1.91 m head). Under a sill the wall is panelled.
    const windows = (2 * 2.7 + 2.67) * (1.95 - 0.915) + 2 * 1.43 * (1.95 - 0.935);
    const doors = (1.1 + 1.45 + 1.08) * 1.95 + 1.06 * 1.91;
    const expected = 2 * (21.135 + 10.59) * 1.95 - windows - doors;
    const dado = GRAND_HALL.surfaces.filter(
      (surface) => surface.material === "hardwood-panelling" && Math.abs(surface.areaM2 - expected) < 1e-6,
    );
    expect(dado).toHaveLength(1);
    // The old rule, (perimeter - the openings' 15.62 m of width) x 1.95 m, left
    // out the 10.1 m2 of panelling under the sills (#416 review A12).
  });
});

describe("the reference dinner", () => {
  it("seats each room's published dinner capacity with a round for every ten", () => {
    const capacity: Record<RoomSlug, number> = {
      "grand-hall": 180,
      saloon: 60,
      "robert-adam-room": 60,
      "reception-room": 60,
      "north-gallery": 40,
      "south-gallery": 40,
    };
    for (const slug of ROOM_SLUGS) {
      const items = referenceDinner(slug);
      const chairs = items.filter((item) => absorberFor(item).kind === "chair-cushioned");
      const rounds = items.filter((item) => absorberFor(item).kind === "round-clothed");
      expect(chairs).toHaveLength(capacity[slug]);
      expect(rounds).toHaveLength(Math.ceil(capacity[slug] / 10));
      expect(items).toHaveLength(chairs.length + rounds.length);
      const plan = ROOM_PLANS[slug];
      for (const item of items) {
        expect(Math.abs(item.x)).toBeLessThanOrEqual(plan.lengthM / 2);
        expect(Math.abs(item.z)).toBeLessThanOrEqual(plan.widthM / 2);
      }
      expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    }
  });

  it("shortens the Grand Hall's mid band by 15-32 % with 180 Chiavari chairs and 18 white rounds", () => {
    const empty = midBand(reverberationTimes(GRAND_HALL, NO_CONTENTS));
    const dressed = midBand(timesWith(GRAND_HALL, referenceDinner("grand-hall")));
    const drop = 1 - dressed / empty;
    expect(drop).toBeGreaterThan(0.15);
    expect(drop).toBeLessThan(0.32);
  });

  it("shortens it by 25-42 % with 180 banquet chairs and 18 clothed rounds", () => {
    const items = referenceDinner("grand-hall").map((item) =>
      absorberFor(item).kind === "chair-cushioned"
        ? { ...item, catalogueItemId: "banquet-chair" }
        : { ...item, catalogueItemId: "round-table-6ft", clothed: true },
    );
    expect(items.filter((item) => absorberFor(item).kind === "chair-upholstered")).toHaveLength(180);
    expect(items.filter((item) => absorberFor(item).kind === "round-clothed")).toHaveLength(18);
    const empty = midBand(reverberationTimes(GRAND_HALL, NO_CONTENTS));
    const dressed = midBand(timesWith(GRAND_HALL, items));
    const drop = 1 - dressed / empty;
    expect(drop).toBeGreaterThan(0.25);
    expect(drop).toBeLessThan(0.42);
  });
});

describe("contents", () => {
  it("never lengthens any band when one more piece of any kind is added", () => {
    const bases: readonly (readonly PlacedItem[])[] = [[], referenceDinner("grand-hall")];
    for (const base of bases) {
      const before = timesWith(GRAND_HALL, base);
      for (const entry of CATALOGUE_ITEMS) {
        const after = timesWith(GRAND_HALL, [...base, piece(entry.slug, 1.3, -2.1)]);
        for (const band of BANDS) expect(after[band]).toBeLessThanOrEqual(before[band] + 1e-12);
      }
    }
  });

  it("never lengthens any band when a chair fills a hole in a packed block", () => {
    // A block packed 0.25 m apart, so the density cap binds, with one 0.5 m
    // cell at its centre left empty.
    const block: PlacedItem[] = [];
    for (let i = -6; i <= 6; i += 1) {
      for (let j = -6; j <= 6; j += 1) {
        if ((i === 0 || i === 1) && (j === 0 || j === 1)) continue;
        block.push(piece("banquet-chair", i * 0.25 + 0.01, j * 0.25 + 0.01));
      }
    }
    const uncapped = upholsteredChairs(block.length);
    const capped = contentsAbsorption(block.map(absorberFor));
    expect(capped[3]).toBeLessThan(uncapped[3]);
    const before = timesWith(GRAND_HALL, block);
    const after = timesWith(GRAND_HALL, [...block, piece("banquet-chair", 0.01, 0.01)]);
    for (const band of BANDS) expect(after[band]).toBeLessThanOrEqual(before[band] + 1e-12);
  });

  it("leaves every band within 1 % with 40 dance floor panels", () => {
    const panels: PlacedItem[] = [];
    for (let i = 0; i < 40; i += 1) panels.push(piece("dancefloor-panel", (i % 8) - 3.5, Math.floor(i / 8) - 2));
    const before = reverberationTimes(GRAND_HALL, NO_CONTENTS);
    const after = timesWith(GRAND_HALL, panels);
    for (const band of BANDS) {
      expect(Math.abs(after[band] - before[band]) / before[band]).toBeLessThan(0.01);
    }
  });

  it("adds absorption, without NaN, for a piece scaled to 2", () => {
    const single = contentsAbsorption([absorberFor(piece("chiavari-chair"))]);
    const scaled = contentsAbsorption([absorberFor(piece("chiavari-chair", 0, 0, { scale: 2 }))]);
    const deck = contentsAbsorption([absorberFor(piece("staging-deck-6x4", 0, 0, { scale: 2 }))]);
    for (const band of BANDS) {
      expect(Number.isFinite(scaled[band])).toBe(true);
      expect(scaled[band]).toBeGreaterThan(single[band]);
      expect(Number.isFinite(deck[band])).toBe(true);
      expect(deck[band]).toBeGreaterThan(0);
    }
    const rt = timesWith(GRAND_HALL, [piece("chiavari-chair", 0, 0, { scale: 2 })]);
    for (const t of rt) expect(Number.isFinite(t)).toBe(true);
  });

  it("maps the catalogue's pieces to their absorbers", () => {
    expect(absorberFor(piece("chiavari-chair")).kind).toBe("chair-cushioned");
    for (const slug of ["burgess-turini-18-3", "checked-banquet-chair", "gallery-chair-red-gold", "pink-chair", "banquet-chair"]) {
      expect(absorberFor(piece(slug)).kind).toBe("chair-upholstered");
    }
    expect(absorberFor(piece("highchair-wooden")).kind).toBe("chair-hard");
    expect(absorberFor(piece("round-table-6ft")).kind).toBe("table-bare");
    expect(absorberFor(piece("round-table-6ft", 0, 0, { clothed: true })).kind).toBe("round-clothed");
    expect(absorberFor(piece("round-table-6ft-black")).kind).toBe("round-clothed");
    expect(absorberFor(piece("cake-cutting-table")).kind).toBe("table-bare");
    expect(absorberFor(piece("trestle-6ft-white")).kind).toBe("trestle-clothed");
    expect(absorberFor(piece("trestle-6ft-wooden")).kind).toBe("table-bare");
    expect(absorberFor(piece("round-cafe-table-white")).kind).toBe("trestle-clothed");
    expect(absorberFor(piece("bar-counter", 0, 0, { clothed: true })).kind).toBe("trestle-clothed");
    expect(absorberFor(piece("servery-unit")).kind).toBe("table-bare");
    expect(absorberFor(piece("poseur-table-white")).kind).toBe("poseur-covered");
    expect(absorberFor(piece("poseur-table")).kind).toBe("table-bare");
    for (const slug of ["platform", "dancefloor-panel", "projector", "lectern"]) {
      expect(absorberFor(piece(slug)).kind).toBe("none");
    }
    const deck = absorberFor(piece("staging-deck-6x4"));
    expect(deck.kind).toBe("fabric-face");
    expect(deck.fabricM2).toBeCloseTo(2 * (1.83 + 1.22) * 0.4 * 0.6, 9);
    const divider = absorberFor(piece("room-divider"));
    expect(divider.kind).toBe("fabric-face");
    expect(divider.fabricM2).toBeCloseTo(4.2 * 1.8 * 2 * 0.5, 9);
    const placed = absorberFor(piece("chiavari-chair", 2.5, -1.5));
    expect([placed.x, placed.z, placed.fabricM2]).toEqual([2.5, -1.5, 0]);
  });

  it("gives an unknown piece its category's absorber, and none for 'other'", () => {
    const definition = (category: "other" | "chair" | "table") => ({
      assetDefinitionId: "00000000-0000-4000-8000-000000000001",
      category,
      widthM: 1,
      depthM: 1,
      heightM: 1,
      seatCount: null,
      collisionType: "box",
    });
    expect(absorberFor(piece("imported-thing", 0, 0, { embeddedAssetDefinition: definition("other") })).kind).toBe("none");
    expect(absorberFor(piece("imported-thing")).kind).toBe("none");
    expect(absorberFor(piece("imported-thing", 0, 0, { embeddedAssetDefinition: definition("chair") })).kind).toBe("chair-hard");
    expect(absorberFor(piece("imported-thing", 0, 0, { embeddedAssetDefinition: definition("table") })).kind).toBe("table-bare");
  });
});

describe("room state", () => {
  it("gives a null space a finite default 10 x 8 x 4 m room", () => {
    const room = roomAcousticsFor(null);
    expect(room.volumeM3).toBeCloseTo(320, 9);
    // A default box has no traced result to fit, so it keeps Eyring as calculated.
    expectCalibrationInRange(room.calibration);
    expect(room.calibration).toEqual(UNCALIBRATED);
    const state = roomState(room, []);
    for (const t of state.rt) {
      expect(Number.isFinite(t)).toBe(true);
      expect(t).toBeGreaterThan(0);
    }
    expect(Number.isFinite(state.reverberantGain)).toBe(true);
  });

  it("builds an unknown space from its own dimensions, and finds a known one by slug", () => {
    const room = roomAcousticsFor({ slug: "lady-convenors-room", widthM: "6", lengthM: "9", heightM: "3.5" });
    expect(room.slug).toBe("lady-convenors-room");
    expect(room.volumeM3).toBeCloseTo(189, 9);
    const materials = new Set(room.surfaces.map((surface) => surface.material));
    expect(materials).toEqual(new Set(["timber-on-slab", "plaster-masonry"]));
    const broken = roomAcousticsFor({ slug: "odd", widthM: "", lengthM: "NaN", heightM: "-2" });
    expect(Number.isFinite(broken.volumeM3)).toBe(true);
    expect(broken.volumeM3).toBeGreaterThan(0);
    expect(roomAcousticsFor({ slug: "saloon", widthM: "7", lengthM: "12", heightM: "5.4" })).toBe(ROOM_ACOUSTICS.saloon);
  });

  it("holds the empty Grand Hall's reverberant gain at 1", () => {
    expect(Math.abs(reverberantGain(GRAND_HALL, NO_CONTENTS) - 1)).toBeLessThan(1e-9);
  });

  it("counts the air's 4 m V in the room constant, as Eyring's time does", () => {
    // Two rooms with the same surfaces and different volumes: without the air
    // their reverberant gains would be equal. R = (S alpha + 4 m V) / (1 - alpha).
    const surfaces: RoomAcoustics["surfaces"] = [
      { material: "plaster-masonry", areaM2: 400, role: "wall" },
      { material: "oak-boards-joists", areaM2: 100, role: "floor" },
    ];
    const small: RoomAcoustics = { slug: "small", volumeM3: 300, surfaces, calibration: UNCALIBRATED, source: "test" };
    const large: RoomAcoustics = { ...small, slug: "large", volumeM3: 3000 };
    const surfaceA = 400 * 0.04 + 100 * 0.07; // 1 kHz
    const m = 1.07e-3; // AIR_ATTENUATION_PER_M at 1 kHz
    const ratio = Math.sqrt((surfaceA + 4 * m * 3000) / (surfaceA + 4 * m * 300));
    expect(reverberantGain(small, NO_CONTENTS) / reverberantGain(large, NO_CONTENTS)).toBeCloseTo(ratio, 9);
    expect(ratio).toBeGreaterThan(1.1);
    // The exported room constant itself, which the listening page reads.
    const meanAlpha = surfaceA / 500;
    expect(roomConstant(small, NO_CONTENTS)).toBeCloseTo((surfaceA + 4 * m * 300) / (1 - meanAlpha), 9);
    expect(roomConstant(large, NO_CONTENTS)).toBeCloseTo((surfaceA + 4 * m * 3000) / (1 - meanAlpha), 9);
    // And the empty Grand Hall's, which every reverberant gain is relative to.
    expect(reverberantGain(small, NO_CONTENTS)).toBeCloseTo(
      Math.sqrt(roomConstant(GRAND_HALL, NO_CONTENTS) / roomConstant(small, NO_CONTENTS)),
      9,
    );
  });

  it("lowers every room's reverberant gain as contents are added", () => {
    for (const slug of ROOM_SLUGS) {
      const room = ROOM_ACOUSTICS[slug];
      const dinner = referenceDinner(slug);
      const empty = roomState(room, []).reverberantGain;
      const half = roomState(room, dinner.slice(0, Math.floor(dinner.length / 2))).reverberantGain;
      const full = roomState(room, dinner).reverberantGain;
      expect(Number.isFinite(full)).toBe(true);
      expect(half).toBeLessThan(empty);
      expect(full).toBeLessThan(half);
    }
  });

  it("puts a small, lightly absorbing room's reverberant gain above 1", () => {
    // Less total absorption than the hall means a stronger diffuse field.
    for (const slug of ["north-gallery", "south-gallery"] as const) {
      expect(reverberantGain(ROOM_ACOUSTICS[slug], NO_CONTENTS)).toBeGreaterThan(1);
    }
  });

  it("keys the state by the seven times rounded to 0.02 s", () => {
    const state = roomState(GRAND_HALL, []);
    const parts = state.key.split(",");
    expect(parts).toHaveLength(7);
    for (const band of BANDS) {
      expect(Number(parts[band])).toBeCloseTo(Math.round(state.rt[band] / 0.02) * 0.02, 9);
    }
    expect(roomState(GRAND_HALL, [piece("dancefloor-panel")]).key).toBe(state.key);
    expect(roomState(GRAND_HALL, referenceDinner("grand-hall")).key).not.toBe(state.key);
  });
});

/** The plain sum of `n` upholstered chairs, without the density cap. */
function upholsteredChairs(n: number): BandValues {
  const one = contentsAbsorption([{ kind: "chair-upholstered", fabricM2: 0, x: 0, z: 0 }]);
  return [one[0] * n, one[1] * n, one[2] * n, one[3] * n, one[4] * n, one[5] * n, one[6] * n];
}
