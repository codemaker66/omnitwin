import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIAssistantStatus } from "@omnitwin/types";
import type { Enquiry, EnquiryPage, EnquiryStageCounts } from "../../../api/enquiries.js";
import type { VenueDetail } from "../../../api/spaces.js";
import { EnquiriesView } from "../EnquiriesView.js";
import { canOpenDashboardView } from "../../../pages/DashboardPage.js";

// ---------------------------------------------------------------------------
// Who is offered "Create opportunity" on the Enquiries desk.
//
// POST /crm/from-enquiry/:id admits the venue's commercial team only
// (canManageCommercial). A hallkeeper reads and triages the inbox but cannot
// create an opportunity, so offering them the button was an invitation to a
// 403 and a red toast. The desk offers it in two places — the next step of an
// approved enquiry, and the tools of any other — and both follow one flag
// passed down from the dashboard. The control is hidden, never disabled: a
// role that cannot take the action is not shown it.
// ---------------------------------------------------------------------------

const { mocks } = vi.hoisted(() => ({
  mocks: {
    addToast: vi.fn(),
    countEnquiryStages: vi.fn(),
    createOpportunityFromEnquiry: vi.fn(),
    getEnquiry: vi.fn(),
    getEnquiryHistory: vi.fn(),
    getVenue: vi.fn(),
    listEnquiryPage: vi.fn(),
    transitionEnquiry: vi.fn(),
  },
}));

vi.mock("../../../api/enquiries.js", () => ({
  COUNTED_ENQUIRY_STATES: ["submitted", "under_review", "approved", "rejected", "withdrawn"],
  countEnquiryStages: mocks.countEnquiryStages,
  getEnquiry: mocks.getEnquiry,
  getEnquiryHistory: mocks.getEnquiryHistory,
  listEnquiryPage: mocks.listEnquiryPage,
  transitionEnquiry: mocks.transitionEnquiry,
}));

vi.mock("../../../api/spaces.js", () => ({ getVenue: mocks.getVenue }));

vi.mock("../../../api/crm.js", () => ({
  createOpportunityFromEnquiry: mocks.createOpportunityFromEnquiry,
}));

// Drafting is not what this suite exercises; no provider is configured.
vi.mock("../../../api/ai-assistant.js", () => ({
  getAIAssistantStatus: (): Promise<AIAssistantStatus> =>
    Promise.resolve({ configured: false, provider: null, model: null, disabledReason: null }),
}));

vi.mock("../../ai/AIDraftPanel.js", () => ({
  AIDraftPanel: () => <div>AI draft</div>,
}));

vi.mock("../../../stores/toast-store.js", () => ({
  useToastStore: (
    selector: (state: { readonly addToast: typeof mocks.addToast }) => unknown,
  ): unknown => selector({ addToast: mocks.addToast }),
}));

vi.mock("../../../stores/auth-store.js", () => ({
  useAuthStore: (
    selector: (state: { readonly user: { readonly name: string } }) => unknown,
  ): unknown => selector({ user: { name: "Desk fixture" } }),
}));

function enquiry(state: string): Enquiry {
  return {
    id: "enquiry-a", venueId: "venue-1", spaceId: "space-1", configurationId: null, userId: "user-1",
    guestEmail: null, guestPhone: null, guestName: null, state, name: "Alice", email: "alice@example.com",
    preferredDate: null, eventType: null, estimatedGuests: null, message: null,
    createdAt: "2026-09-20T10:00:00.000Z", updatedAt: "2026-09-20T10:00:00.000Z",
  };
}

function page(rows: readonly Enquiry[]): EnquiryPage {
  return { rows: [...rows], total: rows.length, limit: 20, offset: 0, order: "created_desc" };
}

function counts(): EnquiryStageCounts {
  return { all: 1, byState: { submitted: 1, under_review: 0, approved: 0, rejected: 0, withdrawn: 0 }, longestWaiting: null };
}

const VENUE: VenueDetail = {
  id: "venue-1", name: "Trades Hall Glasgow", slug: "trades-hall", address: "85 Glassford Street",
  logoUrl: null, brandColour: null, spaces: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.countEnquiryStages.mockResolvedValue(counts());
  mocks.getEnquiryHistory.mockResolvedValue([]);
  mocks.getVenue.mockResolvedValue(VENUE);
});

afterEach(() => { cleanup(); });

async function openAlice(state: string, props: { readonly canCreateOpportunity?: boolean }): Promise<void> {
  mocks.listEnquiryPage.mockResolvedValue(page([enquiry(state)]));
  render(<EnquiriesView {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: /^Alice,/u }));
  // The record itself is always readable: the gate removes an invitation to a
  // 403, never the enquiry.
  expect(await screen.findByRole("heading", { level: 2, name: "Alice" })).toBeTruthy();
}

describe("Create opportunity is offered only to the commercial team", () => {
  it.each(["submitted", "under_review", "approved"])("offers it on a %s enquiry when the actor may create one", async (state) => {
    await openAlice(state, { canCreateOpportunity: true });
    const buttons = screen.getAllByTestId("create-opportunity-from-enquiry");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toContain("Create opportunity");
    fireEvent.click(buttons[0] as HTMLElement);
    expect(mocks.createOpportunityFromEnquiry).toHaveBeenCalledWith("enquiry-a");
  });

  it.each(["submitted", "under_review", "approved"])("hides it on a %s enquiry when the API would refuse the actor", async (state) => {
    await openAlice(state, { canCreateOpportunity: false });
    expect(screen.queryByTestId("create-opportunity-from-enquiry")).toBeNull();
    expect(screen.queryByRole("button", { name: /Create opportunity/u })).toBeNull();
  });

  it("keeps the rest of an approved enquiry's next step for a reader who cannot create", async () => {
    await openAlice("approved", { canCreateOpportunity: false });
    expect(screen.getByText("Approved. An opportunity carries it on to a proposal.")).toBeTruthy();
  });

  it("FAILS CLOSED: a mount that forgets the flag gets no button", async () => {
    // The default is the whole point. A permission flag that defaults to
    // "allowed" means any future surface mounting this view without thinking
    // about roles silently offers the commercial control to everyone. A
    // missing button is a visible bug; a wrongly-offered one is not.
    await openAlice("submitted", {});
    expect(screen.queryByTestId("create-opportunity-from-enquiry")).toBeNull();
  });
});

describe("the capability the dashboard passes down", () => {
  // One definition on the client: the button and the Pipeline tab are gated by
  // the same predicate, so they cannot disagree about who is commercial. It
  // mirrors canManageCommercial on POST /crm/from-enquiry/:id.
  it.each([
    ["admin", true],
    ["manager", true],
    ["staff", true],
    ["sales", true],
    ["hallkeeper", false],
    ["planner", false],
    ["client", false],
    ["caterer", false],
  ] as const)("role %s may create an opportunity: %s", (role, expected) => {
    expect(canOpenDashboardView("pipeline", role, "none")).toBe(expected);
  });

  it("admits a Venviewer platform admin whatever its venue role", () => {
    expect(canOpenDashboardView("pipeline", "planner", "admin")).toBe(true);
  });
});
