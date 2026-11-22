// ---------------------------------------------------------------------------
// The surfaces a piece can land on, and how each one answers (T-700).
//
// A set-down is the piece's own resonant parts struck through its feet, heard
// through the surface under them: a bank of board modes, sometimes a low
// joist thump or a hollow cavity, and a high cut-off where a soft surface
// swallows the top. A number with a source cites it beside it; the rest are
// marked EST (an estimate) or CALC (worked out here) with their basis, and
// the ear test judges them. Task 6's modal renderer reads the resolved
// responses from surfaceResponse and nothing else.
// ---------------------------------------------------------------------------

import { getCatalogueItemBySlug } from "../catalogue.js";
import { isRoomSlug, type RoomSlug } from "./rooms.js";
import { SURFACES, type ModeBank, type SurfaceKind, type SurfaceResponse } from "./surface-data.js";

// The surfaces' own data lives in surface-data.ts, which imports nothing, so
// the Worker renders from it without the catalogue and the rooms this module
// needs to resolve a surface for a room (R101).
export { SURFACES, surfaceKey, type ModeBank, type SurfaceKind, type SurfaceResponse } from "./surface-data.js";

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
  // Carpet's sub-floor is always oak-boards-joists: the galleries' attic floor is timber. The levels heard
  // through a covering, -18 dB under carpet and -10 dB under a dance floor, are EST.
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
