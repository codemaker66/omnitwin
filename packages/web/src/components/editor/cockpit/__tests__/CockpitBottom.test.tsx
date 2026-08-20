import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import type { ReactElement } from "react";
import {
  CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
  canonicalLayoutSnapshotDigest,
  historicalRuntimeFromBinding,
  type CanonicalLayoutSnapshotV0,
  type EventPhaseGraph,
} from "@omnitwin/types";
import type {
  FreezePhaseLayoutSnapshotResponse,
  RoomLayoutTimelineFrame,
  RoomLayoutTimelineKeyframe,
  RoomLayoutTimelineQuery,
  RoomLayoutTimelineResponse,
  RoomLayoutTimelineScope,
} from "../../../../api/room-layout-timeline.js";
import { isLayoutTimelineMutationLocked } from "../../../../lib/layout-timeline-preview-lock.js";

vi.mock("../../../../api/room-layout-timeline.js", () => ({
  getRoomLayoutTimeline: vi.fn(),
  freezePhaseLayoutSnapshot: vi.fn(),
}));
vi.mock("../../../../api/events.js", () => ({ getEventPhaseGraph: vi.fn() }));

const timelineApi = vi.mocked(await import("../../../../api/room-layout-timeline.js"));
const eventsApi = vi.mocked(await import("../../../../api/events.js"));
const { CockpitBottom } = await import("../CockpitBottom.js");
const {
  isValidTimelineDeepLinkDate,
  MAX_MOUNTED_TIMELINE_THUMBNAILS,
  shouldMountTimelineThumbnail,
  timelineRetargetSourceFrame,
  timelinePhaseDensityClass,
} = await import("../RoomLayoutTimelineDock.js");
const { isRoundTimelineCollision } = await import("../LayoutPlanThumbnail.js");
const { timelineCaptureEndpointReuse } = await import("../../TimelinePreviewFurniture.js");
const { timelineScopedRequestRange } = await import("../../../../lib/room-layout-timeline-ui.js");
const { useCockpitStore } = await import("../../../../stores/cockpit-store.js");
const { useEditorStore } = await import("../../../../stores/editor-store.js");
const { useAuthStore } = await import("../../../../stores/auth-store.js");
const { useLayoutTimelinePreviewStore } = await import("../../../../stores/layout-timeline-preview-store.js");

const VENUE_ID = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueId;
const SPACE_ID = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.spaceId;
const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_EVENT_ID = "15151515-1515-4515-8516-151515151515";
const ARRIVAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FLIP_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DINNER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PARTY_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LEADING_ID = "13131313-1313-4313-8313-131313131313";
const TRAILING_ID = "14141414-1414-4414-8414-141414141414";
const START = "2026-07-18T16:00:00.000Z";

function snapshotWith(offsetX: number, guests: number): CanonicalLayoutSnapshotV0 {
  return {
    ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
    guestCount: guests,
    eventMetadata: {
      ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.eventMetadata,
      guestCount: guests,
    },
    objects: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.objects.map((object) => ({
      ...object,
      position: { ...object.position, x: object.position.x + offsetX },
    })),
  };
}

function available(
  snapshot: CanonicalLayoutSnapshotV0,
  snapshotId: string,
): RoomLayoutTimelineKeyframe {
  return {
    state: "available",
    snapshotId,
    snapshotHash: canonicalLayoutSnapshotDigest(snapshot),
    snapshotStatus: "frozen",
    canonicalSnapshotId: snapshotId,
    proofDigest: snapshotId.replaceAll("-", "").repeat(2),
    frozenBy: "99999999-9999-4999-8999-999999999999",
    supersedesSnapshotId: null,
    createdAt: "2026-07-17T10:00:00.000Z",
    frozenAt: "2026-07-17T10:05:00.000Z",
    objectCount: snapshot.objects.length,
    guestCount: snapshot.guestCount,
    payload: snapshot,
    historicalRuntime: historicalRuntimeFromBinding(null),
  };
}

function frame(
  id: string,
  phaseName: string,
  startHour: number,
  keyframe: RoomLayoutTimelineKeyframe,
  kind: "phase" | "room_flip" = "phase",
): RoomLayoutTimelineFrame {
  const startsAt = new Date(Date.parse(START) + startHour * 3_600_000);
  const payload = keyframe.state === "available" ? keyframe.payload : null;
  const chairCount = payload?.objects.filter((object) => object.assetDefinition.category === "chair").length ?? 0;
  const tableSeats = payload?.objects
    .filter((object) => object.assetDefinition.category === "table")
    .reduce((sum, object) => sum + (object.assetDefinition.seatCount ?? 0), 0) ?? 0;
  return {
    id,
    kind,
    eventId: EVENT_ID,
    eventName: "Elaine & James",
    eventType: "wedding",
    eventStatus: "in_planning",
    eventGuestCount: 120,
    phaseId: id,
    phaseName,
    templateKey: kind === "room_flip" ? "room-flip" : null,
    sortOrder: startHour,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 90 * 60_000).toISOString(),
    guestCount: 120,
    opsTasksCount: 0,
    reviewGatesCount: 0,
    densityStatus: "not_checked",
    densityLabel: "Density not checked",
    staffConflictsStatus: "not_checked",
    staffConflictsLabel: "Staff conflicts not checked",
    figures: {
      guests: {
        value: keyframe.state === "available" ? keyframe.payload.guestCount : 120,
        source: keyframe.state === "available" ? "frozen_snapshot" : "phase",
      },
      seatedCapacity: keyframe.state === "available" ? {
        state: "available",
        value: chairCount > 0 ? chairCount : tableSeats,
        source: "frozen_snapshot",
        basis: chairCount > 0 ? "chair_objects" : "table_seat_counts",
      } : {
        state: "unavailable",
        reason: "no_valid_frozen_keyframe",
      },
      staffing: {
        state: "not_checked",
        value: null,
        source: "phase_staff_conflicts",
        staffConflictsStatus: "not_checked",
        staffConflictsLabel: "Staff conflicts not checked",
      },
      revenue: keyframe.state === "available" ? {
        state: "available",
        source: "planning_scenario",
        scenario: {
          id: "34343434-3434-4434-8434-343434343434",
          name: "Wedding planning scenario",
          status: "active",
          scenarioKind: "layout_based",
          currency: "GBP",
          plannedGuestCount: keyframe.payload.guestCount,
          estimatedRevenueMinor: 2_875_000,
          comfortStatus: "not_checked",
          reviewGateCount: 0,
          updatedAt: "2026-07-17T10:00:00.000Z",
        },
        disclosure: "Planning scenario estimate; not a quote or approval.",
      } : {
        state: "unavailable",
        reason: "no_valid_frozen_keyframe",
      },
    },
    keyframe,
  };
}

const arrival = frame(
  ARRIVAL_ID,
  "Guest arrival",
  0,
  available(snapshotWith(0, 100), "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
);
const roomFlip = frame(FLIP_ID, "Room flip", 2, {
  state: "missing",
  reason: "room_flip_gap",
  message: "Operational room flip between saved phase layouts.",
}, "room_flip");
const dinner = frame(
  DINNER_ID,
  "Dinner service",
  4,
  available(snapshotWith(2, 120), "ffffffff-ffff-4fff-8fff-ffffffffffff"),
);
const party = frame(
  PARTY_ID,
  "Evening party",
  6,
  available(snapshotWith(4, 150), "12121212-1212-4212-8212-121212121212"),
);

function response(
  frames: readonly RoomLayoutTimelineFrame[],
  scope: RoomLayoutTimelineScope = "day",
  anchorDate = "2026-07-18",
  venueId = VENUE_ID,
  spaceId = SPACE_ID,
): RoomLayoutTimelineResponse {
  const exactRange = timelineScopedRequestRange(scope, anchorDate, "Europe/London");
  if (exactRange === null) throw new Error("Test timeline range is invalid.");
  const { from, to } = exactRange;
  return {
    venueId,
    spaceId,
    timeZone: "Europe/London",
    from,
    to,
    range: { scope, anchorDate, from, to },
    frames: [...frames],
  };
}

function responseForQuery(
  query: RoomLayoutTimelineQuery,
  frames: readonly RoomLayoutTimelineFrame[],
): RoomLayoutTimelineResponse {
  if ("scope" in query) {
    return response(frames, query.scope, query.anchorDate, query.venueId, query.spaceId);
  }
  return {
    ...response(frames, "day", "2026-07-18", query.venueId, query.spaceId),
    from: query.from,
    to: query.to,
    range: { scope: "custom", anchorDate: null, from: query.from, to: query.to },
  };
}

function responseForQueryInZone(
  query: RoomLayoutTimelineQuery,
  frames: readonly RoomLayoutTimelineFrame[],
  timeZone: string,
): RoomLayoutTimelineResponse {
  if (!("scope" in query)) return responseForQuery(query, frames);
  const exactRange = timelineScopedRequestRange(query.scope, query.anchorDate, timeZone);
  if (exactRange === null) throw new Error("Test timeline range is invalid.");
  return {
    ...responseForQuery(query, frames),
    timeZone,
    from: exactRange.from,
    to: exactRange.to,
    range: {
      scope: query.scope,
      anchorDate: query.anchorDate,
      from: exactRange.from,
      to: exactRange.to,
    },
  };
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return {
    promise,
    resolve: (value) => { resolvePromise?.(value); },
  };
}

function freezeResult(phaseId: string): FreezePhaseLayoutSnapshotResponse {
  return {
    outcome: "created",
    eventId: EVENT_ID,
    phaseId,
    configurationId: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.configurationId,
    snapshotId: "45454545-4545-4545-8545-454545454545",
    canonicalSnapshotId: "88888888-8888-4888-8888-888888888888",
    snapshotHash: "a".repeat(64),
    proofDigest: "b".repeat(64),
    frozenBy: "99999999-9999-4999-8999-999999999999",
    status: "frozen",
    coordinateSpace: "real_m_v1",
    objectCount: 1,
    guestCount: 120,
    createdAt: "2026-07-18T12:00:00.000Z",
    frozenAt: "2026-07-18T12:00:00.000Z",
    supersedesSnapshotId: null,
  };
}

function linkedEventGraph(
  startsAt: string,
  phaseIds: readonly string[] = [ARRIVAL_ID, DINNER_ID, PARTY_ID],
): EventPhaseGraph {
  return {
    event: {
      id: EVENT_ID,
      venueId: VENUE_ID,
      createdBy: null,
      name: "Elaine & James",
      eventType: "wedding",
      status: "in_planning",
      startsAt,
      endsAt: null,
      guestCount: 120,
      clientName: null,
      notes: null,
      createdAt: startsAt,
      updatedAt: startsAt,
    },
    phases: phaseIds.map((phaseId, index) => ({
      id: phaseId,
      eventId: EVENT_ID,
      spaceId: SPACE_ID,
      templateKey: "arrival",
      name: phaseId === DINNER_ID ? "Dinner service" : phaseId === PARTY_ID ? "Evening party" : "Guest arrival",
      sortOrder: index,
      startsAt,
      durationMinutes: 90,
      guestCount: 120,
      opsTasksCount: 0,
      reviewGatesCount: 0,
      densityStatus: "not_checked",
      densityLabel: "Density not checked",
      staffConflictsStatus: "not_checked",
      staffConflictsLabel: "Staff conflicts not checked",
      notes: null,
      createdAt: startsAt,
      updatedAt: startsAt,
    })),
    scenarios: [],
    layoutVariants: [],
    configurationLinks: [],
    phaseLayoutSnapshots: [],
  };
}

function BackButton(): ReactElement {
  const navigate = useNavigate();
  return <button type="button" onClick={() => { void navigate(-1); }}>Back</button>;
}

function ClearTimelineDateButton(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <button
      type="button"
      onClick={() => {
        const next = new URLSearchParams(location.search);
        next.delete("timelineDate");
        void navigate(`${location.pathname}?${next.toString()}`);
      }}
    >
      Clear timeline date
    </button>
  );
}

function LocationSearch(): ReactElement {
  return <output data-testid="location-search">{useLocation().search}</output>;
}

function renderBottom(
  url = "/plan/cfg-1?timelineScope=day&timelineDate=2026-07-18",
  history?: readonly string[],
) {
  const entries = history ?? [url];
  return render(
    <MemoryRouter initialEntries={[...entries]} initialIndex={entries.length - 1}>
      <CockpitBottom />
      {history === undefined ? null : <><BackButton /><ClearTimelineDateButton /><LocationSearch /></>}
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useLayoutTimelinePreviewStore.getState().clear();
  useCockpitStore.getState().reset();
  useEditorStore.setState({
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    configId: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.configurationId,
    isDirty: false,
    isPublicPreview: false,
  });
  useAuthStore.getState().logout();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useLayoutTimelinePreviewStore.getState().clear();
  useEditorStore.setState({ venueId: null, spaceId: null, configId: null });
  useAuthStore.getState().logout();
});

describe("CockpitBottom room layout timeline", () => {
  it("compacts short phase blocks while retaining the full accessible label", async () => {
    expect(timelinePhaseDensityClass(3.99)).toBe(" is-micro");
    expect(timelinePhaseDensityClass(4)).toBe(" is-compact");
    expect(timelinePhaseDensityClass(20, 2)).toBe(" is-compact");
    expect(timelinePhaseDensityClass(10)).toBe("");

    const shortRoomFlip = {
      ...roomFlip,
      endsAt: new Date(Date.parse(roomFlip.startsAt) + 5 * 60_000).toISOString(),
    };
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, shortRoomFlip, dinner]));
    renderBottom();
    await screen.findByRole("slider", { name: /scrub room layout/i });
    const roomFlipBlock = document.querySelector<HTMLElement>(
      '.layout-phase[aria-label*="Elaine & James, Room flip,"]',
    );
    if (roomFlipBlock === null) throw new Error("Expected a compact Room flip phase block");
    expect(roomFlipBlock.matches(".is-compact, .is-micro")).toBe(true);
    expect(roomFlipBlock.getAttribute("title")).toContain("Elaine & James · Room flip");
  });

  it("renders both canonical cylinder and legacy circle collision witnesses as round", () => {
    expect(isRoundTimelineCollision("cylinder")).toBe(true);
    expect(isRoundTimelineCollision("circle")).toBe(true);
    expect(isRoundTimelineCollision("box")).toBe(false);
  });

  it("shows an honest scoped empty state and retries a failed read", async () => {
    timelineApi.getRoomLayoutTimeline
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response([]));
    renderBottom();

    expect(await screen.findByText("Room timeline unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No room phases this day")).toBeTruthy();
    expect(timelineApi.getRoomLayoutTimeline).toHaveBeenCalledTimes(2);
  });

  it("preserves the one-phase hide rule", async () => {
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival]));
    renderBottom();
    await waitFor(() => { expect(screen.queryByTestId("cockpit-bottom")).toBeNull(); });
  });

  it("keeps a one-phase superseding freeze reachable while hiding timeline controls", async () => {
    useAuthStore.getState().setUser({
      id: "staff-user",
      email: "staff@venue.test",
      role: "staff",
      platformRole: "none",
      venueId: VENUE_ID,
      name: "Venue Staff",
    });
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival]));
    timelineApi.freezePhaseLayoutSnapshot.mockResolvedValue(freezeResult(ARRIVAL_ID));
    eventsApi.getEventPhaseGraph.mockResolvedValue(linkedEventGraph(START, [ARRIVAL_ID]));
    renderBottom(`/plan/cfg-1?eventId=${EVENT_ID}&timelineScope=day&timelineDate=2026-07-18`);

    const freeze = await screen.findByRole("button", { name: "Freeze current saved plan" });
    expect(screen.queryByRole("slider", { name: /scrub room layout/i })).toBeNull();
    fireEvent.click(freeze);
    await waitFor(() => {
      expect(timelineApi.freezePhaseLayoutSnapshot).toHaveBeenCalledWith(
        { eventId: EVENT_ID, phaseId: ARRIVAL_ID },
        { configurationId: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.configurationId },
      );
    });
  });

  it("allows an authorized invalid phase to be recovered by freezing the saved plan", async () => {
    const invalid = frame(PARTY_ID, "Evening party", 6, {
      state: "invalid",
      snapshotId: "12121212-1212-4212-8212-121212121212",
      snapshotStatus: "frozen",
      createdAt: "2026-07-17T10:00:00.000Z",
      frozenAt: "2026-07-17T10:05:00.000Z",
      reason: "payload_schema_invalid",
      message: "The previous frozen payload is invalid.",
    });
    useAuthStore.getState().setUser({
      id: "staff-user",
      email: "staff@venue.test",
      role: "staff",
      platformRole: "none",
      venueId: VENUE_ID,
      name: "Venue Staff",
    });
    timelineApi.getRoomLayoutTimeline
      .mockResolvedValueOnce(response([arrival, invalid]))
      .mockResolvedValue(response([arrival, party]));
    timelineApi.freezePhaseLayoutSnapshot.mockResolvedValue(freezeResult(PARTY_ID));
    eventsApi.getEventPhaseGraph.mockResolvedValue(linkedEventGraph(START));
    renderBottom(`/plan/cfg-1?eventId=${EVENT_ID}&timelineScope=day&timelineDate=2026-07-18`);
    const invalidCard = (await screen.findAllByRole(
      "button",
      { name: /evening party.*saved layout invalid/i },
    )).at(-1);
    expect(invalidCard).toBeDefined();
    if (invalidCard === undefined) return;
    fireEvent.click(invalidCard);
    expect(screen.queryByRole("button", { name: "Freeze current saved plan" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Exit preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Freeze current saved plan" }));

    await waitFor(() => {
      expect(timelineApi.freezePhaseLayoutSnapshot).toHaveBeenCalledWith(
        { eventId: EVENT_ID, phaseId: PARTY_ID },
        { configurationId: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.configurationId },
      );
    });
    await waitFor(() => {
      expect(timelineApi.getRoomLayoutTimeline).toHaveBeenCalledTimes(2);
      expect(useLayoutTimelinePreviewStore.getState().activeFrame?.phaseId).toBe(PARTY_ID);
    });
    expect(useLayoutTimelinePreviewStore.getState().mode).toBe("keyframe");
  });

  it("uses the scoped API contract, settles the initial viewer, and syncs truthful figures", async () => {
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, roomFlip, dinner]));
    renderBottom();

    await screen.findByRole("slider", { name: /scrub room layout/i });
    expect(timelineApi.getRoomLayoutTimeline).toHaveBeenCalledWith({
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      scope: "day",
      anchorDate: "2026-07-18",
    }, expect.any(AbortSignal));
    expect(useLayoutTimelinePreviewStore.getState().activeFrame?.phaseId).toBe(ARRIVAL_ID);
    expect(screen.getByLabelText("Guests: 100")).toBeTruthy();
    expect(screen.getByLabelText("Seated capacity: 1")).toBeTruthy();
    expect(screen.getByLabelText("Staffing: Not recorded")).toBeTruthy();
    expect(screen.getByLabelText("Revenue: £28,750").getAttribute("aria-description"))
      .toBe("Planning scenario estimate; not a quote or approval.");
    expect(screen.getAllByRole("button", { name: /room flip.*room flip gap/i })
      .every((button) => !button.hasAttribute("disabled"))).toBe(true);

    const slider = screen.getByRole("slider", { name: /scrub room layout/i });
    fireEvent.change(slider, { target: { value: String(Date.parse("2026-07-18T18:45:00.000Z")) } });
    expect(useLayoutTimelinePreviewStore.getState().transition?.progress).toBe(0.5);
    expect(useCockpitStore.getState().selectedPhaseId).toBe(DINNER_ID);
    expect(screen.getByLabelText("Guests: 120")).toBeTruthy();
  });

  it("rebuilds the correct scrub segment after a card selection replaced it", async () => {
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, roomFlip, dinner, party]));
    renderBottom();
    const slider = await screen.findByRole("slider", { name: /scrub room layout/i });
    const betweenArrivalAndDinner = String(Date.parse("2026-07-18T18:45:00.000Z"));

    fireEvent.change(slider, { target: { value: betweenArrivalAndDinner } });
    expect(useLayoutTimelinePreviewStore.getState().transition).toMatchObject({
      fromFrame: { phaseId: ARRIVAL_ID },
      toFrame: { phaseId: DINNER_ID },
    });

    fireEvent.click(screen.getAllByRole(
      "button",
      { name: /evening party.*frozen layout/i },
    )[0] ?? document.body);
    expect(useLayoutTimelinePreviewStore.getState().transition?.toFrame.phaseId).toBe(PARTY_ID);

    fireEvent.change(slider, {
      target: { value: String(Date.parse("2026-07-18T18:30:00.000Z")) },
    });
    expect(useLayoutTimelinePreviewStore.getState().transition).toMatchObject({
      fromFrame: { phaseId: ARRIVAL_ID },
      toFrame: { phaseId: DINNER_ID },
    });
  });

  it("keeps non-frozen snapshots visible but unavailable", async () => {
    const draftInvalid = frame(PARTY_ID, "Evening party", 6, {
      state: "invalid",
      snapshotId: "12121212-1212-4212-8212-121212121212",
      snapshotStatus: "draft",
      createdAt: "2026-07-17T10:00:00.000Z",
      frozenAt: null,
      reason: "snapshot_status_invalid",
      message: "Only a frozen phase snapshot can be previewed.",
    });
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, draftInvalid]));
    renderBottom();

    const unavailable = await screen.findAllByRole("button", { name: /evening party.*saved layout invalid/i });
    expect(unavailable.every((button) => !button.hasAttribute("disabled"))).toBe(true);
    const unavailableButton = unavailable.at(-1);
    expect(unavailableButton).toBeDefined();
    if (unavailableButton === undefined) return;
    fireEvent.click(unavailableButton);
    expect(useLayoutTimelinePreviewStore.getState().activeFrame?.phaseId).toBe(PARTY_ID);
    expect(useLayoutTimelinePreviewStore.getState().mode).toBe("unavailable");
    expect(screen.getByText("Only a frozen phase snapshot can be previewed.")).toBeTruthy();
  });

  it("offers freeze for a linked phase on a clean private saved configuration", async () => {
    const missing = frame(PARTY_ID, "Evening party", 6, {
      state: "missing",
      reason: "no_snapshot",
      message: "No frozen party layout.",
    });
    useAuthStore.getState().setUser({
      id: "staff-user",
      email: "staff@venue.test",
      role: "staff",
      platformRole: "none",
      venueId: VENUE_ID,
      name: "Venue Staff",
    });
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, roomFlip, missing]));
    eventsApi.getEventPhaseGraph.mockResolvedValue(linkedEventGraph(START));
    renderBottom(`/plan/cfg-1?eventId=${EVENT_ID}&timelineScope=day&timelineDate=2026-07-18`);

    await screen.findByRole("button", { name: "Exit preview" });
    expect(screen.queryByRole("button", { name: "Freeze current saved plan" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Exit preview" }));
    expect(await screen.findByRole("button", { name: "Freeze current saved plan" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /room flip.*room flip gap/i })).toHaveLength(2);
  });

  it("hides freeze for dirty, unsaved, and public configurations", async () => {
    const missing = frame(PARTY_ID, "Evening party", 6, {
      state: "missing",
      reason: "no_snapshot",
      message: "No frozen party layout.",
    });
    useAuthStore.getState().setUser({
      id: "staff-user",
      email: "staff@venue.test",
      role: "staff",
      platformRole: "none",
      venueId: VENUE_ID,
      name: "Venue Staff",
    });
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, missing]));
    eventsApi.getEventPhaseGraph.mockResolvedValue(linkedEventGraph(START));

    useEditorStore.setState({ isDirty: true });
    const linkedUrl = `/plan/cfg-1?eventId=${EVENT_ID}&timelineScope=day&timelineDate=2026-07-18`;
    const dirty = renderBottom(linkedUrl);
    await screen.findByRole("slider", { name: /scrub room layout/i });
    expect(screen.queryByRole("button", { name: "Freeze current saved plan" })).toBeNull();
    dirty.unmount();

    useLayoutTimelinePreviewStore.getState().clear();
    useEditorStore.setState({ isDirty: false, configId: null });
    const unsaved = renderBottom(linkedUrl);
    await screen.findByRole("slider", { name: /scrub room layout/i });
    expect(screen.queryByRole("button", { name: "Freeze current saved plan" })).toBeNull();
    unsaved.unmount();

    useLayoutTimelinePreviewStore.getState().clear();
    useEditorStore.setState({
      configId: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.configurationId,
      isPublicPreview: true,
    });
    renderBottom(linkedUrl);
    await screen.findByRole("slider", { name: /scrub room layout/i });
    expect(screen.queryByRole("button", { name: "Freeze current saved plan" })).toBeNull();
  });

  it("hydrates a deep link to an unavailable phase without substituting another layout", async () => {
    const invalid = frame(PARTY_ID, "Evening party", 6, {
      state: "invalid",
      snapshotId: "12121212-1212-4212-8212-121212121212",
      snapshotStatus: "draft",
      createdAt: "2026-07-17T10:00:00.000Z",
      frozenAt: null,
      reason: "snapshot_status_invalid",
      message: "Only a frozen phase snapshot can be previewed.",
    });
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, invalid]));
    renderBottom(`/plan/cfg-1?timelineScope=day&timelineDate=2026-07-18&timelinePhaseId=${PARTY_ID}`);

    await screen.findByRole("slider", { name: /scrub room layout/i });
    await waitFor(() => {
      expect(useLayoutTimelinePreviewStore.getState().mode).toBe("unavailable");
      expect(useLayoutTimelinePreviewStore.getState().activeFrame?.phaseId).toBe(PARTY_ID);
    });
    expect(useCockpitStore.getState().selectedPhaseId).toBe(PARTY_ID);
  });

  it("restores the exact phase selected before preview on exit, collapse, and unmount", async () => {
    useCockpitStore.getState().selectPhase("phase-selected-before-preview");
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, dinner]));
    const rendered = renderBottom();

    await screen.findByRole("slider", { name: /scrub room layout/i });
    expect(useCockpitStore.getState().selectedPhaseId).toBe(ARRIVAL_ID);
    fireEvent.click(screen.getByRole("button", { name: "Exit preview" }));
    expect(useCockpitStore.getState().selectedPhaseId).toBe("phase-selected-before-preview");

    const arrivalButton = screen.getAllByRole("button", { name: /Guest arrival.*Frozen layout/i }).at(-1);
    expect(arrivalButton).toBeDefined();
    if (arrivalButton === undefined) return;
    fireEvent.click(arrivalButton);
    expect(useCockpitStore.getState().selectedPhaseId).toBe(ARRIVAL_ID);
    fireEvent.click(screen.getByRole("button", { name: "Collapse room timeline" }));
    expect(useCockpitStore.getState().selectedPhaseId).toBe("phase-selected-before-preview");

    fireEvent.click(screen.getByRole("button", { name: "Expand room timeline" }));
    expect(useCockpitStore.getState().selectedPhaseId).toBe(ARRIVAL_ID);
    rendered.unmount();
    expect(useCockpitStore.getState().selectedPhaseId).toBe("phase-selected-before-preview");
  });

  it("starts an all-unavailable range in a locked, furniture-empty preview session", async () => {
    const missing = frame(ARRIVAL_ID, "Guest arrival", 0, {
      state: "missing",
      reason: "no_snapshot",
      message: "No frozen arrival layout.",
    });
    const invalid = frame(DINNER_ID, "Dinner service", 4, {
      state: "invalid",
      snapshotId: "abababab-abab-4bab-8bab-abababababab",
      snapshotStatus: "draft",
      createdAt: "2026-07-17T10:00:00.000Z",
      frozenAt: null,
      reason: "snapshot_status_invalid",
      message: "Dinner is not frozen.",
    });
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([missing, invalid]));
    renderBottom();
    await screen.findByRole("slider", { name: /scrub room layout/i });

    expect(useLayoutTimelinePreviewStore.getState().mode).toBe("unavailable");
    expect(useLayoutTimelinePreviewStore.getState().currentItems).toEqual([]);
    const before = useEditorStore.getState().objects;
    useEditorStore.getState().addObject("blocked-during-preview", 0, 0, 0);
    expect(useEditorStore.getState().objects).toBe(before);
  });

  it("shows an unavailable locked interval instead of bridging through an invalid phase", async () => {
    const invalid = frame(PARTY_ID, "Speeches", 2, {
      state: "invalid",
      snapshotId: "abababab-abab-4bab-8bab-abababababab",
      snapshotStatus: "frozen",
      createdAt: "2026-07-17T10:00:00.000Z",
      frozenAt: "2026-07-17T10:05:00.000Z",
      reason: "payload_schema_invalid",
      message: "The speeches layout is invalid.",
    });
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, invalid, dinner]));
    renderBottom();
    const slider = await screen.findByRole("slider", { name: /scrub room layout/i });
    fireEvent.change(slider, { target: { value: String(Date.parse("2026-07-18T18:30:00.000Z")) } });

    expect(useLayoutTimelinePreviewStore.getState().mode).toBe("unavailable");
    expect(useLayoutTimelinePreviewStore.getState().activeFrame?.phaseId).toBe(PARTY_ID);
    expect(useLayoutTimelinePreviewStore.getState().transition).toBeNull();
    expect(screen.getByLabelText("Guests: 120")).toBeTruthy();
    expect(screen.getByLabelText("Seated capacity: Unavailable")).toBeTruthy();
    const staffing = screen.getByLabelText("Staffing: Not recorded");
    expect(staffing.getAttribute("aria-description")).toContain("No staffing headcount is asserted");
    expect(screen.queryByLabelText(/Staffing: \d/u)).toBeNull();
    expect(screen.getByLabelText("Revenue: Unavailable")).toBeTruthy();
  });

  it("uses a static replace when a direct keyframe click skips a real unavailable phase", async () => {
    const invalid = frame(PARTY_ID, "Speeches", 2, {
      state: "invalid",
      snapshotId: "abababab-abab-4bab-8bab-abababababab",
      snapshotStatus: "frozen",
      createdAt: "2026-07-17T10:00:00.000Z",
      frozenAt: "2026-07-17T10:05:00.000Z",
      reason: "payload_schema_invalid",
      message: "The speeches layout is invalid.",
    });
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, invalid, dinner]));
    renderBottom();
    await screen.findByRole("slider", { name: /scrub room layout/i });

    fireEvent.click(screen.getAllByRole(
      "button",
      { name: /Dinner service.*Frozen layout/i },
    )[0] ?? document.body);

    expect(useLayoutTimelinePreviewStore.getState().transition?.mode).toBe("cross-event-replace");
    expect(useLayoutTimelinePreviewStore.getState().transition?.itemTransitionPlan).toBeNull();
  });

  it("keeps an active room flip blank and locked when a blocker follows it", async () => {
    const earlierFlip = frame(FLIP_ID, "Room flip", 2, {
      state: "missing",
      reason: "room_flip_gap",
      message: "Operational room flip.",
    }, "room_flip");
    const invalidAfter = frame(PARTY_ID, "Inspection", 4, {
      state: "missing",
      reason: "no_snapshot",
      message: "No frozen inspection layout.",
    });
    const laterDinner = frame(
      DINNER_ID,
      "Dinner service",
      6,
      available(snapshotWith(2, 120), "ffffffff-ffff-4fff-8fff-ffffffffffff"),
    );
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([
      arrival,
      earlierFlip,
      invalidAfter,
      laterDinner,
    ]));
    renderBottom();
    const slider = await screen.findByRole("slider", { name: /scrub room layout/i });

    fireEvent.change(slider, {
      target: { value: String(Date.parse("2026-07-18T18:45:00.000Z")) },
    });

    expect(useLayoutTimelinePreviewStore.getState()).toMatchObject({
      mode: "unavailable",
      activeFrame: { phaseId: FLIP_ID },
      activeVenueRuntime: null,
      currentItems: [],
      captureItems: [],
      transition: null,
    });
    expect(isLayoutTimelineMutationLocked()).toBe(true);
    expect(useCockpitStore.getState().selectedPhaseId).toBe(FLIP_ID);
  });

  it("keeps spatial morph for a direct click across only a canonical room-flip gap", async () => {
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, roomFlip, dinner]));
    renderBottom();
    await screen.findByRole("slider", { name: /scrub room layout/i });
    expect(timelineRetargetSourceFrame(useLayoutTimelinePreviewStore.getState())?.phaseId)
      .toBe(ARRIVAL_ID);

    fireEvent.click(screen.getAllByRole(
      "button",
      { name: /Dinner service.*Frozen layout/i },
    )[0] ?? document.body);

    expect(useLayoutTimelinePreviewStore.getState().transition?.mode).toBe("same-event-morph");
    expect(useLayoutTimelinePreviewStore.getState().transition?.itemTransitionPlan).not.toBeNull();
    useLayoutTimelinePreviewStore.getState().setProgress(0.49);
    expect(timelineRetargetSourceFrame(useLayoutTimelinePreviewStore.getState())?.phaseId)
      .toBe(ARRIVAL_ID);
    useLayoutTimelinePreviewStore.getState().setProgress(0.5);
    expect(timelineRetargetSourceFrame(useLayoutTimelinePreviewStore.getState())?.phaseId)
      .toBe(DINNER_ID);
  });

  it("keeps real forward and reverse selections on the same cached physical endpoints", async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextRequest = 0;
    let now = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
      nextRequest += 1;
      callbacks.set(nextRequest, callback);
      return nextRequest;
    });
    vi.stubGlobal("cancelAnimationFrame", (_request: number): void => undefined);
    vi.spyOn(performance, "now").mockImplementation(() => now);
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, roomFlip, dinner]));
    renderBottom();
    await screen.findByRole("slider", { name: /scrub room layout/i });

    fireEvent.click(screen.getAllByRole(
      "button",
      { name: /Dinner service.*Frozen layout/i },
    )[0] ?? document.body);
    const forwardPlan = useLayoutTimelinePreviewStore.getState().transition?.itemTransitionPlan;
    if (forwardPlan === null || forwardPlan === undefined) {
      throw new Error("Expected a forward spatial transition plan");
    }
    const forwardRequest = nextRequest;
    now = 1_000;
    act(() => { callbacks.get(forwardRequest)?.(now); });

    fireEvent.click(screen.getAllByRole(
      "button",
      { name: /Guest arrival.*Frozen layout/i },
    )[0] ?? document.body);
    const reversePlan = useLayoutTimelinePreviewStore.getState().transition?.itemTransitionPlan;
    if (reversePlan === null || reversePlan === undefined) {
      throw new Error("Expected a reverse spatial transition plan");
    }

    expect(reversePlan.fromItems).toBe(forwardPlan.toItems);
    expect(reversePlan.toItems).toBe(forwardPlan.fromItems);
    const retained = timelineCaptureEndpointReuse(null, forwardPlan);
    const reused = timelineCaptureEndpointReuse(retained, reversePlan);
    expect(reused.physicalPlan).toBe(forwardPlan);
    expect(reused.activeFromUsesPhysicalTo).toBe(true);
    expect(reused.targetEndpoint).toBe("from");
  });

  it("does not spatially interpolate an active room flip across an earlier blocker", async () => {
    const invalid = frame(PARTY_ID, "Speeches", 2, {
      state: "invalid",
      snapshotId: "abababab-abab-4bab-8bab-abababababab",
      snapshotStatus: "frozen",
      createdAt: "2026-07-17T10:00:00.000Z",
      frozenAt: "2026-07-17T10:05:00.000Z",
      reason: "payload_schema_invalid",
      message: "The speeches layout is invalid.",
    });
    const laterFlip = frame(FLIP_ID, "Room flip", 4, {
      state: "missing",
      reason: "room_flip_gap",
      message: "Operational room flip.",
    }, "room_flip");
    const laterDinner = frame(
      DINNER_ID,
      "Dinner service",
      6,
      available(snapshotWith(2, 120), "ffffffff-ffff-4fff-8fff-ffffffffffff"),
    );
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([
      arrival,
      invalid,
      laterFlip,
      laterDinner,
    ]));
    renderBottom();
    const slider = await screen.findByRole("slider", { name: /scrub room layout/i });

    fireEvent.change(slider, {
      target: { value: String(Date.parse("2026-07-18T20:45:00.000Z")) },
    });

    expect(useLayoutTimelinePreviewStore.getState()).toMatchObject({
      mode: "unavailable",
      activeFrame: { phaseId: FLIP_ID },
      activeVenueRuntime: null,
      currentItems: [],
      captureItems: [],
      transition: null,
    });
    expect(isLayoutTimelineMutationLocked()).toBe(true);
    expect(useCockpitStore.getState().selectedPhaseId).toBe(FLIP_ID);
  });

  it("keeps slider, selection, figures, and preview state coherent in an overlap", async () => {
    const overlappingInvalidBase = frame(PARTY_ID, "Overlap inspection", 0.5, {
      state: "invalid",
      snapshotId: "abababab-abab-4bab-8bab-abababababab",
      snapshotStatus: "frozen",
      createdAt: "2026-07-17T10:00:00.000Z",
      frozenAt: "2026-07-17T10:05:00.000Z",
      reason: "payload_schema_invalid",
      message: "The overlapping inspection layout is invalid.",
    });
    const overlappingInvalid: RoomLayoutTimelineFrame = {
      ...overlappingInvalidBase,
      guestCount: 91,
      figures: {
        ...overlappingInvalidBase.figures,
        guests: { value: 91, source: "phase" },
      },
    };
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, overlappingInvalid]));
    renderBottom();
    const slider = await screen.findByRole("slider", { name: /scrub room layout/i });
    fireEvent.change(slider, { target: { value: String(Date.parse("2026-07-18T16:45:00.000Z")) } });

    expect(slider.getAttribute("aria-valuetext"))
      .toMatch(/17:45 · Elaine & James · Overlap inspection · Saved layout invalid/u);
    const overlappingCards = screen.getAllByRole(
      "button",
      { name: /Overlap inspection.*Saved layout invalid/i },
    );
    expect(overlappingCards.every((card) => card.getAttribute("aria-pressed") === "true")).toBe(true);
    expect(screen.getByLabelText("Guests: 91")).toBeTruthy();
    expect(useCockpitStore.getState().selectedPhaseId).toBe(PARTY_ID);
    expect(useLayoutTimelinePreviewStore.getState()).toMatchObject({
      mode: "unavailable",
      activeFrame: { phaseId: PARTY_ID },
      unavailableMessage: "The overlapping inspection layout is invalid.",
      currentItems: [],
    });
  });

  it("uses identity-free empty previews before and after the room schedule, with navigation recovery", async () => {
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, dinner]));
    renderBottom(undefined, [
      `/plan/cfg-1?timelineScope=day&timelineDate=2026-07-18&timelinePhaseId=${ARRIVAL_ID}`,
    ]);
    const slider = await screen.findByRole("slider", { name: /scrub room layout/i });

    fireEvent.change(slider, { target: { value: String(Date.parse("2026-07-18T15:30:00.000Z")) } });
    expect(slider.getAttribute("aria-valuetext")).toMatch(/16:30 · Schedule gap before Guest arrival/u);
    expect(useLayoutTimelinePreviewStore.getState()).toMatchObject({
      mode: "schedule-gap",
      activeFrame: null,
      currentItems: [],
    });
    expect(useCockpitStore.getState().selectedPhaseId).toBeNull();
    expect(screen.getByLabelText("Guests: —")).toBeTruthy();
    expect(screen.getByLabelText("Seated capacity: Unavailable")).toBeTruthy();
    expect(screen.getByLabelText("Staffing: —")).toBeTruthy();
    expect(screen.getByLabelText("Revenue: Unavailable")).toBeTruthy();
    expect(document.querySelectorAll('.layout-filmstrip__card[aria-pressed="true"]')).toHaveLength(0);
    await waitFor(() => {
      expect(screen.getByTestId("location-search").textContent).not.toContain("timelinePhaseId");
    });

    fireEvent.click(screen.getByRole("button", { name: "Next saved layout" }));
    await waitFor(() => { expect(useCockpitStore.getState().selectedPhaseId).toBe(ARRIVAL_ID); });

    fireEvent.change(slider, { target: { value: String(Date.parse("2026-07-18T22:00:00.000Z")) } });
    expect(slider.getAttribute("aria-valuetext")).toMatch(/23:00 · Schedule gap after Dinner service/u);
    expect(useLayoutTimelinePreviewStore.getState().activeFrame).toBeNull();
    expect(useCockpitStore.getState().selectedPhaseId).toBeNull();
    expect(screen.getByLabelText("Guests: —")).toBeTruthy();
    expect(document.querySelectorAll('.layout-filmstrip__card[aria-pressed="true"]')).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Previous saved layout" }));
    await waitFor(() => { expect(useCockpitStore.getState().selectedPhaseId).toBe(DINNER_ID); });
  });

  it("restores a locked empty schedule-gap preview after collapse and expand", async () => {
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, dinner]));
    renderBottom();
    const slider = await screen.findByRole("slider", { name: /scrub room layout/i });

    fireEvent.change(slider, { target: { value: String(Date.parse("2026-07-18T15:30:00.000Z")) } });
    expect(useLayoutTimelinePreviewStore.getState()).toMatchObject({
      mode: "schedule-gap",
      activeFrame: null,
      currentItems: [],
    });
    expect(isLayoutTimelineMutationLocked()).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Collapse room timeline" }));
    expect(useLayoutTimelinePreviewStore.getState().mode).toBe("inactive");
    expect(isLayoutTimelineMutationLocked()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Expand room timeline" }));
    expect(useLayoutTimelinePreviewStore.getState()).toMatchObject({
      mode: "schedule-gap",
      activeFrame: null,
      unavailableMessage: "No room phase is scheduled yet.",
      currentItems: [],
    });
    expect(useCockpitStore.getState().selectedPhaseId).toBeNull();
    expect(isLayoutTimelineMutationLocked()).toBe(true);
    expect(screen.getByLabelText("Guests: —")).toBeTruthy();
  });

  it("preserves preview identity continuously when the same dock crosses desktop and mobile shells", async () => {
    useCockpitStore.getState().selectPhase("phase-before-preview");
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, dinner]));

    function Surface({ name }: { readonly name: "desktop" | "mobile" }): ReactElement {
      return <div data-surface={name}><CockpitBottom /></div>;
    }

    const rendered = render(
      <MemoryRouter initialEntries={["/plan/cfg-1?timelineScope=day&timelineDate=2026-07-18"]}>
        <Surface name="desktop" />
      </MemoryRouter>,
    );
    await screen.findByRole("slider", { name: /scrub room layout/i });
    const dinnerCard = screen.getAllByRole("button", { name: /Dinner service.*Frozen layout/i }).at(-1);
    expect(dinnerCard).toBeDefined();
    if (dinnerCard === undefined) return;
    fireEvent.click(dinnerCard);
    await waitFor(() => {
      expect(useLayoutTimelinePreviewStore.getState().activeFrame?.phaseId).toBe(DINNER_ID);
    });
    expect(useCockpitStore.getState().selectedPhaseId).toBe(DINNER_ID);
    expect(isLayoutTimelineMutationLocked()).toBe(true);

    rendered.rerender(
      <MemoryRouter initialEntries={["/plan/cfg-1?timelineScope=day&timelineDate=2026-07-18"]}>
        <Surface name="mobile" />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(useLayoutTimelinePreviewStore.getState()).toMatchObject({
        mode: "keyframe",
        activeFrame: { phaseId: DINNER_ID },
      });
    });
    expect(useCockpitStore.getState().selectedPhaseId).toBe(DINNER_ID);
    expect(isLayoutTimelineMutationLocked()).toBe(true);
    expect(timelineApi.getRoomLayoutTimeline).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Exit preview" }));
    expect(useLayoutTimelinePreviewStore.getState().mode).toBe("inactive");
    expect(isLayoutTimelineMutationLocked()).toBe(false);
    expect(useCockpitStore.getState().selectedPhaseId).toBe("phase-before-preview");

    rendered.rerender(
      <MemoryRouter initialEntries={["/plan/cfg-1?timelineScope=day&timelineDate=2026-07-18"]}>
        <Surface name="desktop" />
      </MemoryRouter>,
    );
    expect(useLayoutTimelinePreviewStore.getState().mode).toBe("inactive");
    expect(isLayoutTimelineMutationLocked()).toBe(false);
    expect(useCockpitStore.getState().selectedPhaseId).toBe("phase-before-preview");
    expect(timelineApi.getRoomLayoutTimeline).toHaveBeenCalledTimes(1);
  });

  it("keeps an explicitly collapsed timeline inactive across a shell breakpoint", async () => {
    useCockpitStore.getState().selectPhase("phase-before-preview");
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, dinner]));

    function Surface({ mobile }: { readonly mobile: boolean }): ReactElement {
      return <div className={mobile ? "is-mobile" : "is-desktop"}><CockpitBottom /></div>;
    }

    const rendered = render(
      <MemoryRouter initialEntries={["/plan/cfg-1?timelineScope=day&timelineDate=2026-07-18"]}>
        <Surface mobile={false} />
      </MemoryRouter>,
    );
    await screen.findByRole("slider", { name: /scrub room layout/i });
    fireEvent.click(screen.getByRole("button", { name: "Collapse room timeline" }));
    expect(useLayoutTimelinePreviewStore.getState().mode).toBe("inactive");
    expect(isLayoutTimelineMutationLocked()).toBe(false);

    rendered.rerender(
      <MemoryRouter initialEntries={["/plan/cfg-1?timelineScope=day&timelineDate=2026-07-18"]}>
        <Surface mobile />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Expand room timeline" })).toBeTruthy();
    expect(useLayoutTimelinePreviewStore.getState().mode).toBe("inactive");
    expect(isLayoutTimelineMutationLocked()).toBe(false);
    expect(useCockpitStore.getState().selectedPhaseId).toBe("phase-before-preview");
  });

  it("returns to a long active phase after a nested later phase ends", async () => {
    const longArrival: RoomLayoutTimelineFrame = {
      ...arrival,
      endsAt: "2026-07-18T22:00:00.000Z",
    };
    const shortDinner = frame(
      DINNER_ID,
      "Short dinner",
      1,
      available(snapshotWith(2, 120), "ffffffff-ffff-4fff-8fff-ffffffffffff"),
    );
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([longArrival, shortDinner]));
    renderBottom();
    const slider = await screen.findByRole("slider", { name: /scrub room layout/i });
    fireEvent.change(slider, { target: { value: String(Date.parse("2026-07-18T19:00:00.000Z")) } });

    expect(slider.getAttribute("aria-valuetext"))
      .toMatch(/20:00 · Elaine & James · Guest arrival · Frozen layout/u);
    expect(useLayoutTimelinePreviewStore.getState().mode).toBe("keyframe");
    expect(useLayoutTimelinePreviewStore.getState().activeFrame?.phaseId).toBe(ARRIVAL_ID);
    expect(useCockpitStore.getState().selectedPhaseId).toBe(ARRIVAL_ID);
    expect(screen.getByLabelText("Guests: 100")).toBeTruthy();
  });

  it("renders restricted revenue as authorization-only copy without leaking commercial fields", async () => {
    const restrictedArrival: RoomLayoutTimelineFrame = {
      ...arrival,
      figures: {
        ...arrival.figures,
        revenue: {
          state: "restricted",
          reason: "insufficient_commercial_access",
        },
      },
    };
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([restrictedArrival, dinner]));
    renderBottom();

    const revenue = await screen.findByLabelText("Revenue: Restricted");
    expect(revenue.getAttribute("aria-description"))
      .toBe("Commercial access is required to view this planning estimate.");
    expect(document.body.textContent).not.toContain("Wedding planning scenario");
    expect(document.body.textContent).not.toContain("GBP");
    expect(document.body.textContent).not.toContain("£28,750");
  });

  it("selects the exact leading and trailing unavailable phases instead of an adjacent keyframe", async () => {
    const leading = frame(LEADING_ID, "Early setup", -2, {
      state: "missing",
      reason: "no_snapshot",
      message: "No frozen early setup layout.",
    });
    const trailing = frame(TRAILING_ID, "Late breakdown", 8, {
      state: "missing",
      reason: "no_snapshot",
      message: "No frozen late breakdown layout.",
    });
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([leading, arrival, dinner, trailing]));
    renderBottom();
    const slider = await screen.findByRole("slider", { name: /scrub room layout/i });

    fireEvent.change(slider, { target: { value: String(Date.parse("2026-07-18T14:30:00.000Z")) } });
    expect(useLayoutTimelinePreviewStore.getState().activeFrame?.phaseId).toBe(LEADING_ID);
    expect(useCockpitStore.getState().selectedPhaseId).toBe(LEADING_ID);
    expect(useLayoutTimelinePreviewStore.getState().unavailableMessage).toBe("No frozen early setup layout.");

    fireEvent.change(slider, { target: { value: String(Date.parse("2026-07-19T00:30:00.000Z")) } });
    expect(useLayoutTimelinePreviewStore.getState().activeFrame?.phaseId).toBe(TRAILING_ID);
    expect(useCockpitStore.getState().selectedPhaseId).toBe(TRAILING_ID);
    expect(useLayoutTimelinePreviewStore.getState().unavailableMessage).toBe("No frozen late breakdown layout.");
  });

  it("keeps the preview empty and mutation-locked while Day to Week reloads", async () => {
    const week = deferred<RoomLayoutTimelineResponse>();
    timelineApi.getRoomLayoutTimeline.mockImplementation(async (query) => {
      if ("scope" in query && query.scope === "week") return week.promise;
      return responseForQuery(query, [arrival, dinner]);
    });
    renderBottom();
    await screen.findByRole("slider", { name: /scrub room layout/i });

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(useLayoutTimelinePreviewStore.getState().mode).toBe("unavailable");
    expect(useLayoutTimelinePreviewStore.getState().activeFrame).toBeNull();
    expect(useLayoutTimelinePreviewStore.getState().currentItems).toEqual([]);
    expect(isLayoutTimelineMutationLocked()).toBe(true);
    expect(screen.getByRole("button", { name: "Exit preview" })).toBeTruthy();
    const before = useEditorStore.getState().objects;
    useEditorStore.getState().addObject("blocked-during-range-load", 0, 0, 0);
    expect(useEditorStore.getState().objects).toBe(before);

    act(() => {
      week.resolve(response([arrival, dinner], "week", "2026-07-18"));
    });
    await waitFor(() => {
      expect(useLayoutTimelinePreviewStore.getState().mode).toBe("keyframe");
    });
  });

  it("masks the prior room synchronously during a same-date venue and space switch", async () => {
    const next = deferred<RoomLayoutTimelineResponse>();
    const nextVenueId = "33333333-3333-4333-8333-333333333333";
    const nextSpaceId = "44444444-4444-4444-8444-444444444444";
    timelineApi.getRoomLayoutTimeline
      .mockResolvedValueOnce(response([arrival, dinner]))
      .mockImplementationOnce(() => next.promise);
    renderBottom();
    await screen.findByLabelText("Revenue: £28,750");
    expect(screen.getAllByText("Elaine & James").length).toBeGreaterThan(0);

    act(() => {
      useEditorStore.setState({ venueId: nextVenueId, spaceId: nextSpaceId });
    });
    expect(screen.queryByLabelText("Revenue: £28,750")).toBeNull();
    expect(screen.queryByText("Elaine & James")).toBeNull();
    expect(screen.getByText("Loading room timeline")).toBeTruthy();

    act(() => {
      next.resolve(response([], "day", "2026-07-18", nextVenueId, nextSpaceId));
    });
    await screen.findByText("No room phases this day");
  });

  it.each([
    ["logout", null],
    ["planner role downgrade", {
      id: "admin-user",
      email: "admin@venue.test",
      role: "planner",
      platformRole: "none" as const,
      venueId: VENUE_ID,
      name: "Venue Planner",
    }],
  ] as const)("masks commercial and event data synchronously on %s", async (_label, nextUser) => {
    useAuthStore.getState().setUser({
      id: "admin-user",
      email: "admin@venue.test",
      role: "admin",
      platformRole: "none",
      venueId: VENUE_ID,
      name: "Venue Admin",
    });
    timelineApi.getRoomLayoutTimeline
      .mockResolvedValueOnce(response([arrival, dinner]))
      .mockImplementationOnce(() => new Promise<RoomLayoutTimelineResponse>(() => undefined));
    renderBottom();
    await screen.findByLabelText("Revenue: £28,750");
    expect(screen.getAllByText("Elaine & James").length).toBeGreaterThan(0);

    act(() => {
      useAuthStore.getState().setUser(nextUser);
    });
    expect(screen.queryByLabelText("Revenue: £28,750")).toBeNull();
    expect(screen.queryByText("Elaine & James")).toBeNull();
    expect(screen.getByText("Loading room timeline")).toBeTruthy();
    await waitFor(() => { expect(timelineApi.getRoomLayoutTimeline).toHaveBeenCalledTimes(2); });
  });

  it("retries a previously unauthorized read when an anonymous user signs in", async () => {
    timelineApi.getRoomLayoutTimeline
      .mockRejectedValueOnce(new Error("Unauthorized"))
      .mockResolvedValueOnce(response([arrival, dinner]));
    renderBottom();
    await screen.findByText("Room timeline unavailable");

    act(() => {
      useAuthStore.getState().setUser({
        id: "admin-user",
        email: "admin@venue.test",
        role: "admin",
        platformRole: "none",
        venueId: VENUE_ID,
        name: "Venue Admin",
      });
    });

    expect(await screen.findByLabelText("Revenue: £28,750")).toBeTruthy();
    expect(timelineApi.getRoomLayoutTimeline).toHaveBeenCalledTimes(2);
  });

  it("hides freeze when the active frame belongs to another event", async () => {
    const charityParty: RoomLayoutTimelineFrame = {
      ...party,
      eventId: SECOND_EVENT_ID,
      eventName: "Charity Gala",
    };
    useAuthStore.getState().setUser({
      id: "staff-user",
      email: "staff@venue.test",
      role: "staff",
      platformRole: "none",
      venueId: VENUE_ID,
      name: "Venue Staff",
    });
    eventsApi.getEventPhaseGraph.mockResolvedValue(linkedEventGraph(START));
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, charityParty]));
    renderBottom(`/plan/cfg-1?eventId=${EVENT_ID}&timelineScope=day&timelineDate=2026-07-18`);

    await screen.findByRole("button", { name: "Exit preview" });
    fireEvent.click(screen.getByRole("button", { name: "Exit preview" }));
    expect(await screen.findByRole("button", { name: "Freeze current saved plan" })).toBeTruthy();
    const charityCard = (await screen.findAllByRole(
      "button",
      { name: /Charity Gala.*Evening party.*Frozen layout/i },
    )).at(-1);
    expect(charityCard).toBeDefined();
    if (charityCard === undefined) return;
    fireEvent.click(charityCard);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Freeze current saved plan" })).toBeNull();
    });
  });

  it("hides freeze when the linked phase belongs to another space", async () => {
    const wrongSpaceId = "45454545-4545-4545-8545-454545454545";
    const graph = linkedEventGraph(START, [ARRIVAL_ID, DINNER_ID]);
    useAuthStore.getState().setUser({
      id: "staff-user",
      email: "staff@venue.test",
      role: "staff",
      platformRole: "none",
      venueId: VENUE_ID,
      name: "Venue Staff",
    });
    eventsApi.getEventPhaseGraph.mockResolvedValue({
      ...graph,
      phases: graph.phases.map((phase) => (
        phase.id === ARRIVAL_ID ? { ...phase, spaceId: wrongSpaceId } : phase
      )),
    });
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, dinner]));
    renderBottom(`/plan/cfg-1?eventId=${EVENT_ID}&timelineScope=day&timelineDate=2026-07-18`);

    await screen.findByRole("button", { name: "Exit preview" });
    fireEvent.click(screen.getByRole("button", { name: "Exit preview" }));
    expect(screen.queryByRole("button", { name: "Freeze current saved plan" })).toBeNull();
  });

  it("re-enables superseding freeze when the saved configuration identity changes", async () => {
    const nextConfigurationId = "56565656-5656-4656-8656-565656565656";
    useAuthStore.getState().setUser({
      id: "staff-user",
      email: "staff@venue.test",
      role: "staff",
      platformRole: "none",
      venueId: VENUE_ID,
      name: "Venue Staff",
    });
    eventsApi.getEventPhaseGraph.mockResolvedValue(linkedEventGraph(START));
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, dinner]));
    const pendingFreeze = deferred<FreezePhaseLayoutSnapshotResponse>();
    timelineApi.freezePhaseLayoutSnapshot.mockImplementationOnce(() => pendingFreeze.promise);
    renderBottom(`/plan/cfg-1?eventId=${EVENT_ID}&timelineScope=day&timelineDate=2026-07-18`);

    await screen.findByRole("button", { name: "Exit preview" });
    fireEvent.click(screen.getByRole("button", { name: "Exit preview" }));
    const firstFreeze = await screen.findByRole("button", { name: "Freeze current saved plan" });
    fireEvent.click(firstFreeze);
    await waitFor(() => { expect(firstFreeze.hasAttribute("disabled")).toBe(true); });

    act(() => {
      useEditorStore.setState({ configId: nextConfigurationId });
    });
    const nextFreeze = screen.getByRole("button", { name: "Freeze current saved plan" });
    expect(nextFreeze).not.toBe(firstFreeze);
    expect(nextFreeze.hasAttribute("disabled")).toBe(false);
  });

  it("keeps Exit available through a range error and restores the pre-preview phase", async () => {
    useCockpitStore.getState().selectPhase("phase-before-preview");
    timelineApi.getRoomLayoutTimeline.mockImplementation((query) => {
      if ("scope" in query && query.scope === "week") return Promise.reject(new Error("offline"));
      return Promise.resolve(responseForQuery(query, [arrival, dinner]));
    });
    renderBottom();
    await screen.findByRole("slider", { name: /scrub room layout/i });

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    await screen.findByText("Room timeline unavailable");
    expect(isLayoutTimelineMutationLocked()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Exit preview" }));
    expect(isLayoutTimelineMutationLocked()).toBe(false);
    expect(useCockpitStore.getState().selectedPhaseId).toBe("phase-before-preview");
  });

  it("keeps Exit available when the new range has one phase, then restores and hides the dock", async () => {
    useCockpitStore.getState().selectPhase("phase-before-preview");
    timelineApi.getRoomLayoutTimeline.mockImplementation((query) => {
      if ("scope" in query && query.scope === "week") return Promise.resolve(responseForQuery(query, [arrival]));
      return Promise.resolve(responseForQuery(query, [arrival, dinner]));
    });
    renderBottom();
    await screen.findByRole("slider", { name: /scrub room layout/i });

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    await waitFor(() => {
      expect(useLayoutTimelinePreviewStore.getState().unavailableMessage)
        .toBe("Only one room phase is scheduled in this range.");
    });
    fireEvent.click(screen.getByRole("button", { name: "Exit preview" }));
    expect(isLayoutTimelineMutationLocked()).toBe(false);
    expect(useCockpitStore.getState().selectedPhaseId).toBe("phase-before-preview");
    await waitFor(() => { expect(screen.queryByTestId("cockpit-bottom")).toBeNull(); });
  });

  it("does not let Space on a focused control also toggle playback", async () => {
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, dinner]));
    renderBottom();
    await screen.findByRole("slider", { name: /scrub room layout/i });
    const week = screen.getByRole("button", { name: "Week" });
    week.focus();
    fireEvent.keyDown(week, { key: " ", code: "Space" });
    fireEvent.keyUp(week, { key: " ", code: "Space" });
    expect(screen.queryByRole("button", { name: /pause timeline/i })).toBeNull();

    const dock = screen.getByTestId("cockpit-bottom");
    fireEvent.pointerDown(dock);
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    fireEvent.keyUp(window, { key: " ", code: "Space" });
    expect(screen.getByRole("button", { name: /pause timeline/i })).toBeTruthy();
  });

  it("keeps one stable shortcut listener through immediate playback state changes", async () => {
    const addListener = vi.spyOn(window, "addEventListener");
    const removeListener = vi.spyOn(window, "removeEventListener");
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, dinner]));
    renderBottom();
    await screen.findByRole("slider", { name: /scrub room layout/i });

    const listenerCount = (spy: typeof addListener, eventName: string): number => (
      spy.mock.calls.filter(([registeredName]) => registeredName === eventName).length
    );
    const initialKeyDownAdds = listenerCount(addListener, "keydown");
    const initialKeyUpAdds = listenerCount(addListener, "keyup");
    const initialKeyDownRemovals = listenerCount(removeListener, "keydown");
    const initialKeyUpRemovals = listenerCount(removeListener, "keyup");
    const dock = screen.getByTestId("cockpit-bottom");
    fireEvent.pointerDown(dock);

    fireEvent.keyDown(window, { key: " ", code: "Space" });
    fireEvent.keyUp(window, { key: " ", code: "Space" });
    expect(screen.getByRole("button", { name: /pause timeline/i })).toBeTruthy();
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    fireEvent.keyUp(window, { key: " ", code: "Space" });
    expect(screen.getByRole("button", { name: /play full timeline/i })).toBeTruthy();

    expect(listenerCount(addListener, "keydown")).toBe(initialKeyDownAdds);
    expect(listenerCount(addListener, "keyup")).toBe(initialKeyUpAdds);
    expect(listenerCount(removeListener, "keydown")).toBe(initialKeyDownRemovals);
    expect(listenerCount(removeListener, "keyup")).toBe(initialKeyUpRemovals);
  });

  it("keeps playback honest across leading, invalid, and trailing intervals", async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextRequest = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
      nextRequest += 1;
      callbacks.set(nextRequest, callback);
      return nextRequest;
    });
    vi.stubGlobal("cancelAnimationFrame", (_request: number): void => undefined);
    vi.spyOn(performance, "now").mockReturnValue(0);
    const invalid = frame(PARTY_ID, "Speeches", 2, {
      state: "invalid",
      snapshotId: "abababab-abab-4bab-8bab-abababababab",
      snapshotStatus: "frozen",
      createdAt: "2026-07-17T10:00:00.000Z",
      frozenAt: "2026-07-17T10:05:00.000Z",
      reason: "payload_schema_invalid",
      message: "The speeches layout is invalid.",
    });
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, invalid, dinner]));
    renderBottom();
    await screen.findByRole("slider", { name: /scrub room layout/i });
    fireEvent.click(screen.getByRole("button", { name: /play full timeline/i }));

    expect(useLayoutTimelinePreviewStore.getState().mode).toBe("schedule-gap");
    act(() => { callbacks.get(nextRequest)?.(5_000); });
    expect(useLayoutTimelinePreviewStore.getState().mode).toBe("keyframe");
    expect(useLayoutTimelinePreviewStore.getState().activeFrame?.phaseId).toBe(ARRIVAL_ID);
    act(() => { callbacks.get(nextRequest)?.(9_375); });
    expect(useLayoutTimelinePreviewStore.getState().mode).toBe("unavailable");
    expect(useLayoutTimelinePreviewStore.getState().activeFrame?.phaseId).toBe(PARTY_ID);
    act(() => { callbacks.get(nextRequest)?.(17_500); });
    expect(useLayoutTimelinePreviewStore.getState().mode).toBe("schedule-gap");
    expect(useLayoutTimelinePreviewStore.getState().currentItems).toEqual([]);
  });

  it("starts an interrupted morph from the rendered items and ignores the stale RAF", async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextRequest = 0;
    let now = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
      nextRequest += 1;
      callbacks.set(nextRequest, callback);
      return nextRequest;
    });
    vi.stubGlobal("cancelAnimationFrame", (_request: number): void => undefined);
    vi.spyOn(performance, "now").mockImplementation(() => now);
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, dinner, party]));
    renderBottom();
    await screen.findByRole("slider", { name: /scrub room layout/i });

    fireEvent.click(screen.getAllByRole("button", { name: /dinner service.*frozen layout/i })[0] ?? document.body);
    const firstRequest = nextRequest;
    now = 240;
    act(() => { callbacks.get(firstRequest)?.(now); });
    const renderedBeforeInterrupt = useLayoutTimelinePreviewStore.getState().currentItems;

    fireEvent.click(screen.getAllByRole("button", { name: /evening party.*frozen layout/i })[0] ?? document.body);
    expect(useLayoutTimelinePreviewStore.getState().transition?.fromItems).toBe(renderedBeforeInterrupt);
    const secondRequest = nextRequest;
    expect(useLayoutTimelinePreviewStore.getState().transition?.toFrame.phaseId).toBe(PARTY_ID);
    act(() => { callbacks.get(firstRequest)?.(900); });
    expect(useLayoutTimelinePreviewStore.getState().transition?.toFrame.phaseId).toBe(PARTY_ID);
    now = 920;
    act(() => { callbacks.get(secondRequest)?.(now); });
    expect(useLayoutTimelinePreviewStore.getState().activeFrame?.phaseId).toBe(PARTY_ID);
  });

  it("hydrates scope, date, and phase again when browser history changes", async () => {
    timelineApi.getRoomLayoutTimeline.mockImplementation((query) =>
      Promise.resolve(responseForQuery(query, [arrival, dinner])),
    );
    renderBottom(undefined, [
      `/plan/cfg-1?timelineScope=day&timelineDate=2026-07-18&timelinePhaseId=${ARRIVAL_ID}`,
      `/plan/cfg-1?timelineScope=day&timelineDate=2026-07-19&timelinePhaseId=${DINNER_ID}`,
    ]);

    await waitFor(() => {
      expect(useLayoutTimelinePreviewStore.getState().activeFrame?.phaseId).toBe(DINNER_ID);
    });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect(timelineApi.getRoomLayoutTimeline.mock.calls.some(([query]) =>
        "scope" in query && query.anchorDate === "2026-07-18",
      )).toBe(true);
    });
    await waitFor(() => {
      expect(useLayoutTimelinePreviewStore.getState().activeFrame?.phaseId).toBe(ARRIVAL_ID);
    });
  });

  it("makes a same-day no-phase Back entry reload-equivalent", async () => {
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, dinner]));
    renderBottom(undefined, [
      "/plan/cfg-1?timelineScope=day&timelineDate=2026-07-18",
      `/plan/cfg-1?timelineScope=day&timelineDate=2026-07-18&timelinePhaseId=${DINNER_ID}`,
    ]);

    await waitFor(() => {
      expect(useLayoutTimelinePreviewStore.getState().activeFrame?.phaseId).toBe(DINNER_ID);
    });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect(useLayoutTimelinePreviewStore.getState().activeFrame?.phaseId).toBe(ARRIVAL_ID);
    });
    expect(useLayoutTimelinePreviewStore.getState().mode).toBe("keyframe");
  });

  it("keeps same-range refresh hydration aligned with the committed phase", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve("src/components/editor/cockpit/RoomLayoutTimelineDock.tsx"),
      "utf8",
    );
    const cursorSync = source.indexOf("requestedInitialPhaseIdRef.current = desiredPhaseId");
    const urlMatch = source.indexOf("const paramsMatch", cursorSync);
    expect(cursorSync).toBeGreaterThan(-1);
    expect(urlMatch).toBeGreaterThan(cursorSync);
  });

  it("falls back like reload when history requests an unknown same-day phase", async () => {
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, dinner]));
    renderBottom(undefined, [
      "/plan/cfg-1?timelineScope=day&timelineDate=2026-07-18&timelinePhaseId=unknown-phase",
      `/plan/cfg-1?timelineScope=day&timelineDate=2026-07-18&timelinePhaseId=${DINNER_ID}`,
    ]);

    await waitFor(() => {
      expect(useLayoutTimelinePreviewStore.getState().activeFrame?.phaseId).toBe(DINNER_ID);
    });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect(useLayoutTimelinePreviewStore.getState().activeFrame?.phaseId).toBe(ARRIVAL_ID);
    });
  });

  it("cancels an in-flight selection before Back hydrates its requested phase", async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextRequest = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
      nextRequest += 1;
      callbacks.set(nextRequest, callback);
      return nextRequest;
    });
    vi.stubGlobal("cancelAnimationFrame", (_request: number): void => undefined);
    vi.spyOn(performance, "now").mockReturnValue(0);
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, dinner, party]));
    renderBottom(undefined, [
      `/plan/cfg-1?timelineScope=day&timelineDate=2026-07-18&timelinePhaseId=${ARRIVAL_ID}`,
      `/plan/cfg-1?timelineScope=day&timelineDate=2026-07-18&timelinePhaseId=${DINNER_ID}`,
    ]);

    await waitFor(() => {
      expect(useLayoutTimelinePreviewStore.getState().activeFrame?.phaseId).toBe(DINNER_ID);
    });
    fireEvent.click(screen.getAllByRole(
      "button",
      { name: /evening party.*frozen layout/i },
    )[0] ?? document.body);
    const staleRequest = nextRequest;
    expect(useLayoutTimelinePreviewStore.getState().transition?.toFrame.phaseId).toBe(PARTY_ID);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect(useLayoutTimelinePreviewStore.getState().activeFrame?.phaseId).toBe(ARRIVAL_ID);
    });
    expect(useLayoutTimelinePreviewStore.getState().mode).toBe("keyframe");

    act(() => { callbacks.get(staleRequest)?.(900); });
    expect(useLayoutTimelinePreviewStore.getState().activeFrame?.phaseId).toBe(ARRIVAL_ID);
    expect(useLayoutTimelinePreviewStore.getState().mode).toBe("keyframe");
  });

  it("does not let linked-event auto-anchor overwrite an explicit persisted date", async () => {
    eventsApi.getEventPhaseGraph.mockResolvedValue(linkedEventGraph("2026-06-14T16:00:00.000Z"));
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([]));
    renderBottom(`/plan/cfg-1?eventId=${EVENT_ID}&timelineScope=day&timelineDate=2026-07-18`);

    await waitFor(() => {
      expect(timelineApi.getRoomLayoutTimeline).toHaveBeenCalled();
    });
    expect(timelineApi.getRoomLayoutTimeline.mock.calls.every(([query]) =>
      "scope" in query && query.anchorDate === "2026-07-18",
    )).toBe(true);
  });

  it("recomputes an automatic venue-local anchor when an explicit date is removed from the URL", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-07-18T12:00:00.000Z"));
    timelineApi.getRoomLayoutTimeline.mockImplementation((query) =>
      Promise.resolve(responseForQuery(query, [])),
    );
    renderBottom(undefined, ["/plan/cfg-1?timelineScope=day&timelineDate=2026-06-01"]);

    await waitFor(() => {
      expect(timelineApi.getRoomLayoutTimeline.mock.calls.map(([query]) => query))
        .toContainEqual(expect.objectContaining({ anchorDate: "2026-06-01" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear timeline date" }));
    await waitFor(() => {
      expect(timelineApi.getRoomLayoutTimeline.mock.calls.map(([query]) => query))
        .toContainEqual(expect.objectContaining({ anchorDate: "2026-07-18" }));
    });
  });

  it("reconciles an automatic anchor again after the selected room changes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-07-18T04:30:00.000Z"));
    const nextVenueId = "56565656-5656-4656-8656-565656565656";
    const nextSpaceId = "67676767-6767-4676-8676-676767676767";
    timelineApi.getRoomLayoutTimeline.mockImplementation((query) => Promise.resolve(
      responseForQueryInZone(
        query,
        [],
        query.venueId === nextVenueId ? "America/Los_Angeles" : "Europe/London",
      ),
    ));
    renderBottom("/plan/cfg-1?timelineScope=day");

    await waitFor(() => {
      expect(timelineApi.getRoomLayoutTimeline.mock.calls.map(([query]) => query))
        .toContainEqual(expect.objectContaining({
          venueId: VENUE_ID,
          spaceId: SPACE_ID,
          anchorDate: "2026-07-18",
        }));
    });
    act(() => {
      useEditorStore.setState({ venueId: nextVenueId, spaceId: nextSpaceId });
    });
    await waitFor(() => {
      expect(timelineApi.getRoomLayoutTimeline.mock.calls.map(([query]) => query))
        .toContainEqual(expect.objectContaining({
          venueId: nextVenueId,
          spaceId: nextSpaceId,
          anchorDate: "2026-07-17",
        }));
    });
  });

  it("rejects impossible deep-link calendar dates without rolling them forward", async () => {
    expect(isValidTimelineDeepLinkDate("2028-02-29")).toBe(true);
    expect(isValidTimelineDeepLinkDate("2026-02-29")).toBe(false);
    expect(isValidTimelineDeepLinkDate("2026-04-31")).toBe(false);
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-07-18T12:00:00.000Z"));
    timelineApi.getRoomLayoutTimeline.mockImplementation((query) =>
      Promise.resolve(responseForQuery(query, [])),
    );
    renderBottom("/plan/cfg-1?timelineScope=day&timelineDate=2026-02-30");

    await waitFor(() => { expect(timelineApi.getRoomLayoutTimeline).toHaveBeenCalled(); });
    expect(timelineApi.getRoomLayoutTimeline.mock.calls.map(([query]) => query))
      .not.toContainEqual(expect.objectContaining({ anchorDate: "2026-02-30" }));
    expect(timelineApi.getRoomLayoutTimeline.mock.calls.map(([query]) => query))
      .toContainEqual(expect.objectContaining({ anchorDate: "2026-07-18" }));
  });

  it("uses civil Monday for an early-Monday Week load and scope switch", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-07-20T00:30:00.000Z"));
    timelineApi.getRoomLayoutTimeline.mockImplementation((query) =>
      Promise.resolve(responseForQuery(query, [arrival, dinner])),
    );
    const first = renderBottom("/plan/cfg-1?timelineScope=week");
    await waitFor(() => {
      expect(timelineApi.getRoomLayoutTimeline.mock.calls.map(([query]) => query))
        .toContainEqual(expect.objectContaining({ scope: "week", anchorDate: "2026-07-20" }));
    });
    first.unmount();
    vi.clearAllMocks();
    useLayoutTimelinePreviewStore.getState().clear();
    useCockpitStore.getState().reset();
    useEditorStore.setState({ venueId: VENUE_ID, spaceId: SPACE_ID });
    timelineApi.getRoomLayoutTimeline.mockImplementation((query) =>
      Promise.resolve(responseForQuery(query, [arrival, dinner])),
    );

    renderBottom("/plan/cfg-1?timelineScope=day");
    await waitFor(() => {
      expect(timelineApi.getRoomLayoutTimeline.mock.calls.map(([query]) => query))
        .toContainEqual(expect.objectContaining({ scope: "day", anchorDate: "2026-07-19" }));
    });
    await screen.findByRole("slider", { name: /scrub room layout/i });
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    await waitFor(() => {
      expect(timelineApi.getRoomLayoutTimeline.mock.calls.map(([query]) => query))
        .toContainEqual(expect.objectContaining({ scope: "week", anchorDate: "2026-07-20" }));
    });
  });

  it("preserves an explicit date reached through history while changing linked-event scope", async () => {
    eventsApi.getEventPhaseGraph.mockResolvedValue(linkedEventGraph("2026-06-14T16:00:00.000Z"));
    timelineApi.getRoomLayoutTimeline.mockImplementation((query) =>
      Promise.resolve(responseForQuery(query, [arrival, dinner])),
    );
    renderBottom(undefined, [
      `/plan/cfg-1?eventId=${EVENT_ID}&timelineScope=day&timelineDate=2026-07-18&timelinePhaseId=${ARRIVAL_ID}`,
      `/plan/cfg-1?eventId=${EVENT_ID}&timelineScope=week`,
    ]);

    await screen.findByRole("slider", { name: /scrub room layout/i });
    await waitFor(() => {
      expect(screen.getByTestId("location-search").textContent).toContain("timelineDate=2026-06-14");
    });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect(screen.getByTestId("location-search").textContent).toContain("timelineScope=day");
    });
    await waitFor(() => {
      expect(timelineApi.getRoomLayoutTimeline.mock.calls.map(([query]) => query))
        .toContainEqual(expect.objectContaining({ scope: "day", anchorDate: "2026-07-18" }));
    });
    const lastQuery = timelineApi.getRoomLayoutTimeline.mock.calls.at(-1)?.[0];
    expect(lastQuery).toMatchObject({ scope: "day", anchorDate: "2026-07-18" });
  });

  it("bounds mounted canonical previews while every frame card remains navigable", async () => {
    const animationCallbacks = new Map<number, FrameRequestCallback>();
    let nextAnimationId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
      nextAnimationId += 1;
      animationCallbacks.set(nextAnimationId, callback);
      return nextAnimationId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
      animationCallbacks.delete(id);
    });
    vi.spyOn(performance, "now").mockReturnValue(0);
    const frames = Array.from({ length: 20 }, (_, index) => frame(
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      `Phase ${String(index + 1)}`,
      index,
      available(
        snapshotWith(index, 100 + index),
        `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      ),
    ));
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response(frames));
    renderBottom();
    await screen.findByRole("slider", { name: /scrub room layout/i });

    expect(document.querySelectorAll(".layout-filmstrip__card")).toHaveLength(20);
    expect(document.querySelectorAll(".layout-filmstrip__image").length)
      .toBeLessThanOrEqual(MAX_MOUNTED_TIMELINE_THUMBNAILS);
    const mountedFrameIndices = (): readonly string[] => Array.from(
      document.querySelectorAll<HTMLElement>(".layout-filmstrip__item"),
    ).filter((itemNode) => itemNode.querySelector(".layout-filmstrip__image") !== null)
      .map((itemNode) => itemNode.dataset["frameIndex"] ?? "missing");
    const beforeMidpoint = mountedFrameIndices();
    fireEvent.click(screen.getAllByRole(
      "button",
      { name: /Phase 11.*Frozen layout/i },
    )[0] ?? document.body);
    const selectionAnimationId = nextAnimationId;
    act(() => { animationCallbacks.get(selectionAnimationId)?.(400); });
    expect(useLayoutTimelinePreviewStore.getState().mode).toBe("transition");
    expect(mountedFrameIndices()).toEqual(beforeMidpoint);
    expect(Array.from({ length: 20 }, (_, index) => shouldMountTimelineThumbnail(index, 10))
      .filter(Boolean)).toHaveLength(MAX_MOUNTED_TIMELINE_THUMBNAILS);
  });
});
