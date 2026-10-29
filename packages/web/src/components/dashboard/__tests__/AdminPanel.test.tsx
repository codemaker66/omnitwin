import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PricingRule } from "../../../api/pricing.js";
import type { CreateSpaceInput, Space, Venue, VenueDetail } from "../../../api/spaces.js";
import { ApiError } from "../../../api/client.js";
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
  restoreSpace: vi.fn(),
  deleteVenue: vi.fn(),
  listPricingRules: vi.fn(),
  createPricingRule: vi.fn(),
  updatePricingRule: vi.fn(),
  deletePricingRule: vi.fn(),
  restorePricingRule: vi.fn(),
  addToast: vi.fn(),
}));

vi.mock("../../../api/spaces.js", async (importOriginal) => ({
  deletedRoomHoldingSlug: (await importOriginal<typeof import("../../../api/spaces.js")>()).deletedRoomHoldingSlug,
  listVenues: mocks.listVenues,
  getVenue: mocks.getVenue,
  createVenue: mocks.createVenue,
  createSpace: mocks.createSpace,
  updateSpace: mocks.updateSpace,
  deleteSpace: mocks.deleteSpace,
  restoreSpace: mocks.restoreSpace,
  deleteVenue: mocks.deleteVenue,
}));

vi.mock("../../../api/pricing.js", () => ({
  listPricingRules: mocks.listPricingRules,
  createPricingRule: mocks.createPricingRule,
  updatePricingRule: mocks.updatePricingRule,
  deletePricingRule: mocks.deletePricingRule,
  restorePricingRule: mocks.restorePricingRule,
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
  mocks.restoreSpace.mockReset();
  mocks.deleteVenue.mockReset();
  mocks.listPricingRules.mockReset();
  mocks.createPricingRule.mockReset();
  mocks.updatePricingRule.mockReset();
  mocks.deletePricingRule.mockReset();
  mocks.restorePricingRule.mockReset();
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
  mocks.updatePricingRule.mockResolvedValue(pricingRuleFixture());
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
        appliesFrom: null,
        appliesUntil: null,
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

// ---------------------------------------------------------------------------
// T-635 N5, item 14: a delete only marks the record, so the words say so; a
// deleted pricing rule can be brought back; Tiered, which cannot be priced
// from here, is not offered; a stray click does not throw a form away.
// ---------------------------------------------------------------------------
describe("AdminPanel says what a delete does, and gives a way back", () => {
  it("says a deleted venue's spaces, rules and layouts are kept, with counts", async () => {
    await renderOpenedVenue();
    await screen.findByText("Grand Hall Half Day");
    fireEvent.click(screen.getByRole("button", { name: "Delete Venue" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Venue" });
    expect(dialog.textContent).toContain(
      "Delete \"Trades Hall Glasgow\"? It stops showing in Venviewer. Its 1 space, 1 pricing rule and saved layouts are kept, not erased.",
    );
    expect(dialog.textContent).not.toMatch(/permanently/u);
  });

  it("names the space being deleted and says its layouts are kept", async () => {
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "Delete space Grand Hall" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Space" });
    expect(dialog.textContent).toContain(
      "Delete \"Grand Hall\"? It stops showing in Venviewer, and its past bookings leave the Diary with it. Its saved layouts and loadouts are kept, not erased, and it can be brought back. A space with bookings still to come cannot be deleted.",
    );
    expect(dialog.textContent).not.toContain("will be removed");
  });

  it("offers a deleted space back, and Undo restores it (admin-venues-3)", async () => {
    mocks.restoreSpace.mockResolvedValue(spaceFixture());
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "Delete space Grand Hall" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Delete Space" })).getByRole("button", { name: "Delete" }));
    const undo = await screen.findByRole("button", { name: "Undo: bring back Grand Hall" });
    expect(undo.closest("[role='status']")?.textContent).toContain("Deleted \u201cGrand Hall\u201d.");
    fireEvent.click(undo);
    await waitFor(() => { expect(mocks.restoreSpace).toHaveBeenCalledWith(VENUE_ID, SPACE_ID); });
    await waitFor(() => { expect(mocks.addToast).toHaveBeenCalledWith("\"Grand Hall\" is back", "success"); });
  });

  it("says what still holds a space that is booked ahead, and offers nothing to undo (admin-venues-3)", async () => {
    mocks.deleteSpace.mockRejectedValue(new ApiError(409, "Grand Hall has 2 bookings still to come. Release or move them on the Diary before deleting the room.", "ROOM_HAS_BOOKINGS", { bookings: 2, phases: 0 }));
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "Delete space Grand Hall" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Delete Space" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(mocks.addToast).toHaveBeenCalledWith("Grand Hall has 2 bookings still to come. Release or move them on the Diary before deleting the room.", "error");
    });
    expect(screen.queryByRole("button", { name: "Undo: bring back Grand Hall" })).toBeNull();
  });

  it("offers to bring back the deleted space a new one's name belongs to, keeping the form until it does (admin-venues-3)", async () => {
    const DELETED = "00000000-0000-4000-8000-000000006099";
    mocks.createSpace.mockRejectedValue(new ApiError(409, "\"Reception Room\" was deleted and still has this room's address. Restore it, or give the new room another name.", "SLUG_EXISTS", { deletedSpaceId: DELETED, deletedSpaceName: "Reception Room" }));
    mocks.restoreSpace.mockResolvedValue(spaceFixture({ id: DELETED, name: "Reception Room" }));
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "New Space" }));
    fireEvent.change(screen.getByLabelText("Space Name"), { target: { value: "Reception Room" } });
    fireEvent.change(screen.getByLabelText("Height (m)"), { target: { value: "4.2" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset to rectangle" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Space" }));
    const bringBack = await screen.findByRole("button", { name: "Bring back Reception Room" });
    expect(screen.getByRole("dialog", { name: "New Space" })).toBeTruthy();
    fireEvent.click(bringBack);
    await waitFor(() => { expect(mocks.restoreSpace).toHaveBeenCalledWith(VENUE_ID, DELETED); });
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "New Space" })).toBeNull(); });
  });

  it("offers a deleted pricing rule back, and Undo restores it", async () => {
    mocks.restorePricingRule.mockResolvedValue(pricingRuleFixture());
    await renderOpenedVenue();
    await screen.findByText("Grand Hall Half Day");
    mocks.listPricingRules.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole("button", { name: "Delete pricing rule Grand Hall Half Day" }));

    const offer = await screen.findByText(/Deleted .Grand Hall Half Day.\./u);
    expect(offer.closest("[role='status']")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo: bring back Grand Hall Half Day" }));
    await waitFor(() => { expect(mocks.restorePricingRule).toHaveBeenCalledWith(VENUE_ID, RULE_ID, true); });
    await waitFor(() => {
      expect(mocks.addToast).toHaveBeenCalledWith("Pricing rule \"Grand Hall Half Day\" is back", "success");
    });
    expect(screen.queryByRole("button", { name: "Undo: bring back Grand Hall Half Day" })).toBeNull();
  });

  it("keeps the way back when Undo fails, and says the rule is still deleted", async () => {
    mocks.restorePricingRule.mockRejectedValue(new Error(""));
    await renderOpenedVenue();
    await screen.findByText("Grand Hall Half Day");
    fireEvent.click(screen.getByRole("button", { name: "Delete pricing rule Grand Hall Half Day" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo: bring back Grand Hall Half Day" }));
    await waitFor(() => {
      expect(mocks.addToast).toHaveBeenCalledWith("Could not bring the pricing rule back. It is still deleted.", "error");
    });
    expect(screen.getByRole("button", { name: "Undo: bring back Grand Hall Half Day" })).toBeTruthy();
  });

  it("does not offer Tiered, which cannot be priced from this form", async () => {
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "New Rule" }));
    const type = screen.getByLabelText<HTMLSelectElement>("Type");
    expect([...type.options].map((option) => option.value)).toEqual(["flat_rate", "per_hour", "per_head"]);
  });

  it("keeps a half-written form open when the space beside it is clicked", async () => {
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "New Rule" }));
    fireEvent.change(screen.getByLabelText("Rule Name"), { target: { value: "Reception Room Evening" } });
    fireEvent.click(screen.getByRole("dialog", { name: "New Pricing Rule" }));
    expect(screen.getByRole("dialog", { name: "New Pricing Rule" })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Rule Name").value).toBe("Reception Room Evening");

    fireEvent.change(screen.getByLabelText("Rule Name"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("dialog", { name: "New Pricing Rule" }));
    expect(screen.queryByRole("dialog", { name: "New Pricing Rule" })).toBeNull();
  });

  it("keeps a form open on a stray click when only a time of day is entered", async () => {
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "New Rule" }));
    fireEvent.change(screen.getByLabelText("Applies from"), { target: { value: "09:00" } });
    fireEvent.click(screen.getByRole("dialog", { name: "New Pricing Rule" }));
    expect(screen.getByRole("dialog", { name: "New Pricing Rule" })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Goal 19 S6 follow-up: the time of day a rule is for, so the price sheet's
// slots (Half Day 09:00–13:00, Evening 19:00–00:30, …) can be entered without
// stacking on one evening. Both times or neither, as the API insists.
// ---------------------------------------------------------------------------
describe("AdminPanel pricing rule windows", () => {
  function windowRow(name: string): HTMLElement {
    const cell = screen.getByText(name);
    const row = cell.closest("tr");
    if (row === null) throw new Error(`${name} is not in the rule list`);
    return row;
  }

  it("shows each rule's window in the list, or any time", async () => {
    mocks.listPricingRules.mockResolvedValue([
      pricingRuleFixture({ id: "rule-half", name: "Grand Hall Half Day", appliesFrom: "09:00:00", appliesUntil: "13:00:00" }),
      pricingRuleFixture({ id: "rule-evening", name: "Grand Hall Evening", appliesFrom: "19:00:00", appliesUntil: "00:30:00" }),
      pricingRuleFixture({ id: "rule-any", name: "Grand Hall Cleaning", appliesFrom: null, appliesUntil: null }),
      pricingRuleFixture({ id: "rule-older", name: "Saloon Hire" }),
    ]);
    await renderOpenedVenue();

    expect(screen.getByRole("columnheader", { name: "Hours" })).toBeTruthy();
    expect(within(windowRow("Grand Hall Half Day")).getByText("09:00–13:00")).toBeTruthy();
    expect(within(windowRow("Grand Hall Evening")).getByText("19:00–00:30 (past midnight)")).toBeTruthy();
    expect(within(windowRow("Grand Hall Cleaning")).getByText("any time")).toBeTruthy();
    expect(within(windowRow("Saloon Hire")).getByText("any time")).toBeTruthy();
  });

  it("sends a window as HH:MM on create, past midnight included", async () => {
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "New Rule" }));
    fireEvent.change(screen.getByLabelText("Rule Name"), { target: { value: "Grand Hall Evening" } });
    fireEvent.change(screen.getByLabelText("Amount (GBP)"), { target: { value: "1500" } });
    fireEvent.change(screen.getByLabelText("Applies from"), { target: { value: "19:00" } });
    fireEvent.change(screen.getByLabelText("Applies until"), { target: { value: "00:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Rule" }));

    await waitFor(() => {
      expect(mocks.createPricingRule).toHaveBeenCalledWith(VENUE_ID, {
        name: "Grand Hall Evening",
        type: "flat_rate",
        amount: 1500,
        spaceId: null,
        appliesFrom: "19:00",
        appliesUntil: "00:30",
      });
    });
  });

  it("holds the save and says so while only one time is entered", async () => {
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "New Rule" }));
    fireEvent.change(screen.getByLabelText("Rule Name"), { target: { value: "Grand Hall Half Day" } });
    fireEvent.change(screen.getByLabelText("Amount (GBP)"), { target: { value: "550" } });
    fireEvent.change(screen.getByLabelText("Applies from"), { target: { value: "09:00" } });

    expect(screen.getByRole("button", { name: "Create Rule" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Enter both times, or neither.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Applies until"), { target: { value: "13:00" } });
    expect(screen.queryByText("Enter both times, or neither.")).toBeNull();
    expect(screen.getByRole("button", { name: "Create Rule" })).toHaveProperty("disabled", false);

    fireEvent.change(screen.getByLabelText("Applies from"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Create Rule" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Enter both times, or neither.")).toBeTruthy();
    expect(mocks.createPricingRule).not.toHaveBeenCalled();
  });

  it("shows the API's refusal of a window in the office's words, and keeps the form open", async () => {
    // The form mirrors the rule, so the API would not refuse this pair; the
    // mock stands in for a server that does, to prove the words it gets.
    mocks.createPricingRule.mockRejectedValue(Object.assign(new Error("Validation failed"), {
      status: 400,
      code: "VALIDATION_ERROR",
      details: [{ path: ["appliesUntil"], message: "appliesFrom and appliesUntil go together: both, or neither" }],
    }));
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "New Rule" }));
    fireEvent.change(screen.getByLabelText("Rule Name"), { target: { value: "Grand Hall Half Day" } });
    fireEvent.change(screen.getByLabelText("Amount (GBP)"), { target: { value: "550" } });
    fireEvent.change(screen.getByLabelText("Applies from"), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText("Applies until"), { target: { value: "13:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Rule" }));

    await waitFor(() => {
      expect(mocks.addToast).toHaveBeenCalledWith("Enter both times, or neither.", "error");
    });
    expect(screen.getByRole("dialog", { name: "New Pricing Rule" })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Applies from").value).toBe("09:00");
  });

  it("holds the save while a clock is only partly typed, which the browser reports as empty", async () => {
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "New Rule" }));
    fireEvent.change(screen.getByLabelText("Rule Name"), { target: { value: "Grand Hall Evening" } });
    fireEvent.change(screen.getByLabelText("Amount (GBP)"), { target: { value: "1500" } });
    // An empty value that stays empty raises no change event, so the state
    // is read when the clock loses focus, as it does when the button is
    // pressed.
    const from = screen.getByLabelText<HTMLInputElement>("Applies from");
    Object.defineProperty(from, "validity", { configurable: true, value: { badInput: true } });
    fireEvent.blur(from);

    expect(screen.getByRole("button", { name: "Create Rule" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("status").textContent).toBe("Times are HH:MM on a 24-hour clock, as 09:00 or 19:00.");
    expect(from.getAttribute("aria-invalid")).toBe("true");
    expect(from.getAttribute("aria-describedby")).toBe("pricing-rule-window-note");

    Object.defineProperty(from, "validity", { configurable: true, value: { badInput: false } });
    fireEvent.blur(from);
    expect(screen.getByRole("button", { name: "Create Rule" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("status").textContent).toMatch(/Leave both empty/u);
    expect(from.getAttribute("aria-invalid")).toBeNull();
  });

  it("opens a rule for editing with its window on the clock face, and saves the change", async () => {
    mocks.listPricingRules.mockResolvedValue([
      pricingRuleFixture({ appliesFrom: "09:00:00", appliesUntil: "13:00:00" }),
    ]);
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "Edit pricing rule Grand Hall Half Day" }));

    const dialog = screen.getByRole("dialog", { name: "Edit Pricing Rule" });
    expect(within(dialog).getByLabelText<HTMLInputElement>("Rule Name").value).toBe("Grand Hall Half Day");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Amount (GBP)").value).toBe("950.00");
    expect(within(dialog).getByLabelText<HTMLSelectElement>("Space (optional)").value).toBe(SPACE_ID);
    expect(within(dialog).getByLabelText<HTMLInputElement>("Applies from").value).toBe("09:00");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Applies until").value).toBe("13:00");

    fireEvent.change(within(dialog).getByLabelText("Applies from"), { target: { value: "14:00" } });
    fireEvent.change(within(dialog).getByLabelText("Applies until"), { target: { value: "18:00" } });
    fireEvent.change(within(dialog).getByLabelText("Rule Name"), { target: { value: "Grand Hall Afternoon" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    // Only what changed goes: the type, amount and room are not re-sent.
    await waitFor(() => {
      expect(mocks.updatePricingRule).toHaveBeenCalledWith(VENUE_ID, RULE_ID, {
        name: "Grand Hall Afternoon",
        appliesFrom: "14:00",
        appliesUntil: "18:00",
      });
    });
    expect(screen.queryByRole("dialog", { name: "Edit Pricing Rule" })).toBeNull();
    expect(mocks.listPricingRules).toHaveBeenCalledTimes(2);
  });

  it("holds Save Changes until something is changed, and a stray click closes only an untouched edit", async () => {
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "Edit pricing rule Grand Hall Half Day" }));
    expect(screen.getByRole("button", { name: "Save Changes" })).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Amount (GBP)"), { target: { value: "975" } });
    expect(screen.getByRole("button", { name: "Save Changes" })).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("dialog", { name: "Edit Pricing Rule" }));
    expect(screen.getByRole("dialog", { name: "Edit Pricing Rule" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Amount (GBP)"), { target: { value: "950.00" } });
    expect(screen.getByRole("button", { name: "Save Changes" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("dialog", { name: "Edit Pricing Rule" }));
    expect(screen.queryByRole("dialog", { name: "Edit Pricing Rule" })).toBeNull();
    expect(mocks.updatePricingRule).not.toHaveBeenCalled();
  });

  it("opens New Rule empty after an edit was looked at", async () => {
    mocks.listPricingRules.mockResolvedValue([
      pricingRuleFixture({ appliesFrom: "09:00:00", appliesUntil: "13:00:00" }),
    ]);
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "Edit pricing rule Grand Hall Half Day" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "New Rule" }));
    const dialog = screen.getByRole("dialog", { name: "New Pricing Rule" });
    expect(within(dialog).getByLabelText<HTMLInputElement>("Rule Name").value).toBe("");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Amount (GBP)").value).toBe("");
    expect(within(dialog).getByLabelText<HTMLSelectElement>("Space (optional)").value).toBe("");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Applies from").value).toBe("");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Applies until").value).toBe("");
  });

  it("names a room that has left the venue instead of reading the rule as venue-wide, and lets the rule be renamed", async () => {
    mocks.listPricingRules.mockResolvedValue([pricingRuleFixture({ spaceId: "00000000-0000-4000-8000-000000006099" })]);
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "Edit pricing rule Grand Hall Half Day" }));
    const space = screen.getByLabelText<HTMLSelectElement>("Space (optional)");
    expect(space.value).toBe("00000000-0000-4000-8000-000000006099");
    expect(space.options[space.selectedIndex]?.textContent).toBe("Room no longer listed (as entered)");

    fireEvent.change(screen.getByLabelText("Rule Name"), { target: { value: "Grand Hall Morning" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => {
      expect(mocks.updatePricingRule).toHaveBeenCalledWith(VENUE_ID, RULE_ID, { name: "Grand Hall Morning" });
    });
  });

  it("clears a window on edit by sending both null", async () => {
    mocks.listPricingRules.mockResolvedValue([
      pricingRuleFixture({ appliesFrom: "19:00:00", appliesUntil: "00:30:00" }),
    ]);
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "Edit pricing rule Grand Hall Half Day" }));
    fireEvent.change(screen.getByLabelText("Applies from"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Applies until"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mocks.updatePricingRule).toHaveBeenCalledWith(VENUE_ID, RULE_ID, expect.objectContaining({
        appliesFrom: null,
        appliesUntil: null,
      }));
    });
  });

  it("keeps a tiered rule's type when editing it, and offers Tiered on no other form", async () => {
    mocks.listPricingRules.mockResolvedValue([
      pricingRuleFixture({ type: "tiered", tiers: [{ upTo: 100, amount: 20 }] }),
      pricingRuleFixture({ id: "rule-flat", name: "Saloon Hire" }),
    ]);
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "Edit pricing rule Grand Hall Half Day" }));
    const type = screen.getByLabelText<HTMLSelectElement>("Type");
    expect(type.value).toBe("tiered");
    expect([...type.options].map((option) => option.value)).toEqual(["flat_rate", "per_hour", "per_head", "tiered"]);
    fireEvent.change(screen.getByLabelText("Rule Name"), { target: { value: "Grand Hall per head, tiered" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => {
      expect(mocks.updatePricingRule).toHaveBeenCalledWith(VENUE_ID, RULE_ID, { name: "Grand Hall per head, tiered" });
    });
    await screen.findByRole("button", { name: "Edit pricing rule Saloon Hire" });

    fireEvent.click(screen.getByRole("button", { name: "Edit pricing rule Saloon Hire" }));
    const flatType = screen.getByLabelText<HTMLSelectElement>("Type");
    expect([...flatType.options].map((option) => option.value)).toEqual(["flat_rate", "per_hour", "per_head"]);
  });

  it("says what went wrong when a change is refused, and keeps the form open", async () => {
    mocks.updatePricingRule.mockRejectedValue(Object.assign(new Error("appliesFrom and appliesUntil go together: both, or neither"), {
      status: 400, code: "VALIDATION_ERROR",
    }));
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "Edit pricing rule Grand Hall Half Day" }));
    fireEvent.change(screen.getByLabelText("Rule Name"), { target: { value: "Grand Hall Morning" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mocks.addToast).toHaveBeenCalledWith("Enter both times, or neither.", "error");
    });
    expect(screen.getByRole("dialog", { name: "Edit Pricing Rule" })).toBeTruthy();
  });

  it("explains the window in the form without a word of compliance", async () => {
    await renderOpenedVenue();
    fireEvent.click(screen.getByRole("button", { name: "New Rule" }));
    const dialog = screen.getByRole("dialog", { name: "New Pricing Rule" });
    expect(within(dialog).getByText(/Leave both empty and the rate applies at any time/u)).toBeTruthy();
    expect(dialog.textContent ?? "").not.toMatch(/compli|regulat|certif|approved/iu);
  });
});
