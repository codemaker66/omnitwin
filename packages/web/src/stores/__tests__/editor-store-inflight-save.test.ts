import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PlacedObject } from "../../api/configurations.js";
import { beginActionLogForConfig, useEditorStore } from "../editor-store.js";
import { useActionLogStore } from "../action-log-store.js";
import { useSelectionStore } from "../selection-store.js";

// ---------------------------------------------------------------------------
// An edit made while a save is in flight must survive it.
//
// saveToServer reads `objects` BEFORE its await and, on success, writes the
// server's echo of that pre-await batch straight back over the document:
//
//     set({ objects: serverObjects, isDirty: false, ... })
//
// The comment above it says it remaps "the latest state, not the snapshot
// captured before the await" — but `latest` is read only for `history` and
// `selectedObjectId`. So an object placed or moved during the round trip is:
//   1. reverted, because serverObjects predates it;
//   2. marked clean, so no autosave ever re-pushes it;
//   3. still on history.past, so undo would invert against a state that
//      never existed.
//
// That is a silent loss of the operator's work with ONE writer. It has to be
// closed before a second writer exists, because every collaborative design
// on top of this save path inherits it.
// ---------------------------------------------------------------------------

vi.mock("../../api/configurations.js", () => ({
  getConfig: vi.fn(),
  getPublicConfig: vi.fn(),
  createPublicConfig: vi.fn(),
  authBatchSave: vi.fn(),
  publicBatchSave: vi.fn(),
  parseRevisionConflict: vi.fn(() => null),
  updatePublicThumbnail: vi.fn(),
  claimConfig: vi.fn(),
  patchConfigMetadata: vi.fn(),
  submitGuestEnquiry: vi.fn(),
}));

vi.mock("../../api/spaces.js", () => ({
  getSpace: vi.fn(async () => Promise.reject(new Error("no space in tests"))),
}));

vi.mock("../../api/action-log.js", () => ({
  postActionBatch: vi.fn(() => Promise.resolve({ accepted: 0, duplicates: 0 })),
}));

const configApi = await import("../../api/configurations.js");

const TABLE_ID = "round-table-6ft";

function store(): ReturnType<typeof useEditorStore.getState> {
  return useEditorStore.getState();
}

function placed(id: string, sortOrder: number): PlacedObject {
  return {
    id,
    configurationId: "11111111-1111-4111-8111-111111111111",
    assetDefinitionId: TABLE_ID,
    positionX: "1.000",
    positionY: "0.000",
    positionZ: "2.000",
    rotationX: "0.000",
    rotationY: "0.000",
    rotationZ: "0.000",
    scale: "1.000",
    sortOrder,
    metadata: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    configId: "cfg-inflight",
    configRevision: 1,
    isPublicPreview: false,
    objects: [],
    history: { past: [], future: [] },
    selectedObjectId: null,
    isSaving: false,
    isDirty: false,
  });
  useSelectionStore.getState().clearSelection();
  useActionLogStore.getState().reset();
  beginActionLogForConfig("cfg-inflight");
});

describe("saveToServer does not discard work done during the round trip", () => {
  it("keeps an object placed while the save was in flight, and stays dirty so it is pushed", async () => {
    store().addObject(TABLE_ID, 1, 0, 2);
    expect(store().objects).toHaveLength(1);

    // Hold the response open so the operator can keep working mid-flight.
    let release: () => void = () => { /* replaced synchronously below */ };
    vi.mocked(configApi.authBatchSave).mockImplementation(
      () => new Promise((resolve) => {
        release = () => {
          resolve({ objects: [placed("55555555-5555-4555-8555-555555555555", 0)], revision: 2 });
        };
      }),
    );

    const saving = store().saveToServer(true);
    store().addObject(TABLE_ID, 8, 0, 9); // the operator keeps planning
    expect(store().objects).toHaveLength(2);

    release();
    await saving;

    // The second table must still be in the room...
    expect(store().objects).toHaveLength(2);
    // ...and the document must not claim to be saved, or nothing re-pushes it.
    expect(store().isDirty).toBe(true);
    // The revision the server gave us is still adopted — we are not behind.
    expect(store().configRevision).toBe(2);
  });

  it("adopts the server echo verbatim when nothing changed during the round trip", async () => {
    store().addObject(TABLE_ID, 1, 0, 2);

    vi.mocked(configApi.authBatchSave).mockResolvedValue({
      objects: [placed("66666666-6666-4666-8666-666666666666", 0)],
      revision: 2,
    });

    await store().saveToServer(true);

    // Unchanged behaviour on the quiet path: the server's ids and
    // normalisation win, and the document is genuinely clean.
    expect(store().objects).toHaveLength(1);
    expect(store().objects[0]?.id).toBe("66666666-6666-4666-8666-666666666666");
    expect(store().isDirty).toBe(false);
  });
});
