import { useEffect } from "react";
import { useCardsStore } from "../../stores/cards-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useChromePresenceStore } from "../../stores/chrome-presence-store.js";
import { usePlannerChromeStore } from "../../stores/planner-chrome-store.js";

// ---------------------------------------------------------------------------
// Nothing in the new chrome works out of sight (T-680 in T-671's chrome).
//
// Cleared, the zones are hidden; a panel opened into one would be invisible,
// take the next Esc, and leave the tools to a second. So asking for one
// brings the tools back with it: A, F or / for the catalogue, L for Lay out,
// any panel a zone opens, and Replace… on the caption, whose cards are on the
// rail. A card put in hand (1–8) or refused by the store does too: its hint,
// or why it would not arm, is the rail's line. Clearing in turn ends
// Replace…, as it closes the catalogue and Lay out (they are panels;
// Replace… is an operation whose only signs, the rail's line and its cards,
// go with the chrome). Only the person's own asks write here, as everywhere
// in the fold.
// ---------------------------------------------------------------------------

function bringTheToolsBack(): void {
  const chrome = useChromePresenceStore.getState();
  if (chrome.cleared) chrome.restoreAll();
}

/** Mount once, in the new chrome. */
export function useNothingOutOfSight(): void {
  useEffect(() => {
    const cards = useCardsStore.subscribe((state, previous) => {
      const catalogue = state.catalogueOpen && !previous.catalogueOpen;
      const replace = state.replacing !== null && previous.replacing === null;
      const refused = state.refusal !== null && state.refusal !== previous.refusal;
      if (catalogue || replace || refused) bringTheToolsBack();
    });
    const hand = useCatalogueStore.subscribe((state, previous) => {
      if (state.armedCardId !== null && state.armedCardId !== previous.armedCardId) bringTheToolsBack();
    });
    const panels = usePlannerChromeStore.subscribe((state, previous) => {
      const left = state.left !== null && state.left !== previous.left;
      const right = state.right !== null && state.right !== previous.right;
      if (left || right) bringTheToolsBack();
    });
    const clearing = useChromePresenceStore.subscribe((state, previous) => {
      if (!state.cleared || previous.cleared) return;
      if (useCardsStore.getState().replacing !== null) useCardsStore.getState().stopReplacing();
    });
    return () => {
      cards();
      hand();
      panels();
      clearing();
    };
  }, []);
}
