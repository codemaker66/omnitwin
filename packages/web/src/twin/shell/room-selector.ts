import type { TwinScanNode } from "@omnitwin/types";
import {
  TRADES_HALL_ROOM_CAPACITIES,
  TRADES_HALL_ROOM_DIMENSIONS,
  type PublishedRoomSlug,
} from "../../lib/trades-hall-venue-truth.js";
import { ROOM_DISPLAY_NAMES, VERIFIED_ROOM_NODES, lookUpRoom, metres } from "./twin-rooms.js";

// -----------------------------------------------------------------------------
// room-selector — the arithmetic behind the Rooms panel, with no React in it.
//
// The panel it serves replaces a minimap of 149 identical dots. That map was a
// debug visualisation: it printed the scanner's own vocabulary ("Floor -1") at a
// wedding customer, and at 120px on a phone the dots were an unreadable smear.
// What a venue customer actually asks is "which rooms are there, how big are
// they, and are they on the same level as this one" — which is what this module
// computes, and nothing more.
//
// Three rules govern every line below.
//
// ROOM IDENTITY IS NOT INFERRED. twin-rooms.ts holds a five-entry join a human
// validated against ground-truth photography, and this module never widens it.
// Proximity, floor bucket and nav-graph adjacency are all tempting and all
// wrong. ROOM_SELECTOR_ORDER is DERIVED from that join rather than written out,
// so a sixth validated viewpoint appears in the panel by itself and an invented
// room cannot appear at all — not even by a caller passing one in, because this
// module takes no room list from anybody.
//
// EVERY FIGURE JOINS AT READ TIME. formatRoomComparison composes its line out of
// TRADES_HALL_ROOM_CAPACITIES and TRADES_HALL_ROOM_DIMENSIONS through twin-rooms
// (and through its exported metres(), so the dossier and this panel cannot drift
// even in their rounding). No capacity or dimension is written here, not even in
// a comment: a figure in prose is the one a future reader trusts, and the drift
// gate cannot see it.
//
// THE STOREY IS REAL DATA, AND IS NAMED RELATIONALLY. `node.floor` is a required
// integer on all 149 nodes, so the level grouping is honest at every viewpoint —
// including the 144 where the room is unknown. But the storey is a BUCKET, not a
// name: "Floor -1" is scanner vocabulary and "Ground floor" would be an
// inference about the building, the same class of error as inferring a room. So
// this module returns an OFFSET and the component renders "One level down". The
// offset is the difference of RANKS among the distinct floors present, never the
// raw difference of the bucket numbers — contiguous buckets make those identical
// today, but if the forge ever emitted 0 and −2 a raw difference would print
// "two levels down" and thereby claim a storey nobody scanned.
// -----------------------------------------------------------------------------

/**
 * The rooms the twin can actually reach, in a stable display order.
 *
 * Derived from the validated join, first-appearance order, deduplicated — the
 * Grand Hall was validated from both ends and is one room, not two. Being a
 * module constant is the whole point: a list whose rows reorder as the visitor
 * walks cannot be learned, and muscle memory is most of what makes a four-row
 * panel faster than a map.
 */
export const ROOM_SELECTOR_ORDER: readonly PublishedRoomSlug[] = Object.freeze([
  ...new Set(Object.values(VERIFIED_ROOM_NODES)),
]);

/** Every validated viewpoint of one room, in id order — a stable candidate set
 *  so the tie-break below is deterministic even when it has nothing to weigh. */
function verifiedViewpointsOf(slug: PublishedRoomSlug): readonly string[] {
  return Object.keys(VERIFIED_ROOM_NODES)
    .filter((nodeId) => VERIFIED_ROOM_NODES[nodeId] === slug)
    .sort();
}

/** Squared plan distance between two poses, in m². Squared because only the
 *  ordering matters and a square root would buy nothing but rounding. */
function planDistanceSq(a: TwinScanNode, b: TwinScanNode): number {
  const dx = a.pose.t[0] - b.pose.t[0];
  const dy = a.pose.t[1] - b.pose.t[1];
  return dx * dx + dy * dy;
}

/**
 * Which validated viewpoint of `slug` a press should travel to from
 * `fromNodeId` — or null when no viewpoint of that room has been validated,
 * which is the honest answer for both galleries.
 *
 * This is a TIE-BREAK among targets that are all correct, not a route claim: the
 * Usher still walks the real nav graph, and whether it can walk there at all is
 * the host's business. Euclidean on the pose, because the two ends of a room are
 * on one storey by construction, and because the alternative — always the first
 * candidate — lands a visitor leaving the Saloon at the FAR wall of a 21 m hall,
 * which reads as a mistake even though it is the right room.
 *
 * Exported and pure so that upgrading it to graph distance later is one function
 * body and one test, with no component to re-reason about.
 */
export function pickRoomTarget(
  slug: PublishedRoomSlug,
  fromNodeId: string,
  nodes: readonly TwinScanNode[],
): string | null {
  const candidates = verifiedViewpointsOf(slug);
  const first = candidates[0];
  if (first === undefined) {
    return null;
  }
  if (candidates.length === 1) {
    return first;
  }
  const from = nodes.find((entry) => entry.id === fromNodeId);
  if (from === undefined) {
    // An id that is in neither the join nor the bundle — a `?node=` query, say.
    // Unreachable is the wrong answer; arbitrary-but-fixed is the right one.
    return first;
  }
  let best = first;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const node = nodes.find((entry) => entry.id === candidate);
    if (node === undefined) {
      continue;
    }
    const distance = planDistanceSq(from, node);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The one-line comparison beneath a room's name — capacities and published
 * extent, joined — or null at a viewpoint whose room is not known.
 *
 * Keyed on a NODE, not a slug, deliberately: lookUpRoom is the single door to
 * venue truth and it answers null for 144 of 149 viewpoints, so a line can only
 * be composed where a human has already said which room this is. A slug-keyed
 * version would compose a line for the galleries, which no viewpoint has ever
 * been validated in.
 *
 * The separator is a spaced middle dot, and it must not change: the row's
 * accessible name reuses this exact string, so Label in Name (WCAG 2.5.3) holds
 * by construction rather than by a second formatter agreeing with this one.
 *
 * Rooms the venue publishes no dimensions for render their capacities alone,
 * rather than an em dash where a measurement should be.
 */
export function formatRoomComparison(nodeId: string): string | null {
  const room = lookUpRoom(nodeId);
  if (room === null) {
    return null;
  }
  const capacities = TRADES_HALL_ROOM_CAPACITIES[room.slug];
  const head = `${String(capacities.reception)} standing · ${String(capacities.dinner)} seated`;
  const dimensions = TRADES_HALL_ROOM_DIMENSIONS[room.slug];
  if (dimensions === undefined) {
    return head;
  }
  return `${head} · ${metres(dimensions.lengthM)} × ${metres(dimensions.widthM)} m`;
}

/** One offered room, ready to render. */
export interface RoomSelectorRow {
  readonly slug: PublishedRoomSlug;
  /** The venue's own name for the room, joined from twin-rooms. */
  readonly name: string;
  /** The validated viewpoint a press travels to. Always in VERIFIED_ROOM_NODES. */
  readonly targetNodeId: string;
  /** The joined figures line, or null for a room the venue publishes none for. */
  readonly comparison: string | null;
  /** True only where the join says the visitor is standing in THIS room. At the
   *  144 unvalidated viewpoints every row is false — no hedge, no placeholder. */
  readonly here: boolean;
}

/** One storey's worth of rooms, and how far it is from the visitor's own. */
export interface RoomSelectorLevel {
  /** Stable React key. Carries the raw bucket, which is never rendered. */
  readonly key: string;
  /**
   * Storeys from the visitor to this level, by RANK among the distinct floors
   * in the bundle — negative down, positive up, 0 the visitor's own. null when
   * the visitor's viewpoint is not in the bundle at all, in which case the
   * component must render no heading rather than guess one.
   */
  readonly offset: number | null;
  readonly rooms: readonly RoomSelectorRow[];
}

/** Levels with the raw bucket still attached, for sorting only. The bucket is
 *  dropped on the way out: it is scanner vocabulary and nothing may render it. */
interface SortableLevel extends RoomSelectorLevel {
  readonly floor: number;
}

/**
 * The whole panel, computed: which rooms, grouped onto which levels, in what
 * order, and which one the visitor is standing in.
 *
 * A room whose validated viewpoint is not in `nodes` is DROPPED rather than
 * placed under a guessed heading — a room the panel cannot put on a storey is a
 * room it cannot honestly group, and absence is the honest failure.
 */
export function planRoomSelector(
  nodes: readonly TwinScanNode[],
  currentId: string,
): readonly RoomSelectorLevel[] {
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));

  // Rank the storeys the capture actually contains, lowest first. Rank, not
  // bucket: see the module header — the buckets are rounded heights and nothing
  // guarantees they are contiguous.
  const floors = [...new Set(nodes.map((entry) => entry.floor))].sort((a, b) => a - b);
  const currentFloor = byId.get(currentId)?.floor;
  const currentRank = currentFloor === undefined ? null : floors.indexOf(currentFloor);

  const hereSlug = lookUpRoom(currentId)?.slug ?? null;

  const grouped = new Map<number, RoomSelectorRow[]>();
  for (const slug of ROOM_SELECTOR_ORDER) {
    const targetNodeId = pickRoomTarget(slug, currentId, nodes);
    if (targetNodeId === null) {
      continue;
    }
    const target = byId.get(targetNodeId);
    if (target === undefined) {
      continue;
    }
    const rows = grouped.get(target.floor) ?? [];
    rows.push({
      slug,
      name: ROOM_DISPLAY_NAMES[slug],
      targetNodeId,
      comparison: formatRoomComparison(targetNodeId),
      here: slug === hereSlug,
    });
    grouped.set(target.floor, rows);
  }

  const levels: SortableLevel[] = [...grouped.entries()].map(([floor, rooms]) => {
    const rank = floors.indexOf(floor);
    return {
      key: `level:${String(floor)}`,
      offset: currentRank === null || rank < 0 ? null : rank - currentRank,
      rooms,
      floor,
    };
  });

  // The visitor's own level leads, then the nearest, and a level below sorts
  // before a level above at equal distance — the way a lift's floor list reads
  // from where you are standing. With no known level, upper storeys first, which
  // is at least a fixed order rather than insertion order.
  levels.sort((a, b) => {
    if (a.offset === null || b.offset === null) {
      return b.floor - a.floor;
    }
    const byDistance = Math.abs(a.offset) - Math.abs(b.offset);
    return byDistance === 0 ? a.offset - b.offset : byDistance;
  });

  return levels.map(({ key, offset, rooms }) => ({ key, offset, rooms }));
}
