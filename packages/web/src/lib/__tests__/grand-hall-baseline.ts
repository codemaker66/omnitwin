import type { SpaceDimensions } from "@omnitwin/types";
import { toRealWorld } from "../../constants/scale.js";
import { getCatalogueItemBySlug, type CatalogueItem } from "../catalogue.js";
import {
  computeRotatedFootprint,
  createPlacedItem,
  isWithinRoomBounds,
  snapToWallEdge,
  type PlacedItem,
} from "../placement.js";
import { createGhostWorld, judgeGhost } from "../ghost-truth.js";
import { FILL_AISLE_RULE, grandHallExits, planBanquetFill, planGangwayFill, planTheatreFill, type TheatreFillPlan } from "../auto-fill.js";
import { doorKeepOuts, roomDoorClearSpaces } from "../door-clear-spaces.js";
import { applySeatShortfallFix } from "../seat-shortfall.js";
import { createTableGroup } from "../table-group.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { useDoorClearSpaceStore } from "../../stores/door-clear-space-store.js";

// ---------------------------------------------------------------------------
// What the planner decides in the Grand Hall, written down whole: where a
// piece may stand, where the walls pull it, what the ghost says, and every
// table, chair and seat the automatic layouts set. The figures in
// fixtures/grand-hall-placement-baseline.json were taken from the code as it
// stood on 11 Nov 2026 (origin/master 9fdb57a6), before the planner learned a
// room's real outline (audit editor-save-4); the test beside this file holds
// the Grand Hall, a rectangle centred on the origin, to exactly those figures.
// ---------------------------------------------------------------------------

function item(slug: string): CatalogueItem {
  const found = getCatalogueItemBySlug(slug);
  if (found === undefined) throw new Error(`no catalogue item ${slug}`);
  return found;
}

function steps(from: number, to: number, step: number): number[] {
  const values: number[] = [];
  for (let i = 0; from + i * step <= to + 1e-9; i += 1) values.push(from + i * step);
  return values;
}

interface Pose { readonly slug: string; readonly rotationY: number }

const BOUNDS_POSES: readonly Pose[] = [
  { slug: "burgess-turini-18-3", rotationY: 0 },
  { slug: "round-table-6ft-white", rotationY: 0 },
  { slug: "trestle-6ft", rotationY: 0 },
  { slug: "trestle-6ft", rotationY: Math.PI / 2 },
  { slug: "trestle-6ft", rotationY: Math.PI / 4 },
  { slug: "platform", rotationY: 0 },
];

const SNAP_POSES: readonly Pose[] = [
  { slug: "burgess-turini-18-3", rotationY: 0 },
  { slug: "round-table-6ft-white", rotationY: 0 },
  { slug: "trestle-6ft", rotationY: Math.PI / 2 },
];

/** A theatre plan with each seat as [x, z, turn, kind]. */
function theatrePlan(plan: TheatreFillPlan | null): unknown {
  if (plan === null) return null;
  return {
    ...plan,
    chairItemId: kindOf(plan.chairItemId),
    chairKinds: plan.chairKinds.map((kind) => [kindOf(kind.chairItemId), kind.seats]),
    seats: plan.seats.map((seat) => [seat.xM, seat.zM, seat.rotationY, kindOf(seat.chairItemId)]),
  };
}

/** One row of "1" (inside) and "0" per z, across x. */
function boundsRows(pose: Pose, dims: SpaceDimensions): string[] {
  const piece = item(pose.slug);
  return steps(-6.25, 6.25, 0.25).map((z) => steps(-11.5, 11.5, 0.25)
    .map((x) => (isWithinRoomBounds(x, z, piece, pose.rotationY, dims) ? "1" : "0")).join(""));
}

/** The decision exactly at each wall, and a hair either side of it. */
function flushDecisions(pose: Pose, dims: SpaceDimensions): string {
  const piece = item(pose.slug);
  const { halfW, halfD } = computeRotatedFootprint(piece, pose.rotationY);
  const flushX = dims.width / 2 - halfW;
  const flushZ = dims.length / 2 - halfD;
  const hairs = [-1e-6, -1e-9, 0, 1e-9, 1e-6];
  const out: string[] = [];
  for (const side of [-1, 1]) {
    for (const hair of hairs) {
      out.push(isWithinRoomBounds(side * (flushX + hair), 0, piece, pose.rotationY, dims) ? "1" : "0");
      out.push(isWithinRoomBounds(0, side * (flushZ + hair), piece, pose.rotationY, dims) ? "1" : "0");
    }
  }
  return out.join("");
}

function snapPoints(pose: Pose, dims: SpaceDimensions): number[] {
  const piece = item(pose.slug);
  const out: number[] = [];
  for (const z of steps(-6.25, 6.25, 0.5)) {
    for (const x of steps(-11.5, 11.5, 0.5)) {
      const snapped = snapToWallEdge(x, z, piece, pose.rotationY, dims);
      out.push(snapped.x, snapped.z);
    }
  }
  return out;
}

type GhostRow = readonly [state: string, dx: number, dz: number, pushedM: number, kind: string | null, depthM: number | null, label: string | null];

function ghostRows(stampAt: (x: number, z: number) => readonly PlacedItem[], placed: readonly PlacedItem[], dims: SpaceDimensions): GhostRow[] {
  const world = createGhostWorld(placed, dims);
  const rows: GhostRow[] = [];
  for (const z of steps(-6.2, 6.2, 0.775)) {
    for (const x of steps(-11.4, 11.4, 0.95)) {
      const verdict = judgeGhost(stampAt(x, z), world);
      rows.push([
        verdict.state, verdict.dx, verdict.dz, verdict.pushedM,
        verdict.obstacle?.kind ?? null, verdict.obstacle?.depthM ?? null, verdict.obstacle?.obstacleLabel ?? null,
      ]);
    }
  }
  return rows;
}

/** The catalogue ids met, in order of first sight, so each piece and seat names its kind by a short number. */
const kinds: string[] = [];

function kindOf(catalogueItemId: string): number {
  const known = kinds.indexOf(catalogueItemId);
  return known === -1 ? kinds.push(catalogueItemId) - 1 : known;
}

/** Placed pieces without their random ids: kind, pose, and which group each is in, in order of first sight. */
function piecesOf(placed: readonly PlacedItem[]): (number | null)[][] {
  const groups = new Map<string, number>();
  return placed.map((piece) => {
    let group: number | null = null;
    if (piece.groupId !== null) {
      group = groups.get(piece.groupId) ?? groups.size;
      groups.set(piece.groupId, group);
    }
    return [kindOf(piece.catalogueItemId), piece.x, piece.y, piece.z, piece.rotationY, group];
  });
}

function resetPlanner(dims: SpaceDimensions): void {
  useRoomDimensionsStore.getState().setDimensions(dims);
  useDoorClearSpaceStore.getState().setRoomSpaces(roomDoorClearSpaces("grand-hall"));
  usePlacementStore.setState({
    placedItems: [], ghostPosition: null, ghostRotation: 0, ghostValid: false, ghostInvalidReason: null, snapEnabled: true,
  });
}

/**
 * Everything the planner decides in a room of `dims` (render space) with the
 * Grand Hall's doors: pure functions first, then the placement store's own
 * actions. Leaves the stores reset to an empty Grand Hall.
 */
export function computeGrandHallBaseline(dims: SpaceDimensions): unknown {
  kinds.length = 0;
  const widthM = toRealWorld(dims.width);
  const lengthM = toRealWorld(dims.length);
  const chair = item("burgess-turini-18-3");
  const round = item("round-table-6ft-white");
  const doors = doorKeepOuts(roomDoorClearSpaces("grand-hall") ?? []);
  const poseName = (pose: Pose): string => `${pose.slug}@${pose.rotationY.toFixed(4)}`;

  const bounds = Object.fromEntries(BOUNDS_POSES.map((pose) => [poseName(pose), boundsRows(pose, dims)]));
  const flush = Object.fromEntries(BOUNDS_POSES.map((pose) => [poseName(pose), flushDecisions(pose, dims)]));
  const snap = Object.fromEntries(SNAP_POSES.map((pose) => [poseName(pose), snapPoints(pose, dims)]));

  const laid = [
    ...createTableGroup(round.id, -4, 0, 0, 10),
    ...createTableGroup(round.id, 5.5, 1.5, 0, 8),
    createPlacedItem(item("platform").id, 0, -4.2),
  ];
  const ghost = {
    chairEmptyRoom: ghostRows((x, z) => [createPlacedItem(chair.id, x, z)], [], dims),
    roundOfTenEmptyRoom: ghostRows((x, z) => createTableGroup(round.id, x, z, 0, 10), [], dims),
    chairLaidRoom: ghostRows((x, z) => [createPlacedItem(chair.id, x, z)], laid, dims),
  };

  const banquet = Object.fromEntries([0, 16, 60, 100, 140, 220].flatMap((guests) => [
    [String(guests), planBanquetFill(round, guests, 10, widthM, lengthM)],
    [`${String(guests)}+doors`, planBanquetFill(round, guests, 10, widthM, lengthM, { doorSpaces: doors })],
  ]));
  const theatre = Object.fromEntries([0, 60, 150].flatMap((guests) => [
    [String(guests), theatrePlan(planTheatreFill(chair, guests, widthM, lengthM))],
    [`${String(guests)}+doors`, theatrePlan(planTheatreFill(chair, guests, widthM, lengthM, { doorSpaces: doors }))],
  ]));
  const gangways = Object.fromEntries([0, 120].map((guests) => [
    String(guests),
    planGangwayFill({ table: round, seatsPerTable: 10, guests, roomWidthM: widthM, roomLengthM: lengthM, exits: grandHallExits(), rule: FILL_AISLE_RULE, doorSpaces: doors }),
  ]));

  const shortfall = applySeatShortfallFix({
    placedItems: [...createTableGroup(round.id, -4, 0, 0, 10), ...createTableGroup(round.id, 4, 0, 0, 10)],
    guests: 60,
    roomWidthM: widthM,
    roomLengthM: lengthM,
    doorSpaces: doors,
  });

  // The placement store's own actions, in the room as the planner opens it.
  const store: Record<string, unknown> = {};
  for (const guests of [0, 60, 220]) {
    resetPlanner(dims);
    const plan = usePlacementStore.getState().autoArrangeBanquet(round.id, guests, 10, grandHallExits());
    store[`banquet ${String(guests)}`] = { tables: plan?.tableCount ?? null, pieces: piecesOf(usePlacementStore.getState().placedItems) };
  }
  for (const guests of [0, 60, 150]) {
    resetPlanner(dims);
    const plan = usePlacementStore.getState().autoArrangeTheatre(chair.id, guests);
    store[`theatre ${String(guests)}`] = { rows: plan?.rows ?? null, pieces: piecesOf(usePlacementStore.getState().placedItems) };
  }
  resetPlanner(dims);
  const ghostAt: (string | number | boolean | null)[][] = [];
  for (const pose of [chair, round]) {
    for (const z of steps(-6.1, 6.1, 1.22)) {
      for (const x of steps(-11.3, 11.3, 1.13)) {
        usePlacementStore.getState().updateGhost(x, z, pose.id);
        const { ghostPosition, ghostValid, ghostInvalidReason } = usePlacementStore.getState();
        ghostAt.push([kindOf(pose.id), ...(ghostPosition ?? [null, null, null]), ghostValid, ghostInvalidReason]);
      }
    }
  }
  store["updateGhost"] = ghostAt;
  resetPlanner(dims);
  for (const [x, z] of [[-10.4, -5.1], [10.3, 5.2], [0.2, -5.4], [9.9, 0.3], [-3.3, 2.2]] as const) {
    usePlacementStore.getState().placeItem(chair.id, x, z);
  }
  usePlacementStore.getState().placeTableGroup(round.id, 8.9, -3.6, 0, 10);
  store["placed by hand"] = piecesOf(usePlacementStore.getState().placedItems);
  resetPlanner(dims);

  return {
    dims,
    kinds: [...kinds],
    bounds,
    flush,
    snap,
    ghost,
    banquet,
    theatre,
    gangways,
    shortfall: shortfall === null ? null : { offer: shortfall.offer, pieces: piecesOf(shortfall.placedItems) },
    store,
  };
}
