import { describe, it, expect } from "vitest";
import {
  applicableRules,
  calculatePrice,
  computeHours,
  getDayOfWeek,
  getMonth,
  ruleWindow,
  windowHolds,
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
    appliesFrom: null,
    appliesUntil: null,
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

  it("accumulates the subtotal in exact pence (no floating-point drift)", () => {
    const result = calculatePrice({
      rules: [
        makeRule({ name: "A", type: "flat_rate", amount: 0.1 }),
        makeRule({ name: "B", type: "flat_rate", amount: 0.1 }),
        makeRule({ name: "C", type: "flat_rate", amount: 0.1 }),
      ],
      spaceId: SPACE_ID, eventDate: "2026-06-15", startTime: "10:00", endTime: "18:00", guestCount: 100,
    });
    // A float `0.1 + 0.1 + 0.1` reduce yields 0.30000000000000004; exact pence
    // arithmetic yields precisely 0.30.
    expect(result.subtotal).toBe(0.3);
    expect(result.total).toBe(0.3);
  });

  it("rounds a fractional modified total to exact pence (half-even)", () => {
    const result = calculatePrice({
      rules: [makeRule({
        name: "Per Guest", type: "per_head", amount: 12.5,
        dayOfWeekModifiers: { saturday: 1.25 },
      })],
      // 2026-03-21 is a Saturday.
      spaceId: SPACE_ID, eventDate: "2026-03-21", startTime: "10:00", endTime: "18:00", guestCount: 17,
    });
    expect(result.subtotal).toBe(212.5); // £12.50 × 17, exact
    // £212.50 × 1.25 = £265.625 → 26562.5 pence → half-even → 26562 → £265.62.
    expect(result.total).toBe(265.62);
  });
});

// ---------------------------------------------------------------------------
// Seed data structural tests
// ---------------------------------------------------------------------------

describe("seed data — Trades Hall pricing", () => {
  it("seed file includes all 6 Trades Hall spaces", async () => {
    const fs = await import("node:fs");
    const seedCode = fs.readFileSync("src/db/seed.ts", "utf-8");
    expect(seedCode).toContain("Grand Hall");
    expect(seedCode).toContain("Saloon");
    expect(seedCode).toContain("Reception Room");
    expect(seedCode).toContain("Robert Adam Room");
    expect(seedCode).toContain("North Gallery");
    expect(seedCode).toContain("South Gallery");
  });

  it("seed file includes pricing rules from official price sheet", async () => {
    const fs = await import("node:fs");
    const seedCode = fs.readFileSync("src/db/seed.ts", "utf-8");
    // 3 time slots
    expect(seedCode).toContain("Half Day");
    expect(seedCode).toContain("Full Day");
    expect(seedCode).toContain("Evening Event");
    // Exclusive venue
    expect(seedCode).toContain("Exclusive Use of Full Venue");
    expect(seedCode).toContain("2500");
    // Key prices from the PDF
    expect(seedCode).toContain("halfDay: 550");   // Grand Hall half day, both windows
    expect(seedCode).toContain("fullDay: 900");   // Grand Hall full day
    expect(seedCode).toContain("evening: 1500");  // Grand Hall evening
    // Every slot carries its window (0089); the half day is two rules.
    expect(seedCode).toContain("appliesFrom: \"19:00\", appliesUntil: \"00:30\"");
    expect(seedCode).toContain("Half Day (14:00–18:00)");
    // Notes
    expect(seedCode).toContain("Includes Saloon");
    expect(seedCode).toContain("Only if venue already open");
    expect(seedCode).toContain("Free with Grand Hall booking");
  });

  it("seed file inserts pricingRules from schema", async () => {
    const fs = await import("node:fs");
    const seedCode = fs.readFileSync("src/db/seed.ts", "utf-8");
    expect(seedCode).toContain("pricingRules");
    expect(seedCode).toContain("db.insert(pricingRules)");
  });
});

// ---------------------------------------------------------------------------
// Windows (goal 19 S6, migration 0089): a rule that states its time of day
// applies only to a span inside it; one room's nested slots are alternatives.
// ---------------------------------------------------------------------------

describe("calculatePrice — windows", () => {
  const grandHall = [
    makeRule({ name: "Grand Hall — Half Day (09:00–13:00)", type: "flat_rate", amount: 550, spaceId: SPACE_ID, appliesFrom: "09:00", appliesUntil: "13:00" }),
    makeRule({ name: "Grand Hall — Half Day (14:00–18:00)", type: "flat_rate", amount: 550, spaceId: SPACE_ID, appliesFrom: "14:00", appliesUntil: "18:00" }),
    makeRule({ name: "Grand Hall — Full Day (09:00–17:30)", type: "flat_rate", amount: 900, spaceId: SPACE_ID, appliesFrom: "09:00", appliesUntil: "17:30" }),
    makeRule({ name: "Grand Hall — Evening Event (19:00–00:30)", type: "flat_rate", amount: 1500, spaceId: SPACE_ID, appliesFrom: "19:00", appliesUntil: "00:30" }),
  ];
  const estimate = (startTime: string, endTime: string, rules: readonly PricingRuleInput[] = grandHall) =>
    calculatePrice({ rules, spaceId: SPACE_ID, eventDate: "2026-10-24", startTime, endTime, guestCount: 80 });

  it("prices an evening as the evening slot alone, not every slot stacked", () => {
    const result = estimate("19:00", "23:00");
    expect(result.lineItems.map((item) => item.ruleName)).toEqual(["Grand Hall — Evening Event (19:00–00:30)"]);
    expect(result.total).toBe(1500);
  });

  it("a morning inside both the half day and the full day pays the half day: the narrowest slot of the room", () => {
    const result = estimate("10:00", "12:00");
    expect(result.lineItems.map((item) => item.ruleName)).toEqual(["Grand Hall — Half Day (09:00–13:00)"]);
    expect(result.total).toBe(550);
  });

  it("a span across both half days pays the full day", () => {
    expect(estimate("10:00", "16:00").lineItems.map((item) => item.ruleName)).toEqual(["Grand Hall — Full Day (09:00–17:30)"]);
    expect(estimate("09:00", "17:30").total).toBe(900);
  });

  it("a span no slot holds earns no slot line", () => {
    expect(estimate("10:00", "22:00").lineItems).toEqual([]);
    expect(estimate("18:00", "20:00").total).toBe(0);
  });

  it("a window that runs past midnight holds a span either side of it", () => {
    expect(estimate("23:00", "23:59").total).toBe(1500);
    expect(estimate("00:00", "00:30").total).toBe(1500);
    expect(estimate("00:00", "00:31").total).toBe(0);
    expect(estimate("18:59", "22:00").total).toBe(0);
  });

  it("a rule with no window applies at any time, as every rule did before", () => {
    const venueWide = makeRule({ name: "Exclusive Use of Full Venue", type: "flat_rate", amount: 2500 });
    const result = estimate("19:00", "23:00", [...grandHall, venueWide]);
    expect(result.lineItems.map((item) => item.ruleName)).toEqual(["Grand Hall — Evening Event (19:00–00:30)", "Exclusive Use of Full Venue"]);
    expect(result.total).toBe(4000);
  });

  it("another room's slot and a venue-wide windowed rule are not alternatives of this room's slot", () => {
    const security = makeRule({ name: "Evening security (19:00–00:30)", type: "per_hour", amount: 30, appliesFrom: "19:00", appliesUntil: "00:30" });
    const otherRoom = makeRule({ name: "Saloon — Evening Event (19:00–00:30)", type: "flat_rate", amount: 500, spaceId: "s2", appliesFrom: "19:00", appliesUntil: "00:30" });
    const result = estimate("19:00", "23:00", [...grandHall, security, otherRoom]);
    expect(result.lineItems.map((item) => item.ruleName)).toEqual(["Grand Hall — Evening Event (19:00–00:30)", "Evening security (19:00–00:30)"]);
    expect(result.total).toBe(1500 + 120);
  });

  it("two rules of one room with the same narrowest window both apply: they are not alternatives", () => {
    const cleaning = makeRule({ name: "Grand Hall — Evening clean (19:00–00:30)", type: "flat_rate", amount: 80, spaceId: SPACE_ID, appliesFrom: "19:00", appliesUntil: "00:30" });
    expect(estimate("19:00", "23:00", [...grandHall, cleaning]).total).toBe(1580);
  });

  it("the seeded Grand Hall evening prices at £1,500: the evening slot, with the exclusive-use rule switched off (Blake, 16 October 2026)", () => {
    const exclusiveOff = makeRule({ name: "Exclusive Use of Full Venue", type: "flat_rate", amount: 2500, isActive: false });
    const result = estimate("19:00", "23:00", [...grandHall, exclusiveOff]);
    expect(result.lineItems).toEqual([{ ruleName: "Grand Hall — Evening Event (19:00–00:30)", description: "Flat rate", amount: 1500 }]);
    expect(result.total).toBe(1500);
  });

  it("a rate for particular dates is charged instead of the everyday rate on those dates, not as well", () => {
    const special = makeRule({
      name: "Grand Hall — Evening Event (24 Oct)", type: "flat_rate", amount: 1800, spaceId: SPACE_ID,
      appliesFrom: "19:00", appliesUntil: "00:30", validFrom: "2026-10-24", validTo: "2026-10-24",
    });
    const onTheDay = estimate("19:00", "23:00", [...grandHall, special]);
    expect(onTheDay.lineItems.map((item) => item.ruleName)).toEqual(["Grand Hall — Evening Event (24 Oct)"]);
    expect(onTheDay.total).toBe(1800);
    // The next day is the everyday rate again.
    const nextDay = calculatePrice({ rules: [...grandHall, special], spaceId: SPACE_ID, eventDate: "2026-10-25", startTime: "19:00", endTime: "23:00", guestCount: 80 });
    expect(nextDay.total).toBe(1500);
    // Postgres's "19:00:00" is the same time as the form's "19:00".
    const fromDatabase = makeRule({ ...special, appliesFrom: "19:00:00", appliesUntil: "00:30:00" });
    expect(estimate("19:00", "23:00", [...grandHall, fromDatabase]).total).toBe(1800);
  });

  it("a dated rate charged another way (a price a head) is added, not swapped", () => {
    const catering = makeRule({
      name: "Grand Hall — Evening catering (24 Oct)", type: "per_head", amount: 10, spaceId: SPACE_ID,
      appliesFrom: "19:00", appliesUntil: "00:30", validFrom: "2026-10-24", validTo: "2026-10-24",
    });
    expect(estimate("19:00", "23:00", [...grandHall, catering]).total).toBe(1500 + 800);
  });

  it("the window helpers read a past-midnight window as its second day", () => {
    const evening = ruleWindow({ appliesFrom: "19:00", appliesUntil: "00:30" });
    expect(evening).toEqual({ fromMinute: 19 * 60, untilMinute: 24 * 60 + 30 });
    expect(ruleWindow({ appliesFrom: null, appliesUntil: null })).toBeNull();
    if (evening === null) throw new Error("window");
    expect(windowHolds(evening, "19:00", "00:30")).toBe(false);
    expect(windowHolds(evening, "19:00", "19:00")).toBe(false);
    expect(applicableRules(grandHall, "19:00", "23:00").map((rule) => rule.amount)).toEqual([1500]);
  });
});

// ---------------------------------------------------------------------------
// Estimate endpoint wiring
// ---------------------------------------------------------------------------

describe("pricing-rules route — estimate endpoint", () => {
  it("pricing-rules.ts imports and uses calculatePrice", async () => {
    const fs = await import("node:fs");
    const routeCode = fs.readFileSync("src/routes/pricing-rules.ts", "utf-8");
    expect(routeCode).toContain("calculatePrice");
    expect(routeCode).toContain("estimate");
    expect(routeCode).toContain("EstimateBody");
  });
});
