import { create, type StateCreator } from "zustand";
import type { Scene } from "three";
import { isPlannerEditable, type ConfigurationReviewStatus } from "@omnitwin/types";
import type { Space } from "../api/spaces.js";
import type { PlacedObject, BatchObjectInput } from "../api/configurations.js";
import * as configApi from "../api/configurations.js";
import { parseRevisionConflict, type RevisionConflict } from "../api/configuration-conflict.js";
import { ApiError } from "../api/client.js";
import * as spacesApi from "../api/spaces.js";
import {
  discardPlannerDraft,
  persistAnonymousPlannerDraft,
  plannerDraftBaseObjects,
  plannerDraftKeyFor,
  readAnonymousPlannerDraft,
  type AnonymousPlannerDraft,
} from "../lib/anonymous-planner-draft.js";
import { holdPlannerPageLock, isPlannerPageOpen, plannerPageId } from "../lib/planner-page-lock.js";
import { signedOutOwnerFrom } from "../lib/planner-draft-storage.js";
import { summariseLayoutChange, type LayoutChangeSummary } from "../lib/layout-change-summary.js";
import { browserSaysOnline, readOnlineStatus, subscribeOnlineStatus } from "../lib/online-status.js";
import { useAuthStore, type AuthUser } from "./auth-store.js";
import { getCatalogueItem } from "../lib/catalogue.js";
import { normalizeFurnitureScale } from "../lib/furniture-scale.js";
import { isTableDressingApplicator } from "../lib/table-dressing.js";
import { toRenderSpace, toRealWorld } from "../constants/scale.js";
import { generatePlacedId } from "../lib/placement.js";
import type { TableClothStyle, TableSettingStyle } from "../lib/placement.js";
import {
  diffObjects,
  emptyHistory,
  forgetHistoryIds,
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
import { useCockpitStore } from "./cockpit-store.js";
import { useActionLogStore } from "./action-log-store.js";
import { createActionEmitter } from "../lib/action-log.js";
import { plannerActionContext } from "./planner-action-log.js";
import { flushActionLog } from "./action-log-sync.js";
import { postActionBatch } from "../api/action-log.js";
import { isLayoutTimelineMutationLocked, onLayoutTimelineMutationLockChange } from "../lib/layout-timeline-preview-lock.js";
import { createOneShotHandoff } from "../lib/one-shot-handoff.js";
import { changedBetween, locallyModifiedIds, rebaseOntoServer } from "../lib/layout-live/live-document.js";

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
  /** DRESSING (C2): chair style dressed around this table. Persisted in metadata. */
  readonly chairStyle: string | null;
  /** DRESSING (C2): the centrepiece on this table. Persisted in metadata. */
  readonly centerpiece: string | null;
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
    scale: normalizeFurnitureScale(parseFloat(p.scale)),
    sortOrder: p.sortOrder,
    clothed: meta.clothed === true,
    clothStyle,
    tableSetting,
    chairStyle:
      typeof meta.chairStyle === "string" && meta.chairStyle.trim().length > 0
        ? meta.chairStyle.trim().slice(0, 40)
        : null,
    centerpiece:
      typeof meta.centerpiece === "string" && meta.centerpiece.trim().length > 0
        ? meta.centerpiece.trim().slice(0, 80)
        : null,
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
    scale: normalizeFurnitureScale(o.scale),
    sortOrder: o.sortOrder,
    metadata: {
      clothed: o.clothed,
      clothStyle: o.clothed ? o.clothStyle ?? "black" : null,
      tableSetting: o.tableSetting,
      chairStyle: o.chairStyle,
      centerpiece: o.centerpiece,
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
  /**
   * What this layout is called, as the server has it. The API always returned
   * it; the store dropped it, which is why the phone's top bar carried a
   * hard-coded draft name. Null until a configuration loads, never a placeholder.
   */
  readonly configName: string | null;
  /** The loaded layout is one of the venue's templates (a sample layout),
   *  as the server says; false when it is not, or not said. */
  readonly isTemplate: boolean;
  readonly spaceId: string | null;
  readonly venueId: string | null;
  readonly configRevision: number | null;
  readonly space: Space | null;
  /** The last read of the open room's space failed, so `space` stays null
   *  until another load: surfaces stop showing a working state for it. */
  readonly spaceLoadFailed: boolean;
  readonly isPublicPreview: boolean;
  readonly objects: readonly EditorObject[];
  /**
   * The last document the server confirmed for this configuration (load,
   * save echo, adopted refetch). Live co-editing rebases local edits from
   * it; it is never sent anywhere. A restored anonymous draft keeps the
   * server's objects here, not the draft's.
   */
  readonly baseObjects: readonly EditorObject[];
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
  /** The ApiError code of the save failure beside `saveError`
   *  (NETWORK_ERROR, UNAUTHORIZED, CONFIG_LOCKED, REVISION_CONFLICT, ...);
   *  null when there is none or the failure was not an API error. */
  readonly saveErrorCode: string | null;
  readonly saveConflict: EditorSaveConflict | null;
  /** How many objects differ from `baseObjects` right now: changed, placed
   *  or removed (objects, not edits). Kept live with every change. */
  readonly pendingChanges: number;
  /** `pendingChanges` as it was when the save in flight started, so
   *  "Saving · 2 changes" never drops mid-request; null when not saving. */
  readonly savingChanges: number | null;
  /** The browser's network, from navigator.onLine and its online/offline
   *  events. A save that fails for want of a network while this is false is
   *  offline, not failed: no `saveError`, the work stays dirty. */
  readonly isOnline: boolean;
  /** The current unsaved work is stored on this device (localStorage) and
   *  will be offered again after a reload. False when nothing is unsaved,
   *  the browser refused the write, the layout is over the size cap, or a
   *  pointer gesture's frames are still to be written at its end. */
  readonly keptOnDevice: boolean;
  /** The layout's review state as the server last said (load, live refetch,
   *  the review panel); null for guest previews and before it is known. */
  readonly reviewStatus: ConfigurationReviewStatus | null;
  /** The server refused this layout's last save as CONFIG_LOCKED. Cleared by
   *  a load, a successful save, or an editable review status. */
  readonly reviewLockRefused: boolean;
  /** Why this layout is view-only now, or null when it is editable.
   *  "phase-preview": a frozen timeline phase is being previewed (edits are
   *  blocked). "in-review": submitted or under review, or the server refused
   *  a save as CONFIG_LOCKED (admins are never locked by status). The store
   *  does not block edits for "in-review"; the server refuses the save. */
  readonly lockReason: EditorLockReason | null;
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
  readonly createPublicConfig: (spaceId: string, shouldOpen?: () => boolean) => Promise<string>;
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
  /** DRESSING (C2): set the chair style and/or centrepiece on a placement.
   *  Empty strings clear. Same undo/dirty semantics as setObjectNotes. */
  readonly setObjectDressing: (
    objectId: string,
    patch: { readonly chairStyle?: string | null; readonly centerpiece?: string | null },
  ) => void;
  readonly removeObject: (objectId: string) => void;
  readonly selectObject: (id: string) => void;
  readonly deselectObject: () => void;
  /** Save to server. Uses public endpoint for preview configs, authenticated for claimed. */
  readonly saveToServer: (isAuthenticated?: boolean) => Promise<boolean>;
  /** Reload the server copy after an explicit conflict acknowledgement.
   *  This device's copy of the layout's unsaved work is discarded first, or
   *  the reload would restore it over the version the person chose. */
  readonly reloadAfterConflict: (isAuthenticated?: boolean) => Promise<void>;
  /** "Show her version": reloadAfterConflict under a plain name (the
   *  signed-in state is read from the auth store when not given). */
  readonly showTheirVersion: (isAuthenticated?: boolean) => Promise<void>;
  /**
   * "Keep mine": save this document over the newer revision. The batch save
   * is a full sync, so the base revision becomes the conflict's current one
   * and the whole document goes; the other version stays on the server as
   * its revision row (History). An object of mine their version no longer
   * has is placed again (a new row), never dropped. The save reports a third
   * version as a fresh conflict, live room or not. True when the save landed
   * (the conflict is then cleared and the document on screen is what was
   * kept); false with nothing to keep, when their version cannot be read, or
   * when the save did not land (the conflict stays, and a newer one, an
   * offline state or the save error says why).
   */
  readonly keepMine: (isAuthenticated?: boolean) => Promise<boolean>;
  /** The review state the review panel read or set for this layout. */
  readonly setReviewStatus: (configId: string, status: ConfigurationReviewStatus | null) => void;
  /**
   * Live co-editing: take a refetched server document. Clean → adopted
   * wholesale; dirty → this client's edits rebased onto it object by object
   * (rebaseOntoServer). Refused while a save is in flight or a pointer
   * gesture owns the document ("busy" — retry after), and for a revision no
   * newer than the one held ("stale"). While a conflict waits for the
   * person's choice nothing is merged ("held"): a newer copy becomes the
   * version they are shown and kept against, and this document stays as it is.
   */
  readonly adoptServerConfiguration: (config: configApi.Configuration, options?: AdoptOptions) => AdoptOutcome;
  /**
   * Live co-editing: a later remote write took these objects. Local state for
   * each goes back to the server base and stays tied to it until this person
   * edits the object again, so this client's saves never overwrite the
   * later write with an older local value. Not an undoable change.
   */
  readonly yieldObjectsToRemote: (ids: readonly string[]) => void;
  /** Dismiss the current save-error toast. A conflict is not dismissed with
   *  it: only the person's choice (keepMine, showTheirVersion) ends one. */
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
  /** One pointer-held transform, including pauses and its final grid settle. */
  readonly beginHistoryGesture: () => symbol | null;
  readonly endHistoryGesture: (token: symbol) => void;
  readonly isHistoryGestureCurrent: (token: symbol) => boolean;
  /** Accepted save-response ID remaps for this still-owned pointer gesture. */
  readonly historyGestureIdMap: (token: symbol) => ReadonlyMap<string, string> | null;
}

type EditorStore = EditorState & EditorActions;

/** A save met a newer revision: the server's facts plus what this client
 *  derived from the newer version it then read. */
export interface EditorSaveConflict extends RevisionConflict {
  /** The newer revision is this signed-in person's own (another tab or
   *  device); false for guests and whenever the author is not known. */
  readonly byYou: boolean;
  /** What the newer revision changed against the version this editor was
   *  working from (`baseObjects`); null when that version could not be read
   *  or the server had moved on again by the time it was. */
  readonly theirChange: LayoutChangeSummary | null;
}

export type EditorLockReason = "phase-preview" | "in-review";

export interface AdoptOptions {
  /** The 409 retry holds isSaving through its own refetch; only it may adopt then. */
  readonly whileSaving?: boolean;
  /** Ask for the autosave when rebased edits remain (default true). */
  readonly requestSave?: boolean;
}

export type AdoptOutcome =
  | { readonly status: "adopted" | "rebased"; readonly lostToRemoteDelete: readonly EditorObject[] }
  | { readonly status: "stale" | "busy" | "ignored" | "held" };

/** Live co-editing hooks, registered by the live client while connected. */
export interface EditorLiveHooks {
  /** Every local document change (gesture frames included), before → after. */
  readonly onLocalChange: (before: readonly EditorObject[], after: readonly EditorObject[]) => void;
  /** A save committed; idMap holds local-id → server-id for new placements. */
  readonly onSaved: (revision: number, idMap: ReadonlyMap<string, string>) => void;
}

let liveHooks: EditorLiveHooks | null = null;
/** "rebase": a 409 refetches, rebases and retries once (live co-editing).
 *  "report": today's behaviour — surface the conflict and wait. */
let conflictPolicy: "report" | "rebase" = "report";
/** Depth of the 409 rebase-and-retry in progress: one retry per save. */
let rebaseRetryDepth = 0;
/** Objects a later remote write owns; kept equal to base until re-edited. */
const yieldedIds = new Set<string>();

/** Hooks are present only while in the live room. */
export function setEditorLiveHooks(hooks: EditorLiveHooks | null): void {
  liveHooks = hooks;
}

/** "rebase" while the live client is mounted — connected or reconnecting — so
 *  a 409 during a dropped connection rebases instead of offering a reload
 *  that would discard this person's work. */
export function setEditorConflictPolicy(policy: "report" | "rebase"): void {
  conflictPolicy = policy;
}

/** Whether a pointer gesture owns the open document right now (live
 *  co-editing defers remote writes to the object being dragged). */
export function isEditorGestureActive(): boolean {
  return gestureOwnsCurrentDocument();
}

/** The objects currently yielded to a later remote write (tests, live UI). */
export function editorYieldedIds(): ReadonlySet<string> {
  return yieldedIds;
}

function notifyLocalChange(before: readonly EditorObject[], after: readonly EditorObject[]): void {
  if (before === after) return;
  if (yieldedIds.size > 0) {
    const prior = new Map(before.map((object) => [object.id, object]));
    for (const object of after) {
      // Re-edited by this person: it is theirs again (their write is later).
      if (yieldedIds.has(object.id) && prior.get(object.id) !== object) yieldedIds.delete(object.id);
    }
  }
  liveHooks?.onLocalChange(before, after);
}

/** Keep yielded objects equal to the server's copy. */
function snapYieldedToBase(objects: readonly EditorObject[], base: readonly EditorObject[]): readonly EditorObject[] {
  if (yieldedIds.size === 0) return objects;
  const baseById = new Map(base.map((object) => [object.id, object]));
  const next: EditorObject[] = [];
  for (const object of objects) {
    if (!yieldedIds.has(object.id)) {
      next.push(object);
      continue;
    }
    const confirmed = baseById.get(object.id);
    if (confirmed !== undefined) next.push(confirmed);
  }
  return next;
}

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
// (fire-and-forget — the undo timeline itself is unchanged). Actor/surface
// stamping is shared with the direct-surface seams via plannerActionContext.
const actionEmitter = createActionEmitter<EditorObject>({
  emit: (action) => { useActionLogStore.getState().append(action); },
  context: plannerActionContext,
});

/**
 * The action-log config boundary: gesture seqs restart at 1 on a fresh
 * (empty) timeline, so the emitter's seal cursor must reset together with
 * the log's configuration scope. One entry point keeps the two in lockstep
 * (loadConfiguration uses it; store-level tests mimic the boundary with it).
 */
export function beginActionLogForConfig(configId: string): void {
  activeHistoryGesture = null;
  interactionEpoch++;
  actionEmitter.reset();
  useActionLogStore.getState().beginLog(configId);
}

/** Fire-and-forget flush of the log's unsent tail to the API (G4 slice 3).
 *  flushActionLog snapshots the store synchronously, swallows failures, and
 *  drops late acks after a config switch — safe on every boundary. */
function flushActionLogToServer(revision: number): void {
  void flushActionLog({ revision, post: postActionBatch });
}

let interactionEpoch = 0;
let lastRecordAt = Number.NEGATIVE_INFINITY;
let autosaveRequester: (() => void) | null = null;
let activeHistoryGesture: {
  readonly token: symbol;
  readonly epoch: number;
  readonly configId: string | null;
  readonly spaceId: string | null;
  readonly venueId: string | null;
  readonly session: number;
  readonly objectIds: ReadonlyMap<string, string>;
} | null = null;

function gestureOwnsCurrentDocument(): boolean {
  const current = useEditorStore.getState();
  return activeHistoryGesture !== null
    && activeHistoryGesture.session === configurationSession
    && activeHistoryGesture.configId === current.configId
    && activeHistoryGesture.spaceId === current.spaceId
    && activeHistoryGesture.venueId === current.venueId;
}

/**
 * Register the auto-save scheduler (owned by EditorBridge) so undo/redo
 * can request a debounced save without the store importing the bridge.
 */
export function setEditorAutosaveRequester(requester: (() => void) | null): void {
  autosaveRequester = requester;
}

function currentEpoch(): number {
  if (gestureOwnsCurrentDocument() && activeHistoryGesture !== null) return activeHistoryGesture.epoch;
  activeHistoryGesture = null;
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
    coalesceGesture: activeHistoryGesture !== null,
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
  configName: null,
  isTemplate: false,
  spaceId: null,
  venueId: null,
  configRevision: null,
  space: null,
  spaceLoadFailed: false,
  isPublicPreview: false,
  objects: [],
  baseObjects: [],
  selectedObjectId: null,
  isDirty: false,
  isSaving: false,
  lastSavedAt: null,
  isLoading: false,
  error: null,
  saveError: null,
  saveErrorCode: null,
  saveConflict: null,
  pendingChanges: 0,
  savingChanges: null,
  isOnline: readOnlineStatus(),
  keptOnDevice: false,
  reviewStatus: null,
  reviewLockRefused: false,
  lockReason: null,
  scene: null,
  history: emptyHistory<EditorObject>(),
};

/** What every failed-for-conflict save says (v1 surfaces print it). */
const CONFLICT_SAVE_ERROR = "This layout changed in another tab. Reload the server copy before saving again.";
/** The server's own words for a conflict, for one this client finds itself. */
const SERVER_CONFLICT_MESSAGE = "Layout changed on the server. Reload before saving again.";
/** "Keep mine" could not read the version it would save over. */
const KEEP_MINE_UNREAD_ERROR = "The newer version could not be read, so nothing was saved. Try again.";

// A configuration ID alone cannot own an async result: A → B → A opens a
// different editing session for A. Loads compete by request; saves/room reads
// belong to the last committed session. A failed load leaves that session live.
let configurationLoadRequest = 0;
let configurationSession = 0;

// The /plan bootstrap reads tracked drafts through the public endpoint, then
// opens the one it chose — whose load would request that same row again at
// once. It hands the response over instead: only to a public load (the
// endpoint that load would call) of that configuration, and only to the very
// next load, which consumes or discards it.
const publicConfigurationHandoff = createOneShotHandoff<configApi.Configuration>(5_000);

/** Give the next public load of this configuration the row the bootstrap already read. */
export function handOffPublicConfiguration(config: configApi.Configuration): void {
  if (config.isPublicPreview) publicConfigurationHandoff.offer(config.id, config);
}

// The bootstrap knows the room before its draft is created or opened, so it
// requests the room then; the commit's loadSpace joins that request.
const plannerSpaceHandoff = createOneShotHandoff<Promise<Space>>(10_000);

/** Start the room read the next loadSpace for it will use. */
export function prefetchPlannerSpace(venueId: string, spaceId: string): void {
  const request = spacesApi.getSpace(venueId, spaceId);
  // Never unhandled; loadSpace makes its own request if this one failed.
  request.catch(() => undefined);
  plannerSpaceHandoff.offer(`${venueId}/${spaceId}`, request);
}

export interface EditorSession {
  readonly configId: string | null;
  readonly generation: number;
}

/** Read-only ownership for async editor callers; survives neither reload nor A → B → A. */
export function captureEditorSession(): EditorSession {
  return { configId: useEditorStore.getState().configId, generation: configurationSession };
}

export function isCurrentEditorSession(session: EditorSession): boolean {
  return session.generation === configurationSession && session.configId === useEditorStore.getState().configId;
}

// ---------------------------------------------------------------------------
// Save facts derived on every write: one pass inside `set` (and the store's
// external setState), so no subscriber ever sees a state whose count, device
// copy or lock reason belongs to the previous document.
// ---------------------------------------------------------------------------

/** The newer server version a reported conflict was summarised from; kept
 *  for "Keep mine", which saves over exactly that revision. */
let conflictServerCopy: {
  readonly session: number;
  readonly configId: string;
  readonly revision: number;
  readonly objects: readonly EditorObject[];
} | null = null;

/** A "Keep mine" is under way (reading their version or saving): one at a time. */
let keepMineInFlight = false;

/** The sign-in another tab ended (forgetting its drafts): while this tab still
 *  holds that very sign-in, it keeps nothing of theirs on this device. A new
 *  sign-in is a new user object (ClerkAuthBridge), so it keeps work again. */
let signedOutUser: AuthUser | null = null;

function signedOutHere(): boolean {
  const user = useAuthStore.getState().user;
  return user !== null && user === signedOutUser;
}

/** Whose unsaved work this device would keep: the signed-in person, else a guest. */
function draftOwner(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

const DRAFT_FIELDS = [
  "configId", "spaceId", "venueId", "configRevision", "isPublicPreview", "objects", "baseObjects", "isDirty",
] as const satisfies readonly (keyof EditorState)[];

function keepWorkOnDevice(state: EditorState): boolean {
  if (signedOutHere()) return false;
  return persistAnonymousPlannerDraft({
    configId: state.configId,
    spaceId: state.spaceId,
    venueId: state.venueId,
    configRevision: state.configRevision,
    isPublicPreview: state.isPublicPreview,
    objects: state.objects,
    baseObjects: state.baseObjects,
    isDirty: state.isDirty,
    ownerUserId: draftOwner(),
    writerPageId: plannerPageId(),
  });
}

/** The newer version a conflict is against, when this client holds it. */
function heldServerCopy(conflict: EditorSaveConflict, configId: string): readonly EditorObject[] | null {
  return conflictServerCopy !== null
    && conflictServerCopy.session === configurationSession
    && conflictServerCopy.configId === configId
    && conflictServerCopy.revision === conflict.currentRevision
    ? conflictServerCopy.objects
    : null;
}

/**
 * The same conflict, now against a version the server moved on to while the
 * person was choosing. Who made it and when belonged to the earlier version,
 * so they become unknown; what changed is read afresh against `base`.
 */
function againstNewerVersion(
  conflict: EditorSaveConflict,
  revision: number,
  base: readonly EditorObject[],
  theirs: readonly EditorObject[],
): EditorSaveConflict {
  return {
    ...conflict,
    currentRevision: revision,
    changedBy: null,
    changedAt: null,
    byYou: false,
    theirChange: summariseLayoutChange(base, theirs),
  };
}

function lockReasonFor(state: EditorState): EditorLockReason | null {
  if (isLayoutTimelineMutationLocked()) return "phase-preview";
  if (state.reviewLockRefused) return "in-review";
  // The server lets the layout's own venue admin, and a platform admin, edit
  // in every state (canOverrideReviewLock in require-editable-config); another
  // venue's admin who owns the layout waits for its review like any planner.
  const user = useAuthStore.getState().user;
  if (user !== null && (user.platformRole === "admin" || (user.role === "admin" && user.venueId !== null && user.venueId === state.venueId))) return null;
  return state.reviewStatus === "submitted" || state.reviewStatus === "under_review" ? "in-review" : null;
}

type DerivedSaveFacts = Pick<EditorState, "pendingChanges" | "savingChanges" | "keptOnDevice" | "lockReason">;

function deriveSaveFacts(previous: EditorStore, next: EditorStore): DerivedSaveFacts {
  const documentChanged = next.objects !== previous.objects || next.baseObjects !== previous.baseObjects;
  const pendingChanges = documentChanged ? changedBetween(next.baseObjects, next.objects).size : next.pendingChanges;
  const savingChanges = !next.isSaving
    ? null
    : !previous.isSaving || next.savingChanges === null ? pendingChanges : next.savingChanges;
  let keptOnDevice = next.keptOnDevice;
  if (DRAFT_FIELDS.some((field) => next[field] !== previous[field])) {
    // A pointer gesture's frames are written once, at its end (endHistoryGesture):
    // until then the copy here is older than the work on screen.
    const deferred = next.isDirty && next.configId === previous.configId && gestureOwnsCurrentDocument();
    keptOnDevice = deferred ? false : keepWorkOnDevice(next);
  }
  return { pendingChanges, savingChanges, keptOnDevice, lockReason: lockReasonFor(next) };
}

type EditorStoreUpdate = EditorStore | Partial<EditorStore> | ((state: EditorStore) => EditorStore | Partial<EditorStore>);

function withSaveFacts(initializer: StateCreator<EditorStore>): StateCreator<EditorStore> {
  return (rawSet, get, api) => {
    // Merging covers both of zustand's forms: a replace carries every field.
    const setWithFacts = (update: EditorStoreUpdate): void => {
      const previous = get();
      const patch = typeof update === "function" ? update(previous) : update;
      const next: EditorStore = { ...previous, ...patch };
      rawSet({ ...next, ...deriveSaveFacts(previous, next) }, true);
    };
    api.setState = setWithFacts;
    return initializer(setWithFacts, get, api);
  };
}

function bumpLocalIdsPast(objects: readonly EditorObject[]): void {
  for (const object of objects) {
    const match = /^local-(\d+)$/u.exec(object.id);
    if (match?.[1] !== undefined) localIdCounter = Math.max(localIdCounter, Number(match[1]));
  }
}

/** The server's current copy of the layout, or null when it cannot be read. */
async function readServerCopy(configId: string, useAuthPath: boolean): Promise<configApi.Configuration | null> {
  try {
    const config = useAuthPath ? await configApi.getConfig(configId) : await configApi.getPublicConfig(configId);
    return config.id === configId ? config : null;
  } catch {
    return null;
  }
}

/** The unsaved work this device kept for the layout being opened. */
function draftForLoad(config: configApi.Configuration, isAuthenticated: boolean | undefined): AnonymousPlannerDraft | null {
  const expected = { spaceId: config.spaceId, venueId: config.venueId, baseRevision: config.revision };
  const owner = isAuthenticated === true ? draftOwner() : null;
  const own = owner === null ? null : readAnonymousPlannerDraft(config.id, { ...expected, ownerUserId: owner });
  return own ?? (config.isPublicPreview ? readAnonymousPlannerDraft(config.id, expected) : null);
}

/**
 * The draft, unless another open page wrote it: that page's in-progress work
 * is its own to save, so this page opens the server's copy and leaves the
 * draft where it is. Work a closed page left behind (or one the browser cannot
 * vouch for either way) is the person's to pick up here.
 */
async function draftNotHeldElsewhere(draft: AnonymousPlannerDraft | null): Promise<AnonymousPlannerDraft | null> {
  if (draft?.writerPageId === undefined || draft.writerPageId === plannerPageId()) return draft;
  return await isPlannerPageOpen(draft.writerPageId) === true ? null : draft;
}

export const useEditorStore = create<EditorStore>()(withSaveFacts((set, get) => ({
  ...INITIAL_STATE,

  loadConfiguration: async (configId, isAuthenticated) => {
    const request = ++configurationLoadRequest;
    // Taken by every load, so a handoff never outlives the load it was for.
    const handedOff = publicConfigurationHandoff.take(configId);
    set({ isLoading: true, error: null });
    try {
      const config = isAuthenticated === true
        ? await configApi.getConfig(configId)
        : handedOff ?? await configApi.getPublicConfig(configId);
      if (request !== configurationLoadRequest) return;
      // Unsaved work this device kept (another open page's stays that page's).
      const localDraft = await draftNotHeldElsewhere(draftForLoad(config, isAuthenticated));
      if (request !== configurationLoadRequest) return;
      // A GET may have captured its row before a concurrent save was accepted.
      // Reloading cannot roll an acknowledged revision (or newer local edits)
      // backwards, even when this is the newest load request for the same ID.
      const current = get();
      if (current.configId === config.id && current.configRevision !== null && config.revision < current.configRevision) {
        set({ isLoading: false });
        return;
      }
      const serverObjects = (config.objects ?? []).map(placedObjectToEditor);
      // One edited from this revision restores as it is. One edited from any
      // other revision restores onto the base it was edited from, at that
      // revision, as a conflict the person settles before anything is saved:
      // it never overwrites the newer copy, and nothing (no autosave, no live
      // refetch) merges it. This load already holds their version.
      const draftIsCurrent = localDraft !== null && localDraft.baseRevision === config.revision;
      const staleDraftBase = localDraft !== null && !draftIsCurrent ? plannerDraftBaseObjects(localDraft) : null;
      const restoredDraft = localDraft !== null && (draftIsCurrent || staleDraftBase !== null) ? localDraft : null;
      const objects = restoredDraft?.objects ?? serverObjects;
      if (restoredDraft !== null) bumpLocalIdsPast(restoredDraft.objects);
      const loadConflict: EditorSaveConflict | null = restoredDraft === null || staleDraftBase === null ? null : {
        expectedRevision: restoredDraft.baseRevision,
        currentRevision: config.revision,
        message: SERVER_CONFLICT_MESSAGE,
        // A read of the layout does not say who made its revision, or when.
        changedBy: null,
        changedAt: null,
        byYou: false,
        // A draft ahead of the server is not behind a newer change of anyone's:
        // what the server holds instead is unknown, not "their change".
        theirChange: restoredDraft.baseRevision < config.revision
          ? summariseLayoutChange(staleDraftBase, serverObjects)
          : null,
      };
      // G4: capture the outgoing timeline at the LAST moment before the
      // reset — a gesture landing during the awaits above advances the live
      // history, and a stale snapshot would lose it (reviewer HIGH).
      const previousHistory = get().history;
      const previousRevision = get().configRevision;
      const previousWasPublic = get().isPublicPreview;
      configurationSession += 1;
      yieldedIds.clear();
      conflictServerCopy = loadConflict === null
        ? null
        : { session: configurationSession, configId: config.id, revision: config.revision, objects: serverObjects };
      set({
        configId: config.id,
        configName: config.name,
        isTemplate: config.isTemplate === true,
        spaceId: config.spaceId,
        venueId: config.venueId,
        configRevision: loadConflict === null ? config.revision : loadConflict.expectedRevision,
        isPublicPreview: config.isPublicPreview,
        objects,
        baseObjects: staleDraftBase ?? serverObjects,
        isDirty: restoredDraft !== null,
        isSaving: false,
        saveError: loadConflict === null ? null : CONFLICT_SAVE_ERROR,
        saveErrorCode: loadConflict === null ? null : "REVISION_CONFLICT",
        lastSavedAt: config.updatedAt === undefined ? null : new Date(config.updatedAt),
        space: get().space?.id === config.spaceId && get().space?.venueId === config.venueId ? get().space : null,
        isLoading: false,
        saveConflict: loadConflict,
        reviewStatus: config.reviewStatus ?? null,
        reviewLockRefused: false,
        history: emptyHistory<EditorObject>(),
      });
      // G4: config boundary — seal any open gesture from the previous
      // config's timeline, ship its unsent tail (the flush snapshots the
      // store before beginLog wipes it; late acks are config-guarded),
      // then open the new configuration's log.
      actionEmitter.flush(previousHistory);
      if (previousRevision !== null && !previousWasPublic) {
        flushActionLogToServer(previousRevision);
      }
      beginActionLogForConfig(config.id);
      // Load space data (name, dimensions) for room geometry rendering.
      // venueId/spaceId are non-nullable on the wire — no guard needed.
      void get().loadSpace(config.venueId, config.spaceId);
      // Work kept on this device was meant for the server: send it on, unless
      // it waits for the person's choice.
      if (restoredDraft !== null && loadConflict === null) autosaveRequester?.();
    } catch (err) {
      if (request !== configurationLoadRequest) return;
      const message = err instanceof Error ? err.message : "Failed to load configuration";
      set({ isLoading: false, error: message });
    }
  },

  loadSpace: async (venueId, spaceId) => {
    const session = configurationSession;
    const early = plannerSpaceHandoff.take(`${venueId}/${spaceId}`);
    if (get().spaceLoadFailed) set({ spaceLoadFailed: false });
    try {
      const space = await (early === null
        ? spacesApi.getSpace(venueId, spaceId)
        : early.catch(() => spacesApi.getSpace(venueId, spaceId)));
      if (session !== configurationSession || get().spaceId !== spaceId || get().venueId !== venueId) return;
      set({ space, spaceId, venueId, spaceLoadFailed: false });
    } catch {
      // Space data is for display, but a surface waiting on it must stop
      // showing a working state: say the read failed for this room.
      if (session !== configurationSession || get().spaceId !== spaceId || get().venueId !== venueId) return;
      set({ spaceLoadFailed: true });
    }
  },

  createPublicConfig: async (spaceId, shouldOpen) => {
    const request = ++configurationLoadRequest;
    set({ isLoading: true, error: null });
    try {
      const config = await configApi.createPublicConfig(spaceId);
      // The server created this draft even if navigation superseded the request.
      // Keep its existing bounded recovery entry, but do not open it or return
      // a successful navigation result to the stale caller.
      try {
        const stored = JSON.parse(localStorage.getItem(TRACKED_CONFIGS_KEY) ?? "[]") as { configId: string; createdAt: string; claimSecret?: string }[];
        // The claim secret stays with this browser's own draft: it alone can
        // claim the plan into an account (lib/planner-claim.ts).
        stored.push({ configId: config.id, createdAt: new Date().toISOString(), ...(config.claimSecret === undefined ? {} : { claimSecret: config.claimSecret }) });
        const capped = stored.length > MAX_TRACKED_CONFIGS
          ? stored.slice(stored.length - MAX_TRACKED_CONFIGS)
          : stored;
        localStorage.setItem(TRACKED_CONFIGS_KEY, JSON.stringify(capped));
      } catch {
        // Tracking is best-effort, including private browsing and quota limits.
      }
      if (request !== configurationLoadRequest || shouldOpen?.() === false) throw new Error("A different layout was opened while this draft was being created.");
      configurationSession += 1;
      yieldedIds.clear();
      conflictServerCopy = null;
      set({
        configId: config.id,
        configName: config.name,
        isTemplate: config.isTemplate === true,
        spaceId: config.spaceId,
        venueId: config.venueId,
        configRevision: config.revision,
        isPublicPreview: true,
        objects: [],
        baseObjects: [],
        isDirty: false,
        isSaving: false,
        saveError: null,
        saveErrorCode: null,
        reviewStatus: null,
        reviewLockRefused: false,
        lastSavedAt: config.updatedAt === undefined ? null : new Date(config.updatedAt),
        space: get().space?.id === config.spaceId && get().space?.venueId === config.venueId ? get().space : null,
        isLoading: false,
        saveConflict: null,
        history: emptyHistory<EditorObject>(),
      });

      // A fresh public draft is a config boundary exactly like
      // loadConfiguration's: the timeline above is empty, so gesture seqs
      // restart at 1 and the emitter's seal cursor must restart with them or
      // every following gesture is silently dropped. It also re-scopes the
      // log to the new configuration — without that, edits to this draft
      // would append under the previous config's id.
      beginActionLogForConfig(config.id);

      // Load space data for room geometry rendering.
      // venueId/spaceId are non-nullable on the wire — no guard needed.
      void get().loadSpace(config.venueId, config.spaceId);

      return config.id;
    } catch (err) {
      if (request !== configurationLoadRequest) throw err;
      if (shouldOpen?.() === false) {
        set({ isLoading: false });
        throw err;
      }
      const message = err instanceof Error ? err.message : "Failed to create configuration";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  addObject: (assetId, positionX, positionY, positionZ) => {
    if (isLayoutTimelineMutationLocked()) return;
    // Loaded legacy rows still enter through loadConfiguration above. This
    // guard applies only to new imperative additions: dressing catalogue
    // entries are contextual actions, never standalone editor objects.
    if (isTableDressingApplicator(assetId)) return;
    const s = get();
    const obj: EditorObject = {
      id: `local-${String(++localIdCounter)}`,
      assetDefinitionId: assetId,
      positionX, positionY, positionZ,
      rotationX: 0, rotationY: 0, rotationZ: 0,
      scale: 1, sortOrder: s.objects.length,
      clothed: false, clothStyle: null, tableSetting: null, chairStyle: null, centerpiece: null, groupId: null, notes: "",
    };
    const after = [...s.objects, obj];
    set({
      objects: after,
      isDirty: true,
      history: recordedHistory(s.history, s.selectedObjectId, s.objects, after) ?? s.history,
    });
    notifyLocalChange(s.objects, after);
  },

  updateObject: (objectId, transform) => {
    if (isLayoutTimelineMutationLocked()) return;
    const s = get();
    const after = s.objects.map((o) => o.id === objectId ? { ...o, ...transform } : o);
    set({
      objects: after,
      isDirty: true,
      history: recordedHistory(s.history, s.selectedObjectId, s.objects, after) ?? s.history,
    });
    notifyLocalChange(s.objects, after);
  },

  moveObjectsByDelta: (ids, dx, dz) => {
    if (isLayoutTimelineMutationLocked()) return;
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
    notifyLocalChange(s.objects, after);
  },

  setObjectNotes: (objectId, notes) => {
    if (isLayoutTimelineMutationLocked()) return;
    const s = get();
    const after = s.objects.map((o) => o.id === objectId ? { ...o, notes } : o);
    set({
      objects: after,
      isDirty: true,
      history: recordedHistory(s.history, s.selectedObjectId, s.objects, after) ?? s.history,
    });
    notifyLocalChange(s.objects, after);
    // Notes never touch the placement store, so the bridge's scene
    // subscription cannot schedule the save — request it here, like
    // undo/redo do, or the note sits dirty until the next drag.
    autosaveRequester?.();
  },

  setObjectDressing: (objectId, patch) => {
    if (isLayoutTimelineMutationLocked()) return;
    const s = get();
    const normalize = (value: string | null, max: number): string | null => {
      const trimmed = (value ?? "").trim();
      return trimmed.length === 0 ? null : trimmed.slice(0, max);
    };
    const after = s.objects.map((o) => {
      if (o.id !== objectId) return o;
      return {
        ...o,
        ...(patch.chairStyle !== undefined
          ? { chairStyle: normalize(patch.chairStyle, 40) }
          : {}),
        ...(patch.centerpiece !== undefined
          ? { centerpiece: normalize(patch.centerpiece, 80) }
          : {}),
      };
    });
    set({
      objects: after,
      isDirty: true,
      history: recordedHistory(s.history, s.selectedObjectId, s.objects, after) ?? s.history,
    });
    notifyLocalChange(s.objects, after);
    // Same as setObjectNotes: dressing text edits are editor-store-only
    // mutations; the scene bridge never sees them, so ask for the save.
    autosaveRequester?.();
  },

  removeObject: (objectId) => {
    if (isLayoutTimelineMutationLocked()) return;
    const s = get();
    const after = s.objects.filter((o) => o.id !== objectId);
    const selectionAfter = captureSelection(s.selectedObjectId).filter((id) => id !== objectId);
    set({
      objects: after,
      isDirty: true,
      selectedObjectId: s.selectedObjectId === objectId ? null : s.selectedObjectId,
      history: recordedHistory(s.history, s.selectedObjectId, s.objects, after, selectionAfter) ?? s.history,
    });
    notifyLocalChange(s.objects, after);
  },

  selectObject: (id) => { set({ selectedObjectId: id }); },
  deselectObject: () => { set({ selectedObjectId: null }); },

  saveToServer: (isAuthenticated) => saveDocument(isAuthenticated, false),

  reloadAfterConflict: async (isAuthenticated) => {
    const configId = get().configId;
    if (configId === null) return;
    // The person chose the server's version: this device's copy of their
    // work would otherwise be restored over it by the load below.
    discardPlannerDraft(configId, draftOwner());
    conflictServerCopy = null;
    set({ saveError: null, saveErrorCode: null, saveConflict: null });
    await get().loadConfiguration(configId, isAuthenticated);
  },

  showTheirVersion: async (isAuthenticated) => {
    await get().reloadAfterConflict(isAuthenticated ?? useAuthStore.getState().isAuthenticated);
  },

  keepMine: async (isAuthenticated) => {
    // The same refusals as saveToServer, checked before the base moves.
    if (keepMineInFlight || isLayoutTimelineMutationLocked() || gestureOwnsCurrentDocument()) return false;
    const s = get();
    if (s.saveConflict === null || s.configId === null || s.isSaving) return false;
    const configId = s.configId;
    const session = configurationSession;
    const authenticated = isAuthenticated ?? useAuthStore.getState().isAuthenticated;
    keepMineInFlight = true;
    try {
      let theirs = heldServerCopy(s.saveConflict, configId);
      if (theirs === null) {
        // Their version says which of my objects it no longer has, and so
        // which the server must place again: without it nothing is saved.
        const read = await readServerCopy(configId, !s.isPublicPreview || authenticated);
        if (session !== configurationSession || get().configId !== configId) return false;
        const pending = get().saveConflict;
        if (pending === null) return false;
        if (read === null || read.revision < pending.currentRevision) {
          set({ saveError: KEEP_MINE_UNREAD_ERROR, saveErrorCode: null });
          return false;
        }
        const objects = (read.objects ?? []).map(placedObjectToEditor);
        conflictServerCopy = { session, configId, revision: read.revision, objects };
        if (read.revision > pending.currentRevision) {
          // The server moved on again: the person sees that version first.
          set({ saveConflict: againstNewerVersion(pending, read.revision, get().baseObjects, objects) });
          return false;
        }
        if (pending.theirChange === null) {
          set({ saveConflict: { ...pending, theirChange: summariseLayoutChange(get().baseObjects, objects) } });
        }
        theirs = objects;
      }
      const current = get();
      const conflict = current.saveConflict;
      if (conflict === null) return false;
      // An object of mine their version deleted would be dropped by the
      // full-sync save (it rewrites only ids the server still has): it goes
      // as a new placement instead. An object yielded to their later write
      // is theirs, as it was on screen.
      const theirsById = new Map(theirs.map((object) => [object.id, object]));
      const rekeyed = new Map<string, string>();
      const kept = current.objects.map((object) => {
        const their = theirsById.get(object.id);
        if (yieldedIds.has(object.id) && their !== undefined) return their;
        if (EDITOR_HISTORY_IDS.isLocalId(object.id) || their !== undefined) return object;
        const localId = `local-${String(++localIdCounter)}`;
        rekeyed.set(object.id, localId);
        return { ...object, id: localId };
      });
      yieldedIds.clear();
      const selection = useSelectionStore.getState();
      if ([...selection.selectedIds].some((id) => rekeyed.has(id))) {
        selection.selectMultiple([...selection.selectedIds].map((id) => rekeyed.get(id) ?? id));
      }
      // The newer revision becomes this document's base: the full-sync save
      // replaces it with this document, and pendingChanges (so savingChanges)
      // counts exactly what that save changes on the server.
      set({
        configRevision: conflict.currentRevision,
        baseObjects: theirs,
        objects: kept,
        history: remapHistoryIds(current.history, rekeyed),
        selectedObjectId: current.selectedObjectId === null ? null : rekeyed.get(current.selectedObjectId) ?? current.selectedObjectId,
        isDirty: true,
      });
      notifyLocalChange(current.objects, kept);
      return await saveDocument(authenticated, true);
    } finally {
      keepMineInFlight = false;
    }
  },

  setReviewStatus: (configId, status) => {
    if (get().configId !== configId) return;
    set({
      reviewStatus: status,
      ...(status !== null && isPlannerEditable(status) ? { reviewLockRefused: false } : {}),
    });
  },

  clearSaveError: () => { set({ saveError: null, saveErrorCode: null }); },

  adoptServerConfiguration: (config, options = {}) => {
    const s = get();
    if (config.id !== s.configId || config.isPublicPreview) return { status: "ignored" };
    if (s.configRevision !== null && config.revision <= s.configRevision) return { status: "stale" };
    if ((s.isSaving && options.whileSaving !== true) || gestureOwnsCurrentDocument()) return { status: "busy" };
    const server = (config.objects ?? []).map(placedObjectToEditor);
    const reviewFacts = {
      reviewStatus: config.reviewStatus ?? s.reviewStatus,
      // An editable status from the server lifts an earlier CONFIG_LOCKED refusal.
      ...(config.reviewStatus !== undefined && isPlannerEditable(config.reviewStatus) ? { reviewLockRefused: false } : {}),
    };
    const pending = s.saveConflict;
    if (pending !== null) {
      // The person is choosing between this document and a newer version:
      // nothing is merged into it while they do. A later version still
      // arrives, as the one they will be shown and kept against.
      if (config.revision > pending.currentRevision) {
        conflictServerCopy = { session: configurationSession, configId: config.id, revision: config.revision, objects: server };
        set({
          saveConflict: againstNewerVersion(pending, config.revision, s.baseObjects, server),
          configName: config.name,
          ...reviewFacts,
        });
      }
      return { status: "held" };
    }
    // Undo never replays this person's older values over another person's
    // later change: forget the steps' parts for every object someone else
    // changed. Seal the open gesture first so the action log keeps it.
    actionEmitter.flush(s.history);
    const history = forgetHistoryIds(s.history, changedBetween(s.baseObjects, server));
    const modified = locallyModifiedIds(s.baseObjects, s.objects);
    const hasLocalEdits = [...modified].some((id) => !yieldedIds.has(id))
      || s.baseObjects.some((object) => !s.objects.some((local) => local.id === object.id));
    if (!hasLocalEdits) {
      yieldedIds.clear();
      set({
        objects: server,
        baseObjects: server,
        history,
        // A rename by someone else arrives with the document (the phone's top bar reads it).
        configName: config.name,
        configRevision: config.revision,
        isDirty: false,
        saveError: null,
        saveErrorCode: null,
        ...reviewFacts,
        lastSavedAt: config.updatedAt === undefined ? s.lastSavedAt : new Date(config.updatedAt),
      });
      conflictServerCopy = null;
      return { status: "adopted", lostToRemoteDelete: [] };
    }
    const rebased = rebaseOntoServer({ server, base: s.baseObjects, local: s.objects, yielded: yieldedIds });
    yieldedIds.clear();
    set({
      objects: rebased.objects,
      baseObjects: server,
      history,
      configName: config.name,
      configRevision: config.revision,
      isDirty: true,
      saveError: null,
      saveErrorCode: null,
      ...reviewFacts,
    });
    conflictServerCopy = null;
    // The rebased edits still need to reach the server.
    if (options.requestSave !== false) autosaveRequester?.();
    return { status: "rebased", lostToRemoteDelete: rebased.lostToRemoteDelete };
  },

  yieldObjectsToRemote: (ids) => {
    if (ids.length === 0) return;
    const s = get();
    // While a conflict waits, this document is the person's version as it
    // stands: a peer's later write reaches them as their version instead.
    if (s.saveConflict !== null) return;
    const baseById = new Map(s.baseObjects.map((object) => [object.id, object]));
    const yielding = new Set(ids.filter((id) => baseById.has(id)));
    if (yielding.size === 0) return;
    for (const id of yielding) yieldedIds.add(id);
    let changed = false;
    const objects = s.objects.map((object) => {
      if (!yielding.has(object.id)) return object;
      const confirmed = baseById.get(object.id);
      if (confirmed === undefined || confirmed === object) return object;
      changed = true;
      return confirmed;
    });
    // A yielded object this person had deleted comes back as the server's.
    for (const id of yielding) {
      if (s.objects.some((object) => object.id === id)) continue;
      const confirmed = baseById.get(id);
      if (confirmed !== undefined) {
        objects.push(confirmed);
        changed = true;
      }
    }
    actionEmitter.flush(s.history);
    const history = forgetHistoryIds(s.history, yielding);
    if (changed || history !== s.history) set({ objects, history });
  },

  reset: () => {
    configurationLoadRequest += 1;
    configurationSession += 1;
    publicConfigurationHandoff.clear();
    plannerSpaceHandoff.clear();
    activeHistoryGesture = null;
    interactionEpoch++;
    yieldedIds.clear();
    useCockpitStore.getState().setPlannedGuestCount(null);
    conflictServerCopy = null;
    // Preserve the scene ref — reset clears editor data but the Three.js
    // scene is still alive in the Canvas. SceneProvider manages the ref.
    // The network is the browser's, not the layout's: it survives too.
    set({ ...INITIAL_STATE, scene: get().scene, isOnline: get().isOnline });
    // INITIAL_STATE carries emptyHistory(), so gesture seqs restart at 1.
    // Without this the emitter's seal cursor stays at the old high-water
    // mark and silently drops every gesture that follows (action-log.ts:
    // `if (entry.seq <= lastSealedSeq) return`).
    actionEmitter.reset();
  },

  replaceObjectsFromScene: (objects) => {
    if (isLayoutTimelineMutationLocked()) return;
    const s = get();
    const history = recordedHistory(s.history, s.selectedObjectId, s.objects, objects);
    if (history === null) return;
    set({ objects, isDirty: true, history });
    notifyLocalChange(s.objects, objects);
  },

  undo: () => {
    if (isLayoutTimelineMutationLocked()) return;
    activeHistoryGesture = null;
    const s = get();
    const step = performUndo(s.history, s.objects, EDITOR_HISTORY_IDS);
    if (step === null) return;
    actionEmitter.afterUndo(s.history); // G4: seals the popped gesture + logs history.undo
    interactionEpoch++;
    set(historyStepPatch(step));
    notifyLocalChange(s.objects, step.objects);
    useSelectionStore.getState().selectMultiple(step.selection);
    autosaveRequester?.();
  },

  redo: () => {
    if (isLayoutTimelineMutationLocked()) return;
    activeHistoryGesture = null;
    const s = get();
    const step = performRedo(s.history, s.objects, EDITOR_HISTORY_IDS);
    if (step === null) return;
    actionEmitter.afterRedo(step.history); // G4: logs history.redo
    interactionEpoch++;
    set(historyStepPatch(step));
    notifyLocalChange(s.objects, step.objects);
    useSelectionStore.getState().selectMultiple(step.selection);
    autosaveRequester?.();
  },

  bumpHistoryEpoch: () => {
    if (isLayoutTimelineMutationLocked()) return;
    activeHistoryGesture = null;
    interactionEpoch++;
  },

  beginHistoryGesture: () => {
    if (isLayoutTimelineMutationLocked()) return null;
    interactionEpoch++;
    const token = Symbol("pointer-history-gesture");
    const { configId, spaceId, venueId } = get();
    activeHistoryGesture = { token, epoch: interactionEpoch, configId, spaceId, venueId,
      session: configurationSession, objectIds: new Map() };
    return token;
  },

  endHistoryGesture: (token) => {
    if (activeHistoryGesture?.token !== token) return;
    const ownsDocument = gestureOwnsCurrentDocument();
    activeHistoryGesture = null;
    interactionEpoch++;
    if (ownsDocument) {
      actionEmitter.flush(get().history);
      // The gesture's frames were not written as they came (deriveSaveFacts):
      // keep the finished result on this device now.
      set({ keptOnDevice: keepWorkOnDevice(get()) });
      if (get().isDirty) autosaveRequester?.();
    }
  },

  isHistoryGestureCurrent: (token) => activeHistoryGesture?.token === token
    && gestureOwnsCurrentDocument() && !isLayoutTimelineMutationLocked(),

  historyGestureIdMap: (token) => activeHistoryGesture?.token === token
    && gestureOwnsCurrentDocument() && !isLayoutTimelineMutationLocked()
    ? activeHistoryGesture.objectIds : null,
})));

/**
 * The save itself. `keeping` is "Keep mine": it may run while the conflict it
 * settles is pending (every other save waits for the person's choice), and a
 * 409 during it is always reported as a fresh conflict, never rebased, even
 * in the live room: a third version is the person's to see first.
 */
async function saveDocument(isAuthenticated: boolean | undefined, keeping: boolean): Promise<boolean> {
  const get = useEditorStore.getState;
  const set = useEditorStore.setState;
  if (isLayoutTimelineMutationLocked()) return false;
  // A mid-drag save would seal an incomplete action-log entry. Release or
  // cancellation schedules the complete transaction through the same bridge.
  if (gestureOwnsCurrentDocument()) return false;
  const { configId, configRevision, objects, isSaving, isPublicPreview, saveConflict } = get();
  if (configId === null || isSaving) return false;
  // A conflict waits for the person's choice. Any other save could only meet
  // it again (and, in the live room, merge what they have not chosen).
  if (!keeping && saveConflict !== null) return false;
  const session = configurationSession;
  // G4: a save is a gesture boundary — seal the open gesture into the log.
  // Deliberately before the revision guard below: the local gesture
  // happened regardless of whether this save can proceed.
  actionEmitter.flush(get().history);
  if (configRevision === null) {
    set({
      saveError: "Cannot save because the layout revision is missing. Reload the layout and try again.",
      saveErrorCode: null,
    });
    return false;
  }

  // Determine save path: use authenticated endpoint if config is claimed
  // (isPublicPreview=false) OR if caller explicitly says authenticated.
  // Public preview configs always use the public endpoint.
  const useAuthPath = !isPublicPreview || isAuthenticated === true;

  // savingChanges is captured from pendingChanges here (deriveSaveFacts). A
  // pending conflict stays until this save lands: only then is it settled.
  set({ isSaving: true, saveError: null, saveErrorCode: null });
  try {
    const batch = objects.map(editorToBatch);
    let saved: configApi.BatchSaveResponse;
    if (useAuthPath) {
      saved = await configApi.authBatchSave(configId, batch, configRevision);
    } else {
      saved = await configApi.publicBatchSave(configId, batch, configRevision);
    }
    // The server may have accepted the old document. It no longer owns this
    // editor, its revision/history/selection, or its caller's saved feedback.
    if (session !== configurationSession || get().configId !== configId) return false;
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
    if (activeHistoryGesture !== null && gestureOwnsCurrentDocument()) {
      if (aligned) {
        const objectIds = new Map(activeHistoryGesture.objectIds);
        for (const [original, current] of objectIds) objectIds.set(original, idMap.get(current) ?? current);
        for (const [localId, serverId] of idMap) objectIds.set(localId, serverId);
        activeHistoryGesture = { ...activeHistoryGesture, objectIds };
      } else {
        // An unalignable response cannot safely identify captured objects.
        activeHistoryGesture = null;
      }
    }
    const selection = useSelectionStore.getState();
    if ([...selection.selectedIds].some((id) => idMap.has(id))) {
      selection.selectMultiple([...selection.selectedIds].map((id) => idMap.get(id) ?? id));
    }
    // `serverObjects` echoes the batch as it was BEFORE the await, so
    // adopting it wholesale reverts anything the operator did during the
    // round trip — and `isDirty: false` then guarantees no autosave ever
    // pushes that work again. Detect it by reference: Zustand replaces the
    // array on every mutation, so an unchanged reference means nothing
    // happened. The asymmetry is deliberate — a false positive costs one
    // redundant save, a false negative silently loses the operator's work.
    const editedInFlight = latest.objects !== objects;
    const nextObjects = editedInFlight
      ? latest.objects.map((object) => {
          const serverId = idMap.get(object.id);
          return serverId === undefined ? object : { ...object, id: serverId };
        })
      : serverObjects;
    set({
      // A yielded object stays the server's: never resend an older local copy.
      objects: snapYieldedToBase(nextObjects, serverObjects),
      baseObjects: serverObjects,
      history: aligned ? remapHistoryIds(latest.history, idMap) : emptyHistory<EditorObject>(),
      selectedObjectId: latest.selectedObjectId === null
        ? null
        : idMap.get(latest.selectedObjectId) ?? latest.selectedObjectId,
      configRevision: saved.revision,
      isDirty: editedInFlight,
      isSaving: false,
      lastSavedAt: new Date(),
      saveConflict: null,
      saveErrorCode: null,
      reviewLockRefused: false,
    });
    conflictServerCopy = null;
    // Same configuration, so the log's scope is unchanged and its unsent
    // tail must survive to be flushed below — but an unaligned save just
    // installed an EMPTY timeline, restarting gesture seqs at 1. Reset the
    // seal cursor alone, or the recorder goes deaf for the rest of the
    // session. Only on the unaligned branch: remapHistoryIds preserves
    // seqs, so resetting there would re-emit sealed gestures as duplicates.
    if (!aligned) actionEmitter.reset();
    // G4 slice 3: the save boundary ships the log's unsent tail, anchored
    // to the revision this save produced. Auth path only — the ingest
    // endpoint is authenticated, and public-preview planning stays local.
    if (useAuthPath) flushActionLogToServer(saved.revision);
    liveHooks?.onSaved(saved.revision, idMap);
    return true;
  } catch (err) {
    if (session !== configurationSession || get().configId !== configId) return false;
    const conflict = parseRevisionConflict(err);
    if (conflict !== null) {
      // Someone committed first. Read their version: in the live room this
      // client rebases onto it and saves again (once); otherwise, and always
      // during "Keep mine", it is kept to say what they changed. isSaving
      // stays true through the read, so the live client's own refetch waits
      // ("busy") instead of racing it.
      const rebase = !keeping && conflictPolicy === "rebase" && useAuthPath && rebaseRetryDepth === 0;
      if (rebase) rebaseRetryDepth += 1;
      try {
        const theirs = await readServerCopy(configId, useAuthPath);
        if (session !== configurationSession || get().configId !== configId) return false;
        if (rebase && theirs !== null) {
          // Live co-editing: keep this person's edits on the objects they
          // touched, take everything else from the newer copy.
          const outcome = get().adoptServerConfiguration(theirs, { whileSaving: true, requestSave: false });
          const held = get().configRevision;
          const current = outcome.status === "adopted" || outcome.status === "rebased"
            || (outcome.status === "stale" && held !== null && held >= theirs.revision);
          if (current) {
            set({ isSaving: false });
            return get().isDirty ? await get().saveToServer(isAuthenticated) : true;
          }
        }
        // Summarise only the revision the 409 named: a copy the server has
        // moved past again belongs to someone else's later change.
        const theirObjects = theirs !== null && theirs.revision === conflict.currentRevision
          ? (theirs.objects ?? []).map(placedObjectToEditor)
          : null;
        conflictServerCopy = theirObjects === null
          ? null
          : { session, configId, revision: conflict.currentRevision, objects: theirObjects };
        const me = useAuthStore.getState().user?.id ?? null;
        set({
          isSaving: false,
          saveError: CONFLICT_SAVE_ERROR,
          saveErrorCode: "REVISION_CONFLICT",
          saveConflict: {
            ...conflict,
            byYou: me !== null && conflict.changedBy?.userId === me,
            theirChange: theirObjects === null ? null : summariseLayoutChange(get().baseObjects, theirObjects),
          },
        });
        return false;
      } finally {
        if (rebase) rebaseRetryDepth -= 1;
      }
    }
    const code = err instanceof ApiError ? err.code : null;
    if (code === "NETWORK_ERROR" && (!get().isOnline || !browserSaysOnline())) {
      // Offline, not failed: the work stays unsaved (and on this device);
      // coming back online saves it. isOnline follows the browser's event.
      set({ isSaving: false, saveError: null, saveErrorCode: null });
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
    set({
      isSaving: false,
      saveError: message,
      saveErrorCode: code,
      ...(code === "CONFIG_LOCKED" ? { reviewLockRefused: true } : {}),
    });
    return false;
  }
}

useEditorStore.subscribe((state, previous) => {
  // Attendance is session-only and belongs to the committed configuration.
  // View changes, failed loads, same-config reloads and furniture history must
  // preserve it; a different committed draft must not inherit the old target.
  // (Keeping unsaved work on this device happens inside set: deriveSaveFacts.)
  if (state.configId !== previous.configId) {
    useCockpitStore.getState().setPlannedGuestCount(null);
  }
});

// The browser's network, for as long as the editor exists. Going offline
// also explains a save that just failed for want of one: that is offline,
// not a failure to show.
subscribeOnlineStatus((online) => {
  const state = useEditorStore.getState();
  const explainedByOffline = !online && state.saveErrorCode === "NETWORK_ERROR";
  useEditorStore.setState({
    isOnline: online,
    ...(explainedByOffline ? { saveError: null, saveErrorCode: null } : {}),
  });
});
if (useEditorStore.getState().isOnline !== readOnlineStatus()) {
  useEditorStore.setState({ isOnline: readOnlineStatus() });
}

// A phase preview opening or closing changes why the layout is view-only.
onLayoutTimelineMutationLockChange(() => {
  useEditorStore.setState({});
});

/**
 * Tabs share a layout's draft key. Another tab's clean save removes it and
 * another tab's edits overwrite it; either way this tab's "kept on this
 * device" must follow. Work this tab still holds unsaved is written back when
 * another tab removed it. An overwrite is never answered with a write, or two
 * tabs with unsaved work would rewrite each other without end.
 */
export function onPlannerDraftStorageChange(event: Pick<StorageEvent, "key" | "newValue">): void {
  const signingOut = signedOutOwnerFrom(event);
  if (signingOut !== null) {
    // Another tab is signing this person out and forgetting their drafts:
    // this tab keeps none of theirs here for the rest of this sign-in.
    const user = useAuthStore.getState().user;
    if (user?.id === signingOut) signedOutUser = user;
    return;
  }
  const state = useEditorStore.getState();
  if (state.configId === null) return;
  const owner = draftOwner();
  if (owner === null && !state.isPublicPreview) return;
  if (event.key !== null && event.key !== plannerDraftKeyFor(state.configId, owner)) return;
  const removed = event.key === null || event.newValue === null;
  // A pointer gesture writes its result at its end (endHistoryGesture).
  if (removed && state.isDirty && !gestureOwnsCurrentDocument() && !signedOutHere()) {
    useEditorStore.setState({ keptOnDevice: keepWorkOnDevice(state) });
    return;
  }
  if (state.keptOnDevice) useEditorStore.setState({ keptOnDevice: false });
}

if (typeof window !== "undefined") window.addEventListener("storage", onPlannerDraftStorageChange);

// This page holds its lock for its lifetime, so another tab can tell its
// in-progress drafts from those a closed page left behind.
holdPlannerPageLock();
