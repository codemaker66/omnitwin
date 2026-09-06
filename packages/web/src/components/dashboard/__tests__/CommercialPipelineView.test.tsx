import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const authState = vi.hoisted(() => ({
  user: {
    id: "u1",
    role: "staff",
    platformRole: "none" as const,
    venueId: "v1" as string | null,
    email: "staff@test.com",
    name: "Staff",
  },
}));

type MockUser = typeof authState.user;

vi.mock("../../../stores/auth-store.js", () => ({
  useAuthStore: (selector: (state: { user: MockUser }) => unknown): unknown =>
    selector({ user: authState.user }),
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
  authState.user = { ...authState.user, venueId: "v1" };
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
  it("keeps the newest repeated selection loading when an earlier request for that same record settles", async () => {
    let resolveOld: ((value: unknown) => void) | undefined;
    let resolveNew: ((value: unknown) => void) | undefined;
    const oldResponse = new Promise<unknown>((resolve) => { resolveOld = resolve; });
    const newResponse = new Promise<unknown>((resolve) => { resolveNew = resolve; });
    mocks.getOpportunity.mockReturnValueOnce(oldResponse).mockReturnValueOnce(newResponse);
    render(<CommercialPipelineView />);
    fireEvent.click(await screen.findByTestId("opportunity-opp1"));
    fireEvent.click(screen.getByTestId("opportunity-opp1"));
    await act(async () => { resolveOld?.({ opportunity: opportunity({ title: "Outdated record" }), activities: [], tasks: [], proposals: [] }); await oldResponse; });
    expect(screen.queryByLabelText("Opportunity detail")).toBeNull();
    expect(screen.getByText("Opening opportunity…")).toBeTruthy();
    await act(async () => { resolveNew?.({ opportunity: opportunity({ title: "Current record" }), activities: [], tasks: [], proposals: [] }); await newResponse; });
    expect(screen.getByRole("heading", { name: "Current record" })).toBeTruthy();
    expect(screen.queryByText("Opening opportunity…")).toBeNull();
  });

  it.each(["resolve", "reject"] as const)("keeps the latest opportunity when an older request later %ss", async (settlement) => {
    let resolveOld: ((value: unknown) => void) | undefined;
    let rejectOld: ((reason: Error) => void) | undefined;
    const oldResponse = new Promise<unknown>((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
    mocks.getPipeline.mockResolvedValue({ opportunities: [opportunity(), opportunity({ id: "opp2", title: "Winter dinner" })], todayTasks: [] });
    mocks.getOpportunity.mockImplementation((id: string) => id === "opp1" ? oldResponse : Promise.resolve({ opportunity: opportunity({ id: "opp2", title: "Winter dinner" }), activities: [], tasks: [], proposals: [] }));
    render(<CommercialPipelineView />);
    fireEvent.click(await screen.findByTestId("opportunity-opp1"));
    fireEvent.click(screen.getByTestId("opportunity-opp2"));
    await screen.findByRole("heading", { name: "Winter dinner" });
    expect(screen.queryByText("Opening opportunity…")).toBeNull();
    await act(async () => {
      if (settlement === "resolve") resolveOld?.({ opportunity: opportunity(), activities: [], tasks: [], proposals: [] });
      else rejectOld?.(new Error("old request failed"));
      await oldResponse.catch(() => undefined);
    });
    expect(screen.getByRole("heading", { name: "Winter dinner" })).toBeTruthy();
    expect(screen.queryByTestId("opportunity-detail-error")).toBeNull();
    expect(mocks.addToast).not.toHaveBeenCalled();
  });

  it("removes the prior opportunity's editable detail while another selection loads", async () => {
    let resolveNext: ((value: unknown) => void) | undefined;
    const nextResponse = new Promise<unknown>((resolve) => { resolveNext = resolve; });
    mocks.getPipeline.mockResolvedValue({ opportunities: [opportunity(), opportunity({ id: "opp2", title: "Winter dinner" })], todayTasks: [] });
    mocks.getOpportunity.mockResolvedValueOnce({ opportunity: opportunity(), activities: [], tasks: [], proposals: [] }).mockReturnValueOnce(nextResponse);
    render(<CommercialPipelineView />);
    fireEvent.click(await screen.findByTestId("opportunity-opp1"));
    await screen.findByLabelText("Opportunity detail");
    fireEvent.change(screen.getByLabelText("Activity note"), { target: { value: "A private draft for the first client" } });
    fireEvent.click(screen.getByTestId("opportunity-opp2"));
    expect(screen.queryByLabelText("Opportunity detail")).toBeNull();
    expect(screen.queryByTestId("opportunity-stage")).toBeNull();
    await act(async () => { resolveNext?.({ opportunity: opportunity({ id: "opp2", title: "Winter dinner" }), activities: [], tasks: [], proposals: [] }); await nextResponse; });
    expect(screen.getByLabelText<HTMLTextAreaElement>("Activity note").value).toBe("");
    expect(mocks.updateOpportunity).not.toHaveBeenCalled();
  });

  it("shows opportunity activity until the selected detail request settles", async () => {
    let resolveDetail: ((value: unknown) => void) | undefined;
    const response = new Promise<unknown>((resolve) => { resolveDetail = resolve; });
    mocks.getOpportunity.mockReturnValue(response);
    render(<CommercialPipelineView />);
    fireEvent.click(await screen.findByTestId("opportunity-opp1"));

    expect(screen.getByText("Opening opportunity…")).toBeDefined();
    await act(async () => {
      resolveDetail?.({ opportunity: opportunity(), activities: [], tasks: [], proposals: [] });
      await response;
    });
    expect(screen.queryByText("Opening opportunity…")).toBeNull();
    expect(screen.getByLabelText("Opportunity detail")).toBeDefined();
  });

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

  it("rejects invalid manual opportunity values without coercing them to zero", async () => {
    render(<CommercialPipelineView />);

    fireEvent.change(await screen.findByTestId("manual-opportunity-title"), { target: { value: "Winter dinner" } });
    fireEvent.change(screen.getByTestId("manual-opportunity-value"), { target: { value: "-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    const error = await screen.findByTestId("manual-opportunity-error");
    expect(error.textContent).toContain("Estimated value must be a non-negative pounds amount");
    expect(mocks.createOpportunity).not.toHaveBeenCalled();
  });

  it("surfaces the no-venue role state before creating a manual opportunity", async () => {
    authState.user = { ...authState.user, venueId: null };
    render(<CommercialPipelineView />);

    fireEvent.change(await screen.findByTestId("manual-opportunity-title"), { target: { value: "Winter dinner" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    const error = await screen.findByTestId("manual-opportunity-error");
    expect(error.textContent).toContain("not linked to a venue");
    expect(mocks.createOpportunity).not.toHaveBeenCalled();
  });

  it("shows a retryable pipeline load failure", async () => {
    mocks.getPipeline
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ opportunities: [opportunity()], todayTasks: [], stageCounts: { new: 1 } });
    render(<CommercialPipelineView />);

    expect(await screen.findByText(/Could not load the commercial pipeline/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry pipeline" }));

    expect(await screen.findByTestId("opportunity-opp1")).toBeTruthy();
    expect(mocks.getPipeline).toHaveBeenCalledTimes(2);
  });

  it("keeps quick-create enquiry failures visible in the form", async () => {
    mocks.createOpportunityFromEnquiry.mockRejectedValue(new Error("missing"));
    render(<CommercialPipelineView />);

    fireEvent.change(await screen.findByTestId("pipeline-enquiry-id"), { target: { value: "enq-missing" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const error = await screen.findByTestId("pipeline-enquiry-error");
    expect(error.textContent).toContain("Could not create an opportunity from that enquiry ID");
    expect(mocks.createOpportunityFromEnquiry).toHaveBeenCalledWith("enq-missing");
  });

  it("shows an opportunity-detail failure in the detail rail", async () => {
    mocks.getOpportunity.mockRejectedValue(new Error("gone"));
    render(<CommercialPipelineView />);

    fireEvent.click(await screen.findByTestId("opportunity-opp1"));

    const error = await screen.findByTestId("opportunity-detail-error");
    expect(error.textContent).toContain("Could not load that opportunity");
    expect(screen.queryByText("Opening opportunity…")).toBeNull();
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

  it("keeps detail mutation failures inline until the user retries", async () => {
    mocks.updateOpportunity.mockRejectedValue(new Error("stage"));
    mocks.updateFollowUpTaskStatus.mockRejectedValue(new Error("task"));
    mocks.addFollowUpTask.mockRejectedValue(new Error("task"));
    mocks.addOpportunityActivity.mockRejectedValue(new Error("activity"));
    mocks.createProposal.mockRejectedValue(new Error("proposal"));

    render(<CommercialPipelineView />);
    fireEvent.click(await screen.findByTestId("opportunity-opp1"));
    expect(await screen.findByLabelText("Opportunity detail")).toBeTruthy();

    fireEvent.change(screen.getByTestId("opportunity-stage"), { target: { value: "proposal_drafting" } });
    const stageError = await screen.findByTestId("opportunity-stage-error");
    expect(stageError.textContent).toContain("Could not update the stage");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const completeTaskError = await screen.findByTestId("opportunity-task-error");
    expect(completeTaskError.textContent).toContain("remains open");

    fireEvent.change(screen.getByLabelText("New task title"), { target: { value: "Confirm AV" } });
    fireEvent.click(screen.getByTestId("opportunity-task-add"));
    const addTaskError = await screen.findByTestId("opportunity-task-error");
    expect(addTaskError.textContent).toContain("Could not add the follow-up task");

    fireEvent.change(screen.getByLabelText("Activity note"), { target: { value: "Client asked for a new package." } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    const activityError = await screen.findByTestId("opportunity-activity-error");
    expect(activityError.textContent).toContain("Could not add the note");

    fireEvent.click(screen.getByRole("button", { name: "Create proposal draft" }));
    const proposalError = await screen.findByTestId("opportunity-proposal-error");
    expect(proposalError.textContent).toContain("Could not create the proposal draft");
  });
});
