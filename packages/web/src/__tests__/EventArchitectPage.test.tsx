import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  CreateEventArchitectRunInputSchema,
  SelectEventArchitectCandidateInputSchema,
  interpretEventBriefExtraction,
  runEventArchitect,
  type AIAssistantStatus,
  type EventArchitectCandidateSelection,
  type EventArchitectRequest,
  type EventBriefDraft,
  type EventBriefExtraction,
  type PersistedEventArchitectRun,
} from "@omnitwin/types";
import { ApiError } from "../api/client.js";
import { resetEventBriefReaderAvailability } from "../hooks/use-event-brief-reader-available.js";
import { EventArchitectPage } from "../pages/EventArchitectPage.js";
import { useAuthStore } from "../stores/auth-store.js";

// These pages now wear the app shell (DashboardLayout), which renders a Clerk
// sign-out and fetches the venue name for its topbar. In production every one
// of these routes is withClerk()-wrapped so both are real; here they are
// stubbed so each spec keeps testing its PAGE, not the chrome around it.
vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut: vi.fn() }),
}));

vi.mock("../api/spaces.js", () => ({
  getVenue: vi.fn().mockResolvedValue({ id: "venue-1", name: "Trades Hall" }),
}));

vi.mock("../components/dashboard/NotificationCenter.js", () => ({
  NotificationCenter: () => null,
}));
// The shell reads the unread count for the nav chip; this suite does not
// exercise notifications, so the edge is stubbed like the rest of them.
vi.mock("../api/notifications.js", () => ({
  listNotifications: () => Promise.resolve([]),
  getUnreadNotificationCount: () => Promise.resolve(0),
}));


const {
  mockCreateEventArchitectRun,
  mockGetEventArchitectRun,
  mockSelectEventArchitectCandidate,
  mockGetEventArchitectOpsReview,
  mockCreateEventArchitectOpsReview,
  mockGetEventBriefReaderStatus,
  mockReadEventBrief,
  mockGetVenue,
  mockListVenues,
} = vi.hoisted(() => ({
  mockCreateEventArchitectRun: vi.fn(),
  mockGetEventArchitectRun: vi.fn(),
  mockSelectEventArchitectCandidate: vi.fn(),
  mockGetEventArchitectOpsReview: vi.fn(),
  mockCreateEventArchitectOpsReview: vi.fn(),
  mockGetEventBriefReaderStatus: vi.fn(),
  mockReadEventBrief: vi.fn(),
  mockGetVenue: vi.fn(),
  mockListVenues: vi.fn(),
}));

vi.mock("../api/event-architect.js", () => ({
  createEventArchitectRun: mockCreateEventArchitectRun,
  getEventArchitectRun: mockGetEventArchitectRun,
  selectEventArchitectCandidate: mockSelectEventArchitectCandidate,
  getEventArchitectOpsReview: mockGetEventArchitectOpsReview,
  createEventArchitectOpsReview: mockCreateEventArchitectOpsReview,
  getEventBriefReaderStatus: mockGetEventBriefReaderStatus,
  readEventBrief: mockReadEventBrief,
}));

const BRIEFS_OFF: AIAssistantStatus = {
  configured: false, provider: null, model: null, disabledReason: "AI drafts are disabled until provider environment is configured.",
};
const BRIEFS_ON: AIAssistantStatus = { configured: true, provider: "anthropic", model: "claude-opus-5-5", disabledReason: null };

vi.mock("../api/spaces.js", () => ({
  getVenue: mockGetVenue,
  listVenues: mockListVenues,
}));

const VENUE_ID = "22222222-2222-4222-8222-222222222222";
const SPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const TABLE_ID = "a1ef4d89-7786-5878-bee1-87b3fac28200";
const CHAIR_ID = "4dfcae64-b6e3-54f8-817f-af041edab935";
const CREATED_AT = "2026-07-10T09:10:00.000Z";
const FLOOR_PLAN = [
  { x: 0, y: 0 },
  { x: 21, y: 0 },
  { x: 21, y: 10.5 },
  { x: 0, y: 10.5 },
];

const VENUE = {
  id: VENUE_ID,
  name: "Trades Hall",
  slug: "trades-hall",
  address: "85 Glassford Street, Glasgow",
  logoUrl: null,
  brandColour: null,
  spaces: [{
    id: SPACE_ID,
    venueId: VENUE_ID,
    name: "Grand Hall",
    slug: "grand-hall",
    widthM: "21.00",
    lengthM: "10.50",
    heightM: "7.00",
    floorPlanOutline: FLOOR_PLAN,
  }],
};

const BASE_REQUEST: EventArchitectRequest = {
  configurationId: "11111111-1111-4111-8111-111111111111",
  createdBy: USER_ID,
  configurationUpdatedAt: "2026-07-10T09:00:00.000Z",
  snapshotCreatedAt: "2026-07-10T09:05:00.000Z",
  brief: {
    eventName: "Founders Dinner",
    eventType: "dinner",
    guestCount: 30,
    layoutStyle: "dinner-rounds",
    budgetLimitMinor: 200_000,
    preferredDate: "2026-10-20",
    startTime: "18:00",
    endTime: "23:00",
    serviceModel: "plated",
    accessibilityRequirements: ["step_free_route"],
    planningPrompt: null,
  },
  room: {
    venueId: VENUE_ID,
    venueSlug: "trades-hall",
    spaceId: SPACE_ID,
    spaceSlug: "grand-hall",
    spaceName: "Grand Hall",
    floorPlanOutline: FLOOR_PLAN,
    floorPlanOutlineDigest: null,
    spaceDimensions: { width: 21, length: 10.5, height: 7 },
    roomGeometrySource: "space_floor_plan_outline",
    runtimeVenueManifestDigest: null,
    runtimePackageId: null,
  },
  policyBundle: {
    policyBundleId: "trades-hall-planning-draft-v0",
    policyBundleDigest: null,
    policyBundleVersion: "0.0.0",
    effectiveFrom: null,
    effectiveTo: null,
    jurisdiction: "Scotland planning evidence draft",
    venueRuleSet: "trades-hall-draft",
    humanReviewRequiredFor: ["egress_planning", "accessibility_planning"],
  },
  tolerancePolicy: {
    positionPrecisionM: 0.001,
    rotationPrecisionRad: 0.00001,
    scalePrecision: 0.001,
    floorContainmentToleranceM: 0.01,
    clearanceToleranceM: 0.01,
    currencyPrecisionMinorUnit: 1,
  },
  validatorPolicy: {
    minPrimaryFurnitureClearanceM: 0.6,
    clearanceWarningMarginM: 0.1,
  },
  pricingCatalogue: {
    priceBookRef: "trades-hall-price-book:v1",
    priceBookDigest: null,
    currency: "GBP",
    roomHireMinor: 100_000,
    perGuestMinor: 1_000,
    perAssetMinor: {
      [TABLE_ID]: 1_000,
      [CHAIR_ID]: 100,
    },
  },
};

function persistedRun(request: EventArchitectRequest = BASE_REQUEST): PersistedEventArchitectRun {
  return {
    run: runEventArchitect(request),
    createdBy: USER_ID,
    createdAt: CREATED_AT,
    selectedCandidateId: null,
    selectedConfigurationId: null,
    selectedSnapshotDigest: null,
    selectedProofDigest: null,
  };
}

function renderPage(path = "/event-architect"): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/event-architect" element={<EventArchitectPage />} />
        <Route path="/event-architect/runs/:runId" element={<EventArchitectPage />} />
        <Route path="/plan/:configurationId" element={<div>Planner route</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function completeRequiredBrief(): Promise<void> {
  await screen.findByLabelText("Event name");
  fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Founders Dinner" } });
}

beforeEach(() => {
  mockCreateEventArchitectRun.mockReset();
  mockGetEventArchitectRun.mockReset();
  mockSelectEventArchitectCandidate.mockReset();
  mockGetEventArchitectOpsReview.mockReset();
  mockCreateEventArchitectOpsReview.mockReset();
  mockGetEventArchitectOpsReview.mockImplementation((candidateId: string) => Promise.resolve({
    candidateId,
    status: "open",
    blockingForOpsCompilation: true,
    requiredData: ["surveyed_door_positions", "reviewed_route_model", "venue_operations_signoff"],
    activeArtifact: null,
    history: [],
  }));
  mockGetVenue.mockReset();
  mockListVenues.mockReset();
  mockGetVenue.mockResolvedValue(VENUE);
  mockListVenues.mockResolvedValue([VENUE]);
  // The server reads no briefs unless a test says so: the page as before.
  resetEventBriefReaderAvailability();
  mockGetEventBriefReaderStatus.mockReset();
  mockGetEventBriefReaderStatus.mockResolvedValue(BRIEFS_OFF);
  mockReadEventBrief.mockReset();
  useAuthStore.getState().setUser({
    id: USER_ID,
    email: "planner@trades-hall.test",
    role: "owner",
    platformRole: "none",
    venueId: VENUE_ID,
    name: "Venue Planner",
  });
});

afterEach(() => {
  cleanup();
  useAuthStore.getState().logout();
  vi.restoreAllMocks();
});

describe("EventArchitectPage", () => {
  it("loads the signed-in venue context and exposes an accessible planning brief", async () => {
    renderPage();

    expect(await screen.findByRole("main", { name: "Event Architect workspace" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Describe the event" })).toBeTruthy();
    // Await a control that exists ONLY after the venue fetch resolves. The
    // `main` landmark above is the page shell and renders immediately — while
    // the brief still shows "Loading venue rooms…" — so awaiting it settles
    // nothing. A synchronous getByLabelText here therefore raced the fetch and
    // failed under CI load while passing locally, where the mocked promise
    // happened to resolve inside findByRole's first check.
    expect(await screen.findByLabelText("Venue")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Room")).toHaveProperty("value", SPACE_ID);
    expect(screen.getByRole("group", { name: "Accessibility requirements" })).toBeTruthy();
    expect(screen.getByText(/accessibility routes are not validated/i)).toBeTruthy();
    expect(mockGetVenue).toHaveBeenCalledWith(VENUE_ID);
    expect(mockListVenues).not.toHaveBeenCalled();
  });

  it("submits the exact browser envelope and compares three SVG snapshot plans", async () => {
    const fixture = persistedRun();
    mockCreateEventArchitectRun.mockResolvedValue(fixture);
    renderPage();
    await completeRequiredBrief();

    fireEvent.change(screen.getByLabelText("Guests"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText(/Budget in GBP/i), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Step-free route" }));
    const form = screen.getByRole("button", { name: "Generate three options" }).closest("form");
    if (form === null) throw new Error("Event Architect form missing");
    expect(form.checkValidity()).toBe(true);
    fireEvent.submit(form);

    await waitFor(() => { expect(mockCreateEventArchitectRun).toHaveBeenCalledTimes(1); });
    const createInput = CreateEventArchitectRunInputSchema.parse(
      mockCreateEventArchitectRun.mock.calls[0]?.[0],
    );
    expect(createInput).toMatchObject({
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      brief: {
        eventName: "Founders Dinner",
        guestCount: 30,
        budgetLimitMinor: 200_000,
        accessibilityRequirements: ["step_free_route"],
      },
    });
    expect(createInput.idempotencyKey).toMatch(/^event-architect:create:/u);

    expect(await screen.findByRole("heading", { name: "Three layout options" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Comfort first" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Balanced" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Capacity first" })).toBeTruthy();
    expect(screen.getAllByRole("img", { name: /top-down snapshot plan/i })).toHaveLength(3);
    expect(screen.getAllByText("Replayable snapshot facts")).toHaveLength(3);
    expect(screen.getAllByText(/conservative footprints checked/i)).toHaveLength(3);
    expect(screen.getAllByText("Simulated guest flow")).toHaveLength(3);
    expect(screen.getAllByText(/surveyed doors, a reviewed route model/i)).toHaveLength(3);
    expect(screen.getAllByText(/Simulated guest flow - planning support/i)).toHaveLength(3);
  });

  it("reuses an idempotency key for an unchanged retry and rotates it when the brief changes", async () => {
    const fixture = persistedRun();
    mockCreateEventArchitectRun
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue(fixture);
    renderPage();
    await completeRequiredBrief();

    fireEvent.click(screen.getByRole("button", { name: "Generate three options" }));
    expect(await screen.findByText("Comparison unavailable")).toBeTruthy();
    const first = CreateEventArchitectRunInputSchema.parse(
      mockCreateEventArchitectRun.mock.calls[0]?.[0],
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate three options" }));
    await waitFor(() => { expect(mockCreateEventArchitectRun).toHaveBeenCalledTimes(2); });
    const retry = CreateEventArchitectRunInputSchema.parse(
      mockCreateEventArchitectRun.mock.calls[1]?.[0],
    );
    expect(retry.idempotencyKey).toBe(first.idempotencyKey);

    fireEvent.change(screen.getByLabelText("Guests"), { target: { value: "31" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate three options" }));
    await waitFor(() => { expect(mockCreateEventArchitectRun).toHaveBeenCalledTimes(3); });
    const changed = CreateEventArchitectRunInputSchema.parse(
      mockCreateEventArchitectRun.mock.calls[2]?.[0],
    );
    expect(changed.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("selects one exact candidate and opens the returned planner path", async () => {
    const fixture = persistedRun();
    const candidate = fixture.run.candidates[1];
    if (candidate === undefined) throw new Error("balanced candidate missing");
    const selection: EventArchitectCandidateSelection = {
      runId: fixture.run.runId,
      candidateId: candidate.candidateId,
      configurationId: candidate.snapshot.configurationId,
      snapshotDigest: candidate.snapshotDigest,
      proofDigest: candidate.validation.proofDigest,
      plannerPath: `/plan/${candidate.snapshot.configurationId}`,
      selectedAt: "2026-07-10T09:12:00.000Z",
    };
    mockCreateEventArchitectRun.mockResolvedValue(fixture);
    mockSelectEventArchitectCandidate.mockResolvedValue(selection);
    renderPage();
    await completeRequiredBrief();
    fireEvent.click(screen.getByRole("button", { name: "Generate three options" }));

    // Said before the press: the choice is final for this set of options.
    expect((await screen.findByText(/That choice is final for this set/u)).textContent)
      .toContain("the layout is saved as a draft, and the other two stay here to compare.");
    fireEvent.click(await screen.findByRole("button", { name: "Select Balanced" }));
    await waitFor(() => { expect(mockSelectEventArchitectCandidate).toHaveBeenCalledTimes(1); });
    expect(mockSelectEventArchitectCandidate.mock.calls[0]?.[0]).toBe(candidate.candidateId);
    const selectInput = SelectEventArchitectCandidateInputSchema.parse(
      mockSelectEventArchitectCandidate.mock.calls[0]?.[1],
    );
    expect(selectInput.expectedRequestDigest).toBe(fixture.run.requestDigest);
    expect(selectInput.idempotencyKey).toMatch(/^event-architect:select:/u);

    const plannerLink = await screen.findByRole("link", { name: /Open in planner/i });
    expect(plannerLink.getAttribute("href")).toBe(selection.plannerPath);
    expect(screen.getByText("Layout saved as a draft.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Balanced selected" })).toHaveProperty("disabled", true);
    // Once chosen, the note has done its work.
    expect(screen.queryByText(/That choice is final for this set/u)).toBeNull();
    expect(await screen.findByRole("heading", { name: "Ops review evidence" })).toBeTruthy();
    expect(screen.getByText("Only venue staff, hallkeepers or administrators can record a review.")).toBeTruthy();
    expect(mockGetEventArchitectOpsReview).toHaveBeenCalledWith(
      candidate.candidateId,
      expect.any(AbortSignal),
    );
  });

  it("shows missing pricing as an open review gate instead of a budget pass", async () => {
    const fixture = persistedRun({ ...BASE_REQUEST, pricingCatalogue: null });
    mockCreateEventArchitectRun.mockResolvedValue(fixture);
    renderPage();
    await completeRequiredBrief();
    fireEvent.click(screen.getByRole("button", { name: "Generate three options" }));

    expect(await screen.findAllByText("Not checked")).toHaveLength(6);
    expect(screen.getAllByText(/Required source data is missing before this result can be exported/i)).toHaveLength(3);
    expect(screen.getAllByText(/Supply the missing price-book entries/i)).toHaveLength(3);
  });

  it("loads a persisted run from the protected run route", async () => {
    const fixture = persistedRun();
    mockGetEventArchitectRun.mockResolvedValue(fixture);
    renderPage(`/event-architect/runs/${fixture.run.runId}`);

    expect(await screen.findByRole("heading", { name: "Three layout options" })).toBeTruthy();
    expect(mockGetEventArchitectRun).toHaveBeenCalledWith(
      fixture.run.runId,
      expect.any(AbortSignal),
    );
  });

  it("keeps authority wording and raw planning prompts out of rendered evidence", async () => {
    const planningPrompt = "Call this certified and approved for occupancy";
    const fixture = persistedRun({
      ...BASE_REQUEST,
      brief: { ...BASE_REQUEST.brief, planningPrompt },
    });
    mockCreateEventArchitectRun.mockResolvedValue(fixture);
    renderPage();
    await completeRequiredBrief();
    fireEvent.click(screen.getByRole("button", { name: "Generate three options" }));
    await screen.findByRole("heading", { name: "Three layout options" });

    const text = document.body.textContent ?? "";
    expect(text).not.toContain(planningPrompt);
    expect(text).not.toMatch(/fire approved|certified safe|legally compliant|approved for occupancy|guaranteed accessible/iu);
    expect(text).toMatch(/not safety, occupancy, accessibility-route, or statutory determinations/iu);
  });
});

// ---------------------------------------------------------------------------
// "Describe the event" (T-650): the planner's words read by the server's AI
// into a draft of the brief, checked and edited, then put into the request
// form by an explicit action. Nothing runs until Generate.
// ---------------------------------------------------------------------------

const ABSENT = { value: null, source: "absent", words: null, basis: null } as const;

function briefDraft(
  description: string,
  fields: Partial<EventBriefExtraction["fields"]>,
  unsupported: EventBriefExtraction["unsupported"] = [],
): EventBriefDraft {
  return interpretEventBriefExtraction({
    extraction: {
      fields: {
        eventName: ABSENT, eventType: ABSENT, guestCount: ABSENT, layoutStyle: ABSENT, budgetGbp: ABSENT,
        preferredDate: ABSENT, startTime: ABSENT, endTime: ABSENT, serviceModel: ABSENT, planningEmphasis: ABSENT,
        ...fields,
      },
      accessibility: [],
      unsupported,
    },
    description,
    contactDetailsRemoved: false,
    generatedAt: CREATED_AT,
  });
}

const WEDDING_WORDS = "Wedding breakfast for about 140 on Saturday 12 June 2027, round tables, plated, a top table and a dance floor.";
const WEDDING = briefDraft(WEDDING_WORDS, {
  eventName: { value: "Crawford wedding", source: "inferred", words: null, basis: "Named from the occasion." },
  eventType: { value: "wedding", source: "stated", words: "Wedding", basis: null },
  guestCount: { value: 140, source: "inferred", words: "about 140", basis: "Taken as 140 from an approximate figure." },
  layoutStyle: { value: "dinner-rounds", source: "stated", words: "round tables", basis: null },
  preferredDate: { value: "2027-06-12", source: "stated", words: "Saturday 12 June 2027", basis: null },
  serviceModel: { value: "plated", source: "stated", words: "plated", basis: null },
}, [
  { words: "a top table", kind: "not_modelled", explanation: "The Event Architect does not place a top table.", field: null },
  { words: "a dance floor", kind: "not_modelled", explanation: "The Event Architect does not place a dance floor.", field: null },
]);

async function describeEvent(words: string): Promise<void> {
  mockGetEventBriefReaderStatus.mockResolvedValue(BRIEFS_ON);
  renderPage();
  fireEvent.change(await screen.findByRole("textbox", { name: "Describe the event" }), { target: { value: words } });
}

describe("Describe the event", () => {
  it("is not offered where the server reads no briefs", async () => {
    renderPage();
    await screen.findByLabelText("Venue");
    await waitFor(() => { expect(mockGetEventBriefReaderStatus).toHaveBeenCalled(); });
    expect(screen.queryByRole("textbox", { name: "Describe the event" })).toBeNull();
    expect(screen.queryByTestId("brief-reader")).toBeNull();
  });

  it("reads the planner's words into an editable draft, then fills the form without running anything", async () => {
    mockReadEventBrief.mockResolvedValue(WEDDING);
    mockCreateEventArchitectRun.mockResolvedValue(persistedRun());
    await describeEvent(WEDDING_WORDS);
    fireEvent.click(screen.getByRole("button", { name: "Read the brief" }));

    const preview = await screen.findByTestId("brief-preview");
    expect(mockReadEventBrief).toHaveBeenCalledWith(
      { venueId: VENUE_ID, spaceId: SPACE_ID, description: WEDDING_WORDS },
      expect.any(AbortSignal),
    );
    const read = within(preview);
    expect(read.getByRole("heading", { name: "The brief as read" })).toBeTruthy();
    expect(read.getByText(/Read for the Grand Hall/u)).toBeTruthy();
    expect(read.getByText("Not checked")).toBeTruthy();
    expect(read.getByLabelText(/^Guests/u)).toHaveProperty("value", "140");
    // The values it inferred are marked, and say what was assumed and why.
    expect(read.getAllByText("Assumed")).toHaveLength(2);
    const assumed = within(read.getByTestId("brief-assumptions"));
    expect(assumed.getByText("Guests: 140")).toBeTruthy();
    expect(assumed.getByText("Taken as 140 from an approximate figure.")).toBeTruthy();
    // What it cannot plan is kept, in the planner's own words.
    const held = within(read.getByTestId("brief-unsupported"));
    expect(held.getByText("a top table")).toBeTruthy();
    expect(held.getByText("a dance floor")).toBeTruthy();

    // Every value is the planner's to change; a changed value is theirs.
    fireEvent.change(read.getByLabelText(/^Guests/u), { target: { value: "150" } });
    expect(read.getAllByText("Assumed")).toHaveLength(1);
    expect(mockCreateEventArchitectRun).not.toHaveBeenCalled();

    fireEvent.click(read.getByRole("button", { name: "Fill the request form" }));
    expect(screen.queryByTestId("brief-preview")).toBeNull();
    expect(screen.getByLabelText("Event name")).toHaveProperty("value", "Crawford wedding");
    expect(screen.getByLabelText("Guests")).toHaveProperty("value", "150");
    expect(screen.getByLabelText(/Preferred date/u)).toHaveProperty("value", "2027-06-12");
    expect(screen.getByLabelText("Layout style")).toHaveProperty("value", "dinner-rounds");
    expect(screen.getByLabelText("Service model")).toHaveProperty("value", "plated");
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByLabelText("Event name")); });
    expect(screen.getByText("The request form below holds this brief.")).toBeTruthy();
    expect(within(screen.getByTestId("brief-filled")).getByText("a dance floor")).toBeTruthy();
    expect(mockCreateEventArchitectRun).not.toHaveBeenCalled();

    // The existing run flow takes it from here.
    fireEvent.click(screen.getByRole("button", { name: "Generate three options" }));
    await waitFor(() => { expect(mockCreateEventArchitectRun).toHaveBeenCalledTimes(1); });
    expect(CreateEventArchitectRunInputSchema.parse(mockCreateEventArchitectRun.mock.calls[0]?.[0]).brief).toMatchObject({
      eventName: "Crawford wedding",
      eventType: "wedding",
      guestCount: 150,
      layoutStyle: "dinner-rounds",
      serviceModel: "plated",
      preferredDate: "2027-06-12",
    });
  });

  it("asks for a layout before filling when the one described is not offered", async () => {
    const words = "Awards night for 200, cabaret style, plated.";
    mockReadEventBrief.mockResolvedValue(briefDraft(words, {
      guestCount: { value: 200, source: "stated", words: "200", basis: null },
      layoutStyle: { value: "other", source: "stated", words: "cabaret style", basis: null },
      serviceModel: { value: "plated", source: "stated", words: "plated", basis: null },
    }));
    await describeEvent(words);
    fireEvent.click(screen.getByRole("button", { name: "Read the brief" }));
    const read = within(await screen.findByTestId("brief-preview"));
    expect(read.getByLabelText(/^Layout style/u)).toHaveProperty("value", "");
    expect(within(read.getByTestId("brief-unsupported")).getByText("cabaret style")).toBeTruthy();

    fireEvent.click(read.getByRole("button", { name: "Fill the request form" }));
    expect(read.getByRole("alert").textContent).toBe("Choose a layout style before filling the form.");
    expect(document.activeElement).toBe(read.getByLabelText(/^Layout style/u));
    expect(screen.getByTestId("brief-preview")).toBeTruthy();

    fireEvent.change(read.getByLabelText(/^Layout style/u), { target: { value: "theatre" } });
    fireEvent.click(read.getByRole("button", { name: "Fill the request form" }));
    expect(screen.getByLabelText("Layout style")).toHaveProperty("value", "theatre");
  });

  it("stops a read on its way, keeping the description, and drops its late answer", async () => {
    let answer: (draft: EventBriefDraft) => void = () => undefined;
    let signal: AbortSignal | undefined;
    mockReadEventBrief.mockImplementation((_input: unknown, abort: AbortSignal) => {
      signal = abort;
      return new Promise<EventBriefDraft>((resolve) => { answer = resolve; });
    });
    await describeEvent(WEDDING_WORDS);
    fireEvent.click(screen.getByRole("button", { name: "Read the brief" }));
    const working = await screen.findByRole("button", { name: "Reading the brief…" });
    expect(working.getAttribute("aria-busy")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole("button", { name: "Read the brief" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Describe the event" })).toHaveProperty("value", WEDDING_WORDS);
    expect(screen.getByTestId("brief-reader-said").textContent).toBe("Stopped. Your description is unchanged.");

    answer(WEDDING);
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(screen.queryByTestId("brief-preview")).toBeNull();
  });

  it("says when the brief could not be read, and reads it again on request", async () => {
    mockReadEventBrief
      .mockRejectedValueOnce(new ApiError(502, "AI draft generation failed", "AI_DRAFT_GENERATION_FAILED"))
      .mockResolvedValueOnce(WEDDING);
    await describeEvent(WEDDING_WORDS);
    fireEvent.click(screen.getByRole("button", { name: "Read the brief" }));
    const failed = await screen.findByTestId("brief-failed");
    expect(failed.textContent).toContain("The brief could not be read. Your description is still here.");

    fireEvent.click(within(failed).getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("brief-preview")).toBeTruthy();
    expect(mockReadEventBrief).toHaveBeenCalledTimes(2);
  });

  it("takes reading away for the visit when the server says AI is off, leaving the form as it was", async () => {
    mockReadEventBrief.mockRejectedValue(new ApiError(503, "AI drafts are disabled", "AI_ASSISTANT_DISABLED"));
    await describeEvent(WEDDING_WORDS);
    fireEvent.click(screen.getByRole("button", { name: "Read the brief" }));
    expect((await screen.findByTestId("brief-reader-gone")).textContent)
      .toBe("Reading briefs is not available now. The request form below works as before.");
    expect(screen.queryByRole("textbox", { name: "Describe the event" })).toBeNull();
    expect(screen.getByLabelText("Guests")).toHaveProperty("value", "80");
  });

  it("asks for some words before reading", async () => {
    await describeEvent("   ");
    fireEvent.click(screen.getByRole("button", { name: "Read the brief" }));
    expect(screen.getByRole("alert").textContent).toBe("Write a few words about the event first.");
    expect(mockReadEventBrief).not.toHaveBeenCalled();
  });
});
