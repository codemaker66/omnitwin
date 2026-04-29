// ---------------------------------------------------------------------------
// PlacementGhost helpers — `isCloth` / `isPoseurTable` regression tests.
//
// Both helpers exist because catalogue IDs were migrated to deterministic
// UUIDs in commit d163801. The original PlacementGhost.tsx used literal
// slug-equality (`selectedItemId === "black-table-cloth"`) which silently
// failed against the new UUID values: the cloth never toggled `clothed`
// on the table, so `AnimatedTableCloth` never mounted; instead the cloth
// was placed as a 50×50×1cm decor item at floor level (small black sheet
// square — the user-reported symptom). The poseur-table chair-dialog
// skip (`selectedItemId.startsWith("poseur-table")`) had the same bug,
// triggering the chair count dialog on poseur tables that have no chairs.
//
// These tests lock the slug-via-UUID resolution so any future ID
// migration that breaks catalogue lookups will fail loudly here.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { isCloth, isPoseurTable } from "../components/PlacementGhost.js";
import { CATALOGUE_ITEMS } from "../lib/catalogue.js";

describe("PlacementGhost.isCloth", () => {
  it("recognises the cloth by its catalogue UUID", () => {
    const cloth = CATALOGUE_ITEMS.find((i) => i.slug === "black-table-cloth");
    expect(cloth, "black-table-cloth must exist in CATALOGUE_ITEMS").toBeDefined();
    if (cloth === undefined) return;
    expect(isCloth(cloth.id)).toBe(true);
  });

  it("recognises the cloth by its slug too (slug fallback path)", () => {
    expect(isCloth("black-table-cloth")).toBe(true);
  });

  it("returns false for null", () => {
    expect(isCloth(null)).toBe(false);
  });

  it("returns false for unknown ids", () => {
    expect(isCloth("not-a-real-id")).toBe(false);
  });

  it("returns false for non-cloth catalogue items", () => {
    for (const item of CATALOGUE_ITEMS) {
      if (item.slug === "black-table-cloth") continue;
      expect(isCloth(item.id), `${item.slug} (${item.id}) must not be a cloth`).toBe(false);
    }
  });
});

describe("PlacementGhost.isPoseurTable", () => {
  it("recognises the black poseur table by its UUID", () => {
    const black = CATALOGUE_ITEMS.find((i) => i.slug === "poseur-table-black");
    expect(black, "poseur-table-black must exist in CATALOGUE_ITEMS").toBeDefined();
    if (black === undefined) return;
    expect(isPoseurTable(black.id)).toBe(true);
  });

  it("recognises the white poseur table by its UUID", () => {
    const white = CATALOGUE_ITEMS.find((i) => i.slug === "poseur-table-white");
    expect(white, "poseur-table-white must exist in CATALOGUE_ITEMS").toBeDefined();
    if (white === undefined) return;
    expect(isPoseurTable(white.id)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isPoseurTable(null)).toBe(false);
  });

  it("returns false for unknown ids", () => {
    expect(isPoseurTable("not-a-real-id")).toBe(false);
  });

  it("returns false for non-poseur catalogue items", () => {
    for (const item of CATALOGUE_ITEMS) {
      if (item.slug.startsWith("poseur-table")) continue;
      expect(isPoseurTable(item.id), `${item.slug} (${item.id}) must not be a poseur table`).toBe(false);
    }
  });
});
