import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Enquiry, EnquiryListQuery, EnquiryPage, StatusHistoryEntry } from "../../../api/enquiries.js";
import { ClientProfile } from "../ClientProfile.js";
import { ClientSearchView } from "../ClientSearchView.js";
import { EnquiriesView } from "../EnquiriesView.js";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    addToast: vi.fn(),
    countEnquiryStages: vi.fn(),
    createOpportunityFromEnquiry: vi.fn(),
    getClientProfile: vi.fn(),
    getEnquiry: vi.fn(),
    getEnquiryHistory: vi.fn(),
    getLeadProfile: vi.fn(),
    getVenue: vi.fn(),
    listEnquiryPage: vi.fn(),
    searchClients: vi.fn(),
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

vi.mock("../../../api/clients.js", () => ({
  getClientProfile: mocks.getClientProfile,
  getLeadProfile: mocks.getLeadProfile,
  searchClients: mocks.searchClients,
}));

vi.mock("../../../api/spaces.js", () => ({
  getVenue: mocks.getVenue,
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

vi.mock("../../../hooks/use-ai-drafts-available.js", () => ({
  useAIDraftsAvailable: () => false,
}));

function enquiryFixture(id: string, name: string, state = "submitted"): Enquiry {
  return {
    id,
    venueId: "venue-1",
    spaceId: "space-1",
    configurationId: null,
    userId: "user-1",
    guestEmail: null,
    guestPhone: null,
    guestName: null,
    state,
    name,
    email: `${name.toLowerCase()}@example.com`,
    preferredDate: null,
    eventType: null,
    estimatedGuests: null,
    message: null,
    createdAt: "2026-07-10T10:00:00.000Z",
    updatedAt: "2026-07-10T10:00:00.000Z",
  };
}

function enquiryPage(rows: readonly Enquiry[]): EnquiryPage {
  return { rows, total: rows.length, limit: 20, offset: 0, order: "created_desc" };
}

function historyFixture(id: string, enquiryId: string, note: string): StatusHistoryEntry {
  return {
    id,
    enquiryId,
    fromStatus: "submitted",
    toStatus: "under_review",
    changedBy: null,
    note,
    createdAt: "2026-07-10T11:00:00.000Z",
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return {
    promise,
    resolve: (value) => { resolvePromise?.(value); },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEnquiry.mockResolvedValue(enquiryFixture("enquiry-a", "Alice"));
  mocks.getEnquiryHistory.mockResolvedValue([]);
  mocks.listEnquiryPage.mockResolvedValue(enquiryPage([]));
  mocks.countEnquiryStages.mockResolvedValue({
    all: 0, byState: { submitted: 0, under_review: 0, approved: 0, rejected: 0, withdrawn: 0 }, longestWaiting: null,
  });
  mocks.getVenue.mockRejectedValue(new Error("Not needed here"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("EnquiriesView async ownership", () => {
  it("announces active loading and removes the activity when the request settles", async () => {
    const request = deferred<EnquiryPage>();
    mocks.listEnquiryPage.mockReturnValue(request.promise);
    render(<EnquiriesView />);

    const loading = screen.getByText("Loading enquiries…").closest("[role='status']");
    expect(loading?.querySelector("svg[aria-hidden='true']")).not.toBeNull();

    await act(async () => { request.resolve(enquiryPage([])); await request.promise; });
    expect(screen.queryByText("Loading enquiries…")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("No enquiries yet")).toBeDefined();
  });

  it("keeps preselection and its timeline visibly active until their own requests settle", async () => {
    const enquiry = deferred<Enquiry>();
    const timeline = deferred<StatusHistoryEntry[]>();
    mocks.getEnquiry.mockReturnValue(enquiry.promise);
    mocks.getEnquiryHistory.mockReturnValue(timeline.promise);
    render(<EnquiriesView initialSelectedId="alice" />);

    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Opening enquiry…")).toBeDefined();
    await act(async () => { enquiry.resolve(enquiryFixture("alice", "Alice")); await enquiry.promise; });
    expect(screen.queryByText("Opening enquiry…")).toBeNull();
    expect(screen.getByText("Loading the timeline…")).toBeDefined();
    await act(async () => { timeline.resolve([]); await timeline.promise; });
    expect(screen.queryByText("Loading the timeline…")).toBeNull();
  });

  it("animates a status change only while it is saving", async () => {
    const transition = deferred<Enquiry>();
    mocks.listEnquiryPage.mockResolvedValue(enquiryPage([enquiryFixture("alice", "Alice")]));
    mocks.transitionEnquiry.mockReturnValue(transition.promise);
    render(<EnquiriesView />);
    fireEvent.click(await screen.findByRole("button", { name: /^Alice,/u }));
    fireEvent.click(screen.getByRole("button", { name: "Start review" }));

    const working = screen.getByRole("button", { name: "Starting review…" });
    expect(working.hasAttribute("disabled")).toBe(true);
    expect(working.querySelector("svg[data-activity-indicator]")).not.toBeNull();
    await act(async () => { transition.resolve(enquiryFixture("alice", "Alice", "under_review")); await transition.promise; });
    expect(screen.queryByRole("button", { name: "Starting review…" })).toBeNull();
    expect(screen.queryByText("Starting review…")).toBeNull();
    expect(mocks.transitionEnquiry).toHaveBeenCalledTimes(1);
  });

  it("settles failed preselection and history without leaving activity behind", async () => {
    mocks.getEnquiry.mockRejectedValue(new Error("Unavailable"));
    mocks.getEnquiryHistory.mockRejectedValue(new Error("Unavailable"));
    render(<EnquiriesView initialSelectedId="missing" />);

    await waitFor(() => { expect(mocks.addToast).toHaveBeenCalledWith("Failed to load enquiry", "error"); });
    expect(screen.queryByText("Opening enquiry…")).toBeNull();
    expect(screen.queryByText("Loading the timeline…")).toBeNull();
  });

  it("aborts and ignores a slower previous filter response", async () => {
    const all = deferred<EnquiryPage>();
    const submitted = deferred<EnquiryPage>();
    const signals: AbortSignal[] = [];
    mocks.listEnquiryPage.mockImplementation((query: EnquiryListQuery, signal: AbortSignal) => {
      signals.push(signal);
      return query.status === "submitted" ? submitted.promise : all.promise;
    });
    render(<EnquiriesView />);

    await waitFor(() => { expect(mocks.listEnquiryPage).toHaveBeenCalledTimes(1); });
    fireEvent.click(screen.getByRole("button", { name: /^New(, \d+)?$/u }));
    await waitFor(() => { expect(mocks.listEnquiryPage).toHaveBeenCalledTimes(2); });
    expect(signals[0]?.aborted).toBe(true);

    submitted.resolve(enquiryPage([enquiryFixture("new", "New result")]));
    expect(await screen.findByRole("button", { name: /^New result,/u })).toBeDefined();
    all.resolve(enquiryPage([enquiryFixture("old", "Stale result")]));
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByText("Stale result")).toBeNull();
    expect(screen.getByRole("button", { name: /^New result,/u })).toBeDefined();
  });

  it("clears history on back and ignores history from the previous enquiry", async () => {
    const aliceHistory = deferred<StatusHistoryEntry[]>();
    const bobHistory = deferred<StatusHistoryEntry[]>();
    mocks.listEnquiryPage.mockResolvedValue(enquiryPage([
      enquiryFixture("alice", "Alice"),
      enquiryFixture("bob", "Bob"),
    ]));
    mocks.getEnquiryHistory.mockImplementation((id: string) =>
      id === "alice" ? aliceHistory.promise : bobHistory.promise,
    );
    render(<EnquiriesView />);

    fireEvent.click(await screen.findByRole("button", { name: /^Alice,/u }));
    fireEvent.click(screen.getByRole("button", { name: "Back to enquiries" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Bob,/u }));

    bobHistory.resolve([historyFixture("h-bob", "bob", "Bob timeline")]);
    expect(await screen.findByText("Bob timeline")).toBeDefined();
    aliceHistory.resolve([historyFixture("h-alice", "alice", "Stale Alice timeline")]);
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByText("Stale Alice timeline")).toBeNull();
    expect(screen.getByText("Bob timeline")).toBeDefined();
  });
});

describe("dashboard result controls", () => {
  it("stops announcing profile activity when the request fails", async () => {
    mocks.getClientProfile.mockRejectedValue(new Error("Unavailable"));
    render(<ClientProfile userId="user-1" onBack={vi.fn()} onViewEnquiry={vi.fn()} />);

    expect(screen.getByRole("status").textContent).toContain("Loading profile...");
    expect(await screen.findByText("Failed to load profile")).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders client search results as native buttons", async () => {
    vi.useFakeTimers();
    mocks.searchClients.mockResolvedValue({
      users: [{
        id: "user-1",
        displayName: "Ada Lovelace",
        organizationName: "Analytical Engines",
        email: "ada@example.com",
        phone: null,
        configurationCount: 2,
        enquiryCount: 1,
      }],
      guestLeads: [],
      configurations: [],
    });
    const onViewProfile = vi.fn();
    render(<ClientSearchView onViewProfile={onViewProfile} onViewLeadProfile={vi.fn()} />);

    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "Ada" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    vi.useRealTimers();
    const result = await screen.findByRole("button", { name: /Ada Lovelace/u });
    fireEvent.click(result);

    expect(onViewProfile).toHaveBeenCalledWith("user-1");
  });

  it("renders profile enquiries as native buttons", async () => {
    mocks.getClientProfile.mockResolvedValue({
      user: {
        id: "user-1",
        displayName: "Ada Lovelace",
        organizationName: null,
        email: "ada@example.com",
        phone: null,
        name: "Ada",
        role: "client",
        createdAt: "2026-07-10T10:00:00.000Z",
      },
      configurations: [],
      enquiries: [{
        id: "enquiry-1",
        state: "submitted",
        eventType: "Conference",
        preferredDate: null,
        spaceName: "Trades Hall",
      }],
    });
    const onViewEnquiry = vi.fn();
    render(
      <ClientProfile
        userId="user-1"
        onBack={vi.fn()}
        onViewEnquiry={onViewEnquiry}
      />,
    );

    const enquiry = await screen.findByRole("button", { name: /Conference/u });
    fireEvent.click(enquiry);
    expect(onViewEnquiry).toHaveBeenCalledWith("enquiry-1");
  });
});
