import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommercialPipelineView } from "../CommercialPipelineView.js";

const mocks = vi.hoisted(() => ({
  addFollowUpTask: vi.fn(),
  addOpportunityActivity: vi.fn(),
  createOpportunity: vi.fn(),
  createOpportunityFromEnquiry: vi.fn(),
  createProposal: vi.fn(),
  getOpportunity: vi.fn(),
  getPipeline: vi.fn(),
  updateFollowUpTaskStatus: vi.fn(),
  updateOpportunity: vi.fn(),
  addToast: vi.fn(),
}));

vi.mock("../../../api/crm.js", () => ({
  addFollowUpTask: mocks.addFollowUpTask,
  addOpportunityActivity: mocks.addOpportunityActivity,
  createOpportunity: mocks.createOpportunity,
  createOpportunityFromEnquiry: mocks.createOpportunityFromEnquiry,
  getOpportunity: mocks.getOpportunity,
  getPipeline: mocks.getPipeline,
  updateFollowUpTaskStatus: mocks.updateFollowUpTaskStatus,
  updateOpportunity: mocks.updateOpportunity,
}));

vi.mock("../../../api/proposals.js", () => ({
  createProposal: mocks.createProposal,
}));

const MOCK_USER = {
  id: "u1",
  role: "staff",
  venueId: "v1",
  email: "staff@test.com",
  name: "Staff",
};

vi.mock("../../../stores/auth-store.js", () => ({
  useAuthStore: (selector: (state: { user: typeof MOCK_USER }) => unknown): unknown =>
    selector({ user: MOCK_USER }),
}));

vi.mock("../../../stores/toast-store.js", () => ({
  useToastStore: (selector: (state: { addToast: typeof mocks.addToast }) => unknown): unknown =>
    selector({ addToast: mocks.addToast }),
}));

const NOW = "2026-06-12T10:00:00.000Z";

function opportunity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "opp1",
    venueId: "v1",
    clientAccountId: "acct1",
    primaryContactId: "contact1",
    sourceEnquiryId: "enq1",
    ownerUserId: "u1",
    title: "Grand Hall gala",
    stage: "new",
    eventType: "gala",
    preferredDate: "2026-09-20",
    guestCount: 120,
    estimatedValueMinor: 1250000,
    currency: "GBP",
    nextAction: "Confirm event basics",
    nextActionDueAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    closedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function task(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "task1",
    opportunityId: "opp1",
    assignedTo: "u1",
    title: "Follow up with Elaine",
    dueAt: null,
    status: "open",
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "prop1",
    venueId: "v1",
    opportunityId: "opp1",
    enquiryId: "enq1",
    configurationId: null,
    title: "Grand Hall gala proposal",
    status: "draft",
    currentVersion: 0,
    shareCode: null,
    sentAt: null,
    createdBy: "u1",
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.getPipeline.mockResolvedValue({
    opportunities: [opportunity()],
    todayTasks: [task()],
    stageCounts: { new: 1 },
  });
  mocks.getOpportunity.mockResolvedValue({
    opportunity: opportunity(),
    activities: [{ id: "act1", opportunityId: "opp1", type: "note", body: "Client asked for a planning-grade quote.", createdBy: "u1", createdAt: NOW }],
    tasks: [task()],
    proposals: [],
  });
});

afterEach(() => {
  cleanup();
});

describe("CommercialPipelineView", () => {
  it("renders the commercial pipeline board with next action and safe planning language", async () => {
    render(<CommercialPipelineView />);

    expect(await screen.findByText("Commercial pipeline")).toBeTruthy();
    expect(screen.getByTestId("pipeline-value").textContent).toContain("£12,500.00");
    expect(screen.getByText("Grand Hall gala")).toBeTruthy();
    expect(screen.getByText("Confirm event basics")).toBeTruthy();
    expect(screen.getByText("Follow up with Elaine")).toBeTruthy();

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).not.toMatch(/certified safe|legally compliant|fire approved|approved for occupancy/iu);
  });

  it("creates a manual opportunity with exact minor-unit input", async () => {
    mocks.createOpportunity.mockResolvedValue({ opportunity: opportunity({ id: "opp2", title: "Winter dinner" }), task: null });
    render(<CommercialPipelineView />);

    fireEvent.change(await screen.findByTestId("manual-opportunity-title"), { target: { value: "Winter dinner" } });
    fireEvent.change(screen.getByTestId("manual-opportunity-value"), { target: { value: "120.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(mocks.createOpportunity).toHaveBeenCalledWith({
        venueId: "v1",
        title: "Winter dinner",
        estimatedValueMinor: 12050,
        nextAction: "Qualify the enquiry and prepare the first proposal step.",
      });
    });
  });

  it("opens opportunity detail, updates stage, completes tasks, and creates a proposal draft", async () => {
    mocks.updateOpportunity.mockResolvedValue(opportunity({ stage: "proposal_drafting" }));
    mocks.updateFollowUpTaskStatus.mockResolvedValue(task({ status: "done", completedAt: NOW }));
    mocks.createProposal.mockResolvedValue(proposal());

    render(<CommercialPipelineView />);
    fireEvent.click(await screen.findByTestId("opportunity-opp1"));

    expect(await screen.findByLabelText("Opportunity detail")).toBeTruthy();
    fireEvent.change(screen.getByTestId("opportunity-stage"), { target: { value: "proposal_drafting" } });
    await waitFor(() => {
      expect(mocks.updateOpportunity).toHaveBeenCalledWith("opp1", {
        stage: "proposal_drafting",
        note: "Moved to Proposal drafting",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(mocks.updateFollowUpTaskStatus).toHaveBeenCalledWith("opp1", "task1", "done");
    });

    fireEvent.click(screen.getByRole("button", { name: "Create proposal draft" }));
    await waitFor(() => {
      expect(mocks.createProposal).toHaveBeenCalledWith({
        venueId: "v1",
        opportunityId: "opp1",
        enquiryId: "enq1",
        title: "Grand Hall gala proposal",
      });
    });
  });
});
