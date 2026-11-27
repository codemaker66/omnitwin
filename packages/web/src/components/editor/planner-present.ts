// ---------------------------------------------------------------------------
// Present: what the planner's Present plays now
//
// Blake, 26 October 2026: "There is a present button which plays it also if
// we want to see it again." Over the drawn Grand Hall with furniture on the
// floor, Present replays the Grand Assembly (floor/assembly). Elsewhere it
// plays the room's showcase tour where one exists (lib/planner-showcase.ts),
// so a device-day cut drawn in Capture, with the Assembly off its stage, takes
// the tour. Otherwise it says why it can't. Under reduced motion it plays
// neither: the Assembly never plays then ("the layout is simply there"), and a
// camera flown through the room is the motion such a device asks to keep still.
//
// The desktop's command deck (PlannerCommandDeck) and a phone's View sheet
// (cockpit/HallPresent) both ask here.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import type { CameraTour } from "../../lib/camera-tour.js";
import { buildPlannerShowcaseTour } from "../../lib/planner-showcase.js";
import { prefersReducedMotion } from "../../lib/reduced-motion.js";
import { useReducedMotion } from "../../pages/landing/useReducedMotion.js";
import { hurryAssembly, requestAssemblyReplay, useAssemblyRecallStore } from "../../floor/assembly/recall.js";
import { useBookmarkStore } from "../../stores/bookmark-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";

export type PlannerPresent =
  /** The Grand Assembly replays the furniture on the floor. */
  | { readonly kind: "assembly" }
  /** The Assembly is playing now; `fast`, the Skip has hurried it. */
  | { readonly kind: "playing"; readonly fast: boolean }
  /** The room's showcase tour. */
  | { readonly kind: "tour"; readonly tour: CameraTour }
  /** Nothing to play now, and why. */
  | { readonly kind: "unavailable"; readonly reason: string };

export interface PlannerPresentFacts {
  /** The device asks for reduced motion. */
  readonly reducedMotion: boolean;
  /** The Assembly is on its stage, mounted over the drawn hall (recall.ts). */
  readonly assemblyOnStage: boolean;
  /** The Assembly is holding the room or playing. */
  readonly assemblyActive: boolean;
  /** The Skip has hurried it. */
  readonly assemblyFast: boolean;
  /** There is furniture on the floor. */
  readonly furnished: boolean;
  /** The room's showcase tour, where this view has one. */
  readonly tour: CameraTour | null;
}

export const PRESENT_KEPT_STILL = "Present is off while this device asks for reduced motion";
export const PRESENT_NEEDS_A_LAYOUT = "Present plays your layout: lay out or add furniture first";
export const PRESENT_NOT_READY = "Present is not ready for this view of the room yet";

export function plannerPresent(facts: PlannerPresentFacts): PlannerPresent {
  if (facts.assemblyActive) return { kind: "playing", fast: facts.assemblyFast };
  if (facts.reducedMotion) return { kind: "unavailable", reason: PRESENT_KEPT_STILL };
  if (facts.assemblyOnStage && facts.furnished) return { kind: "assembly" };
  if (facts.tour !== null) return { kind: "tour", tour: facts.tour };
  return { kind: "unavailable", reason: facts.assemblyOnStage ? PRESENT_NEEDS_A_LAYOUT : PRESENT_NOT_READY };
}

/** Present's name, for a screen reader and the tooltip: what a press does now, or why it can't. */
export function presentName(present: PlannerPresent): string {
  switch (present.kind) {
    case "assembly": return "Present: watch the room set itself";
    case "playing": return present.fast ? "Present is hurrying: press to go to the end" : "Present is playing: press to hurry it";
    case "tour": return "Present: play the room as your guests will see it";
    case "unavailable": return present.reason;
  }
}

/** The line under Present where there is no tooltip to read (a touch screen). */
export function presentLine(present: PlannerPresent): string {
  switch (present.kind) {
    case "assembly": return "Watch the room set itself";
    case "playing": return "The room is setting itself";
    case "tour": return "Play the room as your guests will see it";
    case "unavailable": return present.reason;
  }
}

/** What Present plays this moment, read from the stores as they are now. */
export function currentPlannerPresent(): PlannerPresent {
  const recall = useAssemblyRecallStore.getState();
  const editor = useEditorStore.getState();
  const cockpit = useCockpitStore.getState();
  return plannerPresent({
    reducedMotion: prefersReducedMotion(),
    assemblyOnStage: recall.onStage,
    assemblyActive: recall.active,
    assemblyFast: recall.fast,
    furnished: usePlacementStore.getState().placedItems.length > 0,
    tour: buildPlannerShowcaseTour({
      dimensions: useRoomDimensionsStore.getState().dimensions,
      configId: editor.configId,
      spaceId: editor.space?.id ?? null,
      roomSlug: editor.space?.slug ?? null,
      layerMode: cockpit.layerMode,
      sceneSource: cockpit.sceneSource,
    }),
  });
}

/**
 * Present, pressed. It plays what the room allows now, not what the last frame drew: a show can start or end in
 * between. While the Assembly plays, a press from the keys (Enter or Space) hurries it as the Skip does; a
 * pointer's press has hurried it already, since GrandAssembly takes every press during the show as the Skip.
 * Returns what it started, if anything.
 */
export function pressPlannerPresent(fromKeys: boolean): "assembly" | "tour" | null {
  const present = currentPlannerPresent();
  if (present.kind === "assembly") return requestAssemblyReplay() ? "assembly" : null;
  if (present.kind === "tour") {
    useBookmarkStore.getState().startTour(present.tour);
    return "tour";
  }
  if (present.kind === "playing" && fromKeys) hurryAssembly();
  return null;
}

/** What Present plays, kept current for its button. */
export function usePlannerPresent(): PlannerPresent {
  const reducedMotion = useReducedMotion();
  const assemblyOnStage = useAssemblyRecallStore((state) => state.onStage);
  const assemblyActive = useAssemblyRecallStore((state) => state.active);
  const assemblyFast = useAssemblyRecallStore((state) => state.fast);
  const furnished = usePlacementStore((state) => state.placedItems.length > 0);
  const dimensions = useRoomDimensionsStore((state) => state.dimensions);
  const configId = useEditorStore((state) => state.configId);
  const spaceId = useEditorStore((state) => state.space?.id ?? null);
  const roomSlug = useEditorStore((state) => state.space?.slug ?? null);
  const layerMode = useCockpitStore((state) => state.layerMode);
  const sceneSource = useCockpitStore((state) => state.sceneSource);
  const tour = useMemo(
    () => buildPlannerShowcaseTour({ dimensions, configId, spaceId, roomSlug, layerMode, sceneSource }),
    [configId, dimensions, layerMode, roomSlug, sceneSource, spaceId],
  );
  return useMemo(
    () => plannerPresent({ reducedMotion, assemblyOnStage, assemblyActive, assemblyFast, furnished, tour }),
    [assemblyActive, assemblyFast, assemblyOnStage, furnished, reducedMotion, tour],
  );
}
