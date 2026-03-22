import { describe, it, expect } from "vitest";
import {
  CreateVenueSchema,
  CreateSpaceSchema,
  CreateFurnitureItemSchema,
  CreateUserSchema,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Seed data validation — verify seed objects pass @omnitwin/types Zod schemas
// ---------------------------------------------------------------------------

const UUID = "00000000-0000-0000-0000-000000000001";

describe("seed venue passes CreateVenueSchema", () => {
  it("validates the Trades Hall venue", () => {
    const result = CreateVenueSchema.safeParse({
      name: "Trades Hall Glasgow",
      slug: "trades-hall-glasgow",
      address: "85 Glassford Street, Glasgow G1 1UH",
      logoUrl: null,
      brandColour: "#1a1a2e",
    });
    expect(result.success).toBe(true);
  });
});

describe("seed spaces pass CreateSpaceSchema", () => {
  const spaces = [
    { name: "Grand Hall", slug: "grand-hall", width: 21, length: 10, height: 7 },
    { name: "Saloon", slug: "saloon", width: 12, length: 7, height: 5.4 },
    { name: "Reception Room", slug: "reception-room", width: 13.4, length: 11.2, height: 3.2 },
    { name: "Robert Adam Room", slug: "robert-adam-room", width: 9.7, length: 5.6, height: 2.18 },
  ];

  for (const s of spaces) {
    it(`validates ${s.name}`, () => {
      const hw = s.width / 2;
      const hl = s.length / 2;
      const result = CreateSpaceSchema.safeParse({
        venueId: UUID,
        name: s.name,
        slug: s.slug,
        description: "",
        dimensions: { width: s.width, length: s.length, height: s.height },
        sortOrder: 0,
        floorPlanOutline: [
          { x: -hw, y: -hl },
          { x: hw, y: -hl },
          { x: hw, y: hl },
          { x: -hw, y: hl },
        ],
        meshUrl: null,
        thumbnailUrl: null,
      });
      expect(result.success).toBe(true);
    });
  }
});

describe("seed assets pass CreateFurnitureItemSchema", () => {
  // Note: DB asset_definitions uses different categories than @omnitwin/types
  // FurnitureCategory. This test validates items that map cleanly to the
  // @omnitwin/types schema. Items like "staging", "danceFloor", "misc" are
  // DB-only categories that don't map 1:1 to the frontend FurnitureCategory.
  const assets = [
    { name: "Round Table 5ft", category: "table", width: 1.524, depth: 1.524, height: 0.762 },
    { name: "Round Table 6ft", category: "table", width: 1.829, depth: 1.829, height: 0.762 },
    { name: "Standard Chair", category: "chair", width: 0.45, depth: 0.45, height: 0.9 },
    { name: "Lectern", category: "lectern", width: 0.6, depth: 0.5, height: 1.1 },
  ];

  for (const a of assets) {
    it(`validates ${a.name}`, () => {
      const result = CreateFurnitureItemSchema.safeParse({
        venueId: UUID,
        name: a.name,
        category: a.category,
        defaultDimensions: { width: a.width, depth: a.depth, height: a.height },
        meshUrl: null,
        thumbnailUrl: null,
        stackable: false,
        maxStack: 1,
      });
      expect(result.success).toBe(true);
    });
  }
});

describe("seed users pass CreateUserSchema", () => {
  const seedUsers = [
    { email: "admin@tradeshall.co.uk", name: "Admin User", role: "admin" },
    { email: "elaine@tradeshall.co.uk", name: "Elaine MacGregor", role: "staff" },
  ];

  for (const u of seedUsers) {
    it(`validates ${u.email}`, () => {
      const result = CreateUserSchema.safeParse({
        email: u.email,
        name: u.name,
        role: u.role,
        venueIds: [UUID],
      });
      expect(result.success).toBe(true);
    });
  }
});
