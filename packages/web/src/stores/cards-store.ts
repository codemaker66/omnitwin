import { create } from "zustand";
import { z } from "zod";
import { CARD_TABS, type CardTab, type RailStyle } from "../lib/card-defaults.js";
import type { CardId } from "../lib/setup-cards.js";

// ---------------------------------------------------------------------------
// The rail's own state (T-671 slice 12′; card-dock spec §3, Q-13).
//
// Which eight cards the rail shows (the event's style), whether the catalogue
// is open with its tab and search, the card dragged off the rail, and how
// often each card has been armed on this device: the hint shows on a card's
// first three arms only (spec §3). What is in hand is catalogue-store's (E0).
// Storage is a convenience: a device that refuses it still gets the hint.
// ---------------------------------------------------------------------------

export const CARD_ARMS_STORAGE_KEY = "venviewer.card-arms.v1";

/** Arms of a card on a device that still show the hint. */
export const HINT_ARMS = 3;

const ArmsSchema = z.record(z.string(), z.number().int().nonnegative());

function readArms(): Readonly<Record<string, number>> {
  try {
    const raw = window.localStorage.getItem(CARD_ARMS_STORAGE_KEY);
    if (raw === null) return {};
    const parsed = ArmsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function keepArms(arms: Readonly<Record<string, number>>): void {
  try {
    window.localStorage.setItem(CARD_ARMS_STORAGE_KEY, JSON.stringify(arms));
  } catch {
    // A device that refuses storage shows the hint again next time; nothing else is lost.
  }
}

interface CardsState {
  readonly style: RailStyle;
  readonly catalogueOpen: boolean;
  readonly tab: CardTab;
  readonly query: string;
  /** The card dragged off the rail, until it is released. */
  readonly inFlight: CardId | null;
  readonly arms: Readonly<Record<string, number>>;
  /** The card whose first-arms hint is showing, or null. */
  readonly hintFor: CardId | null;
  readonly setHintFor: (card: CardId | null) => void;
  readonly setStyle: (style: RailStyle) => void;
  readonly openCatalogue: () => void;
  readonly closeCatalogue: () => void;
  readonly toggleCatalogue: () => void;
  readonly setTab: (tab: CardTab) => void;
  readonly setQuery: (query: string) => void;
  readonly setInFlight: (card: CardId | null) => void;
  /** Counts one arm of this card; true while the hint should still show. */
  readonly noteArm: (card: CardId) => boolean;
  readonly reset: () => void;
}

const FIRST_TAB: CardTab = CARD_TABS[0];

export const useCardsStore = create<CardsState>()((set, get) => ({
  style: "dinner",
  catalogueOpen: false,
  tab: FIRST_TAB,
  query: "",
  inFlight: null,
  arms: readArms(),
  hintFor: null,
  setHintFor: (hintFor) => { set({ hintFor }); },
  setStyle: (style) => { set({ style }); },
  openCatalogue: () => { set({ catalogueOpen: true }); },
  closeCatalogue: () => { set({ catalogueOpen: false }); },
  toggleCatalogue: () => { set({ catalogueOpen: !get().catalogueOpen }); },
  setTab: (tab) => { set({ tab }); },
  setQuery: (query) => { set({ query }); },
  setInFlight: (inFlight) => { set({ inFlight }); },
  noteArm: (card) => {
    const before = get().arms[card] ?? 0;
    const arms = { ...get().arms, [card]: before + 1 };
    set({ arms });
    keepArms(arms);
    return before < HINT_ARMS;
  },
  reset: () => { set({ style: "dinner", catalogueOpen: false, tab: FIRST_TAB, query: "", inFlight: null, arms: readArms(), hintFor: null }); },
}));
