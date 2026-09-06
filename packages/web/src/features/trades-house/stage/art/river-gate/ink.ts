// -----------------------------------------------------------------------------
// ink — the skyline's outline as one open path for the ink layer to draw
// by stroke-dashoffset under a spring scalar. It is the far bank's own
// outline (the same hand-drawn points), so the ink lands exactly on the
// silhouette's edge. `segments` is the count of drawing commands after the
// first move, the manifest's 3,000-segment budget.
// -----------------------------------------------------------------------------
import { FAR_BANK_OUTLINE_PATH } from "./far-bank-geometry.js";
import { byteLength } from "./viewbox.js";

export interface InkPath {
  readonly path: string;
  readonly segments: number;
}

/** Drawing commands in a path: every command letter but the moves. Paths here are upper-case absolute. */
export function countPathSegments(path: string): number {
  let count = 0;
  for (const char of path) {
    if (char === "L" || char === "H" || char === "V" || char === "C" || char === "S" || char === "Q" || char === "T" || char === "A" || char === "Z") {
      count += 1;
    }
  }
  return count;
}

export const RIVER_GATE_INK: InkPath = {
  path: FAR_BANK_OUTLINE_PATH,
  segments: countPathSegments(FAR_BANK_OUTLINE_PATH),
};

export const RIVER_GATE_INK_BYTES = byteLength(RIVER_GATE_INK.path);
