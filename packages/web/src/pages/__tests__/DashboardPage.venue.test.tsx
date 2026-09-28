import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuthStore, type AuthUser } from "../../stores/auth-store.js";
import { DashboardPage } from "../DashboardPage.js";

// ---------------------------------------------------------------------------
// An account that works at a venue but is not connected to one yet. Every
// venue gate in the API refuses it, so each dashboard view says so in its own
// name instead of opening, and no view (and so no venue read) is mounted. A
// platform admin reads every venue and a customer has no venue by design:
// both open the views as before.
// ---------------------------------------------------------------------------

vi.mock("../../components/dashboard/DashboardLayout.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../components/dashboard/DashboardLayout.js")>();
  return {
    ...actual,
    DashboardLayout: ({ children, surface }: { readonly children: ReactNode; readonly surface?: string }) => (
      <main data-testid="layout" data-surface={surface ?? "none"}>{children}</main>
    ),
  };
});

function stub(name: string): () => ReactNode {
  return () => <p data-testid="view">{name}</p>;
}

vi.mock("../../components/dashboard/EnquiriesView.js", () => ({ EnquiriesView: stub("enquiries") }));
vi.mock("../../components/dashboard/ReviewsView.js", () => ({ ReviewsView: stub("reviews") }));
vi.mock("../../components/dashboard/ClientsDesk.js", () => ({ ClientsDesk: stub("search") }));
vi.mock("../../components/dashboard/LoadoutsView.js", () => ({ LoadoutsView: stub("loadouts") }));
vi.mock("../../components/dashboard/VenueSettings.js", () => ({ VenueSettings: stub("settings") }));
vi.mock("../../components/dashboard/AdminPanel.js", () => ({ AdminPanel: stub("admin") }));
vi.mock("../../components/dashboard/inventory/InventoryPanel.js", () => ({ InventoryPanel: stub("inventory") }));
vi.mock("../../components/dashboard/ExecutiveAnalyticsView.js", () => ({ ExecutiveAnalyticsView: stub("analytics") }));
vi.mock("../../components/dashboard/ProposalsDesk.js", () => ({ ProposalsDesk: stub("proposals") }));
vi.mock("../../components/dashboard/PipelineDesk.js", () => ({ PipelineDesk: stub("pipeline") }));
vi.mock("../../components/dashboard/OnboardingView.js", () => ({ OnboardingView: stub("onboarding") }));
vi.mock("../../components/dashboard/rota/RotaView.js", () => ({ RotaView: stub("rota") }));

const UNPLACED: AuthUser = { id: "u1", email: "new@example.test", name: "New Colleague", role: "admin", platformRole: "none", venueId: null };

function open(view: string, user: AuthUser): void {
  useAuthStore.getState().setUser(user);
  render(<MemoryRouter initialEntries={[`/dashboard?view=${view}`]}><DashboardPage /></MemoryRouter>);
}

afterEach(() => {
  cleanup();
  useAuthStore.getState().setUser(null);
});

describe("an account not connected to a venue yet", () => {
  it.each([
    ["enquiries", "Enquiries", "there are no enquiries to show"],
    ["pipeline", "Pipeline", "there is no pipeline to show"],
    ["reviews", "Pending reviews", "there are no layouts to review"],
    ["analytics", "Executive analytics", "there are no figures to show"],
    ["proposals", "Proposals", "there are no proposals to show"],
    ["search", "Clients", "there are no clients to show"],
    ["loadouts", "Reference loadouts", "there are no reference loadouts to show"],
    ["settings", "Venue settings", "there are no venue settings to show"],
    ["inventory", "Inventory", "there is no inventory to show"],
    ["rota", "Rota", "there is no rota to show"],
  ])("is told so on %s, in the view's own name, and the view is not opened", (view, title, consequence) => {
    open(view, UNPLACED);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeDefined();
    expect(screen.getByText(`Your account is not connected to a venue yet, so ${consequence}.`)).toBeDefined();
    expect(screen.getByText("Your Venviewer contact can connect it.")).toBeDefined();
    expect(screen.queryByTestId("view")).toBeNull();
    expect(screen.getByTestId("layout").dataset["surface"]).toBe("rota");
    // Told plainly, not announced as a failure.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is told so whichever venue role it holds", () => {
    for (const role of ["manager", "staff", "sales", "hallkeeper"]) {
      open("enquiries", { ...UNPLACED, role });
      expect(screen.getByTestId("venue-not-connected"), role).toBeDefined();
      cleanup();
    }
  });

  it("opens the view once connected", () => {
    open("proposals", { ...UNPLACED, venueId: "venue-1" });
    expect(screen.getByTestId("view").textContent).toBe("proposals");
    expect(screen.queryByTestId("venue-not-connected")).toBeNull();
  });
});

describe("accounts with no venue by design", () => {
  it("opens the views for a platform admin, who reads every venue", () => {
    open("proposals", { ...UNPLACED, platformRole: "admin" });
    expect(screen.getByTestId("view").textContent).toBe("proposals");
    expect(screen.queryByTestId("venue-not-connected")).toBeNull();
  });

  it("opens the enquiries for a planner, a customer with no venue", () => {
    open("enquiries", { ...UNPLACED, role: "planner" });
    expect(screen.getByTestId("view").textContent).toBe("enquiries");
    expect(screen.queryByTestId("venue-not-connected")).toBeNull();
  });
});
