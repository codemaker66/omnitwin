import { describe, it, expect } from "vitest";
import {
  PricingRuleIdSchema,
  SUPPORTED_CURRENCIES,
  CurrencySchema,
  PRICING_TYPES,
  PricingTypeSchema,
  TierSchema,
  PricingRuleSchema,
  CreatePricingRuleSchema,
  PriceEstimateRequestSchema,
  PriceEstimateResponseSchema,
  LineItemSchema,
  ModifierSchema,
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
  name: "Grand Hall — Half Day",
  type: "flat_rate" as const,
  amount: 550,
  currency: "GBP" as const,
  minHours: null,
  minGuests: null,
  tiers: null,
  dayOfWeekModifiers: null,
  seasonalModifiers: null,
  validFrom: null,
  validTo: null,
  isActive: true,
  createdAt: VALID_DATETIME,
  updatedAt: VALID_DATETIME,
};

const validEstimateRequest = {
  spaceId: VALID_SPACE_UUID,
  eventDate: "2025-06-15",
  startTime: "09:00",
  endTime: "13:00",
  guestCount: 100,
};

const validEstimateResponse = {
  lineItems: [
    { ruleName: "Grand Hall — Half Day", description: "Flat rate", amount: 550 },
  ],
  subtotal: 550,
  modifiers: [],
  total: 550,
  currency: "GBP" as const,
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

  it("rejects empty string", () => {
    expect(CurrencySchema.safeParse("").success).toBe(false);
  });

  it("rejects null", () => {
    expect(CurrencySchema.safeParse(null).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PricingTypeSchema
// ---------------------------------------------------------------------------

describe("PricingTypeSchema", () => {
  it("has exactly 4 pricing types", () => {
    expect(PRICING_TYPES).toHaveLength(4);
  });

  it.each(["flat_rate", "per_hour", "per_head", "tiered"] as const)("accepts '%s'", (t) => {
    expect(PricingTypeSchema.safeParse(t).success).toBe(true);
  });

  it("rejects unknown type", () => {
    expect(PricingTypeSchema.safeParse("per_day").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(PricingTypeSchema.safeParse("").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TierSchema
// ---------------------------------------------------------------------------

describe("TierSchema", () => {
  it("accepts valid tier", () => {
    expect(TierSchema.safeParse({ upTo: 50, amount: 500 }).success).toBe(true);
  });

  it("rejects zero upTo", () => {
    expect(TierSchema.safeParse({ upTo: 0, amount: 500 }).success).toBe(false);
  });

  it("rejects negative amount", () => {
    expect(TierSchema.safeParse({ upTo: 50, amount: -1 }).success).toBe(false);
  });

  it("accepts zero amount (free tier)", () => {
    expect(TierSchema.safeParse({ upTo: 10, amount: 0 }).success).toBe(true);
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
      expect(result.data.amount).toBe(550);
      expect(result.data.type).toBe("flat_rate");
      expect(result.data.currency).toBe("GBP");
    }
  });

  it("accepts null spaceId (venue-wide rule)", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, spaceId: null }).success).toBe(true);
  });

  it("accepts zero amount", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, amount: 0 }).success).toBe(true);
  });

  it("accepts fractional amounts", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, amount: 99.99 }).success).toBe(true);
  });

  it("accepts rule with tiers", () => {
    const withTiers = {
      ...validPricingRule,
      type: "tiered" as const,
      tiers: [{ upTo: 50, amount: 300 }, { upTo: 100, amount: 500 }],
    };
    expect(PricingRuleSchema.safeParse(withTiers).success).toBe(true);
  });

  it("accepts rule with day-of-week modifiers", () => {
    const withMods = {
      ...validPricingRule,
      dayOfWeekModifiers: { saturday: 1.5, sunday: 1.3 },
    };
    expect(PricingRuleSchema.safeParse(withMods).success).toBe(true);
  });

  it("accepts rule with seasonal modifiers", () => {
    const withSeasonal = {
      ...validPricingRule,
      seasonalModifiers: { december: 1.25 },
    };
    expect(PricingRuleSchema.safeParse(withSeasonal).success).toBe(true);
  });

  it("accepts rule with date validity range", () => {
    const withDates = {
      ...validPricingRule,
      validFrom: "2025-01-01",
      validTo: "2025-12-31",
    };
    expect(PricingRuleSchema.safeParse(withDates).success).toBe(true);
  });

  it("accepts per_hour with minHours", () => {
    const perHour = {
      ...validPricingRule,
      type: "per_hour" as const,
      amount: 100,
      minHours: 4,
    };
    expect(PricingRuleSchema.safeParse(perHour).success).toBe(true);
  });

  it("accepts per_head with minGuests", () => {
    const perHead = {
      ...validPricingRule,
      type: "per_head" as const,
      amount: 25,
      minGuests: 20,
    };
    expect(PricingRuleSchema.safeParse(perHead).success).toBe(true);
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

  it("rejects missing name", () => {
    const { name: _, ...noName } = validPricingRule;
    expect(PricingRuleSchema.safeParse(noName).success).toBe(false);
  });

  it("rejects missing type", () => {
    const { type: _, ...noType } = validPricingRule;
    expect(PricingRuleSchema.safeParse(noType).success).toBe(false);
  });

  it("rejects missing amount", () => {
    const { amount: _, ...noAmount } = validPricingRule;
    expect(PricingRuleSchema.safeParse(noAmount).success).toBe(false);
  });

  it("rejects missing currency", () => {
    const { currency: _, ...noCurrency } = validPricingRule;
    expect(PricingRuleSchema.safeParse(noCurrency).success).toBe(false);
  });

  it("rejects missing isActive", () => {
    const { isActive: _, ...noActive } = validPricingRule;
    expect(PricingRuleSchema.safeParse(noActive).success).toBe(false);
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

  it("rejects negative amount", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, amount: -1 }).success).toBe(false);
  });

  it("rejects amount exceeding max", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, amount: 1_000_001 }).success).toBe(false);
  });

  it("rejects empty name", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, name: "" }).success).toBe(false);
  });

  it("rejects name exceeding 200 chars", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, name: "a".repeat(201) }).success).toBe(false);
  });

  it("rejects invalid type", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, type: "custom" }).success).toBe(false);
  });

  it("rejects invalid date format for validFrom", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, validFrom: "2025/01/01" }).success).toBe(false);
  });

  it("rejects invalid date format for validTo", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, validTo: "Jan 1 2025" }).success).toBe(false);
  });

  it("rejects non-positive minHours", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, minHours: 0 }).success).toBe(false);
  });

  it("rejects minHours exceeding 168", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, minHours: 169 }).success).toBe(false);
  });

  it("rejects non-positive minGuests", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, minGuests: 0 }).success).toBe(false);
  });

  it("rejects minGuests exceeding 10000", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, minGuests: 10_001 }).success).toBe(false);
  });

  it("accepts exactly 1000000 amount (boundary)", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, amount: 1_000_000 }).success).toBe(true);
  });

  it("rejects non-UUID id", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, id: "bad" }).success).toBe(false);
  });

  it("rejects non-boolean isActive", () => {
    expect(PricingRuleSchema.safeParse({ ...validPricingRule, isActive: "yes" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CreatePricingRuleSchema
// ---------------------------------------------------------------------------

describe("CreatePricingRuleSchema", () => {
  it("accepts minimal valid input", () => {
    const result = CreatePricingRuleSchema.safeParse({
      name: "Grand Hall — Half Day",
      type: "flat_rate",
      amount: 550,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe("GBP"); // default
      expect(result.data.isActive).toBe(true);   // default
    }
  });

  it("accepts full input with all optional fields", () => {
    const result = CreatePricingRuleSchema.safeParse({
      spaceId: VALID_SPACE_UUID,
      name: "Weekend Evening Rate",
      type: "per_hour",
      amount: 200,
      currency: "GBP",
      minHours: 4,
      minGuests: null,
      tiers: null,
      dayOfWeekModifiers: { saturday: 1.5, sunday: 1.5 },
      seasonalModifiers: null,
      validFrom: "2025-01-01",
      validTo: "2025-12-31",
      isActive: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts null spaceId (venue-wide)", () => {
    const result = CreatePricingRuleSchema.safeParse({
      name: "Exclusive Venue Hire",
      type: "flat_rate",
      amount: 2500,
      spaceId: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing name", () => {
    expect(CreatePricingRuleSchema.safeParse({ type: "flat_rate", amount: 100 }).success).toBe(false);
  });

  it("rejects missing type", () => {
    expect(CreatePricingRuleSchema.safeParse({ name: "Test", amount: 100 }).success).toBe(false);
  });

  it("rejects missing amount", () => {
    expect(CreatePricingRuleSchema.safeParse({ name: "Test", type: "flat_rate" }).success).toBe(false);
  });

  it("trims whitespace from name", () => {
    const result = CreatePricingRuleSchema.safeParse({
      name: "  Grand Hall  ",
      type: "flat_rate",
      amount: 550,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Grand Hall");
    }
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
      expect(result.data.guestCount).toBe(100);
      expect(result.data.eventDate).toBe("2025-06-15");
      expect(result.data.startTime).toBe("09:00");
      expect(result.data.endTime).toBe("13:00");
    }
  });

  it("rejects missing spaceId", () => {
    const { spaceId: _, ...noSpaceId } = validEstimateRequest;
    expect(PriceEstimateRequestSchema.safeParse(noSpaceId).success).toBe(false);
  });

  it("rejects invalid date format", () => {
    expect(PriceEstimateRequestSchema.safeParse({ ...validEstimateRequest, eventDate: "June 15 2025" }).success).toBe(false);
  });

  it("rejects invalid time format", () => {
    expect(PriceEstimateRequestSchema.safeParse({ ...validEstimateRequest, startTime: "9am" }).success).toBe(false);
  });

  it("accepts valid HH:MM time", () => {
    expect(PriceEstimateRequestSchema.safeParse({ ...validEstimateRequest, startTime: "19:00", endTime: "00:30" }).success).toBe(true);
  });

  it("rejects zero guestCount", () => {
    expect(PriceEstimateRequestSchema.safeParse({ ...validEstimateRequest, guestCount: 0 }).success).toBe(false);
  });

  it("rejects guestCount exceeding max", () => {
    expect(PriceEstimateRequestSchema.safeParse({ ...validEstimateRequest, guestCount: 10_001 }).success).toBe(false);
  });

  it("rejects non-integer guestCount", () => {
    expect(PriceEstimateRequestSchema.safeParse({ ...validEstimateRequest, guestCount: 1.5 }).success).toBe(false);
  });

  it("accepts exactly 10000 guests (boundary)", () => {
    expect(PriceEstimateRequestSchema.safeParse({ ...validEstimateRequest, guestCount: 10_000 }).success).toBe(true);
  });

  it("accepts exactly 1 guest (minimum)", () => {
    expect(PriceEstimateRequestSchema.safeParse({ ...validEstimateRequest, guestCount: 1 }).success).toBe(true);
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
      expect(result.data.total).toBe(550);
      expect(result.data.lineItems).toHaveLength(1);
    }
  });

  it("accepts empty lineItems (no matching rules)", () => {
    expect(PriceEstimateResponseSchema.safeParse({
      lineItems: [],
      subtotal: 0,
      modifiers: [],
      total: 0,
      currency: "GBP",
    }).success).toBe(true);
  });

  it("accepts response with modifiers", () => {
    expect(PriceEstimateResponseSchema.safeParse({
      lineItems: [{ ruleName: "Room Hire", description: "Flat rate", amount: 500 }],
      subtotal: 500,
      modifiers: [{ name: "saturday surcharge", multiplier: 1.5 }],
      total: 750,
      currency: "GBP",
    }).success).toBe(true);
  });

  it("rejects negative total", () => {
    expect(PriceEstimateResponseSchema.safeParse({ ...validEstimateResponse, total: -1 }).success).toBe(false);
  });

  it("rejects negative subtotal", () => {
    expect(PriceEstimateResponseSchema.safeParse({ ...validEstimateResponse, subtotal: -1 }).success).toBe(false);
  });

  it("rejects missing currency", () => {
    const { currency: _, ...noCurrency } = validEstimateResponse;
    expect(PriceEstimateResponseSchema.safeParse(noCurrency).success).toBe(false);
  });

  it("rejects unsupported currency", () => {
    expect(PriceEstimateResponseSchema.safeParse({ ...validEstimateResponse, currency: "USD" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LineItemSchema
// ---------------------------------------------------------------------------

describe("LineItemSchema", () => {
  it("accepts valid line item", () => {
    expect(LineItemSchema.safeParse({ ruleName: "Room Hire", description: "Flat rate", amount: 500 }).success).toBe(true);
  });

  it("rejects empty ruleName", () => {
    expect(LineItemSchema.safeParse({ ruleName: "", description: "test", amount: 0 }).success).toBe(false);
  });

  it("rejects negative amount", () => {
    expect(LineItemSchema.safeParse({ ruleName: "Test", description: "test", amount: -1 }).success).toBe(false);
  });

  it("accepts zero amount", () => {
    expect(LineItemSchema.safeParse({ ruleName: "Free", description: "Complimentary", amount: 0 }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ModifierSchema
// ---------------------------------------------------------------------------

describe("ModifierSchema", () => {
  it("accepts valid modifier", () => {
    expect(ModifierSchema.safeParse({ name: "weekend surcharge", multiplier: 1.5 }).success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(ModifierSchema.safeParse({ name: "", multiplier: 1.2 }).success).toBe(false);
  });

  it("rejects non-positive multiplier", () => {
    expect(ModifierSchema.safeParse({ name: "test", multiplier: 0 }).success).toBe(false);
  });

  it("rejects negative multiplier", () => {
    expect(ModifierSchema.safeParse({ name: "test", multiplier: -0.5 }).success).toBe(false);
  });

  it("accepts multiplier exactly 1 (no change)", () => {
    expect(ModifierSchema.safeParse({ name: "no change", multiplier: 1 }).success).toBe(true);
  });
});
