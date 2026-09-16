import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Enquiry } from "../../../api/enquiries.js";
import { EnquiriesView } from "../EnquiriesView.js";
import { canOpenDashboardView } from "../../../pages/DashboardPage.js";

// ---------------------------------------------------------------------------
// Who is offered "Create Opportunity".
//
// The commercial API grants opportunity creation to the venue's commercial
// team only. The button was rendered for every role that could open an
// enquiry, so a hallkeeper who pressed it received a 403 and a red toast for
// an action the product had just invited them to take.
// ---------------------------------------------------------------------------

const { mocks } = vi.hoisted(() => ({
  mocks: {
    addToast: vi.fn(),
    createOpportunityFromEnquiry: vi.fn(),
    getEnquiry: vi.fn(),
    getEnquiryHistory: vi.fn(),
    listEnquiries: vi.fn(),
    transitionEnquiry: vi.fn(),
  },
}));

vi.mock("../../../api/enquiries.js", () => ({
  getEnquiry: mocks.getEnquiry,
  getEnquiryHistory: mocks.getEnquiryHistory,
  listEnquiries: mocks.listEnquiries,
  transitionEnquiry: mocks.transitionEnquiry,
}));

vi.mock("../../../api/crm.js", () => ({
  createOpportunityFromEnquiry: mocks.createOpportunityFromEnquiry,
}));

vi.mock("../../../stores/toast-store.js", () => ({
  useToastStore: (
    selector: (state: { readonly addToast: typeof mocks.addToast }) => unknown,
  ): unknown => selector({ addToast: mocks.addToast }),
}));

vi.mock("../../ai/AIDraftPanel.js", () => ({
  AIDraftPanel: () => <div>AI draft</div>,
}));

function enquiryFixture(): Enquiry {
  return {
    id: "enquiry-a",
    venueId: "venue-1",
    spaceId: "space-1",
    configurationId: null,
    userId: "user-1",
    guestEmail: null,
    guestPhone: null,
    guestName: null,
    state: "submitted",
    name: "Alice",
    email: "alice@example.com",
    preferredDate: null,
    eventType: null,
    estimatedGuests: null,
    message: null,
    createdAt: "2026-07-10T10:00:00.000Z",
    updatedAt: "2026-07-10T10:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listEnquiries.mockResolvedValue([enquiryFixture()]);
  mocks.getEnquiry.mockResolvedValue(enquiryFixture());
  mocks.getEnquiryHistory.mockResolvedValue([]);
});

afterEach(() => { cleanup(); });

async function openTheEnquiry(): Promise<void> {
  fireEvent.click(await screen.findByText("Alice"));
}

describe("Create Opportunity is offered only to the commercial team", () => {
  it("shows the button when the actor may reach the commercial surface", async () => {
    render(<EnquiriesView canCreateOpportunity />);
    await openTheEnquiry();
    expect(await screen.findByTestId("create-opportunity-from-enquiry")).toBeTruthy();
  });

  it("hides the button when the API would refuse the actor", async () => {
    render(<EnquiriesView canCreateOpportunity={false} />);
    await openTheEnquiry();
    // The enquiry itself stays fully readable — this removes an invitation to
    // a 403, not the record.
    expect(await screen.findByText("Alice")).toBeTruthy();
    expect(screen.queryByTestId("create-opportunity-from-enquiry")).toBeNull();
  });

  it("FAILS CLOSED: a mount that forgets the flag gets no button", async () => {
    // The default is the whole point. A permission flag that defaults to
    // "allowed" means any future surface mounting this view without thinking
    // about roles silently offers the commercial control to everyone. A
    // missing button is a visible bug; a wrongly-offered one is not.
    render(<EnquiriesView />);
    await openTheEnquiry();
    expect(await screen.findByText("Alice")).toBeTruthy();
    expect(screen.queryByTestId("create-opportunity-from-enquiry")).toBeNull();
  });
});

describe("the capability the dashboard passes down", () => {
  // One definition on the client: the button and the Pipeline tab are gated by
  // the same predicate, so they cannot disagree about who is commercial.
  it.each([
    ["staff", true],
    ["admin", true],
    ["hallkeeper", false],
    ["planner", false],
    ["client", false],
  ] as const)("role %s may reach the commercial surface: %s", (role, expected) => {
    expect(canOpenDashboardView("pipeline", role, "none")).toBe(expected);
  });

  it("admits a Venviewer platform admin", () => {
    expect(canOpenDashboardView("pipeline", null, "admin")).toBe(true);
  });
});
