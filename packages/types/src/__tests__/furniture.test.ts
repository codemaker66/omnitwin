import { describe, it, expect } from "vitest";
import {
  FURNITURE_CATEGORIES,
  FurnitureCategorySchema,
  FurnitureDimensionsSchema,
  FurnitureItemSchema,
  CreateFurnitureItemSchema,
} from "../furniture.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const VALID_VENUE_UUID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const VALID_DATETIME = "2025-01-15T10:30:00.000Z";

const validDimensions = { width: 0.5, height: 0.9, depth: 0.5 };

const validFurnitureItem = {
  id: VALID_UUID,
  venueId: VALID_VENUE_UUID,
  name: "Chiavari Chair",
  category: "chair" as const,
  defaultDimensions: validDimensions,
  meshUrl: "https://example.com/chair.glb",
  thumbnailUrl: "https://example.com/chair-thumb.jpg",
  stackable: true,
  maxStack: 10,
  createdAt: VALID_DATETIME,
  updatedAt: VALID_DATETIME,
};

const validCreateFurnitureItem = {
  venueId: VALID_VENUE_UUID,
  name: "Chiavari Chair",
  category: "chair" as const,
  defaultDimensions: validDimensions,
  meshUrl: null,
  thumbnailUrl: null,
  stackable: true,
  maxStack: 10,
};

// ---------------------------------------------------------------------------
// FurnitureCategorySchema
// ---------------------------------------------------------------------------

describe("FurnitureCategorySchema", () => {
  it.each(FURNITURE_CATEGORIES)("accepts '%s'", (category) => {
    expect(FurnitureCategorySchema.safeParse(category).success).toBe(true);
  });

  it("has exactly 9 categories", () => {
    expect(FURNITURE_CATEGORIES).toHaveLength(9);
  });

  it("contains all expected categories", () => {
    expect(FURNITURE_CATEGORIES).toEqual([
      "chair",
      "table",
      "stage",
      "lectern",
      "barrier",
      "decor",
      "av",
      "lighting",
      "other",
    ]);
  });

  it("rejects 'Chair' (case sensitive)", () => {
    expect(FurnitureCategorySchema.safeParse("Chair").success).toBe(false);
  });

  it("rejects 'TABLE' (case sensitive)", () => {
    expect(FurnitureCategorySchema.safeParse("TABLE").success).toBe(false);
  });

  it("rejects 'furniture' (not a valid category)", () => {
    expect(FurnitureCategorySchema.safeParse("furniture").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(FurnitureCategorySchema.safeParse("").success).toBe(false);
  });

  it("rejects null", () => {
    expect(FurnitureCategorySchema.safeParse(null).success).toBe(false);
  });

  it("rejects a number", () => {
    expect(FurnitureCategorySchema.safeParse(0).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FurnitureDimensionsSchema
// ---------------------------------------------------------------------------

describe("FurnitureDimensionsSchema", () => {
  it("accepts valid dimensions", () => {
    expect(FurnitureDimensionsSchema.safeParse(validDimensions).success).toBe(true);
  });

  it("accepts small fractional dimensions", () => {
    expect(FurnitureDimensionsSchema.safeParse({ width: 0.01, height: 0.01, depth: 0.01 }).success).toBe(true);
  });

  it("accepts maximum dimensions (20m each)", () => {
    expect(FurnitureDimensionsSchema.safeParse({ width: 20, height: 20, depth: 20 }).success).toBe(true);
  });

  it("rejects zero width", () => {
    expect(FurnitureDimensionsSchema.safeParse({ width: 0, height: 1, depth: 1 }).success).toBe(false);
  });

  it("rejects negative width", () => {
    expect(FurnitureDimensionsSchema.safeParse({ width: -1, height: 1, depth: 1 }).success).toBe(false);
  });

  it("rejects zero height", () => {
    expect(FurnitureDimensionsSchema.safeParse({ width: 1, height: 0, depth: 1 }).success).toBe(false);
  });

  it("rejects negative height", () => {
    expect(FurnitureDimensionsSchema.safeParse({ width: 1, height: -0.5, depth: 1 }).success).toBe(false);
  });

  it("rejects zero depth", () => {
    expect(FurnitureDimensionsSchema.safeParse({ width: 1, height: 1, depth: 0 }).success).toBe(false);
  });

  it("rejects negative depth", () => {
    expect(FurnitureDimensionsSchema.safeParse({ width: 1, height: 1, depth: -2 }).success).toBe(false);
  });

  it("rejects width exceeding 20m", () => {
    expect(FurnitureDimensionsSchema.safeParse({ width: 21, height: 1, depth: 1 }).success).toBe(false);
  });

  it("rejects height exceeding 20m", () => {
    expect(FurnitureDimensionsSchema.safeParse({ width: 1, height: 21, depth: 1 }).success).toBe(false);
  });

  it("rejects depth exceeding 20m", () => {
    expect(FurnitureDimensionsSchema.safeParse({ width: 1, height: 1, depth: 21 }).success).toBe(false);
  });

  it("rejects NaN width", () => {
    expect(FurnitureDimensionsSchema.safeParse({ width: NaN, height: 1, depth: 1 }).success).toBe(false);
  });

  it("rejects missing width", () => {
    expect(FurnitureDimensionsSchema.safeParse({ height: 1, depth: 1 }).success).toBe(false);
  });

  it("rejects missing height", () => {
    expect(FurnitureDimensionsSchema.safeParse({ width: 1, depth: 1 }).success).toBe(false);
  });

  it("rejects missing depth", () => {
    expect(FurnitureDimensionsSchema.safeParse({ width: 1, height: 1 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FurnitureItemSchema — full entity
// ---------------------------------------------------------------------------

describe("FurnitureItemSchema", () => {
  it("accepts a fully valid furniture item", () => {
    const result = FurnitureItemSchema.safeParse(validFurnitureItem);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Chiavari Chair");
      expect(result.data.category).toBe("chair");
      expect(result.data.stackable).toBe(true);
      expect(result.data.maxStack).toBe(10);
    }
  });

  it("accepts null meshUrl", () => {
    expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, meshUrl: null }).success).toBe(true);
  });

  it("accepts null thumbnailUrl", () => {
    expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, thumbnailUrl: null }).success).toBe(true);
  });

  it("accepts non-stackable item", () => {
    const result = FurnitureItemSchema.safeParse({ ...validFurnitureItem, stackable: false, maxStack: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stackable).toBe(false);
    }
  });

  it("trims whitespace from name", () => {
    const result = FurnitureItemSchema.safeParse({ ...validFurnitureItem, name: "  Chiavari Chair  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Chiavari Chair");
    }
  });

  it("accepts all furniture categories", () => {
    for (const category of FURNITURE_CATEGORIES) {
      expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, category }).success).toBe(true);
    }
  });

  // --- Missing required fields ---

  it("rejects missing id", () => {
    const { id: _, ...noId } = validFurnitureItem;
    expect(FurnitureItemSchema.safeParse(noId).success).toBe(false);
  });

  it("rejects missing venueId", () => {
    const { venueId: _, ...noVenueId } = validFurnitureItem;
    expect(FurnitureItemSchema.safeParse(noVenueId).success).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _, ...noName } = validFurnitureItem;
    expect(FurnitureItemSchema.safeParse(noName).success).toBe(false);
  });

  it("rejects missing category", () => {
    const { category: _, ...noCategory } = validFurnitureItem;
    expect(FurnitureItemSchema.safeParse(noCategory).success).toBe(false);
  });

  it("rejects missing defaultDimensions", () => {
    const { defaultDimensions: _, ...noDims } = validFurnitureItem;
    expect(FurnitureItemSchema.safeParse(noDims).success).toBe(false);
  });

  it("rejects missing meshUrl (required but nullable)", () => {
    const { meshUrl: _, ...noMesh } = validFurnitureItem;
    expect(FurnitureItemSchema.safeParse(noMesh).success).toBe(false);
  });

  it("rejects missing thumbnailUrl (required but nullable)", () => {
    const { thumbnailUrl: _, ...noThumb } = validFurnitureItem;
    expect(FurnitureItemSchema.safeParse(noThumb).success).toBe(false);
  });

  it("rejects missing stackable", () => {
    const { stackable: _, ...noStackable } = validFurnitureItem;
    expect(FurnitureItemSchema.safeParse(noStackable).success).toBe(false);
  });

  it("rejects missing maxStack", () => {
    const { maxStack: _, ...noMaxStack } = validFurnitureItem;
    expect(FurnitureItemSchema.safeParse(noMaxStack).success).toBe(false);
  });

  it("rejects missing createdAt", () => {
    const { createdAt: _, ...noCreatedAt } = validFurnitureItem;
    expect(FurnitureItemSchema.safeParse(noCreatedAt).success).toBe(false);
  });

  it("rejects missing updatedAt", () => {
    const { updatedAt: _, ...noUpdatedAt } = validFurnitureItem;
    expect(FurnitureItemSchema.safeParse(noUpdatedAt).success).toBe(false);
  });

  // --- Invalid field values ---

  it("rejects invalid UUID for id", () => {
    expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, id: "bad" }).success).toBe(false);
  });

  it("rejects invalid UUID for venueId", () => {
    expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, venueId: "bad" }).success).toBe(false);
  });

  it("rejects empty string name", () => {
    expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, name: "" }).success).toBe(false);
  });

  it("rejects whitespace-only name", () => {
    expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, name: "   " }).success).toBe(false);
  });

  it("rejects name exceeding 200 characters", () => {
    expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, name: "A".repeat(201) }).success).toBe(false);
  });

  it("accepts name of exactly 200 characters", () => {
    expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, name: "A".repeat(200) }).success).toBe(true);
  });

  it("rejects invalid category", () => {
    expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, category: "sofa" }).success).toBe(false);
  });

  it("rejects invalid URL for meshUrl", () => {
    expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, meshUrl: "not-a-url" }).success).toBe(false);
  });

  it("rejects invalid URL for thumbnailUrl", () => {
    expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, thumbnailUrl: "not-a-url" }).success).toBe(false);
  });

  it("rejects invalid datetime for createdAt", () => {
    expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, createdAt: "nope" }).success).toBe(false);
  });

  it("rejects string for stackable (must be boolean)", () => {
    expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, stackable: "true" }).success).toBe(false);
  });

  it("rejects number for stackable (must be boolean)", () => {
    expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, stackable: 1 }).success).toBe(false);
  });

  // --- maxStack edge cases ---

  it("accepts maxStack of 1 (minimum)", () => {
    expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, maxStack: 1 }).success).toBe(true);
  });

  it("accepts maxStack of 100 (maximum)", () => {
    expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, maxStack: 100 }).success).toBe(true);
  });

  it("rejects maxStack of 0", () => {
    expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, maxStack: 0 }).success).toBe(false);
  });

  it("rejects negative maxStack", () => {
    expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, maxStack: -1 }).success).toBe(false);
  });

  it("rejects maxStack exceeding 100", () => {
    expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, maxStack: 101 }).success).toBe(false);
  });

  it("rejects float maxStack", () => {
    expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, maxStack: 5.5 }).success).toBe(false);
  });

  it("rejects NaN maxStack", () => {
    expect(FurnitureItemSchema.safeParse({ ...validFurnitureItem, maxStack: NaN }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CreateFurnitureItemSchema — creation payload
// ---------------------------------------------------------------------------

describe("CreateFurnitureItemSchema", () => {
  it("accepts a valid create furniture item payload", () => {
    const result = CreateFurnitureItemSchema.safeParse(validCreateFurnitureItem);
    expect(result.success).toBe(true);
  });

  it("rejects missing venueId", () => {
    const { venueId: _, ...noVenueId } = validCreateFurnitureItem;
    expect(CreateFurnitureItemSchema.safeParse(noVenueId).success).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _, ...noName } = validCreateFurnitureItem;
    expect(CreateFurnitureItemSchema.safeParse(noName).success).toBe(false);
  });

  it("rejects missing category", () => {
    const { category: _, ...noCategory } = validCreateFurnitureItem;
    expect(CreateFurnitureItemSchema.safeParse(noCategory).success).toBe(false);
  });

  it("rejects missing defaultDimensions", () => {
    const { defaultDimensions: _, ...noDims } = validCreateFurnitureItem;
    expect(CreateFurnitureItemSchema.safeParse(noDims).success).toBe(false);
  });

  it("rejects missing meshUrl (required but nullable)", () => {
    const { meshUrl: _, ...noMesh } = validCreateFurnitureItem;
    expect(CreateFurnitureItemSchema.safeParse(noMesh).success).toBe(false);
  });

  it("rejects missing thumbnailUrl (required but nullable)", () => {
    const { thumbnailUrl: _, ...noThumb } = validCreateFurnitureItem;
    expect(CreateFurnitureItemSchema.safeParse(noThumb).success).toBe(false);
  });

  it("rejects missing stackable", () => {
    const { stackable: _, ...noStackable } = validCreateFurnitureItem;
    expect(CreateFurnitureItemSchema.safeParse(noStackable).success).toBe(false);
  });

  it("rejects missing maxStack", () => {
    const { maxStack: _, ...noMaxStack } = validCreateFurnitureItem;
    expect(CreateFurnitureItemSchema.safeParse(noMaxStack).success).toBe(false);
  });

  it("does not accept id field (strips extra keys)", () => {
    const result = CreateFurnitureItemSchema.safeParse({ ...validCreateFurnitureItem, id: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("id" in result.data).toBe(false);
    }
  });

  it("does not accept createdAt field (strips extra keys)", () => {
    const result = CreateFurnitureItemSchema.safeParse({
      ...validCreateFurnitureItem,
      createdAt: VALID_DATETIME,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("createdAt" in result.data).toBe(false);
    }
  });

  it("rejects zero maxStack", () => {
    expect(CreateFurnitureItemSchema.safeParse({ ...validCreateFurnitureItem, maxStack: 0 }).success).toBe(false);
  });

  it("rejects float maxStack", () => {
    expect(CreateFurnitureItemSchema.safeParse({ ...validCreateFurnitureItem, maxStack: 3.7 }).success).toBe(false);
  });

  it("rejects invalid dimensions (negative width)", () => {
    expect(
      CreateFurnitureItemSchema.safeParse({
        ...validCreateFurnitureItem,
        defaultDimensions: { width: -1, height: 1, depth: 1 },
      }).success,
    ).toBe(false);
  });
});
