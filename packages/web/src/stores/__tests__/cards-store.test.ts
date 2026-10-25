import { beforeEach, describe, expect, it, vi } from "vitest";
import { CARD_ARMS_STORAGE_KEY, HINT_ARMS, useCardsStore } from "../cards-store.js";

// ---------------------------------------------------------------------------
// The rail's own state (T-671 slice 12′; card-dock spec §3, Q-13): which eight
// cards it shows, whether the catalogue is open (and its tab and search), the
// card in flight, and how often each card has been armed on this device, so
// the hint shows for a card's first three arms only.
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
  useCardsStore.getState().reset();
});

describe("the catalogue", () => {
  it("opens, closes and toggles, on its first tab with no search", () => {
    const cards = useCardsStore.getState();
    expect(cards.catalogueOpen).toBe(false);
    cards.toggleCatalogue();
    expect(useCardsStore.getState()).toMatchObject({ catalogueOpen: true, tab: "Tables", query: "" });
    useCardsStore.getState().setTab("AV");
    useCardsStore.getState().setQuery("mic");
    useCardsStore.getState().toggleCatalogue();
    expect(useCardsStore.getState().catalogueOpen).toBe(false);
    useCardsStore.getState().openCatalogue();
    // Opening again keeps where you were; only a reset forgets.
    expect(useCardsStore.getState()).toMatchObject({ catalogueOpen: true, tab: "AV", query: "mic" });
  });
});

describe("the hint on a card's first three arms", () => {
  it("counts arms per card on this device and stops after three", () => {
    const shows: boolean[] = [];
    for (let arm = 0; arm < 4; arm += 1) shows.push(useCardsStore.getState().noteArm("round"));
    expect(shows).toEqual([true, true, true, false]);
    expect(HINT_ARMS).toBe(3);
    expect(useCardsStore.getState().noteArm("dance-floor")).toBe(true);
    expect(JSON.parse(localStorage.getItem(CARD_ARMS_STORAGE_KEY) ?? "{}")).toMatchObject({ round: 4, "dance-floor": 1 });
  });

  it("still works when the device refuses storage", () => {
    const failing = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(useCardsStore.getState().noteArm("round")).toBe(true);
    failing.mockRestore();
  });

  it("reads the counts this device kept", () => {
    localStorage.setItem(CARD_ARMS_STORAGE_KEY, JSON.stringify({ round: 3 }));
    useCardsStore.getState().reset();
    expect(useCardsStore.getState().noteArm("round")).toBe(false);
  });
});

describe("the card in flight", () => {
  it("holds one card at a time", () => {
    useCardsStore.getState().setInFlight("round");
    expect(useCardsStore.getState().inFlight).toBe("round");
    useCardsStore.getState().setInFlight(null);
    expect(useCardsStore.getState().inFlight).toBeNull();
  });
});
