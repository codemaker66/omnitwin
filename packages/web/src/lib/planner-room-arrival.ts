import { useEditorStore } from "../stores/editor-store.js";
import { useCockpitStore } from "../stores/cockpit-store.js";
import { useBookmarkStore } from "../stores/bookmark-store.js";
import type { RoomWalkPose } from "../data/room-splat-bundles.js";
import { isCameraKeyboardPanSuspendedByPlannerState } from "./camera-rig.js";
import { useCatalogueStore } from "../stores/catalogue-store.js";
import { useSelectionStore } from "../stores/selection-store.js";
import { useCameraReferenceStore } from "../stores/camera-reference-store.js";
import { useMarkupStore } from "../stores/markup-store.js";
import { useMeasurementStore } from "../stores/measurement-store.js";
import { useGuidelineStore } from "../stores/guideline-store.js";
import { isLayoutTimelineMutationLocked } from "./layout-timeline-preview-lock.js";

/** Served Three coordinates, within the Grand Hall capture's walk bounds.
 * The framing is a presentation choice, not a surveyed camera observation. */
export const GRAND_HALL_ARRIVAL = {
  position: [0.4, 1.6, 7.5] as const,
  yaw: 0.0286,
  pitch: 0.0784,
};

export function plannerArrivalKey(configId: string | null, spaceId: string | null): string | null {
  return spaceId === null ? null : JSON.stringify([configId, spaceId]);
}

/** Session-only decisions survive switching the Canvas out for the 2D plan. */
export function createPlannerArrivalPolicy() {
  const decided = new Set<string>();
  return {
    choose(key: string | null): void { if (key !== null) decided.add(key); },
    claim(key: string | null, eligible: boolean): boolean {
      if (key === null || !eligible || decided.has(key)) return false;
      decided.add(key);
      return true;
    },
  };
}

export const plannerArrivalPolicy = createPlannerArrivalPolicy();

/** Call before explicit view controls, even when selecting their current value. */
export function recordPlannerArrivalChoice(): void {
  const { configId, space } = useEditorStore.getState();
  plannerArrivalPolicy.choose(plannerArrivalKey(configId, space?.id ?? null));
}

export function hasPlannerBookmarkCamera(): boolean {
  const state = useBookmarkStore.getState();
  return state.pendingNavigationId !== null || state.transition !== null
    || state.tour !== null || state.activeReferenceId !== null;
}

export function plannerInteriorOwnsCamera(): boolean {
  return !isLayoutTimelineMutationLocked() && useCockpitStore.getState().walkMode && !hasPlannerBookmarkCamera();
}

export function plannerOrbitOwnsCamera(): boolean {
  return !isLayoutTimelineMutationLocked() && !useCockpitStore.getState().walkMode && !hasPlannerBookmarkCamera();
}

/** Explicit planning actions hand back to orbit before calculating their goal. */
export function beginPlannerOrbitAction(): boolean {
  if (isLayoutTimelineMutationLocked() || hasPlannerBookmarkCamera()) return false;
  recordPlannerArrivalChoice();
  if (useCockpitStore.getState().walkMode) useCockpitStore.getState().setWalkMode(false);
  return true;
}

export function plannerKeyboardNavigationEnabled(): boolean {
  const catalogue = useCatalogueStore.getState();
  const selection = useSelectionStore.getState();
  return !isCameraKeyboardPanSuspendedByPlannerState({
    catalogueDrawerOpen: catalogue.drawerOpen,
    catalogueSelectionActive: catalogue.selectedItemId !== null,
    catalogueDragActive: catalogue.dragActive,
    cameraReferenceDraftOpen: useCameraReferenceStore.getState().draft !== null,
    guidelineActive: useGuidelineStore.getState().active,
    markupActive: useMarkupStore.getState().active,
    measurementActive: useMeasurementStore.getState().active,
    selectedItemCount: selection.selectedIds.size,
    marqueeActive: selection.marqueeActive,
  });
}

export function plannerInteriorSpawn(roomSlug: string | null, pose: RoomWalkPose): {
  position: [number, number, number]; yaw: number; pitch: number;
} {
  return roomSlug === "grand-hall"
    ? { position: [...GRAND_HALL_ARRIVAL.position], yaw: GRAND_HALL_ARRIVAL.yaw, pitch: GRAND_HALL_ARRIVAL.pitch }
    : { position: [...pose.spawn.position], yaw: pose.spawn.yaw, pitch: 0 };
}
