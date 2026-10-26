import { create } from "zustand";
import { seatBaseSlug, type FurnitureCategory } from "@omnitwin/types";
import { CATALOGUE_CATEGORIES, getCatalogueItem } from "../lib/catalogue.js";
import {
  cardIdOf,
  cardMainItem,
  cardMainSlug,
  cardParamsFor,
  cardParamsRequest,
  pieceCardId,
  stepCardParams,
  type CardId,
  type CardParams,
  type CardParamsRequest,
} from "../lib/setup-cards.js";

// ---------------------------------------------------------------------------
// Catalogue drawer state, and the card in hand (card-dock spec §7.1).
//
// Arming a card puts its main catalogue piece in `selectedItemId`, so the
// placement ghost and every reader of the piece in hand keep working, and
// keeps the card's parameters (seats, panels, trestles, colourway) beside
// it. A pick from v1's list arms that piece's card too, so a dining table's
// seats ride on it whichever way it was picked.
// ---------------------------------------------------------------------------

/** Nothing in hand: the fields every cancel returns to. */
const EMPTY_HAND = {
  selectedItemId: null,
  armedCardId: null,
  cardParams: null,
  dragActive: false,
} as const;

export interface CatalogueState {
  /** Whether the catalogue drawer is open. */
  readonly drawerOpen: boolean;
  /** Currently selected catalogue item ID (ready for placement). Null if none. */
  readonly selectedItemId: string | null;
  /** Active category tab in the drawer. */
  readonly activeCategory: FurnitureCategory;
  /** Whether user is actively dragging an item from the shop bar. */
  readonly dragActive: boolean;
  /** The card in hand, or null. */
  readonly armedCardId: CardId | null;
  /** The armed card's parameters; null when nothing is armed. */
  readonly cardParams: CardParams | null;
  /** The seats last chosen at each kind of table this session (by seat base slug), so + and − stick. */
  readonly rememberedSeats: Readonly<Record<string, number>>;

  /** Open the catalogue drawer. */
  readonly openDrawer: () => void;
  /** Close the drawer and clear selection. */
  readonly closeDrawer: () => void;
  /** Toggle drawer open/closed. */
  readonly toggleDrawer: () => void;
  /** Select a catalogue item for placement (arms its piece card). */
  readonly selectItem: (id: string) => void;
  /** Begin drag from shop bar. */
  readonly startDrag: (id: string) => void;
  /** End drag (place or cancel). */
  readonly endDrag: () => void;
  /** Clear the current selection (cancel placement). */
  readonly clearSelection: () => void;
  /** Switch the active category tab. */
  readonly setCategory: (category: FurnitureCategory) => void;

  /** Put a card in hand; it stays armed until cancelled. False when the card names nothing the catalogue holds. */
  readonly armCard: (cardId: CardId, params?: CardParamsRequest) => boolean;
  /** The card again, or its digit again, cancels it; otherwise arms it. Returns whether it is now armed. */
  readonly toggleCard: (cardId: CardId) => boolean;
  /** Put the card down: nothing in hand. */
  readonly disarm: () => void;
  /** A card dragged off the rail: in hand for one release only. */
  readonly startCardDrag: (cardId: CardId, params?: CardParamsRequest) => boolean;
  /** The dragged card is released (placed or not): nothing is left armed. */
  readonly endCardDrag: () => void;
  /** Change the armed card's parameters, held inside its ranges. False when nothing is armed. */
  readonly setCardParams: (params: CardParamsRequest) => boolean;
  /** One step of + or − on the armed card. False when nothing is armed or it is at its limit. */
  readonly stepArmedCard: (delta: 1 | -1) => boolean;
}

/** The hand for these parameters, or null when the catalogue lacks its main piece. */
function handFor(params: CardParams | null, dragActive: boolean): Pick<CatalogueState, "selectedItemId" | "armedCardId" | "cardParams" | "dragActive"> | null {
  if (params === null) return null;
  const item = cardMainItem(params);
  if (item === undefined) return null;
  return { selectedItemId: item.id, armedCardId: cardIdOf(params), cardParams: params, dragActive };
}

/** The remembered seats with this card's count, when it carries one for a table. */
function rememberSeats(remembered: Readonly<Record<string, number>>, params: CardParams): Readonly<Record<string, number>> {
  const seats = params.card === "round" || params.card === "piece" ? params.seats : null;
  if (seats === null) return remembered;
  const base = seatBaseSlug(cardMainSlug(params));
  return remembered[base] === seats ? remembered : { ...remembered, [base]: seats };
}

export const useCatalogueStore = create<CatalogueState>()((set, get) => {
  /** Arms a raw catalogue pick through its piece card, keeping the id exactly as given. */
  const pickPiece = (id: string, dragActive: boolean): void => {
    const item = getCatalogueItem(id);
    const hand = item === undefined
      ? null
      : handFor(cardParamsFor(pieceCardId(item.slug), {}, get().rememberedSeats), dragActive);
    set({ ...(hand ?? EMPTY_HAND), selectedItemId: id, dragActive });
  };

  const arm = (cardId: CardId, params: CardParamsRequest | undefined, dragActive: boolean): boolean => {
    const hand = handFor(cardParamsFor(cardId, params, get().rememberedSeats), dragActive);
    if (hand === null) return false;
    set(hand);
    return true;
  };

  return {
    drawerOpen: false,
    ...EMPTY_HAND,
    activeCategory: CATALOGUE_CATEGORIES[0] ?? "table",
    rememberedSeats: {},

    openDrawer: () => {
      set({ drawerOpen: true });
    },

    closeDrawer: () => {
      set({ drawerOpen: false, ...EMPTY_HAND });
    },

    toggleDrawer: () => {
      const state = get();
      if (state.drawerOpen) {
        set({ drawerOpen: false, ...EMPTY_HAND });
      } else {
        set({ drawerOpen: true });
      }
    },

    selectItem: (id: string) => {
      pickPiece(id, false);
    },

    startDrag: (id: string) => {
      pickPiece(id, true);
    },

    endDrag: () => {
      set(EMPTY_HAND);
    },

    clearSelection: () => {
      set(EMPTY_HAND);
    },

    setCategory: (category: FurnitureCategory) => {
      set({ activeCategory: category });
    },

    armCard: (cardId, params) => arm(cardId, params, false),

    toggleCard: (cardId) => {
      if (get().armedCardId === cardId) {
        set(EMPTY_HAND);
        return false;
      }
      return arm(cardId, undefined, false);
    },

    disarm: () => {
      set(EMPTY_HAND);
    },

    startCardDrag: (cardId, params) => arm(cardId, params, true),

    endCardDrag: () => {
      set(EMPTY_HAND);
    },

    setCardParams: (params) => {
      const state = get();
      if (state.armedCardId === null || state.cardParams === null) return false;
      const merged = cardParamsFor(state.armedCardId, { ...cardParamsRequest(state.cardParams), ...params }, state.rememberedSeats);
      const hand = handFor(merged, state.dragActive);
      if (hand === null || merged === null) return false;
      set({ ...hand, rememberedSeats: rememberSeats(state.rememberedSeats, merged) });
      return true;
    },

    stepArmedCard: (delta) => {
      const state = get();
      if (state.cardParams === null) return false;
      const next = stepCardParams(state.cardParams, delta);
      if (next === state.cardParams) return false;
      set({ cardParams: next, rememberedSeats: rememberSeats(state.rememberedSeats, next) });
      return true;
    },
  };
});
