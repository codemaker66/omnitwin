import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuthStore, type AuthUser } from "../../stores/auth-store.js";
import { DashboardPage } from "../DashboardPage.js";

// ---------------------------------------------------------------------------
// The reply-time alarm and "Record a reply" on the Enquiries desk are the
// venue's commercial team's alone: the dashboard hands the desk the venue
// they record replies for (replyVenueOf, mirroring the API's
// isVenueCommercialMember, which POST /enquiries/:id/first-response and
// GET /enquiries/reply-alarm read), and none for anyone else. Without it the
// desk reads no alarm and offers no control, so a dropped prop would silence
// both for the whole team; this pins the hand-over.
// ---------------------------------------------------------------------------

vi.mock("../../components/dashboard/DashboardLayout.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../components/dashboard/DashboardLayout.js")>();
  return {
    ...actual,
    DashboardLayout: ({ children }: { readonly children: ReactNode }) => <main data-testid="layout">{children}</main>,
  };
});

vi.mock("../../components/dashboard/EnquiriesView.js", () => ({
  EnquiriesView: ({ replyVenueId }: { readonly replyVenueId?: string | null }) => (
    <p data-testid="enquiries" data-reply-venue-id={replyVenueId === undefined ? "undefined" : String(replyVenueId)}>enquiries</p>
  ),
}));

/** The desk's own view, opened as `user`: the venue it was handed. */
function replyVenueHanded(user: AuthUser): string | undefined {
  useAuthStore.getState().setUser(user);
  // No view asked for: everyone who reaches the dashboard lands on the desk.
  render(<MemoryRouter initialEntries={["/dashboard"]}><DashboardPage /></MemoryRouter>);
  return screen.getByTestId("enquiries").dataset["replyVenueId"];
}

const person = (role: string, venueId: string | null, platformRole: AuthUser["platformRole"] = "none"): AuthUser => ({
  id: "user-1", email: `${role}@example.test`, name: "Fixture person", role, platformRole, venueId,
});

afterEach(() => {
  cleanup();
  useAuthStore.getState().setUser(null);
});

describe("the venue the dashboard hands the Enquiries desk for recording replies", () => {
  it.each(["staff", "sales", "manager", "admin"])("is the venue's own for its %s", (role) => {
    expect(replyVenueHanded(person(role, "venue-1"))).toBe("venue-1");
  });

  it("is the venue's own for a platform admin who is on its commercial team", () => {
    expect(replyVenueHanded(person("admin", "venue-1", "admin"))).toBe("venue-1");
  });

  it.each([
    ["the venue's hallkeeper", person("hallkeeper", "venue-1")],
    ["a planner at the venue", person("planner", "venue-1")],
    ["a client", person("client", "venue-1")],
    ["a platform admin at no venue", person("admin", null, "admin")],
  ])("is none for %s", (_, user) => {
    expect(replyVenueHanded(user)).toBe("null");
  });
});
