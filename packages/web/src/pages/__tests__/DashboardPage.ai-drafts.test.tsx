import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuthStore, type AuthUser } from "../../stores/auth-store.js";
import { DashboardPage } from "../DashboardPage.js";

// ---------------------------------------------------------------------------
// T-656 — the dashboard offers the general AI drafts only to the people
// POST /ai/drafts answers: the venue's floor and commercial team, connected
// to their venue. A planner (the external event planner, who reads only their
// own enquiries) and anyone without a venue to charge are not offered the
// enquiry summary, so no one is shown a control the server would refuse.
// ---------------------------------------------------------------------------

vi.mock("../../components/dashboard/DashboardLayout.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../components/dashboard/DashboardLayout.js")>();
  return {
    ...actual,
    DashboardLayout: ({ children }: { readonly children: ReactNode }) => <main data-testid="layout">{children}</main>,
  };
});

vi.mock("../../components/dashboard/EnquiriesView.js", () => ({
  EnquiriesView: ({ canDraftWithAI }: { readonly canDraftWithAI?: boolean }) => (
    <p data-testid="enquiries" data-can-draft-with-ai={String(canDraftWithAI)}>enquiries</p>
  ),
}));

function openEnquiries(user: AuthUser): string | undefined {
  useAuthStore.getState().setUser(user);
  render(<MemoryRouter initialEntries={["/dashboard?view=enquiries"]}><DashboardPage /></MemoryRouter>);
  return screen.getByTestId("enquiries").dataset["canDraftWithAi"];
}

const person = (role: string, venueId: string | null, platformRole: AuthUser["platformRole"] = "none"): AuthUser => ({
  id: "user-1", email: `${role}@example.test`, name: "Fixture person", role, platformRole, venueId,
});

afterEach(() => {
  cleanup();
  useAuthStore.getState().setUser(null);
});

describe("the enquiry summary offered on the dashboard", () => {
  it.each(["admin", "manager", "staff", "hallkeeper", "sales"])("is offered to the venue's %s", (role) => {
    expect(openEnquiries(person(role, "venue-1"))).toBe("true");
  });

  it("is offered to a platform admin through the venue it is connected to", () => {
    expect(openEnquiries(person("admin", "venue-1", "admin"))).toBe("true");
  });

  it.each([
    ["a planner with no venue", person("planner", null)],
    ["a planner at the venue", person("planner", "venue-1")],
    ["a platform admin with no venue to charge", person("admin", null, "admin")],
  ])("is not offered to %s", (_, user) => {
    expect(openEnquiries(user)).toBe("false");
  });
});
