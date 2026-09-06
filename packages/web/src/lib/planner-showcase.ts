import type { SpaceDimensions } from "@omnitwin/types";
import { roomSplatBundle, walkPoseForBundle } from "../data/room-splat-bundles.js";
import { useBookmarkStore } from "../stores/bookmark-store.js";
import { useCockpitStore } from "../stores/cockpit-store.js";
import { useEditorStore } from "../stores/editor-store.js";
import { buildShowcaseTour, buildTourFromPoses, type CameraPose, type CameraTour } from "./camera-tour.js";
import type { CockpitLayerMode } from "./cockpit-modes.js";
import { GRAND_HALL_ARRIVAL } from "./planner-room-arrival.js";
import type { PlannerSceneSourceEvidence } from "./truth-mode-summary.js";

interface PlannerShowcaseInput {
  readonly dimensions: SpaceDimensions;
  readonly configId: string | null;
  readonly spaceId: string | null;
  readonly roomSlug: string | null;
  readonly layerMode: CockpitLayerMode;
  readonly sceneSource: PlannerSceneSourceEvidence | null;
}

/** Presentation poses in the existing staged GH2 served frame, not surveyed
 * viewpoints or proof of registration. Keep the glide near the qualified axial
 * arrival; a capture's bounding box alone is not a collision-free tour map. */
export function buildPlannerShowcaseTour(input: PlannerShowcaseInput): CameraTour | null {
  if (input.layerMode === "mesh" || input.roomSlug === null) return buildShowcaseTour(input.dimensions);
  const source = input.sceneSource;
  if (source === null || source.configId !== input.configId || source.spaceId !== input.spaceId
    || source.layerMode !== input.layerMode) return null;
  if (source.captureSource === "none") return buildShowcaseTour(input.dimensions);
  // A registered package may have another frame. Other captures need their own
  // authored/checked path before borrowing these Grand Hall presentation poses.
  if (source.captureSource !== "staged" || input.roomSlug !== "grand-hall" || input.spaceId === null) return null;
  const bundle = roomSplatBundle("grand-hall");
  const walk = bundle === null ? null : walkPoseForBundle(bundle);
  if (walk === null) return null;
  const { position, yaw, pitch } = GRAND_HALL_ARRIVAL;
  const poseAt = (z: number): CameraPose => ({
    position: [position[0], position[1], z],
    target: [position[0] - Math.sin(yaw) * Math.cos(pitch) * 8,
      position[1] + Math.sin(pitch) * 8, z - Math.cos(yaw) * Math.cos(pitch) * 8],
  });
  const poses = [poseAt(position[2]), poseAt(position[2] - 2.5), poseAt(position[2] - 5), poseAt(position[2])];
  // Fail closed if a future descriptor invalidates the authored path. Linear
  // interpolation is contained by this convex envelope; furniture is not surveyed.
  if (poses.some((pose) => ([0, 1, 2] as const).some((axis) => (
    pose.position[axis] < walk.bounds.min[axis] || pose.position[axis] > walk.bounds.max[axis]
  )))) return null;
  return { ...buildTourFromPoses(poses, 4),
    interiorOwner: { configId: input.configId, spaceId: input.spaceId, roomSlug: "grand-hall" } };
}

/** Tile progress can change without changing the source/room that owns a path. */
export function plannerShowcaseStillCurrent(tour: CameraTour): boolean {
  const owner = tour.interiorOwner;
  if (owner === undefined) return true;
  const editor = useEditorStore.getState();
  const cockpit = useCockpitStore.getState();
  const source = cockpit.sceneSource;
  return editor.configId === owner.configId && editor.space?.id === owner.spaceId
    && editor.space.slug === owner.roomSlug && cockpit.layerMode !== "mesh"
    && source?.configId === owner.configId && source.spaceId === owner.spaceId
    && source.layerMode === cockpit.layerMode && source.captureSource === "staged";
}

/** Completion/Escape deliberately resumes the same interior's authored arrival.
 * A superseding tour, room, layer or unavailable capture must not be overwritten. */
export function finishPlannerShowcaseTour(tour: CameraTour): void {
  const bookmarks = useBookmarkStore.getState();
  if (bookmarks.tour !== tour) return;
  const resumeInterior = tour.interiorOwner !== undefined && plannerShowcaseStillCurrent(tour);
  bookmarks.clearTour();
  if (resumeInterior) useCockpitStore.getState().setWalkMode(true);
}
