import type { Object3D, Scene } from "three";

export const SAVED_LAYOUT_FURNITURE_GROUP = "saved-layout-furniture";
export const TIMELINE_PREVIEW_FURNITURE_GROUP = "layout-timeline-preview-furniture";
export const TIMELINE_CAPTURE_FURNITURE_GROUP = "layout-timeline-capture-furniture";

export type TimelineCaptureFurnitureSource = "nearest-keyframe" | "saved-layout";

export interface TimelineCaptureFurnitureVisibility {
  readonly source: TimelineCaptureFurnitureSource;
  readonly savedLayoutVisible: boolean;
  readonly interpolatedPreviewVisible: false;
  readonly nearestKeyframeVisible: boolean;
  /** Editable-store labels must not be overlaid on a different phase keyframe. */
  readonly diagramLabelsVisible: boolean;
}

/**
 * Export policy for a timeline scrub. Interpolated geometry is never evidence:
 * capture the nearest immutable keyframe when it is mounted, otherwise fall
 * back honestly to the editor's saved layout.
 */
export function captureFurnitureVisibilityForTimeline({
  timelinePreviewActive,
  nearestKeyframeAvailable,
}: {
  readonly timelinePreviewActive: boolean;
  readonly nearestKeyframeAvailable: boolean;
}): TimelineCaptureFurnitureVisibility {
  const captureNearestKeyframe = timelinePreviewActive && nearestKeyframeAvailable;
  return {
    source: captureNearestKeyframe ? "nearest-keyframe" : "saved-layout",
    savedLayoutVisible: !captureNearestKeyframe,
    interpolatedPreviewVisible: false,
    nearestKeyframeVisible: captureNearestKeyframe,
    diagramLabelsVisible: !captureNearestKeyframe,
  };
}

interface ObjectVisibilitySnapshot {
  readonly object: Object3D;
  readonly visible: boolean;
}

/**
 * Applies the timeline furniture capture policy to a live Three scene and
 * returns an idempotent restoration callback.
 */
export function prepareFurnitureForOrthographicCapture(scene: Scene): {
  readonly source: TimelineCaptureFurnitureSource;
  readonly diagramLabelsVisible: boolean;
  readonly restore: () => void;
} {
  const savedLayout = scene.getObjectByName(SAVED_LAYOUT_FURNITURE_GROUP);
  const interpolatedPreview = scene.getObjectByName(TIMELINE_PREVIEW_FURNITURE_GROUP);
  const nearestKeyframe = scene.getObjectByName(TIMELINE_CAPTURE_FURNITURE_GROUP);
  const policy = captureFurnitureVisibilityForTimeline({
    timelinePreviewActive: interpolatedPreview !== undefined,
    nearestKeyframeAvailable: nearestKeyframe !== undefined,
  });
  const snapshots: ObjectVisibilitySnapshot[] = [];

  const applyVisibility = (object: Object3D | undefined, visible: boolean): void => {
    if (object === undefined) return;
    snapshots.push({ object, visible: object.visible });
    object.visible = visible;
  };

  applyVisibility(savedLayout, policy.savedLayoutVisible);
  applyVisibility(interpolatedPreview, policy.interpolatedPreviewVisible);
  applyVisibility(nearestKeyframe, policy.nearestKeyframeVisible);

  let restored = false;
  return {
    source: policy.source,
    diagramLabelsVisible: policy.diagramLabelsVisible,
    restore: () => {
      if (restored) return;
      restored = true;
      for (const snapshot of snapshots) snapshot.object.visible = snapshot.visible;
    },
  };
}

