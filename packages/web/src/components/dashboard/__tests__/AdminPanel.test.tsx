import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PricingRule } from "../../../api/pricing.js";
import type { CreateSpaceInput, Space, Venue, VenueDetail } from "../../../api/spaces.js";
import { AdminPanel } from "../AdminPanel.js";

const VENUE_ID = "00000000-0000-4000-8000-000000006001";
const SPACE_ID = "00000000-0000-4000-8000-000000006002";
const RULE_ID = "00000000-0000-4000-8000-000000006003";

const mocks = vi.hoisted(() => ({
  listVenues: vi.fn(),
  getVenue: vi.fn(),
  createVenue: vi.fn(),
  createSpace: vi.fn(),
  updateSpace: vi.fn(),
  deleteSpace: vi.fn(),
  deleteVenue: vi.fn(),
  listPricingRules: vi.fn(),
  createPricingRule: vi.fn(),
  deletePricingRule: vi.fn(),
  addToast: vi.fn(),
}));

vi.mock("../../../api/spaces.js", () => ({
  listVenues: mocks.listVenues,
  getVenue: mocks.getVenue,
  createVenue: mocks.createVenue,
  createSpace: mocks.createSpace,
  updateSpace: mocks.updateSpace,
  deleteSpace: mocks.deleteSpace,
  deleteVenue: mocks.deleteVenue,
}));

vi.mock("../../../api/pricing.js", () => ({
  listPricingRules: mocks.listPricingRules,
  createPricingRule: mocks.createPricingRule,
  deletePricingRule: mocks.deletePricingRule,
}));

vi.mock("../../../stores/toast-store.js", () => ({
  useToastStore: (selector: (state: { readonly addToast: typeof mocks.addToast }) => unknown): unknown =>
    selector({ addToast: mocks.addToast }),
}));

function spaceFixture(overrides: Partial<Space> = {}): Space {
  return {
    id: SPACE_ID,
    venueId: VENUE_ID,
    name: "Grand Hall",
    slug: "grand-hall",
    widthM: "21",
    lengthM: "10.5",
    heightM: "7",
    floorPlanOutline: [
      { x: -10.5, y: -5.25 },
      { x: 10.5, y: -5.25 },
      { x: 10.5, y: 5.25 },
      { x: -10.5, y: 5.25 },
    ],
    ...overrides,
  };
}

function venueFixture(overrides: Partial<Venue> = {}): Venue {
  return {
    id: VENUE_ID,
    name: "Trades Hall Glasgow",
    slug: "trades-hall",
    address: "85 Glassford Street, Glasgow G1 1UH",
    logoUrl: null,
    brandColour: "#c9a96a",
    ...overrides,
  };
}

function venueDetailFixture(overrides: Partial<VenueDetail> = {}): VenueDetail {
  return {
    ...venueFixture(),
    spaces: [spaceFixture()],
    ...overrides,
  };
}

function pricingRuleFixture(overrides: Partial<PricingRule> = {}): PricingRule {
  return {
    id: RULE_ID,
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    name: "Grand Hall Half Day",
    type: "flat_rate",
    amount: "950.00",
    currency: "GBP",
    minHours: null,
    minGuests: null,
    isActive: true,
    validFrom: null,
    validTo: null,
    ...overrides,
  };
}

async function renderOpenedVenue(): Promise<void> {
  render(<AdminPanel />);
  fireEvent.click(await screen.findByRole("button", { name: /Trades Hall Glasgow/u }));
  expect(await screen.findByRole("heading", { name: "Trades Hall Glasgow" })).toBeTruthy();
}

beforeEach(() => {
  mocks.listVenues.mockReset();
  mocks.getVenue.mockReset();
  mocks.createVenue.mockReset();
  mocks.createSpace.mockReset();
  mocks.updateSpace.mockReset();
  mocks.deleteSpace.mockReset();
  mocks.deleteVenue.mockReset();
  mocks.listPricingRules.mockReset();
  mocks.createPricingRule.mockReset();
  mocks.deletePricingRule.mockReset();
  mocks.addToast.mockReset();

  mocks.listVenues.mockResolvedValue([venueFixture()]);
  mocks.getVenue.mockResolvedValue(venueDetailFixture());
  mocks.createVenue.mockResolvedValue(venueFixture({ id: "00000000-0000-4000-8000-000000006004", name: "New Venue" }));
  mocks.createSpace.mockResolvedValue(spaceFixture({ id: "00000000-0000-4000-8000-000000006005", name: "Reception Room" }));
  mocks.updateSpace.mockResolvedValue(spaceFixture({ name: "Grand Hall Updated", heightM: "7.5" }));
  mocks.deleteSpace.mockResolvedValue(undefined);
  mocks.deleteVenue.mockResolvedValue(undefined);
  mocks.listPricingRules.mockResolvedValue([pricingRuleFixture()]);
  mocks.createPricingRule.mockResolvedValue(pricingRuleFixture({ id: "00000000-0000-4000-8000-000000006006", name: "Reception Room Evening" }));
  mocks.deletePricingRule.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("AdminPanel", () => {
  it.each(["resolve", "reject"] as const)("shows detail refresh after a room save until the request %ss", async (settlement) => {
    let resolveRefresh: ((value: VenueDetail) => void) | undefined;
    let rejectRefresh: ((reason: Error) => void) | undefined;
    const response = new Promise<VenueDetail>((resolve, reject) => { resolveRefresh = resolve; rejectRefresh = reject; });
    mocks.getVenue.mockResolvedValueOnce(venueDetailFixture()).mockReturnValueOnce(response);
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "Edit space Grand Hall" }));
    fireEvent.change(screen.getByLabelText("Height (m)"), { target: { value: "7.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    const activity = await screen.findByText("Refreshing venue details…");
    expect(activity.closest("[role='status']")?.querySelector("[data-activity-indicator]")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Trades Hall Glasgow" })).toBeTruthy();
    await act(async () => {
      if (settlement === "resolve") resolveRefresh?.(venueDetailFixture());
      else rejectRefresh?.(new Error("Refresh unavailable"));
      await response.catch(() => undefined);
    });
    expect(screen.queryByText("Refreshing venue details…")).toBeNull();
    if (settlement === "reject") expect(mocks.addToast).toHaveBeenCalledWith("Refresh unavailable", "error");
  });
  it.each(["resolve", "reject"] as const)("does not reopen a deleted venue or report stale errors when its earlier refresh %ss", async (settlement) => {
    let resolveRefresh: ((value: VenueDetail) => void) | undefined;
    let rejectRefresh: ((reason: Error) => void) | undefined;
    let rejectPricing: ((reason: Error) => void) | undefined;
    const refreshResponse = new Promise<VenueDetail>((resolve, reject) => { resolveRefresh = resolve; rejectRefresh = reject; });
    const pricingResponse = new Promise<PricingRule[]>((_resolve, reject) => { rejectPricing = reject; });
    mocks.getVenue.mockResolvedValueOnce(venueDetailFixture()).mockReturnValueOnce(refreshResponse);
    mocks.listPricingRules.mockReturnValue(pricingResponse);
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "Edit space Grand Hall" }));
    fireEvent.change(screen.getByLabelText("Height (m)"), { target: { value: "7.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => { expect(mocks.getVenue).toHaveBeenCalledTimes(2); });
    mocks.listVenues.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Delete Venue" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Delete Venue" })).getByRole("button", { name: "Delete" }));
    await screen.findByRole("heading", { name: "Venue Registry" });
    mocks.addToast.mockClear();
    await act(async () => {
      if (settlement === "resolve") resolveRefresh?.(venueDetailFixture());
      else rejectRefresh?.(new Error("Stale reload failed"));
      rejectPricing?.(new Error("Stale pricing failed"));
      await Promise.allSettled([refreshResponse, pricingResponse]);
    });
    expect(screen.getByRole("heading", { name: "Venue Registry" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Trades Hall Glasgow" })).toBeNull();
    expect(screen.queryByText("Stale reload failed")).toBeNull();
    expect(screen.queryByText("Stale pricing failed")).toBeNull();
    expect(mocks.listPricingRules).toHaveBeenCalledTimes(1);
    expect(mocks.addToast).not.toHaveBeenCalled();
  });

  it("keeps a pricing mutation attached to its venue until it settles", async () => {
    let rejectDelete: ((reason: Error) => void) | undefined;
    const response = new Promise<void>((_resolve, reject) => { rejectDelete = reject; });
    mocks.deletePricingRule.mockReturnValue(response);
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "Delete pricing rule Grand Hall Half Day" }));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Back to venues" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Back to venues" }));
    expect(screen.getByRole("heading", { name: "Trades Hall Glasgow" })).toBeTruthy();
    await act(async () => { rejectDelete?.(new Error("Delete rejected")); await response.catch(() => undefined); });
    expect(mocks.addToast).toHaveBeenCalledWith("Delete rejected", "error");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Back to venues" }).disabled).toBe(false);
    expect(screen.getByText("Grand Hall Half Day")).toBeTruthy();
  });

  it.each(["resolve", "reject"] as const)("keeps the current venue pricing when prior venue pricing later %ss", async (settlement) => {
    let resolveOld: ((value: PricingRule[]) => void) | undefined;
    let rejectOld: ((reason: Error) => void) | undefined;
    const oldResponse = new Promise<PricingRule[]>((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
    const secondVenue = venueFixture({ id: "venue-two", name: "Second venue" });
    mocks.listVenues.mockResolvedValue([venueFixture(), secondVenue]);
    mocks.getVenue.mockImplementation((id: string) => Promise.resolve(id === VENUE_ID ? venueDetailFixture() : { ...secondVenue, spaces: [] }));
    mocks.listPricingRules.mockImplementation((id: string) => id === VENUE_ID ? oldResponse : Promise.resolve([pricingRuleFixture({ id: "rule-two", venueId: "venue-two", name: "Second venue rate" })]));
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "Back to venues" }));
    fireEvent.click(screen.getByRole("button", { name: /Second venue/u }));
    await screen.findByText("Second venue rate");
    expect(screen.queryByText("Loading pricing rules…")).toBeNull();
    await act(async () => {
      if (settlement === "resolve") resolveOld?.([pricingRuleFixture()]);
      else rejectOld?.(new Error("First venue pricing failed"));
      await oldResponse.catch(() => undefined);
    });
    expect(screen.getByText("Second venue rate")).toBeTruthy();
    expect(screen.queryByText("Grand Hall Half Day")).toBeNull();
    expect(screen.queryByText("First venue pricing failed")).toBeNull();
  });

  it("keeps pricing activity visible until the rules request settles", async () => {
    let resolveRules: ((rules: PricingRule[]) => void) | undefined;
    const response = new Promise<PricingRule[]>((resolve) => { resolveRules = resolve; });
    mocks.listPricingRules.mockReturnValue(response);
    await renderOpenedVenue();
    expect(screen.getByText("Loading pricing rules…")).toBeDefined();
    expect(screen.queryByText("No pricing rules configured.")).toBeNull();
    await act(async () => { resolveRules?.([]); await response; });
    expect(screen.queryByText("Loading pricing rules…")).toBeNull();
    expect(screen.getByText("No pricing rules configured.")).toBeDefined();
  });

  it("loads venues and opens a venue detail through a real button", async () => {
    await renderOpenedVenue();

    expect(mocks.getVenue).toHaveBeenCalledWith(VENUE_ID);
    expect(screen.getByRole("heading", { name: "Spaces" })).toBeTruthy();
    expect(screen.getByText("Grand Hall Half Day")).toBeTruthy();
  });

  it("creates a venue with an auto-generated slug and refreshes the registry", async () => {
    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "New Venue" }));
    fireEvent.change(screen.getByLabelText("Venue Name"), { target: { value: "New Venue" } });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "1 Test Street" } });
    expect(screen.getByText("Slug: new-venue")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create Venue" }));

    await waitFor(() => {
      expect(mocks.createVenue).toHaveBeenCalledWith({
        name: "New Venue",
        slug: "new-venue",
        address: "1 Test Street",
      });
    });
    expect(mocks.addToast).toHaveBeenCalledWith("Venue created", "success");
    expect(mocks.listVenues).toHaveBeenCalledTimes(2);
  });

  it("creates a space only after a real floor-plan polygon exists", async () => {
    await renderOpenedVenue();

    fireEvent.click(screen.getByRole("button", { name: "New Space" }));
    fireEvent.change(screen.getByLabelText("Space Name"), { target: { value: "Reception Room" } });
    fireEvent.change(screen.getByLabelText("Height (m)"), { target: { value: "4.2" } });
    expect(screen.getByRole("button", { name: "Create Space" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Reset to rectangle" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Space" }));

    await waitFor(() => {
      expect(mocks.createSpace).toHaveBeenCalled();
    });
    const firstCall = mocks.createSpace.mock.calls[0];
    if (firstCall === undefined) throw new Error("expected createSpace to be called");
    expect(firstCall[0]).toBe(VENUE_ID);
    const payload = firstCall[1] as CreateSpaceInput;
    expect(payload).toMatchObject({
      name: "Reception Room",
      slug: "reception-room",
      heightM: 4.2,
    });
    expect(payload.floorPlanOutline.length).toBeGreaterThanOrEqual(3);
  });

  it("updates an existing space and keeps unchanged geometry out of the PATCH payload", async () => {
    await renderOpenedVenue();

    fireEvent.click(screen.getByRole("button", { name: "Edit space Grand Hall" }));
    fireEvent.change(screen.getByLabelText("Space Name"), { target: { value: "Grand Hall Updated" } });
    fireEvent.change(screen.getByLabelText("Height (m)"), { target: { value: "7.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mocks.updateSpace).toHaveBeenCalledWith(VENUE_ID, SPACE_ID, {
        name: "Grand Hall Updated",
        heightM: 7.5,
      });
    });
  });

  it("creates and deletes pricing rules through explicit admin actions", async () => {
    await renderOpenedVenue();

    fireEvent.click(screen.getByRole("button", { name: "New Rule" }));
    fireEvent.change(screen.getByLabelText("Rule Name"), { target: { value: "Reception Room Evening" } });
    fireEvent.change(screen.getByLabelText("Amount (GBP)"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Rule" }));

    await waitFor(() => {
      expect(mocks.createPricingRule).toHaveBeenCalledWith(VENUE_ID, {
        name: "Reception Room Evening",
        type: "flat_rate",
        amount: 500,
        spaceId: null,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete pricing rule Grand Hall Half Day" }));
    await waitFor(() => {
      expect(mocks.deletePricingRule).toHaveBeenCalledWith(VENUE_ID, RULE_ID);
    });
  });

  it("surfaces venue registry load failures with a retry path", async () => {
    mocks.listVenues
      .mockRejectedValueOnce(new Error("registry offline"))
      .mockResolvedValueOnce([venueFixture()]);

    render(<AdminPanel />);

    expect(await screen.findByRole("heading", { name: "Venue registry unavailable" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: /Trades Hall Glasgow/u })).toBeTruthy();
    expect(mocks.listVenues).toHaveBeenCalledTimes(2);
  });
});
