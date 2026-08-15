import { describe, it, expect, beforeEach, vi } from "vitest";
import { beginActionLogForConfig, useEditorStore } from "../editor-store.js";
import { useActionLogStore } from "../action-log-store.js";
import { useSelectionStore } from "../selection-store.js";

// ---------------------------------------------------------------------------
// The recorder must survive every reset-to-empty.
//
// createActionEmitter seals a gesture by its engine-assigned `seq` and keeps
// a high-water mark:
//
//     if (entry.seq <= lastSealedSeq) return;   // action-log.ts
//
// Gesture seqs are derived from the history, so they RESTART AT 1 whenever
// the history is replaced with emptyHistory(). If the emitter's cursor is not
// reset at the same moment, every gesture that follows scores at or below the
// stale mark and is dropped — silently. The room keeps working; the trail
// simply stops recording. The emitter's own doc comment states the contract:
// reset() "MUST be called whenever the history is reset to empty".
//
// editor-store installs emptyHistory<EditorObject>() at four sites but calls
// actionEmitter.reset() (via beginActionLogForConfig) at only one of them —
// loadConfiguration. These tests pin the other three. Each asserts the
// invariant behaviourally: after the boundary, a completed gesture must still
// reach the log. They are deliberately blind to HOW the store satisfies it.
//
// Each baseline is taken AFTER the boundary operation, never before it. That
// is load-bearing: saveToServer calls actionEmitter.flush() before its await,
// which legitimately seals the open gesture and appends an entry. Measuring
// from before the save would let that flush satisfy the assertion and the
// test would pass while the recorder was still deaf — green for the wrong
// reason, which is worse than no test at all.
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

function loggedCount(): number {
  return useActionLogStore.getState().entries.length;
}

/** Two placements: the first gesture seals, the second stays open as the top.
 *  So a healthy recorder gains at least one entry per call. */
function twoGestures(): void {
  store().addObject(TABLE_ID, 1, 0, 2);
  store().addObject(TABLE_ID, 3, 0, 4);
}

interface PlacedRow {
  readonly id: string;
  readonly configurationId: string;
  readonly assetDefinitionId: string;
  readonly positionX: string;
  readonly positionY: string;
  readonly positionZ: string;
  readonly rotationX: string;
  readonly rotationY: string;
  readonly rotationZ: string;
  readonly scale: string;
  readonly sortOrder: number;
  readonly metadata: Record<string, unknown> | null;
}

function placed(id: string, sortOrder: number): PlacedRow {
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
    configId: "cfg-recorder",
    configRevision: 1,
    isPublicPreview: false,
    objects: [],
    history: { past: [], future: [] },
    selectedObjectId: null,
  });
  useSelectionStore.getState().clearSelection();
  useActionLogStore.getState().reset();
  beginActionLogForConfig("cfg-recorder");
});

describe("the recorder survives every reset-to-empty", () => {
  it("keeps recording after reset() clears the editor", () => {
    twoGestures();
    expect(loggedCount()).toBeGreaterThan(0); // sanity: the recorder works at all

    store().reset(); // installs INITIAL_STATE, whose history is emptyHistory()
    // reset() is followed by a fresh session on the same open log; restore the
    // config scope the way the app does, WITHOUT re-opening the log, so the
    // only variable under test is the emitter's seal cursor.
    useEditorStore.setState({ configId: "cfg-recorder", configRevision: 1 });
    const atBoundary = loggedCount();

    twoGestures();

    expect(loggedCount()).toBeGreaterThan(atBoundary);
  });

  it("keeps recording after createPublicConfig() opens a fresh draft", async () => {
    twoGestures();

    vi.mocked(configApi.createPublicConfig).mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      spaceId: "33333333-3333-4333-8333-333333333333",
      venueId: "44444444-4444-4444-8444-444444444444",
      revision: 1,
      isPublicPreview: true,
    } as unknown as Awaited<ReturnType<typeof configApi.createPublicConfig>>);

    await store().createPublicConfig("33333333-3333-4333-8333-333333333333");
    const atBoundary = loggedCount();

    twoGestures();

    expect(loggedCount()).toBeGreaterThan(atBoundary);
  });

  it("keeps recording after a save whose ids cannot be aligned wipes the timeline", async () => {
    // One local object goes up; the server echoes THREE inserted rows, so
    // `aligned` is false and the store clears the timeline rather than risk
    // undo resurrecting rows under dead ids. That is correct — but the
    // recorder must not go deaf for the rest of the session because of it.
    twoGestures();

    vi.mocked(configApi.authBatchSave).mockResolvedValue({
      objects: [
        placed("55555555-5555-4555-8555-555555555555", 0),
        placed("66666666-6666-4666-8666-666666666666", 1),
        placed("77777777-7777-4777-8777-777777777777", 2),
      ],
      revision: 2,
    } as unknown as Awaited<ReturnType<typeof configApi.authBatchSave>>);

    await store().saveToServer(true);
    expect(store().history.past).toHaveLength(0); // the timeline was cleared
    // AFTER the save, so the flush at editor-store.ts:646 cannot be mistaken
    // for the recorder still working.
    const atBoundary = loggedCount();

    twoGestures();

    expect(loggedCount()).toBeGreaterThan(atBoundary);
  });
});
