// ---------------------------------------------------------------------------
// Setting the piece in hand down where its ghost stands
//
// One path for every way a piece is put down: a click or a release of a drag
// from the catalogue (components/PlacementGhost.tsx), and a tap or a lifted
// finger on a phone (components/SelectionSystem.tsx, the touch arbiter), so
// dressings, the venue's counts and seats behave the same whichever it was.
//
// A card's set (setup-cards placesAsCard) is worked out once, by settledStamp and
// judgeCardAt, for the ghost (components/GhostSet.tsx), the commit and the
// click that picks a piece instead: what the ghost shows is what is set down.
// ---------------------------------------------------------------------------

import { getCatalogueItem } from "./catalogue.js";
import { currentStoreStock, placedCounts, storeRefuses, storeShortfall, storeShortfallWords, type UsableStock } from "./card-stock.js";
import { CLOTH_SNAP_DISTANCE_RENDER, findNearestDiningTable, findNearestTable } from "./cloth-snap.js";
import { isDiningTableItem } from "./furniture-semantics.js";
import { atVerdict, createGhostWorld, judgeGhost, refusalChip, type GhostState, type GhostVerdict, type GhostWorld } from "./ghost-truth.js";
import { settleOnSurfaces, type PlacedItem } from "./placement.js";
import { capReachedFor } from "./placement-cap.js";
import { plannerFeatureEnabled } from "./planner-features.js";
import { describeCard, ghostSetInHand, judgesCard, placesAsCard, seatsInHand, stampSetup, type CardParams } from "./setup-cards.js";
import { useGhostVerdictStore } from "../stores/ghost-verdict-store.js";
import { useRoomDimensionsStore } from "../stores/room-dimensions-store.js";
import { tableClothStyleForCatalogueItem, tableDressingTargetIds, tableSettingForCatalogueItem } from "./table-dressing.js";
import { useCatalogueStore } from "../stores/catalogue-store.js";
import { useChairDialogStore } from "../stores/chair-dialog-store.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useSelectionStore } from "../stores/selection-store.js";
import { postPlacementNotice } from "../stores/placement-notice-store.js";

/** Where a card is set down, render-space: the ghost's pose, its height that of the surface under it. */
export interface CardOrigin {
  readonly x: number;
  readonly z: number;
  readonly y?: number;
}

/**
 * A card's set where it would stand: stamped at the pose, turned as the
 * piece in hand is turned, each piece settled on the surface under it.
 */
export function settledStamp(
  params: CardParams,
  origin: CardOrigin,
  rotationY: number,
  placedItems: readonly PlacedItem[],
  newId?: () => string,
): readonly PlacedItem[] {
  return settleOnSurfaces(stampSetup(params, origin, rotationY, newId), placedItems);
}

/** A card's set judged where it would stand, and the pieces as they would be set down. */
export interface JudgedCard {
  readonly verdict: GhostVerdict;
  readonly pieces: readonly PlacedItem[];
}

/**
 * A card's set judged where it would stand (Q-05): its settled stamp, judged
 * with every body against the room; pushed clear by up to 0.15 m and settled
 * again where the push leaves it, and judged once more when the push carries
 * a piece onto or off a surface. `previous` carries the ghost's hysteresis.
 */
export function judgeCardAt(
  params: CardParams,
  origin: CardOrigin,
  rotationY: number,
  world: GhostWorld,
  previous: GhostState | undefined,
  newId?: () => string,
): JudgedCard {
  const stamp = settledStamp(params, origin, rotationY, world.placedItems, newId);
  const verdict = judgeGhost(stamp, world, { previous });
  if (verdict.state === "refused") return { verdict, pieces: stamp };
  const pushed = atVerdict(stamp, verdict);
  const settled = settleOnSurfaces(pushed, world.placedItems);
  if (settled.every((piece, i) => piece.y === pushed[i]?.y)) return { verdict, pieces: settled };
  const again = judgeGhost(settled, world);
  return { verdict: again.state === "refused" ? again : verdict, pieces: settled };
}

function roomWorld(): GhostWorld {
  return createGhostWorld(usePlacementStore.getState().placedItems, useRoomDimensionsStore.getState().dimensions);
}

/** How a piece is set down: what the pointer is over, and the store's stock (B2) where it is known. */
export interface PlaceInHandOptions {
  /** The placed piece under the pointer or finger, if any. */
  readonly pieceUnderPointer?: string | null;
  /** Usable stock (lib/card-stock), for staff: absent reads the store's as registered (currentStoreStock); null never refuses. */
  readonly stock?: UsableStock | null;
}

/**
 * A click or tap on a placed piece with a card in hand (spec §7.1): it picks
 * the piece and puts the card down, with no refusal, where the set could not
 * be set down anyway. A set that fits where the pointer lands (seen past a
 * chair back) is set down instead. Wherever the card is judged (judgesCard).
 */
function pickInstead(pieceId: string | null, params: CardParams, origin: CardOrigin, rotationY: number): boolean {
  if (pieceId === null || !judgesCard(params)) return false;
  if (judgeCardAt(params, origin, rotationY, roomWorld(), useGhostVerdictStore.getState().verdict?.state).verdict.state !== "refused") return false;
  useCatalogueStore.getState().disarm();
  usePlacementStore.getState().clearGhost();
  useSelectionStore.getState().setActiveGuides([]);
  useSelectionStore.getState().select(pieceId);
  return true;
}

/**
 * Puts the piece in hand down at the ghost. A cloth or a place setting
 * dresses the selected tables, or the nearest under the ghost. A card in hand
 * (placesAsCard) sets its whole set down, or picks the placed piece the pointer
 * is on where the set could not stand. A dining table takes the seats on its
 * card in the same step (`seatsOnTheCard`), or asks for them in the chair
 * dialog as before. A piece whose every copy is already placed is refused
 * with a notice. The piece stays in hand. `invalidate` asks for a frame. The
 * ids a card set down.
 */
export function placePieceInHand(invalidate: () => void, options: PlaceInHandOptions = {}): readonly string[] {
  const catState = useCatalogueStore.getState();
  const placeState = usePlacementStore.getState();
  if (catState.selectedItemId === null) return [];
  if (placeState.ghostPosition === null) return [];
  const [x, y, z] = placeState.ghostPosition;

  // Table dressing: apply to selected table(s), or the nearest table under the drop.
  const clothStyle = tableClothStyleForCatalogueItem(catState.selectedItemId);
  const tableSetting = tableSettingForCatalogueItem(catState.selectedItemId);
  if (clothStyle !== null || tableSetting !== null) {
    const target = tableSetting === null ? "linen" : "dinner";
    const nearest = (target === "dinner" ? findNearestDiningTable : findNearestTable)(
      x,
      z,
      placeState.placedItems,
      CLOTH_SNAP_DISTANCE_RENDER,
    );
    const targetIds = new Set(tableDressingTargetIds(
      placeState.placedItems,
      useSelectionStore.getState().selectedIds,
      nearest?.id ?? null,
      target,
    ));
    if (targetIds.size > 0) {
      if (clothStyle !== null) {
        placeState.applyTableCloth(targetIds, clothStyle);
      } else if (tableSetting !== null) {
        placeState.applyTableSetting(targetIds, tableSetting);
      }
      invalidate();
    }
    return [];
  }

  // A card in hand (setup-cards placesAsCard): the piece the pointer is on, where the set could not stand; else the whole set, one step.
  const card = catState.cardParams !== null && placesAsCard(catState.cardParams) ? catState.cardParams : null;
  if (card !== null && pickInstead(options.pieceUnderPointer ?? null, card, { x, z, y }, placeState.ghostRotation)) {
    invalidate();
    return [];
  }

  // Seated dining tables take chairs; service/standing tables place directly.
  const item = getCatalogueItem(catState.selectedItemId);
  if (item === undefined) return [];
  // Every piece the venue has is already on the floor: say so, near the tap.
  const atCap = capReachedFor(catState.selectedItemId, placeState.placedItems.map((p) => p.catalogueItemId));
  if (atCap !== null) {
    postPlacementNotice(atCap);
    return [];
  }

  if (card !== null) {
    const stock = options.stock === undefined ? currentStoreStock() : options.stock;
    const ids = placeCardAt(card, { x, z, y }, placeState.ghostRotation, { stock });
    // The card goes down once the store has none left for another (B2): "None left in store · Round of 10".
    if (ids.length > 0 && storeRefuses(card, stock, placedCounts(usePlacementStore.getState().placedItems))) {
      useCatalogueStore.getState().disarm();
      usePlacementStore.getState().clearGhost();
      postPlacementNotice(`None left in store · ${describeCard(card).name}`);
    }
    invalidate();
    return ids;
  }

  // The old way, judged as its ghost was behind truthfulGhost alone: refused there, nothing is set down.
  const at = oldWayAt(catState.cardParams, catState.selectedItemId, { x, z, y }, placeState.ghostRotation);
  if (at === null) {
    invalidate();
    return [];
  }

  if (item.tableShape !== null && isDiningTableItem(item)) {
    const seats = catState.cardParams === null ? null : seatsInHand(catState.cardParams);
    if (plannerFeatureEnabled("seatsOnTheCard") && seats !== null) {
      // The seats ride on the card: the table and its chairs in one step, no dialog.
      if (seats > 0) placeState.placeTableGroup(catState.selectedItemId, at.x, at.z, placeState.ghostRotation, seats);
      else placeState.placeItem(catState.selectedItemId, at.x, at.z, placeState.ghostRotation);
      invalidate();
      return [];
    }
    useChairDialogStore.getState().showDialog({
      catalogueItemId: catState.selectedItemId,
      x: at.x,
      z: at.z,
      rotationY: placeState.ghostRotation,
      tableShape: item.tableShape,
    });
    catState.clearSelection();
    placeState.clearGhost();
    invalidate();
    return [];
  }

  placeState.placeItem(catState.selectedItemId, at.x, at.z, placeState.ghostRotation);
  invalidate();
  return [];
}

/**
 * Where the old way sets the piece in hand down. Behind truthfulGhost alone
 * its ghost is judged (setup-cards ghostSetInHand), so here too: where the
 * ghost stood it, pushed clear as the ghost was, or null where the ghost
 * showed it refused, said in the ghost's own words. Otherwise the ghost's pose.
 */
function oldWayAt(
  params: CardParams | null,
  itemId: string,
  origin: CardOrigin,
  rotationY: number,
): { readonly x: number; readonly z: number } | null {
  const set = params === null ? null : ghostSetInHand(params);
  if (set === null) return { x: origin.x, z: origin.z };
  const judged = judgeCardAt(set, origin, rotationY, roomWorld(), useGhostVerdictStore.getState().verdict?.state);
  if (judged.verdict.state === "refused") {
    postPlacementNotice(refusalChip(judged.verdict.obstacle));
    return null;
  }
  const piece = judged.pieces.find((placed) => placed.catalogueItemId === itemId) ?? judged.pieces[0];
  return piece === undefined ? { x: origin.x, z: origin.z } : { x: piece.x, z: piece.z };
}

/**
 * Sets a card's set down where its ghost stands (Q-05, Q-08a): the set as
 * the ghost works it out (judgeCardAt, with the ghost's own history), so a
 * click never places what the ghost showed refused, and at the heights it
 * was judged at. Refused with the ghost's reason, or with the store's
 * (`stock`, B2 hard, where known), and nothing changes. The ids placed.
 */
export function placeCardAt(
  params: CardParams,
  origin: CardOrigin,
  rotationY: number,
  options: { readonly stock?: UsableStock | null } = {},
): readonly string[] {
  const stock = options.stock === undefined ? currentStoreStock() : options.stock;
  const placeState = usePlacementStore.getState();
  let pieces: readonly PlacedItem[];
  if (judgesCard(params)) {
    const judged = judgeCardAt(params, origin, rotationY, roomWorld(), useGhostVerdictStore.getState().verdict?.state);
    if (judged.verdict.state === "refused") {
      postPlacementNotice(refusalChip(judged.verdict.obstacle));
      return [];
    }
    pieces = judged.pieces;
  } else {
    pieces = settledStamp(params, origin, rotationY, placeState.placedItems);
  }
  if (pieces.length === 0) return [];
  const shortfall = storeShortfall(stock, placeState.placedItems, { add: pieces });
  if (shortfall !== null) {
    postPlacementNotice(storeShortfallWords(shortfall));
    return [];
  }
  return placeState.placeSetup(pieces);
}
