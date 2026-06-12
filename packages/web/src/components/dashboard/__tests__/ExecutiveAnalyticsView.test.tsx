import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { VenueDashboardAnalytics } from "@omnitwin/types";

const { getVenueDashboardAnalyticsMock } = vi.hoisted(() => ({
  getVenueDashboardAnalyticsMock: vi.fn(),
}));

vi.mock("../../../api/revenue-analytics.js", () => ({
  getVenueDashboardAnalytics: getVenueDashboardAnalyticsMock,
}));

import { ExecutiveAnalyticsView } from "../ExecutiveAnalyticsView.js";

afterEach(() => {
  cleanup();
  getVenueDashboardAnalyticsMock.mockReset();
});

function dashboardData(): VenueDashboardAnalytics {
  return {
    generatedAt: "2026-06-12T11:30:00.000Z",
    currency: "GBP",
    pipelineValueMinor: 1_250_000,
    enquiryConversionPercent: 42,
    proposalStatusCounts: {
      draft: 1,
      sent: 2,
      accepted: 1,
      changes_requested: 1,
    },
    roomUtilisation: [{
      spaceId: "00000000-0000-4000-8000-000000004001",
      roomName: "Grand Hall",
      bookedEvents: 2,
      proposedEvents: 5,
      utilisationPercent: 40,
      reviewBottlenecks: 3,
    }],
    revenueScenarios: [{
      id: "00000000-0000-4000-8000-000000004002",
      venueId: "00000000-0000-4000-8000-000000004003",
      eventId: null,
      configurationId: null,
      quoteId: null,
      name: "Dinner upsell option",
      scenarioKind: "manual",
      status: "draft",
      currency: "GBP",
      plannedGuestCount: 120,
      estimatedRevenueMinor: 1_250_000,
      estimatedCostMinor: 420_000,
      estimatedMarginMinor: 830_000,
      comfortStatus: "warning",
      reviewGateCount: 2,
      createdBy: null,
      createdAt: "2026-06-12T11:00:00.000Z",
      updatedAt: "2026-06-12T11:00:00.000Z",
    }],
    comfortFloorWarnings: ["Aisle spacing needs review."],
    reviewBottlenecks: ["Dinner upsell option: 2 review gate(s)"],
    disclosure: "Commercial planning insight - review constraints preserved",
  };
}

describe("ExecutiveAnalyticsView", () => {
  it("renders revenue metrics with comfort and review constraints visible", async () => {
    getVenueDashboardAnalyticsMock.mockResolvedValue(dashboardData());
    render(<ExecutiveAnalyticsView />);

    expect(screen.getByText("Loading commercial planning data")).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText("Commercial planning dashboard")).toBeDefined();
    });

    expect(screen.getByText("GBP 12,500.00")).toBeDefined();
    expect(screen.getByText("42%")).toBeDefined();
    expect(screen.getByText("Grand Hall")).toBeDefined();
    expect(screen.getByText("Dinner upsell option")).toBeDefined();
    expect(screen.getByText("Aisle spacing needs review.")).toBeDefined();
    expect(screen.getByText("Dinner upsell option: 2 review gate(s)")).toBeDefined();
  });

  it("keeps dashboard copy inside safe planning language", async () => {
    getVenueDashboardAnalyticsMock.mockResolvedValue(dashboardData());
    render(<ExecutiveAnalyticsView />);

    await waitFor(() => {
      expect(screen.getByText("Commercial planning dashboard")).toBeDefined();
    });

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).not.toMatch(/certified safe/i);
    expect(bodyText).not.toMatch(/legally compliant/i);
    expect(bodyText).not.toMatch(/approved for occupancy/i);
    expect(bodyText).not.toMatch(/guaranteed accessible/i);
  });
});
