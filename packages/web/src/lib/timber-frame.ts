import type { WallKey } from "../stores/visibility-store.js";

// ---------------------------------------------------------------------------
// timber-frame — thick structural timber trunks outlining each wall
// ---------------------------------------------------------------------------

/** Radius of main corner posts (meters) — thick tree trunk. */
export const POST_RADIUS = 0.22;

/** Radius of horizontal rails top/bottom (meters). */
export const RAIL_RADIUS = 0.18;

/** Radius of intermediate vertical studs. */
export const STUD_RADIUS = 0.14;

/** Radius of diagonal cross-braces. */
export const BRACE_RADIUS = 0.11;

/** Spacing between intermediate studs (meters). */
const STUD_SPACING = 3.0;

/** Beam descriptor — now uses radius for cylindrical trunks. */
export interface TimberBeam {
  readonly position: readonly [number, number, number];
  /** [radius, length] — radius of trunk, length along its axis. */
  readonly dims: readonly [number, number];
  /** Axis: "y" = vertical, "x" = horizontal along X, "z" = horizontal along Z. */
  readonly axis: "x" | "y" | "z";
  /** Unique seed for per-beam texture variation. */
  readonly seed: number;
}

/**
 * Computes the full timber frame for a single wall.
 *
 * Structure per wall:
 * - 2 corner posts (full height, thick)
 * - Top rail + bottom rail (full width, medium)
 * - Intermediate studs every ~3m (vertical, thinner)
 * - 2 diagonal braces in the end bays for Tudor feel
 */
export function computeWallBeams(
  wallKey: WallKey,
  roomWidth: number,
  roomLength: number,
  roomHeight: number,
): readonly TimberBeam[] {
  const hw = roomWidth / 2;
  const hl = roomLength / 2;
  const halfH = roomHeight / 2;
  const beams: TimberBeam[] = [];
  let seedCounter = wallKey.charCodeAt(5) * 100;

  // Determine wall span and fixed coordinate
  const isBackFront = wallKey === "wall-back" || wallKey === "wall-front";
  const span = isBackFront ? roomWidth : roomLength;
  const halfSpan = span / 2;
  const fixedZ = wallKey === "wall-back" ? -hl : wallKey === "wall-front" ? hl : 0;
  const fixedX = wallKey === "wall-left" ? -hw : wallKey === "wall-right" ? hw : 0;
  const spanAxis: "x" | "z" = isBackFront ? "x" : "z";

  // Helper to position a beam in the correct wall plane
  function pos(along: number, up: number): readonly [number, number, number] {
    if (isBackFront) return [along, up, fixedZ];
    return [fixedX, up, along];
  }

  // --- Corner posts (full height, thickest) ---
  beams.push({
    position: pos(-halfSpan, halfH),
    dims: [POST_RADIUS, roomHeight],
    axis: "y",
    seed: seedCounter++,
  });
  beams.push({
    position: pos(halfSpan, halfH),
    dims: [POST_RADIUS, roomHeight],
    axis: "y",
    seed: seedCounter++,
  });

  // --- Top and bottom rails (full span) ---
  beams.push({
    position: pos(0, RAIL_RADIUS * 0.5),
    dims: [RAIL_RADIUS, span],
    axis: spanAxis,
    seed: seedCounter++,
  });
  beams.push({
    position: pos(0, roomHeight - RAIL_RADIUS * 0.5),
    dims: [RAIL_RADIUS, span],
    axis: spanAxis,
    seed: seedCounter++,
  });

  // --- Mid rail at ~60% height for horizontal bracing ---
  const midRailY = roomHeight * 0.6;
  beams.push({
    position: pos(0, midRailY),
    dims: [STUD_RADIUS, span],
    axis: spanAxis,
    seed: seedCounter++,
  });

  // --- Intermediate studs ---
  const numBays = Math.max(2, Math.round(span / STUD_SPACING));
  const bayWidth = span / numBays;
  for (let i = 1; i < numBays; i++) {
    const along = -halfSpan + i * bayWidth;
    // Full-height stud
    beams.push({
      position: pos(along, halfH),
      dims: [STUD_RADIUS, roomHeight],
      axis: "y",
      seed: seedCounter++,
    });
  }

  // --- Diagonal braces in corner bays (Tudor cross-brace style) ---
  // These are approximated as tilted beams placed at the bay diagonal center
  const braceLen = Math.sqrt(bayWidth * bayWidth + (midRailY * midRailY)) * 0.85;
  // Left bay brace (bottom-left to mid-rail at first stud)
  const brace1Along = -halfSpan + bayWidth * 0.5;
  const brace1Y = midRailY * 0.5;
  beams.push({
    position: pos(brace1Along, brace1Y),
    dims: [BRACE_RADIUS, braceLen],
    axis: "y", // tilted in render
    seed: seedCounter++,
  });
  // Right bay brace
  const brace2Along = halfSpan - bayWidth * 0.5;
  beams.push({
    position: pos(brace2Along, brace1Y),
    dims: [BRACE_RADIUS, braceLen],
    axis: "y",
    seed: seedCounter++,
  });

  return beams;
}
