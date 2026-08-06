import type { LayoutSnapshotVenueRuntimeReference } from "@omnitwin/types";
import type { LayoutTimelinePreviewSessionMode } from "../stores/layout-timeline-preview-store.js";

export const SYNTHETIC_GRAND_HALL_STAND_IN_LABEL =
  "Synthetic Grand Hall stand-in · not a measured capture";

export interface SyntheticGrandHallStandInInput {
  readonly mode: LayoutTimelinePreviewSessionMode;
  readonly venueRuntime: LayoutSnapshotVenueRuntimeReference | null;
  readonly hasExactHistoricalRuntime: boolean;
}

export function isGrandHallVenueRuntime(
  venueRuntime: LayoutSnapshotVenueRuntimeReference | null,
): boolean {
  if (venueRuntime === null) return false;
  return venueRuntime.spaceSlug === "grand-hall"
    || venueRuntime.spaceName.trim().toLocaleLowerCase("en-GB") === "grand hall";
}

/**
 * A synthetic dressing may decorate only a trustworthy frozen Grand Hall
 * envelope that has no exact historical capture. It never creates a room for
 * pending, unavailable, or schedule-gap states and never supersedes a bound
 * historical runtime.
 */
export function shouldUseSyntheticGrandHallStandIn({
  mode,
  venueRuntime,
  hasExactHistoricalRuntime,
}: SyntheticGrandHallStandInInput): boolean {
  if (mode !== "keyframe" && mode !== "transition") return false;
  return !hasExactHistoricalRuntime && isGrandHallVenueRuntime(venueRuntime);
}
