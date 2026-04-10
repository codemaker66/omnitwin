import { create } from "zustand";
import type { Space } from "../api/spaces.js";
import type { PlacedObject, BatchObjectInput } from "../api/configurations.js";
import * as configApi from "../api/configurations.js";
import * as spacesApi from "../api/spaces.js";

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
  return {
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
  };
}

/**
 * Convert a local `EditorObject` to a `BatchObjectInput` for the wire.
 *
 * Scene-only state (clothed, groupId) is packed into the `metadata` blob
 * so it round-trips through the database without needing dedicated columns.
 */
export function editorToBatch(o: EditorObject): BatchObjectInput {
  return {
    id: o.id.startsWith("local-") ? undefined : o.id,
    assetDefinitionId: o.assetDefinitionId,
    positionX: o.positionX,
    positionY: o.positionY,
    positionZ: o.positionZ,
    rotationX: o.rotationX,
    rotationY: o.rotationY,
    rotationZ: o.rotationZ,
    scale: o.scale,
    sortOrder: o.sortOrder,
    metadata: { clothed: o.clothed, groupId: o.groupId },
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
  readonly removeObject: (objectId: string) => void;
  readonly selectObject: (id: string) => void;
  readonly deselectObject: () => void;
  /** Save to server. Uses public endpoint for preview configs, authenticated for claimed. */
  readonly saveToServer: (isAuthenticated?: boolean) => Promise<void>;
  readonly reset: () => void;
}

type EditorStore = EditorState & EditorActions;

let localIdCounter = 0;

// Auto-save is owned by EditorBridge — no internal debounce needed here.

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
};

export const useEditorStore = create<EditorStore>((set, get) => ({
  ...INITIAL_STATE,

  loadConfiguration: async (configId, isAuthenticated) => {
    set({ isLoading: true, error: null });
    try {
      const config = isAuthenticated === true
        ? await configApi.getConfig(configId)
        : await configApi.getPublicConfig(configId);
      const objects = (config.objects ?? []).map(placedObjectToEditor);
      set({
        configId: config.id,
        spaceId: config.spaceId,
        venueId: config.venueId,
        isPublicPreview: config.isPublicPreview,
        objects,
        isDirty: false,
        isLoading: false,
      });
      // Load space data (name, dimensions) for room geometry rendering
      if (config.venueId !== undefined && config.spaceId !== undefined) {
        void get().loadSpace(config.venueId, config.spaceId);
      }
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

      // Load space data for room geometry rendering
      if (config.venueId !== undefined && config.spaceId !== undefined) {
        void get().loadSpace(config.venueId, config.spaceId);
      }

      // Track in localStorage
      const stored = JSON.parse(localStorage.getItem("omnitwin_my_configs") ?? "[]") as { configId: string; createdAt: string }[];
      stored.push({ configId: config.id, createdAt: new Date().toISOString() });
      localStorage.setItem("omnitwin_my_configs", JSON.stringify(stored));

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
      clothed: false, groupId: null,
    };
    set((s) => ({ objects: [...s.objects, obj], isDirty: true }));

  },

  updateObject: (objectId, transform) => {
    set((s) => ({
      objects: s.objects.map((o) => o.id === objectId ? { ...o, ...transform } : o),
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
    if (configId === null || isSaving) return;

    // Determine save path: use authenticated endpoint if config is claimed
    // (isPublicPreview=false) OR if caller explicitly says authenticated.
    // Public preview configs always use the public endpoint.
    const useAuthPath = isPublicPreview === false || isAuthenticated === true;

    set({ isSaving: true });
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
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      set({ isSaving: false, error: message });
    }
  },

  reset: () => {
    set(INITIAL_STATE);
  },
}));
