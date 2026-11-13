import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactProfile, SearchResults } from "../../api/clients.js";
import { useAuthStore, type AuthUser } from "../../stores/auth-store.js";
import { DashboardPage } from "../DashboardPage.js";

// ---------------------------------------------------------------------------
// The Clients desk as the page holds it (release audit dash-commercial-8).
//
// The page keeps what was typed (?q=) and the client open (?client=) in the
// address, and reads the open client back from it on every change of the
// address. A client open beside the list was read again, and shown as
// "Opening client…", each time a search settled, though it was the same
// client. Only the desk's neighbours are stubbed here: the address, the desk
// and the open client are the real ones.
// ---------------------------------------------------------------------------

const AILSA = "00000000-0000-4000-8000-000000008101";
const MORAG = "00000000-0000-4000-8000-000000008102";

const mocks = vi.hoisted(() => ({
  searchClients: vi.fn(),
  getUpcomingClients: vi.fn(),
  getRecentEnquiries: vi.fn(),
  getClientProfile: vi.fn(),
  getLeadProfile: vi.fn(),
  getContactProfile: vi.fn(),
}));

vi.mock("../../api/clients.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/clients.js")>(),
  searchClients: mocks.searchClients,
  getUpcomingClients: mocks.getUpcomingClients,
  getRecentEnquiries: mocks.getRecentEnquiries,
  getClientProfile: mocks.getClientProfile,
  getLeadProfile: mocks.getLeadProfile,
  getContactProfile: mocks.getContactProfile,
}));

vi.mock("../../components/dashboard/DashboardLayout.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../components/dashboard/DashboardLayout.js")>();
  return { ...actual, DashboardLayout: ({ children }: { readonly children: ReactNode }) => <main>{children}</main> };
});
vi.mock("../../components/dashboard/PipelineDesk.js", () => ({ PipelineDesk: () => null }));
vi.mock("../../components/dashboard/EnquiriesView.js", () => ({ EnquiriesView: () => null }));
vi.mock("../../components/dashboard/ReviewsView.js", () => ({ ReviewsView: () => null }));
vi.mock("../../components/dashboard/LoadoutsView.js", () => ({ LoadoutsView: () => null }));
vi.mock("../../components/dashboard/VenueSettings.js", () => ({ VenueSettings: () => null }));
vi.mock("../../components/dashboard/AdminPanel.js", () => ({ AdminPanel: () => null }));
vi.mock("../../components/dashboard/inventory/InventoryPanel.js", () => ({ InventoryPanel: () => null }));
vi.mock("../../components/dashboard/ExecutiveAnalyticsView.js", () => ({ ExecutiveAnalyticsView: () => null }));
vi.mock("../../components/dashboard/ProposalsDesk.js", () => ({ ProposalsDesk: () => null }));
vi.mock("../../components/dashboard/OnboardingView.js", () => ({ OnboardingView: () => null }));
vi.mock("../../components/dashboard/rota/RotaView.js", () => ({ RotaView: () => null }));

const STAFF: AuthUser = { id: "staff-1", email: "staff@example.test", name: "Catherine Tait", role: "staff", platformRole: "none", venueId: "venue-a" };

function profile(id: string, name: string): ContactProfile {
  return {
    contact: {
      id, venueId: "venue-a", name, email: `${id}@example.test`, phone: null, roleLabel: null, sourceEnquiryId: null,
      createdAt: "2026-03-02T09:00:00.000Z", account: null,
    },
    deals: [],
    proposals: [],
  };
}

const FOUND: SearchResults = {
  users: [], guestLeads: [], configurations: [], accounts: [], deals: [], proposals: [],
  contacts: [
    { id: AILSA, name: "Ailsa Henderson", email: "ailsa@example.test", phone: null, accountName: null },
    { id: MORAG, name: "Morag Henderson", email: "morag@example.test", phone: null, accountName: null },
  ],
};

function Address(): ReactNode {
  const location = useLocation();
  return <output aria-label="Address">{location.search}</output>;
}

function address(): string {
  return screen.getByRole("status", { name: "Address" }).textContent ?? "";
}

beforeEach(() => {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string): MediaQueryList => ({
    matches: query === "(min-width: 1180px)",
    media: query, onchange: null,
    addListener: () => undefined, removeListener: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
  }));
  mocks.getUpcomingClients.mockResolvedValue([]);
  mocks.getRecentEnquiries.mockResolvedValue([]);
  mocks.searchClients.mockResolvedValue(FOUND);
  useAuthStore.getState().setUser(STAFF);
});

afterEach(() => {
  cleanup();
  useAuthStore.getState().setUser(null);
  vi.restoreAllMocks();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("a client open on the Clients desk while the search changes", () => {
  it("stays as read when a search settles, and is read when another client opens", async () => {
    // Any read after the first never answers, so a second read would leave
    // the panel saying it is opening the client.
    mocks.getContactProfile
      .mockResolvedValueOnce(profile(AILSA, "Ailsa Henderson"))
      .mockReturnValue(new Promise<ContactProfile>(() => undefined));
    render(
      <MemoryRouter initialEntries={[`/dashboard?view=search&client=contact%3A${AILSA}`]}>
        <DashboardPage />
        <Address />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { level: 2, name: "Ailsa Henderson" })).toBeDefined();
    expect(mocks.getContactProfile).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search clients" }), { target: { value: "henderson" } });
    await waitFor(() => { expect(address()).toContain("q=henderson"); });
    await screen.findByRole("button", { name: /^Morag Henderson/u });

    expect(mocks.getContactProfile).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Opening client…")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Ailsa Henderson" })).toBeDefined();

    // Another client is another read.
    fireEvent.click(screen.getByRole("button", { name: /^Morag Henderson/u }));
    await waitFor(() => { expect(mocks.getContactProfile).toHaveBeenLastCalledWith(MORAG); });
    expect(mocks.getContactProfile).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("Opening client…")).toBeDefined();
  });
});
