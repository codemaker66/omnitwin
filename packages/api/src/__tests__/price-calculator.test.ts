import { describe, it, expect } from "vitest";
import {
  calculatePrice,
  computeHours,
  getDayOfWeek,
  getMonth,
  type PricingRuleInput,
} from "../services/price-calculator.js";

// ---------------------------------------------------------------------------
// Helper: make a rule
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<PricingRuleInput> & Pick<PricingRuleInput, "name" | "type" | "amount">): PricingRuleInput {
  return {
    currency: "GBP",
    minHours: null,
    minGuests: null,
    tiers: null,
    dayOfWeekModifiers: null,
    seasonalModifiers: null,
    validFrom: null,
    validTo: null,
    isActive: true,
    spaceId: null,
    ...overrides,
  };
}

const SPACE_ID = "s1";

// ---------------------------------------------------------------------------
// computeHours
// ---------------------------------------------------------------------------

describe("computeHours", () => {
  it("calculates 4 hours", () => { expect(computeHours("10:00", "14:00")).toBe(4); });
  it("calculates 8 hours", () => { expect(computeHours("09:00", "17:00")).toBe(8); });
  it("returns 0 for same time", () => { expect(computeHours("10:00", "10:00")).toBe(0); });
});

// ---------------------------------------------------------------------------
// getDayOfWeek / getMonth
// ---------------------------------------------------------------------------

describe("date helpers", () => {
  it("getDayOfWeek returns saturday for 2026-03-21", () => { expect(getDayOfWeek("2026-03-21")).toBe("saturday"); });
  it("getMonth returns december for 2026-12-25", () => { expect(getMonth("2026-12-25")).toBe("december"); });
  it("getMonth returns march for 2026-03-15", () => { expect(getMonth("2026-03-15")).toBe("march"); });
});

// ---------------------------------------------------------------------------
// calculatePrice
// ---------------------------------------------------------------------------

describe("calculatePrice", () => {
  it("flat rate calculation", () => {
    const result = calculatePrice({
      rules: [makeRule({ name: "Venue Hire", type: "flat_rate", amount: 500 })],
      spaceId: SPACE_ID, eventDate: "2026-06-15", startTime: "10:00", endTime: "18:00", guestCount: 100,
    });
    expect(result.lineItems).toHaveLength(1);
    expect(result.subtotal).toBe(500);
    expect(result.total).toBe(500);
  });

  it("per hour calculation (4 hours)", () => {
    const result = calculatePrice({
      rules: [makeRule({ name: "Hourly Rate", type: "per_hour", amount: 100 })],
      spaceId: SPACE_ID, eventDate: "2026-06-15", startTime: "10:00", endTime: "14:00", guestCount: 50,
    });
    expect(result.subtotal).toBe(400);
  });

  it("per hour with minimum hours", () => {
    const result = calculatePrice({
      rules: [makeRule({ name: "Hourly Rate", type: "per_hour", amount: 100, minHours: 6 })],
      spaceId: SPACE_ID, eventDate: "2026-06-15", startTime: "10:00", endTime: "12:00", guestCount: 50,
    });
    // 2 actual hours, but min 6 → bills 6 hours
    expect(result.subtotal).toBe(600);
  });

  it("per head calculation (200 guests)", () => {
    const result = calculatePrice({
      rules: [makeRule({ name: "Per Guest", type: "per_head", amount: 15 })],
      spaceId: SPACE_ID, eventDate: "2026-06-15", startTime: "10:00", endTime: "18:00", guestCount: 200,
    });
    expect(result.subtotal).toBe(3000);
  });

  it("tiered pricing selects correct tier", () => {
    const tiers = [{ upTo: 50, amount: 500 }, { upTo: 100, amount: 800 }, { upTo: 200, amount: 1200 }];
    const result = calculatePrice({
      rules: [makeRule({ name: "Tiered", type: "tiered", amount: 0, tiers })],
      spaceId: SPACE_ID, eventDate: "2026-06-15", startTime: "10:00", endTime: "18:00", guestCount: 75,
    });
    expect(result.subtotal).toBe(800);
  });

  it("tiered pricing uses highest tier when guest count exceeds all", () => {
    const tiers = [{ upTo: 50, amount: 500 }, { upTo: 100, amount: 800 }];
    const result = calculatePrice({
      rules: [makeRule({ name: "Tiered", type: "tiered", amount: 0, tiers })],
      spaceId: SPACE_ID, eventDate: "2026-06-15", startTime: "10:00", endTime: "18:00", guestCount: 150,
    });
    expect(result.subtotal).toBe(800);
  });

  it("day-of-week modifier applies (Saturday +25%)", () => {
    const result = calculatePrice({
      rules: [makeRule({
        name: "Venue Hire", type: "flat_rate", amount: 1000,
        dayOfWeekModifiers: { saturday: 1.25 },
      })],
      spaceId: SPACE_ID, eventDate: "2026-03-21", startTime: "10:00", endTime: "18:00", guestCount: 100,
    });
    expect(result.modifiers).toHaveLength(1);
    expect(result.modifiers[0]?.multiplier).toBe(1.25);
    expect(result.total).toBe(1250);
  });

  it("seasonal modifier applies (December +30%)", () => {
    const result = calculatePrice({
      rules: [makeRule({
        name: "Venue Hire", type: "flat_rate", amount: 1000,
        seasonalModifiers: { december: 1.3 },
      })],
      spaceId: SPACE_ID, eventDate: "2026-12-15", startTime: "10:00", endTime: "18:00", guestCount: 100,
    });
    expect(result.total).toBe(1300);
  });

  it("combined modifiers (Saturday in December)", () => {
    const result = calculatePrice({
      rules: [makeRule({
        name: "Venue Hire", type: "flat_rate", amount: 1000,
        dayOfWeekModifiers: { saturday: 1.25 },
        seasonalModifiers: { december: 1.3 },
      })],
      // 2026-12-19 is a Saturday
      spaceId: SPACE_ID, eventDate: "2026-12-19", startTime: "10:00", endTime: "18:00", guestCount: 100,
    });
    expect(result.modifiers).toHaveLength(2);
    // 1000 * 1.25 * 1.3 = 1625
    expect(result.total).toBe(1625);
  });

  it("multiple rules stack as line items", () => {
    const result = calculatePrice({
      rules: [
        makeRule({ name: "Venue Hire", type: "flat_rate", amount: 500 }),
        makeRule({ name: "Per Guest", type: "per_head", amount: 10 }),
      ],
      spaceId: SPACE_ID, eventDate: "2026-06-15", startTime: "10:00", endTime: "18:00", guestCount: 100,
    });
    expect(result.lineItems).toHaveLength(2);
    expect(result.subtotal).toBe(1500);
  });

  it("no matching rules returns zero", () => {
    const result = calculatePrice({
      rules: [],
      spaceId: SPACE_ID, eventDate: "2026-06-15", startTime: "10:00", endTime: "18:00", guestCount: 100,
    });
    expect(result.lineItems).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("inactive rules are skipped", () => {
    const result = calculatePrice({
      rules: [makeRule({ name: "Disabled", type: "flat_rate", amount: 500, isActive: false })],
      spaceId: SPACE_ID, eventDate: "2026-06-15", startTime: "10:00", endTime: "18:00", guestCount: 100,
    });
    expect(result.total).toBe(0);
  });

  it("rules for wrong space are skipped", () => {
    const result = calculatePrice({
      rules: [makeRule({ name: "Wrong Space", type: "flat_rate", amount: 500, spaceId: "other-space" })],
      spaceId: SPACE_ID, eventDate: "2026-06-15", startTime: "10:00", endTime: "18:00", guestCount: 100,
    });
    expect(result.total).toBe(0);
  });

  it("venue-wide rules (spaceId=null) apply to any space", () => {
    const result = calculatePrice({
      rules: [makeRule({ name: "Venue-wide", type: "flat_rate", amount: 500, spaceId: null })],
      spaceId: SPACE_ID, eventDate: "2026-06-15", startTime: "10:00", endTime: "18:00", guestCount: 100,
    });
    expect(result.total).toBe(500);
  });

  it("expired rules (validTo in past) are skipped", () => {
    const result = calculatePrice({
      rules: [makeRule({ name: "Expired", type: "flat_rate", amount: 500, validTo: "2020-01-01" })],
      spaceId: SPACE_ID, eventDate: "2026-06-15", startTime: "10:00", endTime: "18:00", guestCount: 100,
    });
    expect(result.total).toBe(0);
  });
});
