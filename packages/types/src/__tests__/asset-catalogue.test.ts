import { describe, it, expect } from "vitest";
import {
  CANONICAL_ASSETS,
  getCanonicalAssetById,
  getCanonicalAssetBySlug,
} from "../asset-catalogue.js";
import { FURNITURE_CATEGORIES } from "../furniture.js";

describe("CANONICAL_ASSETS — shape integrity", () => {
  it("has at least 10 items (Trades Hall minimum)", () => {
    expect(CANONICAL_ASSETS.length).toBeGreaterThanOrEqual(10);
  });

  it("every item has a UUID-shaped id", () => {
    for (const a of CANONICAL_ASSETS) {
      expect(a.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it("IDs are unique", () => {
    const ids = CANONICAL_ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("slugs are unique", () => {
    const slugs = CANONICAL_ASSETS.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("slugs are kebab-case", () => {
    for (const a of CANONICAL_ASSETS) {
      expect(a.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("names are non-empty", () => {
    for (const a of CANONICAL_ASSETS) {
      expect(a.name.length).toBeGreaterThan(0);
    }
  });

  it("categories are valid FurnitureCategory values", () => {
    const valid = new Set(FURNITURE_CATEGORIES);
    for (const a of CANONICAL_ASSETS) {
      expect(valid.has(a.category), `${a.slug} has invalid category ${a.category}`).toBe(true);
    }
  });

  it("dimensions are positive", () => {
    for (const a of CANONICAL_ASSETS) {
      expect(a.widthM).toBeGreaterThan(0);
      expect(a.depthM).toBeGreaterThan(0);
      expect(a.heightM).toBeGreaterThan(0);
    }
  });

  it("collisionType is box or cylinder", () => {
    for (const a of CANONICAL_ASSETS) {
      expect(["box", "cylinder"]).toContain(a.collisionType);
    }
  });

  it("only tables have non-null tableShape", () => {
    for (const a of CANONICAL_ASSETS) {
      if (a.category === "table") {
        expect(a.tableShape).not.toBeNull();
      } else {
        expect(a.tableShape).toBeNull();
      }
    }
  });
});

describe("getCanonicalAssetById", () => {
  it("returns an asset by its UUID", () => {
    const first = CANONICAL_ASSETS[0];
    if (first === undefined) throw new Error("no assets");
    const found = getCanonicalAssetById(first.id);
    expect(found).toBe(first); // same reference
  });

  it("returns undefined for unknown UUID", () => {
    expect(getCanonicalAssetById("00000000-0000-0000-0000-000000000000")).toBeUndefined();
  });
});

describe("getCanonicalAssetBySlug", () => {
  it("returns the round table by slug", () => {
    const item = getCanonicalAssetBySlug("round-table-6ft");
    expect(item).toBeDefined();
    expect(item?.name).toBe("6ft Round Table");
  });

  it("returns undefined for unknown slug", () => {
    expect(getCanonicalAssetBySlug("does-not-exist")).toBeUndefined();
  });
});

describe("deterministic UUID stability", () => {
  // If anyone changes the UUIDs, this test breaks. The UUIDs are stable
  // because they're derived from uuid v5(slug, OMNITWIN_NAMESPACE) — but
  // since we hardcode them (no runtime hash), this test is the guard.
  it("round-table-6ft has the known deterministic UUID", () => {
    const item = getCanonicalAssetBySlug("round-table-6ft");
    expect(item?.id).toBe("a1ef4d89-7786-5878-bee1-87b3fac28200");
  });

  it("banquet-chair has the known deterministic UUID", () => {
    const item = getCanonicalAssetBySlug("banquet-chair");
    expect(item?.id).toBe("4dfcae64-b6e3-54f8-817f-af041edab935");
  });
});
