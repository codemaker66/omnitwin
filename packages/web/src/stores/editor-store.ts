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
}

function placedToEditor(p: PlacedObject): EditorObject {
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
  };
}

function editorToBatch(o: EditorObject): BatchObjectInput {
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
  readonly loadConfiguration: (configId: string) => Promise<void>;
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

  loadConfiguration: async (configId) => {
    set({ isLoading: true, error: null });
    try {
      const config = await configApi.getPublicConfig(configId);
      const objects = (config.objects ?? []).map(placedToEditor);
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
      const serverObjects = saved.map(placedToEditor);
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
