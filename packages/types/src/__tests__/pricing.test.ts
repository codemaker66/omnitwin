import { describe, it, expect } from "vitest";
import {
  PricingRuleIdSchema,
  SUPPORTED_CURRENCIES,
  CurrencySchema,
  PricingRuleSchema,
  PriceEstimateRequestSchema,
  PriceEstimateResponseSchema,
} from "../pricing.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const VALID_VENUE_UUID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const VALID_SPACE_UUID = "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f";
const VALID_DATETIME = "2025-01-15T10:30:00.000Z";

const validPricingRule = {
  id: VALID_UUID,
  venueId: VALID_VENUE_UUID,
  spaceId: VALID_SPACE_UUID,
  currency: "GBP" as const,
  basePrice: 500,
  pricePerHour: 150,
  pricePerGuest: 25,
  minimumHours: 4,
  minimumGuests: 20,
  createdAt: VALID_DATETIME,
  updatedAt: VALID_DATETIME,
};

const validEstimateRequest = {
  spaceId: VALID_SPACE_UUID,
  hours: 6,
  guestCount: 100,
  eventDate: "2025-06-15T14:00:00.000Z",
};

const validEstimateResponse = {
  spaceId: VALID_SPACE_UUID,
  currency: "GBP" as const,
  roomCost: 500,
  hoursCost: 900,
  guestsCost: 2500,
  totalEstimate: 3900,
  disclaimer: "This is an estimate only. Final pricing may vary.",
};

// ---------------------------------------------------------------------------
// PricingRuleIdSchema
// ---------------------------------------------------------------------------

describe("PricingRuleIdSchema", () => {
  it("accepts a valid UUID", () => {
    expect(PricingRuleIdSchema.safeParse(VALID_UUID).success).toBe(true);
  });

  it("rejects a non-UUID string", () => {
    expect(PricingRuleIdSchema.safeParse("bad").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CurrencySchema
// ---------------------------------------------------------------------------

describe("CurrencySchema", () => {
  it("accepts 'GBP'", () => {
    expect(CurrencySchema.safeParse("GBP").success).toBe(true);
  });

  it("has exactly 1 supported currency (for V1)", () => {
    expect(SUPPORTED_CURRENCIES).toHaveLength(1);
  });

  it("contains the expected currencies", () => {
    expect(SUPPORTED_CURRENCIES).toEqual(["GBP"]);
  });

  it("rejects 'gbp' (case sensitive)", () => {
    expect(CurrencySchema.safeParse("gbp").success).toBe(false);
  });

  it("rejects 'USD' (not supported in V1)", () => {
    expect(CurrencySchema.safeParse("USD").success).toBe(false);
  });

  it("rejects 'EUR' (not supported in V1)", () => {
    expect(CurrencySchema.safeParse("EUR").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(CurrencySchema.safeParse("").success).toBe(false);
  });

  it("rejects null", () => {
    expect(CurrencySchema.safeParse(null).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PricingRuleSchema
// ---------------------------------------------------------------------------

describe("PricingRuleSchema", () => {
  it("accepts a fully valid pricing rule", () => {
    const result = PricingRuleSchema.safeParse(validPricingRule);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.basePrice).toBe(500);
      expect(result.data.currency).toBe("GBP");
    }
  });

  it("accepts zero basePrice (free venue base)", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, basePrice: 0 }).success).toBe(true);
  });

  it("accepts zero pricePerHour", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, pricePerHour: 0 }).success).toBe(true);
  });

  it("accepts zero pricePerGuest", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, pricePerGuest: 0 }).success).toBe(true);
  });

  it("accepts fractional prices", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, basePrice: 99.99, pricePerHour: 12.50 }).success).toBe(true);
  });

  // --- Missing required fields ---

  it("rejects missing id", () => {
    const { id: _, ...noId } = validPricingRule;
    expect(PricingRuleSchema.safeParse(noId).success).toBe(false);
  });

  it("rejects missing venueId", () => {
    const { venueId: _, ...noVenueId } = validPricingRule;
    expect(PricingRuleSchema.safeParse(noVenueId).success).toBe(false);
  });

  it("rejects missing spaceId", () => {
    const { spaceId: _, ...noSpaceId } = validPricingRule;
    expect(PricingRuleSchema.safeParse(noSpaceId).success).toBe(false);
  });

  it("rejects missing currency", () => {
    const { currency: _, ...noCurrency } = validPricingRule;
    expect(PricingRuleSchema.safeParse(noCurrency).success).toBe(false);
  });

  it("rejects missing basePrice", () => {
    const { basePrice: _, ...noBasePrice } = validPricingRule;
    expect(PricingRuleSchema.safeParse(noBasePrice).success).toBe(false);
  });

  it("rejects missing pricePerHour", () => {
    const { pricePerHour: _, ...noPPH } = validPricingRule;
    expect(PricingRuleSchema.safeParse(noPPH).success).toBe(false);
  });

  it("rejects missing pricePerGuest", () => {
    const { pricePerGuest: _, ...noPPG } = validPricingRule;
    expect(PricingRuleSchema.safeParse(noPPG).success).toBe(false);
  });

  it("rejects missing minimumHours", () => {
    const { minimumHours: _, ...noMinHours } = validPricingRule;
    expect(PricingRuleSchema.safeParse(noMinHours).success).toBe(false);
  });

  it("rejects missing minimumGuests", () => {
    const { minimumGuests: _, ...noMinGuests } = validPricingRule;
    expect(PricingRuleSchema.safeParse(noMinGuests).success).toBe(false);
  });

  it("rejects missing createdAt", () => {
    const { createdAt: _, ...noCreatedAt } = validPricingRule;
    expect(PricingRuleSchema.safeParse(noCreatedAt).success).toBe(false);
  });

  it("rejects missing updatedAt", () => {
    const { updatedAt: _, ...noUpdatedAt } = validPricingRule;
    expect(PricingRuleSchema.safeParse(noUpdatedAt).success).toBe(false);
  });

  // --- Invalid values ---

  it("rejects negative basePrice", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, basePrice: -1 }).success).toBe(false);
  });

  it("rejects negative pricePerHour", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, pricePerHour: -50 }).success).toBe(false);
  });

  it("rejects negative pricePerGuest", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, pricePerGuest: -10 }).success).toBe(false);
  });

  it("rejects basePrice exceeding 1000000", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, basePrice: 1_000_001 }).success).toBe(false);
  });

  it("accepts basePrice of exactly 1000000", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, basePrice: 1_000_000 }).success).toBe(true);
  });

  it("rejects zero minimumHours", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, minimumHours: 0 }).success).toBe(false);
  });

  it("rejects negative minimumHours", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, minimumHours: -1 }).success).toBe(false);
  });

  it("rejects float minimumHours", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, minimumHours: 2.5 }).success).toBe(false);
  });

  it("accepts minimumHours of 168 (one week)", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, minimumHours: 168 }).success).toBe(true);
  });

  it("rejects minimumHours exceeding 168", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, minimumHours: 169 }).success).toBe(false);
  });

  it("rejects zero minimumGuests", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, minimumGuests: 0 }).success).toBe(false);
  });

  it("rejects float minimumGuests", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, minimumGuests: 5.5 }).success).toBe(false);
  });

  it("rejects minimumGuests exceeding 10000", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, minimumGuests: 10001 }).success).toBe(false);
  });

  it("rejects invalid UUID for id", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, id: "bad" }).success).toBe(false);
  });

  it("rejects invalid currency", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, currency: "USD" }).success).toBe(false);
  });

  it("rejects invalid datetime for createdAt", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, createdAt: "nope" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PriceEstimateRequestSchema
// ---------------------------------------------------------------------------

describe("PriceEstimateRequestSchema", () => {
  it("accepts a valid estimate request", () => {
    const result = PriceEstimateRequestSchema.safeParse(validEstimateRequest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hours).toBe(6);
      expect(result.data.guestCount).toBe(100);
    }
  });

  it("rejects missing spaceId", () => {
    const { spaceId: _, ...noSpaceId } = validEstimateRequest;
    expect(PriceEstimateRequestSchema.safeParse(noSpaceId).success).toBe(false);
  });

  it("rejects missing hours", () => {
    const { hours: _, ...noHours } = validEstimateRequest;
    expect(PriceEstimateRequestSchema.safeParse(noHours).success).toBe(false);
  });

  it("rejects missing guestCount", () => {
    const { guestCount: _, ...noGuests } = validEstimateRequest;
    expect(PriceEstimateRequestSchema.safeParse(noGuests).success).toBe(false);
  });

  it("rejects missing eventDate", () => {
    const { eventDate: _, ...noDate } = validEstimateRequest;
    expect(PriceEstimateRequestSchema.safeParse(noDate).success).toBe(false);
  });

  it("rejects zero hours", () => {
    expect(PriceEstimateRequestSchema.safeParse({ ...validEstimateRequest, hours: 0 }).success).toBe(false);
  });

  it("rejects negative hours", () => {
    expect(PriceEstimateRequestSchema.safeParse({ ...validEstimateRequest, hours: -1 }).success).toBe(false);
  });

  it("rejects float hours", () => {
    expect(PriceEstimateRequestSchema.safeParse({ ...validEstimateRequest, hours: 2.5 }).success).toBe(false);
  });

  it("rejects hours exceeding 168", () => {
    expect(PriceEstimateRequestSchema.safeParse({ ...validEstimateRequest, hours: 169 }).success).toBe(false);
  });

  it("rejects zero guest count", () => {
    expect(PriceEstimateRequestSchema.safeParse({ ...validEstimateRequest, guestCount: 0 }).success).toBe(false);
  });

  it("rejects negative guest count", () => {
    expect(PriceEstimateRequestSchema.safeParse({ ...validEstimateRequest, guestCount: -5 }).success).toBe(false);
  });

  it("rejects float guest count", () => {
    expect(PriceEstimateRequestSchema.safeParse({ ...validEstimateRequest, guestCount: 10.5 }).success).toBe(false);
  });

  it("rejects guest count exceeding 10000", () => {
    expect(PriceEstimateRequestSchema.safeParse({ ...validEstimateRequest, guestCount: 10001 }).success).toBe(false);
  });

  it("rejects invalid datetime for eventDate", () => {
    expect(PriceEstimateRequestSchema.safeParse({ ...validEstimateRequest, eventDate: "nope" }).success).toBe(false);
  });

  it("rejects invalid UUID for spaceId", () => {
    expect(PriceEstimateRequestSchema.safeParse({ ...validEstimateRequest, spaceId: "bad" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PriceEstimateResponseSchema
// ---------------------------------------------------------------------------

describe("PriceEstimateResponseSchema", () => {
  it("accepts a valid estimate response", () => {
    const result = PriceEstimateResponseSchema.safeParse(validEstimateResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalEstimate).toBe(3900);
      expect(result.data.currency).toBe("GBP");
    }
  });

  it("accepts all-zero costs (free event)", () => {
    const result = PriceEstimateResponseSchema.safeParse({
      ...validEstimateResponse,
      roomCost: 0,
      hoursCost: 0,
      guestsCost: 0,
      totalEstimate: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts fractional costs (pence precision)", () => {
    expect(
      PriceEstimateResponseSchema.safeParse({
        ...validEstimateResponse,
        roomCost: 99.99,
        totalEstimate: 99.99,
      }).success,
    ).toBe(true);
  });

  // --- Missing required fields ---

  it("rejects missing spaceId", () => {
    const { spaceId: _, ...noSpaceId } = validEstimateResponse;
    expect(PriceEstimateResponseSchema.safeParse(noSpaceId).success).toBe(false);
  });

  it("rejects missing currency", () => {
    const { currency: _, ...noCurrency } = validEstimateResponse;
    expect(PriceEstimateResponseSchema.safeParse(noCurrency).success).toBe(false);
  });

  it("rejects missing roomCost", () => {
    const { roomCost: _, ...noRoomCost } = validEstimateResponse;
    expect(PriceEstimateResponseSchema.safeParse(noRoomCost).success).toBe(false);
  });

  it("rejects missing hoursCost", () => {
    const { hoursCost: _, ...noHoursCost } = validEstimateResponse;
    expect(PriceEstimateResponseSchema.safeParse(noHoursCost).success).toBe(false);
  });

  it("rejects missing guestsCost", () => {
    const { guestsCost: _, ...noGuestsCost } = validEstimateResponse;
    expect(PriceEstimateResponseSchema.safeParse(noGuestsCost).success).toBe(false);
  });

  it("rejects missing totalEstimate", () => {
    const { totalEstimate: _, ...noTotal } = validEstimateResponse;
    expect(PriceEstimateResponseSchema.safeParse(noTotal).success).toBe(false);
  });

  it("rejects missing disclaimer", () => {
    const { disclaimer: _, ...noDisclaimer } = validEstimateResponse;
    expect(PriceEstimateResponseSchema.safeParse(noDisclaimer).success).toBe(false);
  });

  // --- Invalid values ---

  it("rejects negative roomCost", () => {
    expect(PriceEstimateResponseSchema.safeParse({ ...validEstimateResponse, roomCost: -1 }).success).toBe(false);
  });

  it("rejects negative hoursCost", () => {
    expect(PriceEstimateResponseSchema.safeParse({ ...validEstimateResponse, hoursCost: -1 }).success).toBe(false);
  });

  it("rejects negative guestsCost", () => {
    expect(PriceEstimateResponseSchema.safeParse({ ...validEstimateResponse, guestsCost: -1 }).success).toBe(false);
  });

  it("rejects negative totalEstimate", () => {
    expect(PriceEstimateResponseSchema.safeParse({ ...validEstimateResponse, totalEstimate: -100 }).success).toBe(false);
  });

  it("rejects empty disclaimer", () => {
    expect(PriceEstimateResponseSchema.safeParse({ ...validEstimateResponse, disclaimer: "" }).success).toBe(false);
  });

  it("rejects invalid currency", () => {
    expect(PriceEstimateResponseSchema.safeParse({ ...validEstimateResponse, currency: "EUR" }).success).toBe(false);
  });

  it("rejects invalid UUID for spaceId", () => {
    expect(PriceEstimateResponseSchema.safeParse({ ...validEstimateResponse, spaceId: "bad" }).success).toBe(false);
  });
});
