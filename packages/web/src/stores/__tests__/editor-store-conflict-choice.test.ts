import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configApi from "../../api/configurations.js";
import type { PlacedObject } from "../../api/configurations.js";
import { ApiError } from "../../api/client.js";
import { persistAnonymousPlannerDraft, signedInPlannerDraftKey } from "../../lib/anonymous-planner-draft.js";
import { useAuthStore, type AuthUser } from "../auth-store.js";
import {
  placedObjectToEditor,
  setEditorAutosaveRequester,
  setEditorConflictPolicy,
  useEditorStore,
  type EditorObject,
} from "../editor-store.js";

// ---------------------------------------------------------------------------
// A change made elsewhere is the person's to settle: "Show their version" or
// "Keep mine", and whichever they keep the other stays in History. Nothing is
// silently overwritten, merged or dropped meanwhile, in the live room ("rebase"
// policy) as much as out of it. The real 409 parser, draft storage and change
// summary run; only the network (and, where named, Web Locks) is replaced.
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
const T5 = "00000000-0000-4000-8000-000000000005";

const ME: AuthUser = { id: "user-blake", email: "planner@example.test", role: "staff", platformRole: "none", venueId: VENUE, name: "Blake" };
const ELAINE = { userId: "user-elaine", name: "Elaine" };
const MORAG = { userId: "user-morag", name: "Morag" };
const DRAFT_KEY = signedInPlannerDraftKey(ME.id, CONFIG);

function wire(id: string, positionX: number, label: string): PlacedObject {
  return {
    id, configurationId: CONFIG, assetDefinitionId: ASSET,
    positionX: String(positionX), positionY: "0", positionZ: "1",
    rotationX: "0", rotationY: "0", rotationZ: "0", scale: "1", sortOrder: 0,
    metadata: { displayLabel: label },
  };
}

function editor(id: string, positionX: number, label: string): EditorObject {
  return placedObjectToEditor(wire(id, positionX, label));
}

function serverConfig(revision: number, objects: readonly PlacedObject[], extra: Partial<configApi.Configuration> = {}): configApi.Configuration {
  return { id: CONFIG, spaceId: SPACE, venueId: VENUE, userId: ME.id, name: "Duncan wedding",
    isPublicPreview: false, revision, objects: [...objects], ...extra };
}

// Revision 2, the version this person worked from.
const BASE_WIRE = [wire(T1, 1, "Table 1"), wire(T2, 2, "Table 2"), wire(T3, 3, "Table 3")];
const BASE = BASE_WIRE.map((row) => placedObjectToEditor(row));
// Mine: Table 1 moved.
const MINE = [editor(T1, 10, "Table 1"), editor(T2, 2, "Table 2"), editor(T3, 3, "Table 3")];
// Elaine's revision 3: Table 2 moved, Table 3 deleted, Table 4 added.
const THEIRS_WIRE = [wire(T1, 1, "Table 1"), wire(T2, 20, "Table 2"), wire(T4, 4, "Table 4")];

function conflictError(expectedRevision: number, currentRevision: number, changedBy: { userId: string; name: string } | null): ApiError {
  return new ApiError(409, "Layout changed on the server. Reload before saving again.", "REVISION_CONFLICT", {
    expectedRevision, currentRevision, changedBy, changedAt: "2026-10-20T21:58:00.000Z",
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

/** Web Locks as the browser reports them: these planner pages are open. */
function openPages(pageIds: readonly string[]): void {
  Object.defineProperty(window.navigator, "locks", {
    configurable: true,
    value: {
      query: () => Promise.resolve({ held: pageIds.map((id) => ({ name: `venviewer:planner-page:${id}`, mode: "exclusive" })), pending: [] }),
      request: () => Promise.resolve(undefined),
    },
  });
}

function store() {
  return useEditorStore.getState();
}

function open(objects: readonly EditorObject[], isDirty: boolean, revision = 2): void {
  useEditorStore.setState({
    configId: CONFIG, spaceId: SPACE, venueId: VENUE, configRevision: revision,
    isPublicPreview: false, objects, baseObjects: BASE, isDirty, isSaving: false,
    saveError: null, saveConflict: null, history: { past: [], future: [] },
  });
}

/** Unsaved work this device kept from revision `baseRevision`, as another page left it. */
function keptDraft(objects: readonly EditorObject[], baseRevision: number, writerPageId?: string): void {
  const kept = persistAnonymousPlannerDraft({
    configId: CONFIG, spaceId: SPACE, venueId: VENUE, configRevision: baseRevision,
    isPublicPreview: false, objects, baseObjects: BASE, isDirty: true, ownerUserId: ME.id,
    ...(writerPageId === undefined ? {} : { writerPageId }),
  });
  if (!kept) throw new Error("draft not kept");
}

/** A 409 against Elaine's revision 3, reported (not live). */
async function meetElaine(): Promise<void> {
  open(MINE, true);
  vi.mocked(configApi.authBatchSave).mockRejectedValueOnce(conflictError(2, 3, ELAINE));
  vi.mocked(configApi.getConfig).mockResolvedValueOnce(serverConfig(3, THEIRS_WIRE));
  expect(await store().saveToServer(true)).toBe(false);
  expect(store().saveConflict?.currentRevision).toBe(3);
}

function sentBatch(call: number): { id: string | undefined; label: unknown }[] {
  const batch = vi.mocked(configApi.authBatchSave).mock.calls[call]?.[1] ?? [];
  return batch.map((object) => ({ id: object.id, label: object.metadata?.displayLabel }));
}

const requestedSaves = vi.fn();

beforeEach(() => {
  localStorage.clear();
  useAuthStore.getState().setUser(ME);
  store().reset();
  requestedSaves.mockReset();
  setEditorAutosaveRequester(requestedSaves);
  vi.mocked(configApi.getConfig).mockReset();
  vi.mocked(configApi.getPublicConfig).mockReset();
  vi.mocked(configApi.authBatchSave).mockReset();
  vi.mocked(configApi.publicBatchSave).mockReset();
});

afterEach(() => {
  setEditorAutosaveRequester(null);
  setEditorConflictPolicy("report");
  setBrowserOnline(true);
  Reflect.deleteProperty(window.navigator, "locks");
  useAuthStore.getState().setUser(null);
  vi.restoreAllMocks();
});

describe("work kept from an older revision is a conflict from the moment it opens (finding 1)", () => {
  it("raises the conflict at load against the version the load read, and sends nothing, in the live room too", async () => {
    setEditorConflictPolicy("rebase");
    keptDraft(MINE, 2);
    vi.mocked(configApi.getConfig).mockResolvedValue(serverConfig(3, THEIRS_WIRE));

    await store().loadConfiguration(CONFIG, true);

    expect(store().saveConflict).toMatchObject({
      expectedRevision: 2, currentRevision: 3, changedBy: null, changedAt: null, byYou: false,
      theirChange: {
        moved: [{ noun: "item", label: "Table 2" }],
        added: [{ noun: "item", label: "Table 4" }],
        removed: [{ noun: "item", label: "Table 3" }],
        restyled: [],
      },
    });
    expect(store()).toMatchObject({ configRevision: 2, isDirty: true, saveErrorCode: "REVISION_CONFLICT", keptOnDevice: true });
    expect(store().objects).toEqual(MINE);
    expect(requestedSaves).not.toHaveBeenCalled();
    // Nothing saves through it but the person's choice.
    expect(await store().saveToServer(true)).toBe(false);
    expect(configApi.authBatchSave).not.toHaveBeenCalled();
  });

  it("holds through the live room's resync and later commits: nothing merged, their newest version kept to choose against", async () => {
    setEditorConflictPolicy("rebase");
    keptDraft(MINE, 2);
    vi.mocked(configApi.getConfig).mockResolvedValue(serverConfig(3, THEIRS_WIRE));
    await store().loadConfiguration(CONFIG, true);

    // Joining the room refetches revision 3: held, nothing taken.
    expect(store().adoptServerConfiguration(serverConfig(3, THEIRS_WIRE)).status).toBe("held");
    expect(store().objects).toEqual(MINE);
    // Morag commits revision 4 (Table 4 moved): held again, and it becomes their version.
    const fourth = [wire(T1, 1, "Table 1"), wire(T2, 20, "Table 2"), wire(T4, 44, "Table 4")];
    expect(store().adoptServerConfiguration(serverConfig(4, fourth)).status).toBe("held");
    expect(store().objects).toEqual(MINE);
    expect(store()).toMatchObject({ configRevision: 2, isDirty: true });
    expect(store().saveConflict).toMatchObject({ expectedRevision: 2, currentRevision: 4, changedBy: null, changedAt: null });
    expect(store().saveConflict?.theirChange?.added).toEqual([{ noun: "item", label: "Table 4" }]);
    expect(requestedSaves).not.toHaveBeenCalled();

    // Keeping mine saves over the newest, revision 4.
    vi.mocked(configApi.authBatchSave).mockResolvedValueOnce({
      objects: [wire(T1, 10, "Table 1"), wire(T2, 2, "Table 2"), wire(T5, 3, "Table 3")], revision: 5,
    });
    expect(await store().keepMine(true)).toBe(true);
    expect(vi.mocked(configApi.authBatchSave).mock.calls[0]?.[2]).toBe(4);
  });

  it("treats work kept from a revision AHEAD of the server's as unknown, never as anyone's change (finding 8)", async () => {
    keptDraft(MINE, 5);
    vi.mocked(configApi.getConfig).mockResolvedValue(serverConfig(3, THEIRS_WIRE));
    await store().loadConfiguration(CONFIG, true);
    expect(store().saveConflict).toMatchObject({
      expectedRevision: 5, currentRevision: 3, changedBy: null, changedAt: null, byYou: false, theirChange: null,
    });
    expect(requestedSaves).not.toHaveBeenCalled();
  });
});

describe("Keep mine keeps every object of mine (finding 2)", () => {
  it("places again what their version deleted, sends exactly what it counts, and shows what it kept", async () => {
    await meetElaine();
    const pending = deferred<configApi.BatchSaveResponse>();
    vi.mocked(configApi.authBatchSave).mockReturnValueOnce(pending.promise);

    const keeping = store().keepMine(true);
    const call = vi.mocked(configApi.authBatchSave).mock.calls[1];
    expect(call?.[2]).toBe(3);
    // Table 3 is gone from their version: it goes as a new placement, not dropped.
    expect(sentBatch(1)).toEqual([
      { id: T1, label: "Table 1" }, { id: T2, label: "Table 2" }, { id: undefined, label: "Table 3" },
    ]);
    // Against their version: Table 1 and 2 changed, Table 3 placed, Table 4 removed.
    expect(store().savingChanges).toBe(4);
    // The choice is not settled until the save lands.
    expect(store().saveConflict).not.toBeNull();
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();

    pending.resolve({ objects: [wire(T1, 10, "Table 1"), wire(T2, 2, "Table 2"), wire(T5, 3, "Table 3")], revision: 4 });
    expect(await keeping).toBe(true);
    const kept = store().objects;
    expect(kept.map((object) => object.id)).toEqual([T1, T2, T5]);
    expect(kept.map(({ id: _id, ...rest }) => rest)).toEqual(MINE.map(({ id: _id, ...rest }) => rest));
    expect(store()).toMatchObject({ saveConflict: null, saveError: null, isDirty: false, configRevision: 4, keptOnDevice: false });
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("re-reads their version when it does not hold it, and saves nothing it cannot account for", async () => {
    open(MINE, true);
    vi.mocked(configApi.authBatchSave).mockRejectedValueOnce(conflictError(2, 3, ELAINE));
    // By the time the 409 path reads, the server is on revision 4: not summarised, not held.
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(serverConfig(4, THEIRS_WIRE));
    await store().saveToServer(true);
    expect(store().saveConflict).toMatchObject({ currentRevision: 3, theirChange: null });

    vi.mocked(configApi.getConfig).mockRejectedValueOnce(new ApiError(0, "Network error", "NETWORK_ERROR"));
    expect(await store().keepMine(true)).toBe(false);
    expect(store().saveError).toBe("The newer version could not be read, so nothing was saved. Try again.");
    expect(store().saveConflict?.currentRevision).toBe(3);

    // Read again: revision 4 is newer than the conflict named, so that is what is shown first.
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(serverConfig(4, THEIRS_WIRE));
    expect(await store().keepMine(true)).toBe(false);
    expect(store().saveConflict).toMatchObject({ currentRevision: 4, changedBy: null });
    expect(store().saveConflict?.theirChange?.removed).toEqual([{ noun: "item", label: "Table 3" }]);
    expect(configApi.authBatchSave).toHaveBeenCalledTimes(1);

    vi.mocked(configApi.authBatchSave).mockResolvedValueOnce({
      objects: [wire(T1, 10, "Table 1"), wire(T2, 2, "Table 2"), wire(T5, 3, "Table 3")], revision: 5,
    });
    expect(await store().keepMine(true)).toBe(true);
    expect(vi.mocked(configApi.authBatchSave).mock.calls[1]?.[2]).toBe(4);
    expect(sentBatch(1).map((object) => object.id)).toEqual([T1, T2, undefined]);
  });
});

describe("Keep mine never overwrites a third version without asking (finding 3)", () => {
  it("reports a third version as a fresh conflict, with its own who and what, even in the live room", async () => {
    setEditorConflictPolicy("rebase");
    keptDraft(MINE, 2);
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(serverConfig(3, THEIRS_WIRE));
    await store().loadConfiguration(CONFIG, true);

    // Morag commits revision 4 (moves Table 4) just before the save lands.
    const fourth = [wire(T1, 1, "Table 1"), wire(T2, 20, "Table 2"), wire(T4, 44, "Table 4")];
    vi.mocked(configApi.authBatchSave).mockRejectedValueOnce(conflictError(3, 4, MORAG));
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(serverConfig(4, fourth));

    expect(await store().keepMine(true)).toBe(false);
    // One save: no rebase onto revision 4, no second request.
    expect(configApi.authBatchSave).toHaveBeenCalledTimes(1);
    expect(store().saveConflict).toMatchObject({
      expectedRevision: 3, currentRevision: 4, changedBy: MORAG, byYou: false,
      theirChange: { moved: [{ noun: "item", label: "Table 4" }], added: [], removed: [], restyled: [] },
    });
    expect(store().objects.map((object) => object.label)).toEqual(["Table 1", "Table 2", "Table 3"]);
    expect(store().isDirty).toBe(true);
  });
});

describe("offline during Keep mine", () => {
  it("is offline, not failed: the choice stays open, the work stays here, and keeping it later lands", async () => {
    await meetElaine();
    setBrowserOnline(false);
    vi.mocked(configApi.authBatchSave).mockRejectedValueOnce(new ApiError(0, "Network error — check your connection", "NETWORK_ERROR"));

    expect(await store().keepMine(true)).toBe(false);
    expect(store().saveConflict).not.toBeNull();
    expect(store()).toMatchObject({ saveError: null, saveErrorCode: null, isDirty: true, isOnline: false, keptOnDevice: true });
    expect(store().objects.map((object) => object.label)).toEqual(["Table 1", "Table 2", "Table 3"]);

    setBrowserOnline(true);
    vi.mocked(configApi.authBatchSave).mockResolvedValueOnce({
      objects: [wire(T1, 10, "Table 1"), wire(T2, 2, "Table 2"), wire(T5, 3, "Table 3")], revision: 4,
    });
    expect(await store().keepMine(true)).toBe(true);
    expect(store()).toMatchObject({ saveConflict: null, isDirty: false, configRevision: 4 });
  });
});

describe("a pending conflict waits for the person (finding 7)", () => {
  it("lets no other save through, and dismissing the message never dismisses the choice", async () => {
    await meetElaine();
    const conflict = store().saveConflict;
    store().updateObject(T2, { positionX: 99 });
    expect(await store().saveToServer(true)).toBe(false);
    expect(configApi.authBatchSave).toHaveBeenCalledTimes(1);
    expect(store().saveConflict).toBe(conflict);
    store().clearSaveError();
    expect(store().saveError).toBeNull();
    expect(store().saveConflict).toBe(conflict);
  });

  it("keeps a peer's live write out of this document while the choice is open", async () => {
    await meetElaine();
    store().yieldObjectsToRemote([T1]);
    expect(store().objects).toEqual(MINE);
  });
});

describe("view only after a refused save (finding 8)", () => {
  it("lifts the review lock when a refetch says the layout is editable again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    open(MINE, true);
    vi.mocked(configApi.authBatchSave).mockRejectedValueOnce(new ApiError(409, "Configuration is locked for editing", "CONFIG_LOCKED"));
    await store().saveToServer(true);
    expect(store().lockReason).toBe("in-review");
    store().adoptServerConfiguration(serverConfig(3, BASE_WIRE, { reviewStatus: "draft" }));
    expect(store()).toMatchObject({ reviewLockRefused: false, lockReason: null });
  });
});

describe("a sample layout (finding 9)", () => {
  it("says the layout is a template as the server does, and forgets it with the layout", async () => {
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(serverConfig(2, BASE_WIRE, { isTemplate: true }));
    await store().loadConfiguration(CONFIG, true);
    expect(store().isTemplate).toBe(true);
    store().reset();
    expect(store().isTemplate).toBe(false);
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(serverConfig(2, BASE_WIRE));
    await store().loadConfiguration(CONFIG, true);
    expect(store().isTemplate).toBe(false);
  });
});

describe("tabs share a layout's draft key (finding 6)", () => {
  function storageEvent(key: string, newValue: string | null): void {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
  }

  it("writes this tab's unsaved work back when another tab's clean save removed it", () => {
    open(BASE, false);
    store().updateObject(T1, { positionX: 50 });
    expect(store().keptOnDevice).toBe(true);
    localStorage.removeItem(DRAFT_KEY);
    storageEvent(DRAFT_KEY, null);
    expect(store().keptOnDevice).toBe(true);
    const stored = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null") as { objects: EditorObject[] } | null;
    expect(stored?.objects.find((object) => object.id === T1)?.positionX).toBe(50);
  });

  it("stops claiming the work is kept here once another tab's work replaced it, without writing over it", () => {
    open(BASE, false);
    store().updateObject(T1, { positionX: 50 });
    localStorage.setItem(DRAFT_KEY, "another tab's draft");
    storageEvent(DRAFT_KEY, "another tab's draft");
    expect(store().keptOnDevice).toBe(false);
    expect(localStorage.getItem(DRAFT_KEY)).toBe("another tab's draft");
  });

  it("leaves another open tab's unsaved work to that tab: opens the saved version and keeps the draft", async () => {
    openPages(["page-other"]);
    keptDraft(MINE, 2, "page-other");
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(serverConfig(2, BASE_WIRE));
    await store().loadConfiguration(CONFIG, true);
    expect(store()).toMatchObject({ isDirty: false, saveConflict: null, keptOnDevice: false });
    expect(store().objects).toEqual(BASE);
    expect(requestedSaves).not.toHaveBeenCalled();
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();
  });

  it("picks up work a closed tab left behind, and sends it on", async () => {
    openPages([]);
    keptDraft(MINE, 2, "page-closed");
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(serverConfig(2, BASE_WIRE));
    await store().loadConfiguration(CONFIG, true);
    expect(store()).toMatchObject({ isDirty: true, saveConflict: null, keptOnDevice: true });
    expect(store().objects).toEqual(MINE);
    expect(requestedSaves).toHaveBeenCalledTimes(1);
  });

  it("writes nothing back once another tab signs this person out, until they sign in again (finding 5)", () => {
    open(BASE, false);
    store().updateObject(T1, { positionX: 50 });
    storageEvent("venviewer:planner-drafts-signed-out", JSON.stringify({ userId: ME.id, atMs: Date.now() }));
    localStorage.removeItem(DRAFT_KEY);
    storageEvent(DRAFT_KEY, null);
    expect(store().keptOnDevice).toBe(false);
    store().updateObject(T1, { positionX: 51 });
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(store().keptOnDevice).toBe(false);

    useAuthStore.getState().setUser({ ...ME });
    store().updateObject(T1, { positionX: 52 });
    expect(store().keptOnDevice).toBe(true);
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();
  });
});
