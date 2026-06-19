import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
