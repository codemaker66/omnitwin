// ---------------------------------------------------------------------------
// The surfaces a piece can land on, and how each one answers (T-677).
//
// A set-down is the piece's own resonant parts struck through its feet, heard
// through the surface under them: a bank of board modes, sometimes a low
// joist thump or a hollow cavity, and a high cut-off where a soft surface
// swallows the top. The numbers come from the research notes' sections
// 4.1–4.3; task 6's modal renderer reads the resolved responses from
// surfaceResponse and nothing else.
// ---------------------------------------------------------------------------

import { getCatalogueItemBySlug } from "../catalogue.js";
import { isRoomSlug, type RoomSlug } from "./rooms.js";

export type SurfaceKind =
  | "oak-boards-joists"
  | "oak-parquet"
  | "timber-on-slab"
  | "carpet"
  | "stage-deck"
  | "dance-floor"
  | "table-top";

/** A bank of resonant modes spread between two frequencies. */
export interface ModeBank {
  readonly lowHz: number;
  readonly highHz: number;
  readonly count: number;
  /** Loss factor: the bank's modes decay at eta times their frequency over pi. */
  readonly eta: number;
  /** Level of the bank relative to its own surface's, in dB. */
  readonly gainDb: number;
}

export interface SurfaceResponse {
  readonly kind: SurfaceKind;
  /** How hard the surface strikes back: 1 is oak, a soft surface is near 0. */
  readonly hardness: number;
  /** The surface's own board (or panel, or deck) modes. */
  readonly boards: ModeBank | null;
  /** The floor's lowest joist-and-void thump. */
  readonly thump: { readonly hz: number; readonly zeta: number } | null;
  /** The hollow under a stage deck. */
  readonly cavity: ModeBank | null;
  readonly highCutHz: number;
  /** The room's floor heard through this surface, once resolved for a room. */
  readonly beneath: ModeBank | null;
}

const HARD_CUT_HZ = 16000;

const bank = (lowHz: number, highHz: number, count: number, eta: number): ModeBank => ({ lowHz, highHz, count, eta, gainDb: 0 });

/** The base definitions. A surface that sits on the room's floor has `beneath` null here and gains it in surfaceResponse. */
export const SURFACES: Readonly<Record<SurfaceKind, SurfaceResponse>> = {
  "oak-boards-joists": {
    kind: "oak-boards-joists",
    hardness: 1,
    boards: bank(150, 300, 24, 0.07),
    thump: { hz: 14, zeta: 0.03 },
    cavity: null,
    highCutHz: HARD_CUT_HZ,
    beneath: null,
  },
  "oak-parquet": {
    kind: "oak-parquet",
    hardness: 1,
    boards: bank(220, 480, 20, 0.09),
    thump: { hz: 16, zeta: 0.04 },
    cavity: null,
    highCutHz: HARD_CUT_HZ,
    beneath: null,
  },
  "timber-on-slab": {
    kind: "timber-on-slab",
    hardness: 1.1,
    boards: bank(400, 900, 12, 0.12),
    thump: null,
    cavity: null,
    highCutHz: HARD_CUT_HZ,
    beneath: null,
  },
  // Carpet has no modes of its own: what is heard is the floor under it.
  carpet: {
    kind: "carpet",
    hardness: 0.05,
    boards: null,
    thump: null,
    cavity: null,
    highCutHz: 2500,
    beneath: null,
  },
  "stage-deck": {
    kind: "stage-deck",
    hardness: 0.9,
    boards: bank(200, 600, 18, 0.06),
    thump: null,
    cavity: bank(90, 160, 10, 0.05),
    highCutHz: HARD_CUT_HZ,
    beneath: null,
  },
  "dance-floor": {
    kind: "dance-floor",
    hardness: 1,
    boards: bank(300, 700, 14, 0.08),
    thump: null,
    cavity: null,
    highCutHz: HARD_CUT_HZ,
    beneath: null,
  },
  "table-top": {
    kind: "table-top",
    hardness: 0.8,
    boards: bank(120, 900, 30, 0.04),
    thump: null,
    cavity: null,
    highCutHz: HARD_CUT_HZ,
    beneath: null,
  },
};

const FLOORS: Readonly<Record<RoomSlug, SurfaceKind>> = {
  "grand-hall": "oak-boards-joists",
  saloon: "oak-parquet",
  "robert-adam-room": "oak-boards-joists",
  "reception-room": "timber-on-slab",
  "north-gallery": "carpet",
  "south-gallery": "carpet",
};

/** The floor of a room; a missing or unknown room is timber over a slab. */
export function floorKindForRoom(slug: string | null): SurfaceKind {
  return slug !== null && isRoomSlug(slug) ? FLOORS[slug] : "timber-on-slab";
}

/** What a foot lands on: a deck, a dance-floor panel, a table, or else the room's floor. */
export function surfaceKindForSupport(supportSlug: string | null, roomSlug: string | null): SurfaceKind {
  if (supportSlug !== null) {
    if (supportSlug.startsWith("staging-deck-") || supportSlug.startsWith("platform")) return "stage-deck";
    if (supportSlug === "dancefloor-panel") return "dance-floor";
    if (getCatalogueItemBySlug(supportSlug)?.category === "table") return "table-top";
  }
  return floorKindForRoom(roomSlug);
}

/** The timber a surface stands on: the room's floor, or, under a carpeted room, the attic's boards. */
function timberUnder(roomSlug: string | null): SurfaceKind {
  const floor = floorKindForRoom(roomSlug);
  return floor === "carpet" ? "oak-boards-joists" : floor;
}

function deepened(source: ModeBank | null, db: number): ModeBank | null {
  return source === null ? null : { ...source, gainDb: source.gainDb + db };
}

function beneathBank(kind: SurfaceKind, roomSlug: string | null): ModeBank | null {
  // Carpet's sub-floor is always oak-boards-joists: the galleries' attic floor is timber.
  if (kind === "carpet") return deepened(SURFACES["oak-boards-joists"].boards, -18);
  if (kind === "dance-floor") return deepened(SURFACES[timberUnder(roomSlug)].boards, -10);
  return null;
}

const resolved = new Map<string, SurfaceResponse>();

/**
 * The surface's response with the room's floor resolved under it: carpet over
 * the sub-floor's boards at −18 dB, a dance floor over the room's floor at
 * −10 dB, nothing beneath any other kind.
 */
export function surfaceResponse(kind: SurfaceKind, roomSlug: string | null): SurfaceResponse {
  const base = SURFACES[kind];
  if (kind !== "carpet" && kind !== "dance-floor") return base;
  // Carpet's beneath does not depend on the room, so its key is the kind alone.
  const key = kind === "carpet" ? kind : `${kind}|${timberUnder(roomSlug)}`;
  const cached = resolved.get(key);
  if (cached !== undefined) return cached;
  const response: SurfaceResponse = { ...base, beneath: beneathBank(kind, roomSlug) };
  resolved.set(key, response);
  return response;
}
