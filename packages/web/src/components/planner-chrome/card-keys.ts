import { useMemo } from "react";
import { railSlots } from "../../lib/card-defaults.js";
import { plannerChairSlug } from "../../lib/furniture-defaults.js";
import { KEY_PRIORITY, usePlannerKeyBindings, type KeyBinding } from "../../lib/planner-keys.js";
import type { CardId } from "../../lib/setup-cards.js";
import { useCardsStore } from "../../stores/cards-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { usePlannerEventStore } from "../../stores/planner-event-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { replaceWith } from "./replace-with.js";
import { refuseFromStore } from "./store-figures.js";

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
  // Replace mode (the caption's Replace…): the card replaces the selection instead of arming.
  if (cards.replacing !== null) {
    replaceWith(card);
    return false;
  }
  // B2 hard: a card the store has none left of does not arm, and the hint says why.
  if (refuseFromStore(card)) return false;
  const armed = useCatalogueStore.getState().toggleCard(card);
  if (!armed) {
    cards.setHintFor(null);
    return false;
  }
  useSelectionStore.getState().clearSelection();
  cards.setHintFor(cards.noteArm(card) ? card : null);
  return true;
}

/** The rail's eight, for its style and the event's chair. */
export function useRailSlots(): readonly CardId[] {
  const style = useCardsStore((state) => state.style);
  const chair = usePlannerEventStore((state) => plannerChairSlug(state.eventKind));
  return useMemo(() => railSlots(style, chair), [style, chair]);
}

export function useCardKeys(): void {
  const slots = useRailSlots();
  const bindings = useMemo((): KeyBinding[] => slots.map((card, index): KeyBinding => ({
    keys: [{ code: `Digit${String(index + 1)}` }],
    priority: KEY_PRIORITY.planner,
    when: () => !useCockpitStore.getState().walkMode,
    run: () => { armOrCancel(card); },
  })), [slots]);
  usePlannerKeyBindings(bindings);
}
