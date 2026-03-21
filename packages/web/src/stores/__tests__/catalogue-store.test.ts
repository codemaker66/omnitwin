import { describe, it, expect, beforeEach } from "vitest";
import { useCatalogueStore } from "../catalogue-store.js";
import { CATALOGUE_ITEMS, CATALOGUE_CATEGORIES } from "../../lib/catalogue.js";
import type { CatalogueItem } from "../../lib/catalogue.js";

const firstItem = CATALOGUE_ITEMS[0] as CatalogueItem;
const secondItem = CATALOGUE_ITEMS[1] as CatalogueItem;

function resetStore(): void {
  useCatalogueStore.setState({
    drawerOpen: false,
    selectedItemId: null,
    activeCategory: CATALOGUE_CATEGORIES[0] ?? "table",
    dragActive: false,
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
