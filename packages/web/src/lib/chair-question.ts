import { useCatalogueStore } from "../stores/catalogue-store.js";
import { useChairDialogStore } from "../stores/chair-dialog-store.js";
import { usePlacementStore } from "../stores/placement-store.js";

// ---------------------------------------------------------------------------
// The chair question's answers (ChairCountDialog). Placing a new dining table
// asks how many seats it takes; double-clicking a placed one asks again.
// After a new table's question, answered or cancelled, its card is back in
// the hand, so the next click places another: a click on the wrong spot costs
// one Cancel, not a trip back to the catalogue. Re-seating a placed table
// never leaves a card in the hand.
// ---------------------------------------------------------------------------

/** Answers with `count` seats: places the new table with its chairs (or alone, at 0), or re-seats the placed one. */
export function answerChairQuestion(count: number): void {
  const { pending, editTableId } = useChairDialogStore.getState();
  if (editTableId !== null) {
    usePlacementStore.getState().rearrangeGroup(editTableId, count);
  } else if (pending !== null) {
    const placement = usePlacementStore.getState();
    if (count > 0) placement.placeTableGroup(pending.catalogueItemId, pending.x, pending.z, pending.rotationY, count);
    else placement.placeItem(pending.catalogueItemId, pending.x, pending.z, pending.rotationY);
  }
  closeChairQuestion();
}

/** Cancels: nothing is placed or changed. */
export function cancelChairQuestion(): void {
  closeChairQuestion();
}

function closeChairQuestion(): void {
  const { pending, editTableId, clearDialog } = useChairDialogStore.getState();
  clearDialog();
  if (pending !== null && editTableId === null) useCatalogueStore.getState().selectItem(pending.catalogueItemId);
}
