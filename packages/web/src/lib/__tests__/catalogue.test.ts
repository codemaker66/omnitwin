import { describe, it, expect } from "vitest";
import {
  CATALOGUE_ITEMS,
  CATALOGUE_CATEGORIES,
  getCatalogueItem,
  getCatalogueByCategory,
  categoryLabel,
} from "../catalogue.js";
import type { CatalogueItem } from "../catalogue.js";
import { FURNITURE_CATEGORIES } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// CATALOGUE_ITEMS
// ---------------------------------------------------------------------------

describe("CATALOGUE_ITEMS", () => {
  it("has at least one item", () => {
    expect(CATALOGUE_ITEMS.length).toBeGreaterThan(0);
  });

  it("all items have unique IDs", () => {
    const ids = CATALOGUE_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all items have positive dimensions", () => {
    for (const item of CATALOGUE_ITEMS) {
      expect(item.width).toBeGreaterThan(0);
      expect(item.height).toBeGreaterThan(0);
      expect(item.depth).toBeGreaterThan(0);
    }
  });

  it("all items have non-empty names", () => {
    for (const item of CATALOGUE_ITEMS) {
      expect(item.name.length).toBeGreaterThan(0);
    }
  });

  it("all items have valid categories", () => {
    const validCategories = new Set(FURNITURE_CATEGORIES);
    for (const item of CATALOGUE_ITEMS) {
      expect(validCategories.has(item.category)).toBe(true);
    }
  });

  it("all items have hex colour strings", () => {
    for (const item of CATALOGUE_ITEMS) {
      expect(item.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("only tables have non-null tableShape", () => {
    for (const item of CATALOGUE_ITEMS) {
      if (item.category === "table") {
        expect(item.tableShape).not.toBeNull();
      } else {
        expect(item.tableShape).toBeNull();
      }
    }
  });

  it("tables have tableShape of 'round' or 'rectangular'", () => {
    for (const item of CATALOGUE_ITEMS) {
      if (item.tableShape !== null) {
        expect(["round", "rectangular"]).toContain(item.tableShape);
      }
    }
  });

  it("contains the 6ft round table", () => {
    const item = getCatalogueItem("round-table-6ft");
    expect(item).toBeDefined();
    expect(item?.width).toBeCloseTo(1.83);
    expect(item?.tableShape).toBe("round");
  });

  it("contains the 6ft trestle table", () => {
    const item = getCatalogueItem("trestle-6ft");
    expect(item).toBeDefined();
    expect(item?.width).toBeCloseTo(1.83);
    expect(item?.tableShape).toBe("rectangular");
  });

  it("contains the 4ft trestle table", () => {
    const item = getCatalogueItem("trestle-4ft");
    expect(item).toBeDefined();
    expect(item?.width).toBeCloseTo(1.22);
    expect(item?.tableShape).toBe("rectangular");
  });

  it("contains the banquet chair", () => {
    const item = getCatalogueItem("banquet-chair");
    expect(item).toBeDefined();
    expect(item?.category).toBe("chair");
  });

  it("contains the platform", () => {
    const item = getCatalogueItem("platform");
    expect(item).toBeDefined();
    expect(item?.category).toBe("stage");
  });
});

// ---------------------------------------------------------------------------
// CATALOGUE_CATEGORIES
// ---------------------------------------------------------------------------

describe("CATALOGUE_CATEGORIES", () => {
  it("contains only categories that have items", () => {
    for (const cat of CATALOGUE_CATEGORIES) {
      const items = CATALOGUE_ITEMS.filter((i) => i.category === cat);
      expect(items.length).toBeGreaterThan(0);
    }
  });

  it("preserves insertion order from CATALOGUE_ITEMS", () => {
    const seen = new Set<string>();
    const expected: string[] = [];
    for (const item of CATALOGUE_ITEMS) {
      if (!seen.has(item.category)) {
        seen.add(item.category);
        expected.push(item.category);
      }
    }
    expect([...CATALOGUE_CATEGORIES]).toEqual(expected);
  });

  it("has no duplicates", () => {
    expect(new Set(CATALOGUE_CATEGORIES).size).toBe(CATALOGUE_CATEGORIES.length);
  });

  it("contains table, chair, and stage categories", () => {
    expect(CATALOGUE_CATEGORIES).toContain("table");
    expect(CATALOGUE_CATEGORIES).toContain("chair");
    expect(CATALOGUE_CATEGORIES).toContain("stage");
  });
});

// ---------------------------------------------------------------------------
// getCatalogueItem
// ---------------------------------------------------------------------------

describe("getCatalogueItem", () => {
  it("returns item for valid ID", () => {
    const first = CATALOGUE_ITEMS[0] as CatalogueItem;
    const result = getCatalogueItem(first.id);
    expect(result).toBeDefined();
    expect(result?.id).toBe(first.id);
    expect(result?.name).toBe(first.name);
  });

  it("returns undefined for unknown ID", () => {
    expect(getCatalogueItem("nonexistent-id")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(getCatalogueItem("")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getCatalogueByCategory
// ---------------------------------------------------------------------------

describe("getCatalogueByCategory", () => {
  it("returns all items in the table category", () => {
    const tables = getCatalogueByCategory("table");
    expect(tables.length).toBe(6);
    for (const item of tables) {
      expect(item.category).toBe("table");
    }
  });

  it("returns all items in the chair category", () => {
    const chairs = getCatalogueByCategory("chair");
    expect(chairs.length).toBe(1);
    for (const item of chairs) {
      expect(item.category).toBe("chair");
    }
  });

  it("returns empty array for category with no items", () => {
    const lighting = getCatalogueByCategory("lighting");
    expect(lighting).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// categoryLabel
// ---------------------------------------------------------------------------

describe("categoryLabel", () => {
  it("returns human-readable labels for all categories", () => {
    expect(categoryLabel("chair")).toBe("Chairs");
    expect(categoryLabel("table")).toBe("Tables");
    expect(categoryLabel("stage")).toBe("Staging");
    expect(categoryLabel("lectern")).toBe("Lecterns");
    expect(categoryLabel("barrier")).toBe("Barriers");
    expect(categoryLabel("decor")).toBe("Decor");
    expect(categoryLabel("av")).toBe("AV");
    expect(categoryLabel("lighting")).toBe("Lighting");
    expect(categoryLabel("other")).toBe("Other");
  });

  it("covers all FURNITURE_CATEGORIES", () => {
    for (const cat of FURNITURE_CATEGORIES) {
      const label = categoryLabel(cat);
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
