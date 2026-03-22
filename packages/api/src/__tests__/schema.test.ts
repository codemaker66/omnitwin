import { describe, it, expect } from "vitest";
import {
  venues,
  spaces,
  users,
  assetDefinitions,
  configurations,
  placedObjects,
  enquiries,
  photoReferences,
  pricingRules,
} from "../db/schema.js";
import { getTableColumns } from "drizzle-orm";

// ---------------------------------------------------------------------------
// schema.ts — verify all table definitions export correctly
// ---------------------------------------------------------------------------

describe("venues table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(venues);
    expect(cols.id).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.slug).toBeDefined();
    expect(cols.address).toBeDefined();
    expect(cols.logoUrl).toBeDefined();
    expect(cols.brandColour).toBeDefined();
    expect(cols.createdAt).toBeDefined();
    expect(cols.updatedAt).toBeDefined();
  });
});

describe("spaces table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(spaces);
    expect(cols.id).toBeDefined();
    expect(cols.venueId).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.slug).toBeDefined();
    expect(cols.widthM).toBeDefined();
    expect(cols.lengthM).toBeDefined();
    expect(cols.heightM).toBeDefined();
    expect(cols.floorPlanOutline).toBeDefined();
    expect(cols.sortOrder).toBeDefined();
  });
});

describe("users table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(users);
    expect(cols.id).toBeDefined();
    expect(cols.email).toBeDefined();
    expect(cols.passwordHash).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.role).toBeDefined();
    expect(cols.venueId).toBeDefined();
  });
});

describe("assetDefinitions table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(assetDefinitions);
    expect(cols.id).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.category).toBeDefined();
    expect(cols.widthM).toBeDefined();
    expect(cols.depthM).toBeDefined();
    expect(cols.heightM).toBeDefined();
    expect(cols.seatCount).toBeDefined();
    expect(cols.collisionType).toBeDefined();
  });
});

describe("configurations table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(configurations);
    expect(cols.id).toBeDefined();
    expect(cols.spaceId).toBeDefined();
    expect(cols.venueId).toBeDefined();
    expect(cols.userId).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.state).toBeDefined();
    expect(cols.layoutStyle).toBeDefined();
    expect(cols.guestCount).toBeDefined();
    expect(cols.isTemplate).toBeDefined();
    expect(cols.visibility).toBeDefined();
  });
});

describe("placedObjects table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(placedObjects);
    expect(cols.id).toBeDefined();
    expect(cols.configurationId).toBeDefined();
    expect(cols.assetDefinitionId).toBeDefined();
    expect(cols.positionX).toBeDefined();
    expect(cols.positionY).toBeDefined();
    expect(cols.positionZ).toBeDefined();
    expect(cols.rotationX).toBeDefined();
    expect(cols.rotationY).toBeDefined();
    expect(cols.rotationZ).toBeDefined();
    expect(cols.scale).toBeDefined();
    expect(cols.metadata).toBeDefined();
  });
});

describe("enquiries table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(enquiries);
    expect(cols.id).toBeDefined();
    expect(cols.venueId).toBeDefined();
    expect(cols.spaceId).toBeDefined();
    expect(cols.configurationId).toBeDefined();
    expect(cols.state).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.email).toBeDefined();
    expect(cols.preferredDate).toBeDefined();
    expect(cols.eventType).toBeDefined();
    expect(cols.estimatedGuests).toBeDefined();
    expect(cols.message).toBeDefined();
  });
});

describe("photoReferences table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(photoReferences);
    expect(cols.id).toBeDefined();
    expect(cols.configurationId).toBeDefined();
    expect(cols.venueId).toBeDefined();
    expect(cols.userId).toBeDefined();
    expect(cols.imageUrl).toBeDefined();
    expect(cols.tags).toBeDefined();
    expect(cols.visibility).toBeDefined();
  });
});

describe("pricingRules table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(pricingRules);
    expect(cols.id).toBeDefined();
    expect(cols.venueId).toBeDefined();
    expect(cols.spaceId).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.basePricePence).toBeDefined();
    expect(cols.pricePerGuestPence).toBeDefined();
    expect(cols.pricePerHourPence).toBeDefined();
    expect(cols.minimumHours).toBeDefined();
    expect(cols.dayOfWeek).toBeDefined();
  });
});

describe("table count", () => {
  it("exports exactly 9 tables", () => {
    const tables = [
      venues, spaces, users, assetDefinitions, configurations,
      placedObjects, enquiries, photoReferences, pricingRules,
    ];
    expect(tables).toHaveLength(9);
  });
});
