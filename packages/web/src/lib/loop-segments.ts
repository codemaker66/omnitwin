// ---------------------------------------------------------------------------
// Closed outlines as line segments
//
// The native (WebGPU) renderer draws Line and LineSegments but not LineLoop:
// a LineLoop is skipped with an error every frame, so a selection outline or
// clearance ring drawn as one simply never appears. A closed loop of points
// is drawn instead as segment pairs, the last point joined back to the first.
// ---------------------------------------------------------------------------

/** Segment pairs (p0 p1, p1 p2, …, pn p0) for a closed loop of xyz points. */
export function closedLoopSegments(points: Float32Array): Float32Array {
  const count = Math.floor(points.length / 3);
  const segments = new Float32Array(count * 6);
  for (let index = 0; index < count; index++) {
    const next = (index + 1) % count;
    segments.set(points.subarray(index * 3, index * 3 + 3), index * 6);
    segments.set(points.subarray(next * 3, next * 3 + 3), index * 6 + 3);
  }
  return segments;
}
