import { useEffect } from "react";
import { cardStoreFigure, loadUsableStock, placedCounts, storeRefuses, type UsableStock } from "../../lib/card-stock.js";
import { plannerFeatureEnabled } from "../../lib/planner-features.js";
import { cardParamsFor, type CardId, type CardParams } from "../../lib/setup-cards.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { useCardsStore } from "../../stores/cards-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";

// ---------------------------------------------------------------------------
// The store on the cards (T-671; card-dock spec §4.1, §4.2, §17.1). Staff see
// "×22 in store" under a card's seats; Blake's B2 (25 Oct 2026) makes the
// figure a hard limit, so an empty store reads "None left in store" and the
// card will not arm, the hint saying why. Clients and guests never see a
// figure: the stock is only fetched for the venue's own staff, from the
// existing staff route, behind lane E's `storeCounts` switch. Lane E's
// card-stock.ts does the counting; this file words it and decides who sees it.
// ---------------------------------------------------------------------------

/** The reason, whole: the hint, the tooltip and the accessible name say it. */
export const NONE_LEFT_IN_STORE = "None left in store";
/** The card's own line, which has about 74 px on the rail and 88 in the catalogue. */
const NONE_LEFT_ON_CARD = "None left";

export interface StoreFace {
  /** The card's store line: "×22 in store" or "None left". */
  readonly line: string;
  /** The same, for the card's accessible name. */
  readonly spoken: string;
  /** B2 hard: the store holds none, so the card will not arm. */
  readonly refused: boolean;
}

/** What the store says about one card, or null when there is nothing to say. */
export function storeFace(params: CardParams | null, stock: UsableStock | null, placed: ReadonlyMap<string, number>): StoreFace | null {
  if (params === null || stock === null) return null;
  const figure = cardStoreFigure(params, stock, placed);
  if (figure === null) return null;
  if (storeRefuses(params, stock, placed)) return { line: NONE_LEFT_ON_CARD, spoken: "none left in store", refused: true };
  return { line: `×${String(figure)} in store`, spoken: `${String(figure)} in store`, refused: false };
}

/**
 * The roles the inventory route admits (api utils/query.ts INVENTORY_READ_ROLES),
 * at the layout's own venue. The route stays the authority: a refusal there
 * simply leaves the figures off.
 */
const STORE_READERS: ReadonlySet<string> = new Set(["admin", "manager", "staff", "hallkeeper", "planner"]);

export function seesStoreFigures(user: { readonly role: string; readonly venueId: string | null } | null, venueId: string | null): boolean {
  return user !== null && venueId !== null && user.venueId === venueId && STORE_READERS.has(user.role);
}

/** Why a card will not arm now, from the store; null when it may. */
export function storeRefusalFor(card: CardId): string | null {
  const stock = useCardsStore.getState().stock;
  if (stock === null) return null;
  const params = cardParamsFor(card, {}, useCatalogueStore.getState().rememberedSeats);
  const face = storeFace(params, stock, placedCounts(usePlacementStore.getState().placedItems));
  return face?.refused === true ? NONE_LEFT_IN_STORE : null;
}

/** Fetches the venue's usable stock once for staff, and forgets it for everyone else. */
export function useStoreStock(): void {
  const user = useAuthStore((state) => state.user);
  const venueId = useEditorStore((state) => state.venueId);
  const allowed = plannerFeatureEnabled("storeCounts") && seesStoreFigures(user, venueId);
  useEffect(() => {
    if (!allowed || venueId === null) {
      useCardsStore.getState().setStock(null);
      return undefined;
    }
    const controller = new AbortController();
    loadUsableStock(venueId, controller.signal).then(
      (stock) => { if (!controller.signal.aborted) useCardsStore.getState().setStock(stock); },
      // No figure is better than a wrong one: a refused or failed read leaves the cards without it.
      () => { if (!controller.signal.aborted) useCardsStore.getState().setStock(null); },
    );
    return () => { controller.abort(); };
  }, [allowed, venueId]);
}
