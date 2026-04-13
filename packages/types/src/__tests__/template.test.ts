import { describe, it, expect } from "vitest";
import { LAYOUT_STYLES } from "../configuration.js";
import {
  LayoutTemplateIdSchema,
  LayoutTemplateSchema,
  CreateLayoutTemplateSchema,
} from "../template.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const VALID_VENUE_UUID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const VALID_SPACE_UUID = "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f";
const VALID_CONFIG_UUID = "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f80";
const VALID_ASSET_UUID = "e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8091";
const VALID_DATETIME = "2025-01-15T10:30:00.000Z";

// Flat DB shape: configurationId, assetDefinitionId, positionX/Y/Z, rotationX/Y/Z, scale, sortOrder, metadata
const validPlacedObject = {
  id: VALID_UUID,
  configurationId: VALID_CONFIG_UUID,
  assetDefinitionId: VALID_ASSET_UUID,
  positionX: "0.000",
  positionY: "0.000",
  positionZ: "0.000",
  rotationX: "0.000",
  rotationY: "0.000",
  rotationZ: "0.000",
  scale: "1.000",
  sortOrder: 0,
  metadata: null,
};

const validTemplate = {
  id: VALID_UUID,
  venueId: VALID_VENUE_UUID,
  spaceId: VALID_SPACE_UUID,
  name: "Wedding Ceremony Standard",
  layoutStyle: "ceremony" as const,
  description: "Traditional ceremony layout with central aisle.",
  placedObjects: [validPlacedObject],
  guestCapacity: 120,
  thumbnailUrl: "https://example.com/thumb.jpg",
  createdAt: VALID_DATETIME,
  updatedAt: VALID_DATETIME,
};

const validCreateTemplate = {
  venueId: VALID_VENUE_UUID,
  spaceId: VALID_SPACE_UUID,
  name: "Wedding Ceremony Standard",
  layoutStyle: "ceremony" as const,
  placedObjects: [validPlacedObject],
  guestCapacity: 120,
  thumbnailUrl: null,
};

// ---------------------------------------------------------------------------
// LayoutTemplateIdSchema
// ---------------------------------------------------------------------------

describe("LayoutTemplateIdSchema", () => {
  it("accepts a valid UUID", () => {
    expect(LayoutTemplateIdSchema.safeParse(VALID_UUID).success).toBe(true);
  });

  it("rejects a non-UUID string", () => {
    expect(LayoutTemplateIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(LayoutTemplateIdSchema.safeParse("").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LayoutTemplateSchema — full entity
// ---------------------------------------------------------------------------

describe("LayoutTemplateSchema", () => {
  it("accepts a fully valid template", () => {
    const result = LayoutTemplateSchema.safeParse(validTemplate);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Wedding Ceremony Standard");
      expect(result.data.guestCapacity).toBe(120);
    }
  });

  it("defaults description to empty string when omitted", () => {
    const { description: _, ...noDescription } = validTemplate;
    const result = LayoutTemplateSchema.safeParse(noDescription);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("");
    }
  });

  it("trims whitespace from name", () => {
    const result = LayoutTemplateSchema.safeParse({ ...validTemplate, name: "  Wedding  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Wedding");
    }
  });

  it("trims whitespace from description", () => {
    const result = LayoutTemplateSchema.safeParse({ ...validTemplate, description: "  A layout.  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("A layout.");
    }
  });

  it("accepts null thumbnailUrl", () => {
    const result = LayoutTemplateSchema.safeParse({ ...validTemplate, thumbnailUrl: null });
    expect(result.success).toBe(true);
  });

  it("accepts empty placedObjects array", () => {
    const result = LayoutTemplateSchema.safeParse({ ...validTemplate, placedObjects: [] });
    expect(result.success).toBe(true);
  });

  it("accepts all layout styles", () => {
    for (const style of LAYOUT_STYLES) {
      const result = LayoutTemplateSchema.safeParse({ ...validTemplate, layoutStyle: style });
      expect(result.success).toBe(true);
    }
  });

  // --- Missing required fields ---

  it("rejects missing id", () => {
    const { id: _, ...noId } = validTemplate;
    expect(LayoutTemplateSchema.safeParse(noId).success).toBe(false);
  });

  it("rejects missing venueId", () => {
    const { venueId: _, ...noVenueId } = validTemplate;
    expect(LayoutTemplateSchema.safeParse(noVenueId).success).toBe(false);
  });

  it("rejects missing spaceId", () => {
    const { spaceId: _, ...noSpaceId } = validTemplate;
    expect(LayoutTemplateSchema.safeParse(noSpaceId).success).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _, ...noName } = validTemplate;
    expect(LayoutTemplateSchema.safeParse(noName).success).toBe(false);
  });

  it("rejects missing layoutStyle", () => {
    const { layoutStyle: _, ...noLayout } = validTemplate;
    expect(LayoutTemplateSchema.safeParse(noLayout).success).toBe(false);
  });

  it("rejects missing placedObjects", () => {
    const { placedObjects: _, ...noObjects } = validTemplate;
    expect(LayoutTemplateSchema.safeParse(noObjects).success).toBe(false);
  });

  it("rejects missing guestCapacity", () => {
    const { guestCapacity: _, ...noCapacity } = validTemplate;
    expect(LayoutTemplateSchema.safeParse(noCapacity).success).toBe(false);
  });

  it("rejects missing thumbnailUrl (required but nullable)", () => {
    const { thumbnailUrl: _, ...noThumb } = validTemplate;
    expect(LayoutTemplateSchema.safeParse(noThumb).success).toBe(false);
  });

  it("rejects missing createdAt", () => {
    const { createdAt: _, ...noCreatedAt } = validTemplate;
    expect(LayoutTemplateSchema.safeParse(noCreatedAt).success).toBe(false);
  });

  it("rejects missing updatedAt", () => {
    const { updatedAt: _, ...noUpdatedAt } = validTemplate;
    expect(LayoutTemplateSchema.safeParse(noUpdatedAt).success).toBe(false);
  });

  // --- Invalid field values ---

  it("rejects invalid UUID for id", () => {
    expect(LayoutTemplateSchema.safeParse({ ...validTemplate, id: "bad" }).success).toBe(false);
  });

  it("rejects invalid UUID for venueId", () => {
    expect(LayoutTemplateSchema.safeParse({ ...validTemplate, venueId: "bad" }).success).toBe(false);
  });

  it("rejects invalid UUID for spaceId", () => {
    expect(LayoutTemplateSchema.safeParse({ ...validTemplate, spaceId: "bad" }).success).toBe(false);
  });

  it("rejects invalid layoutStyle", () => {
    expect(LayoutTemplateSchema.safeParse({ ...validTemplate, layoutStyle: "wedding" }).success).toBe(false);
  });

  it("rejects invalid URL for thumbnailUrl", () => {
    expect(LayoutTemplateSchema.safeParse({ ...validTemplate, thumbnailUrl: "not-a-url" }).success).toBe(false);
  });

  it("rejects invalid datetime for createdAt", () => {
    expect(LayoutTemplateSchema.safeParse({ ...validTemplate, createdAt: "nope" }).success).toBe(false);
  });

  it("rejects whitespace-only name", () => {
    expect(LayoutTemplateSchema.safeParse({ ...validTemplate, name: "   " }).success).toBe(false);
  });

  it("rejects empty string name", () => {
    expect(LayoutTemplateSchema.safeParse({ ...validTemplate, name: "" }).success).toBe(false);
  });

  it("rejects name exceeding 200 characters", () => {
    expect(LayoutTemplateSchema.safeParse({ ...validTemplate, name: "A".repeat(201) }).success).toBe(false);
  });

  it("rejects description exceeding 2000 characters", () => {
    expect(LayoutTemplateSchema.safeParse({ ...validTemplate, description: "A".repeat(2001) }).success).toBe(false);
  });

  // --- Guest capacity edge cases ---

  it("rejects zero guest capacity", () => {
    expect(LayoutTemplateSchema.safeParse({ ...validTemplate, guestCapacity: 0 }).success).toBe(false);
  });

  it("rejects negative guest capacity", () => {
    expect(LayoutTemplateSchema.safeParse({ ...validTemplate, guestCapacity: -5 }).success).toBe(false);
  });

  it("rejects float guest capacity", () => {
    expect(LayoutTemplateSchema.safeParse({ ...validTemplate, guestCapacity: 10.5 }).success).toBe(false);
  });

  it("accepts guest capacity of 1 (minimum)", () => {
    expect(LayoutTemplateSchema.safeParse({ ...validTemplate, guestCapacity: 1 }).success).toBe(true);
  });

  it("accepts guest capacity of 10000 (maximum)", () => {
    expect(LayoutTemplateSchema.safeParse({ ...validTemplate, guestCapacity: 10000 }).success).toBe(true);
  });

  it("rejects guest capacity exceeding 10000", () => {
    expect(LayoutTemplateSchema.safeParse({ ...validTemplate, guestCapacity: 10001 }).success).toBe(false);
  });

  it("rejects NaN guest capacity", () => {
    expect(LayoutTemplateSchema.safeParse({ ...validTemplate, guestCapacity: NaN }).success).toBe(false);
  });

  // --- placedObjects validation ---

  it("rejects placedObjects with an invalid item", () => {
    const result = LayoutTemplateSchema.safeParse({
      ...validTemplate,
      placedObjects: [{ id: "bad", assetDefinitionId: "bad", positionX: "0", sortOrder: 0, metadata: null }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts multiple placed objects", () => {
    const second = {
      ...validPlacedObject,
      id: "f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f809102",
    };
    const result = LayoutTemplateSchema.safeParse({
      ...validTemplate,
      placedObjects: [validPlacedObject, second],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.placedObjects).toHaveLength(2);
    }
  });
});

// ---------------------------------------------------------------------------
// CreateLayoutTemplateSchema — creation payload
// ---------------------------------------------------------------------------

describe("CreateLayoutTemplateSchema", () => {
  it("accepts a valid create template payload", () => {
    const result = CreateLayoutTemplateSchema.safeParse(validCreateTemplate);
    expect(result.success).toBe(true);
  });

  it("defaults description to empty string when omitted", () => {
    const result = CreateLayoutTemplateSchema.safeParse(validCreateTemplate);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("");
    }
  });

  it("rejects missing venueId", () => {
    const { venueId: _, ...noVenueId } = validCreateTemplate;
    expect(CreateLayoutTemplateSchema.safeParse(noVenueId).success).toBe(false);
  });

  it("rejects missing spaceId", () => {
    const { spaceId: _, ...noSpaceId } = validCreateTemplate;
    expect(CreateLayoutTemplateSchema.safeParse(noSpaceId).success).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _, ...noName } = validCreateTemplate;
    expect(CreateLayoutTemplateSchema.safeParse(noName).success).toBe(false);
  });

  it("rejects missing layoutStyle", () => {
    const { layoutStyle: _, ...noLayout } = validCreateTemplate;
    expect(CreateLayoutTemplateSchema.safeParse(noLayout).success).toBe(false);
  });

  it("rejects missing placedObjects", () => {
    const { placedObjects: _, ...noObjects } = validCreateTemplate;
    expect(CreateLayoutTemplateSchema.safeParse(noObjects).success).toBe(false);
  });

  it("rejects missing guestCapacity", () => {
    const { guestCapacity: _, ...noCapacity } = validCreateTemplate;
    expect(CreateLayoutTemplateSchema.safeParse(noCapacity).success).toBe(false);
  });

  it("rejects missing thumbnailUrl (required but nullable)", () => {
    const { thumbnailUrl: _, ...noThumb } = validCreateTemplate;
    expect(CreateLayoutTemplateSchema.safeParse(noThumb).success).toBe(false);
  });

  it("does not accept id field (strips extra keys)", () => {
    const result = CreateLayoutTemplateSchema.safeParse({ ...validCreateTemplate, id: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("id" in result.data).toBe(false);
    }
  });

  it("does not accept createdAt field (strips extra keys)", () => {
    const result = CreateLayoutTemplateSchema.safeParse({ ...validCreateTemplate, createdAt: VALID_DATETIME });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("createdAt" in result.data).toBe(false);
    }
  });

  it("rejects zero guest capacity", () => {
    expect(CreateLayoutTemplateSchema.safeParse({ ...validCreateTemplate, guestCapacity: 0 }).success).toBe(false);
  });

  it("rejects negative guest capacity", () => {
    expect(CreateLayoutTemplateSchema.safeParse({ ...validCreateTemplate, guestCapacity: -1 }).success).toBe(false);
  });

  it("rejects float guest capacity", () => {
    expect(CreateLayoutTemplateSchema.safeParse({ ...validCreateTemplate, guestCapacity: 50.5 }).success).toBe(false);
  });
});
