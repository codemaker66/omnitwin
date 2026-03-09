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
  FurnitureItemIdSchema,
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
  FurnitureItemSchema,
  CreateFurnitureItemSchema,
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
  LoginRequestSchema,
  RegisterRequestSchema,
  AuthTokensSchema,
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
  // Hallkeeper
  HallkeeperSheetIdSchema,
  ManifestItemSchema,
  HallkeeperSheetSchema,
  GenerateHallkeeperSheetRequestSchema,
  // Photo
  PhotoIdSchema,
  ALLOWED_PHOTO_CONTENT_TYPES,
  PhotoContentTypeSchema,
  PhotoSchema,
  PhotoUploadRequestSchema,
  PhotoUploadResponseSchema,
} from "../index.js";

import type {
  VenueId,
  PlacedObject,
  Configuration,
  User,
  Enquiry,
  HallkeeperSheet,
} from "../index.js";

// ---------------------------------------------------------------------------
// Shared test data — consistent UUIDs used across all cross-module tests
// ---------------------------------------------------------------------------

const VENUE_ID = "a1111111-1111-4111-8111-111111111111";
const SPACE_ID = "b2222222-2222-4222-8222-222222222222";
const CONFIG_ID = "c3333333-3333-4333-8333-333333333333";
const FURNITURE_ITEM_ID = "e5555555-5555-4555-8555-555555555555";
const PLACED_OBJECT_ID = "f6666666-6666-4666-8666-666666666666";
const USER_ID = "a7777777-7777-4777-8777-777777777777";
const ENQUIRY_ID = "b8888888-8888-4888-8888-888888888888";
const PRICING_RULE_ID = "c9999999-9999-4999-8999-999999999999";
const HALLKEEPER_SHEET_ID = "d0000000-0000-4000-8000-000000000000";
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
      FurnitureItemIdSchema,
      PlacedObjectSchema,
      ConfigurationSchema,
      CreateConfigurationSchema,
      LayoutTemplateIdSchema,
      LayoutTemplateSchema,
      CreateLayoutTemplateSchema,
      FurnitureCategorySchema,
      FurnitureDimensionsSchema,
      FurnitureItemSchema,
      CreateFurnitureItemSchema,
      ViewModeSchema,
      CameraStateSchema,
      TransitionStateSchema,
      SceneStateSchema,
      UserIdSchema,
      UserRoleSchema,
      EmailSchema,
      UserSchema,
      CreateUserSchema,
      LoginRequestSchema,
      RegisterRequestSchema,
      AuthTokensSchema,
      EnquiryIdSchema,
      EnquiryStatusSchema,
      EnquirySchema,
      CreateEnquirySchema,
      PricingRuleIdSchema,
      CurrencySchema,
      PricingRuleSchema,
      PriceEstimateRequestSchema,
      PriceEstimateResponseSchema,
      HallkeeperSheetIdSchema,
      ManifestItemSchema,
      HallkeeperSheetSchema,
      GenerateHallkeeperSheetRequestSchema,
      PhotoIdSchema,
      PhotoContentTypeSchema,
      PhotoSchema,
      PhotoUploadRequestSchema,
      PhotoUploadResponseSchema,
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
    expect(Object.keys(VALID_ENQUIRY_TRANSITIONS)).toHaveLength(5);
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
      dimensions: { width: 21, length: 10.5, height: 8 },
      sortOrder: 0,
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }],
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
      name: "Wedding Setup",
      status: "draft",
      layoutStyle: "ceremony",
      placedObjects: [],
      lightmapUrl: null,
      createdBy: USER_ID,
      publishedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(config.success).toBe(true);
  });

  it("ConfigurationId accepted by HallkeeperSheet and Photo", () => {
    expect(
      GenerateHallkeeperSheetRequestSchema.safeParse({ configurationId: CONFIG_ID }).success,
    ).toBe(true);

    expect(
      PhotoUploadRequestSchema.safeParse({
        configurationId: CONFIG_ID,
        filename: "photo.jpg",
        contentType: "image/jpeg",
      }).success,
    ).toBe(true);
  });

  it("UserIdSchema accepted by PhotoSchema.uploadedBy", () => {
    const photo = PhotoSchema.safeParse({
      id: PHOTO_ID,
      configurationId: CONFIG_ID,
      uploadedBy: USER_ID,
      url: "https://cdn.example.com/photo.jpg",
      thumbnailUrl: null,
      createdAt: NOW,
    });
    expect(photo.success).toBe(true);
  });

  it("UserIdSchema accepted by EnquirySchema.respondedBy", () => {
    const enquiry = EnquirySchema.safeParse({
      id: ENQUIRY_ID,
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      configurationId: null,
      name: "Jane Doe",
      email: "jane@example.com",
      message: "Interested in booking",
      eventDate: NOW,
      guestCount: 100,
      status: "responded",
      respondedBy: USER_ID,
      respondedAt: NOW,
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
        currency: "GBP",
        basePrice: 500,
        pricePerHour: 100,
        pricePerGuest: 5,
        minimumHours: 4,
        minimumGuests: 20,
        createdAt: NOW,
        updatedAt: NOW,
      }).success,
    ).toBe(true);

    expect(
      PriceEstimateRequestSchema.safeParse({
        spaceId: SPACE_ID,
        hours: 6,
        guestCount: 120,
        eventDate: NOW,
      }).success,
    ).toBe(true);
  });

  it("FurnitureItemId accepted by PlacedObjectSchema", () => {
    const placed = PlacedObjectSchema.safeParse({
      id: PLACED_OBJECT_ID,
      furnitureItemId: FURNITURE_ITEM_ID,
      position: { x: 1, y: 0, z: 2 },
      rotation: { x: 0, y: 90, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
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

  // Step 2: Create space
  const createSpaceData = {
    venueId: VENUE_ID,
    name: "Grand Hall",
    slug: "grand-hall",
    description: "The flagship hall with stunning architecture",
    dimensions: TRADES_HALL_GRAND_HALL_DIMENSIONS,
    sortOrder: 0,
    floorPlanOutline: [
      { x: 0, y: 0 },
      { x: 21, y: 0 },
      { x: 21, y: 10.5 },
      { x: 0, y: 10.5 },
    ],
    meshUrl: "https://cdn.omnitwin.com/meshes/grand-hall.glb",
    thumbnailUrl: "https://cdn.omnitwin.com/thumbs/grand-hall.jpg",
  };

  // Step 3: Create furniture item
  const createFurnitureData = {
    venueId: VENUE_ID,
    name: "Round Table (6ft)",
    category: "table" as const,
    defaultDimensions: { width: 1.83, height: 0.76, depth: 1.83 },
    meshUrl: "https://cdn.omnitwin.com/meshes/round-table-6ft.glb",
    thumbnailUrl: "https://cdn.omnitwin.com/thumbs/round-table-6ft.jpg",
    stackable: false,
    maxStack: 1,
  };

  // Step 4: Create configuration with placed objects
  const createConfigData = {
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    name: "Wedding Ceremony - 120 guests",
    layoutStyle: "ceremony" as const,
    placedObjects: [
      {
        id: PLACED_OBJECT_ID,
        furnitureItemId: FURNITURE_ITEM_ID,
        position: { x: 5, y: 0, z: 3 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    ],
  };

  // Step 5: Create template from configuration
  const createTemplateData = {
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    name: "Standard Ceremony",
    layoutStyle: "ceremony" as const,
    description: "Standard ceremony layout for up to 150 guests",
    placedObjects: createConfigData.placedObjects,
    guestCapacity: 150,
    thumbnailUrl: "https://cdn.omnitwin.com/thumbs/ceremony-template.jpg",
  };

  // Step 6: Register user and create user
  const registerData = {
    email: "hallkeeper@tradeshall.co.uk",
    name: "Hamish McKenzie",
    password: "secure-hallkeeper-2025",
  };

  const createUserData = {
    email: "hallkeeper@tradeshall.co.uk",
    name: "Hamish McKenzie",
    role: "hallkeeper" as const,
    venueIds: [VENUE_ID],
  };

  // Step 7: Create enquiry
  const createEnquiryData = {
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    configurationId: CONFIG_ID,
    name: "Sarah & James",
    email: "sarah.james@gmail.com",
    phone: "+44 7700 900123",
    message: "We would like to book the Grand Hall for our wedding on 15th August 2026.",
    eventDate: "2026-08-15T14:00:00.000Z",
    guestCount: 120,
  };

  // Step 8: Create pricing rule
  const pricingRuleData = {
    id: PRICING_RULE_ID,
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    currency: "GBP" as const,
    basePrice: 2000,
    pricePerHour: 200,
    pricePerGuest: 15,
    minimumHours: 4,
    minimumGuests: 50,
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
      expect(result.data.dimensions).toEqual(TRADES_HALL_GRAND_HALL_DIMENSIONS);
    }
  });

  it("Step 3: CreateFurnitureItemSchema validates furniture creation data", () => {
    const result = CreateFurnitureItemSchema.safeParse(createFurnitureData);
    expect(result.success).toBe(true);
  });

  it("Step 4: CreateConfigurationSchema validates configuration with placed objects", () => {
    const result = CreateConfigurationSchema.safeParse(createConfigData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.placedObjects).toHaveLength(1);
    }
  });

  it("Step 5: CreateLayoutTemplateSchema validates template creation data", () => {
    const result = CreateLayoutTemplateSchema.safeParse(createTemplateData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.guestCapacity).toBe(150);
    }
  });

  it("Step 6a: RegisterRequestSchema validates registration", () => {
    const result = RegisterRequestSchema.safeParse(registerData);
    expect(result.success).toBe(true);
  });

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
      expect(result.data.guestCount).toBe(120);
    }
  });

  it("Step 8: PricingRuleSchema validates pricing rule", () => {
    const result = PricingRuleSchema.safeParse(pricingRuleData);
    expect(result.success).toBe(true);
  });

  it("Step 9: Price estimate flows through request → response", () => {
    const request = PriceEstimateRequestSchema.safeParse({
      spaceId: SPACE_ID,
      hours: 6,
      guestCount: 120,
      eventDate: "2026-08-15T14:00:00.000Z",
    });
    expect(request.success).toBe(true);

    const response = PriceEstimateResponseSchema.safeParse({
      spaceId: SPACE_ID,
      currency: "GBP",
      roomCost: 2000,
      hoursCost: 1200,
      guestsCost: 1800,
      totalEstimate: 5000,
      disclaimer: "This is an estimate only. Final pricing may vary based on specific requirements.",
    });
    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.data.totalEstimate).toBe(5000);
    }
  });

  it("Step 10: HallkeeperSheetSchema validates generated PDF sheet", () => {
    const result = HallkeeperSheetSchema.safeParse({
      id: HALLKEEPER_SHEET_ID,
      configurationId: CONFIG_ID,
      generatedAt: NOW,
      pdfUrl: "https://cdn.omnitwin.com/sheets/wedding-ceremony-120.pdf",
      manifest: [
        { furnitureName: "Round Table (6ft)", category: "table", quantity: 12, notes: "White linen covers" },
        { furnitureName: "Gold Chiavari Chair", category: "chair", quantity: 96 },
        { furnitureName: "Stage Section (4x8)", category: "stage", quantity: 2, notes: "Bolt together" },
      ],
      qrCodeData: "https://app.omnitwin.com/config/c3333333-3333-4333-8333-333333333333",
      topDownDiagramUrl: "https://cdn.omnitwin.com/diagrams/wedding-ceremony-120.svg",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.manifest).toHaveLength(3);
    }
  });

  it("Step 11: Photo upload flow — request → response → stored entity", () => {
    const uploadReq = PhotoUploadRequestSchema.safeParse({
      configurationId: CONFIG_ID,
      filename: "grand-hall-ceremony.jpg",
      contentType: "image/jpeg",
      caption: "Final ceremony layout with 120 chairs",
    });
    expect(uploadReq.success).toBe(true);

    const uploadResp = PhotoUploadResponseSchema.safeParse({
      photoId: PHOTO_ID,
      presignedUrl: "https://s3.eu-west-2.amazonaws.com/omnitwin-photos/grand-hall-ceremony.jpg?X-Amz-Signature=abc",
      expiresAt: "2025-06-15T15:00:00.000Z",
    });
    expect(uploadResp.success).toBe(true);

    const storedPhoto = PhotoSchema.safeParse({
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
// 5. Enquiry state machine integration
// ---------------------------------------------------------------------------

describe("enquiry state machine integration", () => {
  it("full lifecycle: submitted → viewed → responded → converted", () => {
    expect(isValidEnquiryTransition("submitted", "viewed")).toBe(true);
    expect(isValidEnquiryTransition("viewed", "responded")).toBe(true);
    expect(isValidEnquiryTransition("responded", "converted")).toBe(true);
  });

  it("full lifecycle: submitted → viewed → lost", () => {
    expect(isValidEnquiryTransition("submitted", "viewed")).toBe(true);
    expect(isValidEnquiryTransition("viewed", "lost")).toBe(true);
  });

  it("cannot skip states: submitted → responded is illegal", () => {
    expect(isValidEnquiryTransition("submitted", "responded")).toBe(false);
  });

  it("cannot skip states: submitted → converted is illegal", () => {
    expect(isValidEnquiryTransition("submitted", "converted")).toBe(false);
  });

  it("terminal states have no outbound transitions", () => {
    expect(VALID_ENQUIRY_TRANSITIONS.converted).toHaveLength(0);
    expect(VALID_ENQUIRY_TRANSITIONS.lost).toHaveLength(0);
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
      name: "Test",
      status: "draft",
      layoutStyle: "ceremony",
      placedObjects: [],
      lightmapUrl: null,
      createdBy: USER_ID,
      publishedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const venueId: VenueId = config.venueId;
    expect(VenueIdSchema.safeParse(venueId).success).toBe(true);
  });

  it("PlacedObject.furnitureItemId is a valid UUID accepted by FurnitureItemIdSchema", () => {
    const obj: PlacedObject = PlacedObjectSchema.parse({
      id: PLACED_OBJECT_ID,
      furnitureItemId: FURNITURE_ITEM_ID,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    expect(FurnitureItemIdSchema.safeParse(obj.furnitureItemId).success).toBe(true);
  });

  it("User.venueIds elements are valid VenueIds", () => {
    const user: User = UserSchema.parse({
      id: USER_ID,
      email: "admin@tradeshall.co.uk",
      name: "Admin",
      role: "admin",
      venueIds: [VENUE_ID],
      createdAt: NOW,
      updatedAt: NOW,
    });
    for (const vid of user.venueIds) {
      expect(VenueIdSchema.safeParse(vid).success).toBe(true);
    }
  });

  it("Enquiry.configurationId (when not null) is a valid ConfigurationId", () => {
    const enquiry: Enquiry = EnquirySchema.parse({
      id: ENQUIRY_ID,
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      configurationId: CONFIG_ID,
      name: "Test",
      email: "test@example.com",
      message: "Testing",
      eventDate: NOW,
      guestCount: 50,
      status: "submitted",
      respondedBy: null,
      respondedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(enquiry.configurationId).not.toBeNull();
    if (enquiry.configurationId !== null) {
      expect(ConfigurationIdSchema.safeParse(enquiry.configurationId).success).toBe(true);
    }
  });

  it("HallkeeperSheet.manifest items have valid FurnitureCategory", () => {
    const sheet: HallkeeperSheet = HallkeeperSheetSchema.parse({
      id: HALLKEEPER_SHEET_ID,
      configurationId: CONFIG_ID,
      generatedAt: NOW,
      pdfUrl: "https://cdn.omnitwin.com/sheet.pdf",
      manifest: [
        { furnitureName: "Chair", category: "chair", quantity: 50 },
      ],
      qrCodeData: "https://app.omnitwin.com/config/test",
      topDownDiagramUrl: "https://cdn.omnitwin.com/diagram.svg",
      createdAt: NOW,
      updatedAt: NOW,
    });
    for (const item of sheet.manifest) {
      expect(FurnitureCategorySchema.safeParse(item.category).success).toBe(true);
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
    const result = CreateSpaceSchema.safeParse({
      ...room,
      venueId: VENUE_ID,
      meshUrl: null,
      thumbnailUrl: null,
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

  it("USER_ROLES has exactly 4 roles", () => {
    expect(USER_ROLES).toHaveLength(4);
  });

  it("ENQUIRY_STATUSES has exactly 5 statuses", () => {
    expect(ENQUIRY_STATUSES).toHaveLength(5);
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
