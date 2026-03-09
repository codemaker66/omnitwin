import { describe, it, expect } from "vitest";
import {
  VenueIdSchema,
  VenueSlugSchema,
  BrandColourSchema,
  VenueSchema,
  CreateVenueSchema,
} from "../venue.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const VALID_DATETIME = "2025-01-15T10:30:00.000Z";

const validVenue = {
  id: VALID_UUID,
  name: "Trades Hall Glasgow",
  address: "85 Glassford Street, Glasgow G1 1UH",
  slug: "trades-hall-glasgow",
  logoUrl: "https://example.com/logo.png",
  brandColour: "#1A2B3C",
  createdAt: VALID_DATETIME,
  updatedAt: VALID_DATETIME,
};

const validCreateVenue = {
  name: "Trades Hall Glasgow",
  address: "85 Glassford Street, Glasgow G1 1UH",
  slug: "trades-hall-glasgow",
  logoUrl: "https://example.com/logo.png",
  brandColour: "#1A2B3C",
};

// ---------------------------------------------------------------------------
// VenueIdSchema
// ---------------------------------------------------------------------------

describe("VenueIdSchema", () => {
  it("accepts a valid UUID v4", () => {
    const result = VenueIdSchema.safeParse(VALID_UUID);
    expect(result.success).toBe(true);
  });

  it("rejects a non-UUID string", () => {
    const result = VenueIdSchema.safeParse("not-a-uuid");
    expect(result.success).toBe(false);
  });

  it("rejects an empty string", () => {
    const result = VenueIdSchema.safeParse("");
    expect(result.success).toBe(false);
  });

  it("rejects a number", () => {
    const result = VenueIdSchema.safeParse(12345);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VenueSlugSchema
// ---------------------------------------------------------------------------

describe("VenueSlugSchema", () => {
  it("accepts a valid slug", () => {
    const result = VenueSlugSchema.safeParse("trades-hall-glasgow");
    expect(result.success).toBe(true);
  });

  it("accepts a single word slug", () => {
    const result = VenueSlugSchema.safeParse("venue");
    expect(result.success).toBe(true);
  });

  it("rejects uppercase characters", () => {
    const result = VenueSlugSchema.safeParse("Trades-Hall");
    expect(result.success).toBe(false);
  });

  it("rejects spaces", () => {
    const result = VenueSlugSchema.safeParse("trades hall");
    expect(result.success).toBe(false);
  });

  it("rejects leading hyphen", () => {
    const result = VenueSlugSchema.safeParse("-trades-hall");
    expect(result.success).toBe(false);
  });

  it("rejects trailing hyphen", () => {
    const result = VenueSlugSchema.safeParse("trades-hall-");
    expect(result.success).toBe(false);
  });

  it("rejects consecutive hyphens", () => {
    const result = VenueSlugSchema.safeParse("trades--hall");
    expect(result.success).toBe(false);
  });

  it("rejects empty string", () => {
    const result = VenueSlugSchema.safeParse("");
    expect(result.success).toBe(false);
  });

  it("rejects slug over 100 characters", () => {
    const result = VenueSlugSchema.safeParse("a".repeat(101));
    expect(result.success).toBe(false);
  });

  it("accepts slug of exactly 100 characters", () => {
    const result = VenueSlugSchema.safeParse("a".repeat(100));
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BrandColourSchema
// ---------------------------------------------------------------------------

describe("BrandColourSchema", () => {
  it("accepts a valid hex colour", () => {
    const result = BrandColourSchema.safeParse("#FF5733");
    expect(result.success).toBe(true);
  });

  it("accepts lowercase hex colour", () => {
    const result = BrandColourSchema.safeParse("#ff5733");
    expect(result.success).toBe(true);
  });

  it("accepts mixed case hex colour", () => {
    const result = BrandColourSchema.safeParse("#aAbBcC");
    expect(result.success).toBe(true);
  });

  it("accepts null", () => {
    const result = BrandColourSchema.safeParse(null);
    expect(result.success).toBe(true);
  });

  it("rejects 3-digit hex shorthand", () => {
    const result = BrandColourSchema.safeParse("#F00");
    expect(result.success).toBe(false);
  });

  it("rejects 8-digit hex (with alpha)", () => {
    const result = BrandColourSchema.safeParse("#FF5733AA");
    expect(result.success).toBe(false);
  });

  it("rejects missing hash", () => {
    const result = BrandColourSchema.safeParse("FF5733");
    expect(result.success).toBe(false);
  });

  it("rejects non-hex characters", () => {
    const result = BrandColourSchema.safeParse("#GGGGGG");
    expect(result.success).toBe(false);
  });

  it("rejects empty string", () => {
    const result = BrandColourSchema.safeParse("");
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VenueSchema — full entity
// ---------------------------------------------------------------------------

describe("VenueSchema", () => {
  it("accepts a fully valid venue", () => {
    const result = VenueSchema.safeParse(validVenue);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Trades Hall Glasgow");
    }
  });

  it("accepts null logoUrl", () => {
    const result = VenueSchema.safeParse({ ...validVenue, logoUrl: null });
    expect(result.success).toBe(true);
  });

  it("accepts null brandColour", () => {
    const result = VenueSchema.safeParse({ ...validVenue, brandColour: null });
    expect(result.success).toBe(true);
  });

  it("trims whitespace from name", () => {
    const result = VenueSchema.safeParse({ ...validVenue, name: "  Trades Hall  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Trades Hall");
    }
  });

  it("trims whitespace from address", () => {
    const result = VenueSchema.safeParse({ ...validVenue, address: "  85 Glassford Street  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.address).toBe("85 Glassford Street");
    }
  });

  it("rejects whitespace-only name (empty after trim)", () => {
    const result = VenueSchema.safeParse({ ...validVenue, name: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only address (empty after trim)", () => {
    const result = VenueSchema.safeParse({ ...validVenue, address: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects missing id", () => {
    const { id: _, ...noId } = validVenue;
    const result = VenueSchema.safeParse(noId);
    expect(result.success).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _, ...noName } = validVenue;
    const result = VenueSchema.safeParse(noName);
    expect(result.success).toBe(false);
  });

  it("rejects missing address", () => {
    const { address: _, ...noAddress } = validVenue;
    const result = VenueSchema.safeParse(noAddress);
    expect(result.success).toBe(false);
  });

  it("rejects missing slug", () => {
    const { slug: _, ...noSlug } = validVenue;
    const result = VenueSchema.safeParse(noSlug);
    expect(result.success).toBe(false);
  });

  it("rejects missing logoUrl", () => {
    const { logoUrl: _, ...noLogo } = validVenue;
    const result = VenueSchema.safeParse(noLogo);
    expect(result.success).toBe(false);
  });

  it("rejects missing brandColour", () => {
    const { brandColour: _, ...noBrand } = validVenue;
    const result = VenueSchema.safeParse(noBrand);
    expect(result.success).toBe(false);
  });

  it("rejects missing createdAt", () => {
    const { createdAt: _, ...noCreatedAt } = validVenue;
    const result = VenueSchema.safeParse(noCreatedAt);
    expect(result.success).toBe(false);
  });

  it("rejects missing updatedAt", () => {
    const { updatedAt: _, ...noUpdatedAt } = validVenue;
    const result = VenueSchema.safeParse(noUpdatedAt);
    expect(result.success).toBe(false);
  });

  it("rejects invalid UUID for id", () => {
    const result = VenueSchema.safeParse({ ...validVenue, id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid URL for logoUrl", () => {
    const result = VenueSchema.safeParse({ ...validVenue, logoUrl: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid hex for brandColour", () => {
    const result = VenueSchema.safeParse({ ...validVenue, brandColour: "red" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid datetime for createdAt", () => {
    const result = VenueSchema.safeParse({ ...validVenue, createdAt: "not-a-date" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid datetime for updatedAt", () => {
    const result = VenueSchema.safeParse({ ...validVenue, updatedAt: "2025-13-45" });
    expect(result.success).toBe(false);
  });

  it("rejects name exceeding 200 characters", () => {
    const result = VenueSchema.safeParse({ ...validVenue, name: "A".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("accepts name of exactly 200 characters", () => {
    const result = VenueSchema.safeParse({ ...validVenue, name: "A".repeat(200) });
    expect(result.success).toBe(true);
  });

  it("rejects address exceeding 500 characters", () => {
    const result = VenueSchema.safeParse({ ...validVenue, address: "A".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("rejects empty string name", () => {
    const result = VenueSchema.safeParse({ ...validVenue, name: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CreateVenueSchema — creation payload
// ---------------------------------------------------------------------------

describe("CreateVenueSchema", () => {
  it("accepts a fully valid create venue payload", () => {
    const result = CreateVenueSchema.safeParse(validCreateVenue);
    expect(result.success).toBe(true);
  });

  it("rejects missing name", () => {
    const { name: _, ...noName } = validCreateVenue;
    const result = CreateVenueSchema.safeParse(noName);
    expect(result.success).toBe(false);
  });

  it("rejects missing address", () => {
    const { address: _, ...noAddress } = validCreateVenue;
    const result = CreateVenueSchema.safeParse(noAddress);
    expect(result.success).toBe(false);
  });

  it("rejects missing slug", () => {
    const { slug: _, ...noSlug } = validCreateVenue;
    const result = CreateVenueSchema.safeParse(noSlug);
    expect(result.success).toBe(false);
  });

  it("rejects missing logoUrl", () => {
    const { logoUrl: _, ...noLogo } = validCreateVenue;
    const result = CreateVenueSchema.safeParse(noLogo);
    expect(result.success).toBe(false);
  });

  it("rejects missing brandColour", () => {
    const { brandColour: _, ...noBrand } = validCreateVenue;
    const result = CreateVenueSchema.safeParse(noBrand);
    expect(result.success).toBe(false);
  });

  it("does not accept id field (strips extra keys)", () => {
    const result = CreateVenueSchema.safeParse({ ...validCreateVenue, id: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("id" in result.data).toBe(false);
    }
  });

  it("does not accept createdAt field (strips extra keys)", () => {
    const result = CreateVenueSchema.safeParse({ ...validCreateVenue, createdAt: VALID_DATETIME });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("createdAt" in result.data).toBe(false);
    }
  });

  it("accepts null for both nullable fields", () => {
    const result = CreateVenueSchema.safeParse({
      ...validCreateVenue,
      logoUrl: null,
      brandColour: null,
    });
    expect(result.success).toBe(true);
  });
});
