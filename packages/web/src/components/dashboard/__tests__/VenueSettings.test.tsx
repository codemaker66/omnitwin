import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Venue, VenueDetail } from "../../../api/spaces.js";
import { VenueSettings } from "../VenueSettings.js";

const VENUE_ID = "00000000-0000-4000-8000-000000005001";

const mocks = vi.hoisted(() => ({
  getVenue: vi.fn(),
  updateVenue: vi.fn(),
  addToast: vi.fn(),
  authState: {
    user: {
      id: "00000000-0000-4000-8000-000000005002",
      email: "admin@tradeshall.test",
      role: "admin",
      platformRole: "none",
      venueId: "00000000-0000-4000-8000-000000005001" as string | null,
      name: "Admin User",
    },
  },
}));

vi.mock("../../../api/spaces.js", () => ({
  getVenue: mocks.getVenue,
  updateVenue: mocks.updateVenue,
}));

vi.mock("../../../stores/auth-store.js", () => ({
  useAuthStore: (selector: (state: typeof mocks.authState) => unknown): unknown =>
    selector(mocks.authState),
}));

vi.mock("../../../stores/toast-store.js", () => ({
  useToastStore: (selector: (state: { readonly addToast: typeof mocks.addToast }) => unknown): unknown =>
    selector({ addToast: mocks.addToast }),
}));

function venueFixture(overrides: Partial<VenueDetail> = {}): VenueDetail {
  return {
    id: VENUE_ID,
    name: "Trades Hall Glasgow",
    slug: "trades-hall",
    address: "85 Glassford Street, Glasgow G1 1UH",
    logoUrl: null,
    brandColour: "#c9a96a",
    spaces: [
      {
        id: "00000000-0000-4000-8000-000000005003",
        venueId: VENUE_ID,
        name: "Reception Room",
        slug: "reception-room",
        widthM: "12",
        lengthM: "8",
        heightM: "4",
        floorPlanOutline: [],
      },
    ],
    ...overrides,
  };
}

function updatedVenueFixture(overrides: Partial<Venue> = {}): Venue {
  return {
    id: VENUE_ID,
    name: "Trades Hall Updated",
    slug: "trades-hall",
    address: "85 Glassford Street",
    logoUrl: "https://assets.example/trades-hall.svg",
    brandColour: "#68d8d2",
    ...overrides,
  };
}

beforeEach(() => {
  mocks.getVenue.mockReset();
  mocks.updateVenue.mockReset();
  mocks.addToast.mockReset();
  mocks.authState.user = {
    id: "00000000-0000-4000-8000-000000005002",
    email: "admin@tradeshall.test",
    role: "admin",
    platformRole: "none",
    venueId: VENUE_ID,
    name: "Admin User",
  };
  mocks.getVenue.mockResolvedValue(venueFixture());
  mocks.updateVenue.mockResolvedValue(updatedVenueFixture());
});

afterEach(() => {
  cleanup();
});

describe("VenueSettings", () => {
  it("loads venue details, validates dirty state, and saves the typed venue update", async () => {
    render(<VenueSettings />);

    expect(await screen.findByRole("heading", { name: "Venue Settings" })).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save Changes" });
    expect(save.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Venue Name"), { target: { value: "  Trades Hall Updated  " } });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "85 Glassford Street" } });
    fireEvent.change(screen.getByLabelText("Brand Colour"), { target: { value: "#68d8d2" } });
    fireEvent.change(screen.getByLabelText("Logo URL"), { target: { value: "https://assets.example/trades-hall.svg" } });
    expect(save.hasAttribute("disabled")).toBe(false);

    fireEvent.click(save);

    await waitFor(() => {
      expect(mocks.updateVenue).toHaveBeenCalledWith(VENUE_ID, {
        name: "Trades Hall Updated",
        address: "85 Glassford Street",
        brandColour: "#68d8d2",
        logoUrl: "https://assets.example/trades-hall.svg",
      });
    });
    expect(await screen.findByText("Venue record in sync")).toBeTruthy();
    expect(mocks.addToast).toHaveBeenCalledWith("Venue settings saved", "success");
  });

  it("keeps invalid brand colour and logo URL out of the save path", async () => {
    render(<VenueSettings />);

    expect(await screen.findByRole("heading", { name: "Venue Settings" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Brand Colour"), { target: { value: "gold" } });
    fireEvent.change(screen.getByLabelText("Logo URL"), { target: { value: "not a url" } });

    expect(screen.getByText(/six-digit hex colour/u)).toBeTruthy();
    expect(screen.getByText(/valid http or https URL/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save Changes" }).hasAttribute("disabled")).toBe(true);
    expect(mocks.updateVenue).not.toHaveBeenCalled();
  });

  it("surfaces load failures with a retry action", async () => {
    mocks.getVenue
      .mockRejectedValueOnce(new Error("Registry unavailable"))
      .mockResolvedValueOnce(venueFixture());

    render(<VenueSettings />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Registry unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Venue Settings" })).toBeTruthy();
    expect(mocks.getVenue).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the signed-in user has no venue assignment", async () => {
    mocks.authState.user = {
      ...mocks.authState.user,
      venueId: null,
    };

    render(<VenueSettings />);

    expect(await screen.findByRole("heading", { name: "No venue assigned" })).toBeTruthy();
    expect(mocks.getVenue).not.toHaveBeenCalled();
  });
});
