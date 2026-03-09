import { describe, it, expect } from "vitest";
import {
  SpaceIdSchema,
  SpaceSlugSchema,
  SpaceDimensionsSchema,
  FloorPlanPointSchema,
  FloorPlanOutlineSchema,
  SpaceSchema,
  CreateSpaceSchema,
  TRADES_HALL_ROOMS,
  TRADES_HALL_GRAND_HALL_DIMENSIONS,
  TRADES_HALL_ROBERT_ADAM_ROOM_DIMENSIONS,
  TRADES_HALL_RECEPTION_ROOM_DIMENSIONS,
  TRADES_HALL_SALOON_DIMENSIONS,
} from "../space.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const VALID_VENUE_UUID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const VALID_DATETIME = "2025-01-15T10:30:00.000Z";

const validTriangle = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 5, y: 8 },
];

const validRectangle = [
  { x: 0, y: 0 },
  { x: 21, y: 0 },
  { x: 21, y: 10.5 },
  { x: 0, y: 10.5 },
];

const validSpace = {
  id: VALID_UUID,
  venueId: VALID_VENUE_UUID,
  name: "Grand Hall",
  slug: "grand-hall",
  description: "The flagship hall.",
  dimensions: { width: 21, length: 10.5, height: 8 },
  sortOrder: 0,
  floorPlanOutline: validRectangle,
  meshUrl: "https://example.com/mesh.glb",
  thumbnailUrl: "https://example.com/thumb.jpg",
  createdAt: VALID_DATETIME,
  updatedAt: VALID_DATETIME,
};

const validCreateSpace = {
  venueId: VALID_VENUE_UUID,
  name: "Grand Hall",
  slug: "grand-hall",
  dimensions: { width: 21, length: 10.5, height: 8 },
  sortOrder: 0,
  floorPlanOutline: validRectangle,
  meshUrl: null,
  thumbnailUrl: null,
};

// ---------------------------------------------------------------------------
// SpaceIdSchema
// ---------------------------------------------------------------------------

describe("SpaceIdSchema", () => {
  it("accepts a valid UUID", () => {
    expect(SpaceIdSchema.safeParse(VALID_UUID).success).toBe(true);
  });

  it("rejects a non-UUID string", () => {
    expect(SpaceIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(SpaceIdSchema.safeParse("").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SpaceSlugSchema
// ---------------------------------------------------------------------------

describe("SpaceSlugSchema", () => {
  it("accepts a valid slug", () => {
    expect(SpaceSlugSchema.safeParse("grand-hall").success).toBe(true);
  });

  it("rejects uppercase", () => {
    expect(SpaceSlugSchema.safeParse("Grand-Hall").success).toBe(false);
  });

  it("rejects spaces", () => {
    expect(SpaceSlugSchema.safeParse("grand hall").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(SpaceSlugSchema.safeParse("").success).toBe(false);
  });

  it("rejects leading hyphen", () => {
    expect(SpaceSlugSchema.safeParse("-grand").success).toBe(false);
  });

  it("rejects trailing hyphen", () => {
    expect(SpaceSlugSchema.safeParse("grand-").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SpaceDimensionsSchema
// ---------------------------------------------------------------------------

describe("SpaceDimensionsSchema", () => {
  it("accepts valid dimensions", () => {
    const result = SpaceDimensionsSchema.safeParse({ width: 21, length: 10.5, height: 8 });
    expect(result.success).toBe(true);
  });

  it("accepts fractional dimensions", () => {
    const result = SpaceDimensionsSchema.safeParse({ width: 0.5, length: 0.1, height: 0.01 });
    expect(result.success).toBe(true);
  });

  it("rejects zero width", () => {
    const result = SpaceDimensionsSchema.safeParse({ width: 0, length: 10, height: 3 });
    expect(result.success).toBe(false);
  });

  it("rejects negative width", () => {
    const result = SpaceDimensionsSchema.safeParse({ width: -5, length: 10, height: 3 });
    expect(result.success).toBe(false);
  });

  it("rejects zero length", () => {
    const result = SpaceDimensionsSchema.safeParse({ width: 10, length: 0, height: 3 });
    expect(result.success).toBe(false);
  });

  it("rejects negative length", () => {
    const result = SpaceDimensionsSchema.safeParse({ width: 10, length: -5, height: 3 });
    expect(result.success).toBe(false);
  });

  it("rejects zero height", () => {
    const result = SpaceDimensionsSchema.safeParse({ width: 10, length: 10, height: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects negative height", () => {
    const result = SpaceDimensionsSchema.safeParse({ width: 10, length: 10, height: -2 });
    expect(result.success).toBe(false);
  });

  it("rejects width exceeding 200m", () => {
    const result = SpaceDimensionsSchema.safeParse({ width: 201, length: 10, height: 3 });
    expect(result.success).toBe(false);
  });

  it("accepts width of exactly 200m", () => {
    const result = SpaceDimensionsSchema.safeParse({ width: 200, length: 10, height: 3 });
    expect(result.success).toBe(true);
  });

  it("rejects height exceeding 50m", () => {
    const result = SpaceDimensionsSchema.safeParse({ width: 10, length: 10, height: 51 });
    expect(result.success).toBe(false);
  });

  it("accepts height of exactly 50m", () => {
    const result = SpaceDimensionsSchema.safeParse({ width: 10, length: 10, height: 50 });
    expect(result.success).toBe(true);
  });

  it("rejects NaN width", () => {
    const result = SpaceDimensionsSchema.safeParse({ width: NaN, length: 10, height: 3 });
    expect(result.success).toBe(false);
  });

  it("rejects missing width", () => {
    const result = SpaceDimensionsSchema.safeParse({ length: 10, height: 3 });
    expect(result.success).toBe(false);
  });

  it("rejects missing length", () => {
    const result = SpaceDimensionsSchema.safeParse({ width: 10, height: 3 });
    expect(result.success).toBe(false);
  });

  it("rejects missing height", () => {
    const result = SpaceDimensionsSchema.safeParse({ width: 10, length: 10 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FloorPlanPointSchema
// ---------------------------------------------------------------------------

describe("FloorPlanPointSchema", () => {
  it("accepts valid coordinates", () => {
    expect(FloorPlanPointSchema.safeParse({ x: 0, y: 0 }).success).toBe(true);
  });

  it("accepts negative coordinates", () => {
    expect(FloorPlanPointSchema.safeParse({ x: -10.5, y: -20.3 }).success).toBe(true);
  });

  it("rejects Infinity for x", () => {
    expect(FloorPlanPointSchema.safeParse({ x: Infinity, y: 0 }).success).toBe(false);
  });

  it("rejects -Infinity for y", () => {
    expect(FloorPlanPointSchema.safeParse({ x: 0, y: -Infinity }).success).toBe(false);
  });

  it("rejects NaN for x", () => {
    expect(FloorPlanPointSchema.safeParse({ x: NaN, y: 0 }).success).toBe(false);
  });

  it("rejects NaN for y", () => {
    expect(FloorPlanPointSchema.safeParse({ x: 0, y: NaN }).success).toBe(false);
  });

  it("rejects missing x", () => {
    expect(FloorPlanPointSchema.safeParse({ y: 0 }).success).toBe(false);
  });

  it("rejects missing y", () => {
    expect(FloorPlanPointSchema.safeParse({ x: 0 }).success).toBe(false);
  });

  it("rejects string coordinates", () => {
    expect(FloorPlanPointSchema.safeParse({ x: "10", y: "20" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FloorPlanOutlineSchema
// ---------------------------------------------------------------------------

describe("FloorPlanOutlineSchema", () => {
  it("accepts a triangle (3 points — minimum)", () => {
    expect(FloorPlanOutlineSchema.safeParse(validTriangle).success).toBe(true);
  });

  it("accepts a rectangle (4 points)", () => {
    expect(FloorPlanOutlineSchema.safeParse(validRectangle).success).toBe(true);
  });

  it("rejects 2 points (not a polygon)", () => {
    expect(FloorPlanOutlineSchema.safeParse([{ x: 0, y: 0 }, { x: 1, y: 1 }]).success).toBe(false);
  });

  it("rejects 1 point", () => {
    expect(FloorPlanOutlineSchema.safeParse([{ x: 0, y: 0 }]).success).toBe(false);
  });

  it("rejects empty array", () => {
    expect(FloorPlanOutlineSchema.safeParse([]).success).toBe(false);
  });

  it("rejects array with invalid point", () => {
    const result = FloorPlanOutlineSchema.safeParse([
      { x: 0, y: 0 },
      { x: Infinity, y: 0 },
      { x: 5, y: 8 },
    ]);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SpaceSchema — full entity
// ---------------------------------------------------------------------------

describe("SpaceSchema", () => {
  it("accepts a fully valid space", () => {
    const result = SpaceSchema.safeParse(validSpace);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Grand Hall");
      expect(result.data.dimensions.width).toBe(21);
    }
  });

  it("defaults description to empty string when omitted", () => {
    const { description: _, ...noDescription } = validSpace;
    const result = SpaceSchema.safeParse(noDescription);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("");
    }
  });

  it("trims whitespace from description", () => {
    const result = SpaceSchema.safeParse({ ...validSpace, description: "  hello  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("hello");
    }
  });

  it("accepts null meshUrl", () => {
    const result = SpaceSchema.safeParse({ ...validSpace, meshUrl: null });
    expect(result.success).toBe(true);
  });

  it("accepts null thumbnailUrl", () => {
    const result = SpaceSchema.safeParse({ ...validSpace, thumbnailUrl: null });
    expect(result.success).toBe(true);
  });

  it("trims whitespace from name", () => {
    const result = SpaceSchema.safeParse({ ...validSpace, name: "  Grand Hall  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Grand Hall");
    }
  });

  it("rejects whitespace-only name (empty after trim)", () => {
    const result = SpaceSchema.safeParse({ ...validSpace, name: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects missing id", () => {
    const { id: _, ...noId } = validSpace;
    expect(SpaceSchema.safeParse(noId).success).toBe(false);
  });

  it("rejects missing venueId", () => {
    const { venueId: _, ...noVenueId } = validSpace;
    expect(SpaceSchema.safeParse(noVenueId).success).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _, ...noName } = validSpace;
    expect(SpaceSchema.safeParse(noName).success).toBe(false);
  });

  it("rejects missing slug", () => {
    const { slug: _, ...noSlug } = validSpace;
    expect(SpaceSchema.safeParse(noSlug).success).toBe(false);
  });

  it("rejects missing dimensions", () => {
    const { dimensions: _, ...noDimensions } = validSpace;
    expect(SpaceSchema.safeParse(noDimensions).success).toBe(false);
  });

  it("rejects missing sortOrder", () => {
    const { sortOrder: _, ...noSortOrder } = validSpace;
    expect(SpaceSchema.safeParse(noSortOrder).success).toBe(false);
  });

  it("rejects missing floorPlanOutline", () => {
    const { floorPlanOutline: _, ...noOutline } = validSpace;
    expect(SpaceSchema.safeParse(noOutline).success).toBe(false);
  });

  it("rejects missing meshUrl (required but nullable)", () => {
    const { meshUrl: _, ...noMeshUrl } = validSpace;
    expect(SpaceSchema.safeParse(noMeshUrl).success).toBe(false);
  });

  it("rejects missing thumbnailUrl (required but nullable)", () => {
    const { thumbnailUrl: _, ...noThumbUrl } = validSpace;
    expect(SpaceSchema.safeParse(noThumbUrl).success).toBe(false);
  });

  it("rejects missing createdAt", () => {
    const { createdAt: _, ...noCreatedAt } = validSpace;
    expect(SpaceSchema.safeParse(noCreatedAt).success).toBe(false);
  });

  it("rejects missing updatedAt", () => {
    const { updatedAt: _, ...noUpdatedAt } = validSpace;
    expect(SpaceSchema.safeParse(noUpdatedAt).success).toBe(false);
  });

  it("rejects invalid UUID for id", () => {
    expect(SpaceSchema.safeParse({ ...validSpace, id: "bad" }).success).toBe(false);
  });

  it("rejects invalid UUID for venueId", () => {
    expect(SpaceSchema.safeParse({ ...validSpace, venueId: "bad" }).success).toBe(false);
  });

  it("rejects invalid URL for meshUrl", () => {
    expect(SpaceSchema.safeParse({ ...validSpace, meshUrl: "not-a-url" }).success).toBe(false);
  });

  it("rejects invalid URL for thumbnailUrl", () => {
    expect(SpaceSchema.safeParse({ ...validSpace, thumbnailUrl: "not-a-url" }).success).toBe(false);
  });

  it("rejects negative sortOrder", () => {
    expect(SpaceSchema.safeParse({ ...validSpace, sortOrder: -1 }).success).toBe(false);
  });

  it("rejects float sortOrder", () => {
    expect(SpaceSchema.safeParse({ ...validSpace, sortOrder: 1.5 }).success).toBe(false);
  });

  it("accepts sortOrder of 0", () => {
    expect(SpaceSchema.safeParse({ ...validSpace, sortOrder: 0 }).success).toBe(true);
  });

  it("rejects name exceeding 200 characters", () => {
    expect(SpaceSchema.safeParse({ ...validSpace, name: "A".repeat(201) }).success).toBe(false);
  });

  it("rejects description exceeding 2000 characters", () => {
    expect(SpaceSchema.safeParse({ ...validSpace, description: "A".repeat(2001) }).success).toBe(false);
  });

  it("accepts description of exactly 2000 characters", () => {
    expect(SpaceSchema.safeParse({ ...validSpace, description: "A".repeat(2000) }).success).toBe(true);
  });

  it("rejects invalid datetime for createdAt", () => {
    expect(SpaceSchema.safeParse({ ...validSpace, createdAt: "nope" }).success).toBe(false);
  });

  it("rejects floorPlanOutline with fewer than 3 points", () => {
    expect(SpaceSchema.safeParse({ ...validSpace, floorPlanOutline: [{ x: 0, y: 0 }] }).success).toBe(false);
  });

  it("accepts floorPlanOutline with exactly 3 points (triangle)", () => {
    expect(SpaceSchema.safeParse({ ...validSpace, floorPlanOutline: validTriangle }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CreateSpaceSchema — creation payload
// ---------------------------------------------------------------------------

describe("CreateSpaceSchema", () => {
  it("accepts a valid create space payload", () => {
    const result = CreateSpaceSchema.safeParse(validCreateSpace);
    expect(result.success).toBe(true);
  });

  it("defaults description to empty string when omitted", () => {
    const result = CreateSpaceSchema.safeParse(validCreateSpace);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("");
    }
  });

  it("rejects missing venueId", () => {
    const { venueId: _, ...noVenueId } = validCreateSpace;
    expect(CreateSpaceSchema.safeParse(noVenueId).success).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _, ...noName } = validCreateSpace;
    expect(CreateSpaceSchema.safeParse(noName).success).toBe(false);
  });

  it("rejects missing dimensions", () => {
    const { dimensions: _, ...noDims } = validCreateSpace;
    expect(CreateSpaceSchema.safeParse(noDims).success).toBe(false);
  });

  it("does not accept id field (strips extra keys)", () => {
    const result = CreateSpaceSchema.safeParse({ ...validCreateSpace, id: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("id" in result.data).toBe(false);
    }
  });

  it("does not accept createdAt field (strips extra keys)", () => {
    const result = CreateSpaceSchema.safeParse({ ...validCreateSpace, createdAt: VALID_DATETIME });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("createdAt" in result.data).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Trades Hall Room Constants — validate through schemas
// ---------------------------------------------------------------------------

describe("Trades Hall room constants", () => {
  it("has exactly 4 rooms", () => {
    expect(TRADES_HALL_ROOMS).toHaveLength(4);
  });

  it("Grand Hall dimensions validate", () => {
    expect(SpaceDimensionsSchema.safeParse(TRADES_HALL_GRAND_HALL_DIMENSIONS).success).toBe(true);
  });

  it("Grand Hall has correct dimensions", () => {
    expect(TRADES_HALL_GRAND_HALL_DIMENSIONS).toEqual({ width: 21, length: 10.5, height: 8 });
  });

  it("Robert Adam Room dimensions validate", () => {
    expect(SpaceDimensionsSchema.safeParse(TRADES_HALL_ROBERT_ADAM_ROOM_DIMENSIONS).success).toBe(true);
  });

  it("Robert Adam Room has correct dimensions", () => {
    expect(TRADES_HALL_ROBERT_ADAM_ROOM_DIMENSIONS).toEqual({ width: 12, length: 8, height: 4 });
  });

  it("Reception Room dimensions validate", () => {
    expect(SpaceDimensionsSchema.safeParse(TRADES_HALL_RECEPTION_ROOM_DIMENSIONS).success).toBe(true);
  });

  it("Reception Room has correct dimensions", () => {
    expect(TRADES_HALL_RECEPTION_ROOM_DIMENSIONS).toEqual({ width: 10, length: 7, height: 3.5 });
  });

  it("Saloon dimensions validate", () => {
    expect(SpaceDimensionsSchema.safeParse(TRADES_HALL_SALOON_DIMENSIONS).success).toBe(true);
  });

  it("Saloon has correct dimensions", () => {
    expect(TRADES_HALL_SALOON_DIMENSIONS).toEqual({ width: 9, length: 6, height: 3.5 });
  });

  it("each room has a valid floor plan outline (4 rectangle corners)", () => {
    for (const room of TRADES_HALL_ROOMS) {
      const result = FloorPlanOutlineSchema.safeParse(room.floorPlanOutline);
      expect(result.success).toBe(true);
    }
  });

  it("each room has a non-negative sortOrder", () => {
    for (const room of TRADES_HALL_ROOMS) {
      expect(room.sortOrder).toBeGreaterThanOrEqual(0);
    }
  });

  it("room sort orders are sequential from 0", () => {
    const orders = TRADES_HALL_ROOMS.map((r) => r.sortOrder);
    expect(orders).toEqual([0, 1, 2, 3]);
  });

  it("Grand Hall outline corners match dimensions", () => {
    const room = TRADES_HALL_ROOMS[0];
    expect(room.floorPlanOutline).toEqual([
      { x: 0, y: 0 },
      { x: 21, y: 0 },
      { x: 21, y: 10.5 },
      { x: 0, y: 10.5 },
    ]);
  });

  it("each room has a non-empty name and slug", () => {
    for (const room of TRADES_HALL_ROOMS) {
      expect(room.name.length).toBeGreaterThan(0);
      expect(room.slug.length).toBeGreaterThan(0);
    }
  });
});
