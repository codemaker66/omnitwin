import { describe, expect, it } from "vitest";
import {
  CreateRevenueScenarioSchema,
  RevenueScenarioSchema,
  compareRevenueScenarios,
  computeScenarioMarginMinor,
  formatMinorUnitMoney,
  type RevenueScenario,
} from "../revenue-analytics.js";

const VENUE_ID = "00000000-0000-4000-8000-000000003001";
const EVENT_ID = "00000000-0000-4000-8000-000000003002";
const CONFIG_ID = "00000000-0000-4000-8000-000000003003";
const QUOTE_ID = "00000000-0000-4000-8000-000000003004";
const USER_ID = "00000000-0000-4000-8000-000000003005";
const NOW = "2026-06-12T10:00:00.000Z";

function scenario(overrides: Partial<RevenueScenario> = {}): RevenueScenario {
  return RevenueScenarioSchema.parse({
    id: "00000000-0000-4000-8000-000000003010",
    venueId: VENUE_ID,
    eventId: EVENT_ID,
    configurationId: CONFIG_ID,
    quoteId: QUOTE_ID,
    name: "Dinner revenue scenario",
    scenarioKind: "quote_based",
    status: "active",
    currency: "GBP",
    plannedGuestCount: 120,
    estimatedRevenueMinor: 1_800_000,
    estimatedCostMinor: 740_000,
    estimatedMarginMinor: 1_060_000,
    comfortStatus: "warning",
    reviewGateCount: 2,
    createdBy: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

describe("revenue analytics contracts", () => {
  it("enforces exact integer money margin", () => {
    expect(computeScenarioMarginMinor(1_800_000, 740_000)).toBe(1_060_000);
    expect(RevenueScenarioSchema.safeParse(scenario()).success).toBe(true);
    expect(RevenueScenarioSchema.safeParse({
      ...scenario(),
      estimatedMarginMinor: 1_060_001,
    }).success).toBe(false);
  });

  it("compares scenarios without dropping comfort or review constraints", () => {
    const base = scenario();
    const upsell = scenario({
      id: "00000000-0000-4000-8000-000000003011",
      estimatedRevenueMinor: 2_020_000,
      estimatedCostMinor: 820_000,
      estimatedMarginMinor: 1_200_000,
      comfortStatus: "review_required",
      reviewGateCount: 4,
    });

    const comparison = compareRevenueScenarios({ left: base, right: upsell });
    expect(comparison.revenueDeltaMinor).toBe(220_000);
    expect(comparison.marginDeltaMinor).toBe(140_000);
    expect(comparison.reviewGateDelta).toBe(2);
    expect(comparison.recommendationStatus).toBe("review_required");
    expect(comparison.comfortDeltaLabel).toContain("review_required");
  });

  it("keeps create input assumptions and comfort constraints explicit", () => {
    const parsed = CreateRevenueScenarioSchema.parse({
      venueId: VENUE_ID,
      eventId: EVENT_ID,
      name: "Bar package option",
      scenarioKind: "manual",
      estimatedRevenueMinor: 950_000,
      estimatedCostMinor: 320_000,
      comfortStatus: "warning",
      reviewGateCount: 1,
      pricingAssumptions: [{
        key: "bar-package",
        label: "Bar package uplift",
        valueMinor: 240_000,
        source: "Planner estimate",
      }],
      comfortConstraints: [{
        constraintType: "bar_queue",
        label: "Bar queue comfort floor",
        threshold: 12,
        actualValue: 15,
        status: "warning",
        reviewRequired: true,
        note: "Queue assumption needs staff review.",
      }],
    });

    expect(parsed.pricingAssumptions).toHaveLength(1);
    expect(parsed.comfortConstraints[0]?.reviewRequired).toBe(true);
  });

  it("blocks unsafe certainty wording", () => {
    expect(CreateRevenueScenarioSchema.safeParse({
      venueId: VENUE_ID,
      name: "Certified safe package",
      estimatedRevenueMinor: 100_000,
      pricingAssumptions: [],
      comfortConstraints: [],
    }).success).toBe(false);
  });

  it("formats minor-unit money without floating point arithmetic", () => {
    expect(formatMinorUnitMoney(1_234_567, "GBP")).toBe("GBP 12,345.67");
    expect(formatMinorUnitMoney(-125, "GBP")).toBe("-GBP 1.25");
  });
});
