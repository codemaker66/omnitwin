import { describe, it, expect } from "vitest";
import {
  ConfigurationIdSchema,
  ConfigurationStatusSchema,
  CONFIGURATION_STATUSES,
  LayoutStyleSchema,
  LAYOUT_STYLES,
  Vec3Schema,
  PlacedObjectSchema,
  ConfigurationSchema,
  CreateConfigurationSchema,
} from "../configuration.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const VALID_VENUE_UUID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const VALID_SPACE_UUID = "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f";
const VALID_USER_UUID = "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f80";
const VALID_ASSET_UUID = "e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8091";
const VALID_DATETIME = "2025-01-15T10:30:00.000Z";

// ---------------------------------------------------------------------------
// New flat PlacedObject shape (matches DB columns)
// ---------------------------------------------------------------------------

const validPlacedObject = {
  id: VALID_UUID,
  configurationId: VALID_SPACE_UUID, // any valid UUID
  assetDefinitionId: VALID_ASSET_UUID,
  positionX: "1.000",
  positionY: "0.000",
  positionZ: "2.500",
  rotationX: "0.000",
  rotationY: "1.571",
  rotationZ: "0.000",
  scale: "1.000",
  sortOrder: 0,
  metadata: null,
};

const validConfiguration = {
  id: VALID_UUID,
  venueId: VALID_VENUE_UUID,
  spaceId: VALID_SPACE_UUID,
  userId: VALID_USER_UUID,
  name: "Wedding Setup A",
  state: "draft" as const,
  layoutStyle: "ceremony" as const,
  isPublicPreview: false,
  guestCount: 100,
  isTemplate: false,
  visibility: "private" as const,
  thumbnailUrl: null,
  lightmapUrl: null,
  publishedAt: null,
  createdAt: VALID_DATETIME,
  updatedAt: VALID_DATETIME,
};

const validCreateConfiguration = {
  venueId: VALID_VENUE_UUID,
  spaceId: VALID_SPACE_UUID,
  name: "Wedding Setup A",
  layoutStyle: "ceremony" as const,
};

// ---------------------------------------------------------------------------
// ConfigurationIdSchema
// ---------------------------------------------------------------------------

describe("ConfigurationIdSchema", () => {
  it("accepts a valid UUID", () => {
    expect(ConfigurationIdSchema.safeParse(VALID_UUID).success).toBe(true);
  });

  it("rejects a non-UUID string", () => {
    expect(ConfigurationIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(ConfigurationIdSchema.safeParse("").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ConfigurationStatusSchema
// ---------------------------------------------------------------------------

describe("ConfigurationStatusSchema", () => {
  it("accepts 'draft'", () => {
    expect(ConfigurationStatusSchema.safeParse("draft").success).toBe(true);
  });

  it("accepts 'published'", () => {
    expect(ConfigurationStatusSchema.safeParse("published").success).toBe(true);
  });

  it("rejects 'archived' (not a valid status)", () => {
    expect(ConfigurationStatusSchema.safeParse("archived").success).toBe(false);
  });

  it("rejects 'Draft' (case sensitive)", () => {
    expect(ConfigurationStatusSchema.safeParse("Draft").success).toBe(false);
  });

  it("rejects 'PUBLISHED' (case sensitive)", () => {
    expect(ConfigurationStatusSchema.safeParse("PUBLISHED").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(ConfigurationStatusSchema.safeParse("").success).toBe(false);
  });

  it("rejects a number", () => {
    expect(ConfigurationStatusSchema.safeParse(0).success).toBe(false);
  });

  it("rejects null", () => {
    expect(ConfigurationStatusSchema.safeParse(null).success).toBe(false);
  });

  it("has exactly 2 valid statuses", () => {
    expect(CONFIGURATION_STATUSES).toHaveLength(2);
  });

  it("contains the expected statuses", () => {
    expect(CONFIGURATION_STATUSES).toEqual(["draft", "published"]);
  });
});

// ---------------------------------------------------------------------------
// LayoutStyleSchema
// ---------------------------------------------------------------------------

describe("LayoutStyleSchema", () => {
  it.each(LAYOUT_STYLES)("accepts '%s'", (style) => {
    expect(LayoutStyleSchema.safeParse(style).success).toBe(true);
  });

  it("has exactly 8 layout styles", () => {
    expect(LAYOUT_STYLES).toHaveLength(8);
  });

  it("contains all expected styles", () => {
    expect(LAYOUT_STYLES).toEqual([
      "ceremony",
      "dinner-rounds",
      "dinner-banquet",
      "theatre",
      "boardroom",
      "cabaret",
      "cocktail",
      "custom",
    ]);
  });

  it("rejects 'wedding' (not a valid style)", () => {
    expect(LayoutStyleSchema.safeParse("wedding").success).toBe(false);
  });

  it("rejects 'Ceremony' (case sensitive)", () => {
    expect(LayoutStyleSchema.safeParse("Ceremony").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(LayoutStyleSchema.safeParse("").success).toBe(false);
  });

  it("rejects null", () => {
    expect(LayoutStyleSchema.safeParse(null).success).toBe(false);
  });

  it("rejects a number", () => {
    expect(LayoutStyleSchema.safeParse(1).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Vec3Schema
// ---------------------------------------------------------------------------

describe("Vec3Schema", () => {
  it("accepts valid coordinates", () => {
    expect(Vec3Schema.safeParse({ x: 1, y: 2, z: 3 }).success).toBe(true);
  });

  it("accepts zero vector", () => {
    expect(Vec3Schema.safeParse({ x: 0, y: 0, z: 0 }).success).toBe(true);
  });

  it("accepts negative values", () => {
    expect(Vec3Schema.safeParse({ x: -10.5, y: -20.3, z: -0.001 }).success).toBe(true);
  });

  it("rejects Infinity for x", () => {
    expect(Vec3Schema.safeParse({ x: Infinity, y: 0, z: 0 }).success).toBe(false);
  });

  it("rejects -Infinity for y", () => {
    expect(Vec3Schema.safeParse({ x: 0, y: -Infinity, z: 0 }).success).toBe(false);
  });

  it("rejects NaN for z", () => {
    expect(Vec3Schema.safeParse({ x: 0, y: 0, z: NaN }).success).toBe(false);
  });

  it("rejects missing x", () => {
    expect(Vec3Schema.safeParse({ y: 0, z: 0 }).success).toBe(false);
  });

  it("rejects missing y", () => {
    expect(Vec3Schema.safeParse({ x: 0, z: 0 }).success).toBe(false);
  });

  it("rejects missing z", () => {
    expect(Vec3Schema.safeParse({ x: 0, y: 0 }).success).toBe(false);
  });

  it("rejects string values", () => {
    expect(Vec3Schema.safeParse({ x: "1", y: "2", z: "3" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PlacedObjectSchema — flat DB shape
// ---------------------------------------------------------------------------

describe("PlacedObjectSchema", () => {
  it("accepts a valid placed object", () => {
    const result = PlacedObjectSchema.safeParse(validPlacedObject);
    expect(result.success).toBe(true);
  });

  it("rejects missing id", () => {
    const { id: _, ...noId } = validPlacedObject;
    expect(PlacedObjectSchema.safeParse(noId).success).toBe(false);
  });

  it("rejects missing configurationId", () => {
    const { configurationId: _, ...noConfigId } = validPlacedObject;
    expect(PlacedObjectSchema.safeParse(noConfigId).success).toBe(false);
  });

  it("rejects missing assetDefinitionId", () => {
    const { assetDefinitionId: _, ...noAssetId } = validPlacedObject;
    expect(PlacedObjectSchema.safeParse(noAssetId).success).toBe(false);
  });

  it("rejects missing positionX", () => {
    const { positionX: _, ...noPos } = validPlacedObject;
    expect(PlacedObjectSchema.safeParse(noPos).success).toBe(false);
  });

  it("rejects missing positionY", () => {
    const { positionY: _, ...noPos } = validPlacedObject;
    expect(PlacedObjectSchema.safeParse(noPos).success).toBe(false);
  });

  it("rejects missing positionZ", () => {
    const { positionZ: _, ...noPos } = validPlacedObject;
    expect(PlacedObjectSchema.safeParse(noPos).success).toBe(false);
  });

  it("rejects missing rotationX", () => {
    const { rotationX: _, ...noRot } = validPlacedObject;
    expect(PlacedObjectSchema.safeParse(noRot).success).toBe(false);
  });

  it("rejects missing scale", () => {
    const { scale: _, ...noScale } = validPlacedObject;
    expect(PlacedObjectSchema.safeParse(noScale).success).toBe(false);
  });

  it("rejects missing sortOrder", () => {
    const { sortOrder: _, ...noSort } = validPlacedObject;
    expect(PlacedObjectSchema.safeParse(noSort).success).toBe(false);
  });

  it("rejects invalid UUID for id", () => {
    expect(PlacedObjectSchema.safeParse({ ...validPlacedObject, id: "bad" }).success).toBe(false);
  });

  it("rejects invalid UUID for assetDefinitionId", () => {
    expect(PlacedObjectSchema.safeParse({ ...validPlacedObject, assetDefinitionId: "bad" }).success).toBe(false);
  });

  it("rejects negative sortOrder", () => {
    expect(PlacedObjectSchema.safeParse({ ...validPlacedObject, sortOrder: -1 }).success).toBe(false);
  });

  it("rejects float sortOrder", () => {
    expect(PlacedObjectSchema.safeParse({ ...validPlacedObject, sortOrder: 1.5 }).success).toBe(false);
  });

  it("accepts metadata as null", () => {
    expect(PlacedObjectSchema.safeParse({ ...validPlacedObject, metadata: null }).success).toBe(true);
  });

  it("accepts metadata as a record of unknown values", () => {
    expect(
      PlacedObjectSchema.safeParse({ ...validPlacedObject, metadata: { note: "front row", priority: 1 } }).success,
    ).toBe(true);
  });

  it("accepts numeric string for positionX", () => {
    expect(
      PlacedObjectSchema.safeParse({ ...validPlacedObject, positionX: "-5.123" }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ConfigurationSchema — full entity
// ---------------------------------------------------------------------------

describe("ConfigurationSchema", () => {
  it("accepts a fully valid draft configuration", () => {
    const result = ConfigurationSchema.safeParse(validConfiguration);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Wedding Setup A");
      expect(result.data.state).toBe("draft");
    }
  });

  it("accepts a published configuration with lightmapUrl and publishedAt", () => {
    const published = {
      ...validConfiguration,
      state: "published",
      lightmapUrl: "https://cdn.example.com/lightmap.exr",
      publishedAt: "2025-02-01T14:00:00.000Z",
    };
    const result = ConfigurationSchema.safeParse(published);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.state).toBe("published");
      expect(result.data.lightmapUrl).toBe("https://cdn.example.com/lightmap.exr");
      expect(result.data.publishedAt).toBe("2025-02-01T14:00:00.000Z");
    }
  });

  it("accepts a draft with null lightmapUrl and null publishedAt", () => {
    const result = ConfigurationSchema.safeParse(validConfiguration);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lightmapUrl).toBeNull();
      expect(result.data.publishedAt).toBeNull();
    }
  });

  it("accepts null userId (anonymous configuration)", () => {
    const result = ConfigurationSchema.safeParse({ ...validConfiguration, userId: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userId).toBeNull();
    }
  });

  it("accepts isPublicPreview true", () => {
    const result = ConfigurationSchema.safeParse({ ...validConfiguration, isPublicPreview: true });
    expect(result.success).toBe(true);
  });

  it("accepts isTemplate true", () => {
    const result = ConfigurationSchema.safeParse({ ...validConfiguration, isTemplate: true });
    expect(result.success).toBe(true);
  });

  it("accepts all visibility values", () => {
    for (const vis of ["private", "staff", "public"] as const) {
      const result = ConfigurationSchema.safeParse({ ...validConfiguration, visibility: vis });
      expect(result.success).toBe(true);
    }
  });

  it("trims whitespace from name", () => {
    const result = ConfigurationSchema.safeParse({ ...validConfiguration, name: "  Wedding Setup A  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Wedding Setup A");
    }
  });

  it("rejects whitespace-only name", () => {
    expect(ConfigurationSchema.safeParse({ ...validConfiguration, name: "   " }).success).toBe(false);
  });

  it("rejects empty string name", () => {
    expect(ConfigurationSchema.safeParse({ ...validConfiguration, name: "" }).success).toBe(false);
  });

  it("rejects name exceeding 200 characters", () => {
    expect(ConfigurationSchema.safeParse({ ...validConfiguration, name: "A".repeat(201) }).success).toBe(false);
  });

  it("accepts name of exactly 200 characters", () => {
    expect(ConfigurationSchema.safeParse({ ...validConfiguration, name: "A".repeat(200) }).success).toBe(true);
  });

  it("rejects missing id", () => {
    const { id: _, ...noId } = validConfiguration;
    expect(ConfigurationSchema.safeParse(noId).success).toBe(false);
  });

  it("rejects missing venueId", () => {
    const { venueId: _, ...noVenueId } = validConfiguration;
    expect(ConfigurationSchema.safeParse(noVenueId).success).toBe(false);
  });

  it("rejects missing spaceId", () => {
    const { spaceId: _, ...noSpaceId } = validConfiguration;
    expect(ConfigurationSchema.safeParse(noSpaceId).success).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _, ...noName } = validConfiguration;
    expect(ConfigurationSchema.safeParse(noName).success).toBe(false);
  });

  it("rejects missing state", () => {
    const { state: _, ...noState } = validConfiguration;
    expect(ConfigurationSchema.safeParse(noState).success).toBe(false);
  });

  it("rejects missing layoutStyle", () => {
    const { layoutStyle: _, ...noLayout } = validConfiguration;
    expect(ConfigurationSchema.safeParse(noLayout).success).toBe(false);
  });

  it("rejects missing lightmapUrl (required but nullable)", () => {
    const { lightmapUrl: _, ...noLightmap } = validConfiguration;
    expect(ConfigurationSchema.safeParse(noLightmap).success).toBe(false);
  });

  it("rejects missing publishedAt (required but nullable)", () => {
    const { publishedAt: _, ...noPublishedAt } = validConfiguration;
    expect(ConfigurationSchema.safeParse(noPublishedAt).success).toBe(false);
  });

  it("rejects missing createdAt", () => {
    const { createdAt: _, ...noCreatedAt } = validConfiguration;
    expect(ConfigurationSchema.safeParse(noCreatedAt).success).toBe(false);
  });

  it("rejects missing updatedAt", () => {
    const { updatedAt: _, ...noUpdatedAt } = validConfiguration;
    expect(ConfigurationSchema.safeParse(noUpdatedAt).success).toBe(false);
  });

  it("rejects invalid UUID for id", () => {
    expect(ConfigurationSchema.safeParse({ ...validConfiguration, id: "bad" }).success).toBe(false);
  });

  it("rejects invalid UUID for venueId", () => {
    expect(ConfigurationSchema.safeParse({ ...validConfiguration, venueId: "bad" }).success).toBe(false);
  });

  it("rejects invalid UUID for spaceId", () => {
    expect(ConfigurationSchema.safeParse({ ...validConfiguration, spaceId: "bad" }).success).toBe(false);
  });

  it("rejects invalid state value", () => {
    expect(ConfigurationSchema.safeParse({ ...validConfiguration, state: "pending" }).success).toBe(false);
  });

  it("rejects invalid layoutStyle value", () => {
    expect(ConfigurationSchema.safeParse({ ...validConfiguration, layoutStyle: "wedding" }).success).toBe(false);
  });

  it("rejects invalid URL for lightmapUrl", () => {
    expect(ConfigurationSchema.safeParse({ ...validConfiguration, lightmapUrl: "not-a-url" }).success).toBe(false);
  });

  it("rejects invalid datetime for publishedAt", () => {
    expect(ConfigurationSchema.safeParse({ ...validConfiguration, publishedAt: "not-a-date" }).success).toBe(false);
  });

  it("rejects invalid datetime for createdAt", () => {
    expect(ConfigurationSchema.safeParse({ ...validConfiguration, createdAt: "nope" }).success).toBe(false);
  });

  it("accepts all layout styles in a configuration", () => {
    for (const style of LAYOUT_STYLES) {
      const result = ConfigurationSchema.safeParse({ ...validConfiguration, layoutStyle: style });
      expect(result.success).toBe(true);
    }
  });

  it("rejects negative guestCount", () => {
    expect(ConfigurationSchema.safeParse({ ...validConfiguration, guestCount: -1 }).success).toBe(false);
  });

  it("accepts guestCount of 0", () => {
    expect(ConfigurationSchema.safeParse({ ...validConfiguration, guestCount: 0 }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CreateConfigurationSchema — creation payload
// ---------------------------------------------------------------------------

describe("CreateConfigurationSchema", () => {
  it("accepts a valid create configuration payload", () => {
    const result = CreateConfigurationSchema.safeParse(validCreateConfiguration);
    expect(result.success).toBe(true);
  });

  it("defaults guestCount to 0 when omitted", () => {
    const result = CreateConfigurationSchema.safeParse(validCreateConfiguration);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.guestCount).toBe(0);
    }
  });

  it("defaults isTemplate to false when omitted", () => {
    const result = CreateConfigurationSchema.safeParse(validCreateConfiguration);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isTemplate).toBe(false);
    }
  });

  it("defaults visibility to 'private' when omitted", () => {
    const result = CreateConfigurationSchema.safeParse(validCreateConfiguration);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visibility).toBe("private");
    }
  });

  it("rejects missing venueId", () => {
    const { venueId: _, ...noVenueId } = validCreateConfiguration;
    expect(CreateConfigurationSchema.safeParse(noVenueId).success).toBe(false);
  });

  it("rejects missing spaceId", () => {
    const { spaceId: _, ...noSpaceId } = validCreateConfiguration;
    expect(CreateConfigurationSchema.safeParse(noSpaceId).success).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _, ...noName } = validCreateConfiguration;
    expect(CreateConfigurationSchema.safeParse(noName).success).toBe(false);
  });

  it("rejects missing layoutStyle", () => {
    const { layoutStyle: _, ...noLayout } = validCreateConfiguration;
    expect(CreateConfigurationSchema.safeParse(noLayout).success).toBe(false);
  });

  it("does not accept id field (strips extra keys)", () => {
    const result = CreateConfigurationSchema.safeParse({ ...validCreateConfiguration, id: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("id" in result.data).toBe(false);
    }
  });

  it("does not accept state field (strips extra keys)", () => {
    const result = CreateConfigurationSchema.safeParse({ ...validCreateConfiguration, state: "draft" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("state" in result.data).toBe(false);
    }
  });

  it("does not accept lightmapUrl field (strips extra keys)", () => {
    const result = CreateConfigurationSchema.safeParse({
      ...validCreateConfiguration,
      lightmapUrl: "https://example.com/lightmap.exr",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("lightmapUrl" in result.data).toBe(false);
    }
  });

  it("does not accept publishedAt field (strips extra keys)", () => {
    const result = CreateConfigurationSchema.safeParse({
      ...validCreateConfiguration,
      publishedAt: VALID_DATETIME,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("publishedAt" in result.data).toBe(false);
    }
  });
});
