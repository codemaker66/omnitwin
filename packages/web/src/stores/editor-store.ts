import { create, type StateCreator } from "zustand";
import type { Scene } from "three";
import { isPlannerEditable, type ConfigurationReviewStatus } from "@omnitwin/types";
import type { Space } from "../api/spaces.js";
import type { PlacedObject, BatchObjectInput } from "../api/configurations.js";
import * as configApi from "../api/configurations.js";
import { parseRevisionConflict, type RevisionConflict } from "../api/configuration-conflict.js";
import { ApiError } from "../api/client.js";
import { reportFailure } from "../observability/failure-reports.js";
import * as spacesApi from "../api/spaces.js";
import {
  discardPlannerDraft,
  forgetPlannerDraft,
  persistAnonymousPlannerDraft,
  plannerDraftBaseObjects,
  plannerDraftKeyFor,
  plannerDraftWithUnreadNotes,
  readAnonymousPlannerDraft,
  type AnonymousPlannerDraft,
} from "../lib/anonymous-planner-draft.js";
import {
  NOTE_HELD_CODE,
  afterLeavingOutOfDateNotes,
  batchClearingOwnNotesOfRemovedPieces,
  carriedNoteIds,
  confirmedAfterLeaving,
  givingUpOwnNoteRemoval,
  heldNoteIds,
  heldNoteObjectsName,
  heldNoteObjectsNamed,
  heldNotePiecesDropped,
  heldNotePiecesToPutBack,
  keepingConfirmedNotes,
  namingReplacedNotes,
  noteStillSavingLine,
  notesRefusedOnLeaving,
  notesSentIn,
  nothingRedoneLine,
  nothingRemovedLine,
  nothingUndoneLine,
  ownWordsOverHeldNotes,
  recordedNotes,
  refusedClearsLine,
  refusedOverHeldNote,
  registerHeldNotes,
  signedInRoutesSuit,
  stayedForNotesLine,
  takingNotesKeptUnsent,
} from "../lib/guest-plan-notes.js";
import { holdPlannerPageLock, isPlannerPageOpen, plannerPageId } from "../lib/planner-page-lock.js";
import { signedOutOwnerFrom } from "../lib/planner-draft-storage.js";
import { summariseLayoutChange, type ChangedPiece, type LayoutChangeSummary } from "../lib/layout-change-summary.js";
import { layoutNamed } from "../lib/editor-save-status.js";
import { browserSaysOnline, readOnlineStatus, subscribeOnlineStatus } from "../lib/online-status.js";
import { useAuthStore, type AuthUser } from "./auth-store.js";
import { hasRole, VENUE_FLOOR_ROLES } from "../lib/role-capabilities.js";
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
import { postPlacementNotice } from "./placement-notice-store.js";
import { useCockpitStore } from "./cockpit-store.js";
import { useActionLogStore } from "./action-log-store.js";
import { createActionEmitter } from "../lib/action-log.js";
import { plannerActionContext } from "./planner-action-log.js";
import { flushActionLog } from "./action-log-sync.js";
import { postActionBatch } from "../api/action-log.js";
import { isLayoutTimelineMutationLocked, onLayoutTimelineMutationLockChange } from "../lib/layout-timeline-preview-lock.js";
import { createOneShotHandoff } from "../lib/one-shot-handoff.js";
import { changedBetween, locallyModifiedIds, rebaseOntoServer } from "../lib/layout-live/live-document.js";
import { matchSavedLayout, serverHoldsLayout } from "../lib/saved-layout-content.js";

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
  /**
   * The server's word, in place of `notes`, that this piece holds a note this
   * browser is not shown (a guest plan's notes go only to the browser that
   * made it). Set from the server's copy and read from `baseObjects`
   * (lib/guest-plan-notes.ts); never sent back.
   */
  readonly noteHeld?: boolean;
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
    ...(meta.noteHeld === true ? { noteHeld: true } : {}),
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
  /**
   * The open plan was read with its notes: the public read said so (a guest
   * plan's notes go only to the browser that made it), and any work restored
   * from this device said so too. It is a fact about this document, not about
   * the browser: only then does a save declare its notes complete, and it is
   * kept with the copy on this device. False for every other read.
   */
  readonly notesIncluded: boolean;
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
  /** Pieces whose note the person had cleared in a save refused for a held
   *  note (NOTE_HELD), where someone else had rewritten that note: the clear
   *  was not made, and its own sentence names the piece (lib/guest-plan-notes
   *  refusedClearsLine). Its notice stands until the person dismisses
   *  it (dismissRefusedClears): no later save says the layout saved while it
   *  does (ruling R1(b) on #388). Empty otherwise, and for each layout opened. */
  readonly noteClearsRefused: readonly string[];
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
  /** Unsaved work this device kept, restored as the layout opened (QoL D-01):
   *  what the receipt says. Stays while it saves; the person's next change
   *  (or another load) lets it go. Null when nothing was restored. */
  readonly restoredFromDevice: RestoredWork | null;
  /** Another layout opened in this page before this one's last changes
   *  reached the server (QoL D-X3). Kept through that switch, the room
   *  switch's reset included; the next change, or opening that layout again,
   *  lets it go. */
  readonly leftBehind: LeftBehindWork | null;
}

/** Work this device kept, as the restore receipt states it. */
export interface RestoredWork {
  /** Objects that differ from the server's copy: changed, placed or removed. */
  readonly changes: number;
  /** When the work was last kept here, so last edited. */
  readonly editedAt: Date;
}

/** A layout whose unsaved work, or a clear of a note it refused, stayed behind when another one opened. */
export interface LeftBehindWork {
  readonly configId: string;
  /** Its room, as the venue names it; null when not known. */
  readonly roomName: string | null;
  /** The work is kept on this device (false: it is lost, and the note says so;
   *  null: every change reached the server, and only `notRemoved` is said). */
  readonly kept: boolean | null;
  /** Opening the layout again sends it: no conflict or review lock waits. */
  readonly savesOnReturn: boolean;
  /**
   * The sentence of a clear the API refused whose notice still stood
   * (noteClearsRefused, lib/guest-plan-notes refusedClearsLine): it goes with
   * the switch, and stands in the next layout's note until the person
   * dismisses it (delta review of #388 at 33a8e0ad, S1). Absent for none.
   */
  readonly notRemoved?: string;
}

interface EditorActions {
  /**
   * Load a configuration by ID.
   *
   * The endpoint depends on `isAuthenticated`:
   *   - true  → `getConfig()`        — auth path, enforces ownership/venue access;
   *                                    a refusal (403) tries the public path, so a
   *                                    preview a guest can open still opens
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
  /** Save to server. A claimed layout saves through the authenticated endpoint;
   *  a public preview through the public one, unless the person is signed in
   *  and on its venue's floor (or a platform admin), whom the authenticated
   *  endpoint answers. `transport.keepalive` lets a save sent as the page
   *  hides or closes outlive it. */
  readonly saveToServer: (isAuthenticated?: boolean, transport?: configApi.BatchSaveTransport) => Promise<boolean>;
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
  /**
   * A guest plan opened before the sign-in resolved was read the public way,
   * without its notes, so it saves that way (lib/guest-plan-notes
   * signedInRoutesSuit). Once the person is known and the signed-in routes
   * answer them (the venue's own staff, a platform admin), the plan is read
   * again through those routes, once, so their saves go that way as #373 has
   * them (delta review of #388, B2). Only a document with nothing unsaved is
   * read again: unsaved work goes first, the way the plan was read, and the
   * read waits for it. A read that comes back to a document changed while it
   * was out is dropped, and asked for again once that change is saved. True
   * when the plan was taken from the signed-in read.
   */
  readonly readAgainForSignedInRoutes: () => Promise<boolean>;
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
   *  it: only the person's choice (keepMine, showTheirVersion) ends one, and
   *  a refused clear's notice beneath it comes back (noteClearsRefused). */
  readonly clearSaveError: () => void;
  /** The person dismisses a refused clear's notice (noteClearsRefused): it
   *  goes, and the save line says where saving stands. A refusal of their own
   *  words over a held note, or of a left-out piece, stands on. */
  readonly dismissRefusedClears: () => void;
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
/**
 * Rows a step back or forward returned under a fresh local id (historyIdsFor
 * heals every row while a save is in flight): original id to that id. If that
 * save did not remove the row, and it has since come to hold a note this
 * browser is not shown, the copy is that very row: it takes its id back
 * rather than stand beside the row the put-back returns (putBackHeldNotePieces;
 * delta review R7).
 */
const healedCopies = new Map<string, string>();

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

/**
 * The ids for a step back or forward. A row the confirmed document still
 * holds has been removed by no save, so the step returns the row itself, with
 * whatever note the server keeps on it (lib/editor-history isStored). While a
 * save is in flight that save may be the one removing the row, so every
 * returned row is healed, as before.
 */
function historyIdsFor(state: Pick<EditorState, "baseObjects" | "isSaving">): HistoryIdAdapter {
  if (state.isSaving) return EDITOR_HISTORY_IDS;
  const stored = new Set(state.baseObjects.map((object) => object.id));
  return { ...EDITOR_HISTORY_IDS, isStored: (id) => stored.has(id) };
}

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

/** A save was asked for while no bridge was listening (the load that
 *  restores kept work finishes before the planner, and its bridge, shows). */
let autosaveWaiting = false;

/**
 * Register the auto-save scheduler (owned by EditorBridge) so undo/redo
 * can request a debounced save without the store importing the bridge. A
 * request made while none was registered is handed to the next one.
 */
export function setEditorAutosaveRequester(requester: (() => void) | null): void {
  autosaveRequester = requester;
  if (requester !== null && autosaveWaiting) {
    autosaveWaiting = false;
    requester();
  }
}

/** Ask the bridge for the debounced save, now or as soon as one is listening. */
function requestAutosave(): void {
  if (autosaveRequester === null) autosaveWaiting = true;
  else autosaveRequester();
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

/**
 * A step back or forward is refused whole when its result would lack a piece
 * that holds a note this browser is not shown (lib/guest-plan-notes): the
 * piece would be gone, and its note with it at the next save. A piece the
 * person placed can come to hold one: the newer version they kept theirs
 * over, or took as already saved, put a note on it, and the history outlives
 * both. The reason is posted in `words`; the document and the history stay as
 * they are, and no step is added.
 */
function stepRefusedForHeldNote(
  state: EditorState,
  result: readonly EditorObject[],
  words: (pieces: readonly ChangedPiece[]) => string,
): boolean {
  const dropped = heldNotePiecesDropped(state, result);
  if (dropped.length === 0) return false;
  postPlacementNotice(words(heldNoteObjectsNamed(dropped, state.objects)));
  return true;
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
  notesIncluded: false,
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
  noteClearsRefused: [],
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
  restoredFromDevice: null,
  leftBehind: null,
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

/** The open plan the signed-in routes were asked to read again, and for whom: once each (readAgainForSignedInRoutes). */
let signedInReadAsked: string | null = null;

/** Nothing on screen waits to be saved, and no save or conflict is under way. */
function nothingUnsaved(state: EditorState): boolean {
  return !state.isDirty && !state.isSaving && state.saveConflict === null;
}

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
  "configId", "spaceId", "venueId", "configRevision", "isPublicPreview", "notesIncluded", "objects", "baseObjects", "isDirty",
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
    // The copy says what it was read with, so restoring it elsewhere cannot
    // pass a document read without the plan's notes off as the whole of them.
    notesIncluded: state.notesIncluded,
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
  if (user?.platformRole === "admin" || (user?.role === "admin" && user.venueId !== null && user.venueId === state.venueId)) return null;
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

/** The newest step on the undo timeline: it moves with every change the
 *  person makes, undo and redo included, and stays put through a save. */
function timelineTop(history: EditorHistory<EditorObject>): number {
  return history.past.at(-1)?.seq ?? 0;
}

/**
 * The restore receipt and the note about a layout left behind stay until the
 * person's next change to the open layout. A write that sets either itself
 * (a load) keeps what it set.
 */
function settledNotices(previous: EditorStore, next: EditorStore, patch: Partial<EditorStore>): Partial<EditorState> {
  if (next.restoredFromDevice === null && next.leftBehind === null) return {};
  if (next.configId === null || next.configId !== previous.configId) return {};
  if (timelineTop(next.history) === timelineTop(previous.history)) return {};
  return {
    ...("restoredFromDevice" in patch ? {} : { restoredFromDevice: null }),
    // A refused clear's sentence stands until the person dismisses it (ruling R1(b) on #388).
    ...("leftBehind" in patch || next.leftBehind?.notRemoved !== undefined ? {} : { leftBehind: null }),
  };
}

function withSaveFacts(initializer: StateCreator<EditorStore>): StateCreator<EditorStore> {
  return (rawSet, get, api) => {
    // Merging covers both of zustand's forms: a replace carries every field.
    const setWithFacts = (update: EditorStoreUpdate): void => {
      const previous = get();
      const patch = typeof update === "function" ? update(previous) : update;
      const next: EditorStore = { ...previous, ...patch };
      rawSet({ ...next, ...settledNotices(previous, next, patch), ...deriveSaveFacts(previous, next) }, true);
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

/**
 * Whether the signed-in routes answer this person for a public preview. It
 * names no owner, so they admit only the floor at its venue and a platform
 * admin (the API's canAccessResource; claim-new-draft-postgres.test.ts holds
 * the refusal for everyone else).
 */
function signedInRoutesAnswerPreview(venueId: string | null): boolean {
  const user = useAuthStore.getState().user;
  if (user === null) return false;
  if (user.platformRole === "admin") return true;
  return venueId !== null && user.venueId === venueId && hasRole(VENUE_FLOOR_ROLES, user.role);
}

/**
 * Which routes read and save the open layout. One a person owns goes through
 * the signed-in routes. A public preview does so only for those they answer;
 * anyone else, signed in or not, uses the public routes, as the guest who made
 * it does. The choice used to follow the sign-in alone, so a signed-in client's
 * every save to a preview was refused (audit editor-save-1).
 */
function usesSignedInRoutes(
  layout: Pick<EditorState, "isPublicPreview" | "venueId">,
  isAuthenticated: boolean | undefined,
): boolean {
  if (!layout.isPublicPreview) return true;
  return isAuthenticated === true && signedInRoutesAnswerPreview(layout.venueId);
}

/**
 * The read that opens a layout. A signed-in person's goes through the
 * signed-in route, which refuses a public preview to anyone off its venue's
 * floor. A guest could open that preview, so a refused read tries the public
 * route before giving up, and gives the refusal when that has nothing either.
 */
async function readLayoutToOpen(
  configId: string,
  isAuthenticated: boolean | undefined,
  handedOff: configApi.Configuration | null,
): Promise<configApi.Configuration> {
  if (isAuthenticated !== true) return handedOff ?? await configApi.getPublicConfig(configId);
  try {
    return await configApi.getConfig(configId);
  } catch (refusal) {
    if (!(refusal instanceof ApiError) || refusal.status !== 403) throw refusal;
    try {
      return handedOff ?? await configApi.getPublicConfig(configId);
    } catch {
      throw refusal;
    }
  }
}

/** The server's current copy of the layout, or null when it cannot be read. */
async function readServerCopy(configId: string, useAuthPath: boolean): Promise<configApi.Configuration | null> {
  try {
    // A guest plan read without its notes is only ever compared with, and
    // kept over, a copy read the same way (lib/guest-plan-notes.ts).
    const signedIn = useAuthPath && signedInRoutesSuit(useEditorStore.getState());
    const config = signedIn ? await configApi.getConfig(configId) : await configApi.getPublicConfig(configId);
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
    // Another layout is opening in this page (QoL D-X3): the open one's
    // unsaved work goes first, beside the read, for up to 2 s. Its autosave
    // would otherwise wake to find this layout loaded and clean.
    const leaving = get().configId;
    const outgoing = leaving !== null && leaving !== configId ? saveBeforeLayoutChange() : null;
    try {
      const [config, outgoingOutcome] = await Promise.all([
        readLayoutToOpen(configId, isAuthenticated, handedOff),
        outgoing,
      ]);
      if (request !== configurationLoadRequest) return;
      // Neither saved nor kept here: it is lost with the switch, and the person
      // is told. A save that landed after the outgoing check had looked (the
      // route unmounting flushes too) means nothing was lost after all.
      const stillUnsaved = get().configId === leaving && get().isDirty;
      const lostOnLeaving = outgoingOutcome !== null && lostWithTheSwitch(outgoingOutcome) && stillUnsaved ? leftBehindFor(get(), false) : null;
      // Unsaved work this device kept (another open page's stays that page's).
      const keptDraft = await draftNotHeldElsewhere(draftForLoad(config, isAuthenticated));
      if (request !== configurationLoadRequest) return;
      // A GET may have captured its row before a concurrent save was accepted.
      // Reloading cannot roll an acknowledged revision (or newer local edits)
      // backwards, even when this is the newest load request for the same ID.
      const current = get();
      if (current.configId === config.id && current.configRevision !== null && config.revision < current.configRevision) {
        set({ isLoading: false });
        return;
      }
      const readObjects = (config.objects ?? []).map(placedObjectToEditor);
      // A guest plan's notes go only to the browser that made it, so this read
      // says whether it carries them. Work kept by a page that read the plan
      // without them holds every piece without its note: opened here with the
      // notes, it takes the ones it never read from this copy, or restoring it
      // would clear them all (review of #375).
      const notesRead = config.notesIncluded === true;
      const localDraft = keptDraft !== null && notesRead && keptDraft.notesIncluded !== true
        ? plannerDraftWithUnreadNotes(keptDraft, readObjects)
        : keptDraft;
      // The other way about: a read without the notes hides the ones this
      // browser wrote. Work kept here at this very revision knows which notes
      // the server had confirmed to it, so the person can go on with theirs.
      const confirmedHere = localDraft !== null && !notesRead && localDraft.baseRevision === config.revision
        ? plannerDraftBaseObjects(localDraft)
        : null;
      const serverObjects = confirmedHere === null ? readObjects : keepingConfirmedNotes(readObjects, confirmedHere);
      // One edited from this revision restores as it is. One edited from any
      // other revision restores onto the base it was edited from, at that
      // revision, as a conflict the person settles before anything is saved:
      // it never overwrites the newer copy, and nothing (no autosave, no live
      // refetch) merges it. This load already holds their version.
      const draftIsCurrent = localDraft !== null && localDraft.baseRevision === config.revision;
      const draftBase = localDraft === null ? null : draftIsCurrent ? serverObjects : plannerDraftBaseObjects(localDraft);
      // QoL D-X2: a save sent as the page closed can land unheard, leaving a
      // kept copy a revision behind a server that already holds it. Only a
      // copy with work the server lacks restores, so that is no conflict; nor
      // is a copy that changes nothing.
      const keptWork = localDraft !== null && draftBase !== null
        && changedBetween(draftBase, localDraft.objects).size > 0
        && !serverHoldsLayout(localDraft.objects, serverObjects, (id) => EDITOR_HISTORY_IDS.isLocalId(id))
        ? localDraft
        : null;
      const staleDraftBase = keptWork !== null && !draftIsCurrent ? draftBase : null;
      const restoredDraft = keptWork;
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
      // A kept copy that restores nothing has done its work.
      if (localDraft !== null && restoredDraft === null) forgetPlannerDraft(localDraft);
      const restoreBase = staleDraftBase ?? serverObjects;
      const leftBehind = lostOnLeaving ?? get().leftBehind;
      configurationSession += 1;
      yieldedIds.clear();
      healedCopies.clear();
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
        // Restored work that does not say it was read with the notes is not
        // the whole truth about them, whichever browser restores it.
        notesIncluded: notesRead && (restoredDraft === null || restoredDraft.notesIncluded === true),
        objects,
        baseObjects: staleDraftBase ?? serverObjects,
        isDirty: restoredDraft !== null,
        isSaving: false,
        saveError: loadConflict === null ? null : CONFLICT_SAVE_ERROR,
        saveErrorCode: loadConflict === null ? null : "REVISION_CONFLICT",
        noteClearsRefused: [],
        lastSavedAt: config.updatedAt === undefined ? null : new Date(config.updatedAt),
        space: get().space?.id === config.spaceId && get().space?.venueId === config.venueId ? get().space : null,
        isLoading: false,
        saveConflict: loadConflict,
        reviewStatus: config.reviewStatus ?? null,
        reviewLockRefused: false,
        // QoL D-01: restored work is one undo step back to the server's copy.
        history: restoredDraft === null ? emptyHistory<EditorObject>() : restoreStep(restoreBase, restoredDraft.objects),
        restoredFromDevice: restoredDraft === null ? null : {
          changes: changedBetween(restoreBase, restoredDraft.objects).size,
          editedAt: new Date(restoredDraft.updatedAtMs),
        },
        // Opening the layout left behind is what its note asked for.
        leftBehind: leftBehind?.configId === config.id ? null : leftBehind,
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
      // it waits for the person's choice. Kept work that lacks a piece holding
      // a note this browser is not shown takes it back now, not at that save:
      // the API's refusal of such a save says a reload puts the piece back.
      if (restoredDraft !== null && loadConflict === null) {
        putBackHeldNotePieces();
        requestAutosave();
      }
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
      healedCopies.clear();
      conflictServerCopy = null;
      set({
        configId: config.id,
        configName: config.name,
        isTemplate: config.isTemplate === true,
        spaceId: config.spaceId,
        venueId: config.venueId,
        configRevision: config.revision,
        isPublicPreview: true,
        // A new plan holds no note, so its creating answer says they are all here.
        notesIncluded: config.notesIncluded === true,
        objects: [],
        baseObjects: [],
        isDirty: false,
        isSaving: false,
        saveError: null,
        saveErrorCode: null,
        noteClearsRefused: [],
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
    requestAutosave();
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
    requestAutosave();
  },

  removeObject: (objectId) => {
    if (isLayoutTimelineMutationLocked()) return;
    const s = get();
    // Someone who cannot see a note never destroys it: the piece stays, and so
    // does a piece whose group holds one, as a table keeps its chairs.
    const going = s.objects.find((o) => o.id === objectId);
    const held = heldNoteIds(s);
    const holders = going === undefined ? [] : s.objects.filter((o) => held.has(o.id)
      && (o.id === objectId || (going.groupId !== null && o.groupId === going.groupId)));
    if (holders.length > 0) {
      // A note of their own that no save has confirmed yet is one they can read: it is still being saved.
      const carried = carriedNoteIds(s);
      postPlacementNotice(holders.every((o) => carried.has(o.id))
        ? noteStillSavingLine(heldNoteObjectsNamed(holders, s.objects))
        : nothingRemovedLine(heldNoteObjectsName(holders, s.objects)));
      return;
    }
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

  saveToServer: (isAuthenticated, transport) => saveDocument(isAuthenticated, false, transport),

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
        const read = await readServerCopy(configId, usesSignedInRoutes(s, authenticated));
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
      // Their version read without the plan's notes hides the ones this
      // browser wrote: the notes confirmed here stay known, so the person
      // can go on with theirs. They were confirmed at the older revision,
      // and their version may hold other words on such a piece. So each is
      // carried with its mark (keepingConfirmedNotes): nothing takes the
      // piece until a save has confirmed the note, and a save refused for a
      // held note drops the record rather than name a wrong note for ever.
      // The newer revision becomes this document's base: the full-sync save
      // replaces it with this document, and pendingChanges (so savingChanges)
      // counts exactly what that save changes on the server.
      set({
        configRevision: conflict.currentRevision,
        baseObjects: keepingConfirmedNotes(theirs, current.baseObjects, true),
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

  readAgainForSignedInRoutes: async () => {
    const s = get();
    const configId = s.configId;
    if (configId === null || s.isLoading || signedInRoutesSuit(s) || !nothingUnsaved(s)) return false;
    if (!usesSignedInRoutes(s, useAuthStore.getState().isAuthenticated)) return false;
    const key = JSON.stringify([configurationSession, configId, draftOwner()]);
    if (signedInReadAsked === key) return false;
    signedInReadAsked = key;
    const session = configurationSession;
    let config: configApi.Configuration;
    try {
      config = await configApi.getConfig(configId);
    } catch {
      // Refused or not arrived: the plan stays on the public routes it was opened by.
      return false;
    }
    const now = get();
    if (session !== configurationSession || now.configId !== configId || signedInRoutesSuit(now)) return false;
    // A change made while the read was out is the person's: nothing is read
    // over it. The read is asked for again once the change is saved.
    if (now.objects !== s.objects || now.baseObjects !== s.baseObjects || now.configRevision !== s.configRevision
      || !nothingUnsaved(now) || gestureOwnsCurrentDocument()) {
      if (signedInReadAsked === key) signedInReadAsked = null;
      return false;
    }
    if (config.id !== configId || config.notesIncluded !== true || now.configRevision === null || config.revision < now.configRevision) return false;
    const server = (config.objects ?? []).map(placedObjectToEditor);
    // As a newer copy is taken over a document with nothing unsaved
    // (adoptServerConfiguration): undo never replays an older value over a
    // piece the read changed. Here that is each piece the public read kept a
    // note from, whose steps hold it without the note; replayed and saved by
    // the signed-in route, which stores each piece as sent, they would clear it.
    actionEmitter.flush(now.history);
    yieldedIds.clear();
    conflictServerCopy = null;
    set({
      isPublicPreview: config.isPublicPreview,
      notesIncluded: true,
      objects: server,
      baseObjects: server,
      history: forgetHistoryIds(now.history, changedBetween(now.baseObjects, server)),
      configName: config.name,
      configRevision: config.revision,
      reviewStatus: config.reviewStatus ?? now.reviewStatus,
      ...(config.reviewStatus !== undefined && isPlannerEditable(config.reviewStatus) ? { reviewLockRefused: false } : {}),
      lastSavedAt: config.updatedAt === undefined ? now.lastSavedAt : new Date(config.updatedAt),
    });
    return true;
  },

  setReviewStatus: (configId, status) => {
    if (get().configId !== configId) return;
    set({
      reviewStatus: status,
      ...(status !== null && isPlannerEditable(status) ? { reviewLockRefused: false } : {}),
    });
  },

  clearSaveError: () => { set(standingRefusal(get())); },

  dismissRefusedClears: () => {
    const s = get();
    if (s.noteClearsRefused.length === 0) return;
    // Another refusal or failure on the line stands on, without the clear's sentence beside it.
    const standsOn = s.saveErrorCode !== NOTE_HELD_CODE || ownWordsOverHeldNotes(s).length > 0;
    const clear = refusedClearsLine(s);
    const rest = clear !== null && s.saveError?.endsWith(clear) === true ? s.saveError.slice(0, -clear.length).trimEnd() : s.saveError;
    set({
      noteClearsRefused: [],
      ...(standsOn && rest !== null && rest !== "" ? { saveError: rest } : { saveError: null, saveErrorCode: null }),
    });
  },

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
    if (options.requestSave !== false) requestAutosave();
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
    healedCopies.clear();
    useCockpitStore.getState().setPlannedGuestCount(null);
    conflictServerCopy = null;
    layoutChangeAttempt = null;
    autosaveWaiting = false;
    // Preserve the scene ref — reset clears editor data but the Three.js
    // scene is still alive in the Canvas. SceneProvider manages the ref.
    // The network is the browser's, not the layout's: it survives too, and so
    // does the note about a layout left behind (the slate's room switch resets
    // between the layout it leaves and the one it opens).
    set({ ...INITIAL_STATE, scene: get().scene, isOnline: get().isOnline, leftBehind: get().leftBehind });
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
    const step = performUndo(s.history, s.objects, historyIdsFor(s));
    if (step === null) return;
    if (stepRefusedForHeldNote(s, step.objects, nothingUndoneLine)) return;
    actionEmitter.afterUndo(s.history); // G4: seals the popped gesture + logs history.undo
    interactionEpoch++;
    for (const [original, copy] of step.healed) healedCopies.set(original, copy);
    set(historyStepPatch(step));
    notifyLocalChange(s.objects, step.objects);
    useSelectionStore.getState().selectMultiple(step.selection);
    requestAutosave();
  },

  redo: () => {
    if (isLayoutTimelineMutationLocked()) return;
    activeHistoryGesture = null;
    const s = get();
    const step = performRedo(s.history, s.objects, historyIdsFor(s));
    if (step === null) return;
    if (stepRefusedForHeldNote(s, step.objects, nothingRedoneLine)) return;
    actionEmitter.afterRedo(step.history); // G4: logs history.redo
    interactionEpoch++;
    for (const [original, copy] of step.healed) healedCopies.set(original, copy);
    set(historyStepPatch(step));
    notifyLocalChange(s.objects, step.objects);
    useSelectionStore.getState().selectMultiple(step.selection);
    requestAutosave();
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
      if (get().isDirty) requestAutosave();
    }
  },

  isHistoryGestureCurrent: (token) => activeHistoryGesture?.token === token
    && gestureOwnsCurrentDocument() && !isLayoutTimelineMutationLocked(),

  historyGestureIdMap: (token) => activeHistoryGesture?.token === token
    && gestureOwnsCurrentDocument() && !isLayoutTimelineMutationLocked()
    ? activeHistoryGesture.objectIds : null,
})));

/**
 * Put back the pieces the working document has lost that the confirmed one
 * says hold a note this browser is not shown, each as the server sent it (its
 * id, where it stood, its details) and with the rest of its group, and say
 * that they stayed (lib/guest-plan-notes heldNotePiecesToPutBack). The
 * timeline forgets them: no step may take them away again, or return them a
 * second time. True when anything went back.
 */
function putBackHeldNotePieces(): boolean {
  const s = useEditorStore.getState();
  const back = heldNotePiecesToPutBack(s, s.baseObjects, s.objects);
  if (back.pieces.length === 0) return false;
  // A piece the person brought back with Undo or Redo while a save was in
  // flight stands under a fresh id (healedCopies): it is that piece, so it
  // takes its own id back instead of a second one being returned beside it.
  const present = new Set(s.objects.map((object) => object.id));
  const returning = new Map<string, string>();
  for (const piece of back.pieces) {
    const copy = healedCopies.get(piece.id);
    if (copy !== undefined && present.has(copy)) {
      returning.set(copy, piece.id);
      healedCopies.delete(piece.id);
    }
  }
  const comingBack = new Set(returning.values());
  const inserted = back.pieces.filter((piece) => !comingBack.has(piece.id));
  const objects = [
    ...(returning.size === 0 ? s.objects : s.objects.map((object) => {
      const id = returning.get(object.id);
      return id === undefined ? object : { ...object, id };
    })),
    ...inserted,
  ];
  if (returning.size > 0) {
    const selection = useSelectionStore.getState();
    if ([...selection.selectedIds].some((id) => returning.has(id))) {
      selection.selectMultiple([...selection.selectedIds].map((id) => returning.get(id) ?? id));
    }
  }
  useEditorStore.setState({
    objects,
    isDirty: true,
    history: forgetHistoryIds(remapHistoryIds(s.history, returning), new Set(inserted.map((piece) => piece.id))),
    ...(s.selectedObjectId !== null && returning.has(s.selectedObjectId) ? { selectedObjectId: returning.get(s.selectedObjectId) } : {}),
  });
  notifyLocalChange(s.objects, objects);
  const insertedIds = new Set(inserted.map((piece) => piece.id));
  const returned = back.held.filter((piece) => insertedIds.has(piece.id));
  if (returned.length === 0) return true;
  // A note of their own that no save has confirmed yet ("Keep mine" carries
  // it) is one they can read: it is still being saved, as removeObject says
  // it, never one that cannot be shown here (delta review R4).
  const carried = carriedNoteIds(s);
  const named = heldNoteObjectsNamed(returned, s.baseObjects);
  const line = returned.every((piece) => carried.has(piece.id)) ? noteStillSavingLine(named) : stayedForNotesLine(named);
  if (line !== null) postPlacementNotice(line);
  return true;
}

/**
 * The ids the server gave the pieces a save placed: the local ids it sent
 * (batch order) zipped with the rows it inserted (echoed updates first, then
 * inserts, each in input order). Null when they cannot be aligned.
 */
function placedIdsOf(sent: readonly EditorObject[], answer: readonly PlacedObject[]): Map<string, string> | null {
  const sentLocalIds = sent.map((o) => o.id).filter((id) => EDITOR_HISTORY_IDS.isLocalId(id));
  const sentServerIds = new Set(sent.map((o) => o.id).filter((id) => !EDITOR_HISTORY_IDS.isLocalId(id)));
  const insertedIds = answer.map((p) => p.id).filter((id) => !sentServerIds.has(id));
  if (sentLocalIds.length !== insertedIds.length) return null;
  const idMap = new Map<string, string>();
  sentLocalIds.forEach((localId, i) => {
    const serverId = insertedIds[i];
    if (serverId !== undefined) idMap.set(localId, serverId);
  });
  return idMap;
}

/** What the saves sent after a refusal for an out-of-date note came to. */
interface OutOfDateNotesSettled {
  /** The answer to the last of them that landed. */
  readonly saved: configApi.BatchSaveResponse;
  /** The notes that save left to the server that are out of date: piece id to the words on record. */
  readonly left: ReadonlyMap<string, string>;
  /**
   * The notes it left that no save has yet shown to be either, because the
   * saves stopped early: still this browser's record, carried until a save
   * confirms them. Empty when they finished.
   */
  readonly unsettled: ReadonlyMap<string, string>;
  /** What stopped them early, after one had landed; null when they finished. */
  readonly stoppedBy: { readonly failure: unknown } | null;
}

/**
 * A save the API refused for a held note without saying which piece, when no
 * words of the person's stand over one: a note this browser has on record is
 * out of date. Only the pieces the refusal can be about are tried, the ones
 * sent with a recorded note. A piece whose note is left to the server goes
 * with no word about its note, which keeps whatever it holds; a save lands
 * exactly when every out-of-date note is among those it leaves.
 *
 * The save is sent first leaving them all. It lands unless the refusal was for
 * something else, and the rest of the work is then saved at once. The notes
 * out of date are then found by halving (delta review of #388 at 713dc3f1,
 * R1): each save sends the notes known to be in date and the first half of
 * those still in question as the person has them, and leaves the rest; it
 * lands only if none it sends is out of date, which settles those it sends,
 * and is refused otherwise. So a recorded note is never left to the server
 * unless it is out of date, and a note the person cleared or changed is
 * cleared or changed. With k of n notes out of date that is at most
 * 2 + k (ceil(log2 n) + 1) saves, the refused one included: never one a note.
 * Each save goes on the revision the last one that landed made, and names the
 * rows the first one placed, so nothing is placed twice.
 *
 * Null when nothing lands, or the plan is no longer the open one; a failure
 * before anything lands is thrown. A failure after that stops the saves, and
 * what landed is kept (`stoppedBy`, `unsettled`).
 */
async function saveLeavingOutOfDateNotes(
  objects: readonly EditorObject[],
  batch: readonly BatchObjectInput[],
  recorded: ReadonlyMap<string, string>,
  revision: number,
  send: (pieces: readonly BatchObjectInput[], revision: number) => Promise<configApi.BatchSaveResponse>,
  stillOpen: () => boolean,
): Promise<OutOfDateNotesSettled | null> {
  const sent = objects.flatMap((object) => (recorded.has(object.id) ? [object.id] : []));
  if (sent.length === 0 || !stillOpen()) return null;
  const onRecord = (ids: Iterable<string>): ReadonlyMap<string, string> => new Map([...ids].map((id) => [id, recorded.get(id) ?? ""]));
  let placedAs: ReadonlyMap<string, string> = new Map<string, string>();
  let current = revision;
  /** The save leaving these notes to the server: its answer, or its refusal for a held note. Any other failure is thrown. */
  const leaving = async (left: ReadonlySet<string>): Promise<configApi.BatchSaveResponse | ApiError> => {
    const pieces = batch.map((piece, index) => {
      const object = objects[index];
      if (object === undefined) return piece;
      const going = left.has(object.id) ? editorToBatch({ ...object, notes: "" }) : piece;
      const id = placedAs.get(object.id);
      return id === undefined ? going : { ...going, id };
    });
    try {
      const answer = await send(pieces, current);
      current = answer.revision;
      return answer;
    } catch (err) {
      if (err instanceof ApiError && err.code === NOTE_HELD_CODE) return err;
      throw err;
    }
  };

  const everyNote: ReadonlySet<string> = new Set(sent);
  const first = await leaving(everyNote);
  if (first instanceof ApiError) return null;
  let landed: { readonly saved: configApi.BatchSaveResponse; readonly left: ReadonlySet<string> } = { saved: first, left: everyNote };
  // Rows that cannot be matched to the pieces placed would be placed again by a later save: what landed stands.
  const placed = placedIdsOf(objects, first.objects);
  if (placed === null) return { saved: first, left: onRecord(everyNote), unsettled: new Map(), stoppedBy: null };
  placedAs = placed;

  const outOfDate: string[] = [];
  // Still in question, in the document's order; at least one of them is out of date.
  let open: readonly string[] = sent;
  try {
    for (;;) {
      // The first one out of date: everything before it is in date.
      let low = 0;
      let high = open.length - 1;
      while (low < high) {
        if (!stillOpen()) return null;
        const middle = Math.floor((low + high) / 2);
        const left = new Set([...outOfDate, ...open.slice(middle + 1)]);
        const answer = await leaving(left);
        if (answer instanceof ApiError) {
          high = middle;
        } else {
          landed = { saved: answer, left };
          low = middle + 1;
        }
      }
      const found = open[low];
      if (found !== undefined) outOfDate.push(found);
      open = open.slice(low + 1);
      if (open.length === 0 && landed.left.size === outOfDate.length && outOfDate.every((id) => landed.left.has(id))) break;
      // The rest, sent as the person has them: all in date, or another one is out of date.
      if (!stillOpen()) return null;
      const rest = new Set(outOfDate);
      const answer = await leaving(rest);
      if (!(answer instanceof ApiError)) {
        landed = { saved: answer, left: rest };
        break;
      }
      // Every note left is out of date already: the same save can only be refused again.
      if (open.length === 0) throw answer;
    }
  } catch (failure) {
    const proven = new Set(outOfDate);
    return {
      saved: landed.saved,
      left: onRecord([...landed.left].filter((id) => proven.has(id))),
      unsettled: onRecord([...landed.left].filter((id) => !proven.has(id))),
      stoppedBy: { failure },
    };
  }
  return { saved: landed.saved, left: onRecord(outOfDate), unsettled: new Map(), stoppedBy: null };
}

/**
 * What the save line says when nothing else is to be said: a refused clear's
 * notice while it stands (noteClearsRefused), in its own sentence
 * (lib/guest-plan-notes refusedClearsLine, ruling C3), or nothing. Every save
 * that ends without a refusal of its own, and every failure put away, leaves
 * this: the notice stays until the person dismisses it, and no save says the
 * layout saved while it does (ruling R1(b) on #388). The autosave goes on.
 */
function standingRefusal(state: Pick<EditorState, "noteClearsRefused" | "objects" | "baseObjects">): Pick<EditorState, "saveError" | "saveErrorCode"> {
  const said = refusedClearsLine(state);
  return said === null ? { saveError: null, saveErrorCode: null } : { saveError: said, saveErrorCode: NOTE_HELD_CODE };
}

/** A refusal's words and a refused clear's sentence beside them, as one notice; null for neither. */
function saidTogether(...words: readonly (string | null)[]): string | null {
  const said = words.filter((one): one is string => one !== null && one !== "");
  return said.length === 0 ? null : said.join(" ");
}

/**
 * The save itself. `keeping` is "Keep mine": it may run while the conflict it
 * settles is pending (every other save waits for the person's choice), and a
 * 409 during it is always reported as a fresh conflict, never rebased, even
 * in the live room: a third version is the person's to see first.
 */
async function saveDocument(
  isAuthenticated: boolean | undefined,
  keeping: boolean,
  transport?: configApi.BatchSaveTransport,
): Promise<boolean> {
  const get = useEditorStore.getState;
  const set = useEditorStore.setState;
  if (isLayoutTimelineMutationLocked()) return false;
  // A mid-drag save would seal an incomplete action-log entry. Release or
  // cancellation schedules the complete transaction through the same bridge.
  if (gestureOwnsCurrentDocument()) return false;
  const { configId, configRevision, isSaving, isPublicPreview, venueId, saveConflict } = get();
  // What this save sends; the note-clearing step below may take a piece back into it.
  let objects = get().objects;
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

  // Someone who cannot see a note never destroys it (lib/guest-plan-notes). A
  // piece left out of a save is removed, and its note with it, and the API
  // does not refuse that. So no save goes without a piece the confirmed
  // document says holds a note this browser is not shown, whatever wrote the
  // working one: this is the one place every path to a save must pass. Such a
  // piece is put back first and the person is told it stayed; only then is
  // the document, which now has it, sent.
  if (putBackHeldNotePieces()) return saveDocument(isAuthenticated, keeping, transport);

  // The save path: the signed-in route for a layout someone owns, and for a
  // public preview only when that route answers this person (usesSignedInRoutes).
  const useAuthPath = usesSignedInRoutes({ isPublicPreview, venueId }, isAuthenticated);
  // A guest plan's save names the note each changed note replaces, and says
  // its notes are complete only when this document was read with them
  // (lib/guest-plan-notes.ts; api/configurations.ts BatchSaveOptions).
  // The signed-in save stores each piece as sent, so a guest plan read
  // without its notes never goes that way, whoever has signed in since.
  const viaSignedIn = useAuthPath && signedInRoutesSuit(get());
  // A piece the person has removed that carries their own note, in a
  // browser the plan's notes are kept from: the API cannot tell that note
  // from one this browser is not shown, and refuses a save that leaves the
  // piece out. So the note is cleared first, by name, in a save of its own
  // (lib/guest-plan-notes batchClearingOwnNotesOfRemovedPieces), and the
  // save that removes the piece follows on the revision that one made.
  // Only that save's confirmed document and revision are taken: the working
  // document is untouched, so the piece does not come back on screen.
  const confirmed = get().baseObjects;
  const clearing = viaSignedIn || get().notesIncluded ? null : batchClearingOwnNotesOfRemovedPieces(confirmed, objects, editorToBatch);
  // Never as the page hides or closes: the second save cannot be counted on
  // to follow the first. Nothing is sent, and nothing on screen changes (a
  // refusal standing there still stands); the work stays unsaved and on this
  // device, and the autosave the page's going cancelled is asked for again,
  // so the two steps go once the page runs again (delta review R9).
  if (clearing !== null && transport?.keepalive === true) {
    requestAutosave();
    return false;
  }

  // savingChanges is captured from pendingChanges here (deriveSaveFacts). A
  // pending conflict stays until this save lands: only then is it settled.
  set({ isSaving: true, ...standingRefusal(get()) });
  try {
    const save = viaSignedIn ? configApi.authBatchSave : configApi.publicBatchSave;
    const sending: configApi.BatchSaveOptions | undefined = !viaSignedIn && get().notesIncluded
      ? { ...transport, notesIncluded: true }
      : transport;
    let revision = configRevision;
    if (clearing !== null) {
      let cleared: configApi.BatchSaveResponse | null = null;
      try {
        cleared = sending === undefined
          ? await save(configId, clearing, revision)
          : await save(configId, clearing, revision, sending);
      } catch (refused) {
        // Refused for the confirmed document itself: a note in it has changed
        // since it was read (NOTE_HELD), or a piece in it is no longer
        // accepted (422). Every later save would meet the same refusal while
        // the removal waited, so it is given up: the piece is taken back,
        // with what it holds, and the work goes on its own (lib/guest-plan-notes
        // givingUpOwnNoteRemoval; delta review R3, A6). A newer version, or a
        // failure to reach the server, is answered as for any save.
        if (!(refused instanceof ApiError) || (refused.code !== NOTE_HELD_CODE && refused.status !== 422)) throw refused;
        if (session !== configurationSession || get().configId !== configId) return false;
        set({ baseObjects: givingUpOwnNoteRemoval(confirmed, objects, refused.code === NOTE_HELD_CODE) });
      }
      if (cleared !== null) {
        if (session !== configurationSession || get().configId !== configId) return false;
        revision = cleared.revision;
        // A note its answer holds that it did not send is one this browser
        // has not shown, and the working document is not touched here: it is
        // held, never named by the save that follows (delta review X1).
        const answered = takingNotesKeptUnsent(objects, cleared.objects.map(placedObjectToEditor), notesSentIn(clearing), null).confirmed;
        set({ configRevision: revision, baseObjects: keepingConfirmedNotes(answered, confirmed) });
      }
      // That answer can say a piece this document has lost holds a note this
      // browser is not shown (one written since by the single-piece route):
      // nothing is sent without it, so it is taken back now, as at the start
      // of every save, and the removing save sends it (delta review R2).
      if (putBackHeldNotePieces()) objects = get().objects;
    }
    const batch = viaSignedIn
      ? objects.map(editorToBatch)
      : namingReplacedNotes(objects.map(editorToBatch), objects, get().baseObjects);
    const send = (pieces: readonly BatchObjectInput[], at: number): ReturnType<typeof save> => sending === undefined
      ? save(configId, pieces, at)
      : save(configId, pieces, at, sending);
    // A save refused for a held note, though no words of the person's stand
    // over one, was refused for a note this browser has on record that is out
    // of date: "Keep mine" carries the notes confirmed at one revision onto a
    // newer one, where someone else may have rewritten them. It is sent again
    // until the notes out of date are found and left to the server
    // (saveLeavingOutOfDateNotes), and isSaving stays true throughout: a
    // caller waiting on this save is answered once, when it has settled.
    const sentBase = get().baseObjects;
    let saved: Awaited<ReturnType<typeof save>>;
    let outOfDate: ReadonlyMap<string, string> = new Map<string, string>();
    let unsettled: ReadonlyMap<string, string> = new Map<string, string>();
    let stoppedBy: { readonly failure: unknown } | null = null;
    let refusedWords: string | null = null;
    try {
      saved = await send(batch, revision);
    } catch (refused) {
      if (viaSignedIn || !(refused instanceof ApiError) || refused.code !== NOTE_HELD_CODE
        || ownWordsOverHeldNotes({ ...get(), objects, baseObjects: sentBase }).length > 0) throw refused;
      const stale = await saveLeavingOutOfDateNotes(objects, batch, recordedNotes(sentBase), revision, send,
        () => session === configurationSession && get().configId === configId);
      if (stale === null) throw refused;
      ({ saved, left: outOfDate, unsettled, stoppedBy } = stale);
      refusedWords = refused.message;
    }
    // The server may have accepted the old document. It no longer owns this
    // editor, its revision/history/selection, or its caller's saved feedback.
    if (session !== configurationSession || get().configId !== configId) return false;
    const serverObjects = saved.objects.map(placedObjectToEditor);
    // Whole-history id remap (placedIdsOf). If the rows cannot be aligned the
    // timeline can no longer be trusted — clear it rather than risk undo
    // resurrecting rows under dead ids.
    const placedIds = placedIdsOf(objects, saved.objects);
    const aligned = placedIds !== null;
    const idMap = placedIds ?? new Map<string, string>();
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
    const answered = editedInFlight
      ? latest.objects.map((object) => {
          const serverId = idMap.get(object.id);
          return serverId === undefined ? object : { ...object, id: serverId };
        })
      : serverObjects;
    // A note this save left to the server is no longer this browser's: its
    // record went with the answer, and its words come off the piece. A change
    // the person had made to it was not made: words they had put in its place
    // stay there, unsaved, and a note they had cleared stays cleared. Either
    // is refused, never said to be saved, and the refusal that named no piece
    // is now about that one: the API's sentence names words over a held note
    // (pieceNamedForRefusedSave), and a refused clear has its own (refusedClearsLine).
    const refusedNotes = notesRefusedOnLeaving(latest.objects, outOfDate);
    const noteRefused = refusedNotes.length > 0;
    // A refused clear leaves nothing unsaved: the piece is as the server has
    // it, holding the note it is shown to hold. Words the person put in a
    // note's place are unsaved, and stay so until they take them off.
    const wordsRefused = refusedNotes.some((object) => object.notes !== "");
    // Clears refused before, whose notice still stands, and these.
    const clearsRefused = [...new Set([
      ...get().noteClearsRefused,
      ...refusedNotes.filter((object) => object.notes === "").map((object) => object.id),
    ])];
    // A note the saves stopped short of vouching for stays on record, carried
    // as "Keep mine" carries one (keepingConfirmedNotes), with the person's
    // words on the piece: the next save sends it again.
    const theirWords = new Map(latest.objects.map((object) => [object.id, object.notes]));
    const nextObjects = afterLeavingOutOfDateNotes(answered, latest.objects, outOfDate, serverObjects)
      .map((object) => (unsettled.has(object.id) ? { ...object, notes: theirWords.get(object.id) ?? object.notes } : object));
    // A yielded object stays the server's: never resend an older local copy.
    const objectsAfter = snapYieldedToBase(nextObjects, serverObjects);
    // A note left to the server is never named by a later save unless this
    // browser shows it (delta review of #388 at 33a8e0ad, S2).
    const confirmedAnswer = confirmedAfterLeaving(serverObjects, objectsAfter, outOfDate, unsettled);
    const answeredBase = unsettled.size === 0
      ? confirmedAnswer
      : keepingConfirmedNotes(confirmedAnswer, sentBase.filter((object) => unsettled.has(object.id)), true);
    // Nor, after any save that lands, a note the server kept that this save
    // did not send: the piece shows it if the person has not touched its note
    // since the save went, and holds it otherwise (delta review of #388 at
    // 7a51b6e4, X1). No save from this browser ever names, as the note a
    // piece's note replaces, words this browser has not shown on that piece.
    const theirNotes = new Map(latest.objects.map((object) => [idMap.get(object.id) ?? object.id, object.notes]));
    const leftToTheServer = new Set([...outOfDate.keys(), ...unsettled.keys()]);
    const { objects: shownAfter, confirmed: base } = takingNotesKeptUnsent(
      objectsAfter, answeredBase, notesSentIn(batch, leftToTheServer), theirNotes,
    );
    // The API's sentence is for words over a held note; a refused clear has its
    // own (ruling C3 on #388), and both stand in one notice when both are refused.
    const refusal = { objects: shownAfter, baseObjects: base, noteClearsRefused: noteRefused ? clearsRefused : get().noteClearsRefused };
    set({
      objects: shownAfter,
      baseObjects: base,
      history: aligned ? remapHistoryIds(latest.history, idMap) : emptyHistory<EditorObject>(),
      selectedObjectId: latest.selectedObjectId === null
        ? null
        : idMap.get(latest.selectedObjectId) ?? latest.selectedObjectId,
      configRevision: saved.revision,
      isDirty: editedInFlight || wordsRefused || unsettled.size > 0,
      // Saves stopped by a failure are answered by it, below.
      isSaving: stoppedBy !== null,
      lastSavedAt: new Date(),
      saveConflict: null,
      ...(noteRefused
        ? {
            saveError: saidTogether(wordsRefused ? refusedWords : null, refusedClearsLine(refusal)),
            saveErrorCode: NOTE_HELD_CODE,
            noteClearsRefused: clearsRefused,
          }
        // Nothing refused this time: a refused clear's notice still stands.
        : standingRefusal(refusal)),
      reviewLockRefused: false,
      // Its work arrived after all: nothing of it is waiting here.
      ...workArrived(latest.leftBehind, configId),
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
    // What landed is kept; the failure that stopped the saves is said as any is.
    if (stoppedBy !== null) throw stoppedBy.failure;
    // Saved, but not a change the person made to a note someone else had rewritten.
    return !noteRefused;
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
        // QoL D-X2, at save time: the newer revision can be this very document,
        // from a save that landed unheard (sent as the page hid, or before a
        // switch, then answered to a page or session that had moved on). That
        // is this save done, not someone else's change.
        if (theirs !== null && get().objects === objects && adoptAsSaved(theirs, objects, session)) return true;
        if (rebase && theirs !== null) {
          // Live co-editing: keep this person's edits on the objects they
          // touched, take everything else from the newer copy.
          const outcome = get().adoptServerConfiguration(theirs, { whileSaving: true, requestSave: false });
          const held = get().configRevision;
          const current = outcome.status === "adopted" || outcome.status === "rebased"
            || (outcome.status === "stale" && held !== null && held >= theirs.revision);
          if (current) {
            set({ isSaving: false });
            return get().isDirty ? await get().saveToServer(isAuthenticated, transport) : true;
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
      set({ isSaving: false, ...standingRefusal(get()) });
      return false;
    }
    const message = err instanceof Error ? err.message : "Save failed";
    // Log the failing payload so we can see which field the server rejects.
    // Safe to log — no PII in the placed-object batch.
    // The status only: the server's message may quote the layout's own words.
    reportFailure("save-failed", { status: err instanceof ApiError && err.status > 0 ? err.status : "network" });
    // eslint-disable-next-line no-console
    console.error("[editor-store] save failed:", message, { objects });
    // Set saveError (NOT error) — leaving `error: null` keeps EditorPage's
    // main render path alive, so the Canvas stays mounted and the user
    // doesn't lose their in-progress layout.
    set({
      isSaving: false,
      // A refusal for a held note says, beside it, a refused clear still standing.
      saveError: refusedOverHeldNote(code) ? saidTogether(message, refusedClearsLine(get())) : message,
      saveErrorCode: code,
      ...(code === "CONFIG_LOCKED" ? { reviewLockRefused: true } : {}),
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Leaving a layout (QoL D-01, D-X3). Restored work is one undo step; another
// layout opening in this page gives the open one's unsaved work up to 2 s to
// reach the server first, and what does not arrive stays on this device.
// ---------------------------------------------------------------------------

/**
 * Take the server's copy as this document saved, when it holds exactly what
 * this save sent: placed pieces take the ids the server gave them, so undo
 * and the live room keep addressing them. False, changing nothing, otherwise.
 */
function adoptAsSaved(theirs: configApi.Configuration, sent: readonly EditorObject[], session: number): boolean {
  const serverObjects = (theirs.objects ?? []).map(placedObjectToEditor);
  const idMap = matchSavedLayout(sent, serverObjects, (id) => EDITOR_HISTORY_IDS.isLocalId(id));
  if (idMap === null || session !== configurationSession) return false;
  const latest = useEditorStore.getState();
  const selection = useSelectionStore.getState();
  if ([...selection.selectedIds].some((id) => idMap.has(id))) {
    selection.selectMultiple([...selection.selectedIds].map((id) => idMap.get(id) ?? id));
  }
  useEditorStore.setState({
    objects: serverObjects,
    baseObjects: serverObjects,
    history: remapHistoryIds(latest.history, idMap),
    selectedObjectId: latest.selectedObjectId === null ? null : idMap.get(latest.selectedObjectId) ?? latest.selectedObjectId,
    configRevision: theirs.revision,
    configName: theirs.name,
    isDirty: false,
    isSaving: false,
    lastSavedAt: theirs.updatedAt === undefined ? new Date() : new Date(theirs.updatedAt),
    ...standingRefusal(latest),
    saveConflict: null,
    reviewLockRefused: false,
    ...workArrived(latest.leftBehind, theirs.id),
  });
  conflictServerCopy = null;
  liveHooks?.onSaved(theirs.revision, idMap);
  return true;
}

/** The undo label of work restored from this device. */
const RESTORE_LABEL = "Restore changes kept on this device";

/** Work kept on this device, restored as one undoable step from `base`. */
function restoreStep(base: readonly EditorObject[], kept: readonly EditorObject[]): EditorHistory<EditorObject> {
  interactionEpoch += 1;
  return recordChange(emptyHistory<EditorObject>(), {
    before: base,
    after: kept,
    label: RESTORE_LABEL,
    epoch: interactionEpoch,
    selectionBefore: [],
    selectionAfter: [],
  });
}

/** How long another layout waits for the open one's unsaved work. */
export const LAYOUT_CHANGE_SAVE_MS = 2_000;

/**
 * Where the open layout's work stands as another one opens: on the server;
 * on the server but for a clear of a note the API refused, whose notice still
 * stands ("clear-refused": never "saved" then, ruling R1(b) on #388; the note
 * the next layout shows says it, delta review at 33a8e0ad S1); kept on this
 * device (the note says so); or neither.
 */
export type LayoutChangeOutcome = "saved" | "clear-refused" | "kept" | "not-kept";

/** Whether work the outgoing layout could neither save nor keep is lost with a switch that goes on regardless (a load). */
function lostWithTheSwitch(outcome: LayoutChangeOutcome): boolean {
  switch (outcome) {
    case "not-kept":
      return true;
    case "saved":
    case "clear-refused":
    case "kept":
      return false;
    default: {
      const exhausted: never = outcome;
      throw new Error(`Unhandled layout change outcome ${String(exhausted)}`);
    }
  }
}

/** The last try for one document, so the slate's wait and the load after it
 *  do not try twice for work nobody has changed since. */
let layoutChangeAttempt: {
  readonly session: number;
  readonly objects: readonly EditorObject[];
  readonly outcome: Promise<LayoutChangeOutcome>;
} | null = null;

/** The note the next layout shows about this one: its unsaved work (`kept`; null for none) and a refused clear still standing. */
function leftBehindFor(state: EditorState, kept: boolean | null): LeftBehindWork | null {
  if (state.configId === null) return null;
  const roomName = state.space?.name ?? null;
  // Shown in the next layout, the sentence says which layout it is about, by
  // the room's name as the note's own sentence names it (delta review X3).
  const notRemoved = refusedClearsLine(state, layoutNamed(roomName));
  return {
    configId: state.configId,
    roomName,
    kept,
    savesOnReturn: kept === true && state.lockReason === null && state.saveConflict === null,
    ...(notRemoved === null ? {} : { notRemoved }),
  };
}

/**
 * A save of the layout a note was left about has landed: none of its work is
 * waiting here after all. A refused clear's sentence in the note still stands
 * until the person dismisses it.
 */
function workArrived(note: LeftBehindWork | null, configId: string): Partial<Pick<EditorState, "leftBehind">> {
  if (note?.configId !== configId) return {};
  return { leftBehind: note.notRemoved === undefined ? null : { ...note, kept: null, savesOnReturn: false } };
}

/** Nothing is left unsaved: "saved", unless a refused clear's notice stands, whose sentence then goes in the next layout's note. */
function settledWithNothingUnsaved(state: EditorState): LayoutChangeOutcome {
  const note = leftBehindFor(state, null);
  if (note?.notRemoved === undefined) return "saved";
  useEditorStore.setState({ leftBehind: note });
  return "clear-refused";
}

/** Resolve once no save is in flight for this session (or it has ended). */
function saveSettled(session: number): Promise<void> {
  if (!useEditorStore.getState().isSaving) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const unsubscribe = useEditorStore.subscribe((state) => {
      if (!state.isSaving || session !== configurationSession) {
        unsubscribe();
        resolve();
      }
    });
  });
}

/** A save in flight finishes; then what is still unsaved goes, when it can. */
async function sendOutgoingWork(session: number): Promise<void> {
  await saveSettled(session);
  if (session !== configurationSession) return;
  const state = useEditorStore.getState();
  // Offline, in review or waiting on the person's choice, a save could only fail.
  if (!state.isDirty || !state.isOnline || state.saveConflict !== null || state.lockReason !== null) return;
  const sent = await saveDocument(useAuthStore.getState().isAuthenticated, false);
  // Another flush (the planner's route unmounting) can start the same save a
  // moment before this one: that save carries the work, so wait for it.
  if (!sent && session === configurationSession && useEditorStore.getState().isSaving) await saveSettled(session);
}

async function settleOutgoingWork(session: number, timeoutMs: number, keptAtStart: boolean): Promise<LayoutChangeOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); });
  try {
    await Promise.race([sendOutgoingWork(session).catch(() => undefined), timeout]);
  } finally {
    clearTimeout(timer);
  }
  // Another load replaced the document meanwhile: its copy here is as it was.
  if (session !== configurationSession) return keptAtStart ? "kept" : "not-kept";
  const state = useEditorStore.getState();
  if (!state.isDirty) return settledWithNothingUnsaved(state);
  if (!state.keptOnDevice) return "not-kept";
  useEditorStore.setState({ leftBehind: leftBehindFor(state, true) });
  return "kept";
}

/**
 * Before another layout replaces the open one in this page: its unsaved work
 * gets up to `timeoutMs` to reach the server (a save in flight first). Resolves
 * "saved" when nothing is left unsaved; "clear-refused" when nothing is but a
 * refused clear's notice stands, noting its sentence for the next layout to
 * say (the switch goes on); "kept" when the work stays on this device, noting
 * it (and any such sentence) for the next layout to say; "not-kept" when it is
 * neither, so the caller decides (the slate holds the switch; a load goes on
 * and says the work is lost). Never rejects.
 */
export function saveBeforeLayoutChange(timeoutMs: number = LAYOUT_CHANGE_SAVE_MS): Promise<LayoutChangeOutcome> {
  const state = useEditorStore.getState();
  if (state.configId === null) return Promise.resolve("saved");
  if (!state.isDirty) return Promise.resolve(settledWithNothingUnsaved(state));
  const session = configurationSession;
  if (layoutChangeAttempt?.session === session && layoutChangeAttempt.objects === state.objects) {
    return layoutChangeAttempt.outcome;
  }
  const outcome = settleOutgoingWork(session, timeoutMs, state.keptOnDevice);
  layoutChangeAttempt = { session, objects: state.objects, outcome };
  return outcome;
}

/**
 * Close the open layout at a boundary in this page (the slate's room switch),
 * as a load of another layout would: the open gesture is sealed into the
 * action log and the log's unsent tail is sent against the last saved
 * revision, then the editor resets. Its unsaved work should already have had
 * its chance (saveBeforeLayoutChange); the device copy keeps what did not go.
 */
export function closeLayout(): void {
  const state = useEditorStore.getState();
  actionEmitter.flush(state.history);
  if (state.configRevision !== null && !state.isPublicPreview) flushActionLogToServer(state.configRevision);
  state.reset();
}

/** The page is going: write its unsaved work to this device now, a pointer
 *  gesture's frames included (they are otherwise written at its end). */
export function keepUnsavedWorkOnDevice(): void {
  const state = useEditorStore.getState();
  if (!state.isDirty || state.configId === null || signedOutHere()) return;
  useEditorStore.setState({ keptOnDevice: keepWorkOnDevice(state) });
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
    ...(explainedByOffline ? standingRefusal(state) : {}),
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

// The scene's stores and commands ask which pieces hold a note this browser is
// not shown without loading this store (lib/guest-plan-notes).
registerHeldNotes(() => heldNoteIds(useEditorStore.getState()), () => carriedNoteIds(useEditorStore.getState()));

// This page holds its lock for its lifetime, so another tab can tell its
// in-progress drafts from those a closed page left behind.
holdPlannerPageLock();
