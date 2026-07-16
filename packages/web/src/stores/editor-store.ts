import { create } from "zustand";
import type { Scene } from "three";
import type { Space } from "../api/spaces.js";
import type { PlacedObject, BatchObjectInput } from "../api/configurations.js";
import * as configApi from "../api/configurations.js";
import * as spacesApi from "../api/spaces.js";
import {
  persistAnonymousPlannerDraft,
  readAnonymousPlannerDraft,
} from "../lib/anonymous-planner-draft.js";
import { getCatalogueItem } from "../lib/catalogue.js";
import { toRenderSpace, toRealWorld } from "../constants/scale.js";
import { generatePlacedId } from "../lib/placement.js";
import type { TableClothStyle, TableSettingStyle } from "../lib/placement.js";
import {
  diffObjects,
  emptyHistory,
  performRedo,
  performUndo,
  recordChange,
  remapHistoryIds,
} from "../lib/editor-history.js";
import type {
  EditorHistory,
  HistoryDelta,
  HistoryIdAdapter,
  HistoryStep,
  ObjectFieldPatch,
} from "../lib/editor-history.js";
import { useSelectionStore } from "./selection-store.js";
import { useAuthStore } from "./auth-store.js";
import { useActionLogStore } from "./action-log-store.js";
import { createActionEmitter } from "../lib/action-log.js";

// ---------------------------------------------------------------------------
// Editor object — local representation with numeric transforms
// ---------------------------------------------------------------------------

export interface EditorObject {
  readonly id: string;
  readonly assetDefinitionId: string;
  readonly positionX: number;
  readonly positionY: number;
  readonly positionZ: number;
  readonly rotationX: number;
  readonly rotationY: number;
  readonly rotationZ: number;
  readonly scale: number;
  readonly sortOrder: number;
  /** Whether a cloth is draped over this item (tables only). Persisted in metadata. */
  readonly clothed: boolean;
  /** Cloth style draped over this table. Persisted in metadata. */
  readonly clothStyle: TableClothStyle | null;
  /** Tableware style placed on this table. Persisted in metadata. */
  readonly tableSetting: TableSettingStyle | null;
  /** Group ID — items sharing a groupId move together. Persisted in metadata. */
  readonly groupId: string | null;
  /**
   * Hallkeeper-visible seat/table label rendered directly in the planner.
   * Persisted in metadata.displayLabel. Omitted when empty.
   */
  readonly label?: string;
  /**
   * Planner-authored note surfaced on the hallkeeper sheet ("VIP
   * table", "needs HDMI run"). Persisted in metadata. Empty string
   * when no note is attached.
   */
  readonly notes: string;
}

/**
 * Convert an API `PlacedObject` (wire format) to a local `EditorObject`.
 *
 * Scene-only state lives in the `metadata` JSON blob on the wire. We
 * extract it defensively here so malformed metadata from older records
 * degrades gracefully to default values.
 */
export function placedObjectToEditor(p: PlacedObject): EditorObject {
  const meta = p.metadata ?? {};
  const displayLabel = typeof meta.displayLabel === "string" ? meta.displayLabel.trim() : "";
  const clothStyle: TableClothStyle | null =
    meta.clothed === true
      ? meta.clothStyle === "white" ? "white" : "black"
      : null;
  const tableSetting: TableSettingStyle | null = meta.tableSetting === "dinner" ? "dinner" : null;
  const editorObject: EditorObject = {
    id: p.id,
    assetDefinitionId: p.assetDefinitionId,
    // Wire/DB is the real-metre source of truth; the editor store and R3F
    // scene work in render space (× RENDER_SCALE). Convert X/Z on the way in;
    // height (Y) is never render-scaled.
    positionX: toRenderSpace(parseFloat(p.positionX)),
    positionY: parseFloat(p.positionY),
    positionZ: toRenderSpace(parseFloat(p.positionZ)),
    rotationX: parseFloat(p.rotationX),
    rotationY: parseFloat(p.rotationY),
    rotationZ: parseFloat(p.rotationZ),
    scale: parseFloat(p.scale),
    sortOrder: p.sortOrder,
    clothed: meta.clothed === true,
    clothStyle,
    tableSetting,
    groupId: typeof meta.groupId === "string" ? meta.groupId : null,
    notes: typeof meta.notes === "string" ? meta.notes : "",
  };
  return displayLabel.length > 0
    ? { ...editorObject, label: displayLabel }
    : editorObject;
}

/**
 * Convert a local `EditorObject` to a `BatchObjectInput` for the wire.
 *
 * Scene-only state (clothed, groupId) is packed into the `metadata` blob
 * so it round-trips through the database without needing dedicated columns.
 */
export function editorToBatch(o: EditorObject): BatchObjectInput {
  const catalogueItem = getCatalogueItem(o.assetDefinitionId);
  return {
    id: o.id.startsWith("local-") ? undefined : o.id,
    assetDefinitionId: catalogueItem?.id ?? o.assetDefinitionId,
    // Store/scene is render space; the DB is the real-metre source of truth
    // (space polygon, widthM, and every server consumer are real metres).
    // Convert X/Z on the way out; height (Y) is never render-scaled.
    positionX: toRealWorld(o.positionX),
    positionY: o.positionY,
    positionZ: toRealWorld(o.positionZ),
    rotationX: o.rotationX,
    rotationY: o.rotationY,
    rotationZ: o.rotationZ,
    scale: o.scale,
    sortOrder: o.sortOrder,
    metadata: {
      clothed: o.clothed,
      clothStyle: o.clothed ? o.clothStyle ?? "black" : null,
      tableSetting: o.tableSetting,
      groupId: o.groupId,
      ...((o.label ?? "").trim().length > 0 ? { displayLabel: (o.label ?? "").trim() } : {}),
      ...(o.notes.length > 0 ? { notes: o.notes } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface EditorState {
  readonly configId: string | null;
  readonly spaceId: string | null;
  readonly venueId: string | null;
  readonly configRevision: number | null;
  readonly space: Space | null;
  readonly isPublicPreview: boolean;
  readonly objects: readonly EditorObject[];
  readonly selectedObjectId: string | null;
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  readonly lastSavedAt: Date | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  /**
   * Save-path error. Separated from `error` (which is load-path) because a
   * failed save must NOT swap the editor out to an error screen — that
   * unmounts the Canvas, loses the WebGL context, and drops whatever the
   * user just placed. The editor surfaces this as a non-destructive toast
   * and leaves the scene rendering.
   */
  readonly saveError: string | null;
  readonly saveConflict: configApi.RevisionConflict | null;
  // Punch list #24: the live Three.js scene ref, set by SceneProvider
  // inside the Canvas. Needed by the ortho-capture utility which runs
  // outside the Canvas (in SaveSendPanel) to generate the floor plan
  // diagram for the hallkeeper sheet PDF.
  readonly scene: Scene | null;
  /**
   * Command-sourced undo/redo timeline. One history spans the 3D scene
   * and the 2D blueprint because both funnel mutations through this
   * store. Cleared whenever a different document is loaded.
   */
  readonly history: EditorHistory<EditorObject>;
}

interface EditorActions {
  /**
   * Load a configuration by ID.
   *
   * The endpoint depends on `isAuthenticated`:
   *   - true  → `getConfig()`        — auth path, enforces ownership/venue access
   *   - false → `getPublicConfig()`  — public path, only returns public previews
   *
   * Punch list #2 / #33: previously this always called `getPublicConfig()`,
   * which (a) silently relied on the backend's permissive no-filter behavior
   * and (b) broke the moment that backend bug was fixed (claimed configs
   * 404'd because they're no longer public previews). Both bugs were
   * fixed together — this signature is the contract that pins it.
   */
  readonly loadConfiguration: (configId: string, isAuthenticated?: boolean) => Promise<void>;
  readonly loadSpace: (venueId: string, spaceId: string) => Promise<void>;
  readonly createPublicConfig: (spaceId: string) => Promise<string>;
  readonly addObject: (assetId: string, positionX: number, positionY: number, positionZ: number) => void;
  readonly updateObject: (objectId: string, transform: Partial<Pick<EditorObject, "positionX" | "positionY" | "positionZ" | "rotationX" | "rotationY" | "rotationZ" | "scale">>) => void;
  /**
   * Translate every object whose id is in `ids` by `(dx, dz)` in metre-
   * space. Used by group-aware moves (e.g. dragging a table in 2D moves
   * its grouped chairs by the same delta). Mirrors
   * `placement-store.moveItemsByDelta` so 2D and 3D moves behave the same.
   */
  readonly moveObjectsByDelta: (ids: ReadonlySet<string>, dx: number, dz: number) => void;
  /**
   * Set the planner's note on a placed object. Empty string clears.
   * Marks the editor dirty so the auto-save / batch flow picks it up
   * and rounds it through metadata.notes.
   */
  readonly setObjectNotes: (objectId: string, notes: string) => void;
  readonly removeObject: (objectId: string) => void;
  readonly selectObject: (id: string) => void;
  readonly deselectObject: () => void;
  /** Save to server. Uses public endpoint for preview configs, authenticated for claimed. */
  readonly saveToServer: (isAuthenticated?: boolean) => Promise<boolean>;
  /** Reload the server copy after an explicit conflict acknowledgement. */
  readonly reloadAfterConflict: (isAuthenticated?: boolean) => Promise<void>;
  /** Dismiss the current save-error toast. */
  readonly clearSaveError: () => void;
  readonly reset: () => void;
  /**
   * Replace the document from the 3D scene funnel (EditorBridge), recording
   * one undoable entry whose label is derived from the delta. Successive
   * drag frames within an interaction epoch coalesce into a single entry.
   */
  readonly replaceObjectsFromScene: (objects: readonly EditorObject[]) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  /**
   * Start a new interaction epoch. Called at drag start/end so distinct
   * gestures never coalesce, even when they happen in quick succession.
   */
  readonly bumpHistoryEpoch: () => void;
}

type EditorStore = EditorState & EditorActions;

let localIdCounter = 0;

// Auto-save is owned by EditorBridge — no internal debounce needed here.

// Punch list #18: cap on the `omnitwin_my_configs` audit log to prevent
// unbounded localStorage growth. 50 entries × ~80 bytes = ~4 KB total,
// safely under the 5 MB localStorage budget and large enough to cover a
// power user's recent history. FIFO eviction keeps the most recent entries.
const MAX_TRACKED_CONFIGS = 50;
const TRACKED_CONFIGS_KEY = "omnitwin_my_configs";

// ---------------------------------------------------------------------------
// History wiring — interaction epochs, selection capture, undo labels
// ---------------------------------------------------------------------------

/**
 * Pause (ms) after which consecutive continuous edits stop coalescing.
 * Drag frames arrive every ~16 ms, so a drag always stays one entry;
 * nudges separated by more than this become separate undo steps.
 */
const HISTORY_COALESCE_WINDOW_MS = 800;

const EDITOR_HISTORY_IDS: HistoryIdAdapter = {
  makeLocalId: generatePlacedId,
  isLocalId: (id) => id.startsWith("local-"),
};

// G4 Slice 1: every sealed gesture ALSO lands in the append-only action log
// (fire-and-forget — the undo timeline itself is unchanged). Surface stays
// "planner" until slice 2 threads the active band through; actor.ref is the
// signed-in user when present.
const actionEmitter = createActionEmitter<EditorObject>({
  emit: (action) => { useActionLogStore.getState().append(action); },
  context: () => ({
    actor: { kind: "operator", ref: useAuthStore.getState().user?.id },
    surface: "planner",
    makeId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  }),
});

/**
 * The action-log config boundary: gesture seqs restart at 1 on a fresh
 * (empty) timeline, so the emitter's seal cursor must reset together with
 * the log's configuration scope. One entry point keeps the two in lockstep
 * (loadConfiguration uses it; store-level tests mimic the boundary with it).
 */
export function beginActionLogForConfig(configId: string): void {
  actionEmitter.reset();
  useActionLogStore.getState().beginLog(configId);
}

let interactionEpoch = 0;
let lastRecordAt = Number.NEGATIVE_INFINITY;
let autosaveRequester: (() => void) | null = null;

/**
 * Register the auto-save scheduler (owned by EditorBridge) so undo/redo
 * can request a debounced save without the store importing the bridge.
 */
export function setEditorAutosaveRequester(requester: (() => void) | null): void {
  autosaveRequester = requester;
}

function currentEpoch(): number {
  const nowMs = Date.now();
  if (nowMs - lastRecordAt > HISTORY_COALESCE_WINDOW_MS) {
    interactionEpoch++;
  }
  lastRecordAt = nowMs;
  return interactionEpoch;
}

/**
 * The ids undo should re-select to put the user back where they were.
 * The 3D scene tracks multi-selection in the selection store; the 2D
 * blueprint tracks a single id on this store — prefer the richer one.
 */
function captureSelection(selectedObjectId: string | null): readonly string[] {
  const selected = useSelectionStore.getState().selectedIds;
  if (selected.size > 0) {
    return [...selected];
  }
  return selectedObjectId === null ? [] : [selectedObjectId];
}

const POSITION_KEYS: ReadonlySet<string> = new Set(["positionX", "positionY", "positionZ"]);
const ROTATION_KEYS: ReadonlySet<string> = new Set(["rotationX", "rotationY", "rotationZ"]);
const CLOTH_KEYS: ReadonlySet<string> = new Set(["clothed", "clothStyle"]);

function catalogueName(object: EditorObject): string {
  return getCatalogueItem(object.assetDefinitionId)?.name ?? "item";
}

function countNoun(verb: string, count: number): string {
  return count === 1 ? `${verb} item` : `${verb} ${String(count)} items`;
}

function describeUpdates(updated: readonly ObjectFieldPatch<EditorObject>[]): string {
  const keys = new Set<string>();
  for (const patch of updated) {
    for (const key of Object.keys(patch.after)) {
      keys.add(key);
    }
  }
  const within = (...sets: readonly ReadonlySet<string>[]): boolean =>
    [...keys].every((key) => sets.some((candidate) => candidate.has(key)));
  const count = updated.length;
  if (within(POSITION_KEYS)) return countNoun("Move", count);
  if (within(ROTATION_KEYS)) return countNoun("Rotate", count);
  if (within(POSITION_KEYS, ROTATION_KEYS)) return countNoun("Move", count);
  if (keys.size === 1) {
    if (keys.has("scale")) return countNoun("Resize", count);
    if (keys.has("notes")) return "Edit note";
    if (keys.has("label")) return countNoun("Rename", count);
    if (keys.has("tableSetting")) return "Change table setting";
    if (keys.has("groupId")) return "Update grouping";
  }
  if (within(CLOTH_KEYS)) return "Change tablecloth";
  return countNoun("Edit", count);
}

/** Human-readable label for an undo entry, derived from its delta. */
function describeDelta(delta: HistoryDelta<EditorObject>): string {
  const adds = delta.added.length;
  const removes = delta.removed.length;
  const updates = delta.updated.length;
  const firstAdded = delta.added[0];
  if (adds > 0 && removes === 0 && updates === 0) {
    return adds === 1 && firstAdded !== undefined
      ? `Place ${catalogueName(firstAdded.object)}`
      : `Place ${String(adds)} items`;
  }
  const firstRemoved = delta.removed[0];
  if (removes > 0 && adds === 0 && updates === 0) {
    return removes === 1 && firstRemoved !== undefined
      ? `Delete ${catalogueName(firstRemoved.object)}`
      : `Delete ${String(removes)} items`;
  }
  if (updates > 0 && adds === 0 && removes === 0) {
    return describeUpdates(delta.updated);
  }
  return "Rearrange items";
}

/**
 * Record a document change against the timeline, or return null when the
 * change is a no-op. Selection is captured live so undo can restore it.
 */
function recordedHistory(
  history: EditorHistory<EditorObject>,
  selectedObjectId: string | null,
  before: readonly EditorObject[],
  after: readonly EditorObject[],
  selectionAfter?: readonly string[],
): EditorHistory<EditorObject> | null {
  const delta = diffObjects(before, after);
  if (delta === null) {
    return null;
  }
  const selection = captureSelection(selectedObjectId);
  const next = recordChange(history, {
    before,
    after,
    label: describeDelta(delta),
    epoch: currentEpoch(),
    selectionBefore: selection,
    selectionAfter: selectionAfter ?? selection,
  });
  // G4: an append over the previous top seals that gesture into the log.
  actionEmitter.afterRecord(history, next);
  return next;
}

function historyStepPatch(step: HistoryStep<EditorObject>): Partial<EditorState> {
  return {
    history: step.history,
    objects: step.objects,
    isDirty: true,
    selectedObjectId: step.selection[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const INITIAL_STATE: EditorState = {
  configId: null,
  spaceId: null,
  venueId: null,
  configRevision: null,
  space: null,
  isPublicPreview: false,
  objects: [],
  selectedObjectId: null,
  isDirty: false,
  isSaving: false,
  lastSavedAt: null,
  isLoading: false,
  error: null,
  saveError: null,
  saveConflict: null,
  scene: null,
  history: emptyHistory<EditorObject>(),
};

export const useEditorStore = create<EditorStore>((set, get) => ({
  ...INITIAL_STATE,

  loadConfiguration: async (configId, isAuthenticated) => {
    set({ isLoading: true, error: null });
    try {
      const config = isAuthenticated === true
        ? await configApi.getConfig(configId)
        : await configApi.getPublicConfig(configId);
      const serverObjects = (config.objects ?? []).map(placedObjectToEditor);
      const localDraft = config.isPublicPreview
        ? readAnonymousPlannerDraft(config.id, {
          spaceId: config.spaceId,
          venueId: config.venueId,
          baseRevision: config.revision,
        })
        : null;
      const objects = localDraft?.objects ?? serverObjects;
      const restoredAnonymousDraft = localDraft !== null;
      // G4: capture the outgoing timeline at the LAST moment before the
      // reset — a gesture landing during the awaits above advances the live
      // history, and a stale snapshot would lose it (reviewer HIGH).
      const previousHistory = get().history;
      set({
        configId: config.id,
        spaceId: config.spaceId,
        venueId: config.venueId,
        configRevision: config.revision,
        isPublicPreview: config.isPublicPreview,
        objects,
        isDirty: restoredAnonymousDraft,
        isLoading: false,
        saveConflict: null,
        history: emptyHistory<EditorObject>(),
      });
      // G4: config boundary — seal any open gesture from the previous
      // config's timeline, then open the new configuration's log.
      actionEmitter.flush(previousHistory);
      beginActionLogForConfig(config.id);
      // Load space data (name, dimensions) for room geometry rendering.
      // venueId/spaceId are non-nullable on the wire — no guard needed.
      void get().loadSpace(config.venueId, config.spaceId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load configuration";
      set({ isLoading: false, error: message });
    }
  },

  loadSpace: async (venueId, spaceId) => {
    try {
      const space = await spacesApi.getSpace(venueId, spaceId);
      set({ space, spaceId, venueId });
    } catch {
      // Non-critical — space data is for display
    }
  },

  createPublicConfig: async (spaceId) => {
    set({ isLoading: true, error: null });
    try {
      const config = await configApi.createPublicConfig(spaceId);
      set({
        configId: config.id,
        spaceId: config.spaceId,
        venueId: config.venueId,
        configRevision: config.revision,
        isPublicPreview: true,
        objects: [],
        isDirty: false,
        isLoading: false,
        saveConflict: null,
        history: emptyHistory<EditorObject>(),
      });

      // Load space data for room geometry rendering.
      // venueId/spaceId are non-nullable on the wire — no guard needed.
      void get().loadSpace(config.venueId, config.spaceId);

      // Track in localStorage with a bounded cap (FIFO eviction). Without
      // the cap, every public config creation appended to an unbounded
      // array — slow JSON.parse over time, contention with other clients
      // of the localStorage budget, and an unhandled QuotaExceededError
      // path if the budget filled up. The try/catch also covers private-
      // browsing modes where localStorage throws on write. Tracking is
      // best-effort; the createPublicConfig flow must NOT fail if
      // persistence is unavailable.
      try {
        const stored = JSON.parse(localStorage.getItem(TRACKED_CONFIGS_KEY) ?? "[]") as { configId: string; createdAt: string }[];
        stored.push({ configId: config.id, createdAt: new Date().toISOString() });
        const capped = stored.length > MAX_TRACKED_CONFIGS
          ? stored.slice(stored.length - MAX_TRACKED_CONFIGS)
          : stored;
        localStorage.setItem(TRACKED_CONFIGS_KEY, JSON.stringify(capped));
      } catch {
        // localStorage unavailable or quota exceeded — silently skip.
      }

      return config.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create configuration";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  addObject: (assetId, positionX, positionY, positionZ) => {
    const s = get();
    const obj: EditorObject = {
      id: `local-${String(++localIdCounter)}`,
      assetDefinitionId: assetId,
      positionX, positionY, positionZ,
      rotationX: 0, rotationY: 0, rotationZ: 0,
      scale: 1, sortOrder: s.objects.length,
      clothed: false, clothStyle: null, tableSetting: null, groupId: null, notes: "",
    };
    const after = [...s.objects, obj];
    set({
      objects: after,
      isDirty: true,
      history: recordedHistory(s.history, s.selectedObjectId, s.objects, after) ?? s.history,
    });
  },

  updateObject: (objectId, transform) => {
    const s = get();
    const after = s.objects.map((o) => o.id === objectId ? { ...o, ...transform } : o);
    set({
      objects: after,
      isDirty: true,
      history: recordedHistory(s.history, s.selectedObjectId, s.objects, after) ?? s.history,
    });
  },

  moveObjectsByDelta: (ids, dx, dz) => {
    if (ids.size === 0) return;
    if (dx === 0 && dz === 0) return;
    const s = get();
    const after = s.objects.map((o) =>
      ids.has(o.id)
        ? { ...o, positionX: o.positionX + dx, positionZ: o.positionZ + dz }
        : o,
    );
    set({
      objects: after,
      isDirty: true,
      history: recordedHistory(s.history, s.selectedObjectId, s.objects, after) ?? s.history,
    });
  },

  setObjectNotes: (objectId, notes) => {
    const s = get();
    const after = s.objects.map((o) => o.id === objectId ? { ...o, notes } : o);
    set({
      objects: after,
      isDirty: true,
      history: recordedHistory(s.history, s.selectedObjectId, s.objects, after) ?? s.history,
    });
  },

  removeObject: (objectId) => {
    const s = get();
    const after = s.objects.filter((o) => o.id !== objectId);
    const selectionAfter = captureSelection(s.selectedObjectId).filter((id) => id !== objectId);
    set({
      objects: after,
      isDirty: true,
      selectedObjectId: s.selectedObjectId === objectId ? null : s.selectedObjectId,
      history: recordedHistory(s.history, s.selectedObjectId, s.objects, after, selectionAfter) ?? s.history,
    });
  },

  selectObject: (id) => { set({ selectedObjectId: id }); },
  deselectObject: () => { set({ selectedObjectId: null }); },

  saveToServer: async (isAuthenticated) => {
    const { configId, configRevision, objects, isSaving, isPublicPreview } = get();
    if (configId === null || isSaving) return false;
    // G4: a save is a gesture boundary — seal the open gesture into the log.
    // Deliberately before the revision guard below: the local gesture
    // happened regardless of whether this save can proceed.
    actionEmitter.flush(get().history);
    if (configRevision === null) {
      set({
        saveError: "Cannot save because the layout revision is missing. Reload the layout and try again.",
        saveConflict: null,
      });
      return false;
    }

    // Determine save path: use authenticated endpoint if config is claimed
    // (isPublicPreview=false) OR if caller explicitly says authenticated.
    // Public preview configs always use the public endpoint.
    const useAuthPath = !isPublicPreview || isAuthenticated === true;

    set({ isSaving: true, saveError: null, saveConflict: null });
    try {
      const batch = objects.map(editorToBatch);
      let saved: configApi.BatchSaveResponse;
      if (useAuthPath) {
        saved = await configApi.authBatchSave(configId, batch, configRevision);
      } else {
        saved = await configApi.publicBatchSave(configId, batch, configRevision);
      }
      const serverObjects = saved.objects.map(placedObjectToEditor);
      // Whole-history id remap: zip the local ids we sent (batch order)
      // with the rows the server inserted (echoed updates-first, then
      // inserts, each in input order). If they cannot be aligned the
      // timeline can no longer be trusted — clear it rather than risk
      // undo resurrecting rows under dead ids.
      const sentLocalIds = objects.map((o) => o.id).filter((id) => EDITOR_HISTORY_IDS.isLocalId(id));
      const sentServerIds = new Set(objects.map((o) => o.id).filter((id) => !EDITOR_HISTORY_IDS.isLocalId(id)));
      const insertedIds = saved.objects.map((p) => p.id).filter((id) => !sentServerIds.has(id));
      const idMap = new Map<string, string>();
      const aligned = sentLocalIds.length === insertedIds.length;
      if (aligned) {
        sentLocalIds.forEach((localId, i) => {
          const serverId = insertedIds[i];
          if (serverId !== undefined) {
            idMap.set(localId, serverId);
          }
        });
      }
      // The user may have kept editing while the request was in flight —
      // remap the latest state, not the snapshot captured before the await.
      const latest = get();
      const selection = useSelectionStore.getState();
      if ([...selection.selectedIds].some((id) => idMap.has(id))) {
        selection.selectMultiple([...selection.selectedIds].map((id) => idMap.get(id) ?? id));
      }
      set({
        objects: serverObjects,
        history: aligned ? remapHistoryIds(latest.history, idMap) : emptyHistory<EditorObject>(),
        selectedObjectId: latest.selectedObjectId === null
          ? null
          : idMap.get(latest.selectedObjectId) ?? latest.selectedObjectId,
        configRevision: saved.revision,
        isDirty: false,
        isSaving: false,
        lastSavedAt: new Date(),
        saveConflict: null,
      });
      return true;
    } catch (err) {
      const conflict = configApi.parseRevisionConflict(err);
      if (conflict !== null) {
        set({
          isSaving: false,
          saveError: "This layout changed in another tab. Reload the server copy before saving again.",
          saveConflict: conflict,
        });
        return false;
      }
      const message = err instanceof Error ? err.message : "Save failed";
      // Log the failing payload so we can see which field the server rejects.
      // Safe to log — no PII in the placed-object batch.
      // eslint-disable-next-line no-console
      console.error("[editor-store] save failed:", message, { objects });
      // Set saveError (NOT error) — leaving `error: null` keeps EditorPage's
      // main render path alive, so the Canvas stays mounted and the user
      // doesn't lose their in-progress layout.
      set({ isSaving: false, saveError: message, saveConflict: null });
      return false;
    }
  },

  reloadAfterConflict: async (isAuthenticated) => {
    const configId = get().configId;
    if (configId === null) return;
    set({ saveError: null, saveConflict: null });
    await get().loadConfiguration(configId, isAuthenticated);
  },

  clearSaveError: () => { set({ saveError: null, saveConflict: null }); },

  reset: () => {
    // Preserve the scene ref — reset clears editor data but the Three.js
    // scene is still alive in the Canvas. SceneProvider manages the ref.
    set({ ...INITIAL_STATE, scene: get().scene });
  },

  replaceObjectsFromScene: (objects) => {
    const s = get();
    const history = recordedHistory(s.history, s.selectedObjectId, s.objects, objects);
    if (history === null) return;
    set({ objects, isDirty: true, history });
  },

  undo: () => {
    const s = get();
    const step = performUndo(s.history, s.objects, EDITOR_HISTORY_IDS);
    if (step === null) return;
    actionEmitter.afterUndo(s.history); // G4: seals the popped gesture + logs history.undo
    interactionEpoch++;
    set(historyStepPatch(step));
    useSelectionStore.getState().selectMultiple(step.selection);
    autosaveRequester?.();
  },

  redo: () => {
    const s = get();
    const step = performRedo(s.history, s.objects, EDITOR_HISTORY_IDS);
    if (step === null) return;
    actionEmitter.afterRedo(step.history); // G4: logs history.redo
    interactionEpoch++;
    set(historyStepPatch(step));
    useSelectionStore.getState().selectMultiple(step.selection);
    autosaveRequester?.();
  },

  bumpHistoryEpoch: () => {
    interactionEpoch++;
  },
}));

useEditorStore.subscribe((state, previous) => {
  if (
    state.configId === previous.configId
    && state.spaceId === previous.spaceId
    && state.venueId === previous.venueId
    && state.configRevision === previous.configRevision
    && state.isPublicPreview === previous.isPublicPreview
    && state.objects === previous.objects
    && state.isDirty === previous.isDirty
  ) {
    return;
  }

  persistAnonymousPlannerDraft({
    configId: state.configId,
    spaceId: state.spaceId,
    venueId: state.venueId,
    configRevision: state.configRevision,
    isPublicPreview: state.isPublicPreview,
    objects: state.objects,
    isDirty: state.isDirty,
  });
});
