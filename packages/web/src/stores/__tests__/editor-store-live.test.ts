import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configApi from "../../api/configurations.js";
import type { PlacedObject } from "../../api/configurations.js";
import {
  editorYieldedIds,
  placedObjectToEditor,
  setEditorLiveHooks,
  useEditorStore,
  type EditorLiveHooks,
  type EditorObject,
} from "../editor-store.js";

// ---------------------------------------------------------------------------
// Live co-editing v1 — the store's half: a refetched server document is
// adopted when clean and rebased object by object when dirty; a 409 while
// live rebases and retries instead of telling the person to reload; a
// yielded object is never resent with an older local value.
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
    parseRevisionConflict: vi.fn(() => null),
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

function wire(id: string, positionX: number): PlacedObject {
  return {
    id,
    configurationId: CONFIG,
    assetDefinitionId: ASSET,
    positionX: String(positionX),
    positionY: "0",
    positionZ: "1",
    rotationX: "0",
    rotationY: "0",
    rotationZ: "0",
    scale: "1",
    sortOrder: 0,
    metadata: null,
  };
}

function editor(id: string, positionX: number): EditorObject {
  return placedObjectToEditor(wire(id, positionX));
}

function serverConfig(revision: number, objects: readonly PlacedObject[]): configApi.Configuration {
  return {
    id: CONFIG,
    spaceId: SPACE,
    venueId: VENUE,
    userId: null,
    name: "Duncan wedding",
    isPublicPreview: false,
    revision,
    objects: [...objects],
  };
}

function positions(objects: readonly EditorObject[]): string[] {
  return objects.map((object) => `${object.id.slice(-1)}@${String(object.positionX)}`);
}

const BASE = [editor(T1, 1), editor(T2, 2), editor(T3, 3)];

function open(objects: readonly EditorObject[], isDirty: boolean): void {
  useEditorStore.setState({
    configId: CONFIG,
    configRevision: 2,
    isPublicPreview: false,
    objects,
    baseObjects: BASE,
    isDirty,
    isSaving: false,
    saveError: null,
    saveConflict: null,
    history: { past: [], future: [] },
  });
}

interface RecordingHooks extends EditorLiveHooks {
  readonly changes: number[];
  readonly saved: [number, ReadonlyMap<string, string>][];
}

function hooks(): RecordingHooks {
  const changes: number[] = [];
  const saved: [number, ReadonlyMap<string, string>][] = [];
  return {
    changes,
    saved,
    onLocalChange: (_before, after) => { changes.push(after.length); },
    onSaved: (revision, idMap) => { saved.push([revision, idMap]); },
  };
}

beforeEach(() => {
  useEditorStore.getState().reset();
  vi.mocked(configApi.authBatchSave).mockReset();
  vi.mocked(configApi.getConfig).mockReset();
  vi.mocked(configApi.parseRevisionConflict).mockReset().mockReturnValue(null);
});

afterEach(() => {
  setEditorLiveHooks(null);
});

describe("adoptServerConfiguration", () => {
  it("adopts a newer server document wholesale when this client is clean", () => {
    open(BASE, false);
    const outcome = useEditorStore.getState().adoptServerConfiguration(
      serverConfig(3, [wire(T1, 1), wire(T2, 20), wire(T4, 40)]),
    );
    const state = useEditorStore.getState();
    expect(outcome.status).toBe("adopted");
    expect(positions(state.objects)).toEqual(["1@1", "2@20", "4@40"]);
    expect(state.baseObjects).toBe(state.objects);
    expect(state.configRevision).toBe(3);
    expect(state.isDirty).toBe(false);
  });

  it("rebases when dirty: keeps my move, takes theirs, keeps my new placement", () => {
    const local = [editor(T1, 10), editor(T2, 2), editor(T3, 3), { ...editor(T3, 7), id: "local-1" }];
    open(local, true);
    const outcome = useEditorStore.getState().adoptServerConfiguration(
      serverConfig(3, [wire(T1, 1), wire(T2, 20), wire(T3, 3), wire(T4, 40)]),
    );
    const state = useEditorStore.getState();
    expect(outcome.status).toBe("rebased");
    expect(positions(state.objects)).toEqual(["1@10", "2@20", "3@3", "1@7", "4@40"]);
    expect(state.objects[3]?.id).toBe("local-1");
    expect(state.isDirty).toBe(true);
    expect(state.configRevision).toBe(3);
  });

  it("refuses a document no newer than the one held, and waits out a save in flight", () => {
    open(BASE, false);
    expect(useEditorStore.getState().adoptServerConfiguration(serverConfig(2, [])).status).toBe("stale");
    useEditorStore.setState({ isSaving: true });
    expect(useEditorStore.getState().adoptServerConfiguration(serverConfig(3, [])).status).toBe("busy");
    expect(useEditorStore.getState().objects).toBe(BASE);
  });

  it("ignores another configuration's document", () => {
    open(BASE, false);
    const other = { ...serverConfig(9, []), id: "00000000-0000-4000-8000-00000000dead" };
    expect(useEditorStore.getState().adoptServerConfiguration(other).status).toBe("ignored");
  });
});

describe("yieldObjectsToRemote", () => {
  it("returns a yielded object to the server copy and the next save sends that copy", async () => {
    open([editor(T1, 10), editor(T2, 2), editor(T3, 3)], true);
    useEditorStore.getState().yieldObjectsToRemote([T1]);
    expect(positions(useEditorStore.getState().objects)).toEqual(["1@1", "2@2", "3@3"]);
    expect(editorYieldedIds().has(T1)).toBe(true);

    vi.mocked(configApi.authBatchSave).mockResolvedValueOnce({ objects: [wire(T1, 1), wire(T2, 2), wire(T3, 3)], revision: 3 });
    await useEditorStore.getState().saveToServer(true);
    const batch = vi.mocked(configApi.authBatchSave).mock.calls[0]?.[1];
    expect(batch?.find((object) => object.id === T1)?.positionX).toBe(1);
  });

  it("hands the object back the moment this person edits it again", () => {
    open(BASE, false);
    useEditorStore.getState().yieldObjectsToRemote([T1]);
    useEditorStore.getState().updateObject(T1, { positionX: 12 });
    expect(editorYieldedIds().has(T1)).toBe(false);
  });

  it("keeps a yielded object equal to the save's echo even if it was in flight", async () => {
    open([editor(T1, 10), editor(T2, 2), editor(T3, 3)], true);
    let release: (value: configApi.BatchSaveResponse) => void = () => undefined;
    vi.mocked(configApi.authBatchSave).mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const saving = useEditorStore.getState().saveToServer(true);
    // A later remote write takes T1 while my save (with T1 at 10) is in flight.
    useEditorStore.getState().yieldObjectsToRemote([T1]);
    release({ objects: [wire(T1, 10), wire(T2, 2), wire(T3, 3)], revision: 3 });
    await saving;
    const state = useEditorStore.getState();
    // Equal to what the server now holds — never a pending resend of 1.
    expect(positions(state.objects)).toEqual(["1@10", "2@2", "3@3"]);
    expect(state.baseObjects.find((object) => object.id === T1)?.positionX).toBe(10);
  });
});

describe("a revision conflict while live", () => {
  const conflict = { expectedRevision: 2, currentRevision: 3, message: "changed" };

  it("refetches, rebases and saves again, keeping both people's work", async () => {
    setEditorLiveHooks(hooks());
    open([editor(T1, 10), editor(T2, 2), editor(T3, 3)], true);
    const conflictError = new Error("409");
    vi.mocked(configApi.parseRevisionConflict).mockImplementation((err) => err === conflictError ? conflict : null);
    vi.mocked(configApi.authBatchSave)
      .mockRejectedValueOnce(conflictError)
      .mockResolvedValueOnce({ objects: [wire(T1, 10), wire(T2, 20), wire(T3, 3)], revision: 4 });
    vi.mocked(configApi.getConfig).mockResolvedValueOnce(serverConfig(3, [wire(T1, 1), wire(T2, 20), wire(T3, 3)]));

    expect(await useEditorStore.getState().saveToServer(true)).toBe(true);
    const retry = vi.mocked(configApi.authBatchSave).mock.calls[1];
    expect(retry?.[2]).toBe(3);
    expect(retry?.[1].map((object) => object.positionX)).toEqual([10, 20, 3]);
    const state = useEditorStore.getState();
    expect(state.saveConflict).toBeNull();
    expect(state.configRevision).toBe(4);
  });

  it("reports a second conflict instead of looping", async () => {
    setEditorLiveHooks(hooks());
    open([editor(T1, 10), editor(T2, 2), editor(T3, 3)], true);
    const conflictError = new Error("409");
    vi.mocked(configApi.parseRevisionConflict).mockImplementation((err) => err === conflictError ? conflict : null);
    vi.mocked(configApi.authBatchSave).mockRejectedValue(conflictError);
    vi.mocked(configApi.getConfig).mockResolvedValue(serverConfig(3, [wire(T1, 1), wire(T2, 2), wire(T3, 3)]));

    expect(await useEditorStore.getState().saveToServer(true)).toBe(false);
    expect(vi.mocked(configApi.authBatchSave)).toHaveBeenCalledTimes(2);
    expect(useEditorStore.getState().saveConflict).not.toBeNull();
  });

  it("keeps today's behaviour when not live: report the conflict, fetch nothing", async () => {
    open([editor(T1, 10), editor(T2, 2), editor(T3, 3)], true);
    const conflictError = new Error("409");
    vi.mocked(configApi.parseRevisionConflict).mockImplementation((err) => err === conflictError ? conflict : null);
    vi.mocked(configApi.authBatchSave).mockRejectedValueOnce(conflictError);
    expect(await useEditorStore.getState().saveToServer(true)).toBe(false);
    expect(vi.mocked(configApi.getConfig)).not.toHaveBeenCalled();
    expect(useEditorStore.getState().saveConflict).toEqual(conflict);
  });
});

describe("live hooks", () => {
  it("hears every local change and every committed save with its id map", async () => {
    const live = hooks();
    setEditorLiveHooks(live);
    open(BASE, false);
    useEditorStore.getState().addObject(ASSET, 4, 0, 4);
    useEditorStore.getState().updateObject(T2, { positionX: 5 });
    useEditorStore.getState().removeObject(T3);
    expect(live.changes).toEqual([4, 4, 3]);

    const localId = useEditorStore.getState().objects.find((object) => object.id.startsWith("local-"))?.id ?? "";
    vi.mocked(configApi.authBatchSave).mockResolvedValueOnce({
      objects: [wire(T1, 1), wire(T2, 5), wire(T4, 4)],
      revision: 3,
    });
    await useEditorStore.getState().saveToServer(true);
    expect(live.saved).toHaveLength(1);
    expect(live.saved[0]?.[0]).toBe(3);
    expect(live.saved[0]?.[1].get(localId)).toBe(T4);
  });
});
