// ---------------------------------------------------------------------------
// Clearance ring — the judged clear zone around a selected dining table.
//
// Selecting a table draws a ring on the floor showing how much clear space
// the table actually has, live, judged against the planning-grade aisle
// rulebook in lib/circulation.ts: green when every neighbour keeps at least
// the single-file walkway (0.90 m), amber with a named reason when one does
// not. (The Stage goal phrases this as "lib/egress rules"; per-table aisle
// clearance lives in lib/circulation — lib/egress is exit-capacity maths.
// The mapping is flagged in T-562 rather than silently reinterpreted.)
//
// SAFE LANGUAGE: this is a PLANNING-GRADE circulation estimate, never a
// legal egress route or fire-code width — same rule CirculationOverlay
// follows.
//
// The ring radius is live: it hugs to the nearest obstruction (footprint
// half-diagonal + the actual clear gap), capped at the comfortable walkway —
// beyond comfortable, more space is not more pass. The circle is a deliberate
// simplification of the oriented footprint for display; the JUDGEMENT uses
// the exact convex-polygon gap, so a corner-to-corner pinch is never hidden
// by the circle's generosity.
// ---------------------------------------------------------------------------

import type { SpaceDimensions } from "@omnitwin/types";
import { RENDER_SCALE } from "../constants/scale.js";
import {
  FILL_AISLE_RULE,
  designatedGangways,
  floorOutline,
  gangwayFlag,
  spineSide,
  underGuidance,
  type AisleRule,
  type GangwayFlagReader,
  type RoomExit,
  type RoomSide,
} from "./auto-fill.js";
import {
  CIRCULATION_AISLE,
  bandForGap,
  convexPolygonClosestPoints,
  footprintCorners,
  type CirculationBand,
  type FurnitureFootprint,
  type Vec2,
} from "./circulation.js";
import { placedCirculationFootprints } from "./circulation-scene.js";
import type { LayoutRect } from "./auto-layout.js";
import { getCatalogueItem } from "./catalogue.js";
import { isDiningTableItem } from "./furniture-semantics.js";
import { createGhostWorld, obstacleName } from "./ghost-truth.js";
import type { PlacedItem } from "./placement.js";
import { isSceneFurniturePlacement } from "./table-dressing.js";

export type ClearanceVerdict = "pass" | "fail";

export interface ClearanceRingModel {
  readonly itemId: string;
  /** Table label, for the reason text ("Trestle table"). */
  readonly label: string;
  /** Ring centre on the floor, metres (same space as footprints). */
  readonly centreX: number;
  readonly centreZ: number;
  /** Live ring radius: half-diagonal + min(nearest gap, comfortable). */
  readonly radiusM: number;
  readonly verdict: ClearanceVerdict;
  /** Exact clear gap to the nearest neighbour footprint, or null if alone. */
  readonly nearestGapM: number | null;
  readonly nearestLabel: string | null;
  /** Circulation band of the nearest gap — drives styling severity. */
  readonly band: CirculationBand;
  /** One-line reason, only when the verdict is fail. */
  readonly reason: string | null;
}

/** Radius of the circle that fully contains an oriented footprint. */
export function footprintHalfDiagonalM(f: FurnitureFootprint): number {
  return Math.hypot(f.width, f.depth) / 2;
}

function reasonForGap(gapM: number, neighbourLabel: string, band: CirculationBand): string | null {
  if (band === "blocked") {
    return `${gapM.toFixed(2)} m to ${neighbourLabel} — effectively impassable (needs ${
      CIRCULATION_AISLE.tightM.toFixed(2)} m)`;
  }
  if (band === "tight") {
    return `${gapM.toFixed(2)} m to ${neighbourLabel} — needs ${
      CIRCULATION_AISLE.tightM.toFixed(2)} m single-file`;
  }
  return null;
}

/**
 * Clearance rings for the currently selected dining tables.
 *
 * Judged live from the same footprint extraction the circulation HUD uses
 * (tables + passive freestanding AV; chairs deliberately excluded so a
 * table's own seating never reads as an obstruction). Pass = the nearest
 * neighbour keeps at least the single-file walkway; fail carries the named
 * neighbour and the rule it breaks.
 */
export function clearanceRingsForSelection(
  selectedIds: ReadonlySet<string>,
  placedItems: readonly PlacedItem[],
): readonly ClearanceRingModel[] {
  if (selectedIds.size === 0) return [];

  const footprints = placedCirculationFootprints(placedItems);
  if (footprints.length === 0) return [];

  const byId = new Map<string, FurnitureFootprint>();
  for (const f of footprints) byId.set(f.id, f);

  const rings: ClearanceRingModel[] = [];
  for (const id of selectedIds) {
    const footprint = byId.get(id);
    if (footprint === undefined) continue;
    const placed = placedItems.find((p) => p.id === id);
    if (placed === undefined) continue;
    const catalogueItem = getCatalogueItem(placed.catalogueItemId);
    if (catalogueItem === undefined || !isDiningTableItem(catalogueItem)) continue;

    const corners = footprintCorners(footprint);
    let nearestGapM: number | null = null;
    let nearestLabel: string | null = null;
    for (const other of footprints) {
      if (other.id === id) continue;
      const closest = convexPolygonClosestPoints(corners, footprintCorners(other));
      if (nearestGapM === null || closest.distance < nearestGapM) {
        nearestGapM = closest.distance;
        nearestLabel = other.label;
      }
    }

    const band = bandForGap(nearestGapM);
    const halfDiagonal = footprintHalfDiagonalM(footprint);
    const clearM = nearestGapM === null
      ? CIRCULATION_AISLE.comfortableM
      : Math.min(nearestGapM, CIRCULATION_AISLE.comfortableM);
    const failing = band === "tight" || band === "blocked";

    rings.push({
      itemId: id,
      label: footprint.label,
      centreX: footprint.cx,
      centreZ: footprint.cz,
      radiusM: halfDiagonal + clearM,
      verdict: failing ? "fail" : "pass",
      nearestGapM,
      nearestLabel,
      band,
      reason: failing && nearestGapM !== null && nearestLabel !== null
        ? reasonForGap(nearestGapM, nearestLabel, band)
        : null,
    });
  }
  return rings;
}

// ---------------------------------------------------------------------------
// Live aisles (card-dock spec §7.2 item 3, Q-06): one function for the ghost
// and the caption. From the whole set (the table and each chair, each panel)
// to its three nearest neighbours (chair backs, table edges, the stage, the
// dance floor) and the walls: a dimension line each, to 0.1 m, toned by the
// planner's own bands. On a designated gangway (lib/auto-fill) the guidance
// is 1.1 m and a narrower gangway carries Blake's flag ("the venue will
// review"); it is never refused. Exact convex-polygon distances throughout.
// ---------------------------------------------------------------------------

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
  /** Who reads the gangway flag (lib/auto-fill gangwayFlag): a guest's words say the venue sees it with the layout. */
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

/**
 * The single ring whose reason deserves the floor pill: the tightest failing
 * one. Every failing ring shows amber; only the worst speaks — the same
 * primary-annotation philosophy CirculationOverlay applies to pinch lines.
 */
export function worstFailingRing(
  rings: readonly ClearanceRingModel[],
): ClearanceRingModel | null {
  let worst: ClearanceRingModel | null = null;
  for (const ring of rings) {
    if (ring.verdict !== "fail" || ring.nearestGapM === null) continue;
    if (worst === null || worst.nearestGapM === null || ring.nearestGapM < worst.nearestGapM) {
      worst = ring;
    }
  }
  return worst;
}
