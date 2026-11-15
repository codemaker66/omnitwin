import { describe, expect, it } from "vitest";
import { toRealWorld, toRenderSpace } from "../../../constants/scale.js";
import { computeBoundingBox, roomGeometries, type RoomGeometry } from "../../../data/room-geometries.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "../../catalogue.js";
import { landingDelays } from "../../furniture-motion.js";
import { createPlacedItem, type PlacedItem } from "../../placement.js";
import { seededRandom } from "../../planner-sound-render.js";
import { bodyFor, type BodyFamily, type SetDownBody } from "../bodies.js";
import { planCascade, type CascadePiece, type CascadeVoice } from "../cascade.js";
import { SetDownFatigue } from "../fatigue.js";
import { EAR_HEIGHT_M, REFERENCE_DISTANCE_M, clampEarToRoom, directPath, earFor, type Ear } from "../listener.js";
import type { Vec3 } from "../reflections.js";
import { referenceDinner } from "../room-acoustics.js";
import { ROOM_ACOUSTICS, ROOM_PLANS, type RoomSlug } from "../rooms.js";
import { presentDelayFor, setDownStartTime, type AudioClock } from "../timing.js";
import { footPositions, landingRender, settleSpeedFor, voiceInput } from "../voice.js";

const ROOM_SLUGS: readonly RoomSlug[] = ["grand-hall", "saloon", "robert-adam-room", "reception-room", "north-gallery", "south-gallery"];
/** The listening page's listener faces +x, so +z is to the right. */
const RIGHT: Vec3 = { x: 0, y: 0, z: 1 };
const GRAND_HALL = roomGeometries["Grand Hall"]!;

function slugOf(item: PlacedItem): string {
  return getCatalogueItem(item.catalogueItemId)?.slug ?? item.catalogueItemId;
}

function familyOf(item: PlacedItem): BodyFamily {
  return bodyFor(slugOf(item)).family;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function clock(currentTime: number, outputLatency: number): AudioClock {
  return { currentTime, outputLatency, sampleRate: 48000 };
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

describe("timing a set-down to its frame", () => {
  it("never starts before currentTime", () => {
    for (const latency of [0, 0.005, 0.02, 0.06, 0.2, Number.NaN]) {
      for (const delay of [0, 1 / 240, 1 / 60, 1 / 30]) {
        for (const onset of [0, 0.004, 0.03, 0.2]) {
          expect(setDownStartTime(clock(12.5, latency), delay, onset)).toBeGreaterThanOrEqual(12.5);
        }
      }
    }
  });

  it("lands the onset on the frame: present delay less the output's latency less the onset", () => {
    expect(setDownStartTime(clock(3, 0.005), 0.016, 0)).toBeCloseTo(3.011, 12);
    // Carpet's bottoming thud 4 ms into the render: started 4 ms sooner, so it is heard at the frame.
    expect(setDownStartTime(clock(3, 0.005), 0.016, 0.004)).toBeCloseTo(3.007, 12);
    // An output slower than the frame: it starts now, never earlier.
    expect(setDownStartTime(clock(3, 0.06), 0.016, 0)).toBe(3);
  });

  it("holds the present delay to a 240 Hz frame at least and a 30 fps frame at most", () => {
    expect(presentDelayFor(0.5)).toBe(1 / 30);
    expect(presentDelayFor(0)).toBe(1 / 240);
    expect(presentDelayFor(1 / 60)).toBe(1 / 60);
  });
});

// ---------------------------------------------------------------------------
// The cascade
// ---------------------------------------------------------------------------

/**
 * The listening page's cascade as Blake approved it on 14 Nov (page.ts at
 * cdf0734d, :516-541 and :558-579), kept here as the reference the engine is
 * held to: its selection, its spacing and its levels.
 */
function approvedCascade(items: readonly PlacedItem[], seed: number): readonly CascadeVoice[] {
  const VOICES = 8;
  const GAP_S = 0.085;
  const SPREAD_S = 0.025;
  const STEP_DB = -1;
  const tables: PlacedItem[] = [];
  const chairs: PlacedItem[] = [];
  const families = new Set<BodyFamily>();
  for (const item of items) {
    const family = familyOf(item);
    if (family === "chair") chairs.push(item);
    else if (!families.has(family)) {
      families.add(family);
      tables.push(item);
    }
  }
  const picked = tables.slice(0, VOICES);
  const count = Math.min(VOICES - picked.length, chairs.length);
  for (let k = 0; k < count; k += 1) {
    const chair = chairs[Math.floor(((k + 0.5) * chairs.length) / count)];
    if (chair !== undefined) picked.push(chair);
  }
  const random = seededRandom(seed);
  let offset = 0;
  return picked.map((item, index) => {
    if (index > 0) offset += GAP_S + SPREAD_S * random();
    return { id: item.id, offsetSeconds: offset, levelDb: STEP_DB * index };
  });
}

function landingAtOnce(items: readonly PlacedItem[]): readonly CascadePiece[] {
  return items.map((item) => ({ id: item.id, family: familyOf(item), landsAfterSeconds: 0 }));
}

describe("the cascade", () => {
  it("is the approved page's cascade, byte for byte, when every piece lands at once", () => {
    for (const slug of ROOM_SLUGS) {
      const dinner = referenceDinner(slug);
      for (let seed = 1; seed <= 20; seed += 1) {
        const approved = approvedCascade(dinner, seed);
        expect(approved).toHaveLength(8);
        // toStrictEqual compares numbers with Object.is: every offset and level to the bit, -0 included.
        expect(planCascade(landingAtOnce(dinner), seed)).toStrictEqual(approved);
      }
    }
  });

  it("plays eight voices from a real Lay out, none before its own piece lands, at most three in 250 ms, each softer", () => {
    const dinner = referenceDinner("grand-hall");
    expect(dinner.filter((item) => familyOf(item) === "chair")).toHaveLength(180);
    expect(dinner.filter((item) => familyOf(item) !== "chair")).toHaveLength(18);
    const delays = landingDelays(
      dinner.map((item) => ({ id: item.id, x: item.x, z: item.z, groupId: item.groupId, isTable: familyOf(item) !== "chair" })),
    );
    const least = Math.min(...delays.values());
    const pieces: CascadePiece[] = dinner.map((item) => ({
      id: item.id,
      family: familyOf(item),
      landsAfterSeconds: (delays.get(item.id) ?? Number.NaN) - least,
    }));
    const landsAfter = new Map(pieces.map((piece) => [piece.id, piece.landsAfterSeconds]));
    // The ripple and the chairs' stagger really do spread the landings.
    expect(Math.max(...landsAfter.values())).toBeGreaterThan(0.2);
    for (let seed = 1; seed <= 20; seed += 1) {
      const voices = planCascade(pieces, seed);
      expect(voices).toHaveLength(8);
      for (const voice of voices) expect(voice.offsetSeconds).toBeGreaterThanOrEqual(landsAfter.get(voice.id)!);
      for (const voice of voices) {
        const within = voices.filter((other) => other.offsetSeconds >= voice.offsetSeconds && other.offsetSeconds < voice.offsetSeconds + 0.25);
        expect(within.length).toBeLessThanOrEqual(3);
      }
      for (let k = 1; k < voices.length; k += 1) expect(voices[k]!.levelDb).toBeLessThan(voices[k - 1]!.levelDb);
    }
  });

  it("gives two pieces a voice each, at their own landings", () => {
    const voices = planCascade(
      [
        { id: "late-chair", family: "chair", landsAfterSeconds: 0.05 },
        { id: "round", family: "round-table", landsAfterSeconds: 0 },
      ],
      7,
    );
    expect(voices.map((voice) => voice.id)).toEqual(["round", "late-chair"]);
    expect(voices.map((voice) => voice.offsetSeconds)).toEqual([0, 0.05]);
    expect(voices[0]!.levelDb).toBeCloseTo(0, 12);
    expect(voices[1]!.levelDb).toBeCloseTo(-1, 12);
  });
});

// ---------------------------------------------------------------------------
// The ear
// ---------------------------------------------------------------------------

/** The page's room for its room-end listener (page.ts @ cdf0734d :84-107): the drawn room, or the galleries' plan. */
function pageRoom(slug: RoomSlug): RoomGeometry {
  const names: Readonly<Record<RoomSlug, string | null>> = {
    "grand-hall": "Grand Hall",
    saloon: "Saloon",
    "robert-adam-room": "Robert Adam Room",
    "reception-room": "Reception Room",
    "north-gallery": null,
    "south-gallery": null,
  };
  const name = names[slug];
  const drawn = name === null ? undefined : roomGeometries[name];
  if (drawn !== undefined) return drawn;
  const x = ROOM_PLANS[slug].lengthM / 2;
  const z = ROOM_PLANS[slug].widthM / 2;
  return { wallPolygon: [[-x, -z], [x, -z], [x, z], [-x, z]], ceilingHeight: 2.8, features: [], hasDome: false, domeRadius: 0 };
}

/** "Set it down": the page's source and ear, `distanceM` apart across the origin (page.ts @ cdf0734d :499-502). */
function pagePieceEar(distanceM: number, height: number): { readonly source: Vec3; readonly ear: Vec3 } {
  const across = Math.sqrt(Math.max(0, distanceM ** 2 - (1.6 - height) ** 2));
  return { source: { x: across / 2, y: height, z: 0 }, ear: { x: -across / 2, y: 1.6, z: 0 } };
}

/** "Lay out a dinner": the page's ear on the line to its room-end listener (page.ts @ cdf0734d :571-576). */
function pageCascadeEar(viewer: Vec3, source: Vec3, distanceM: number): Vec3 {
  const away = distance(viewer, source);
  const reach = Math.min(Math.max(away, 2), distanceM);
  const along = Math.sqrt(Math.max(0, reach ** 2 - (1.6 - source.y) ** 2));
  const flat = Math.hypot(viewer.x - source.x, viewer.z - source.z);
  const k = flat > 1e-6 ? along / flat : 0;
  return { x: source.x + (viewer.x - source.x) * k, y: 1.6, z: source.z + (viewer.z - source.z) * k };
}

function expectNear(actual: Vec3, expected: Vec3, tolerance: number): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.z - expected.z)).toBeLessThanOrEqual(tolerance);
}

const DISTANCES_M = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6];

/** Whether `p` is inside the outline, by the even-odd rule. */
function insideOutline(polygon: RoomGeometry["wallPolygon"], p: Vec3): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [ax, az] = polygon[i]!;
    const [bx, bz] = polygon[j]!;
    if (az > p.z !== bz > p.z && p.x < ((bx - ax) * (p.z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

/** The distance from `p` to the nearest wall of the outline. */
function toNearestWall(polygon: RoomGeometry["wallPolygon"], p: Vec3): number {
  let nearest = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const [ax, az] = polygon[i]!;
    const [bx, bz] = polygon[(i + 1) % polygon.length]!;
    const ex = bx - ax;
    const ez = bz - az;
    const t = Math.min(1, Math.max(0, ((p.x - ax) * ex + (p.z - az) * ez) / (ex * ex + ez * ez)));
    nearest = Math.min(nearest, Math.hypot(p.x - (ax + t * ex), p.z - (az + t * ez)));
  }
  return nearest;
}

describe("the ear", () => {
  it("stands 6 m from a landing seen from 20 m, and 2 m from one seen from 1 m, at 1.6 m", () => {
    const landing: Vec3 = { x: 1, y: 0, z: 2 };
    const far = earFor({ position: { x: 21, y: 0, z: 2 }, right: RIGHT }, landing, false);
    expect(distance(far.position, landing)).toBeCloseTo(6, 12);
    expect(far.position.y).toBe(EAR_HEIGHT_M);
    // On the landing's line towards the camera.
    expect(far.position.z).toBeCloseTo(2, 12);
    expect(far.position.x).toBeGreaterThan(landing.x);
    const near = earFor({ position: { x: 1, y: 0, z: 3 }, right: RIGHT }, landing, false);
    expect(distance(near.position, landing)).toBeCloseTo(2, 12);
    expect(near.position.y).toBe(EAR_HEIGHT_M);
    expect(near.position.x).toBeCloseTo(1, 12);
  });

  it("is the camera itself at 1.6 m when walking, its right made level", () => {
    const ear = earFor({ position: { x: 3, y: 1.7, z: -2 }, right: { x: 0, y: 0.5, z: 2 } }, { x: 9, y: 0, z: 9 }, true);
    expect(ear.position).toEqual({ x: 3, y: EAR_HEIGHT_M, z: -2 });
    expect(ear.right).toEqual({ x: 0, y: 0, z: 1 });
    // A right that points straight up has no level part: +z stands in.
    expect(earFor({ position: { x: 0, y: 1, z: 0 }, right: { x: 0, y: 1, z: 0 } }, { x: 2, y: 0, z: 0 }, false).right).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("reproduces the listening page's ears for Set it down and Lay out a dinner", () => {
    const heights = [0, ...["staging-deck-6x4", "dancefloor-panel", "trestle-6ft"].map((slug) => getCatalogueItemBySlug(slug)!.height)];
    for (const distanceM of DISTANCES_M) {
      // Set it down: the listener stands `distanceM` from the landing, so its ear is where it stands.
      for (const height of heights) {
        const { source, ear } = pagePieceEar(distanceM, height);
        const heard = earFor({ position: { x: ear.x, y: EAR_HEIGHT_M, z: 0 }, right: RIGHT }, source, false, { min: distanceM, max: distanceM });
        expectNear(heard.position, ear, 1e-12);
        expect(heard.right).toEqual(RIGHT);
      }
      // Lay out a dinner: every piece of each room's dinner, heard on the line to the listener at the room's end.
      for (const slug of ROOM_SLUGS) {
        const viewer: Vec3 = { x: computeBoundingBox(pageRoom(slug).wallPolygon).minX + 1, y: EAR_HEIGHT_M, z: 0 };
        for (const item of referenceDinner(slug)) {
          const source: Vec3 = { x: toRealWorld(item.x), y: 0, z: toRealWorld(item.z) };
          const heard = earFor({ position: viewer, right: RIGHT }, source, false, { min: REFERENCE_DISTANCE_M, max: distanceM });
          expectNear(heard.position, pageCascadeEar(viewer, source, distanceM), 1e-12);
        }
      }
    }
  });

  it("keeps the ear under the Robert Adam Room's drawn 2.18 m ceiling, and inside the Reception Room's L", () => {
    const robertAdam = roomGeometries["Robert Adam Room"]!;
    const high = clampEarToRoom({ position: { x: 0, y: 3, z: 0 }, right: RIGHT }, robertAdam);
    expect(high.position.y).toBeLessThanOrEqual(1.88 + 1e-9);
    expect(high.position.y).toBeGreaterThanOrEqual(0.3);
    expect([high.position.x, high.position.z]).toEqual([0, 0]);

    const reception = roomGeometries["Reception Room"]!;
    // In the corner the L leaves out: 0.85 m beyond the narrow arm's wall at x = 3.65.
    const outside: Ear = { position: { x: 4.5, y: 1.6, z: 4 }, right: RIGHT };
    expect(insideOutline(reception.wallPolygon, outside.position)).toBe(false);
    const clamped = clampEarToRoom(outside, reception);
    expect(insideOutline(reception.wallPolygon, clamped.position)).toBe(true);
    expect(toNearestWall(reception.wallPolygon, clamped.position)).toBeGreaterThanOrEqual(0.3 - 1e-9);
    // The nearest such point: 0.3 m inside that wall, straight across.
    expectNear(clamped.position, { x: 3.35, y: 1.6, z: 4 }, 1e-9);
    // An ear well inside is left where it is.
    const within: Ear = { position: { x: 0, y: 1.6, z: -2 }, right: RIGHT };
    expect(clampEarToRoom(within, reception)).toBe(within);
    expect(clampEarToRoom(outside, null)).toBe(outside);
  });

  it("finds the inset edge's join where an arc round the L's inward corner meets a wall's line", () => {
    // The Reception Room's inward corner at (3.65, 1): the 0.3 m arc round it meets the inset line z = 0.7 at
    // (3.65, 0.7) and the inset line x = 3.35 at (3.35, 1). An ear straight towards either join from the corner
    // is nearest that join.
    const reception = roomGeometries["Reception Room"]!;
    for (const [from, join] of [
      [{ x: 3.65, z: 0.9 }, { x: 3.65, z: 0.7 }],
      [{ x: 3.55, z: 1 }, { x: 3.35, z: 1 }],
    ] as const) {
      const clamped = clampEarToRoom({ position: { x: from.x, y: 1.6, z: from.z }, right: RIGHT }, reception);
      expectNear(clamped.position, { x: join.x, y: 1.6, z: join.z }, 1e-9);
      expect(toNearestWall(reception.wallPolygon, clamped.position)).toBeGreaterThanOrEqual(0.3 - 1e-9);
    }
  });

  it("hears a source to its right at a positive azimuth, and one 6 m away at a third of the gain", () => {
    const ear: Ear = { position: { x: 0, y: 1.6, z: 0 }, right: RIGHT };
    expect(directPath(ear, { x: 0.5, y: 0, z: 3 }).azimuthRad).toBeGreaterThan(0);
    expect(directPath(ear, { x: 0.5, y: 0, z: -3 }).azimuthRad).toBeLessThan(0);
    const away = directPath({ position: { x: 0, y: 0, z: 0 }, right: RIGHT }, { x: 6, y: 0, z: 0 });
    expect(away.distanceM).toBe(6);
    expect(away.gain).toBeCloseTo(1 / 3, 12);
  });
});

// ---------------------------------------------------------------------------
// Fatigue
// ---------------------------------------------------------------------------

describe("fatigue", () => {
  it("eases set-downs past 20 in five minutes to -3 dB at 30, a dB at most at a time, and recovers", () => {
    const fatigue = new SetDownFatigue();
    const readings: number[] = [];
    let now = 1000;
    for (let play = 1; play <= 40; play += 1) {
      now += 2000;
      fatigue.record(now, 1);
      readings.push(fatigue.levelDb(now));
    }
    expect(readings.slice(0, 20)).toEqual(new Array<number>(20).fill(0));
    expect(Math.abs(readings[24]! + 1.5)).toBeLessThanOrEqual(0.01);
    for (const reading of readings.slice(29)) expect(reading).toBe(-3);
    for (const reading of readings) expect(reading).toBeGreaterThanOrEqual(-3);
    for (let k = 1; k < readings.length; k += 1) expect(Math.abs(readings[k]! - readings[k - 1]!)).toBeLessThanOrEqual(1);

    // Five quiet minutes empty the window: it climbs back to 0, a dB at most at a time.
    now += 5 * 60 * 1000;
    const recovery = [readings.at(-1)!];
    for (let read = 0; read < 6; read += 1) recovery.push(fatigue.levelDb(now + read));
    expect(recovery.at(-1)).toBe(0);
    for (let k = 1; k < recovery.length; k += 1) {
      expect(recovery[k]! - recovery[k - 1]!).toBeGreaterThanOrEqual(0);
      expect(recovery[k]! - recovery[k - 1]!).toBeLessThanOrEqual(1);
    }
  });

  it("never jumps more than a dB between readings, even when a Lay out records thirty at once", () => {
    const fatigue = new SetDownFatigue();
    let last = fatigue.levelDb(0);
    fatigue.record(10, 30);
    const readings: number[] = [];
    for (let read = 0; read < 5; read += 1) readings.push(fatigue.levelDb(10 + read));
    for (const reading of readings) {
      expect(Math.abs(reading - last)).toBeLessThanOrEqual(1);
      last = reading;
    }
    expect(readings.at(-1)).toBe(-3);
  });
});

// ---------------------------------------------------------------------------
// The voice
// ---------------------------------------------------------------------------

function placed(slug: string, x: number, z: number, extra: Partial<PlacedItem> = {}): PlacedItem {
  const id = getCatalogueItemBySlug(slug)?.id ?? slug;
  return { ...createPlacedItem(id, toRenderSpace(x), toRenderSpace(z), 0, null, 0, `test-${slug}-${String(x)}-${String(z)}`), ...extra };
}

function voiceArgs(item: PlacedItem, placedItems: readonly PlacedItem[], ear: Ear, geometry: RoomGeometry | null = GRAND_HALL) {
  return {
    item,
    placedItems,
    roomSlug: "grand-hall",
    geometry,
    acoustics: ROOM_ACOUSTICS["grand-hall"],
    ear,
    landing: "drop-in" as const,
    handSpeed: 0,
    seed: 3,
    sampleRate: 48000,
  };
}

const HALL_EAR: Ear = { position: { x: -3, y: 1.6, z: 1 }, right: RIGHT };

describe("the voice", () => {
  it("turns a foot as three.js turns the piece, then moves it to the piece", () => {
    const item = placed("chiavari-chair", 2, 3, { rotationY: Math.PI / 2 });
    const body: SetDownBody = { ...bodyFor("chiavari-chair"), feet: [{ x: 0.5, z: 0, cap: "glide" }] };
    const [foot] = footPositions(item, body);
    expect(foot!.x).toBeCloseTo(toRenderSpace(2), 12);
    expect(foot!.z).toBeCloseTo(toRenderSpace(3 - 0.5), 12);
  });

  it("hears a chair on a deck through the deck, and one over its edge through deck and floor", () => {
    const deck = placed("staging-deck-6x4", 0, 0);
    const top = getCatalogueItemBySlug("staging-deck-6x4")!.height;
    const onDeck = placed("chiavari-chair", 0, 0, { y: top });
    const kinds = voiceInput(voiceArgs(onDeck, [deck, onDeck], HALL_EAR)).input.surfaces.map((surface) => surface.kind);
    expect(kinds).toEqual(["stage-deck", "stage-deck", "stage-deck", "stage-deck"]);

    const halfWidth = getCatalogueItemBySlug("staging-deck-6x4")!.width / 2;
    const overEdge = placed("chiavari-chair", halfWidth, 0, { y: top });
    const straddling = voiceInput(voiceArgs(overEdge, [deck, overEdge], HALL_EAR));
    const mixed = straddling.input.surfaces.map((surface) => surface.kind);
    expect(mixed.filter((kind) => kind === "stage-deck")).toHaveLength(2);
    expect(mixed.filter((kind) => kind === "oak-boards-joists")).toHaveLength(2);
    expect(straddling.surfacesKey).not.toBe(voiceInput(voiceArgs(onDeck, [deck, onDeck], HALL_EAR)).surfacesKey);
  });

  it("renders a piece the catalogue does not know, drawn at 1.7 times its size, with finite numbers", () => {
    const item = placed("imported-sculpture", 1, -1, { scale: 1.7, rotationY: 0.3 });
    const voice = voiceInput(voiceArgs(item, [item], HALL_EAR));
    expect(voice.slug).toBe("imported-sculpture");
    const { input } = voice;
    expect(input.body.feet.length).toBeGreaterThan(0);
    for (const foot of input.body.feet) expect(Number.isFinite(foot.x) && Number.isFinite(foot.z)).toBe(true);
    expect(Number.isFinite(input.body.massKg)).toBe(true);
    expect(input.surfaces).toHaveLength(input.body.feet.length);
    expect(Number.isFinite(input.direct.azimuthRad)).toBe(true);
    expect(Number.isFinite(voice.directGain) && voice.directGain > 0 && voice.directGain <= 1).toBe(true);
    expect(input.reflections.length).toBeGreaterThan(0);
    for (const reflection of input.reflections) {
      expect(Number.isFinite(reflection.delaySeconds) && Number.isFinite(reflection.azimuthRad)).toBe(true);
      for (const gain of reflection.gain) expect(Number.isFinite(gain)).toBe(true);
    }
  });

  it("renders at unit gain and returns the direct path's gain for the dry gain", () => {
    const item = placed("round-table-6ft", 2, 0, { clothed: true });
    for (const ear of [HALL_EAR, { position: { x: 2.5, y: 1.6, z: 0.5 }, right: RIGHT }]) {
      const voice = voiceInput(voiceArgs(item, [item], ear));
      expect(voice.input.direct.gain).toBe(1);
      const d = distance({ x: toRealWorld(item.x), y: toRealWorld(item.y), z: toRealWorld(item.z) }, ear.position);
      expect(voice.directGain).toBe(Math.min(1, 2 / d));
      expect(voice.input.clothed).toBe(true);
    }
  });

  it("has no reflections without a drawn room", () => {
    const item = placed("chiavari-chair", 0, 0);
    expect(voiceInput(voiceArgs(item, [item], HALL_EAR, null)).input.reflections).toEqual([]);
  });

  it("drops a drop-in at speed 1 and settles a let-go by the hand's speed", () => {
    expect(landingRender("drop-in", 0)).toEqual({ kind: "drop", speed: 1 });
    expect(landingRender("let-go", 0)).toEqual({ kind: "settle", speed: 0.5 });
    expect(landingRender("let-go", 3)).toEqual({ kind: "settle", speed: 1 });
    expect(landingRender("set-down", 0.75)).toEqual({ kind: "settle", speed: 0.75 });
    expect(settleSpeedFor(1.5)).toBe(1);
    expect(settleSpeedFor(Number.NaN)).toBe(0.5);
  });
});
