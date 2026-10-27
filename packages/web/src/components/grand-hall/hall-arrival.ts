// ---------------------------------------------------------------------------
// The walls' relief arriving, built in slices
//
// The scanned relief (hall-relief.ts) arrives once, a second or so after the
// room first draws, and everything the planner makes from it is built then:
// the relief as drawn (drawnRelief: cut along the doorways' lines), the
// walls' geometry with every vertex's light baked (hall-geometry.ts), the
// section's cap and the slicer's index (hall-relief-section.ts). At once that
// was one main-thread task of 150-250 ms on a desktop CPU (R2, 22 October),
// up to a second on a phone. Here each runs as a sliced build
// (hall-slices.ts), a frame's spare few milliseconds at a time, each cached
// as it finishes; GrandHallModel then takes the drawn relief and finds the
// rest already built, so nothing long runs inside its render or effects.
// ---------------------------------------------------------------------------

import type { WallRelief } from "./hall-relief.js";
import { drawnReliefSteps } from "./hall-walls.js";
import { hallWallGeometrySteps } from "./hall-geometry.js";
import { reliefSlicerSteps, sectionCapGeometry } from "./hall-relief-section.js";
import { runSliced, type SliceOptions } from "./hall-slices.js";

/** Builds everything the walls take from a newly arrived relief in slices; resolves with the relief as drawn. */
export async function prepareWallRelief(relief: WallRelief, options: SliceOptions = {}): Promise<WallRelief> {
  mark(ARRIVAL_MARKS.start);
  const drawn = await runSliced(drawnReliefSteps(relief), options);
  await runSliced(hallWallGeometrySteps(drawn), options);
  // The cap is a few milliseconds: one step of its own.
  await runSliced((function* capStep() {
    yield;
    sectionCapGeometry(drawn);
  })(), options);
  await runSliced(reliefSlicerSteps(drawn), options);
  mark(ARRIVAL_MARKS.end);
  return drawn;
}

/** User-timing marks around the build, for a page's long-task trace (the room lane's arrival measure). */
export const ARRIVAL_MARKS = { start: "grand-hall:relief-build-start", end: "grand-hall:relief-build-end" } as const;

function mark(name: string): void {
  if (typeof performance !== "undefined" && typeof performance.mark === "function") performance.mark(name);
}
