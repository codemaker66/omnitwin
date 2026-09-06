import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchSaveResponse, Configuration, PlacedObject } from "../../api/configurations.js";
import type { Space } from "../../api/spaces.js";
import { useEditorStore } from "../editor-store.js";
import { useActionLogStore } from "../action-log-store.js";
import { useSelectionStore } from "../selection-store.js";
import { anonymousPlannerDraftKey } from "../../lib/anonymous-planner-draft.js";

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
const actionApi = vi.mocked(await import("../../api/action-log.js"));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function placed(configId: string): PlacedObject {
  return {
    id: `${configId}-object`, configurationId: configId, assetDefinitionId: "round-table-6ft",
    positionX: "1", positionY: "0", positionZ: "2", rotationX: "0", rotationY: "0", rotationZ: "0",
    scale: "1", sortOrder: 0, metadata: null,
  };
}
function configuration(id: string, revision = 1): Configuration {
  return {
    id, revision, spaceId: `${id}-room`, venueId: "venue", userId: null, name: id,
    isPublicPreview: true, updatedAt: "2026-09-04T10:30:00.000Z", objects: [placed(id)],
  };
}
function space(id: string): Space {
  return { id, venueId: "venue", name: id, slug: id, widthM: "10", lengthM: "20", heightM: "6", floorPlanOutline: [] };
}
function store(): ReturnType<typeof useEditorStore.getState> { return useEditorStore.getState(); }
async function open(id: string, revision = 1): Promise<void> {
  configApi.getPublicConfig.mockResolvedValueOnce(configuration(id, revision));
  await store().loadConfiguration(id);
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  store().reset();
  useActionLogStore.getState().reset();
  useSelectionStore.getState().clearSelection();
  configApi.parseRevisionConflict.mockReturnValue(null);
  spacesApi.getSpace.mockImplementation((_venue, id) => Promise.resolve(space(id)));
  actionApi.postActionBatch.mockResolvedValue({ accepted: 0, duplicates: 0 });
});

describe("configuration request ownership", () => {
  it("clears the previous configuration's save error and busy flag only after a new configuration commits", async () => {
    await open("A");
    useEditorStore.setState({ isSaving: true, saveError: "A failed", saveConflict: { expectedRevision: 1, currentRevision: 2, message: "A changed" } });
    const next = deferred<Configuration>();
    configApi.getPublicConfig.mockReturnValueOnce(next.promise);
    const opening = store().loadConfiguration("B");
    expect(store().saveError).toBe("A failed");
    next.resolve(configuration("B"));
    await opening;
    expect(store()).toMatchObject({ configId: "B", isSaving: false, saveError: null, saveConflict: null });
  });

  it("clears previous save state on successful public creation", async () => {
    await open("A");
    useEditorStore.setState({ isSaving: true, saveError: "A failed" });
    configApi.createPublicConfig.mockResolvedValueOnce(configuration("new"));
    await store().createPublicConfig("new-room");
    expect(store()).toMatchObject({ configId: "new", isSaving: false, saveError: null });
  });

  it("retains a newly created draft's recovery entry without opening it after another layout wins", async () => {
    const created = deferred<Configuration>();
    configApi.createPublicConfig.mockReturnValueOnce(created.promise);
    const creating = store().createPublicConfig("new-room");
    const cancelled = expect(creating).rejects.toThrow("different layout");
    await open("B", 4);
    const current = store();
    created.resolve(configuration("new"));
    await cancelled;
    expect(store()).toBe(current);
    expect(localStorage.getItem("omnitwin_my_configs")).toContain('"configId":"new"');
  });

  it("ignores an obsolete creation error without clearing a newer load's busy state", async () => {
    const created = deferred<Configuration>();
    const next = deferred<Configuration>();
    configApi.createPublicConfig.mockReturnValueOnce(created.promise);
    const creating = store().createPublicConfig("new-room");
    const failed = expect(creating).rejects.toThrow("creation failed");
    configApi.getPublicConfig.mockReturnValueOnce(next.promise);
    const opening = store().loadConfiguration("B");
    created.reject(new Error("creation failed"));
    await failed;
    expect(store()).toMatchObject({ isLoading: true, error: null });
    next.resolve(configuration("B"));
    await opening;
  });

  it.each(["success", "failure"] as const)("ignores an older load %s while the newest requested layout owns the state", async (outcome) => {
    const older = deferred<Configuration>();
    const newer = deferred<Configuration>();
    configApi.getPublicConfig.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const first = store().loadConfiguration("A");
    const second = store().loadConfiguration("B");
    if (outcome === "success") older.resolve(configuration("A"));
    else older.reject(new Error("old load failed"));
    await first;
    expect(store()).toMatchObject({ configId: null, isLoading: true, error: null });
    newer.resolve(configuration("B", 4));
    await second;
    expect(store()).toMatchObject({ configId: "B", configRevision: 4, isLoading: false, error: null });
    expect(useActionLogStore.getState().configId).toBe("B");
  });

  it("does not let an older A response replace a newly loaded A after A→B→A requests", async () => {
    const oldA = deferred<Configuration>();
    configApi.getPublicConfig.mockReturnValueOnce(oldA.promise);
    const first = store().loadConfiguration("A");
    await open("B");
    await open("A", 8);
    const current = store();
    oldA.resolve(configuration("A", 2));
    await first;
    expect(store()).toBe(current);
  });

  it("keeps a newer room response when the old configuration's room request completes late", async () => {
    const oldRoom = deferred<Space>();
    spacesApi.getSpace.mockReturnValueOnce(oldRoom.promise);
    await open("A");
    await open("B");
    oldRoom.resolve(space("A-room"));
    await oldRoom.promise;
    expect(store()).toMatchObject({ configId: "B", spaceId: "B-room", space: { id: "B-room" } });
  });

  it.each([
    [false, "success"], [false, "failure"], [false, "conflict"],
    [true, "success"], [true, "failure"], [true, "conflict"],
  ] as const)("ignores an old save after a configuration boundary (return to A: %s, outcome: %s)", async (returnToA, outcome) => {
      await open("A");
      const pending = deferred<BatchSaveResponse>();
      configApi.publicBatchSave.mockReturnValueOnce(pending.promise);
      const saving = store().saveToServer();
      await open("B", 5);
      if (returnToA) await open("A", 8);
      store().updateObject(store().objects[0]?.id ?? "missing", { positionX: 9 });
      useSelectionStore.getState().select(store().objects[0]?.id ?? "missing");
      const current = store();
      const selected = useSelectionStore.getState();
      const log = useActionLogStore.getState();
      if (outcome === "success") pending.resolve({ objects: [placed("A")], revision: 2 });
      else {
        if (outcome === "conflict") configApi.parseRevisionConflict.mockReturnValueOnce({ expectedRevision: 1, currentRevision: 3, message: "Old A conflict" });
        pending.reject(new Error(`Old A ${outcome}`));
      }
      expect(await saving).toBe(false);
      expect(store()).toBe(current);
      expect(useSelectionStore.getState()).toBe(selected);
      expect(useActionLogStore.getState()).toBe(log);
      configApi.parseRevisionConflict.mockReset().mockReturnValue(null);
  });

  it.each(["success", "failure"] as const)("allows B to save while A remains in flight without A's %s stopping B's save", async (outcome) => {
    await open("A");
    const pendingA = deferred<BatchSaveResponse>();
    configApi.publicBatchSave.mockReturnValueOnce(pendingA.promise);
    const savingA = store().saveToServer();
    await open("B", 5);
    const pendingB = deferred<BatchSaveResponse>();
    configApi.publicBatchSave.mockReturnValueOnce(pendingB.promise);
    const savingB = store().saveToServer();
    expect(configApi.publicBatchSave).toHaveBeenLastCalledWith("B", expect.any(Array), 5);
    if (outcome === "success") pendingA.resolve({ objects: [placed("A")], revision: 2 });
    else pendingA.reject(new Error("A failed"));
    expect(await savingA).toBe(false);
    expect(store()).toMatchObject({ configId: "B", isSaving: true, configRevision: 5 });
    pendingB.resolve({ objects: [placed("B")], revision: 6 });
    expect(await savingB).toBe(true);
    expect(store()).toMatchObject({ configId: "B", isSaving: false, isDirty: false, configRevision: 6 });
  });

  it("does not apply an obsolete public load after authenticated loading succeeds", async () => {
    const publicLoad = deferred<Configuration>();
    configApi.getPublicConfig.mockReturnValueOnce(publicLoad.promise);
    const oldLoad = store().loadConfiguration("A");
    configApi.getConfig.mockResolvedValueOnce({ ...configuration("A", 7), isPublicPreview: false, userId: "owner" });
    await store().loadConfiguration("A", true);
    publicLoad.resolve(configuration("A", 1));
    await oldLoad;
    expect(store()).toMatchObject({ configId: "A", configRevision: 7, isPublicPreview: false });
    configApi.authBatchSave.mockResolvedValueOnce({ objects: [placed("A")], revision: 8 });
    expect(await store().saveToServer()).toBe(true);
    expect(configApi.authBatchSave).toHaveBeenCalledWith("A", expect.any(Array), 7);
    expect(configApi.publicBatchSave).not.toHaveBeenCalled();
  });

  it("does not replace an acknowledged save with an older same-configuration load response", async () => {
    await open("A");
    store().updateObject("A-object", { positionX: 7 });
    const save = deferred<BatchSaveResponse>();
    configApi.publicBatchSave.mockReturnValueOnce(save.promise);
    const saving = store().saveToServer();
    const reload = deferred<Configuration>();
    configApi.getPublicConfig.mockReturnValueOnce(reload.promise);
    const loading = store().loadConfiguration("A");
    save.resolve({ objects: [{ ...placed("A"), positionX: "7" }], revision: 2 });
    expect(await saving).toBe(true);
    store().updateObject("A-object", { positionX: 9 });
    const current = store();
    reload.resolve(configuration("A", 1));
    await loading;
    expect(store()).toMatchObject({ configId: "A", configRevision: 2, isDirty: true, isLoading: false });
    expect(store().objects).toBe(current.objects);
    expect(store().history).toBe(current.history);
    expect(store().lastSavedAt).toBe(current.lastSavedAt);
  });

  it("does not flush B's action history against A's late authenticated save revision", async () => {
    configApi.getConfig.mockResolvedValueOnce({ ...configuration("A"), isPublicPreview: false, userId: "owner" });
    await store().loadConfiguration("A", true);
    store().updateObject("A-object", { positionX: 6 });
    const pending = deferred<BatchSaveResponse>();
    configApi.authBatchSave.mockReturnValueOnce(pending.promise);
    const saving = store().saveToServer(true);
    await open("B", 5);
    store().addObject("round-table-6ft", 4, 0, 2);
    store().bumpHistoryEpoch();
    store().updateObject("B-object", { positionX: 9 });
    expect(useActionLogStore.getState().entries.length).toBeGreaterThan(0);
    actionApi.postActionBatch.mockClear();
    const log = useActionLogStore.getState();
    pending.resolve({ objects: [placed("A")], revision: 2 });
    expect(await saving).toBe(false);
    expect(actionApi.postActionBatch).not.toHaveBeenCalled();
    expect(useActionLogStore.getState()).toBe(log);
  });

  it("keeps A's recoverable local draft and allows its own save to settle when B fails to load", async () => {
    await open("A");
    store().updateObject("A-object", { positionX: 9 });
    const draft = localStorage.getItem(anonymousPlannerDraftKey("A"));
    expect(draft).not.toBeNull();
    const pending = deferred<BatchSaveResponse>();
    configApi.publicBatchSave.mockReturnValueOnce(pending.promise);
    const saving = store().saveToServer();
    configApi.getPublicConfig.mockRejectedValueOnce(new Error("B unavailable"));
    await store().loadConfiguration("B");
    expect(store()).toMatchObject({ configId: "A", isDirty: true, isSaving: true });
    expect(localStorage.getItem(anonymousPlannerDraftKey("A"))).toBe(draft);
    pending.resolve({ objects: [placed("A")], revision: 2 });
    expect(await saving).toBe(true);
    expect(store()).toMatchObject({ configId: "A", configRevision: 2, isSaving: false });
  });

  it("reset invalidates outstanding loads and saves without reviving an old document", async () => {
    await open("A");
    const save = deferred<BatchSaveResponse>();
    configApi.publicBatchSave.mockReturnValueOnce(save.promise);
    const saving = store().saveToServer();
    const load = deferred<Configuration>();
    configApi.getPublicConfig.mockReturnValueOnce(load.promise);
    const loading = store().loadConfiguration("B");
    store().reset();
    const clean = store();
    save.resolve({ objects: [placed("A")], revision: 2 });
    load.resolve(configuration("B"));
    expect(await saving).toBe(false);
    await loading;
    expect(store()).toBe(clean);
  });
});
