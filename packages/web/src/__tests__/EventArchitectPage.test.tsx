import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  CreateEventArchitectRunInputSchema,
  SelectEventArchitectCandidateInputSchema,
  runEventArchitect,
  type EventArchitectCandidateSelection,
  type EventArchitectRequest,
  type PersistedEventArchitectRun,
} from "@omnitwin/types";
import { EventArchitectPage } from "../pages/EventArchitectPage.js";
import { useAuthStore } from "../stores/auth-store.js";

const {
  mockCreateEventArchitectRun,
  mockGetEventArchitectRun,
  mockSelectEventArchitectCandidate,
  mockGetEventArchitectOpsReview,
  mockCreateEventArchitectOpsReview,
  mockGetVenue,
  mockListVenues,
} = vi.hoisted(() => ({
  mockCreateEventArchitectRun: vi.fn(),
  mockGetEventArchitectRun: vi.fn(),
  mockSelectEventArchitectCandidate: vi.fn(),
  mockGetEventArchitectOpsReview: vi.fn(),
  mockCreateEventArchitectOpsReview: vi.fn(),
  mockGetVenue: vi.fn(),
  mockListVenues: vi.fn(),
}));

vi.mock("../api/event-architect.js", () => ({
  createEventArchitectRun: mockCreateEventArchitectRun,
  getEventArchitectRun: mockGetEventArchitectRun,
  selectEventArchitectCandidate: mockSelectEventArchitectCandidate,
  getEventArchitectOpsReview: mockGetEventArchitectOpsReview,
  createEventArchitectOpsReview: mockCreateEventArchitectOpsReview,
}));

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
    expect(screen.getByLabelText("Venue")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Room")).toHaveProperty("value", SPACE_ID);
    expect(screen.getByRole("group", { name: "Accessibility requirements to carry into human review" })).toBeTruthy();
    expect(screen.getByText(/does not validate an accessibility route/i)).toBeTruthy();
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

    expect(await screen.findByRole("heading", { name: "Three frozen candidate snapshots" })).toBeTruthy();
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
    expect(screen.getByText("Exact snapshot saved to a planner configuration.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Balanced selected" })).toHaveProperty("disabled", true);
    expect(await screen.findByRole("heading", { name: "Ops review evidence" })).toBeTruthy();
    expect(screen.getByText("Planner access is read-only.", { exact: false })).toBeTruthy();
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

    expect(await screen.findByRole("heading", { name: "Three frozen candidate snapshots" })).toBeTruthy();
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
    await screen.findByRole("heading", { name: "Three frozen candidate snapshots" });

    const text = document.body.textContent ?? "";
    expect(text).not.toContain(planningPrompt);
    expect(text).not.toMatch(/fire approved|certified safe|legally compliant|approved for occupancy|guaranteed accessible/iu);
    expect(text).toMatch(/not safety, occupancy, accessibility-route, or statutory determinations/iu);
  });
});
