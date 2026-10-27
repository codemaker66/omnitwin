import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configApi from "../../api/configurations.js";
import type { PlacedObject } from "../../api/configurations.js";
import { ApiError } from "../../api/client.js";
import { signedInPlannerDraftKey } from "../../lib/anonymous-planner-draft.js";
import { undoLabel } from "../../lib/editor-history.js";
import { useAuthStore, type AuthUser } from "../auth-store.js";
import {
  LAYOUT_CHANGE_SAVE_MS,
  placedObjectToEditor,
  saveBeforeLayoutChange,
  useEditorStore,
  type EditorObject,
} from "../editor-store.js";

// ---------------------------------------------------------------------------
// Planner work that outlives the page or the layout it was made in (QoL D-01,
// D-X2, D-X3; release audit editor-save-2).
//
// D-01: work kept on this device comes back with a receipt (how many changes,
//   made when) and as ONE undo step, instead of silently with no history.
// D-X2: a save sent as the page closed may have landed although the page never
//   heard back; the kept copy then matches the server's newer revision, and
//   opening the layout must not call that a conflict.
// D-X3: opening another layout in the same page replaced the document while
//   its 3 s autosave was still waiting, so the outgoing layout's last edits
//   never left. The outgoing save now goes first, for up to 2 s; what does not
//   arrive stays on this device and the person is told so.
//
// The real draft storage, history and change summary run; only the network
// is replaced.
// ---------------------------------------------------------------------------

vi.mock("../../api/configurations.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/configurations.js")>();
  return {
    ...actual,
    getConfig: vi.fn(),
    getPublicConfig: vi.fn(),
    createPublicConfig: vi.fn(),
    authBatchSave: vi.fn(),
    publicBatchSave: vi.fn(),
  };
});

vi.mock("../../api/spaces.js", () => ({
  getSpace: vi.fn(async () => Promise.reject(new Error("no space in tests"))),
}));

vi.mock("../../api/action-log.js", () => ({
  postActionBatch: vi.fn(() => Promise.resolve({ accepted: 0, duplicates: 0 })),
}));

const GRAND_HALL_LAYOUT = "00000000-0000-4000-8000-00000000c0f1";
const SALOON_LAYOUT = "00000000-0000-4000-8000-00000000c0f2";
const GRAND_HALL = "00000000-0000-4000-8000-000000000051";
const SALOON = "00000000-0000-4000-8000-000000000052";
const VENUE = "00000000-0000-4000-8000-0000000000a1";
const ASSET = "9a6c1f3e-0000-4000-8000-0000000000aa";
const T1 = "00000000-0000-4000-8000-000000000001";
const T2 = "00000000-0000-4000-8000-000000000002";
const T3 = "00000000-0000-4000-8000-000000000003";
const T5 = "00000000-0000-4000-8000-000000000005";
const S1 = "00000000-0000-4000-8000-0000000000b1";

const ME: AuthUser = { id: "user-fiona", email: "planner@example.test", role: "planner", platformRole: "none", venueId: VENUE, name: "Fiona" };

function wire(id: string, positionX: number, configurationId = GRAND_HALL_LAYOUT): PlacedObject {
  return {
    id, configurationId, assetDefinitionId: ASSET,
    positionX: positionX.toFixed(3), positionY: "0.000", positionZ: "1.000",
    rotationX: "0.00000", rotationY: "0.00000", rotationZ: "0.00000", scale: "1.000", sortOrder: 0,
    metadata: null,
  };
}

function editor(id: string, positionX: number): EditorObject {
  return placedObjectToEditor(wire(id, positionX));
}

function grandHall(revision: number, objects: readonly PlacedObject[]): configApi.Configuration {
  return { id: GRAND_HALL_LAYOUT, spaceId: GRAND_HALL, venueId: VENUE, userId: ME.id, name: "Wedding breakfast",
    isPublicPreview: false, revision, objects: [...objects], updatedAt: "2026-10-27T20:00:00.000Z" };
}

function saloon(): configApi.Configuration {
  return { id: SALOON_LAYOUT, spaceId: SALOON, venueId: VENUE, userId: ME.id, name: "Drinks reception",
    isPublicPreview: false, revision: 4, objects: [wire(S1, 2, SALOON_LAYOUT)], updatedAt: "2026-10-27T19:00:00.000Z" };
}

const BASE_WIRE = [wire(T1, 1), wire(T2, 2), wire(T3, 3)];
const BASE = BASE_WIRE.map((row) => placedObjectToEditor(row));

function open(objects: readonly EditorObject[], isDirty: boolean, revision = 2): void {
  useEditorStore.setState({
    configId: GRAND_HALL_LAYOUT, spaceId: GRAND_HALL, venueId: VENUE, configRevision: revision,
    isPublicPreview: false, objects, baseObjects: BASE, isDirty, isSaving: false,
    saveError: null, saveConflict: null, history: { past: [], future: [] },
  });
}

function store() {
  return useEditorStore.getState();
}

function storedDraft(configId = GRAND_HALL_LAYOUT): { objects: EditorObject[]; baseRevision: number } | null {
  return JSON.parse(localStorage.getItem(signedInPlannerDraftKey(ME.id, configId)) ?? "null") as { objects: EditorObject[]; baseRevision: number } | null;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((settle, fail) => { resolve = settle; reject = fail; });
  return { promise, resolve, reject };
}

function setBrowserOnline(online: boolean): void {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

/** What the Grand Hall layout's save answers when it lands. */
function savedGrandHall(revision: number, objects: readonly PlacedObject[]): configApi.BatchSaveResponse {
  return { objects: [...objects], revision };
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.getState().setUser(ME);
  store().reset();
  useEditorStore.setState({ leftBehind: null });
  vi.mocked(configApi.getConfig).mockReset();
  vi.mocked(configApi.getPublicConfig).mockReset();
  vi.mocked(configApi.authBatchSave).mockReset();
  vi.mocked(configApi.publicBatchSave).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  setBrowserOnline(true);
  useAuthStore.getState().setUser(null);
  vi.restoreAllMocks();
});

describe("work kept on this device comes back with a receipt, as one undo step (D-01)", () => {
  it("says how many changes came back and when they were made", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T21:41:00.000Z"));
    open(BASE, false);
    store().updateObject(T1, { positionX: 10 });
    store().updateObject(T2, { positionX: 20 });
    expect(storedDraft()?.objects).toHaveLength(3);
    // The tab closes; a new page opens the layout a minute later.
    store().reset();
    vi.setSystemTime(new Date("2026-10-27T21:42:00.000Z"));
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(grandHall(2, BASE_WIRE));

    await store().loadConfiguration(GRAND_HALL_LAYOUT, true);

    expect(store()).toMatchObject({ isDirty: true, pendingChanges: 2, saveConflict: null });
    expect(store().restoredFromDevice).toEqual({ changes: 2, editedAt: new Date("2026-10-27T21:41:00.000Z") });
  });

  it("is one undo step back to the server's copy", async () => {
    open(BASE, false);
    store().updateObject(T1, { positionX: 10 });
    store().removeObject(T3);
    store().addObject(ASSET, 6, 0, 1);
    store().reset();
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(grandHall(2, BASE_WIRE));

    await store().loadConfiguration(GRAND_HALL_LAYOUT, true);
    expect(store().objects).toHaveLength(3);
    expect(store().history.past).toHaveLength(1);
    expect(undoLabel(store().history)).toBe("Restore changes kept on this device");

    store().undo();
    // Table 3 comes back as a new piece (the engine never revives a row id the
    // restored work removed), where it was; Table 1 goes back, the new one goes.
    expect(store().objects.map((object) => object.positionX)).toEqual(BASE.map((object) => object.positionX));
    expect(store().objects.slice(0, 2).map((object) => object.id)).toEqual([T1, T2]);
    expect(store().history.past).toHaveLength(0);

    store().redo();
    expect(store().objects.find((object) => object.id === T1)?.positionX).toBe(10);
    expect(store().objects.some((object) => object.id === T3)).toBe(false);
  });

  it("keeps the receipt while the restored work saves, and lets it go at the next change", async () => {
    open(BASE, false);
    store().updateObject(T1, { positionX: 10 });
    store().reset();
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(grandHall(2, BASE_WIRE));
    await store().loadConfiguration(GRAND_HALL_LAYOUT, true);
    expect(store().restoredFromDevice).not.toBeNull();

    vi.mocked(configApi.authBatchSave).mockResolvedValueOnce(savedGrandHall(3, [wire(T1, 10), wire(T2, 2), wire(T3, 3)]));
    expect(await store().saveToServer(true)).toBe(true);
    expect(store().isDirty).toBe(false);
    expect(store().restoredFromDevice).not.toBeNull();

    store().updateObject(T2, { positionX: 30 });
    expect(store().restoredFromDevice).toBeNull();
  });

  it("opens with no receipt when nothing was kept", async () => {
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(grandHall(2, BASE_WIRE));
    await store().loadConfiguration(GRAND_HALL_LAYOUT, true);
    expect(store().restoredFromDevice).toBeNull();
    expect(store().history.past).toHaveLength(0);
  });
});

describe("a kept copy the server already holds is not a conflict (D-X2)", () => {
  it("opens the server's newer revision clean when it holds exactly the kept work, new pieces included", async () => {
    open(BASE, false);
    store().updateObject(T1, { positionX: 10.0004 });
    store().addObject(ASSET, 6, 0, 1);
    expect(storedDraft()?.baseRevision).toBe(2);
    // The save sent as the page closed landed (revision 3, the new piece now a
    // row of its own), but the page was gone before it heard back.
    store().reset();
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(grandHall(3, [wire(T1, 10), wire(T2, 2), wire(T3, 3), wire(T5, 6)]));

    await store().loadConfiguration(GRAND_HALL_LAYOUT, true);

    expect(store()).toMatchObject({ configRevision: 3, isDirty: false, saveConflict: null, saveError: null, restoredFromDevice: null });
    expect(store().objects.map((object) => object.id)).toEqual([T1, T2, T3, T5]);
    expect(storedDraft()).toBeNull();
  });

  it("still raises the conflict when the newer revision differs from the kept work", async () => {
    open(BASE, false);
    store().updateObject(T1, { positionX: 10 });
    store().reset();
    // Someone else moved Table 2 instead; this person's move never arrived.
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(grandHall(3, [wire(T1, 1), wire(T2, 20), wire(T3, 3)]));

    await store().loadConfiguration(GRAND_HALL_LAYOUT, true);

    expect(store().saveConflict).toMatchObject({ expectedRevision: 2, currentRevision: 3 });
    expect(store().isDirty).toBe(true);
  });

  it("still raises it when the server lost a piece the kept work has", async () => {
    open(BASE, false);
    store().updateObject(T1, { positionX: 10 });
    store().reset();
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(grandHall(3, [wire(T1, 10), wire(T2, 2)]));

    await store().loadConfiguration(GRAND_HALL_LAYOUT, true);

    expect(store().saveConflict).not.toBeNull();
  });
});

describe("opening another layout sends the outgoing layout's work first (D-X3)", () => {
  it("sends one batch save for the outgoing layout before the next one applies", async () => {
    open(BASE, false);
    store().updateObject(T1, { positionX: 10 });
    const save = deferred<configApi.BatchSaveResponse>();
    const savedFrom: (string | null)[] = [];
    vi.mocked(configApi.authBatchSave).mockImplementation(() => {
      savedFrom.push(store().configId);
      return save.promise;
    });
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(saloon());

    const loading = store().loadConfiguration(SALOON_LAYOUT, true);
    await vi.waitFor(() => { expect(configApi.authBatchSave).toHaveBeenCalledTimes(1); });
    await Promise.resolve();
    // The Saloon's layout has arrived, but the Grand Hall's save has not.
    expect(store().configId).toBe(GRAND_HALL_LAYOUT);

    save.resolve(savedGrandHall(3, [wire(T1, 10), wire(T2, 2), wire(T3, 3)]));
    await loading;

    expect(savedFrom).toEqual([GRAND_HALL_LAYOUT]);
    expect(vi.mocked(configApi.authBatchSave).mock.calls[0]?.[0]).toBe(GRAND_HALL_LAYOUT);
    expect(vi.mocked(configApi.authBatchSave).mock.calls[0]?.[2]).toBe(2);
    expect(store().configId).toBe(SALOON_LAYOUT);
    expect(storedDraft()).toBeNull();
    expect(store().leftBehind).toBeNull();
  });

  it("waits for a save another flush started a moment before its own, instead of opening the next layout over it", async () => {
    open(BASE, false);
    store().updateObject(T1, { positionX: 10 });
    const save = deferred<configApi.BatchSaveResponse>();
    vi.mocked(configApi.authBatchSave).mockImplementation(() => save.promise);
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(saloon());

    // The route unmounting flushes one microtask ahead of the load's own save.
    const flushing = Promise.resolve().then(() => store().saveToServer(true));
    const loading = store().loadConfiguration(SALOON_LAYOUT, true);
    await vi.waitFor(() => { expect(configApi.authBatchSave).toHaveBeenCalledTimes(1); });
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(store().configId).toBe(GRAND_HALL_LAYOUT);

    save.resolve(savedGrandHall(3, [wire(T1, 10), wire(T2, 2), wire(T3, 3)]));
    await loading;
    expect(await flushing).toBe(true);
    expect(configApi.authBatchSave).toHaveBeenCalledTimes(1);
    expect(store().configId).toBe(SALOON_LAYOUT);
    expect(store().leftBehind).toBeNull();
    expect(storedDraft()).toBeNull();
  });

  it("opens the next layout when the save fails, keeping the outgoing work on this device and saying so", async () => {
    open(BASE, false);
    store().updateObject(T1, { positionX: 10 });
    vi.mocked(configApi.authBatchSave).mockRejectedValueOnce(new ApiError(500, "Server error", "INTERNAL"));
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(saloon());

    await store().loadConfiguration(SALOON_LAYOUT, true);

    expect(store().configId).toBe(SALOON_LAYOUT);
    expect(store().isDirty).toBe(false);
    expect(storedDraft()?.objects.find((object) => object.id === T1)?.positionX).toBe(10);
    expect(store().leftBehind).toEqual({ configId: GRAND_HALL_LAYOUT, roomName: null, kept: true, savesOnReturn: true });
  });

  it("waits no more than 2 s for a save that does not answer", async () => {
    vi.useFakeTimers();
    open(BASE, false);
    store().updateObject(T1, { positionX: 10 });
    vi.mocked(configApi.authBatchSave).mockImplementation(() => new Promise(() => undefined));
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(saloon());

    const loading = store().loadConfiguration(SALOON_LAYOUT, true);
    await vi.advanceTimersByTimeAsync(LAYOUT_CHANGE_SAVE_MS - 1);
    expect(store().configId).toBe(GRAND_HALL_LAYOUT);
    await vi.advanceTimersByTimeAsync(1);
    await loading;

    expect(store().configId).toBe(SALOON_LAYOUT);
    expect(store().leftBehind).toMatchObject({ configId: GRAND_HALL_LAYOUT, kept: true });
  });

  it("does not save a clean layout, or the same layout opened again", async () => {
    open(BASE, false);
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(saloon());
    await store().loadConfiguration(SALOON_LAYOUT, true);
    expect(configApi.authBatchSave).not.toHaveBeenCalled();

    store().updateObject(S1, { positionX: 5 });
    vi.mocked(configApi.getConfig).mockResolvedValueOnce({ ...saloon(), revision: 5 });
    await store().loadConfiguration(SALOON_LAYOUT, true);
    expect(configApi.authBatchSave).not.toHaveBeenCalled();
  });

  it("forgets the note once that layout is opened again, or at the next change here", async () => {
    open(BASE, false);
    store().updateObject(T1, { positionX: 10 });
    vi.mocked(configApi.authBatchSave).mockRejectedValue(new ApiError(500, "Server error", "INTERNAL"));
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(saloon());
    await store().loadConfiguration(SALOON_LAYOUT, true);
    expect(store().leftBehind).not.toBeNull();
    store().updateObject(S1, { positionX: 5 });
    expect(store().leftBehind).toBeNull();

    useEditorStore.setState({ leftBehind: { configId: GRAND_HALL_LAYOUT, roomName: "Grand Hall", kept: true, savesOnReturn: true } });
    vi.mocked(configApi.authBatchSave).mockReset();
    vi.mocked(configApi.authBatchSave).mockResolvedValueOnce({ objects: [wire(S1, 5, SALOON_LAYOUT)], revision: 5 });
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(grandHall(2, BASE_WIRE));
    await store().loadConfiguration(GRAND_HALL_LAYOUT, true);
    expect(store().leftBehind).toBeNull();
  });
});

describe("saveBeforeLayoutChange", () => {
  it("has nothing to do for a saved layout", async () => {
    open(BASE, false);
    expect(await saveBeforeLayoutChange()).toBe("saved");
    expect(configApi.authBatchSave).not.toHaveBeenCalled();
  });

  it("saves the open layout's work and reports it saved", async () => {
    open(BASE, false);
    store().updateObject(T1, { positionX: 10 });
    vi.mocked(configApi.authBatchSave).mockResolvedValueOnce(savedGrandHall(3, [wire(T1, 10), wire(T2, 2), wire(T3, 3)]));
    expect(await saveBeforeLayoutChange()).toBe("saved");
    expect(configApi.authBatchSave).toHaveBeenCalledTimes(1);
    expect(store().isDirty).toBe(false);
  });

  it("asks nothing of the server offline: the work stays on this device", async () => {
    open(BASE, false);
    store().updateObject(T1, { positionX: 10 });
    setBrowserOnline(false);
    expect(await saveBeforeLayoutChange()).toBe("kept");
    expect(configApi.authBatchSave).not.toHaveBeenCalled();
    expect(store().leftBehind).toEqual({ configId: GRAND_HALL_LAYOUT, roomName: null, kept: true, savesOnReturn: true });
  });

  it("says when the work is neither saved nor kept, and leaves the note to the caller", async () => {
    // Over the draft size cap (1,000 pieces) this device keeps no copy.
    const banquet = Array.from({ length: 1001 }, (_, index) => editor(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, index));
    open(banquet, false);
    store().updateObject(banquet[0]?.id ?? "", { positionX: 0.5 });
    expect(store().keptOnDevice).toBe(false);
    vi.mocked(configApi.authBatchSave).mockRejectedValueOnce(new ApiError(500, "Server error", "INTERNAL"));
    expect(await saveBeforeLayoutChange()).toBe("not-kept");
    expect(store().leftBehind).toBeNull();
  });

  it("does not try again for work it has just tried, when nothing has changed since", async () => {
    open(BASE, false);
    store().updateObject(T1, { positionX: 10 });
    vi.mocked(configApi.authBatchSave).mockRejectedValue(new ApiError(500, "Server error", "INTERNAL"));
    expect(await saveBeforeLayoutChange()).toBe("kept");
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(saloon());
    await store().loadConfiguration(SALOON_LAYOUT, true);
    expect(configApi.authBatchSave).toHaveBeenCalledTimes(1);
    expect(store().configId).toBe(SALOON_LAYOUT);
  });

  it("keeps its note through the room switch's reset", async () => {
    open(BASE, false);
    store().updateObject(T1, { positionX: 10 });
    setBrowserOnline(false);
    await saveBeforeLayoutChange();
    store().reset();
    expect(store().leftBehind).toMatchObject({ configId: GRAND_HALL_LAYOUT });
  });
});

describe("a save can be sent so it outlives the page", () => {
  it("asks the API for a keepalive request", async () => {
    open(BASE, false);
    store().updateObject(T1, { positionX: 10 });
    vi.mocked(configApi.authBatchSave).mockResolvedValueOnce(savedGrandHall(3, [wire(T1, 10), wire(T2, 2), wire(T3, 3)]));
    await store().saveToServer(true, { keepalive: true });
    expect(vi.mocked(configApi.authBatchSave).mock.calls[0]?.[3]).toEqual({ keepalive: true });
  });
});
