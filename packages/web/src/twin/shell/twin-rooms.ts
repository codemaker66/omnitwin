import {
  TRADES_HALL_ROOM_CAPACITIES,
  TRADES_HALL_ROOM_DIMENSIONS,
  VENUE_TRUTH_PROVENANCE,
  type PublishedRoomSlug,
  type RoomCapacity,
  type RoomDimensions,
} from "../../lib/trades-hall-venue-truth.js";

// -----------------------------------------------------------------------------
// twin-rooms — the room-identity oracle for the walkthrough HUD.
//
// It answers exactly one question: standing at THIS viewpoint, do we KNOW which
// room the visitor is in? Five viewpoints answer yes. Every other one answers
// null, and at those the HUD must say nothing about the room at all.
//
// Why the map is five entries long and not a hundred and forty-nine: the
// manifest carries `roomSlug: null` on every node (packages/types/src/twin.ts),
// and twin-copy.ts already records the standing decision — "inventing one would
// risk labelling the Saloon 'Grand Hall'". A guest told they are in the Grand
// Hall while looking at the Saloon has been lied to about the product's most
// basic claim; a guest told nothing has merely been told nothing. So the only
// ids here are ones a human validated against ground-truth photography.
// Proximity, floor bucket and nav-graph neighbourhood are all tempting and all
// wrong — a viewpoint two metres from scan_028 may be through a doorway.
//
// Adding a viewpoint is deliberately a one-line change: once the venue confirms
// what a scan looks at, add `scan_nnn: "<slug>"` below. Nothing else moves.
//
// Every number this module returns is JOINED from trades-hall-venue-truth.ts at
// read time — no capacity or dimension is restated here, not even in a comment,
// because a figure written in prose is the one a future reader trusts and the
// drift gate cannot see it. That module is pinned by its own test, and joining
// rather than copying is what keeps the gate meaningful: there is no second copy
// of any capacity figure to fall out of date.
// -----------------------------------------------------------------------------

/**
 * Viewpoints whose room identity is confirmed against ground-truth photography.
 * scan_028 and scan_046 are the same room from opposite ends — the Grand Hall
 * is long enough that its south end was captured and validated separately.
 *
 * Frozen at runtime, not merely `readonly`: this is a truth boundary, and a
 * type-level guarantee is no guarantee at all once something casts it away.
 *
 * The null prototype is load-bearing, not decoration. On a plain object literal
 * `VERIFIED_ROOM_NODES["toString"]` walks the prototype chain and hands back a
 * function — truthy — so a lookup keyed on unvalidated input would fabricate a
 * room for a viewpoint that does not exist. Node ids arrive from a URL query
 * (`?node=`), which is exactly the input you must not trust. Inherited keys are
 * not viewpoints, and here they are not keys at all.
 */
export const VERIFIED_ROOM_NODES: Readonly<Record<string, PublishedRoomSlug>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, PublishedRoomSlug>, {
    scan_028: "grand-hall",
    scan_046: "grand-hall",
    scan_058: "saloon",
    scan_105: "robert-adam-room",
    scan_126: "reception-room",
  } as const),
);

/**
 * How each room is named to a guest. Title case, article-less — the form the
 * public room cards call `shortName`, because this name is rendered as HUD
 * chrome beside the venue ("Trades Hall · Grand Hall"), where "The Grand Hall"
 * reads as prose that wandered into a label. Display names are copy, never
 * identity: nothing may be keyed off them.
 */
export const ROOM_DISPLAY_NAMES: Readonly<Record<PublishedRoomSlug, string>> = Object.freeze({
  "grand-hall": "Grand Hall",
  saloon: "Saloon",
  "robert-adam-room": "Robert Adam Room",
  "reception-room": "Reception Room",
  "north-gallery": "North Gallery",
  "south-gallery": "South Gallery",
});

/**
 * Where these figures came from, and when — rendered wherever they are shown.
 *
 * Re-exported rather than reworded so the walkthrough and the public room cards
 * carry byte-identical provenance. A hand-written restatement is a second claim
 * about the venue's own data: it can soften "planning guide" into something
 * firmer, or outlive the date it cites, and no test would notice either.
 */
export const ROOM_TRUTH_PROVENANCE = VENUE_TRUTH_PROVENANCE.capacities;

/** Everything the HUD may say about a room, once the room is actually known. */
export interface VerifiedRoom {
  /** The viewpoint the answer was given for. */
  readonly nodeId: string;
  readonly slug: PublishedRoomSlug;
  /** The venue's own name for the room, title case. */
  readonly name: string;
  /** The venue-confirmed capacities, by reference — never a copy. */
  readonly capacities: RoomCapacity;
  /** Published dimensions, or null for rooms the venue publishes none for. */
  readonly dimensions: RoomDimensions | null;
  /** Ready-to-render dimension line, or null when there is nothing to render. */
  readonly dimensionLine: string | null;
}

/**
 * Trim a published metre figure to a human string: 21 → "21", 5.4 → "5.4",
 * 2.18 → "2.18". Deliberately locale-free — a room is not 5,4 m long in one
 * market and 5.4 m in another, and these figures are the venue's own copy.
 *
 * Exported so every surface that prints a dimension — and every test that
 * asserts one — runs the SAME rounding. A test that rebuilds the expected
 * string with `String(figure)` agrees only until the venue publishes a third
 * decimal, at which point the suite fails at the assertion rather than at the
 * rounding, and the tempting repair is to loosen the test. That would invert
 * the drift gate: the panel would end up pinned to a second formatter instead
 * of to the published truth.
 */
export function metres(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * The published dimension line for a room, or null when the venue publishes no
 * dimensions for it — the two galleries — in which case the caller renders
 * nothing at all rather than an empty field or an inferred figure.
 *
 * Renders the published qualifier when there is one — the Grand Hall's dome note
 * is the single most asked-about fact in the building, and dropping it halves
 * the room. The qualifier joins with an em dash HERE, in the string, so no
 * surface can render the figure and its note butted together; a caller that
 * concatenated them in JSX would print "7 ma further 7 m under the dome".
 * See TRADES_HALL_ROOM_DIMENSIONS for the figures themselves.
 */
export function formatRoomDimensions(slug: PublishedRoomSlug): string | null {
  const dimensions = TRADES_HALL_ROOM_DIMENSIONS[slug];
  if (dimensions === undefined) {
    return null;
  }
  const extent =
    `${metres(dimensions.lengthM)} × ${metres(dimensions.widthM)} × ` +
    `${metres(dimensions.heightM)} m`;
  return dimensions.note === undefined ? extent : `${extent} — ${dimensions.note}`;
}

/**
 * The room at `nodeId`, joined to venue truth — or null when this viewpoint's
 * room has not been confirmed, which is the overwhelmingly common case. Callers
 * must read null as "say nothing", never as "unknown room" or a placeholder:
 * a labelled blank is still a label.
 */
export function lookUpRoom(nodeId: string): VerifiedRoom | null {
  const slug = VERIFIED_ROOM_NODES[nodeId];
  if (slug === undefined) {
    return null;
  }
  return {
    nodeId,
    slug,
    name: ROOM_DISPLAY_NAMES[slug],
    capacities: TRADES_HALL_ROOM_CAPACITIES[slug],
    dimensions: TRADES_HALL_ROOM_DIMENSIONS[slug] ?? null,
    dimensionLine: formatRoomDimensions(slug),
  };
}
