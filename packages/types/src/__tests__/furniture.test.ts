import { describe, it, expect } from "vitest";
import {
  FURNITURE_CATEGORIES,
  FurnitureCategorySchema,
  FurnitureDimensionsSchema,
  AssetDefinitionSchema,
  CreateAssetDefinitionSchema,
} from "../furniture.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const VALID_DATETIME = "2025-01-15T10:30:00.000Z";

const validDimensions = { width: 0.5, height: 0.9, depth: 0.5 };

// New AssetDefinition shape: no venueId, no stackable, no maxStack.
// Has widthM/depthM/heightM as strings, seatCount (nullable), collisionType.
// No updatedAt (only createdAt).
const validAssetDefinition = {
  id: VALID_UUID,
  name: "Chiavari Chair",
  category: "chair" as const,
  thumbnailUrl: "https://example.com/chair-thumb.jpg",
  meshUrl: "https://example.com/chair.glb",
  widthM: "0.450",
  depthM: "0.450",
  heightM: "0.900",
  seatCount: 1,
  collisionType: "box",
  createdAt: VALID_DATETIME,
};

const validCreateAssetDefinition = {
  name: "Chiavari Chair",
  category: "chair" as const,
  widthM: 0.45,
  depthM: 0.45,
  heightM: 0.9,
  seatCount: 1,
  collisionType: "box",
  meshUrl: null,
  thumbnailUrl: null,
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
// FurnitureDimensionsSchema — client-side convenience type (numbers)
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
// AssetDefinitionSchema — full entity (new canonical name)
// ---------------------------------------------------------------------------

describe("AssetDefinitionSchema", () => {
  it("accepts a fully valid asset definition", () => {
    const result = AssetDefinitionSchema.safeParse(validAssetDefinition);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Chiavari Chair");
      expect(result.data.category).toBe("chair");
      expect(result.data.collisionType).toBe("box");
    }
  });

  it("accepts null meshUrl", () => {
    expect(AssetDefinitionSchema.safeParse({ ...validAssetDefinition, meshUrl: null }).success).toBe(true);
  });

  it("accepts null thumbnailUrl", () => {
    expect(AssetDefinitionSchema.safeParse({ ...validAssetDefinition, thumbnailUrl: null }).success).toBe(true);
  });

  it("accepts null seatCount (non-seating assets)", () => {
    const result = AssetDefinitionSchema.safeParse({ ...validAssetDefinition, seatCount: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.seatCount).toBeNull();
    }
  });

  it("trims whitespace from name", () => {
    const result = AssetDefinitionSchema.safeParse({ ...validAssetDefinition, name: "  Chiavari Chair  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Chiavari Chair");
    }
  });

  it("accepts all furniture categories", () => {
    for (const category of FURNITURE_CATEGORIES) {
      expect(AssetDefinitionSchema.safeParse({ ...validAssetDefinition, category }).success).toBe(true);
    }
  });

  // --- Missing required fields ---

  it("rejects missing id", () => {
    const { id: _, ...noId } = validAssetDefinition;
    expect(AssetDefinitionSchema.safeParse(noId).success).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _, ...noName } = validAssetDefinition;
    expect(AssetDefinitionSchema.safeParse(noName).success).toBe(false);
  });

  it("rejects missing category", () => {
    const { category: _, ...noCategory } = validAssetDefinition;
    expect(AssetDefinitionSchema.safeParse(noCategory).success).toBe(false);
  });

  it("rejects missing widthM", () => {
    const { widthM: _, ...noWidth } = validAssetDefinition;
    expect(AssetDefinitionSchema.safeParse(noWidth).success).toBe(false);
  });

  it("rejects missing depthM", () => {
    const { depthM: _, ...noDepth } = validAssetDefinition;
    expect(AssetDefinitionSchema.safeParse(noDepth).success).toBe(false);
  });

  it("rejects missing heightM", () => {
    const { heightM: _, ...noHeight } = validAssetDefinition;
    expect(AssetDefinitionSchema.safeParse(noHeight).success).toBe(false);
  });

  it("rejects missing collisionType", () => {
    const { collisionType: _, ...noCollision } = validAssetDefinition;
    expect(AssetDefinitionSchema.safeParse(noCollision).success).toBe(false);
  });

  it("rejects missing createdAt", () => {
    const { createdAt: _, ...noCreatedAt } = validAssetDefinition;
    expect(AssetDefinitionSchema.safeParse(noCreatedAt).success).toBe(false);
  });

  // --- Invalid field values ---

  it("rejects invalid UUID for id", () => {
    expect(AssetDefinitionSchema.safeParse({ ...validAssetDefinition, id: "bad" }).success).toBe(false);
  });

  it("rejects empty string name", () => {
    expect(AssetDefinitionSchema.safeParse({ ...validAssetDefinition, name: "" }).success).toBe(false);
  });

  it("rejects whitespace-only name", () => {
    expect(AssetDefinitionSchema.safeParse({ ...validAssetDefinition, name: "   " }).success).toBe(false);
  });

  it("rejects name exceeding 200 characters", () => {
    expect(AssetDefinitionSchema.safeParse({ ...validAssetDefinition, name: "A".repeat(201) }).success).toBe(false);
  });

  it("accepts name of exactly 200 characters", () => {
    expect(AssetDefinitionSchema.safeParse({ ...validAssetDefinition, name: "A".repeat(200) }).success).toBe(true);
  });

  it("rejects invalid category", () => {
    expect(AssetDefinitionSchema.safeParse({ ...validAssetDefinition, category: "sofa" }).success).toBe(false);
  });

  it("rejects invalid URL for meshUrl", () => {
    expect(AssetDefinitionSchema.safeParse({ ...validAssetDefinition, meshUrl: "not-a-url" }).success).toBe(false);
  });

  it("rejects invalid URL for thumbnailUrl", () => {
    expect(AssetDefinitionSchema.safeParse({ ...validAssetDefinition, thumbnailUrl: "not-a-url" }).success).toBe(false);
  });

  it("rejects invalid datetime for createdAt", () => {
    expect(AssetDefinitionSchema.safeParse({ ...validAssetDefinition, createdAt: "nope" }).success).toBe(false);
  });

  it("rejects zero seatCount (must be positive integer or null)", () => {
    expect(AssetDefinitionSchema.safeParse({ ...validAssetDefinition, seatCount: 0 }).success).toBe(false);
  });

  it("rejects negative seatCount", () => {
    expect(AssetDefinitionSchema.safeParse({ ...validAssetDefinition, seatCount: -1 }).success).toBe(false);
  });

  it("rejects float seatCount", () => {
    expect(AssetDefinitionSchema.safeParse({ ...validAssetDefinition, seatCount: 1.5 }).success).toBe(false);
  });

  it("accepts collisionType of exactly 20 characters", () => {
    expect(
      AssetDefinitionSchema.safeParse({ ...validAssetDefinition, collisionType: "a".repeat(20) }).success,
    ).toBe(true);
  });

  it("rejects collisionType exceeding 20 characters", () => {
    expect(
      AssetDefinitionSchema.safeParse({ ...validAssetDefinition, collisionType: "a".repeat(21) }).success,
    ).toBe(false);
  });
});


// ---------------------------------------------------------------------------
// CreateAssetDefinitionSchema — creation payload (numeric dimensions)
// ---------------------------------------------------------------------------

describe("CreateAssetDefinitionSchema", () => {
  it("accepts a valid create asset definition payload", () => {
    const result = CreateAssetDefinitionSchema.safeParse(validCreateAssetDefinition);
    expect(result.success).toBe(true);
  });

  it("defaults collisionType to 'box' when omitted", () => {
    const { collisionType: _, ...noCollision } = validCreateAssetDefinition;
    const result = CreateAssetDefinitionSchema.safeParse(noCollision);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.collisionType).toBe("box");
    }
  });

  it("rejects missing name", () => {
    const { name: _, ...noName } = validCreateAssetDefinition;
    expect(CreateAssetDefinitionSchema.safeParse(noName).success).toBe(false);
  });

  it("rejects missing category", () => {
    const { category: _, ...noCategory } = validCreateAssetDefinition;
    expect(CreateAssetDefinitionSchema.safeParse(noCategory).success).toBe(false);
  });

  it("rejects missing widthM", () => {
    const { widthM: _, ...noWidth } = validCreateAssetDefinition;
    expect(CreateAssetDefinitionSchema.safeParse(noWidth).success).toBe(false);
  });

  it("rejects missing depthM", () => {
    const { depthM: _, ...noDepth } = validCreateAssetDefinition;
    expect(CreateAssetDefinitionSchema.safeParse(noDepth).success).toBe(false);
  });

  it("rejects missing heightM", () => {
    const { heightM: _, ...noHeight } = validCreateAssetDefinition;
    expect(CreateAssetDefinitionSchema.safeParse(noHeight).success).toBe(false);
  });

  it("does not accept id field (strips extra keys)", () => {
    const result = CreateAssetDefinitionSchema.safeParse({ ...validCreateAssetDefinition, id: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("id" in result.data).toBe(false);
    }
  });

  it("does not accept createdAt field (strips extra keys)", () => {
    const result = CreateAssetDefinitionSchema.safeParse({
      ...validCreateAssetDefinition,
      createdAt: VALID_DATETIME,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("createdAt" in result.data).toBe(false);
    }
  });

  it("rejects zero widthM", () => {
    expect(CreateAssetDefinitionSchema.safeParse({ ...validCreateAssetDefinition, widthM: 0 }).success).toBe(false);
  });

  it("rejects float seatCount", () => {
    expect(
      CreateAssetDefinitionSchema.safeParse({ ...validCreateAssetDefinition, seatCount: 3.7 }).success,
    ).toBe(false);
  });

  it("rejects invalid dimensions (negative widthM)", () => {
    expect(
      CreateAssetDefinitionSchema.safeParse({
        ...validCreateAssetDefinition,
        widthM: -1,
      }).success,
    ).toBe(false);
  });
});

// FurnitureItemSchema and CreateFurnitureItemSchema legacy aliases deleted.
