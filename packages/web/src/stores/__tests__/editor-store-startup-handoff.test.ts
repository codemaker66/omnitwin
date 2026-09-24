import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Configuration } from "../../api/configurations.js";
import type { Space } from "../../api/spaces.js";
import { handOffPublicConfiguration, prefetchPlannerSpace, useEditorStore } from "../editor-store.js";
import { useActionLogStore } from "../action-log-store.js";

vi.mock("../../api/configurations.js", () => ({
  getConfig: vi.fn(), getPublicConfig: vi.fn(), createPublicConfig: vi.fn(),
  authBatchSave: vi.fn(), publicBatchSave: vi.fn(), parseRevisionConflict: vi.fn(() => null),
}));
vi.mock("../../api/spaces.js", () => ({ getSpace: vi.fn() }));
vi.mock("../../api/action-log.js", () => ({
  postActionBatch: vi.fn(() => Promise.resolve({ accepted: 0, duplicates: 0 })),
}));
const configApi = vi.mocked(await import("../../api/configurations.js"));
const spacesApi = vi.mocked(await import("../../api/spaces.js"));

function configuration(id: string, extra: Partial<Configuration> = {}): Configuration {
  return {
    id, revision: 4, spaceId: "room-1", venueId: "venue", userId: null, name: id, isPublicPreview: true,
    updatedAt: "2026-09-20T10:30:00.000Z",
    objects: [{ id: `${id}-object`, configurationId: id, assetDefinitionId: "round-table-6ft", positionX: "1", positionY: "0",
      positionZ: "2", rotationX: "0", rotationY: "0.5", rotationZ: "0", scale: "1", sortOrder: 0, metadata: { notes: "By the door" } }],
    ...extra,
  };
}
function space(id: string): Space {
  return { id, venueId: "venue", name: id, slug: id, widthM: "10", lengthM: "20", heightM: "6", floorPlanOutline: [] };
}
function store(): ReturnType<typeof useEditorStore.getState> { return useEditorStore.getState(); }

/** The document-level state a load commits; excludes the history/session internals. */
function committed(): Record<string, unknown> {
  const s = store();
  return {
    configId: s.configId, spaceId: s.spaceId, venueId: s.venueId, configRevision: s.configRevision,
    isPublicPreview: s.isPublicPreview, objects: s.objects, isDirty: s.isDirty, isLoading: s.isLoading,
    error: s.error, saveError: s.saveError, lastSavedAt: s.lastSavedAt, space: s.space,
    actionLogConfig: useActionLogStore.getState().configId,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  store().reset();
  useActionLogStore.getState().reset();
  configApi.parseRevisionConflict.mockReturnValue(null);
  spacesApi.getSpace.mockImplementation((_venue, id) => Promise.resolve(space(id)));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("public configuration handoff", () => {
  it("commits exactly what reading the same draft would, without reading it again", async () => {
    configApi.getPublicConfig.mockResolvedValueOnce(configuration("A"));
    await store().loadConfiguration("A", false);
    await vi.waitFor(() => { expect(store().space?.id).toBe("room-1"); });
    const fetched = committed();

    store().reset();
    useActionLogStore.getState().reset();
    handOffPublicConfiguration(configuration("A"));
    await store().loadConfiguration("A", false);
    await vi.waitFor(() => { expect(store().space?.id).toBe("room-1"); });

    expect(committed()).toEqual(fetched);
    expect(configApi.getPublicConfig).toHaveBeenCalledTimes(1);
  });

  it("is never used by an authenticated load, which also discards it", async () => {
    configApi.getConfig.mockResolvedValueOnce(configuration("A", { isPublicPreview: false, userId: "owner" }));
    configApi.getPublicConfig.mockResolvedValueOnce(configuration("A"));
    handOffPublicConfiguration(configuration("A"));
    await store().loadConfiguration("A", true);
    expect(configApi.getConfig).toHaveBeenCalledWith("A");
    expect(store().isPublicPreview).toBe(false);

    await store().loadConfiguration("A", false);
    expect(configApi.getPublicConfig).toHaveBeenCalledWith("A");
  });

  it("serves only the named configuration, and only the very next load", async () => {
    configApi.getPublicConfig.mockImplementation((id) => Promise.resolve(configuration(id, { revision: 9 })));
    handOffPublicConfiguration(configuration("A"));
    await store().loadConfiguration("B", false);
    expect(configApi.getPublicConfig).toHaveBeenCalledWith("B");

    await store().loadConfiguration("A", false);
    expect(configApi.getPublicConfig).toHaveBeenCalledWith("A");
    expect(store().configRevision).toBe(9);
  });

  it("expires after five seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-24T12:00:00.000Z"));
    configApi.getPublicConfig.mockResolvedValueOnce(configuration("A", { revision: 7 }));
    handOffPublicConfiguration(configuration("A"));
    vi.setSystemTime(new Date("2026-09-24T12:00:05.001Z"));
    await store().loadConfiguration("A", false);
    expect(configApi.getPublicConfig).toHaveBeenCalledWith("A");
    expect(store().configRevision).toBe(7);
  });

  it("never reaches a conflict reload, which reads the server again", async () => {
    handOffPublicConfiguration(configuration("A"));
    await store().loadConfiguration("A", false);
    expect(configApi.getPublicConfig).not.toHaveBeenCalled();

    configApi.getPublicConfig.mockResolvedValueOnce(configuration("A", { revision: 5 }));
    await store().reloadAfterConflict(false);
    expect(configApi.getPublicConfig).toHaveBeenCalledWith("A");
    expect(store().configRevision).toBe(5);
  });

  it("does not accept a claimed configuration", async () => {
    configApi.getPublicConfig.mockRejectedValueOnce(new Error("Public preview configuration not found"));
    handOffPublicConfiguration(configuration("A", { isPublicPreview: false, userId: "owner" }));
    await store().loadConfiguration("A", false);
    expect(configApi.getPublicConfig).toHaveBeenCalledWith("A");
    expect(store()).toMatchObject({ configId: null, error: "Public preview configuration not found" });
  });
});

describe("early room read", () => {
  it("is joined by the load's room read instead of repeated", async () => {
    prefetchPlannerSpace("venue", "room-1");
    handOffPublicConfiguration(configuration("A"));
    await store().loadConfiguration("A", false);
    await vi.waitFor(() => { expect(store().space?.id).toBe("room-1"); });
    expect(spacesApi.getSpace).toHaveBeenCalledTimes(1);
  });

  it("is retried by the load when it failed", async () => {
    spacesApi.getSpace.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(space("room-1"));
    prefetchPlannerSpace("venue", "room-1");
    handOffPublicConfiguration(configuration("A"));
    await store().loadConfiguration("A", false);
    await vi.waitFor(() => { expect(store().space?.id).toBe("room-1"); });
    expect(spacesApi.getSpace).toHaveBeenCalledTimes(2);
  });

  it("is not used for another room", async () => {
    prefetchPlannerSpace("venue", "room-2");
    handOffPublicConfiguration(configuration("A"));
    await store().loadConfiguration("A", false);
    await vi.waitFor(() => { expect(store().space?.id).toBe("room-1"); });
    expect(spacesApi.getSpace.mock.calls).toEqual([["venue", "room-2"], ["venue", "room-1"]]);
  });
});
