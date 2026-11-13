import { describe, it, expect, beforeEach } from "vitest";
import { useCatalogueStore } from "../catalogue-store.js";
import { CATALOGUE_ITEMS, CATALOGUE_CATEGORIES, getCatalogueItem, getCatalogueItemBySlug } from "../../lib/catalogue.js";
import type { CatalogueItem } from "../../lib/catalogue.js";

const firstItem = CATALOGUE_ITEMS[0] as CatalogueItem;
const secondItem = CATALOGUE_ITEMS[1] as CatalogueItem;

function resetStore(): void {
  useCatalogueStore.setState({
    drawerOpen: false,
    selectedItemId: null,
    activeCategory: CATALOGUE_CATEGORIES[0] ?? "table",
    dragActive: false,
    armedCardId: null,
    cardParams: null,
    rememberedSeats: {},
  });
}

beforeEach(resetStore);

// ---------------------------------------------------------------------------
// Drawer open/close
// ---------------------------------------------------------------------------

describe("catalogue drawer", () => {
  it("starts closed", () => {
    expect(useCatalogueStore.getState().drawerOpen).toBe(false);
  });

  it("openDrawer opens the drawer", () => {
    useCatalogueStore.getState().openDrawer();
    expect(useCatalogueStore.getState().drawerOpen).toBe(true);
  });

  it("closeDrawer closes the drawer", () => {
    useCatalogueStore.getState().openDrawer();
    useCatalogueStore.getState().closeDrawer();
    expect(useCatalogueStore.getState().drawerOpen).toBe(false);
  });

  it("closeDrawer clears selection", () => {
    useCatalogueStore.getState().openDrawer();
    useCatalogueStore.getState().selectItem(firstItem.id);
    useCatalogueStore.getState().closeDrawer();
    expect(useCatalogueStore.getState().selectedItemId).toBeNull();
  });

  it("toggleDrawer opens when closed", () => {
    useCatalogueStore.getState().toggleDrawer();
    expect(useCatalogueStore.getState().drawerOpen).toBe(true);
  });

  it("toggleDrawer closes when open", () => {
    useCatalogueStore.getState().openDrawer();
    useCatalogueStore.getState().toggleDrawer();
    expect(useCatalogueStore.getState().drawerOpen).toBe(false);
  });

  it("toggleDrawer close clears selection", () => {
    useCatalogueStore.getState().openDrawer();
    useCatalogueStore.getState().selectItem(firstItem.id);
    useCatalogueStore.getState().toggleDrawer();
    expect(useCatalogueStore.getState().selectedItemId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Item selection
// ---------------------------------------------------------------------------

describe("item selection", () => {
  it("starts with no selection", () => {
    expect(useCatalogueStore.getState().selectedItemId).toBeNull();
  });

  it("selectItem sets selectedItemId", () => {
    useCatalogueStore.getState().selectItem(firstItem.id);
    expect(useCatalogueStore.getState().selectedItemId).toBe(firstItem.id);
  });

  it("selectItem replaces previous selection", () => {
    useCatalogueStore.getState().selectItem(firstItem.id);
    useCatalogueStore.getState().selectItem(secondItem.id);
    expect(useCatalogueStore.getState().selectedItemId).toBe(secondItem.id);
  });

  it("clearSelection resets to null", () => {
    useCatalogueStore.getState().selectItem(firstItem.id);
    useCatalogueStore.getState().clearSelection();
    expect(useCatalogueStore.getState().selectedItemId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Category tab
// ---------------------------------------------------------------------------

describe("category tab", () => {
  it("defaults to first catalogue category", () => {
    expect(useCatalogueStore.getState().activeCategory).toBe(CATALOGUE_CATEGORIES[0]);
  });

  it("setCategory changes active category", () => {
    useCatalogueStore.getState().setCategory("chair");
    expect(useCatalogueStore.getState().activeCategory).toBe("chair");
  });

  it("setCategory to same category is idempotent", () => {
    useCatalogueStore.getState().setCategory("av");
    useCatalogueStore.getState().setCategory("av");
    expect(useCatalogueStore.getState().activeCategory).toBe("av");
  });
});

// ---------------------------------------------------------------------------
// Drag and drop
// ---------------------------------------------------------------------------

describe("drag and drop", () => {
  it("starts with dragActive false", () => {
    expect(useCatalogueStore.getState().dragActive).toBe(false);
  });

  it("startDrag sets selectedItemId and dragActive", () => {
    useCatalogueStore.getState().startDrag(firstItem.id);
    expect(useCatalogueStore.getState().selectedItemId).toBe(firstItem.id);
    expect(useCatalogueStore.getState().dragActive).toBe(true);
  });

  it("endDrag clears selection and dragActive", () => {
    useCatalogueStore.getState().startDrag(firstItem.id);
    useCatalogueStore.getState().endDrag();
    expect(useCatalogueStore.getState().selectedItemId).toBeNull();
    expect(useCatalogueStore.getState().dragActive).toBe(false);
  });

  it("closeDrawer clears dragActive", () => {
    useCatalogueStore.getState().openDrawer();
    useCatalogueStore.getState().startDrag(firstItem.id);
    useCatalogueStore.getState().closeDrawer();
    expect(useCatalogueStore.getState().dragActive).toBe(false);
  });

  it("clearSelection clears dragActive", () => {
    useCatalogueStore.getState().startDrag(firstItem.id);
    useCatalogueStore.getState().clearSelection();
    expect(useCatalogueStore.getState().dragActive).toBe(false);
    expect(useCatalogueStore.getState().selectedItemId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The card in hand (card-dock spec §7.1)
// ---------------------------------------------------------------------------

function slugInHand(): string | undefined {
  const id = useCatalogueStore.getState().selectedItemId;
  return id === null ? undefined : getCatalogueItem(id)?.slug;
}

describe("arming a card", () => {
  it("puts the card's main piece in hand with its parameters", () => {
    expect(useCatalogueStore.getState().armCard("round")).toBe(true);
    const state = useCatalogueStore.getState();
    expect(state.armedCardId).toBe("round");
    expect(state.cardParams).toEqual({ card: "round", seats: 10, colourway: "white" });
    expect(slugInHand()).toBe("round-table-6ft-white");
    expect(state.dragActive).toBe(false);
  });

  it("takes parameters asked for, held inside the card's ranges", () => {
    useCatalogueStore.getState().armCard("dance-floor", { cols: 6, rows: 99 });
    expect(useCatalogueStore.getState().cardParams).toEqual({ card: "dance-floor", cols: 6, rows: 12 });
    expect(slugInHand()).toBe("dancefloor-panel");
  });

  it("refuses a piece the catalogue does not hold and leaves the hand as it was", () => {
    useCatalogueStore.getState().armCard("round");
    expect(useCatalogueStore.getState().armCard("piece:no-such-piece")).toBe(false);
    expect(useCatalogueStore.getState().armedCardId).toBe("round");
  });

  it("is cancelled by the same card again, and switched by another", () => {
    const store = useCatalogueStore.getState();
    expect(store.toggleCard("round")).toBe(true);
    expect(store.toggleCard("piece:lectern")).toBe(true);
    expect(useCatalogueStore.getState().armedCardId).toBe("piece:lectern");
    expect(store.toggleCard("piece:lectern")).toBe(false);
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
    expect(useCatalogueStore.getState().selectedItemId).toBeNull();
  });

  it("is put down by disarm and by every older cancel", () => {
    const store = useCatalogueStore.getState();
    for (const cancel of [store.disarm, store.clearSelection, store.endDrag, store.closeDrawer]) {
      store.armCard("round");
      cancel();
      const state = useCatalogueStore.getState();
      expect(state.armedCardId).toBeNull();
      expect(state.cardParams).toBeNull();
      expect(state.selectedItemId).toBeNull();
    }
  });
});

describe("dragging a card", () => {
  it("holds it for one release only", () => {
    const store = useCatalogueStore.getState();
    expect(store.startCardDrag("piece:bar-counter")).toBe(true);
    expect(useCatalogueStore.getState().dragActive).toBe(true);
    expect(slugInHand()).toBe("bar-counter");
    store.endCardDrag();
    expect(useCatalogueStore.getState().armedCardId).toBeNull();
    expect(useCatalogueStore.getState().dragActive).toBe(false);
  });
});

describe("changing the card in hand", () => {
  it("steps seats with + and −, declining at the limit", () => {
    const store = useCatalogueStore.getState();
    store.armCard("round", { seats: 11 });
    expect(store.stepArmedCard(1)).toBe(true);
    expect(useCatalogueStore.getState().cardParams).toMatchObject({ seats: 12 });
    expect(store.stepArmedCard(1)).toBe(false);
  });

  it("declines + and − with nothing in hand", () => {
    expect(useCatalogueStore.getState().stepArmedCard(1)).toBe(false);
    expect(useCatalogueStore.getState().setCardParams({ seats: 9 })).toBe(false);
  });

  it("changes one field and keeps the rest, swapping the piece for a new colourway", () => {
    const store = useCatalogueStore.getState();
    store.armCard("round", { seats: 9 });
    expect(store.setCardParams({ colourway: "black" })).toBe(true);
    expect(useCatalogueStore.getState().cardParams).toEqual({ card: "round", seats: 9, colourway: "black" });
    expect(slugInHand()).toBe("round-table-6ft-black");
  });

  it("remembers the seats chosen for a kind of table this session", () => {
    const store = useCatalogueStore.getState();
    store.armCard("round");
    store.stepArmedCard(1);
    store.disarm();
    store.armCard("round");
    expect(useCatalogueStore.getState().cardParams).toMatchObject({ seats: 11 });
    store.selectItem(getCatalogueItemBySlug("round-table-6ft-black")?.id ?? "");
    expect(useCatalogueStore.getState().cardParams).toMatchObject({ card: "piece", seats: 11 });
  });
});

describe("a pick from v1's list", () => {
  it("arms that piece's card, so a table's seats ride on it", () => {
    const trestle = getCatalogueItemBySlug("trestle-6ft-white");
    useCatalogueStore.getState().selectItem(trestle?.id ?? "");
    const state = useCatalogueStore.getState();
    expect(state.selectedItemId).toBe(trestle?.id);
    expect(state.armedCardId).toBe("piece:trestle-6ft-white");
    expect(state.cardParams).toEqual({ card: "piece", slug: "trestle-6ft-white", seats: 6 });
  });

  it("keeps the id exactly as given, and holds an unknown id without a card", () => {
    useCatalogueStore.getState().selectItem("lectern");
    expect(useCatalogueStore.getState().selectedItemId).toBe("lectern");
    expect(useCatalogueStore.getState().armedCardId).toBe("piece:lectern");
    useCatalogueStore.getState().startDrag("not-in-the-catalogue");
    const state = useCatalogueStore.getState();
    expect(state.selectedItemId).toBe("not-in-the-catalogue");
    expect(state.armedCardId).toBeNull();
    expect(state.dragActive).toBe(true);
  });
});
