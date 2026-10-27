// ---------------------------------------------------------------------------
// How long each room rings, from its surfaces and what has been placed in it
// (T-677).
//
// Eyring's formula with air absorption gives each band's reverberation time
// from the room's surfaces (rooms.ts) plus the absorption of its furniture.
// The room's calibration, fitted later by the ray tracer, multiplies the
// result. Everything here is plain arithmetic, cheap enough to rerun on every
// change to the layout.
// ---------------------------------------------------------------------------

import { TRADES_HALL_ROOM_CAPACITIES, type FurnitureCategory, type Space } from "@omnitwin/types";
import { toRealWorld, toRenderSpace } from "../../constants/scale.js";
import { getCatalogueItem, getCatalogueItemBySlug } from "../catalogue.js";
import { normalizeFurnitureScale } from "../furniture-scale.js";
import { createPlacedItem, type PlacedItem } from "../placement.js";
import {
  AIR_ATTENUATION_PER_M,
  FABRIC_FACE_PER_M2,
  OBJECT_ABSORPTION,
  SURFACE_ABSORPTION,
  type AbsorberKind,
} from "./acoustic-data.js";
import type { BandValues } from "./bands.js";
import {
  ROOM_ACOUSTICS,
  ROOM_PLANS,
  UNCALIBRATED,
  isRoomSlug,
  type RoomAcoustics,
  type RoomSlug,
} from "./rooms.js";

/** One placed piece as the room hears it. Positions are metres on the floor. */
export interface Absorber {
  readonly kind: AbsorberKind;
  /** Hung fabric face in m2, already scaled; only a `fabric-face` piece has any. */
  readonly fabricM2: number;
  readonly x: number;
  readonly z: number;
  /**
   * The piece's surface-area scale (its uniform scale squared), applied to
   * its per-piece absorption row. Omitted means 1. EST: a piece's absorption
   * is taken to grow with its surface area, so a piece drawn twice the size
   * absorbs four times as much.
   */
  readonly areaScale?: number;
}

export interface RoomState {
  readonly rt: BandValues;
  readonly reverberantGain: number;
  /** The seven times rounded to 0.02 s, so an unchanged room keeps its tail. */
  readonly key: string;
}

type MutableBands = [number, number, number, number, number, number, number];

const SABINE = 0.161;
/** Eyring's mean absorption is held below this so the logarithm stays finite. */
const MAX_MEAN_ABSORPTION = 0.99;
const ONE_KHZ = 3;

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const UPHOLSTERED_CHAIRS: ReadonlySet<string> = new Set([
  "burgess-turini-18-3",
  "checked-banquet-chair",
  "gallery-chair-red-gold",
  "pink-chair",
  "banquet-chair",
]);
const TRESTLE_LIKE: ReadonlySet<string> = new Set(["ceremony-table", "bar-counter", "servery-unit"]);
const STAGING_DECKS: ReadonlySet<string> = new Set(["staging-deck-6x4", "staging-deck-6x3"]);
/** Share of a staging deck's skirt that is fabric (EST). */
const DECK_SKIRT_SHARE = 0.6;
/** Share of a divider's two faces that is fabric (EST). */
const DIVIDER_FABRIC_SHARE = 0.5;

/** A table counts as dressed if it is clothed or its slug names a white or black cover. */
function isDressed(slug: string, clothed: boolean): boolean {
  return clothed || slug.endsWith("-white") || slug.endsWith("-black");
}

function kindFor(slug: string, category: FurnitureCategory, clothed: boolean): AbsorberKind {
  if (slug === "chiavari-chair") return "chair-cushioned";
  if (UPHOLSTERED_CHAIRS.has(slug)) return "chair-upholstered";
  if (slug.startsWith("highchair-")) return "chair-hard";
  // Cafe tables are checked before rounds: "round-cafe-table-white" is a cafe
  // table, whose cloth is nearer a trestle's than a six-foot round's.
  if (slug.includes("-cafe-table-") || slug.startsWith("trestle-") || TRESTLE_LIKE.has(slug)) {
    return isDressed(slug, clothed) ? "trestle-clothed" : "table-bare";
  }
  if (slug.startsWith("round-") || slug === "cake-cutting-table") {
    return isDressed(slug, clothed) ? "round-clothed" : "table-bare";
  }
  if (slug === "poseur-table-white" || slug === "poseur-table-black") return "poseur-covered";
  if (slug === "poseur-table") return "table-bare";
  if (STAGING_DECKS.has(slug) || slug === "room-divider") return "fabric-face";
  // Platforms, the dance floor, AV, dressing and anything imported go by
  // category; none of the catalogue's non-seat, non-table pieces absorbs.
  if (category === "chair") return "chair-hard";
  if (category === "table") return "table-bare";
  return "none";
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** The absorber a placed piece makes in the room. */
export function absorberFor(item: PlacedItem): Absorber {
  const entry = getCatalogueItem(item.catalogueItemId);
  const embedded = item.embeddedAssetDefinition;
  const slug = entry?.slug ?? item.catalogueItemId;
  const category = entry?.category ?? embedded?.category ?? "other";
  const width = entry?.width ?? embedded?.widthM ?? 0;
  const depth = entry?.depth ?? embedded?.depthM ?? 0;
  const height = entry?.height ?? embedded?.heightM ?? 0;
  const scale = normalizeFurnitureScale(item.scale);
  const areaScale = scale * scale;
  const kind = kindFor(slug, category, item.clothed);

  let fabricM2 = 0;
  if (STAGING_DECKS.has(slug)) fabricM2 = 2 * (width + depth) * height * DECK_SKIRT_SHARE * areaScale;
  else if (slug === "room-divider") fabricM2 = width * height * 2 * DIVIDER_FABRIC_SHARE * areaScale;

  return { kind, fabricM2, x: finite(toRealWorld(item.x)), z: finite(toRealWorld(item.z)), areaScale };
}

// ---------------------------------------------------------------------------
// Contents
// ---------------------------------------------------------------------------

/** The grid chairs' floor area is measured on, and the edge strip's width. */
const SEAT_CELL_M = 0.5;
const SEAT_CELL_M2 = SEAT_CELL_M * SEAT_CELL_M;
/** Absorption per m2 of a packed seating block, edge strip included (EST). */
const SEATING_BLOCK_PER_M2: BandValues = [0.35, 0.45, 0.57, 0.61, 0.59, 0.55, 0.55];
const CELL_OFFSET = 32768;
const CELL_SPAN = 65536;

function isChair(kind: AbsorberKind): boolean {
  return kind === "chair-hard" || kind === "chair-cushioned" || kind === "chair-upholstered";
}

function addInto(sum: MutableBands, row: BandValues, k: number): void {
  sum[0] += row[0] * k;
  sum[1] += row[1] * k;
  sum[2] += row[2] * k;
  sum[3] += row[3] * k;
  sum[4] += row[4] * k;
  sum[5] += row[5] * k;
  sum[6] += row[6] * k;
}

function cellIndex(metres: number): number {
  const cell = Math.floor(metres / SEAT_CELL_M) + CELL_OFFSET;
  return Math.min(CELL_SPAN - 2, Math.max(1, cell));
}

/**
 * The total absorption, in m2 per band, of the pieces in a room.
 *
 * Chairs packed tightly absorb by the floor they cover, not by headcount
 * (Beranek's seating-area method). Their sum is capped at the area of the
 * 0.5 m cells they stand in, grown by a 0.5 m edge strip on every side, times
 * a packed block's absorption per m2. The grown area can only grow as chairs
 * are added, so another chair never lowers the total. The cap binds only where
 * chairs stand denser than about one per 0.5 m2; a single chair is far below
 * it.
 */
export function contentsAbsorption(absorbers: readonly Absorber[]): BandValues {
  const other: MutableBands = [0, 0, 0, 0, 0, 0, 0];
  const chairs: MutableBands = [0, 0, 0, 0, 0, 0, 0];
  const seatCells = new Set<number>();

  for (const absorber of absorbers) {
    const { kind } = absorber;
    if (kind === "none") continue;
    if (kind === "fabric-face") {
      addInto(other, FABRIC_FACE_PER_M2, Math.max(0, finite(absorber.fabricM2)));
      continue;
    }
    const areaScale = Math.max(0, finite(absorber.areaScale ?? 1));
    if (!isChair(kind)) {
      addInto(other, OBJECT_ABSORPTION[kind], areaScale);
      continue;
    }
    addInto(chairs, OBJECT_ABSORPTION[kind], areaScale);
    const cx = cellIndex(finite(absorber.x));
    const cz = cellIndex(finite(absorber.z));
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) seatCells.add((cx + dx) * CELL_SPAN + (cz + dz));
    }
  }

  const seatingArea = seatCells.size * SEAT_CELL_M2;
  return [
    other[0] + Math.min(chairs[0], seatingArea * SEATING_BLOCK_PER_M2[0]),
    other[1] + Math.min(chairs[1], seatingArea * SEATING_BLOCK_PER_M2[1]),
    other[2] + Math.min(chairs[2], seatingArea * SEATING_BLOCK_PER_M2[2]),
    other[3] + Math.min(chairs[3], seatingArea * SEATING_BLOCK_PER_M2[3]),
    other[4] + Math.min(chairs[4], seatingArea * SEATING_BLOCK_PER_M2[4]),
    other[5] + Math.min(chairs[5], seatingArea * SEATING_BLOCK_PER_M2[5]),
    other[6] + Math.min(chairs[6], seatingArea * SEATING_BLOCK_PER_M2[6]),
  ];
}

// ---------------------------------------------------------------------------
// Reverberation
// ---------------------------------------------------------------------------

interface SurfaceTotals {
  readonly areaM2: number;
  readonly absorption: BandValues;
}

function surfaceTotals(room: RoomAcoustics): SurfaceTotals {
  let areaM2 = 0;
  const absorption: MutableBands = [0, 0, 0, 0, 0, 0, 0];
  for (const surface of room.surfaces) {
    const area = Math.max(0, finite(surface.areaM2));
    areaM2 += area;
    addInto(absorption, SURFACE_ABSORPTION[surface.material], area);
  }
  return { areaM2, absorption };
}

function meanAbsorption(totalAbsorption: number, areaM2: number): number {
  if (!(areaM2 > 0)) return 0;
  return Math.min(MAX_MEAN_ABSORPTION, Math.max(0, totalAbsorption / areaM2));
}

/**
 * Each band's reverberation time in seconds: Eyring with air, times the
 * room's calibration.
 *
 *   T = 0.161 V / (-S ln(1 - min(0.99, (sum S alpha + A_contents) / S)) + 4 m V)
 */
export function reverberationTimes(room: RoomAcoustics, contents: BandValues): BandValues {
  const { areaM2, absorption } = surfaceTotals(room);
  const volume = Math.max(0, finite(room.volumeM3));
  const band = (i: 0 | 1 | 2 | 3 | 4 | 5 | 6): number => {
    const mean = meanAbsorption(absorption[i] + Math.max(0, finite(contents[i])), areaM2);
    const denominator = -areaM2 * Math.log(1 - mean) + 4 * AIR_ATTENUATION_PER_M[i] * volume;
    if (!(denominator > 0)) return 0;
    return ((SABINE * volume) / denominator) * finite(room.calibration[i]);
  };
  return [band(0), band(1), band(2), band(3), band(4), band(5), band(6)];
}

/** The room constant R = A / (1 - mean alpha) at 1 kHz, in m2. */
function roomConstant(room: RoomAcoustics, contents: BandValues): number {
  const { areaM2, absorption } = surfaceTotals(room);
  const total = absorption[ONE_KHZ] + Math.max(0, finite(contents[ONE_KHZ]));
  const mean = meanAbsorption(total, areaM2);
  return Math.max(1e-6, total / (1 - mean));
}

const NO_CONTENTS: BandValues = [0, 0, 0, 0, 0, 0, 0];
let referenceRoomConstant: number | null = null;

/**
 * The reverberant field's level against the empty Grand Hall's, as an
 * amplitude: sqrt(4 / R) / sqrt(4 / R_ref) at 1 kHz, where R = A / (1 - mean
 * alpha). The diffuse field's energy density goes as 4 / R, so:
 *   - the empty Grand Hall is 1;
 *   - added contents raise R and lower any room's value;
 *   - a small, lightly absorbing room has less total absorption than the
 *     hall, so a stronger diffuse field, and is above 1 (the galleries are
 *     about 1.7), though its tail is shorter.
 */
export function reverberantGain(room: RoomAcoustics, contents: BandValues): number {
  referenceRoomConstant ??= roomConstant(ROOM_ACOUSTICS["grand-hall"], NO_CONTENTS);
  return Math.sqrt(referenceRoomConstant / roomConstant(room, contents));
}

/** The room's times, reverberant level and cache key with these pieces in it. */
export function roomState(room: RoomAcoustics, items: readonly PlacedItem[]): RoomState {
  const contents = contentsAbsorption(items.map(absorberFor));
  const rt = reverberationTimes(room, contents);
  return {
    rt,
    reverberantGain: reverberantGain(room, contents),
    key: rt.map((t) => (Math.round(t / 0.02) * 0.02).toFixed(2)).join(","),
  };
}

// ---------------------------------------------------------------------------
// Rooms by space
// ---------------------------------------------------------------------------

/** The room assumed when there is no space to go by. */
const DEFAULT_BOX = { lengthM: 10, widthM: 8, heightM: 4 } as const;

function positive(text: string | undefined, fallback: number): number {
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** A plain box: a timber floor on a slab, plastered walls and ceiling. */
function boxRoom(slug: string, length: number, width: number, height: number): RoomAcoustics {
  return {
    slug,
    volumeM3: length * width * height,
    surfaces: [
      { material: "timber-on-slab", areaM2: length * width, role: "floor" },
      { material: "plaster-masonry", areaM2: 2 * (length + width) * height, role: "wall" },
      { material: "plaster-masonry", areaM2: length * width, role: "ceiling" },
    ],
    calibration: UNCALIBRATED,
    source: `default box ${length.toFixed(2)} x ${width.toFixed(2)} x ${height.toFixed(2)} m from the space's dimensions`,
  };
}

/**
 * The acoustics of a space: its surveyed room by slug, or a plain box from its
 * own dimensions (10 x 8 x 4 m with no space at all).
 */
export function roomAcousticsFor(
  space: Pick<Space, "slug" | "widthM" | "lengthM" | "heightM"> | null,
): RoomAcoustics {
  if (space !== null && isRoomSlug(space.slug)) return ROOM_ACOUSTICS[space.slug];
  return boxRoom(
    space?.slug ?? "default",
    positive(space?.lengthM, DEFAULT_BOX.lengthM),
    positive(space?.widthM, DEFAULT_BOX.widthM),
    positive(space?.heightM, DEFAULT_BOX.heightM),
  );
}

// ---------------------------------------------------------------------------
// The reference dinner
// ---------------------------------------------------------------------------

const REFERENCE_CHAIR = "chiavari-chair";
const REFERENCE_ROUND = "round-table-6ft-white";
const COVERS_PER_ROUND = 10;
/** From a round's centre to its chairs' centres: the 0.915 m top plus a seat. */
const CHAIR_RING_M = 1.25;
const referenceDinners = new Map<RoomSlug, readonly PlacedItem[]>();

function catalogueId(slug: string): string {
  return getCatalogueItemBySlug(slug)?.id ?? slug;
}

/**
 * The dressed room the tracer and the listening page share: the room's
 * published dinner capacity in Chiavari chairs, ten to a white six-foot round,
 * the rounds on a regular grid across the room's plan and each ring of chairs
 * turned to its table.
 */
export function referenceDinner(slug: RoomSlug): readonly PlacedItem[] {
  const cached = referenceDinners.get(slug);
  if (cached !== undefined) return cached;

  const covers = TRADES_HALL_ROOM_CAPACITIES[slug].dinner;
  const rounds = Math.ceil(covers / COVERS_PER_ROUND);
  const plan = ROOM_PLANS[slug];
  const columns = Math.max(1, Math.ceil(Math.sqrt((rounds * plan.lengthM) / plan.widthM)));
  const rows = Math.ceil(rounds / columns);
  const chairId = catalogueId(REFERENCE_CHAIR);
  const roundId = catalogueId(REFERENCE_ROUND);

  const items: PlacedItem[] = [];
  let seated = 0;
  for (let t = 0; t < rounds; t += 1) {
    const x = -plan.lengthM / 2 + ((t % columns) + 0.5) * (plan.lengthM / columns);
    const z = -plan.widthM / 2 + (Math.floor(t / columns) + 0.5) * (plan.widthM / rows);
    const group = `reference-${slug}-table-${String(t)}`;
    items.push(createPlacedItem(roundId, toRenderSpace(x), toRenderSpace(z), 0, group, 0, group));
    const ring = Math.min(COVERS_PER_ROUND, covers - seated);
    for (let c = 0; c < ring; c += 1) {
      const angle = (2 * Math.PI * c) / ring;
      const cx = x + CHAIR_RING_M * Math.cos(angle);
      const cz = z + CHAIR_RING_M * Math.sin(angle);
      // Turned so its front faces the table's centre.
      const facing = Math.atan2(-Math.cos(angle), -Math.sin(angle));
      const id = `reference-${slug}-chair-${String(seated + c)}`;
      items.push(createPlacedItem(chairId, toRenderSpace(cx), toRenderSpace(cz), facing, group, 0, id));
    }
    seated += ring;
  }
  referenceDinners.set(slug, items);
  return items;
}
