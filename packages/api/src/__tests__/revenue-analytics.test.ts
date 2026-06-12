import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { RevenueScenario } from "@omnitwin/types";
import {
  buildPipelineSummary,
  buildVenueDashboardAnalytics,
  comparisonSignals,
  summarizeRevenueScenarios,
} from "../services/revenue-analytics.js";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

const VENUE_ID = "00000000-0000-4000-8000-000000003101";
const EVENT_ID = "00000000-0000-4000-8000-000000003102";
const USER_ID = "00000000-0000-4000-8000-000000003103";
const NOW = "2026-06-12T11:00:00.000Z";

function signToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(payload);
}

function staffToken(): string {
  return signToken({
    id: USER_ID,
    email: "staff@test.com",
    role: "staff",
    venueId: VENUE_ID,
  });
}

function adminToken(): string {
  return signToken({
    id: USER_ID,
    email: "admin@test.com",
    role: "admin",
    venueId: null,
  });
}

function scenario(overrides: Partial<RevenueScenario> = {}): RevenueScenario {
  return {
    id: "00000000-0000-4000-8000-000000003110",
    venueId: VENUE_ID,
    eventId: EVENT_ID,
    configurationId: null,
    quoteId: null,
    name: "Dinner package",
    scenarioKind: "manual",
    status: "draft",
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
  };
}

beforeAll(async () => {
  server = await buildServer();
});

afterAll(async () => {
  await server.close();
});

describe("revenue analytics services", () => {
  it("summarizes event revenue without dropping review bottlenecks", () => {
    const summary = summarizeRevenueScenarios({
      eventId: EVENT_ID,
      scenarios: [
        scenario(),
        scenario({
          id: "00000000-0000-4000-8000-000000003111",
          estimatedRevenueMinor: 2_100_000,
          estimatedCostMinor: 920_000,
          estimatedMarginMinor: 1_180_000,
          comfortStatus: "review_required",
          reviewGateCount: 3,
        }),
      ],
    });
    expect(summary.totalScenarioRevenueMinor).toBe(3_900_000);
    expect(summary.bestScenarioId).toBe("00000000-0000-4000-8000-000000003111");
    expect(summary.comfortWarnings).toBe(2);
    expect(summary.reviewBottlenecks).toBe(5);
  });

  it("builds exact pipeline money and conversion counts", () => {
    const pipeline = buildPipelineSummary({
      quoteTotalsMinor: [100_001, 200_002, 300_003],
      enquiryCount: 4,
      proposalStatuses: ["draft", "sent", "accepted", "accepted"],
    });
    expect(pipeline.pipelineValueMinor).toBe(600_006);
    expect(pipeline.conversionPercent).toBe(50);
    expect(pipeline.proposalStatusCounts.accepted).toBe(2);
  });

  it("marks scenario comparison for review when constraints worsen", () => {
    const comparison = comparisonSignals({
      left: scenario(),
      right: scenario({
        id: "00000000-0000-4000-8000-000000003112",
        estimatedRevenueMinor: 1_950_000,
        estimatedCostMinor: 780_000,
        estimatedMarginMinor: 1_170_000,
        comfortStatus: "review_required",
        reviewGateCount: 4,
      }),
    });
    expect(comparison.marginDeltaMinor).toBe(110_000);
    expect(comparison.recommendationStatus).toBe("review_required");
  });

  it("dashboard analytics keeps comfort warnings visible", () => {
    const pipeline = buildPipelineSummary({
      quoteTotalsMinor: [100_000],
      enquiryCount: 1,
      proposalStatuses: ["sent"],
    });
    const dashboard = buildVenueDashboardAnalytics({
      generatedAt: NOW,
      pipeline,
      roomUtilisation: [],
      revenueScenarios: [scenario()],
      comfortConstraints: [{
        id: "00000000-0000-4000-8000-000000003120",
        revenueScenarioId: scenario().id,
        constraintType: "circulation",
        label: "Aisle comfort floor",
        threshold: 1.2,
        actualValue: 1,
        status: "warning",
        reviewRequired: true,
        note: "Aisle spacing needs review.",
        createdAt: NOW,
      }],
    });
    expect(dashboard.disclosure).toBe("Commercial planning insight - review constraints preserved");
    expect(dashboard.comfortFloorWarnings).toContain("Aisle spacing needs review.");
    expect(dashboard.reviewBottlenecks.length).toBeGreaterThan(0);
  });
});

describe("revenue analytics routes", () => {
  it("requires auth for analytics dashboard", async () => {
    const res = await server.inject({ method: "GET", url: "/analytics/venue-dashboard" });
    expect(res.statusCode).toBe(401);
  });

  it("requires venue scope for admin analytics before database work", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/analytics/venue-dashboard",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "VENUE_REQUIRED" });
  });

  it("blocks unsafe scenario wording before database work", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/revenue-scenarios",
      headers: { authorization: `Bearer ${staffToken()}` },
      payload: {
        venueId: VENUE_ID,
        name: "Production ready revenue option",
        estimatedRevenueMinor: 100_000,
        estimatedCostMinor: 20_000,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("validates event revenue summary IDs before database work", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/events/not-a-uuid/revenue-summary",
      headers: { authorization: `Bearer ${staffToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("registers requested API paths and avoids unsafe claims", async () => {
    const [indexSource, routeSource] = await Promise.all([
      readFile(resolve("src/index.ts"), "utf-8"),
      readFile(resolve("src/routes/revenue-analytics.ts"), "utf-8"),
    ]);
    const source = `${indexSource}\n${routeSource}`;
    expect(source).toContain('prefix: "/revenue-scenarios"');
    expect(source).toContain('prefix: "/analytics"');
    expect(routeSource).toContain("/:id/revenue-summary");
    expect(routeSource).toContain("/venue-dashboard");
    expect(routeSource).toContain("/pipeline-summary");
    expect(routeSource).toContain("/room-utilisation");
    expect(source).not.toMatch(/\bcertified safe\b/iu);
    expect(source).not.toMatch(/\blegally compliant\b/iu);
    expect(source).not.toMatch(/\bapproved for occupancy\b/iu);
  });
});
