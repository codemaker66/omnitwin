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
  const editorObject: EditorObject = {
    id: p.id,
    assetDefinitionId: p.assetDefinitionId,
    positionX: parseFloat(p.positionX),
    positionY: parseFloat(p.positionY),
    positionZ: parseFloat(p.positionZ),
    rotationX: parseFloat(p.rotationX),
    rotationY: parseFloat(p.rotationY),
    rotationZ: parseFloat(p.rotationZ),
    scale: parseFloat(p.scale),
    sortOrder: p.sortOrder,
    clothed: meta.clothed === true,
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
    positionX: o.positionX,
    positionY: o.positionY,
    positionZ: o.positionZ,
    rotationX: o.rotationX,
    rotationY: o.rotationY,
    rotationZ: o.rotationZ,
    scale: o.scale,
    sortOrder: o.sortOrder,
    metadata: {
      clothed: o.clothed,
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
  // Punch list #24: the live Three.js scene ref, set by SceneProvider
  // inside the Canvas. Needed by the ortho-capture utility which runs
  // outside the Canvas (in SaveSendPanel) to generate the floor plan
  // diagram for the hallkeeper sheet PDF.
  readonly scene: Scene | null;
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
  /** Dismiss the current save-error toast. */
  readonly clearSaveError: () => void;
  readonly reset: () => void;
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
// Store
// ---------------------------------------------------------------------------

const INITIAL_STATE: EditorState = {
  configId: null,
  spaceId: null,
  venueId: null,
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
  scene: null,
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
        })
        : null;
      const objects = localDraft?.objects ?? serverObjects;
      const restoredAnonymousDraft = localDraft !== null;
      set({
        configId: config.id,
        spaceId: config.spaceId,
        venueId: config.venueId,
        isPublicPreview: config.isPublicPreview,
        objects,
        isDirty: restoredAnonymousDraft,
        isLoading: false,
      });
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
        isPublicPreview: true,
        objects: [],
        isDirty: false,
        isLoading: false,
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
    const obj: EditorObject = {
      id: `local-${String(++localIdCounter)}`,
      assetDefinitionId: assetId,
      positionX, positionY, positionZ,
      rotationX: 0, rotationY: 0, rotationZ: 0,
      scale: 1, sortOrder: get().objects.length,
      clothed: false, groupId: null, notes: "",
    };
    set((s) => ({ objects: [...s.objects, obj], isDirty: true }));

  },

  updateObject: (objectId, transform) => {
    set((s) => ({
      objects: s.objects.map((o) => o.id === objectId ? { ...o, ...transform } : o),
      isDirty: true,
    }));

  },

  moveObjectsByDelta: (ids, dx, dz) => {
    if (ids.size === 0) return;
    if (dx === 0 && dz === 0) return;
    set((s) => ({
      objects: s.objects.map((o) =>
        ids.has(o.id)
          ? { ...o, positionX: o.positionX + dx, positionZ: o.positionZ + dz }
          : o,
      ),
      isDirty: true,
    }));
  },

  setObjectNotes: (objectId, notes) => {
    set((s) => ({
      objects: s.objects.map((o) => o.id === objectId ? { ...o, notes } : o),
      isDirty: true,
    }));
  },

  removeObject: (objectId) => {
    set((s) => ({
      objects: s.objects.filter((o) => o.id !== objectId),
      isDirty: true,
      selectedObjectId: s.selectedObjectId === objectId ? null : s.selectedObjectId,
    }));

  },

  selectObject: (id) => { set({ selectedObjectId: id }); },
  deselectObject: () => { set({ selectedObjectId: null }); },

  saveToServer: async (isAuthenticated) => {
    const { configId, objects, isSaving, isPublicPreview } = get();
    if (configId === null || isSaving) return false;

    // Determine save path: use authenticated endpoint if config is claimed
    // (isPublicPreview=false) OR if caller explicitly says authenticated.
    // Public preview configs always use the public endpoint.
    const useAuthPath = !isPublicPreview || isAuthenticated === true;

    set({ isSaving: true, saveError: null });
    try {
      const batch = objects.map(editorToBatch);
      let saved: configApi.PlacedObject[];
      if (useAuthPath) {
        saved = await configApi.authBatchSave(configId, batch);
      } else {
        saved = await configApi.publicBatchSave(configId, batch);
      }
      // Update local IDs with server IDs
      const serverObjects = saved.map(placedObjectToEditor);
      set({ objects: serverObjects, isDirty: false, isSaving: false, lastSavedAt: new Date() });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      // Log the failing payload so we can see which field the server rejects.
      // Safe to log — no PII in the placed-object batch.
      // eslint-disable-next-line no-console
      console.error("[editor-store] save failed:", message, { objects });
      // Set saveError (NOT error) — leaving `error: null` keeps EditorPage's
      // main render path alive, so the Canvas stays mounted and the user
      // doesn't lose their in-progress layout.
      set({ isSaving: false, saveError: message });
      return false;
    }
  },

  clearSaveError: () => { set({ saveError: null }); },

  reset: () => {
    // Preserve the scene ref — reset clears editor data but the Three.js
    // scene is still alive in the Canvas. SceneProvider manages the ref.
    set({ ...INITIAL_STATE, scene: get().scene });
  },
}));

useEditorStore.subscribe((state, previous) => {
  if (
    state.configId === previous.configId
    && state.spaceId === previous.spaceId
    && state.venueId === previous.venueId
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
    isPublicPreview: state.isPublicPreview,
    objects: state.objects,
    isDirty: state.isDirty,
  });
});
