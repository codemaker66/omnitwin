import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
  type CanonicalLayoutSnapshotV0,
  type EventPhaseGraph,
  type FreezePhaseLayoutSnapshotResponse,
  type RoomLayoutTimelineFrame,
  type RoomLayoutTimelineKeyframe,
  type RoomLayoutTimelineResponse,
} from "@omnitwin/types";

vi.mock("../../../../api/room-layout-timeline.js", () => ({
  getRoomLayoutTimeline: vi.fn(),
  freezePhaseLayoutSnapshot: vi.fn(),
}));
vi.mock("../../../../api/events.js", () => ({ getEventPhaseGraph: vi.fn() }));

const timelineApi = vi.mocked(await import("../../../../api/room-layout-timeline.js"));
const eventsApi = vi.mocked(await import("../../../../api/events.js"));
const { CockpitBottom } = await import("../CockpitBottom.js");
const { useCockpitStore } = await import("../../../../stores/cockpit-store.js");
const { useEditorStore } = await import("../../../../stores/editor-store.js");
const { useAuthStore } = await import("../../../../stores/auth-store.js");
const { useLayoutTimelinePreviewStore } = await import("../../../../stores/layout-timeline-preview-store.js");

const VENUE_ID = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueId;
const SPACE_ID = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.spaceId;
const START = "2026-07-18T16:00:00.000Z";
const CREATED_AT = "2026-07-17T10:00:00.000Z";

function linkedGraph(startsAt: string = START): EventPhaseGraph {
  return {
    event: {
      id: "11111111-1111-4111-8111-111111111111",
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
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
    phases: [{
      id: ARRIVAL_ID,
      eventId: "11111111-1111-4111-8111-111111111111",
      templateKey: null,
      name: "Guest arrival",
      sortOrder: 0,
      startsAt,
      durationMinutes: 90,
      guestCount: 100,
      opsTasksCount: 0,
      reviewGatesCount: 0,
      densityStatus: "not_checked",
      densityLabel: "Density not checked",
      staffConflictsStatus: "not_checked",
      staffConflictsLabel: "Staff conflicts not checked",
      notes: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    }],
    scenarios: [],
    layoutVariants: [],
    configurationLinks: [],
    phaseLayoutSnapshots: [],
  };
}

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
  id: string,
  snapshotStatus: "draft" | "frozen" | "stale" | "superseded" = "frozen",
): RoomLayoutTimelineKeyframe {
  return {
    state: "available",
    snapshotId: id,
    snapshotStatus,
    createdAt: "2026-07-17T10:00:00.000Z",
    frozenAt: "2026-07-17T10:05:00.000Z",
    objectCount: snapshot.objects.length,
    guestCount: snapshot.guestCount,
    payload: snapshot,
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
  const endsAt = new Date(startsAt.getTime() + 90 * 60_000);
  return {
    id,
    kind,
    eventId: "11111111-1111-4111-8111-111111111111",
    eventName: "Elaine & James",
    eventType: "wedding",
    eventStatus: "in_planning",
    eventGuestCount: 120,
    phaseId: id,
    phaseName,
    templateKey: null,
    sortOrder: startHour,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    guestCount: 120,
    opsTasksCount: 0,
    reviewGatesCount: 0,
    densityStatus: "not_checked",
    densityLabel: "Density not checked",
    staffConflictsStatus: "not_checked",
    staffConflictsLabel: "Staff conflicts not checked",
    keyframe,
  };
}

function response(frames: readonly RoomLayoutTimelineFrame[]): RoomLayoutTimelineResponse {
  return {
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    from: "2026-07-18T00:00:00.000Z",
    to: "2026-07-19T00:00:00.000Z",
    frames: [...frames],
  };
}

const ARRIVAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FLIP_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DINNER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const INVALID_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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
  available(snapshotWith(2, 120), "ffffffff-ffff-4fff-8fff-ffffffffffff", "draft"),
);

function renderBottom(url = "/plan/cfg-1"): void {
  render(<MemoryRouter initialEntries={[url]}><CockpitBottom /></MemoryRouter>);
}

const EVENT_DAY_FROM = "2026-07-18T03:00:00.000Z";
const EVENT_DAY_TO = "2026-07-19T03:00:00.000Z";

/**
 * The dock mounts anchored on today, then re-anchors to the linked event and
 * refetches its operational day. The refetch clears frames while it is in
 * flight, so both asserting and interacting before it settles race the second
 * load — and the fixture returns identical frames for every range, so the dock
 * looks correct while still anchored on the wrong day. Wait for the
 * re-anchored query AND for the frames it renders.
 */
async function waitForEventDayLoad(from: string, to: string): Promise<void> {
  await waitFor(() => {
    expect(timelineApi.getRoomLayoutTimeline.mock.calls.some(([query]) =>
      query.from === from && query.to === to,
    )).toBe(true);
  });
  await waitFor(() => {
    expect(document.querySelectorAll(".layout-phase").length).toBeGreaterThan(0);
  });
}

beforeEach(() => {
  useCockpitStore.getState().reset();
  useLayoutTimelinePreviewStore.getState().clear();
  useEditorStore.setState({
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    configId: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.configurationId,
    isDirty: false,
    isPublicPreview: false,
  });
  useAuthStore.setState({ isAuthenticated: true });
  eventsApi.getEventPhaseGraph.mockResolvedValue(linkedGraph());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useEditorStore.setState({ venueId: null, spaceId: null, configId: null });
  useAuthStore.setState({ isAuthenticated: false, user: null });
  useLayoutTimelinePreviewStore.getState().clear();
});

describe("CockpitBottom room layout timeline", () => {
  it("keeps the legacy no-event state as an honest fallback for an empty range", async () => {
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([]));
    renderBottom();

    expect(await screen.findByText("No event linked")).toBeTruthy();
    expect(screen.queryByRole("slider", { name: /scrub room layout/i })).toBeNull();
  });

  it("hides the entire dock when the loaded range has only one phase", async () => {
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival]));
    renderBottom("/plan/cfg-1?eventId=event-1");

    await waitFor(() => { expect(screen.queryByTestId("cockpit-bottom")).toBeNull(); });
    expect(screen.queryByRole("slider", { name: /scrub room layout/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /play full timeline/i })).toBeNull();
  });

  it("shows data-backed previews, honest gap cards, and immutable snapshot metrics", async () => {
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, roomFlip, dinner]));
    renderBottom("/plan/cfg-1?eventId=event-1");

    const slider = await screen.findByRole("slider", { name: /scrub room layout/i });
    expect(slider.getAttribute("min")).toBe(String(Date.parse("2026-07-18T15:00:00.000Z")));
    expect(slider.getAttribute("max")).toBe(String(Date.parse("2026-07-18T23:00:00.000Z")));
    await waitForEventDayLoad(EVENT_DAY_FROM, EVENT_DAY_TO);
    expect(screen.getByLabelText("Guests: 100")).toBeTruthy();
    expect(screen.getByLabelText("Objects: 2")).toBeTruthy();
    const arrivalPhase = screen.getAllByRole("button", { name: /guest arrival.*frozen layout/i })[0];
    expect(arrivalPhase).toBeDefined();
    const arrivalLeft = Number.parseFloat(arrivalPhase?.style.left ?? "0");
    const arrivalWidth = Number.parseFloat(arrivalPhase?.style.width ?? "0");
    expect(arrivalLeft).toBeGreaterThan(5);
    expect(arrivalLeft).toBeLessThan(25);
    expect(arrivalWidth).toBeGreaterThan(10);
    const phaseBlocks = [...document.querySelectorAll<HTMLElement>(".layout-phase")];
    expect(phaseBlocks.every((block) => {
      const left = Number.parseFloat(block.style.left);
      const width = Number.parseFloat(block.style.width);
      return left >= 0 && width > 0 && left + width <= 100.001;
    })).toBe(true);
    expect(document.querySelector(".layout-playback-controls")).not.toBeNull();
    expect(document.querySelector(".layout-filmstrip")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /dinner service.*draft layout/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /room flip.*room flip gap/i })[0]?.hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByRole("img", { name: /canonical plan preview/i })).toHaveLength(2);
    expect(useLayoutTimelinePreviewStore.getState().activeFrame).toBeNull();
    expect(screen.getByRole("slider", { name: /scrub room layout/i }).getAttribute("aria-valuetext"))
      .toMatch(/guest arrival.*frozen layout/i);
  });

  it("scrubs across a missing room-flip gap using the available layouts on both sides", async () => {
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, roomFlip, dinner]));
    renderBottom("/plan/cfg-1?eventId=event-1");
    await waitForEventDayLoad(EVENT_DAY_FROM, EVENT_DAY_TO);
    // Query the slider AFTER the settle. The re-anchor refetch unmounts the
    // dock's loaded body, so a node captured before it is detached and
    // fireEvent on it silently reaches no handler.
    const slider = screen.getByRole("slider", { name: /scrub room layout/i });

    fireEvent.change(slider, { target: { value: String(Date.parse("2026-07-18T18:00:00.000Z")) } });

    const transition = useLayoutTimelinePreviewStore.getState().transition;
    expect(transition?.fromFrame.phaseId).toBe(ARRIVAL_ID);
    expect(transition?.toFrame.phaseId).toBe(DINNER_ID);
    expect(transition?.progress).toBe(0.5);
    expect(useCockpitStore.getState().selectedPhaseId).toBe(DINNER_ID);
    expect(slider.getAttribute("aria-valuetext")).toMatch(/room flip.*room flip gap/i);
  });

  it("keeps a distinct 00:30–02:00 Breakdown phase in the preceding operational day", async () => {
    const eveningParty: RoomLayoutTimelineFrame = {
      ...arrival,
      id: "13131313-1313-4313-8313-131313131313",
      phaseId: "13131313-1313-4313-8313-131313131313",
      phaseName: "Evening party",
      startsAt: "2026-07-18T20:45:00.000Z",
      endsAt: "2026-07-18T23:30:00.000Z",
    };
    const breakdown: RoomLayoutTimelineFrame = {
      ...dinner,
      id: "14141414-1414-4414-8414-141414141414",
      phaseId: "14141414-1414-4414-8414-141414141414",
      phaseName: "Breakdown",
      startsAt: "2026-07-18T23:30:00.000Z",
      endsAt: "2026-07-19T01:00:00.000Z",
    };
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([eveningParty, breakdown]));
    renderBottom("/plan/cfg-1?eventId=event-1");

    expect((await screen.findAllByRole("button", { name: /breakdown.*draft layout/i })).length)
      .toBeGreaterThan(0);
    await waitForEventDayLoad(EVENT_DAY_FROM, EVENT_DAY_TO);
  });

  it("supports next-keyframe and Space playback shortcuts, plus collapse/expand", async () => {
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, roomFlip, dinner]));
    renderBottom("/plan/cfg-1?eventId=event-1");
    await screen.findByRole("slider", { name: /scrub room layout/i });
    await waitForEventDayLoad(EVENT_DAY_FROM, EVENT_DAY_TO);

    fireEvent.keyDown(window, { key: "]", code: "BracketRight" });
    expect(useCockpitStore.getState().selectedPhaseId).toBe(DINNER_ID);
    expect(useLayoutTimelinePreviewStore.getState().activeFrame).not.toBeNull();

    fireEvent.keyDown(window, { key: " ", code: "Space" });
    fireEvent.keyUp(window, { key: " ", code: "Space" });
    expect(screen.getByRole("button", { name: /pause timeline/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /collapse room timeline/i }));
    expect(useLayoutTimelinePreviewStore.getState().activeFrame).toBeNull();
    expect(screen.queryByRole("slider", { name: /scrub room layout/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /expand room timeline/i }));
    expect(screen.getByRole("slider", { name: /scrub room layout/i })).toBeTruthy();
  });

  it("keeps invalid keyframes visible and disabled instead of guessing a layout", async () => {
    const invalid = frame(INVALID_ID, "Speeches", 6, {
      state: "invalid",
      snapshotId: "12121212-1212-4212-8212-121212121212",
      snapshotStatus: "frozen",
      createdAt: "2026-07-17T10:00:00.000Z",
      frozenAt: "2026-07-17T10:05:00.000Z",
      reason: "payload_schema_invalid",
      message: "The saved snapshot payload is not canonical.",
    });
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, invalid]));
    renderBottom("/plan/cfg-1?eventId=event-1");
    await waitForEventDayLoad(EVENT_DAY_FROM, EVENT_DAY_TO);

    const invalidButtons = await screen.findAllByRole("button", { name: /speeches.*saved layout invalid/i });
    expect(invalidButtons.length).toBeGreaterThan(0);
    expect(invalidButtons.every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(screen.getByText("The saved snapshot payload is not canonical.")).toBeTruthy();
  });

  it("links the current saved plan to an eligible missing phase and refreshes the real timeline", async () => {
    const missing = frame("15151515-1515-4515-8515-151515151515", "Speeches", 6, {
      state: "missing",
      reason: "no_snapshot",
      message: "No saved layout for this phase.",
    });
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([arrival, missing]));
    const frozen: FreezePhaseLayoutSnapshotResponse = {
      outcome: "created",
      eventId: missing.eventId,
      phaseId: missing.phaseId,
      configurationId: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.configurationId,
      snapshotId: "16161616-1616-4616-8616-161616161616",
      canonicalSnapshotId: "17171717-1717-4717-8717-171717171717",
      snapshotHash: "a".repeat(64),
      proofDigest: "b".repeat(64),
      frozenBy: "18181818-1818-4818-8818-181818181818",
      status: "frozen",
      coordinateSpace: "real_m_v1",
      objectCount: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.objects.length,
      guestCount: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.guestCount,
      createdAt: "2026-07-18T12:00:00.000Z",
      frozenAt: "2026-07-18T12:00:00.000Z",
      supersedesSnapshotId: null,
    };
    timelineApi.freezePhaseLayoutSnapshot.mockResolvedValue(frozen);
    renderBottom("/plan/cfg-1?eventId=event-1");
    await waitForEventDayLoad(EVENT_DAY_FROM, EVENT_DAY_TO);

    const callsBeforeFreeze = timelineApi.getRoomLayoutTimeline.mock.calls.length;
    const action = screen.getByRole("button", { name: "Use current saved plan" });
    fireEvent.click(action);
    await waitFor(() => {
      expect(timelineApi.freezePhaseLayoutSnapshot).toHaveBeenCalledWith(
        { eventId: missing.eventId, phaseId: missing.phaseId },
        { configurationId: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.configurationId },
      );
    });
    // Must grow past the re-anchor's own refetch: a bare `>= 2` is already
    // satisfied before the click, so it would pass without any refresh.
    await waitFor(() => {
      expect(timelineApi.getRoomLayoutTimeline.mock.calls.length)
        .toBeGreaterThan(callsBeforeFreeze);
    });
  });

  it("switches to the week endpoint range and preserves DST-safe range queries", async () => {
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([]));
    renderBottom();
    await waitFor(() => { expect(timelineApi.getRoomLayoutTimeline).toHaveBeenCalledTimes(1); });

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    await waitFor(() => { expect(timelineApi.getRoomLayoutTimeline).toHaveBeenCalledTimes(2); });
    const secondQuery = timelineApi.getRoomLayoutTimeline.mock.calls[1]?.[0];
    expect(secondQuery).toBeDefined();
    if (secondQuery === undefined) return;
    const elapsed = Date.parse(secondQuery.to) - Date.parse(secondQuery.from);
    expect(elapsed).toBeGreaterThanOrEqual(6 * 24 * 60 * 60 * 1_000);
    expect(elapsed).toBeLessThanOrEqual(8 * 24 * 60 * 60 * 1_000);
  });

  it("anchors a linked event outside today and offers a jump-back affordance after browsing away", async () => {
    const eventStart = "2026-06-14T16:00:00.000Z";
    eventsApi.getEventPhaseGraph.mockResolvedValue(linkedGraph(eventStart));
    timelineApi.getRoomLayoutTimeline.mockResolvedValue(response([]));
    renderBottom("/plan/cfg-1?eventId=event-1");

    await waitFor(() => {
      expect(timelineApi.getRoomLayoutTimeline.mock.calls.some(([query]) =>
        Date.parse(query.from) <= Date.parse(eventStart) && Date.parse(query.to) > Date.parse(eventStart),
      )).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    await waitFor(() => {
      expect(timelineApi.getRoomLayoutTimeline.mock.calls.some(([query]) =>
        query.from === "2026-06-15T03:00:00.000Z"
          && query.to === "2026-06-16T03:00:00.000Z",
      )).toBe(true);
    });
    expect(await screen.findByRole("button", { name: "Jump to event" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Jump to event" }));
    await waitFor(() => { expect(screen.queryByRole("button", { name: "Jump to event" })).toBeNull(); });
  });
});
