import { useMemo } from "react";
import { RAIL_SLOTS } from "../../lib/card-defaults.js";
import { KEY_PRIORITY, usePlannerKeyBindings, type KeyBinding } from "../../lib/planner-keys.js";
import type { CardId } from "../../lib/setup-cards.js";
import { useCardsStore } from "../../stores/cards-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { storeRefusalFor } from "./store-figures.js";

// ---------------------------------------------------------------------------
// The cards' keys (T-671 slice 12′; card-dock spec §7.1, §12; Blake's B7):
// 1–8 arm that slot's card on the rail, its own digit again cancelling. The
// digits go by position, so they work on any keyboard layout. Through the one
// keyboard owner; never in Walk.
// ---------------------------------------------------------------------------

/**
 * The card again cancels it; otherwise it is armed, the selection is put
 * down, and the hint shows on its first three arms on this device.
 */
export function armOrCancel(card: CardId): boolean {
  const cards = useCardsStore.getState();
  // B2 hard: a card the store has none left of does not arm, and the hint says why.
  const refusal = useCatalogueStore.getState().armedCardId === card ? null : storeRefusalFor(card);
  if (refusal !== null) {
    cards.setHintFor(null);
    cards.setRefusal({ card, text: refusal });
    return false;
  }
  cards.setRefusal(null);
  const armed = useCatalogueStore.getState().toggleCard(card);
  if (!armed) {
    cards.setHintFor(null);
    return false;
  }
  useSelectionStore.getState().clearSelection();
  cards.setHintFor(cards.noteArm(card) ? card : null);
  return true;
}

export function useCardKeys(): void {
  const style = useCardsStore((state) => state.style);
  const bindings = useMemo((): KeyBinding[] => RAIL_SLOTS[style].map((card, index): KeyBinding => ({
    keys: [{ code: `Digit${String(index + 1)}` }],
    priority: KEY_PRIORITY.planner,
    when: () => !useCockpitStore.getState().walkMode,
    run: () => { armOrCancel(card); },
  })), [style]);
  usePlannerKeyBindings(bindings);
}
