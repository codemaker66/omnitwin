import type { SpaceDimensions } from "@omnitwin/types";
import { RENDER_SCALE } from "../constants/scale.js";
import {
  FILL_AISLE_RULE,
  designatedGangways,
  floorOutline,
  spineSide,
  underGuidance,
  type AisleRule,
  type RoomExit,
  type RoomSide,
} from "./auto-fill.js";
import type { LayoutRect } from "./auto-layout.js";
import { getCatalogueItem } from "./catalogue.js";
import { bandForGap, convexPolygonClosestPoints, type CirculationBand, type Vec2 } from "./circulation.js";
import { createGhostWorld, obstacleName } from "./ghost-truth.js";
import type { PlacedItem } from "./placement.js";
import { isSceneFurniturePlacement } from "./table-dressing.js";

// ---------------------------------------------------------------------------
// Live aisles (card-dock spec §7.2 item 3, Q-06): one function for the ghost
// and the caption. From the whole set (the table and each chair, each panel)
// to its three nearest neighbours (chair backs, table edges, the stage, the
// dance floor) and the walls: a dimension line each, to 0.1 m, toned by the
// planner's own bands. On a designated gangway (lib/auto-fill) the guidance
// is 1.1 m and a narrower gangway carries Blake's flag ("the venue will
// review"); it is never refused. Exact convex-polygon distances throughout.
//
// Apart from the clearance rings (lib/clearance-ring.ts), which today's
// planner draws, because only the new chrome's caption reads them so far:
// they load with it (T-671).
// ---------------------------------------------------------------------------

/** Who reads a gangway flag: a signed-in layout keeps its review (lib/gangway-review-record); a guest's preview does not. */
export type GangwayFlagReader = "signed-in" | "guest";

/**
 * The flag the ghost and the caption show, saying what happens to the
 * pinch: "Gangway 0.95 m · under the 1.1 m guidance · goes to the venue with
 * this layout"; to a guest, whose preview stores nothing, "… · the venue
 * sees this with your layout". The width is cut, never rounded, to the
 * centimetre, so a gangway under the guidance never reads as meeting it.
 */
export function gangwayFlag(widthM: number, rule: AisleRule = FILL_AISLE_RULE, reader: GangwayFlagReader = "signed-in"): string {
  const what = reader === "guest" ? "the venue sees this with your layout" : "goes to the venue with this layout";
  return `Gangway ${(Math.floor(widthM * 100 + 1e-6) / 100).toFixed(2)} m · under the ${String(rule.gangwayM)} m guidance · ${what}`;
}

export type AisleTone = "sage" | "amber";

export interface AisleLine {
  /** From the set to its neighbour, metres. */
  readonly from: Vec2;
  readonly to: Vec2;
  readonly gapM: number;
  readonly band: CirculationBand;
  readonly tone: AisleTone;
  /** "1.4 m", "0.8 m · tight", "0.3 m · no way through", or the gangway flag. */
  readonly words: string;
  /** What is across the gap, as copy names it. */
  readonly neighbour: string;
  /** Whether the gap runs across a designated gangway. */
  readonly onGangway: boolean;
}

/** How many neighbours the ghost measures to. */
export const LIVE_AISLE_COUNT = 3;

export interface LiveAisleOptions {
  /** The room's ways out (lib/auto-fill grandHallExits); null when not recorded. */
  readonly exits?: readonly RoomExit[] | null;
  /** Placed pieces that are the set itself (a lifted or selected set): never their own neighbours. */
  readonly excludeIds?: ReadonlySet<string>;
  readonly count?: number;
  readonly wallNames?: Readonly<Record<RoomSide, string>>;
  readonly rule?: AisleRule;
  /** Who reads the gangway flag (gangwayFlag): a guest's words say the venue sees it with the layout. */
  readonly reader?: GangwayFlagReader;
  /** The room's door clear spaces, as Fill keeps them, so the gangways are Fill's own. */
  readonly doorSpaces?: readonly LayoutRect[];
}

function aisleMetres(gapM: number): string {
  return `${(Math.round(gapM * 10) / 10).toFixed(1)} m`;
}

/** A gap's tone and words: the gangway rule on a designated gangway, the planner's bands elsewhere. */
function aisleWords(gapM: number, band: CirculationBand, onGangway: boolean, rule: AisleRule, reader: GangwayFlagReader): { readonly tone: AisleTone; readonly words: string } {
  if (onGangway && underGuidance(gapM, rule)) return { tone: "amber", words: gangwayFlag(gapM, rule, reader) };
  if (onGangway || band === "generous" || band === "comfortable" || band === "open") return { tone: "sage", words: aisleMetres(gapM) };
  return { tone: "amber", words: `${aisleMetres(gapM)} · ${band === "tight" ? "tight" : "no way through"}` };
}

/** Each piece's floor outline, the one the gangway review measures (lib/auto-fill floorOutline). */
function cornersOf(pieces: readonly PlacedItem[]): readonly { readonly piece: PlacedItem; readonly corners: readonly Vec2[] }[] {
  return pieces.flatMap((piece) => {
    if (!isSceneFurniturePlacement(piece)) return [];
    const item = getCatalogueItem(piece.catalogueItemId);
    return item === undefined ? [] : [{ piece, corners: floorOutline(piece, item) }];
  });
}

/**
 * The live aisles from a set (the ghost, or a selected set for the caption)
 * to its nearest neighbours and walls, nearest first. Room dimensions are
 * render-space, as the room store holds them; lines are metres.
 */
export function liveAisles(
  set: readonly PlacedItem[],
  placedItems: readonly PlacedItem[],
  room: SpaceDimensions,
  options: LiveAisleOptions = {},
): readonly AisleLine[] {
  const rule = options.rule ?? FILL_AISLE_RULE;
  const reader = options.reader ?? "signed-in";
  const names = options.wallNames ?? { xMin: "the wall", xMax: "the wall", zMin: "the wall", zMax: "the wall" };
  const ownIds = new Set([...set.map((piece) => piece.id), ...(options.excludeIds ?? [])]);
  const mine = cornersOf(set);
  if (mine.length === 0) return [];
  const widthM = room.width / RENDER_SCALE;
  const lengthM = room.length / RENDER_SCALE;
  const designated = designatedGangways(widthM, lengthM, options.exits ?? null, rule, options.doorSpaces);
  const world = createGhostWorld(placedItems, room);
  const lines: AisleLine[] = [];

  // Every other unit (a table with its chairs, a set, a lone piece): its nearest point to the set.
  const units = new Map<string, { readonly corners: readonly Vec2[]; readonly piece: PlacedItem }[]>();
  for (const entry of cornersOf(placedItems.filter((piece) => !ownIds.has(piece.id)))) {
    const key = entry.piece.setId ?? entry.piece.groupId ?? entry.piece.id;
    const unit = units.get(key);
    if (unit === undefined) units.set(key, [entry]);
    else unit.push(entry);
  }
  const spine = designated?.bands.find((band) => band.side === null)?.rect ?? null;
  // Across a middle gangway when the set and its neighbour stand on opposite sides of it, as the review decides.
  const setSide = spine === null ? null : spineSide(mine.flatMap((own) => own.corners), spine);
  for (const unit of units.values()) {
    let best: { readonly distance: number; readonly from: Vec2; readonly to: Vec2; readonly piece: PlacedItem } | null = null;
    for (const own of mine) {
      for (const other of unit) {
        const closest = convexPolygonClosestPoints(own.corners, other.corners);
        if (best === null || closest.distance < best.distance) best = { distance: closest.distance, from: closest.pointA, to: closest.pointB, piece: other.piece };
      }
    }
    if (best === null) continue;
    const onGangway = spine !== null && setSide !== spineSide(unit.flatMap((other) => other.corners), spine);
    const band = bandForGap(best.distance);
    lines.push({ from: best.from, to: best.to, gapM: best.distance, band, ...aisleWords(best.distance, band, onGangway, rule, reader), neighbour: obstacleName(best.piece.id, world).label, onGangway });
  }

  // The walls: the set's nearest corner to each.
  const walls: readonly { readonly side: RoomSide; readonly reach: (corner: Vec2) => number; readonly foot: (corner: Vec2) => Vec2 }[] = [
    { side: "xMin", reach: (c) => c.x + widthM / 2, foot: (c) => ({ x: -widthM / 2, z: c.z }) },
    { side: "xMax", reach: (c) => widthM / 2 - c.x, foot: (c) => ({ x: widthM / 2, z: c.z }) },
    { side: "zMin", reach: (c) => c.z + lengthM / 2, foot: (c) => ({ x: c.x, z: -lengthM / 2 }) },
    { side: "zMax", reach: (c) => lengthM / 2 - c.z, foot: (c) => ({ x: c.x, z: lengthM / 2 }) },
  ];
  for (const wall of walls) {
    let best: { readonly distance: number; readonly corner: Vec2 } | null = null;
    for (const own of mine) {
      for (const corner of own.corners) {
        const distance = Math.max(0, wall.reach(corner));
        if (best === null || distance < best.distance) best = { distance, corner };
      }
    }
    if (best === null) continue;
    const onGangway = designated?.layout.sides[wall.side] === true;
    const band = bandForGap(best.distance);
    lines.push({ from: best.corner, to: wall.foot(best.corner), gapM: best.distance, band, ...aisleWords(best.distance, band, onGangway, rule, reader), neighbour: names[wall.side], onGangway });
  }

  return lines.sort((a, b) => a.gapM - b.gapM).slice(0, options.count ?? LIVE_AISLE_COUNT);
}
