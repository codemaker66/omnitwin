import { describe, it, expect } from "vitest";
import {
  CANONICAL_ASSETS,
  assetDisplayName,
  getCanonicalAssetById,
  getCanonicalAssetBySlug,
  seatBaseSlug,
  seatsFor,
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
  it("adds the identified Turini chair without replacing the existing banquet chair", () => {
    const item = getCanonicalAssetBySlug("burgess-turini-18-3");
    expect(item).toMatchObject({
      id: "7f1fb7a2-5210-57b1-9108-11255c059520", category: "chair",
      widthM: 0.42, depthM: 0.58, heightM: 0.88, seatCount: 1,
      collisionType: "box", maxCount: null,
      meshUrl: "/models/furniture/burgess-turini-18-3/v1/chair.glb",
      thumbnailUrl: "/models/furniture/burgess-turini-18-3/v1/preview.webp",
    });
    expect(item?.id).not.toBe(getCanonicalAssetBySlug("banquet-chair")?.id);
  });

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

describe("the names a guest reads (assetDisplayName)", () => {
  const turini = getCanonicalAssetBySlug("burgess-turini-18-3");

  it("reads the Turini by the planner's plain name, while its stock identity stays the maker's", () => {
    expect(turini?.name).toBe("Burgess Turini 18/3");
    expect(assetDisplayName(turini?.id ?? "", "Burgess Turini 18/3")).toBe("Velvet Banquet Chair");
  });

  it("keeps the stored name for items without a plain name and for items outside the catalogue", () => {
    const round = getCanonicalAssetBySlug("round-table-6ft");
    expect(assetDisplayName(round?.id ?? "", "6ft Round Table")).toBe("6ft Round Table");
    expect(assetDisplayName("00000000-0000-4000-8000-000000000000", "A venue's own lectern")).toBe("A venue's own lectern");
  });

  it("never gives two different items the same name a guest reads", () => {
    const shown = CANONICAL_ASSETS.map((asset) => asset.plainName ?? asset.name);
    expect(new Set(shown).size).toBe(shown.length);
    for (const asset of CANONICAL_ASSETS) {
      if (asset.plainName !== undefined) {
        // A plain name replaces a maker's reference; it is never the same words.
        expect(asset.plainName).not.toBe(asset.name);
        expect(asset.plainName).not.toMatch(/\d+\/\d+/u);
      }
    }
  });
});

describe("seatsFor — seat truth", () => {
  it("sets the 6 ft round for ten, eight to twelve", () => {
    expect(seatsFor({ slug: "round-table-6ft" })).toEqual({ default: 10, min: 8, max: 12 });
  });

  it("gives every cloth and finish variant its base piece's seats", () => {
    for (const asset of CANONICAL_ASSETS) {
      const base = seatBaseSlug(asset.slug);
      if (base === asset.slug) continue;
      expect(getCanonicalAssetBySlug(base)).toBeDefined();
      expect(seatsFor(asset)).toEqual(seatsFor({ slug: base }));
    }
  });

  it("seats nobody at chairs, poseurs, service tables, staging or AV", () => {
    for (const slug of ["burgess-turini-18-3", "poseur-table-white", "cake-cutting-table", "ceremony-table", "dancefloor-panel", "lectern"]) {
      expect(seatsFor({ slug })).toBeNull();
    }
  });

  it("only seats tables, and every range holds its default", () => {
    for (const asset of CANONICAL_ASSETS) {
      const seats = seatsFor(asset);
      if (seats === null) continue;
      expect(asset.category).toBe("table");
      expect(seats.min).toBeGreaterThanOrEqual(1);
      expect(seats.min).toBeLessThanOrEqual(seats.default);
      expect(seats.default).toBeLessThanOrEqual(seats.max);
    }
  });
});
