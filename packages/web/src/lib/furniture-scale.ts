// ---------------------------------------------------------------------------
// Furniture scale — one normalization seam for render and planning geometry.
//
// Persisted API writes require a positive number, but legacy/local drafts and
// direct store mutation can still supply missing or invalid values. Rendering
// historically treats those values as scale 1. Every footprint consumer must
// use the same fallback or the visible object and its planning geometry drift.
// ---------------------------------------------------------------------------

/** Resolve an optional persisted uniform scale to a finite positive value. */
export function normalizeFurnitureScale(scale: number | undefined): number {
  return scale !== undefined && Number.isFinite(scale) && scale > 0 ? scale : 1;
}
