// ---------------------------------------------------------------------------
// Setting the piece in hand down where its ghost stands
//
// One path for every way a piece is put down: a click or a release of a drag
// from the catalogue (components/PlacementGhost.tsx), and a tap or a lifted
// finger on a phone (components/SelectionSystem.tsx, the touch arbiter), so
// dressings, the venue's counts and seats behave the same whichever it was.
// ---------------------------------------------------------------------------

import { getCatalogueItem } from "./catalogue.js";
import { CLOTH_SNAP_DISTANCE_RENDER, findNearestDiningTable, findNearestTable } from "./cloth-snap.js";
import { isDiningTableItem } from "./furniture-semantics.js";
import { capReachedFor } from "./placement-cap.js";
import { plannerFeatureEnabled } from "./planner-features.js";
import { seatsInHand } from "./setup-cards.js";
import { tableClothStyleForCatalogueItem, tableDressingTargetIds, tableSettingForCatalogueItem } from "./table-dressing.js";
import { useCatalogueStore } from "../stores/catalogue-store.js";
import { useChairDialogStore } from "../stores/chair-dialog-store.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useSelectionStore } from "../stores/selection-store.js";
import { postPlacementNotice } from "../stores/placement-notice-store.js";

/**
 * Puts the piece in hand down at the ghost. A cloth or a place setting
 * dresses the selected tables, or the nearest under the ghost. A dining table
 * takes the seats on its card in the same step (`seatsOnTheCard`), or asks
 * for them in the chair dialog as before. A piece whose every copy is already
 * placed is refused with a notice. The piece stays in hand. `invalidate` asks
 * for a frame.
 */
export function placePieceInHand(invalidate: () => void): void {
  const catState = useCatalogueStore.getState();
  const placeState = usePlacementStore.getState();
  if (catState.selectedItemId === null) return;
  if (placeState.ghostPosition === null) return;
  const [x, , z] = placeState.ghostPosition;

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
    return;
  }

  // Seated dining tables take chairs; service/standing tables place directly.
  const item = getCatalogueItem(catState.selectedItemId);
  if (item === undefined) return;
  // Every piece the venue has is already on the floor: say so, near the tap.
  const atCap = capReachedFor(catState.selectedItemId, placeState.placedItems.map((p) => p.catalogueItemId));
  if (atCap !== null) {
    postPlacementNotice(atCap);
    return;
  }

  if (item.tableShape !== null && isDiningTableItem(item)) {
    const seats = catState.cardParams === null ? null : seatsInHand(catState.cardParams);
    if (plannerFeatureEnabled("seatsOnTheCard") && seats !== null) {
      // The seats ride on the card: the table and its chairs in one step, no dialog.
      if (seats > 0) placeState.placeTableGroup(catState.selectedItemId, x, z, placeState.ghostRotation, seats);
      else placeState.placeItem(catState.selectedItemId, x, z, placeState.ghostRotation);
      invalidate();
      return;
    }
    useChairDialogStore.getState().showDialog({
      catalogueItemId: catState.selectedItemId,
      x,
      z,
      rotationY: placeState.ghostRotation,
      tableShape: item.tableShape,
    });
    catState.clearSelection();
    placeState.clearGhost();
    invalidate();
    return;
  }

  placeState.placeItem(catState.selectedItemId, x, z, placeState.ghostRotation);
  invalidate();
}
