import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configApi from "../../api/configurations.js";
import type { PlacedObject } from "../../api/configurations.js";
import { ApiError } from "../../api/client.js";
import { signedInPlannerDraftKey } from "../../lib/anonymous-planner-draft.js";
import { setLayoutTimelineMutationLock } from "../../lib/layout-timeline-preview-lock.js";
import { useAuthStore, type AuthUser } from "../auth-store.js";
import { placedObjectToEditor, useEditorStore, type EditorObject } from "../editor-store.js";

const reports = vi.hoisted(() => ({ reportFailure: vi.fn() }));
vi.mock("../../observability/failure-reports.js", () => reports);

// ---------------------------------------------------------------------------
// The save facts the slate states are written from (T-671 slice 7): counts,
// why a save did not land, offline, what is kept on this device, a newer
// revision's who/when/what, "Keep mine", "Show her version", view-only.
// The real 409 parser, draft storage and change summary run; only the
// network is replaced.
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

const CONFIG = "00000000-0000-4000-8000-00000000c0f1";
const SPACE = "00000000-0000-4000-8000-000000000051";
const VENUE = "00000000-0000-4000-8000-0000000000a1";
const ASSET = "9a6c1f3e-0000-4000-8000-0000000000aa";
const T1 = "00000000-0000-4000-8000-000000000001";
const T2 = "00000000-0000-4000-8000-000000000002";
const T3 = "00000000-0000-4000-8000-000000000003";
const T4 = "00000000-0000-4000-8000-000000000004";

const ME: AuthUser = { id: "user-blake", email: "planner@example.test", role: "planner", platformRole: "none", venueId: null, name: "Blake" };
const ELAINE_AT = "2026-10-20T21:58:00.000Z";

function wire(id: string, positionX: number, label?: string): PlacedObject {
  return {
    id, configurationId: CONFIG, assetDefinitionId: ASSET,
    positionX: String(positionX), positionY: "0", positionZ: "1",
    rotationX: "0", rotationY: "0", rotationZ: "0", scale: "1", sortOrder: 0,
    metadata: label === undefined ? null : { displayLabel: label },
  };
}

function editor(id: string, positionX: number, label?: string): EditorObject {
  return placedObjectToEditor(wire(id, positionX, label));
}

function serverConfig(revision: number, objects: readonly PlacedObject[], extra: Partial<configApi.Configuration> = {}): configApi.Configuration {
  return { id: CONFIG, spaceId: SPACE, venueId: VENUE, userId: ME.id, name: "Duncan wedding",
    isPublicPreview: false, revision, objects: [...objects], ...extra };
}

const BASE_WIRE = [wire(T1, 1, "Table 1"), wire(T2, 2, "Table 2"), wire(T3, 3, "Table 3")];
const BASE = BASE_WIRE.map((row) => placedObjectToEditor(row));
// Elaine's revision 3: Table 2 moved, a fourth table added.
const THEIRS_WIRE = [wire(T1, 1, "Table 1"), wire(T2, 20, "Table 2"), wire(T3, 3, "Table 3"), wire(T4, 4, "Table 4")];

function open(objects: readonly EditorObject[], isDirty: boolean, revision = 2): void {
  useEditorStore.setState({
    configId: CONFIG, spaceId: SPACE, venueId: VENUE, configRevision: revision,
    isPublicPreview: false, objects, baseObjects: BASE, isDirty, isSaving: false,
    saveError: null, saveConflict: null, history: { past: [], future: [] },
  });
}

function conflictError(changedBy: { userId: string; name: string } | null = { userId: "user-elaine", name: "Elaine" }): ApiError {
  return new ApiError(409, "Layout changed on the server. Reload before saving again.", "REVISION_CONFLICT", {
    expectedRevision: 2, currentRevision: 3, changedBy, changedAt: ELAINE_AT,
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function setBrowserOnline(online: boolean): void {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

function store() {
  return useEditorStore.getState();
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.getState().setUser(ME);
  store().reset();
  vi.mocked(configApi.getConfig).mockReset();
  vi.mocked(configApi.getPublicConfig).mockReset();
  vi.mocked(configApi.authBatchSave).mockReset();
  vi.mocked(configApi.publicBatchSave).mockReset();
});

afterEach(() => {
  setLayoutTimelineMutationLock(false);
  setBrowserOnline(true);
  useAuthStore.getState().setUser(null);
  vi.restoreAllMocks();
});

describe("how many changes", () => {
  it("counts the objects that differ from the server's copy, live", () => {
    open(BASE, false);
    expect(store().pendingChanges).toBe(0);
    store().updateObject(T1, { positionX: 50 });
    expect(store().pendingChanges).toBe(1);
    store().addObject(ASSET, 0, 0, 0);
    expect(store().pendingChanges).toBe(2);
    store().removeObject(T2);
    expect(store().pendingChanges).toBe(3);
  });

  it("goes back to none when the only change is undone", () => {
    open(BASE, false);
    store().updateObject(T1, { positionX: 50 });
    expect(store().pendingChanges).toBe(1);
    store().undo();
    expect(store().pendingChanges).toBe(0);
  });

  it("holds the count a save started with until it lands, then lets it go", async () => {
    open([editor(T1, 10, "Table 1"), editor(T2, 20, "Table 2"), BASE[2] as EditorObject], true);
    expect(store().savingChanges).toBeNull();
    const pending = deferred<configApi.BatchSaveResponse>();
    vi.mocked(configApi.authBatchSave).mockReturnValueOnce(pending.promise);
    const saving = store().saveToServer(true);
    expect(store().savingChanges).toBe(2);
    store().updateObject(T3, { positionX: 99 });
    expect(store().pendingChanges).toBe(3);
    expect(store().savingChanges).toBe(2);
    pending.resolve({ objects: [wire(T1, 10, "Table 1"), wire(T2, 20, "Table 2"), wire(T3, 3, "Table 3")], revision: 3 });
    expect(await saving).toBe(true);
    expect(store().savingChanges).toBeNull();
    // The edit made in flight is still unsaved against the new server copy.
    expect(store().pendingChanges).toBe(1);
  });
});

describe("why a save did not land", () => {
  it("keeps the API error's code beside its message, and clears both together", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    open([editor(T1, 10)], true);
    vi.mocked(configApi.authBatchSave).mockRejectedValueOnce(new ApiError(401, "Session expired — please sign in again", "UNAUTHORIZED"));
    expect(await store().saveToServer(true)).toBe(false);
    expect(store()).toMatchObject({ saveError: "Session expired — please sign in again", saveErrorCode: "UNAUTHORIZED", isDirty: true });
    // Sentry hears the status, never the server's words (observability/failure-reports.ts).
    expect(reports.reportFailure).toHaveBeenCalledWith("save-failed", { status: 401 });
    store().clearSaveError();
    expect(store()).toMatchObject({ saveError: null, saveErrorCode: null });
  });

  it("reads a review-lock refusal as view-only, in review, until the layout is editable again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    open([editor(T1, 10)], true);
    vi.mocked(configApi.authBatchSave).mockRejectedValueOnce(new ApiError(409, "Configuration is locked for editing", "CONFIG_LOCKED"));
    await store().saveToServer(true);
    expect(store().saveErrorCode).toBe("CONFIG_LOCKED");
    expect(store().lockReason).toBe("in-review");
    store().clearSaveError();
    expect(store().lockReason).toBe("in-review");
    store().setReviewStatus("another-layout", "draft");
    expect(store().lockReason).toBe("in-review");
    store().setReviewStatus(CONFIG, "draft");
    expect(store().lockReason).toBeNull();
  });
});

describe("offline", () => {
  it("follows the browser's network", () => {
    setBrowserOnline(false);
    expect(store().isOnline).toBe(false);
    setBrowserOnline(true);
    expect(store().isOnline).toBe(true);
  });

  it("calls a save that failed for want of a network offline, not failed, and keeps the work here", async () => {
    open([editor(T1, 10, "Table 1"), BASE[1] as EditorObject, BASE[2] as EditorObject], true);
    setBrowserOnline(false);
    vi.mocked(configApi.authBatchSave).mockRejectedValueOnce(new ApiError(0, "Network error — check your connection", "NETWORK_ERROR"));
    expect(await store().saveToServer(true)).toBe(false);
    expect(store()).toMatchObject({ saveError: null, saveErrorCode: null, isDirty: true, isOnline: false, keptOnDevice: true });
    expect(store().pendingChanges).toBe(1);
  });

  it("lets the offline event explain a network failure recorded a moment before it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    open([editor(T1, 10)], true);
    vi.mocked(configApi.authBatchSave).mockRejectedValueOnce(new ApiError(0, "Network error — check your connection", "NETWORK_ERROR"));
    await store().saveToServer(true);
    expect(store().saveErrorCode).toBe("NETWORK_ERROR");
    setBrowserOnline(false);
    expect(store()).toMatchObject({ saveError: null, saveErrorCode: null, isOnline: false, isDirty: true });
  });

  it("still calls a network failure while online a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    open([editor(T1, 10)], true);
    vi.mocked(configApi.authBatchSave).mockRejectedValueOnce(new ApiError(0, "Network error — check your connection", "NETWORK_ERROR"));
    await store().saveToServer(true);
    expect(store()).toMatchObject({ saveErrorCode: "NETWORK_ERROR", saveError: "Network error — check your connection", isOnline: true });
  });
});

describe("kept on this device", () => {
  it("keeps a signed-in person's unsaved layout here, and lets it go once saved", async () => {
    open(BASE, false);
    expect(store().keptOnDevice).toBe(false);
    store().updateObject(T1, { positionX: 50 });
    expect(store().keptOnDevice).toBe(true);
    const stored = JSON.parse(localStorage.getItem(signedInPlannerDraftKey(ME.id, CONFIG)) ?? "null") as { objects: EditorObject[] } | null;
    expect(stored?.objects.find((object) => object.id === T1)?.positionX).toBe(50);
    vi.mocked(configApi.authBatchSave).mockResolvedValueOnce({ objects: [wire(T1, 0.5), BASE_WIRE[1] as PlacedObject, BASE_WIRE[2] as PlacedObject], revision: 3 });
    await store().saveToServer(true);
    expect(store().keptOnDevice).toBe(false);
    expect(localStorage.getItem(signedInPlannerDraftKey(ME.id, CONFIG))).toBeNull();
  });

  it("writes a pointer gesture once, at its end, and says so only then", () => {
    open(BASE, false);
    const token = store().beginHistoryGesture();
    if (token === null) throw new Error("gesture refused");
    store().updateObject(T1, { positionX: 40 });
    store().updateObject(T1, { positionX: 45 });
    expect(store().keptOnDevice).toBe(false);
    expect(localStorage.getItem(signedInPlannerDraftKey(ME.id, CONFIG))).toBeNull();
    store().endHistoryGesture(token);
    expect(store().keptOnDevice).toBe(true);
    const stored = JSON.parse(localStorage.getItem(signedInPlannerDraftKey(ME.id, CONFIG)) ?? "null") as { objects: EditorObject[] } | null;
    expect(stored?.objects.find((object) => object.id === T1)?.positionX).toBe(45);
  });

  it("never offers one person's kept work to another person", async () => {
    open([editor(T1, 10, "Table 1"), BASE[1] as EditorObject, BASE[2] as EditorObject], true);
    expect(store().keptOnDevice).toBe(true);
    store().reset();
    useAuthStore.getState().setUser({ ...ME, id: "user-colleague" });
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(serverConfig(2, BASE_WIRE));
    await store().loadConfiguration(CONFIG, true);
    expect(store().objects).toEqual(BASE);
    expect(store().isDirty).toBe(false);
  });
});

describe("a newer revision: who, when and what", () => {
  it("says who changed the layout, when, and what they did, without taking their version", async () => {
    const mine = [editor(T1, 10, "Table 1"), BASE[1] as EditorObject, BASE[2] as EditorObject];
    open(mine, true);
    vi.mocked(configApi.authBatchSave).mockRejectedValueOnce(conflictError());
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(serverConfig(3, THEIRS_WIRE));

    expect(await store().saveToServer(true)).toBe(false);
    const conflict = store().saveConflict;
    expect(conflict).toMatchObject({
      expectedRevision: 2,
      currentRevision: 3,
      changedBy: { userId: "user-elaine", name: "Elaine" },
      byYou: false,
      theirChange: {
        moved: [{ noun: "item", label: "Table 2" }],
        added: [{ noun: "item", label: "Table 4" }],
        removed: [],
        restyled: [],
      },
    });
    expect(conflict?.changedAt?.toISOString()).toBe(ELAINE_AT);
    expect(store().saveErrorCode).toBe("REVISION_CONFLICT");
    expect(store().objects).toEqual(mine);
    expect(store().configRevision).toBe(2);
    expect(store().savingChanges).toBeNull();
  });

  it("knows a newer revision of one's own from another tab", async () => {
    open([editor(T1, 10, "Table 1"), BASE[1] as EditorObject, BASE[2] as EditorObject], true);
    vi.mocked(configApi.authBatchSave).mockRejectedValueOnce(conflictError({ userId: ME.id, name: "Blake" }));
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(serverConfig(3, THEIRS_WIRE));
    await store().saveToServer(true);
    expect(store().saveConflict?.byYou).toBe(true);
  });

  it("says nothing about what changed when the server has moved on again by the time it is read", async () => {
    open([editor(T1, 10, "Table 1"), BASE[1] as EditorObject, BASE[2] as EditorObject], true);
    vi.mocked(configApi.authBatchSave).mockRejectedValueOnce(conflictError());
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(serverConfig(4, THEIRS_WIRE));
    await store().saveToServer(true);
    expect(store().saveConflict).toMatchObject({ currentRevision: 3, theirChange: null });
  });

  it("keeps mine: saves this whole document over their revision, and their version stays theirs on the server", async () => {
    const mine = [editor(T1, 10, "Table 1"), BASE[1] as EditorObject, BASE[2] as EditorObject];
    open(mine, true);
    vi.mocked(configApi.authBatchSave).mockRejectedValueOnce(conflictError());
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(serverConfig(3, THEIRS_WIRE));
    await store().saveToServer(true);

    const pending = deferred<configApi.BatchSaveResponse>();
    vi.mocked(configApi.authBatchSave).mockReturnValueOnce(pending.promise);
    const keeping = store().keepMine();
    // Against their version this save changes Table 1 and Table 2 back and drops Table 4.
    expect(store().savingChanges).toBe(3);
    // The choice is settled when the save lands, not when it starts.
    expect(store().saveConflict).not.toBeNull();
    const call = vi.mocked(configApi.authBatchSave).mock.calls[1];
    expect(call?.[2]).toBe(3);
    expect(call?.[1].map((object) => [object.id, object.positionX])).toEqual([[T1, 10], [T2, 2], [T3, 3]]);
    pending.resolve({ objects: [wire(T1, 10, "Table 1"), wire(T2, 2, "Table 2"), wire(T3, 3, "Table 3")], revision: 4 });
    expect(await keeping).toBe(true);
    expect(store()).toMatchObject({ saveConflict: null, saveError: null, saveErrorCode: null, configRevision: 4, isDirty: false });
  });

  it("has nothing to keep without a conflict", async () => {
    open([editor(T1, 10)], true);
    expect(await store().keepMine()).toBe(false);
    expect(configApi.authBatchSave).not.toHaveBeenCalled();
  });

  it("shows their version: drops this device's copy and opens the server's", async () => {
    open([editor(T1, 10, "Table 1"), BASE[1] as EditorObject, BASE[2] as EditorObject], true);
    vi.mocked(configApi.authBatchSave).mockRejectedValueOnce(conflictError());
    vi.mocked(configApi.getConfig).mockResolvedValue(serverConfig(3, THEIRS_WIRE));
    await store().saveToServer(true);
    expect(localStorage.getItem(signedInPlannerDraftKey(ME.id, CONFIG))).not.toBeNull();

    await store().showTheirVersion();
    expect(store().objects).toEqual(THEIRS_WIRE.map((row) => placedObjectToEditor(row)));
    expect(store()).toMatchObject({ configRevision: 3, isDirty: false, saveConflict: null, keptOnDevice: false, pendingChanges: 0 });
    expect(localStorage.getItem(signedInPlannerDraftKey(ME.id, CONFIG))).toBeNull();
  });
});

describe("work kept here from an older revision", () => {
  it("comes back unsaved on the base it was edited from, already meeting the newer copy", async () => {
    // Edited offline at revision 2; meanwhile Elaine saved revision 3.
    open([editor(T1, 10, "Table 1"), BASE[1] as EditorObject, BASE[2] as EditorObject], true);
    store().reset();
    vi.mocked(configApi.getConfig).mockResolvedValue(serverConfig(3, THEIRS_WIRE));

    await store().loadConfiguration(CONFIG, true);
    expect(store()).toMatchObject({ configRevision: 2, isDirty: true, pendingChanges: 1, keptOnDevice: true });
    expect(store().objects.map((object) => object.positionX)).toEqual([10, 2, 3].map((x) => editor(T1, x).positionX));

    // The load read the newer copy: the conflict is there before any save,
    // and no save goes until the person chooses.
    expect(await store().saveToServer(true)).toBe(false);
    expect(configApi.authBatchSave).not.toHaveBeenCalled();
    expect(store().saveConflict).toMatchObject({ expectedRevision: 2, currentRevision: 3, changedBy: null, changedAt: null });
    expect(store().saveConflict?.theirChange).toEqual({
      moved: [{ noun: "item", label: "Table 2" }],
      added: [{ noun: "item", label: "Table 4" }],
      removed: [],
      restyled: [],
    });
  });

  it("comes back as it is when the server has not moved", async () => {
    open([editor(T1, 10, "Table 1"), BASE[1] as EditorObject, BASE[2] as EditorObject], true);
    store().reset();
    vi.mocked(configApi.getConfig).mockResolvedValue(serverConfig(2, BASE_WIRE));
    await store().loadConfiguration(CONFIG, true);
    expect(store()).toMatchObject({ configRevision: 2, isDirty: true, pendingChanges: 1 });
    expect(store().baseObjects).toEqual(BASE);
  });
});

describe("view only", () => {
  it("is view-only while a frozen phase is previewed", () => {
    open(BASE, false);
    setLayoutTimelineMutationLock(true);
    expect(store().lockReason).toBe("phase-preview");
    setLayoutTimelineMutationLock(false);
    expect(store().lockReason).toBeNull();
  });

  it("is view-only, in review, when the layout opens submitted or under review, except for its venue's admin or a platform admin", async () => {
    vi.mocked(configApi.getConfig).mockResolvedValue(serverConfig(2, BASE_WIRE, { reviewStatus: "under_review" }));
    await store().loadConfiguration(CONFIG, true);
    expect(store().reviewStatus).toBe("under_review");
    expect(store().lockReason).toBe("in-review");
    store().setReviewStatus(CONFIG, "changes_requested");
    expect(store().lockReason).toBeNull();

    useAuthStore.getState().setUser({ ...ME, role: "admin", venueId: VENUE });
    store().setReviewStatus(CONFIG, "submitted");
    expect(store().lockReason).toBeNull();
    // Another venue's admin who owns the layout is held, as the server holds them.
    useAuthStore.getState().setUser({ ...ME, role: "admin", venueId: "another-venue" });
    store().setReviewStatus(CONFIG, "under_review");
    expect(store().lockReason).toBe("in-review");
    useAuthStore.getState().setUser({ ...ME, role: "staff", platformRole: "admin", venueId: null });
    store().setReviewStatus(CONFIG, "submitted");
    expect(store().lockReason).toBeNull();
  });
});
