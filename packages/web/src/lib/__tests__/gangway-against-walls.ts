// ---------------------------------------------------------------------------
// The judge of a gangway review of pieces set against the walls of a room's
// own floor (lib/auto-fill gangwayReview), shared by the tests that set them
// there by a click and that slide them along the walls.
//
// The second round's sweep left out every unit within a centimetre of a wall,
// and there the review was wrong (third review of audit editor-save-4). So
// here nothing is left out. Every item a review holds is held to three things,
// each judged by the slow way (walls-the-slow-way.ts, none of the planner's
// geometry):
//   - the shared schema accepts it, or the layout cannot be submitted;
//   - it says 0.00 m only for a wall on its side that a piece lies against
//     between the wall's ends, or for a corner of a wall on its side that a
//     piece touches while lying against neither wall that meets there (and,
//     where the piece lies against a wall in one line with one of those two
//     only, that one is the wall on its side), and it is drawn where that is;
//   - it is drawn on real floor, inside the room, no further than the guidance
//     from a wall on its side;
//   - wider than nothing, its width is a gap the unit leaves, to within a
//     millimetre, to a wall or a corner on its side where it is drawn, by a
//     straight way that keeps to the floor (fourth review of the branch: a
//     corner's gap was measured through a Saloon pier, and no judge asked).
//     A unit with a piece through a wall, which no way on the floor reaches
//     whole, is counted for this (throughAWall) and not judged.
// And the other way about: every wall a piece lies against, and every corner
// one only touches, has an item at 0.00 m.
// ---------------------------------------------------------------------------
import { GangwayReviewSchema, type GangwayReviewItem } from "@omnitwin/types";
import { roomGeometries } from "../../data/room-geometries.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useChairDialogStore } from "../../stores/chair-dialog-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { gangwayReview } from "../auto-fill.js";
import { getCatalogueItem, getCatalogueItemBySlug, type CatalogueItem } from "../catalogue.js";
import { answerChairQuestion } from "../chair-question.js";
import { placePieceInHand } from "../place-in-hand.js";
import type { PlacedItem } from "../placement.js";
import { plannerRoomOf, type PlannerRoomDimensions } from "../room-floor.js";
import {
  areaOf,
  floorClaims,
  inOneLine,
  nearestBetweenEnds,
  nearestOnShape,
  onOrInside,
  reaches,
  sideOfWall,
  standsOnTheFloor,
  straightWalls,
  TOUCHING,
  wayKeepsToFloor,
  type Shape,
  type Side,
  type Wall,
  type Walls,
} from "./walls-the-slow-way.js";

export const SHAPED_ROOMS = ["Robert Adam Room", "Reception Room", "Saloon"] as const;

/** The guidance a gangway is held to, metres. */
export const GUIDANCE = 1.1;

/** The least floor an item may be drawn on, square metres: a centimetre of wall, the guidance deep. */
export const REAL_FLOOR_M2 = 0.01;

export function piece(slug: string): CatalogueItem {
  const found = getCatalogueItemBySlug(slug);
  if (found === undefined) throw new Error(`no catalogue item ${slug}`);
  return found;
}

export interface Room {
  readonly name: string;
  readonly walls: Walls;
  /** The walls, each straight wall whole, in the outline's order. */
  readonly straight: readonly Wall[];
  /** The side of a unit each straight wall stands on. */
  readonly sides: readonly Side[];
  readonly dims: PlannerRoomDimensions;
}

const rooms = new Map<string, Room>();

export function room(name: string): Room {
  const known = rooms.get(name);
  if (known !== undefined) return known;
  const geometry = roomGeometries[name];
  if (geometry === undefined) throw new Error(`no geometry for ${name}`);
  const straight = straightWalls(geometry.wallPolygon);
  const made: Room = {
    name,
    walls: geometry.wallPolygon,
    straight,
    sides: straight.map((wall) => sideOfWall(geometry.wallPolygon, wall)),
    dims: plannerRoomOf(geometry.wallPolygon, geometry.ceilingHeight),
  };
  rooms.set(name, made);
  return made;
}

/** A placed piece as the slow way takes it: a round table a disc, anything else its box, from the catalogue's size and its turn. */
export function shapeOf(placed: PlacedItem): Shape {
  const item = getCatalogueItem(placed.catalogueItemId);
  if (item === undefined) throw new Error("unknown piece");
  const scale = placed.scale ?? 1;
  if (item.tableShape === "round") return { kind: "disc", x: placed.x, z: placed.z, radius: (item.width * scale) / 2 };
  return { kind: "box", x: placed.x, z: placed.z, halfW: (item.width * scale) / 2, halfD: (item.depth * scale) / 2, turn: placed.rotationY };
}

/** The side of the room an item's gangway runs along, from its id (`gangway:<side>:…`, @omnitwin/types gangway-review). */
export function sideOf(item: GangwayReviewItem): Side {
  const side = /^gangway:(xMin|xMax|zMin|zMax):/u.exec(item.id)?.[1];
  if (side !== "xMin" && side !== "xMax" && side !== "zMin" && side !== "zMax") throw new Error(`no side in ${item.id}`);
  return side;
}

/** The floor an item is drawn on, corner by corner; none when it is not drawn as floor. */
export function floorOf(item: GangwayReviewItem): Walls | null {
  return item.location.kind === "polygon" ? item.location.points.map((point) => [point.x, point.z] as const) : null;
}

/** What a review says: each item's side and its width to the millimetre, in the order of the sides. */
export function said(review: readonly GangwayReviewItem[]): readonly (readonly [Side, number])[] {
  return review.map((item) => [sideOf(item), Number(item.widthM.toFixed(3))] as const).sort(([a], [b]) => a.localeCompare(b));
}

/**
 * The real click path on an empty floor: the catalogue pick, the store's own
 * ghost for a pointer, the click (placePieceInHand) and, for a dining table,
 * the chair question answered with `seats`. What was set down; null where the
 * ghost was not valid or nothing was set. The room store holds the room first.
 */
export function setDown(item: CatalogueItem, seats: number, x: number, z: number, turn: number, snapEnabled: boolean): readonly PlacedItem[] | null {
  usePlacementStore.setState({ placedItems: [], ghostPosition: null, ghostRotation: turn, ghostValid: false, ghostInvalidReason: null, snapEnabled });
  useChairDialogStore.getState().clearDialog();
  useCatalogueStore.getState().selectItem(item.id);
  usePlacementStore.getState().updateGhost(x, z, item.id);
  const { ghostPosition, ghostValid } = usePlacementStore.getState();
  if (ghostPosition === null || !ghostValid) return null;
  placePieceInHand(() => undefined);
  if (useChairDialogStore.getState().pending !== null) answerChairQuestion(seats);
  const placed = usePlacementStore.getState().placedItems;
  return placed.length === 0 ? null : placed;
}

/** What the slow way finds wrong with one unit's review. */
export interface Verdict {
  readonly items: number;
  /** Whether a piece of the unit lies against a wall between its ends, or only touches a corner of the room. */
  readonly againstAWall: boolean;
  /** Items the shared schema refuses. */
  readonly refused: number;
  /** Items drawn on no real floor. */
  readonly withoutFloor: number;
  /** Items drawn on floor outside the room, or further than the guidance from every wall on their side. */
  readonly offTheFloor: number;
  /** Items at 0.00 m for no wall on their side the unit lies against and no corner there it only touches. */
  readonly falseZero: number;
  /** Items wider than nothing whose width is no gap of the unit's, by a way on the floor, to a wall or a corner on their side where they are drawn. */
  readonly falseGap: number;
  /** Whether a piece of the unit is through a wall: then no way on the floor reaches all of it, and its wider items are not held to one (counted, not judged). */
  readonly throughAWall: boolean;
  /** Items rightly at 0.00 m for a corner a piece only touches, with no wall on that side lain against. */
  readonly cornerZero: number;
  /** Of those, the ones whose unit lies against a wall on another side. */
  readonly cornerZeroBesideAWall: number;
  /** Walls the unit lies against, and corners it only touches, with no item at 0.00 m. */
  readonly unsaid: number;
  readonly faults: readonly string[];
}

function endsAt(wall: Wall, x: number, z: number): boolean {
  return Math.hypot(wall[0] - x, wall[1] - z) < 1e-9 || Math.hypot(wall[2] - x, wall[3] - z) < 1e-9;
}

/** A millimetre: how far an item's width may be from the slow way's gap, and the step the slow way walks a wall by. */
const MM = 0.001;

/**
 * Whether a width is a gap the unit leaves, by a way on the floor, to a wall
 * on `side` where `floor` is drawn, or to a corner of one: some piece of the
 * unit stands that far, to within a millimetre, from a millimetre's step of
 * such a wall (its ends are the corners) that is on or inside the drawn
 * floor, and the straight way from the step to the piece's nearest point
 * keeps to the floor (wayKeepsToFloor). So 0.30 m from a corner straight
 * through a Saloon pier is no gap. Only walls that reach the drawn floor's
 * bounds are walked, and of those only the stretches where a piece's gap can
 * be that near the width: every tenth step first, as unitToWall does, since a
 * gap moves no more than a millimetre from one step to the next.
 */
function gapWhereDrawn(r: Room, shapes: readonly Shape[], side: Side, floor: Walls, widthM: number): boolean {
  const xs = floor.map(([x]) => x);
  const zs = floor.map(([, z]) => z);
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs) - MM, Math.max(...xs) + MM, Math.min(...zs) - MM, Math.max(...zs) + MM];
  return r.straight.some((wall, i) => {
    const [ax, az, bx, bz] = wall;
    if (r.sides[i] !== side || Math.max(ax, bx) < minX || Math.min(ax, bx) > maxX || Math.max(az, bz) < minZ || Math.min(az, bz) > maxZ) return false;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / MM));
    const at = (s: number): readonly [number, number] => [ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps];
    const walked = new Set<number>();
    for (let s = 0; s < steps + 10; s += 10) {
      const tenth = Math.min(s, steps);
      const [x, z] = at(tenth);
      // The ten steps either side are within a centimetre: a tenth step further than that outside the bounds leads nowhere.
      if (x < minX - 0.011 || x > maxX + 0.011 || z < minZ - 0.011 || z > maxZ + 0.011) continue;
      let offBy = Number.POSITIVE_INFINITY;
      for (const shape of shapes) offBy = Math.min(offBy, Math.abs(nearestOnShape(shape, x, z).gap - widthM));
      if (offBy > 0.01 + MM) continue;
      for (let k = Math.max(0, tenth - 10); k <= Math.min(steps, tenth + 10); k += 1) walked.add(k);
    }
    for (const s of [...walked].sort((a, b) => a - b)) {
      const [x, z] = at(s);
      if (x < minX || x > maxX || z < minZ || z > maxZ || !onOrInside(floor, x, z, MM)) continue;
      for (const shape of shapes) {
        const near = nearestOnShape(shape, x, z);
        if (Math.abs(near.gap - widthM) <= MM && wayKeepsToFloor(r.walls, x, z, near.x, near.z, TOUCHING)) return true;
      }
    }
    return false;
  });
}

export function verdictOn(r: Room, unit: readonly PlacedItem[]): Verdict {
  const shapes = unit.map(shapeOf);
  const review = gangwayReview(unit, r.dims, null);
  const faults: string[] = [];
  let refused = 0;
  let withoutFloor = 0;
  let offTheFloor = 0;
  let falseZero = 0;
  let falseGap = 0;
  let cornerZero = 0;
  let cornerZeroBesideAWall = 0;
  let unsaid = 0;

  // A piece through a wall (a click leaves a table's chairs where they fall, through a pier or the curve) is partly
  // off the floor, and no way on the floor reaches all of it: the unit's wider items are counted, not judged by way.
  const throughAWall = !shapes.every((shape) => standsOnTheFloor(r.walls, shape));
  // Where each piece comes nearest each wall between its ends, and so which walls it lies against there.
  const nearest = shapes.map((shape) => r.straight.map((wall) => nearestBetweenEnds(shape, wall)));
  const against = nearest.map((mine) => mine.map((one) => one.gap <= TOUCHING));
  const lainAgainst = r.straight.map((_, i) => against.some((mine) => mine[i] === true));
  // A corner a piece touches while lying against neither wall that meets there: the gap to it is nothing, and no one wall's.
  const onlyTouched = (x: number, z: number): boolean => shapes.some((shape, p) => reaches(shape, x, z)
    && !r.straight.some((wall, i) => against[p]?.[i] === true && endsAt(wall, x, z)));
  const endsOnlyTouched = r.straight.map((wall) => [onlyTouched(wall[0], wall[1]), onlyTouched(wall[2], wall[3])] as const);
  // Such a corner may be said on the side of either wall that meets there; but where the piece lies against a wall in
  // one line with one of the two and not with the other (set along a wall across a doorway, its end at the far jamb),
  // on that wall's side only: the touch is the end of where it lies along that line.
  const mayBeSaidOf = (i: number, x: number, z: number): boolean => shapes.some((shape, p) => {
    if (!reaches(shape, x, z)) return false;
    const meeting = r.straight.flatMap((wall, j) => (endsAt(wall, x, z) ? [j] : []));
    if (meeting.some((j) => against[p]?.[j] === true)) return false;
    const lainInLineWith = (j: number): boolean => {
      const line = r.straight[j];
      return line !== undefined && r.straight.some((other, k) => k !== j && against[p]?.[k] === true && inOneLine(r.walls, line, other));
    };
    return lainInLineWith(i) || !meeting.some((j) => j !== i && lainInLineWith(j));
  });
  const endsToSay = r.straight.map((wall, i) => [mayBeSaidOf(i, wall[0], wall[1]), mayBeSaidOf(i, wall[2], wall[3])] as const);
  const nothingOn = (side: Side): boolean => review.some((item) => sideOf(item) === side && item.widthM <= TOUCHING);

  if (new Set(review.map((item) => item.id)).size !== review.length) faults.push("two items share an id");
  for (const item of review) {
    const side = sideOf(item);
    const what = `the ${side} item at ${item.widthM.toFixed(3)} m`;
    const floor = floorOf(item);
    const drawn = floor === null ? "not as floor" : `[${floor.map(([x, z]) => `${x.toFixed(2)},${z.toFixed(2)}`).join(" ")}]`;
    if (!GangwayReviewSchema.safeParse({ items: [item] }).success) {
      refused += 1;
      faults.push(`${what} is refused by the shared schema, drawn ${drawn}`);
    }
    if (floor === null || floor.length < 3 || areaOf(floor) < REAL_FLOOR_M2) {
      withoutFloor += 1;
      faults.push(`${what} is drawn on no floor: ${drawn}`);
    } else {
      const claims = floorClaims(r.walls, r.straight.filter((_, i) => r.sides[i] === side), floor, GUIDANCE, TOUCHING);
      if (claims.offTheFloor + claims.beyondReach > 0) {
        offTheFloor += 1;
        faults.push(`${what} claims floor it should not (${String(claims.offTheFloor)} spots outside the room, ${String(claims.beyondReach)} beyond the guidance, of ${String(claims.spots)}): ${claims.first ?? ""}`);
      }
    }
    if (item.widthM > TOUCHING) {
      if (!throughAWall && floor !== null && !gapWhereDrawn(r, shapes, side, floor, item.widthM)) {
        falseGap += 1;
        faults.push(`${what} is no gap the unit leaves, by a way on the floor, to a wall or a corner on that side where it is drawn ${drawn}`);
      }
      continue;
    }
    // The places on that side's walls where the unit leaves no gap: where a piece lies against one, and a corner one only touches.
    const places: (readonly [number, number])[] = [];
    const alongAWall = r.straight.some((_, i) => r.sides[i] === side && lainAgainst[i] === true);
    r.straight.forEach((wall, i) => {
      if (r.sides[i] !== side) return;
      for (const mine of nearest) {
        const one = mine[i];
        if (one !== undefined && one.gap <= TOUCHING) places.push([one.x, one.z]);
      }
      if (endsToSay[i]?.[0] === true) places.push([wall[0], wall[1]]);
      if (endsToSay[i]?.[1] === true) places.push([wall[2], wall[3]]);
    });
    if (places.length === 0) {
      falseZero += 1;
      faults.push(`${what} is for no wall on that side a piece lies against, drawn ${drawn}`);
    } else if (floor !== null && !places.some(([x, z]) => onOrInside(floor, x, z, 0.002))) {
      // Said of the right side, but drawn away from every place the unit leaves no gap there.
      falseZero += 1;
      faults.push(`${what} is drawn away from where the unit touches the wall, at (${places.map(([x, z]) => `${x.toFixed(3)}, ${z.toFixed(3)}`).join("; ")}): ${drawn}`);
    } else if (!alongAWall) {
      cornerZero += 1;
      if (lainAgainst.some((one) => one)) cornerZeroBesideAWall += 1;
    }
  }

  r.straight.forEach((wall, i) => {
    const side = r.sides[i];
    if (side === undefined) return;
    if (lainAgainst[i] === true && !nothingOn(side)) {
      unsaid += 1;
      faults.push(`the wall ${JSON.stringify(wall)}, which a piece lies against, has no ${side} item at 0.00 m`);
    }
    // A corner goes with one of the two walls that meet there.
    ([[wall[0], wall[1]], [wall[2], wall[3]]] as const).forEach(([x, z], end) => {
      if (endsOnlyTouched[i]?.[end] !== true) return;
      const meeting = r.straight.flatMap((other, j) => (endsAt(other, x, z) ? [r.sides[j]] : []));
      if (meeting.some((one) => one !== undefined && nothingOn(one))) return;
      unsaid += 1;
      faults.push(`the corner (${String(x)}, ${String(z)}), which a piece touches, has no item at 0.00 m`);
    });
  });

  return {
    items: review.length,
    againstAWall: lainAgainst.some((one) => one) || endsOnlyTouched.some(([first, last]) => first || last),
    refused,
    withoutFloor,
    offTheFloor,
    falseZero,
    falseGap,
    throughAWall,
    cornerZero,
    cornerZeroBesideAWall,
    unsaid,
    faults,
  };
}

/** The verdicts on many units, added up. */
export interface Tally {
  units: number;
  againstAWall: number;
  items: number;
  refused: number;
  withoutFloor: number;
  offTheFloor: number;
  falseZero: number;
  falseGap: number;
  /** Units with a piece through a wall, whose wider items were not judged by way: not a fault, and not a pass. */
  throughAWall: number;
  /** Items rightly at 0.00 m for a corner only touched: not a fault. */
  cornerZero: number;
  cornerZeroBesideAWall: number;
  unsaid: number;
  /** The first few faults, each with where its unit stood. */
  readonly first: string[];
}

export function emptyTally(): Tally {
  return { units: 0, againstAWall: 0, items: 0, refused: 0, withoutFloor: 0, offTheFloor: 0, falseZero: 0, falseGap: 0, throughAWall: 0, cornerZero: 0, cornerZeroBesideAWall: 0, unsaid: 0, first: [] };
}

export function count(tally: Tally, verdict: Verdict, at: string): void {
  tally.units += 1;
  if (verdict.againstAWall) tally.againstAWall += 1;
  tally.items += verdict.items;
  tally.refused += verdict.refused;
  tally.withoutFloor += verdict.withoutFloor;
  tally.offTheFloor += verdict.offTheFloor;
  tally.falseZero += verdict.falseZero;
  tally.falseGap += verdict.falseGap;
  if (verdict.throughAWall) tally.throughAWall += 1;
  tally.cornerZero += verdict.cornerZero;
  tally.cornerZeroBesideAWall += verdict.cornerZeroBesideAWall;
  tally.unsaid += verdict.unsaid;
  for (const fault of verdict.faults) {
    if (tally.first.length < 3) tally.first.push(`${at}: ${fault}`);
  }
}

export function addUp(into: Tally, tally: Tally): void {
  into.units += tally.units;
  into.againstAWall += tally.againstAWall;
  into.items += tally.items;
  into.refused += tally.refused;
  into.withoutFloor += tally.withoutFloor;
  into.offTheFloor += tally.offTheFloor;
  into.falseZero += tally.falseZero;
  into.falseGap += tally.falseGap;
  into.throughAWall += tally.throughAWall;
  into.cornerZero += tally.cornerZero;
  into.cornerZeroBesideAWall += tally.cornerZeroBesideAWall;
  into.unsaid += tally.unsaid;
}

/** What a tally found wrong, for one assertion that shows it all. */
export function faultsOf(tally: Tally): { readonly refused: number; readonly withoutFloor: number; readonly offTheFloor: number; readonly falseZero: number; readonly falseGap: number; readonly unsaid: number; readonly first: readonly string[] } {
  return { refused: tally.refused, withoutFloor: tally.withoutFloor, offTheFloor: tally.offTheFloor, falseZero: tally.falseZero, falseGap: tally.falseGap, unsaid: tally.unsaid, first: tally.first };
}

export const NO_FAULTS = { refused: 0, withoutFloor: 0, offTheFloor: 0, falseZero: 0, falseGap: 0, unsaid: 0, first: [] } as const;

/** A tally in a line, for a test's own report of what it swept. */
export function inWords(tally: Tally): string {
  return `judged ${String(tally.units)}, against a wall ${String(tally.againstAWall)}, items ${String(tally.items)}, refused ${String(tally.refused)}, without floor ${String(tally.withoutFloor)}, off the floor ${String(tally.offTheFloor)}, false 0.00 ${String(tally.falseZero)}, false gap ${String(tally.falseGap)} (with a piece through a wall, gaps not judged ${String(tally.throughAWall)}), unsaid ${String(tally.unsaid)}, rightly 0.00 at a corner only touched ${String(tally.cornerZero)} (${String(tally.cornerZeroBesideAWall)} of them beside a wall lain against)`;
}
