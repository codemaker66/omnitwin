import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Venue, VenueDetail } from "../../../api/spaces.js";
import { ApiError } from "../../../api/client.js";
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

// The Changeovers section below the form has its own tests
// (changeovers/__tests__); here it only needs a venue with no rules.
vi.mock("../../../api/turnaround-rules.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../api/turnaround-rules.js")>(),
  listTurnaroundRules: vi.fn().mockResolvedValue({ rules: [], rooms: [], eventTypes: [] }),
  createTurnaroundRule: vi.fn(),
  updateTurnaroundRule: vi.fn(),
  retireTurnaroundRule: vi.fn(),
  ruleFromRefusal: vi.fn().mockReturnValue(null),
}));

// The section on dates for assistants and the website has its own tests
// (forward-book/__tests__); here it only needs one room nobody has checked.
const forwardBookMocks = vi.hoisted(() => ({
  list: vi.fn(),
}));
vi.mock("../../../api/forward-book.js", () => ({
  listForwardBook: forwardBookMocks.list,
  recordForwardBook: vi.fn(),
  clearForwardBook: vi.fn(),
  checkFromRefusal: vi.fn().mockReturnValue(null),
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
  forwardBookMocks.list.mockReset();
  forwardBookMocks.list.mockResolvedValue({
    rooms: [{ spaceId: "00000000-0000-4000-8000-000000005003", name: "Reception Room", current: null, previous: null }],
  });
});

afterEach(() => {
  cleanup();
});

describe("VenueSettings", () => {
  it("loads venue details, validates dirty state, and saves the typed venue update", async () => {
    render(<VenueSettings />);

    expect(await screen.findByRole("heading", { name: "Venue settings" })).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Venue name"), { target: { value: "  Trades Hall Updated  " } });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "85 Glassford Street" } });
    fireEvent.change(screen.getByLabelText("Brand colour"), { target: { value: "#68d8d2" } });
    fireEvent.change(screen.getByLabelText("Logo link"), { target: { value: "https://assets.example/trades-hall.svg" } });
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
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(mocks.addToast).toHaveBeenCalledWith("Venue settings saved", "success");
  });

  it("keeps invalid brand colour and logo URL out of the save path", async () => {
    render(<VenueSettings />);

    expect(await screen.findByRole("heading", { name: "Venue settings" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Brand colour"), { target: { value: "gold" } });
    fireEvent.change(screen.getByLabelText("Logo link"), { target: { value: "not a url" } });

    expect(screen.getByText(/six-digit colour code/u)).toBeTruthy();
    expect(screen.getByText(/full link, starting https/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(true);
    expect(mocks.updateVenue).not.toHaveBeenCalled();
  });

  it.each(["hallkeeper", "sales"])("shows a %s the venue's details with nothing to change, and says who sets them (dash-ops-2)", async (role) => {
    mocks.authState.user = { ...mocks.authState.user, role };
    render(<VenueSettings />);
    expect(await screen.findByRole("heading", { name: "Venue settings" })).toBeTruthy();
    expect(screen.getByText("The venue's administrators, managers and office staff set these details.")).toBeTruthy();
    expect(screen.getByText("Trades Hall Glasgow", { selector: "dd" })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.queryByText("Saved")).toBeNull();
    expect(await screen.findByText("The venue's administrators, managers and office staff set changeover times.")).toBeTruthy();
    expect(screen.queryByText("Add a changeover time")).toBeNull();
    expect(mocks.updateVenue).not.toHaveBeenCalled();
  });

  it.each([
    { label: "staff", user: { role: "staff", platformRole: "none" } },
    { label: "a platform administrator", user: { role: "planner", platformRole: "admin" } },
  ])("offers $label the venue's details to change", async ({ user }) => {
    mocks.authState.user = { ...mocks.authState.user, ...user };
    render(<VenueSettings />);
    expect(await screen.findByLabelText("Venue name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
    expect(await screen.findByText("Add a changeover time")).toBeTruthy();
  });

  it("says who sets the details, not a bare failure, when the API refuses the save (dash-ops-2)", async () => {
    mocks.updateVenue.mockRejectedValue(new ApiError(403, "Insufficient permissions", "FORBIDDEN"));
    render(<VenueSettings />);
    fireEvent.change(await screen.findByLabelText("Venue name"), { target: { value: "Trades Hall" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The venue's administrators, managers and office staff set these details. Nothing has changed.");
  });

  it("surfaces load failures with a retry action", async () => {
    mocks.getVenue
      .mockRejectedValueOnce(new Error("Registry unavailable"))
      .mockResolvedValueOnce(venueFixture());

    render(<VenueSettings />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Registry unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Venue settings" })).toBeTruthy();
    expect(mocks.getVenue).toHaveBeenCalledTimes(2);
  });

  it("offers the venue's admin the check that lets assistants and the website show a room's dates", async () => {
    render(<VenueSettings />);
    expect(await screen.findByRole("heading", { name: "Dates for assistants and the website" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Record the check for the Reception Room" })).toBeTruthy();
    expect(forwardBookMocks.list).toHaveBeenCalledWith(VENUE_ID, expect.any(AbortSignal));
  });

  it("shows staff where each room stands, and who records the check, without offering it", async () => {
    mocks.authState.user = { ...mocks.authState.user, role: "staff" };
    render(<VenueSettings />);
    expect(await screen.findByText("Not checked yet")).toBeTruthy();
    expect(screen.getByText("The venue’s admin or a manager records these checks.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Record the check/u })).toBeNull();
  });

  it("does not show the section to someone who does not read the Diary", async () => {
    mocks.authState.user = { ...mocks.authState.user, role: "planner" };
    render(<VenueSettings />);
    expect(await screen.findByRole("heading", { name: "Venue settings" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Dates for assistants and the website" })).toBeNull();
    expect(forwardBookMocks.list).not.toHaveBeenCalled();
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
