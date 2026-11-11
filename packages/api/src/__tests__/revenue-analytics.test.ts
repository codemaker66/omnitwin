import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { addRotaDays, type RevenueScenario } from "@omnitwin/types";
import {
  buildPipelineSummary,
  buildRoomUtilisationRows,
  buildVenueDashboardAnalytics,
  comparisonSignals,
  roomUtilisationWindow,
  summarizeRevenueScenarios,
} from "../services/revenue-analytics.js";

const LONDON = "Europe/London";

function venueDates(first: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addRotaDays(first, index));
}

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

const VENUE_ID = "00000000-0000-4000-8000-000000003101";
const EVENT_ID = "00000000-0000-4000-8000-000000003102";
const USER_ID = "00000000-0000-4000-8000-000000003103";
const NOW = "2026-06-12T11:00:00.000Z";

function signToken(payload: { id: string; email: string; role: string; platformRole?: "none" | "operator" | "admin"; venueId: string | null }): string {
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
    platformRole: "admin",
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
    // Pipeline value now arrives already resolved by the one shared
    // definition (services/commercial-pipeline.ts) instead of being summed
    // from quote totals here, so the dashboard and the Pipeline tab cannot
    // drift apart again.
    const pipeline = buildPipelineSummary({
      pipelineValueMinor: 600_006,
      enquiryCount: 4,
      proposalStatusCounts: { accepted: 2, draft: 1, sent: 1 },
    });
    expect(pipeline.pipelineValueMinor).toBe(600_006);
    expect(pipeline.proposalCount).toBe(4);
    expect(pipeline.acceptedProposalCount).toBe(2);
    expect(pipeline.conversionPercent).toBe(50);
    expect(pipeline.proposalStatusCounts.accepted).toBe(2);
  });

  it("totals a pipeline above the single-amount ceiling instead of failing", () => {
    // A single amount is capped at £1,000,000; a venue's pipeline sums many
    // and must not turn the dashboard into a server error once it passes that.
    const pipeline = buildPipelineSummary({
      pipelineValueMinor: 250_000_000,
      enquiryCount: 40,
      proposalStatusCounts: { accepted: 10, sent: 30 },
    });
    expect(pipeline.pipelineValueMinor).toBe(250_000_000);
    const dashboard = buildVenueDashboardAnalytics({
      generatedAt: NOW,
      pipeline,
      roomUtilisation: [],
      revenueScenarios: [],
      comfortConstraints: [],
    });
    expect(dashboard.pipelineValueMinor).toBe(250_000_000);
  });

  it("caps accepted per enquiry at 100 when accepted proposals outnumber enquiries", () => {
    // Two deals from phone calls, both accepted, and one web enquiry: the
    // share used to read 200 and fail PercentSchema, taking the dashboard down.
    const pipeline = buildPipelineSummary({
      pipelineValueMinor: 0,
      enquiryCount: 1,
      proposalStatusCounts: { accepted: 2 },
    });
    expect(pipeline.conversionPercent).toBe(100);
    expect(pipeline.acceptedProposalCount).toBe(2);
    expect(pipeline.enquiryCount).toBe(1);
    const dashboard = buildVenueDashboardAnalytics({
      generatedAt: NOW, pipeline, roomUtilisation: [], revenueScenarios: [], comfortConstraints: [],
    });
    expect(dashboard.enquiryConversionPercent).toBe(100);
    expect(buildPipelineSummary({ pipelineValueMinor: 0, enquiryCount: 0, proposalStatusCounts: { accepted: 3 } })
      .conversionPercent).toBe(0);
  });

  it("measures room utilisation from confirmed bookings, not from quotes", () => {
    const rows = buildRoomUtilisationRows({
      rooms: [
        { spaceId: "00000000-0000-4000-8000-000000003201", roomName: "Grand Hall" },
        { spaceId: "00000000-0000-4000-8000-000000003202", roomName: "Saloon" },
      ],
      bookings: [
        // Grand Hall: two inked days plus a pencilled hold.
        { spaceId: "00000000-0000-4000-8000-000000003201", kind: "ink",
          startsAt: new Date("2026-07-02T09:00:00.000Z"), endsAt: new Date("2026-07-02T23:00:00.000Z") },
        { spaceId: "00000000-0000-4000-8000-000000003201", kind: "ink",
          startsAt: new Date("2026-07-05T09:00:00.000Z"), endsAt: new Date("2026-07-05T23:00:00.000Z") },
        { spaceId: "00000000-0000-4000-8000-000000003201", kind: "hold",
          startsAt: new Date("2026-07-08T09:00:00.000Z"), endsAt: new Date("2026-07-08T23:00:00.000Z") },
        // Saloon: pencilled only — demand without a confirmed day.
        { spaceId: "00000000-0000-4000-8000-000000003202", kind: "prospect",
          startsAt: new Date("2026-07-03T09:00:00.000Z"), endsAt: new Date("2026-07-03T23:00:00.000Z") },
      ],
      windowDates: venueDates("2026-07-01", 10),
      timeZone: LONDON,
      reviewBottlenecksBySpaceId: new Map(),
    });

    const grandHall = rows[0];
    const saloon = rows[1];
    expect(grandHall?.bookedEvents).toBe(2);
    expect(grandHall?.proposedEvents).toBe(1);
    expect(grandHall?.utilisationPercent).toBe(20); // 2 inked days of 10
    expect(saloon?.bookedEvents).toBe(0);
    expect(saloon?.proposedEvents).toBe(1);
    expect(saloon?.utilisationPercent).toBe(0);
  });

  it("clips a long booking to the window and never exceeds 100 per cent", () => {
    const rows = buildRoomUtilisationRows({
      rooms: [{ spaceId: "00000000-0000-4000-8000-000000003201", roomName: "Grand Hall" }],
      bookings: [
        { spaceId: "00000000-0000-4000-8000-000000003201", kind: "ink",
          startsAt: new Date("2026-01-01T00:00:00.000Z"), endsAt: new Date("2027-01-01T00:00:00.000Z") },
        // An overlapping second booking must not double-count the same days.
        { spaceId: "00000000-0000-4000-8000-000000003201", kind: "ink",
          startsAt: new Date("2026-07-02T00:00:00.000Z"), endsAt: new Date("2026-07-04T00:00:00.000Z") },
      ],
      windowDates: venueDates("2026-07-01", 10),
      timeZone: LONDON,
      reviewBottlenecksBySpaceId: new Map(),
    });
    expect(rows[0]?.utilisationPercent).toBe(100);
  });

  it("counts an evening past midnight as one venue day in either season", () => {
    const grandHall = "00000000-0000-4000-8000-000000003201";
    const ink = (startsAt: string, endsAt: string) => ({
      spaceId: grandHall, kind: "ink", startsAt: new Date(startsAt), endsAt: new Date(endsAt),
    });
    const rows = buildRoomUtilisationRows({
      rooms: [{ spaceId: grandHall, roomName: "Grand Hall" }],
      bookings: [
        // 18:00 to midnight BST on Sat 24 Oct, before the clocks go back.
        ink("2026-10-24T17:00:00.000Z", "2026-10-24T23:00:00.000Z"),
        // The same evening in GMT on Sat 31 Oct ends at 00:00Z.
        ink("2026-10-31T18:00:00.000Z", "2026-11-01T00:00:00.000Z"),
        // 19:00 to 00:30 GMT.
        ink("2026-11-01T19:00:00.000Z", "2026-11-02T00:30:00.000Z"),
        // Ends exactly at 04:00, where the next venue day begins.
        ink("2026-11-02T19:00:00.000Z", "2026-11-03T04:00:00.000Z"),
      ],
      windowDates: venueDates("2026-10-20", 20),
      timeZone: LONDON,
      reviewBottlenecksBySpaceId: new Map(),
    });
    // Four evenings, four venue days, of 20: 20%. UTC days counted seven.
    expect(rows[0]?.bookedEvents).toBe(4);
    expect(rows[0]?.utilisationPercent).toBe(20);
  });

  it("measures the window from the venue's operational today, 04:00 to 04:00", () => {
    // 02:30 GMT on 8 Nov still belongs to the Diary day of 7 Nov.
    const early = roomUtilisationWindow(Date.parse("2026-11-08T02:30:00.000Z"), LONDON);
    expect(early.dates).toHaveLength(90);
    expect(early.dates[0]).toBe("2026-11-07");
    expect(early.startsAt.toISOString()).toBe("2026-11-07T04:00:00.000Z");
    expect(early.dates[89]).toBe("2027-02-04");
    expect(early.endsAt.toISOString()).toBe("2027-02-05T04:00:00.000Z");
    expect(roomUtilisationWindow(Date.parse("2026-11-08T04:00:00.000Z"), LONDON).dates[0]).toBe("2026-11-08");
    // Across the spring change the window still ends at 04:00 venue time (BST).
    const spring = roomUtilisationWindow(Date.parse("2026-03-01T12:00:00.000Z"), LONDON);
    expect(spring.dates[89]).toBe("2026-05-29");
    expect(spring.endsAt.toISOString()).toBe("2026-05-30T03:00:00.000Z");
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
      pipelineValueMinor: 100_000,
      enquiryCount: 1,
      proposalStatusCounts: { sent: 1 },
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
