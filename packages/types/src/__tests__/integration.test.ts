import { describe, it, expect } from "vitest";
import {
  // Venue
  VenueIdSchema,
  VenueSlugSchema,
  BrandColourSchema,
  VenueSchema,
  CreateVenueSchema,
  // Space
  SpaceIdSchema,
  SpaceSlugSchema,
  SpaceDimensionsSchema,
  FloorPlanPointSchema,
  FloorPlanOutlineSchema,
  SpaceSchema,
  CreateSpaceSchema,
  TRADES_HALL_GRAND_HALL_DIMENSIONS,
  TRADES_HALL_ROBERT_ADAM_ROOM_DIMENSIONS,
  TRADES_HALL_RECEPTION_ROOM_DIMENSIONS,
  TRADES_HALL_SALOON_DIMENSIONS,
  TRADES_HALL_ROOMS,
  // Configuration
  ConfigurationIdSchema,
  ConfigurationStatusSchema,
  CONFIGURATION_STATUSES,
  LayoutStyleSchema,
  LAYOUT_STYLES,
  Vec3Schema,
  PlacedObjectIdSchema,
  AssetDefinitionIdSchema,
  PlacedObjectSchema,
  ConfigurationSchema,
  CreateConfigurationSchema,
  // Template
  LayoutTemplateIdSchema,
  LayoutTemplateSchema,
  CreateLayoutTemplateSchema,
  // Furniture
  FURNITURE_CATEGORIES,
  FurnitureCategorySchema,
  FurnitureDimensionsSchema,
  AssetDefinitionSchema,
  CreateAssetDefinitionSchema,
  // Scene
  VIEW_MODES,
  ViewModeSchema,
  CameraStateSchema,
  TRANSITION_STATES,
  TransitionStateSchema,
  SceneStateSchema,
  // User
  UserIdSchema,
  USER_ROLES,
  UserRoleSchema,
  EmailSchema,
  UserSchema,
  CreateUserSchema,
  // Enquiry
  EnquiryIdSchema,
  ENQUIRY_STATUSES,
  EnquiryStatusSchema,
  VALID_ENQUIRY_TRANSITIONS,
  isValidEnquiryTransition,
  EnquirySchema,
  CreateEnquirySchema,
  // Pricing
  PricingRuleIdSchema,
  SUPPORTED_CURRENCIES,
  CurrencySchema,
  PricingRuleSchema,
  PriceEstimateRequestSchema,
  PriceEstimateResponseSchema,
  // Photo
  PhotoIdSchema,
  ALLOWED_PHOTO_CONTENT_TYPES,
  PhotoContentTypeSchema,
  LegacyPhotoSchema,
  LegacyPhotoUploadRequestSchema,
  LegacyPhotoUploadResponseSchema,
} from "../index.js";

import type {
  VenueId,
  PlacedObject,
  Configuration,
  User,
  Enquiry,
} from "../index.js";

// ---------------------------------------------------------------------------
// Shared test data — consistent UUIDs used across all cross-module tests
// ---------------------------------------------------------------------------

const VENUE_ID = "a1111111-1111-4111-8111-111111111111";
const SPACE_ID = "b2222222-2222-4222-8222-222222222222";
const CONFIG_ID = "c3333333-3333-4333-8333-333333333333";
const ASSET_DEF_ID = "e5555555-5555-4555-8555-555555555555";
const PLACED_OBJECT_ID = "f6666666-6666-4666-8666-666666666666";
const USER_ID = "a7777777-7777-4777-8777-777777777777";
const ENQUIRY_ID = "b8888888-8888-4888-8888-888888888888";
const PRICING_RULE_ID = "c9999999-9999-4999-8999-999999999999";

const PHOTO_ID = "e1111111-2222-4333-8444-555555555555";
const NOW = "2025-06-15T14:30:00.000Z";

// ---------------------------------------------------------------------------
// 1. Barrel export completeness — every schema and constant is importable
// ---------------------------------------------------------------------------

describe("barrel export completeness", () => {
  it("exports all Zod schemas as objects with safeParse", () => {
    const schemas = [
      VenueIdSchema,
      VenueSlugSchema,
      BrandColourSchema,
      VenueSchema,
      CreateVenueSchema,
      SpaceIdSchema,
      SpaceSlugSchema,
      SpaceDimensionsSchema,
      FloorPlanPointSchema,
      FloorPlanOutlineSchema,
      SpaceSchema,
      CreateSpaceSchema,
      ConfigurationIdSchema,
      ConfigurationStatusSchema,
      LayoutStyleSchema,
      Vec3Schema,
      PlacedObjectIdSchema,
      AssetDefinitionIdSchema,
      PlacedObjectSchema,
      ConfigurationSchema,
      CreateConfigurationSchema,
      LayoutTemplateIdSchema,
      LayoutTemplateSchema,
      CreateLayoutTemplateSchema,
      FurnitureCategorySchema,
      FurnitureDimensionsSchema,
      AssetDefinitionSchema,
      CreateAssetDefinitionSchema,
      ViewModeSchema,
      CameraStateSchema,
      TransitionStateSchema,
      SceneStateSchema,
      UserIdSchema,
      UserRoleSchema,
      EmailSchema,
      UserSchema,
      CreateUserSchema,
      EnquiryIdSchema,
      EnquiryStatusSchema,
      EnquirySchema,
      CreateEnquirySchema,
      PricingRuleIdSchema,
      CurrencySchema,
      PricingRuleSchema,
      PriceEstimateRequestSchema,
      PriceEstimateResponseSchema,
      PhotoIdSchema,
      PhotoContentTypeSchema,
      LegacyPhotoSchema,
      LegacyPhotoUploadRequestSchema,
      LegacyPhotoUploadResponseSchema,
    ];

    for (const schema of schemas) {
      expect(typeof schema.safeParse).toBe("function");
    }
  });

  it("exports all enum/constant arrays as readonly arrays", () => {
    const enums = [
      CONFIGURATION_STATUSES,
      LAYOUT_STYLES,
      FURNITURE_CATEGORIES,
      VIEW_MODES,
      TRANSITION_STATES,
      USER_ROLES,
      ENQUIRY_STATUSES,
      SUPPORTED_CURRENCIES,
      ALLOWED_PHOTO_CONTENT_TYPES,
    ];

    for (const arr of enums) {
      expect(Array.isArray(arr)).toBe(true);
      expect(arr.length).toBeGreaterThan(0);
    }
  });

  it("exports Trades Hall room constants", () => {
    expect(TRADES_HALL_GRAND_HALL_DIMENSIONS).toBeDefined();
    expect(TRADES_HALL_ROBERT_ADAM_ROOM_DIMENSIONS).toBeDefined();
    expect(TRADES_HALL_RECEPTION_ROOM_DIMENSIONS).toBeDefined();
    expect(TRADES_HALL_SALOON_DIMENSIONS).toBeDefined();
    expect(TRADES_HALL_ROOMS).toHaveLength(4);
  });

  it("exports VALID_ENQUIRY_TRANSITIONS map", () => {
    expect(typeof VALID_ENQUIRY_TRANSITIONS).toBe("object");
    expect(Object.keys(VALID_ENQUIRY_TRANSITIONS)).toHaveLength(7);
  });

  it("exports isValidEnquiryTransition function", () => {
    expect(typeof isValidEnquiryTransition).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// 2. Cross-module ID consistency — IDs from one schema accepted in another
// ---------------------------------------------------------------------------

describe("cross-module ID consistency", () => {
  it("VenueId accepted by SpaceSchema.venueId", () => {
    const venueId = VenueIdSchema.parse(VENUE_ID);
    const space = SpaceSchema.safeParse({
      id: SPACE_ID,
      venueId,
      name: "Grand Hall",
      slug: "grand-hall",
      description: null,
      widthM: "21.00",
      lengthM: "10.00",
      heightM: "7.00",
      sortOrder: 0,
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10 }],
      meshUrl: null,
      thumbnailUrl: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(space.success).toBe(true);
  });

  it("VenueId + SpaceId accepted by ConfigurationSchema", () => {
    const config = ConfigurationSchema.safeParse({
      id: CONFIG_ID,
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      userId: USER_ID,
      name: "Wedding Setup",
      state: "draft",
      layoutStyle: "ceremony",
      isPublicPreview: false,
      guestCount: 100,
      isTemplate: false,
      visibility: "private",
      thumbnailUrl: null,
      lightmapUrl: null,
      publishedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(config.success).toBe(true);
  });

  it("ConfigurationId accepted by LegacyPhotoUploadRequestSchema", () => {
    expect(
      LegacyPhotoUploadRequestSchema.safeParse({
        configurationId: CONFIG_ID,
        filename: "photo.jpg",
        contentType: "image/jpeg",
      }).success,
    ).toBe(true);
  });

  it("UserIdSchema accepted by LegacyPhotoSchema.uploadedBy", () => {
    const photo = LegacyPhotoSchema.safeParse({
      id: PHOTO_ID,
      configurationId: CONFIG_ID,
      uploadedBy: USER_ID,
      url: "https://cdn.example.com/photo.jpg",
      thumbnailUrl: null,
      createdAt: NOW,
    });
    expect(photo.success).toBe(true);
  });

  it("UserIdSchema accepted by EnquirySchema.userId", () => {
    const enquiry = EnquirySchema.safeParse({
      id: ENQUIRY_ID,
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      configurationId: null,
      userId: USER_ID,
      name: "Jane Doe",
      email: "jane@example.com",
      guestPhone: null,
      guestEmail: null,
      guestName: null,
      eventType: null,
      message: "Interested in booking",
      preferredDate: "2025-12-01",
      estimatedGuests: 100,
      state: "submitted",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(enquiry.success).toBe(true);
  });

  it("SpaceId accepted by PricingRuleSchema and PriceEstimateRequestSchema", () => {
    expect(
      PricingRuleSchema.safeParse({
        id: PRICING_RULE_ID,
        venueId: VENUE_ID,
        spaceId: SPACE_ID,
        name: "Grand Hall — Half Day",
        type: "flat_rate",
        amount: 550,
        currency: "GBP",
        minHours: null,
        minGuests: null,
        tiers: null,
        dayOfWeekModifiers: null,
        seasonalModifiers: null,
        validFrom: null,
        validTo: null,
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      }).success,
    ).toBe(true);

    expect(
      PriceEstimateRequestSchema.safeParse({
        spaceId: SPACE_ID,
        eventDate: "2025-06-15",
        startTime: "09:00",
        endTime: "13:00",
        guestCount: 120,
      }).success,
    ).toBe(true);
  });

  it("AssetDefinitionId accepted by PlacedObjectSchema", () => {
    const placed = PlacedObjectSchema.safeParse({
      id: PLACED_OBJECT_ID,
      configurationId: CONFIG_ID,
      assetDefinitionId: ASSET_DEF_ID,
      positionX: "1.000",
      positionY: "0.000",
      positionZ: "2.000",
      rotationX: "0.000",
      rotationY: "1.571",
      rotationZ: "0.000",
      scale: "1.000",
      sortOrder: 0,
      metadata: null,
    });
    expect(placed.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. End-to-end workflow — simulate full venue setup lifecycle
// ---------------------------------------------------------------------------

describe("end-to-end workflow: venue setup lifecycle", () => {
  // Step 1: Create venue
  const createVenueData = {
    name: "Trades Hall Glasgow",
    address: "85 Glassford Street, Glasgow, G1 1UH",
    slug: "trades-hall-glasgow",
    logoUrl: "https://tradeshall.co.uk/logo.png",
    brandColour: "#2C3E50",
  };

  // Step 2: Create space (numeric dimensions in CreateSpaceSchema)
  const createSpaceData = {
    venueId: VENUE_ID,
    name: "Grand Hall",
    slug: "grand-hall",
    widthM: 21,
    lengthM: 10,
    heightM: 7,
    sortOrder: 0,
    floorPlanOutline: [
      { x: 0, y: 0 },
      { x: 21, y: 0 },
      { x: 21, y: 10 },
      { x: 0, y: 10 },
    ],
  };

  // Step 3: Create asset definition (new schema: no venueId, no stackable/maxStack)
  const createAssetData = {
    name: "Round Table (6ft)",
    category: "table" as const,
    widthM: 1.83,
    depthM: 1.83,
    heightM: 0.76,
    seatCount: 8,
    collisionType: "circle",
    meshUrl: "https://cdn.omnitwin.com/meshes/round-table-6ft.glb",
    thumbnailUrl: "https://cdn.omnitwin.com/thumbs/round-table-6ft.jpg",
  };

  // Step 4: Create configuration (no placedObjects in CreateConfiguration)
  const createConfigData = {
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    name: "Wedding Ceremony - 120 guests",
    layoutStyle: "ceremony" as const,
    guestCount: 120,
  };

  // Step 5: Create template from configuration
  // LayoutTemplateSchema still uses PlacedObjectSchema (flat shape)
  const createTemplateData = {
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    name: "Standard Ceremony",
    layoutStyle: "ceremony" as const,
    description: "Standard ceremony layout for up to 150 guests",
    placedObjects: [
      {
        id: PLACED_OBJECT_ID,
        configurationId: CONFIG_ID,
        assetDefinitionId: ASSET_DEF_ID,
        positionX: "5.000",
        positionY: "0.000",
        positionZ: "3.000",
        rotationX: "0.000",
        rotationY: "0.000",
        rotationZ: "0.000",
        scale: "1.000",
        sortOrder: 0,
        metadata: null,
      },
    ],
    guestCapacity: 150,
    thumbnailUrl: "https://cdn.omnitwin.com/thumbs/ceremony-template.jpg",
  };

  // Step 6: Create user (Clerk handles registration)
  const createUserData = {
    email: "hallkeeper@tradeshall.co.uk",
    name: "Hamish McKenzie",
    role: "hallkeeper" as const,
    venueId: VENUE_ID,
  };

  // Step 7: Create enquiry (new field names)
  const createEnquiryData = {
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    configurationId: CONFIG_ID,
    name: "Sarah & James",
    email: "sarah.james@gmail.com",
    message: "We would like to book the Grand Hall for our wedding on 15th August 2026.",
    preferredDate: "2026-08-15",
    estimatedGuests: 120,
  };

  // Step 8: Create pricing rule (matches actual API schema)
  const pricingRuleData = {
    id: PRICING_RULE_ID,
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    name: "Grand Hall — Full Day (09:00–17:30)",
    type: "flat_rate" as const,
    amount: 900,
    currency: "GBP" as const,
    minHours: null,
    minGuests: null,
    tiers: null,
    dayOfWeekModifiers: null,
    seasonalModifiers: null,
    validFrom: null,
    validTo: null,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  };

  it("Step 1: CreateVenueSchema validates venue creation data", () => {
    const result = CreateVenueSchema.safeParse(createVenueData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Trades Hall Glasgow");
    }
  });

  it("Step 2: CreateSpaceSchema validates space creation data", () => {
    const result = CreateSpaceSchema.safeParse(createSpaceData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.widthM).toBe(21);
      expect(result.data.lengthM).toBe(10);
    }
  });

  it("Step 3: CreateAssetDefinitionSchema validates asset definition creation data", () => {
    const result = CreateAssetDefinitionSchema.safeParse(createAssetData);
    expect(result.success).toBe(true);
  });

  it("Step 4: CreateConfigurationSchema validates configuration creation data", () => {
    const result = CreateConfigurationSchema.safeParse(createConfigData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.guestCount).toBe(120);
    }
  });

  it("Step 5: CreateLayoutTemplateSchema validates template creation data", () => {
    const result = CreateLayoutTemplateSchema.safeParse(createTemplateData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.guestCapacity).toBe(150);
    }
  });

  // Step 6a (RegisterRequestSchema) removed — pre-Clerk auth deleted.

  it("Step 6b: CreateUserSchema validates user creation", () => {
    const result = CreateUserSchema.safeParse(createUserData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("hallkeeper");
    }
  });

  it("Step 7: CreateEnquirySchema validates enquiry submission", () => {
    const result = CreateEnquirySchema.safeParse(createEnquiryData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.estimatedGuests).toBe(120);
    }
  });

  it("Step 8: PricingRuleSchema validates pricing rule", () => {
    const result = PricingRuleSchema.safeParse(pricingRuleData);
    expect(result.success).toBe(true);
  });

  it("Step 9: Price estimate flows through request → response", () => {
    const request = PriceEstimateRequestSchema.safeParse({
      spaceId: SPACE_ID,
      eventDate: "2026-08-15",
      startTime: "09:00",
      endTime: "17:30",
      guestCount: 120,
    });
    expect(request.success).toBe(true);

    const response = PriceEstimateResponseSchema.safeParse({
      lineItems: [
        { ruleName: "Grand Hall — Full Day", description: "Flat rate", amount: 900 },
      ],
      subtotal: 900,
      modifiers: [],
      total: 900,
      currency: "GBP",
    });
    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.data.total).toBe(900);
    }
  });

  // Step 10 (HallkeeperSheetSchema) removed — deprecated persistent entity deleted.
  // The running system uses HallkeeperSheetV2Schema for on-the-fly generation.

  it("Step 11: Photo upload flow — request → response → stored entity", () => {
    const uploadReq = LegacyPhotoUploadRequestSchema.safeParse({
      configurationId: CONFIG_ID,
      filename: "grand-hall-ceremony.jpg",
      contentType: "image/jpeg",
      caption: "Final ceremony layout with 120 chairs",
    });
    expect(uploadReq.success).toBe(true);

    const uploadResp = LegacyPhotoUploadResponseSchema.safeParse({
      photoId: PHOTO_ID,
      presignedUrl: "https://s3.eu-west-2.amazonaws.com/omnitwin-photos/grand-hall-ceremony.jpg?X-Amz-Signature=abc",
      expiresAt: "2025-06-15T15:00:00.000Z",
    });
    expect(uploadResp.success).toBe(true);

    const storedPhoto = LegacyPhotoSchema.safeParse({
      id: PHOTO_ID,
      configurationId: CONFIG_ID,
      uploadedBy: USER_ID,
      url: "https://cdn.omnitwin.com/photos/grand-hall-ceremony.jpg",
      thumbnailUrl: "https://cdn.omnitwin.com/photos/grand-hall-ceremony-thumb.jpg",
      caption: "Final ceremony layout with 120 chairs",
      createdAt: NOW,
    });
    expect(storedPhoto.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Scene state with cross-module references
// ---------------------------------------------------------------------------

describe("scene state cross-module references", () => {
  it("SceneStateSchema accepts valid IDs from space + configuration modules", () => {
    const result = SceneStateSchema.safeParse({
      viewMode: "room-3d",
      camera: {
        position: { x: 10, y: 5, z: 15 },
        target: { x: 10.5, y: 0, z: 5.25 },
        fov: 60,
      },
      transition: "idle",
      selectedSpaceId: SPACE_ID,
      selectedObjectId: PLACED_OBJECT_ID,
      activeConfigurationId: CONFIG_ID,
      minimapVisible: true,
    });
    expect(result.success).toBe(true);
  });

  it("SceneStateSchema accepts all nulled optional IDs", () => {
    const result = SceneStateSchema.safeParse({
      viewMode: "blueprint-2d",
      camera: {
        position: { x: 0, y: 20, z: 0 },
        target: { x: 0, y: 0, z: 0 },
        fov: 45,
      },
      transition: "idle",
      selectedSpaceId: null,
      selectedObjectId: null,
      activeConfigurationId: null,
      minimapVisible: false,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Enquiry state machine integration (new states)
// ---------------------------------------------------------------------------

describe("enquiry state machine integration", () => {
  it("full lifecycle: draft → submitted → under_review → approved → archived", () => {
    expect(isValidEnquiryTransition("draft", "submitted")).toBe(true);
    expect(isValidEnquiryTransition("submitted", "under_review")).toBe(true);
    expect(isValidEnquiryTransition("under_review", "approved")).toBe(true);
    expect(isValidEnquiryTransition("approved", "archived")).toBe(true);
  });

  it("full lifecycle: submitted → under_review → rejected → archived", () => {
    expect(isValidEnquiryTransition("submitted", "under_review")).toBe(true);
    expect(isValidEnquiryTransition("under_review", "rejected")).toBe(true);
    expect(isValidEnquiryTransition("rejected", "archived")).toBe(true);
  });

  it("withdrawn path: submitted → withdrawn", () => {
    expect(isValidEnquiryTransition("submitted", "withdrawn")).toBe(true);
  });

  it("cannot skip states: submitted → approved is illegal", () => {
    expect(isValidEnquiryTransition("submitted", "approved")).toBe(false);
  });

  it("cannot skip states: draft → under_review is illegal", () => {
    expect(isValidEnquiryTransition("draft", "under_review")).toBe(false);
  });

  it("terminal states have no outbound transitions", () => {
    expect(VALID_ENQUIRY_TRANSITIONS.withdrawn).toHaveLength(0);
    expect(VALID_ENQUIRY_TRANSITIONS.archived).toHaveLength(0);
  });

  it("every ENQUIRY_STATUS is a key in VALID_ENQUIRY_TRANSITIONS", () => {
    for (const status of ENQUIRY_STATUSES) {
      expect(status in VALID_ENQUIRY_TRANSITIONS).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Cross-schema type-level validation (compile-time proof via runtime tests)
// ---------------------------------------------------------------------------

describe("type-level compatibility", () => {
  it("Configuration.venueId is assignable to VenueId", () => {
    const config: Configuration = ConfigurationSchema.parse({
      id: CONFIG_ID,
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      userId: null,
      name: "Test",
      state: "draft",
      layoutStyle: "ceremony",
      isPublicPreview: false,
      guestCount: 0,
      isTemplate: false,
      visibility: "private",
      thumbnailUrl: null,
      lightmapUrl: null,
      publishedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const venueId: VenueId = config.venueId;
    expect(VenueIdSchema.safeParse(venueId).success).toBe(true);
  });

  it("PlacedObject.assetDefinitionId is a valid UUID accepted by AssetDefinitionIdSchema", () => {
    const obj: PlacedObject = PlacedObjectSchema.parse({
      id: PLACED_OBJECT_ID,
      configurationId: CONFIG_ID,
      assetDefinitionId: ASSET_DEF_ID,
      positionX: "0.000",
      positionY: "0.000",
      positionZ: "0.000",
      rotationX: "0.000",
      rotationY: "0.000",
      rotationZ: "0.000",
      scale: "1.000",
      sortOrder: 0,
      metadata: null,
    });
    expect(AssetDefinitionIdSchema.safeParse(obj.assetDefinitionId).success).toBe(true);
  });

  it("User.venueId is a valid VenueId (or null for client users)", () => {
    // venueId is singular and nullable — multi-venue is a future SaaS milestone.
    const user: User = UserSchema.parse({
      id: USER_ID,
      clerkId: null,
      email: "admin@tradeshall.co.uk",
      name: "Admin",
      displayName: null,
      phone: null,
      organizationName: null,
      role: "admin",
      venueId: VENUE_ID,
      createdAt: NOW,
      updatedAt: NOW,
    });
    if (user.venueId !== null) {
      expect(VenueIdSchema.safeParse(user.venueId).success).toBe(true);
    }
  });

  it("Enquiry.configurationId (when not null) is a valid ConfigurationId", () => {
    const enquiry: Enquiry = EnquirySchema.parse({
      id: ENQUIRY_ID,
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      configurationId: CONFIG_ID,
      userId: null,
      name: "Test",
      email: "test@example.com",
      guestPhone: null,
      guestEmail: null,
      guestName: null,
      eventType: null,
      message: "Testing",
      preferredDate: null,
      estimatedGuests: null,
      state: "submitted",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(enquiry.configurationId).not.toBeNull();
    if (enquiry.configurationId !== null) {
      expect(ConfigurationIdSchema.safeParse(enquiry.configurationId).success).toBe(true);
    }
  });

});

// ---------------------------------------------------------------------------
// 7. Trades Hall room constants validate through CreateSpaceSchema
// ---------------------------------------------------------------------------

describe("Trades Hall rooms validate as CreateSpace (with venueId)", () => {
  it.each(
    TRADES_HALL_ROOMS.map((room) => [room.name, room] as const),
  )("%s validates through CreateSpaceSchema", (_name, room) => {
    // TRADES_HALL_ROOMS use dimensions object — convert to flat numeric fields
    const result = CreateSpaceSchema.safeParse({
      venueId: VENUE_ID,
      name: room.name,
      slug: room.slug,
      widthM: room.dimensions.width,
      lengthM: room.dimensions.length,
      heightM: room.dimensions.height,
      sortOrder: room.sortOrder,
      floorPlanOutline: room.floorPlanOutline,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Total export count verification
// ---------------------------------------------------------------------------

describe("export count verification", () => {
  it("has exactly 9 enum/constant arrays", () => {
    const enums = [
      CONFIGURATION_STATUSES,
      LAYOUT_STYLES,
      FURNITURE_CATEGORIES,
      VIEW_MODES,
      TRANSITION_STATES,
      USER_ROLES,
      ENQUIRY_STATUSES,
      SUPPORTED_CURRENCIES,
      ALLOWED_PHOTO_CONTENT_TYPES,
    ];
    expect(enums).toHaveLength(9);
  });

  it("LAYOUT_STYLES has exactly 8 styles", () => {
    expect(LAYOUT_STYLES).toHaveLength(8);
  });

  it("FURNITURE_CATEGORIES has exactly 9 categories", () => {
    expect(FURNITURE_CATEGORIES).toHaveLength(9);
  });

  it("USER_ROLES has exactly 5 roles", () => {
    expect(USER_ROLES).toHaveLength(5);
  });

  it("ENQUIRY_STATUSES has exactly 7 statuses", () => {
    expect(ENQUIRY_STATUSES).toHaveLength(7);
  });

  it("CONFIGURATION_STATUSES has exactly 2 statuses", () => {
    expect(CONFIGURATION_STATUSES).toHaveLength(2);
  });

  it("VIEW_MODES has exactly 2 modes", () => {
    expect(VIEW_MODES).toHaveLength(2);
  });

  it("TRANSITION_STATES has exactly 3 states", () => {
    expect(TRANSITION_STATES).toHaveLength(3);
  });

  it("SUPPORTED_CURRENCIES has exactly 1 currency (GBP)", () => {
    expect(SUPPORTED_CURRENCIES).toHaveLength(1);
    expect(SUPPORTED_CURRENCIES[0]).toBe("GBP");
  });

  it("ALLOWED_PHOTO_CONTENT_TYPES has exactly 3 types", () => {
    expect(ALLOWED_PHOTO_CONTENT_TYPES).toHaveLength(3);
  });
});
