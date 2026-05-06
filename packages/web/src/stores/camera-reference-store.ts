import { create } from "zustand";
import type { CameraReferenceSource } from "../lib/camera-animation.js";

export interface CameraReferenceDraft {
  readonly screenX: number;
  readonly screenY: number;
  readonly source: CameraReferenceSource;
  readonly sourceLabel: string;
  readonly placedItemId?: string | null;
  readonly furnitureCategory?: "chair" | "table" | "other";
  readonly point: readonly [number, number];
  readonly baseY: number;
  readonly yaw: number | null;
  readonly suggestedName: string;
}

export interface CameraReferenceState {
  readonly draft: CameraReferenceDraft | null;
  readonly openDraft: (draft: CameraReferenceDraft) => void;
  readonly closeDraft: () => void;
}

export const useCameraReferenceStore = create<CameraReferenceState>()((set) => ({
  draft: null,
  openDraft: (draft) => {
    set({ draft });
  },
  closeDraft: () => {
    set({ draft: null });
  },
}));
