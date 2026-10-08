import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuthStore, type AuthUser } from "../../stores/auth-store.js";
import { DashboardPage } from "../DashboardPage.js";

// ---------------------------------------------------------------------------
// The deal panel's way to the Clients desk (T-635). Sales works the pipeline
// but cannot open Clients (its search gates on the venue floor; who may is
// Blake's C2), so the page hands the pipeline no way there for sales, and the
// panel offers the contact's own details instead of a refusal. The pipeline
// is stubbed to say what it was handed.
// ---------------------------------------------------------------------------

const CONTACT = "00000000-0000-4000-8000-000000009511";

vi.mock("../../components/dashboard/DashboardLayout.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../components/dashboard/DashboardLayout.js")>();
  return { ...actual, DashboardLayout: ({ children }: { readonly children: ReactNode }) => <main>{children}</main> };
});
vi.mock("../../components/dashboard/PipelineDesk.js", () => ({
  PipelineDesk: ({ onOpenClient }: { readonly onOpenClient?: (contactId: string) => void }) => (onOpenClient === undefined
    ? <p>No way to Clients</p>
    : <button type="button" onClick={() => { onOpenClient(CONTACT); }}>Open in Clients</button>),
}));
vi.mock("../../components/dashboard/ClientsDesk.js", () => ({ ClientsDesk: () => <p>The Clients desk</p> }));
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

function person(role: string): AuthUser {
  return { id: `${role}-1`, email: `${role}@example.test`, name: "Catherine Tait", role, platformRole: "none", venueId: "venue-a" };
}

function Address(): ReactNode {
  const location = useLocation();
  return <output aria-label="Address">{location.search}</output>;
}

function openPipeline(user: AuthUser): void {
  useAuthStore.getState().setUser(user);
  render(<MemoryRouter initialEntries={["/dashboard?view=pipeline"]}><DashboardPage /><Address /></MemoryRouter>);
}

afterEach(() => {
  cleanup();
  useAuthStore.getState().setUser(null);
});

describe("the pipeline's way to the Clients desk", () => {
  it("is not offered to sales, whom the Clients desk would refuse", () => {
    openPipeline(person("sales"));
    expect(screen.getByText("No way to Clients")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Open in Clients" })).toBeNull();
  });

  it.each(["staff", "manager", "admin"])("opens the contact on the Clients desk for %s", (role) => {
    openPipeline(person(role));
    fireEvent.click(screen.getByRole("button", { name: "Open in Clients" }));
    expect(screen.getByText("The Clients desk")).toBeDefined();
    expect(screen.getByRole("status", { name: "Address" }).textContent).toBe(`?view=search&client=contact%3A${CONTACT}`);
  });
});
