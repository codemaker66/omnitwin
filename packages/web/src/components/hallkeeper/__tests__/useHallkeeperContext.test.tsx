import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventDayOpsBoardSchema, EventPhaseGraphSchema, OpsHandoffPackBundleSchema, type EventDayOpsBoard } from "@omnitwin/types";
import { getConfig, type Configuration } from "../../../api/configurations.js";
import { getEventDayOpsBoard } from "../../../api/event-day-ops.js";
import { getEventPhaseGraph } from "../../../api/events.js";
import { getVenue, type VenueDetail } from "../../../api/spaces.js";
import { resolveEventLinkedLayouts } from "../../../lib/event-linked-layouts.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { useHallkeeperContext } from "../useHallkeeperContext.js";

vi.mock("../../../api/configurations.js", () => ({ getConfig: vi.fn() }));
vi.mock("../../../api/event-day-ops.js", () => ({ getEventDayOpsBoard: vi.fn() }));
vi.mock("../../../api/events.js", () => ({ getEventPhaseGraph: vi.fn() }));
vi.mock("../../../api/spaces.js", () => ({ getVenue: vi.fn() }));
vi.mock("../../../lib/event-linked-layouts.js", () => ({ resolveEventLinkedLayouts: vi.fn() }));

const CONFIG_A = "00000000-0000-4000-8000-000000000001";
const CONFIG_B = "00000000-0000-4000-8000-000000000002";
const VENUE_ID = "00000000-0000-4000-8000-000000000003";
const NORTH_ID = "00000000-0000-4000-8000-000000000004";
const SOUTH_ID = "00000000-0000-4000-8000-000000000005";
const EVENT_ID = "00000000-0000-4000-8000-000000000006";
const PHASE_ID = "00000000-0000-4000-8000-000000000007";
const PACK_ID = "00000000-0000-4000-8000-000000000008";
const NOW = "2026-09-07T12:30:00.000Z";

function config(id = CONFIG_A): Configuration {
  return { id, venueId: VENUE_ID, spaceId: id === CONFIG_A ? NORTH_ID : SOUTH_ID,
    name: id === CONFIG_A ? "North lunch" : "South reception", userId: null, isPublicPreview: false, revision: 1 };
}

const venue: VenueDetail = {
  id: VENUE_ID, name: "Test venue", slug: "test-venue", address: "Test address", logoUrl: null, brandColour: null,
  spaces: [
    { id: NORTH_ID, venueId: VENUE_ID, name: "North Gallery", slug: "north-gallery", widthM: "8", lengthM: "4", heightM: "3", floorPlanOutline: [] },
    { id: SOUTH_ID, venueId: VENUE_ID, name: "South Gallery", slug: "south-gallery", widthM: "8", lengthM: "4", heightM: "3", floorPlanOutline: [] },
  ],
};

function graph() {
  return EventPhaseGraphSchema.parse({
    event: { id: EVENT_ID, venueId: VENUE_ID, createdBy: null, name: "Gallery event", eventType: "reception", status: "in_planning",
      startsAt: NOW, endsAt: null, guestCount: 0, clientName: null, notes: null, createdAt: NOW, updatedAt: NOW },
    phases: [{ id: PHASE_ID, eventId: EVENT_ID, spaceId: NORTH_ID, templateKey: "arrival", name: "Organiser arrival", sortOrder: 0,
      startsAt: NOW, durationMinutes: 25, guestCount: null, opsTasksCount: 0, reviewGatesCount: 0,
      densityStatus: "not_checked", densityLabel: "Not checked", staffConflictsStatus: "not_checked", staffConflictsLabel: "Not checked",
      notes: null, createdAt: NOW, updatedAt: NOW }],
    scenarios: [], layoutVariants: [], configurationLinks: [], phaseLayoutSnapshots: [],
  });
}

function board(): EventDayOpsBoard {
  return EventDayOpsBoardSchema.parse({
    event: graph().event, phases: graph().phases, handoffPack: null, assignments: [], issues: [], statusUpdates: [],
    setupProgress: { totalTasks: 0, doneTasks: 0, blockedTasks: 0, activeTasks: 0, percent: 0 },
    supplierArrivals: [], escalationNotes: [],
    changesSinceLastHandoff: { handoffPackId: null, summary: "No handoff", added: [], removed: [], changed: [], currentSnapshotHash: null, previousSnapshotHash: null },
    sourceStatus: "missing_handoff",
  });
}

function packedBoard(configId = CONFIG_A): EventDayOpsBoard {
  return { ...board(), sourceStatus: "ready", handoffPack: OpsHandoffPackBundleSchema.parse({
    pack: { id: PACK_ID, eventId: EVENT_ID, configId, snapshotId: "00000000-0000-4000-8000-000000000009",
      snapshotHash: "a".repeat(64), version: 1, status: "compiled", sourceLabel: "Approved snapshot", summary: "Internal handoff.",
      createdBy: null, compiledAt: NOW, updatedAt: NOW },
    taskGroups: [], opsTasks: [],
    furniturePickList: { id: "00000000-0000-4000-8000-000000000010", handoffPackId: PACK_ID, title: "Pick list", totalItems: 0, createdAt: NOW },
    pickListItems: [], supplierInstructions: [], loadInSequence: [], breakdownSequence: [], roomFlipPlans: [],
    beoDocument: { id: "00000000-0000-4000-8000-000000000011", handoffPackId: PACK_ID, title: "Internal BEO", body: "Internal handoff.",
      sourceSnapshotHash: "a".repeat(64), safeStatus: "internal_operations_handoff", createdAt: NOW },
    snapshotDiff: { id: "00000000-0000-4000-8000-000000000012", handoffPackId: PACK_ID, previousSnapshotHash: null, currentSnapshotHash: "a".repeat(64),
      addedCount: 0, removedCount: 0, changedCount: 0, summary: "First snapshot.", payload: { added: [], removed: [], changed: [] }, createdAt: NOW },
  }) };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: (value: T) => void = () => { throw new Error("Deferred promise not initialized"); };
  const promise = new Promise<T>((resolve) => { settle = resolve; });
  return { promise, resolve: settle };
}

beforeEach(() => {
  vi.resetAllMocks();
  useAuthStore.getState().setUser({ id: "hallkeeper", email: "hallkeeper@example.test", name: "Hallkeeper", role: "hallkeeper", platformRole: "none", venueId: VENUE_ID });
  vi.mocked(getConfig).mockImplementation((id) => Promise.resolve(config(id)));
  vi.mocked(getVenue).mockResolvedValue(venue);
  vi.mocked(getEventPhaseGraph).mockResolvedValue(graph());
  vi.mocked(getEventDayOpsBoard).mockResolvedValue(board());
  vi.mocked(resolveEventLinkedLayouts).mockResolvedValue({ eventName: "Gallery event", roomName: null, unavailableCount: 0,
    layouts: [{ configurationId: CONFIG_A, name: "North lunch", spaceName: "North Gallery" }, { configurationId: CONFIG_B, name: "South reception", spaceName: "South Gallery" }] });
});

afterEach(() => { cleanup(); useAuthStore.getState().logout(); });

describe("useHallkeeperContext", () => {
  it("does not request context without a selected configuration", () => {
    const { result } = renderHook(() => useHallkeeperContext(null, EVENT_ID));
    expect(result.current.status).toBe("idle");
    expect(getConfig).not.toHaveBeenCalled();
  });

  it("resolves a real room without inventing event context when eventId is omitted", async () => {
    const { result } = renderHook(() => useHallkeeperContext(CONFIG_A));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(result.current.context?.room).toEqual({ id: NORTH_ID, name: "North Gallery", slug: "north-gallery" });
    expect(result.current.context?.graph).toBeNull();
    expect(result.current.context?.board).toBeNull();
    expect(getEventPhaseGraph).not.toHaveBeenCalled();
    expect(resolveEventLinkedLayouts).not.toHaveBeenCalled();
  });

  it("uses verified event membership and retains separate North and South Gallery identities", async () => {
    const { result } = renderHook(() => useHallkeeperContext(CONFIG_A, EVENT_ID));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(result.current.context?.graph?.phases[0]).toMatchObject({ startsAt: NOW, durationMinutes: 25, spaceId: NORTH_ID });
    expect(result.current.context?.layouts.map((layout) => [layout.spaceId, layout.spaceSlug])).toEqual([
      [NORTH_ID, "north-gallery"], [SOUTH_ID, "south-gallery"],
    ]);
    expect(resolveEventLinkedLayouts).toHaveBeenCalledWith(expect.objectContaining({ eventId: EVENT_ID, venueSlug: "test-venue", spaceSlug: null }));
  });

  it("rejects an arbitrary same-venue event when neither graph references nor handoff link the configuration", async () => {
    vi.mocked(resolveEventLinkedLayouts).mockResolvedValue({ eventName: "Gallery event", roomName: null, unavailableCount: 0, layouts: [] });
    const { result } = renderHook(() => useHallkeeperContext(CONFIG_A, EVENT_ID));
    await waitFor(() => { expect(result.current.status).toBe("error"); });
    expect(result.current.context).toBeNull();
    expect(result.current.error).toContain("has not been linked");
  });

  it("accepts the exact configuration-event handoff relation when a graph configuration link is absent", async () => {
    vi.mocked(resolveEventLinkedLayouts).mockResolvedValue({ eventName: "Gallery event", roomName: null, unavailableCount: 0, layouts: [] });
    vi.mocked(getEventDayOpsBoard).mockResolvedValue(packedBoard());
    const { result } = renderHook(() => useHallkeeperContext(CONFIG_A, EVENT_ID));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(result.current.context?.board?.handoffPack?.pack.configId).toBe(CONFIG_A);
    expect(result.current.context?.layouts).toHaveLength(1);
  });

  it("preserves a verified schedule when the optional operations board fails", async () => {
    vi.mocked(getEventDayOpsBoard).mockRejectedValue(new Error("Network unavailable"));
    const { result } = renderHook(() => useHallkeeperContext(CONFIG_A, EVENT_ID));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(result.current.context?.graph?.event.id).toBe(EVENT_ID);
    expect(result.current.context?.board).toBeNull();
    expect(result.current.context?.opsError).toContain("could not be loaded");
  });

  it("does not present another room's latest pack as this layout's tasks", async () => {
    vi.mocked(getEventDayOpsBoard).mockResolvedValue(packedBoard(CONFIG_B));
    const { result } = renderHook(() => useHallkeeperContext(CONFIG_A, EVENT_ID));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(result.current.context?.graph?.event.id).toBe(EVENT_ID);
    expect(result.current.context?.board).toBeNull();
    expect(result.current.context?.opsError).toContain("another layout");
  });

  it("rejects context when a phase references a room outside the verified venue", async () => {
    const invalid = graph();
    const firstPhase = invalid.phases[0];
    if (firstPhase === undefined) throw new Error("The fixture must have a phase");
    firstPhase.spaceId = "00000000-0000-4000-8000-000000000099";
    vi.mocked(getEventPhaseGraph).mockResolvedValue(invalid);
    const { result } = renderHook(() => useHallkeeperContext(CONFIG_A, EVENT_ID));
    await waitFor(() => { expect(result.current.status).toBe("error"); });
    expect(result.current.context).toBeNull();
  });

  it("ignores an old configuration response after the user selects a different room", async () => {
    const delayed = deferred<Configuration>();
    vi.mocked(getConfig).mockImplementationOnce(() => delayed.promise);
    const { result, rerender } = renderHook(({ id }) => useHallkeeperContext(id), { initialProps: { id: CONFIG_A } });
    rerender({ id: CONFIG_B });
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    expect(result.current.context?.room.id).toBe(SOUTH_ID);
    await act(async () => { delayed.resolve(config()); await delayed.promise; });
    expect(result.current.context?.configId).toBe(CONFIG_B);
    expect(result.current.context?.room.slug).toBe("south-gallery");
  });

  it("ignores an old event response after the event context is removed", async () => {
    const delayed = deferred<ReturnType<typeof graph>>();
    vi.mocked(getEventPhaseGraph).mockImplementationOnce(() => delayed.promise);
    const initialProps: { eventId: string | null } = { eventId: EVENT_ID };
    const { result, rerender } = renderHook(({ eventId }: { eventId: string | null }) => useHallkeeperContext(CONFIG_A, eventId), { initialProps });
    await waitFor(() => { expect(getEventPhaseGraph).toHaveBeenCalledOnce(); });
    rerender({ eventId: null });
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    await act(async () => { delayed.resolve(graph()); await delayed.promise; });
    expect(result.current.context?.room.id).toBe(NORTH_ID);
    expect(result.current.context?.graph).toBeNull();
  });

  it("masks previously loaded context immediately on an authorization change", async () => {
    const { result } = renderHook(() => useHallkeeperContext(CONFIG_A, EVENT_ID));
    await waitFor(() => { expect(result.current.status).toBe("ready"); });
    const blocked = deferred<Configuration>();
    vi.mocked(getConfig).mockImplementation(() => blocked.promise);
    act(() => { useAuthStore.getState().logout(); });
    expect(result.current.status).toBe("loading");
    expect(result.current.context).toBeNull();
  });
});
