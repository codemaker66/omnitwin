import { storeShortfall, storeShortfallWords } from "../../lib/card-stock.js";
import { createGhostWorld } from "../../lib/ghost-truth.js";
import type { PlacedItem } from "../../lib/placement.js";
import { replaceSelection } from "../../lib/planner-keymap.js";
import { planReplace, type ReplaceOptions } from "../../lib/replace.js";
import { requestScreenAnchorFrame } from "../../lib/screen-anchors.js";
import { cardParamsFor, type CardId, type CardParams, type CardParamsRequest } from "../../lib/setup-cards.js";
import { useCardsStore } from "../../stores/cards-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { usePlannerChromeStore } from "../../stores/planner-chrome-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";

// ---------------------------------------------------------------------------
// Replace… (T-671 slice 11′; card-dock spec §8). The caption puts the cards in
// replace mode; a card pressed then, from the rail, its digit or the
// catalogue, replaces the selection through lane E's replaceSelection (one
// undo step, the result selected) and posts E's receipt. Pointing at a card
// first says what would happen (E's sentence). For staff, the store's word
// refuses a change past stock. Notes on the replaced tables wait for E's
// in-step hook, so Replace is not offered while the selection carries one.
// ---------------------------------------------------------------------------

/** The store's word on a change, for staff; none for anyone else. */
function storeWord(): ReplaceOptions["store"] {
  const stock = useCardsStore.getState().stock;
  if (stock === null) return undefined;
  return (change) => {
    const shortfall = storeShortfall(stock, usePlacementStore.getState().placedItems, change);
    return shortfall === null ? null : storeShortfallWords(shortfall);
  };
}

function paramsFor(card: CardId, chosen: CardParamsRequest): CardParams | null {
  return cardParamsFor(card, chosen, useCatalogueStore.getState().rememberedSeats);
}

/** Whether any selected piece carries a note the editor holds (or, for tests, the lookup given). */
export function selectionHasNote(hasNote: (id: string) => boolean = editorHasNote): boolean {
  for (const id of useSelectionStore.getState().selectedIds) if (hasNote(id)) return true;
  return false;
}

function editorHasNote(id: string): boolean {
  return useEditorStore.getState().objects.some((object) => object.id === id && object.notes.trim() !== "");
}

/** Replaces the selection with this card (or one of its pieces): true when it did. */
export function replaceWith(card: CardId, chosen: CardParamsRequest = {}): boolean {
  const params = paramsFor(card, chosen);
  if (params === null) return false;
  const store = storeWord();
  const result = replaceSelection(params, store === undefined ? {} : { store });
  // A refusal has already said why where a placement notice would; the mode stays for another card.
  if (!result.ok) return false;
  usePlannerChromeStore.getState().postReceipt(result.plan.receipt, { undo: true });
  useCardsStore.getState().stopReplacing();
  useCardsStore.getState().closeCatalogue();
  requestScreenAnchorFrame();
  return true;
}

/** What replacing the selection with this card would do, without doing it. */
export function replacePreview(card: CardId, chosen: CardParamsRequest = {}): { readonly ok: boolean; readonly text: string } | null {
  const params = paramsFor(card, chosen);
  if (params === null) return null;
  const placed: readonly PlacedItem[] = usePlacementStore.getState().placedItems;
  const store = storeWord();
  const result = planReplace(
    useSelectionStore.getState().selectedIds,
    params,
    createGhostWorld(placed, useRoomDimensionsStore.getState().dimensions),
    store === undefined ? {} : { store },
  );
  return result.ok ? { ok: true, text: result.plan.sentence } : { ok: false, text: result.reason };
}
