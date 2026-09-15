import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { VenueDashboardAnalytics } from "@omnitwin/types";

const { getVenueDashboardAnalyticsMock, listVenuesMock, authState } = vi.hoisted(() => ({
  getVenueDashboardAnalyticsMock: vi.fn(),
  listVenuesMock: vi.fn(),
  authState: {
    user: {
      id: "00000000-0000-4000-8000-000000004010",
      role: "admin",
      platformRole: "none" as "none" | "operator" | "admin",
      venueId: "00000000-0000-4000-8000-000000004003" as string | null,
      email: "venue-admin@example.test",
      name: "Venue admin",
    },
  },
}));

vi.mock("../../../api/revenue-analytics.js", () => ({
  getVenueDashboardAnalytics: getVenueDashboardAnalyticsMock,
}));

vi.mock("../../../api/spaces.js", () => ({
  listVenues: listVenuesMock,
}));

type MockUser = typeof authState.user;

vi.mock("../../../stores/auth-store.js", () => ({
  useAuthStore: (selector: (state: { user: MockUser }) => unknown): unknown =>
    selector({ user: authState.user }),
}));

import { ExecutiveAnalyticsView } from "../ExecutiveAnalyticsView.js";

beforeEach(() => {
  authState.user = { ...authState.user, platformRole: "none" };
  listVenuesMock.mockResolvedValue([
    { id: "00000000-0000-4000-8000-000000004003", name: "Trades Hall Glasgow" },
    { id: "00000000-0000-4000-8000-000000004004", name: "Second venue" },
  ]);
});

afterEach(() => {
  cleanup();
  getVenueDashboardAnalyticsMock.mockReset();
  listVenuesMock.mockReset();
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
      expect(screen.getByText("Executive analytics")).toBeDefined();
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
      expect(screen.getByText("Executive analytics")).toBeDefined();
    });

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).not.toMatch(/certified safe/i);
    expect(bodyText).not.toMatch(/legally compliant/i);
    expect(bodyText).not.toMatch(/approved for occupancy/i);
    expect(bodyText).not.toMatch(/guaranteed accessible/i);
  });

  it("asks a platform admin which venue before reporting anyone's numbers", async () => {
    authState.user = { ...authState.user, platformRole: "admin", venueId: null };
    getVenueDashboardAnalyticsMock.mockResolvedValue(dashboardData());
    render(<ExecutiveAnalyticsView />);

    // Nothing is requested until a venue is named: the API requires one, and
    // the old behaviour was to ask anyway and render the 400 as an error.
    expect(await screen.findByText("Choose a venue")).toBeDefined();
    expect(getVenueDashboardAnalyticsMock).not.toHaveBeenCalled();

    const picker = await screen.findByTestId("analytics-venue-picker");
    await waitFor(() => { expect(screen.getByText("Trades Hall Glasgow")).toBeDefined(); });
    fireEvent.change(picker, { target: { value: "00000000-0000-4000-8000-000000004004" } });

    await waitFor(() => {
      expect(getVenueDashboardAnalyticsMock)
        .toHaveBeenCalledWith("00000000-0000-4000-8000-000000004004");
    });
    expect(await screen.findByText("Executive analytics")).toBeDefined();
  });

  it("asks a venue user for nothing — their own venue is their scope", async () => {
    getVenueDashboardAnalyticsMock.mockResolvedValue(dashboardData());
    render(<ExecutiveAnalyticsView />);

    await waitFor(() => { expect(screen.getByText("Executive analytics")).toBeDefined(); });
    expect(getVenueDashboardAnalyticsMock).toHaveBeenCalledWith(undefined);
    expect(screen.queryByTestId("analytics-venue-picker")).toBeNull();
  });

  it("shows no card at all where there is no data, rather than an empty one", async () => {
    getVenueDashboardAnalyticsMock.mockResolvedValue({
      ...dashboardData(),
      revenueScenarios: [],
      comfortFloorWarnings: [],
      reviewBottlenecks: [],
    });
    render(<ExecutiveAnalyticsView />);

    await waitFor(() => { expect(screen.getByText("Executive analytics")).toBeDefined(); });
    // The three cards that no venue can ever fill today are simply absent.
    expect(screen.queryByText("Revenue scenario")).toBeNull();
    expect(screen.queryByText("Comfort floor warnings")).toBeNull();
    expect(screen.queryByText("Review bottlenecks")).toBeNull();
    // And none of the "nothing recorded" reassurance the data cannot support.
    const bodyText = document.body.textContent ?? "";
    expect(bodyText).not.toContain("No comfort floor warnings recorded.");
    expect(bodyText).not.toContain("No review bottlenecks recorded.");
    expect(bodyText).not.toContain("Create a revenue scenario");
    // The figures that ARE real stay.
    expect(screen.getByText("GBP 12,500.00")).toBeDefined();
    expect(screen.getByText("Grand Hall")).toBeDefined();
  });

  it("labels the pipeline figure with the definition it actually uses", async () => {
    getVenueDashboardAnalyticsMock.mockResolvedValue(dashboardData());
    render(<ExecutiveAnalyticsView />);

    await waitFor(() => { expect(screen.getByText("Executive analytics")).toBeDefined(); });
    expect(screen.getByText("Pipeline value")).toBeDefined();
    expect(screen.getByText("Open opportunities only")).toBeDefined();
  });

  it("surfaces analytics failures with a retry path", async () => {
    getVenueDashboardAnalyticsMock
      .mockRejectedValueOnce(new Error("analytics offline"))
      .mockResolvedValueOnce(dashboardData());

    render(<ExecutiveAnalyticsView />);

    expect(await screen.findByText("Analytics unavailable")).toBeDefined();
    expect(document.body.textContent).toContain("analytics offline");
    fireEvent.click(screen.getByRole("button", { name: "Retry analytics" }));

    await waitFor(() => {
      expect(screen.getByText("Executive analytics")).toBeDefined();
    });
    expect(getVenueDashboardAnalyticsMock).toHaveBeenCalledTimes(2);
  });
});
