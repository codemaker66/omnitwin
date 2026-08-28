// ---------------------------------------------------------------------------
// The scanner's walk.
//
// Every XGRIDS capture ships `info/poses.json`: where the operator stood, pose
// by pose, in the same coordinate frame as the splats. It is the most useful
// thing in the bundle and it went unused at first.
//
// A person walking a room stays inside it, at eye height, in the free space. So
// the walk answers questions the geometry could not:
//
//   - Where to put the viewer. Standing where the scanner stood cannot be
//     outside the room, and is guaranteed to have data in every direction.
//   - Where the room ends. Outside the walked region a capture has no data at
//     all — only the backs of surfaces — so there is nothing there worth
//     showing, whatever the mesh bounds claim.
//   - How tall a person is in this room, which is the eye height to use.
//
// Measured against the mesh-derived frames this is markedly better: the Grand
// Hall's walk spans 11.2 x 20.5 m against a published 21 x 10 m (the same room,
// axes swapped), where measuring the mesh claimed 13.8 x 22.3 x 12.9 m tall.
// ---------------------------------------------------------------------------

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface WalkPose {
  /** Scanner position, XGRIDS Z-up metres. */
  readonly position: Vec3;
  /** Scanner orientation as a quaternion, as recorded. */
  readonly rotation: Quat;
}

/** Below this there is not enough of a walk to conclude anything from. */
const MIN_POSES = 8;

function finiteTriple(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const parts: number[] = [];
  for (let axis = 0; axis < 3; axis += 1) {
    const part: unknown = value[axis];
    if (typeof part !== "number" || !Number.isFinite(part)) return null;
    parts.push(part);
  }
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function finiteQuat(value: unknown): Quat {
  if (!Array.isArray(value) || value.length < 4) return [0, 0, 0, 1];
  const parts = value.slice(0, 4);
  if (!parts.every((part) => typeof part === "number" && Number.isFinite(part))) return [0, 0, 0, 1];
  return parts as Quat;
}

/**
 * Reads `info/poses.json`. A malformed pose is skipped rather than throwing:
 * one bad sample in a walk of twenty thousand should not cost the whole room.
 */
export function parseWalkPoses(raw: string): WalkPose[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof json !== "object" || json === null) return [];
  const poses = (json as { poses?: unknown }).poses;
  if (!Array.isArray(poses)) return [];

  const walk: WalkPose[] = [];
  for (const entry of poses) {
    if (typeof entry !== "object" || entry === null) continue;
    const position = finiteTriple((entry as { T?: unknown }).T);
    if (position === null) continue;
    walk.push({ position, rotation: finiteQuat((entry as { R?: unknown }).R) });
  }
  return walk;
}

/**
 * The recorded pose closest to every other pose — the middle of the walk.
 *
 * A real pose rather than an average of them, because the average of a walk
 * around a table is the table. Sampled rather than exhaustive: comparing every
 * pose against every other is quadratic, and a walk runs to twenty thousand.
 */
export function medoidPose(walk: readonly WalkPose[]): WalkPose | null {
  if (walk.length === 0) return null;
  if (walk.length === 1) return walk[0] ?? null;

  const sampleStride = Math.max(1, Math.floor(walk.length / 400));
  const samples: WalkPose[] = [];
  for (let index = 0; index < walk.length; index += sampleStride) {
    const pose = walk[index];
    if (pose !== undefined) samples.push(pose);
  }

  let best: WalkPose | null = null;
  let bestCost = Infinity;
  for (const candidate of samples) {
    let cost = 0;
    for (const other of samples) {
      cost += Math.hypot(
        candidate.position[0] - other.position[0],
        candidate.position[1] - other.position[1],
      );
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = candidate;
    }
  }
  return best;
}

/** Median walked height: how tall the person holding the scanner was, here. */
export function walkEyeHeight(walk: readonly WalkPose[]): number | null {
  if (walk.length === 0) return null;
  const heights = walk.map((pose) => pose.position[2]).sort((a, b) => a - b);
  const middle = Math.floor(heights.length / 2);
  return heights[middle] ?? null;
}

export interface WalkRegion {
  readonly min: Vec3;
  readonly max: Vec3;
}

/**
 * How much of the walk to trim from each end of an axis.
 *
 * A walk is a path, not a cloud: the operator circulates in the room and
 * occasionally steps out of it, so excursions are thin tails rather than a
 * separate mode. Trimming a small percentile from each end removes them while
 * keeping the room, and — unlike a density threshold — cannot collapse a
 * uniformly walked room to nothing. A threshold set against total poses did
 * exactly that, reporting Reception as 0.4 x 0.3 m.
 *
 * Deliberately gentle: Reception's raw walk spans 10.5 x 13.1 m against a
 * published 13.4 x 11.2 m, so the walk is already very nearly the room, and
 * over-trimming only shrinks where the viewer is allowed to stand.
 */
const WALK_TRIM_FRACTION = 0.015;

function trimmedSpan(values: readonly number[]): readonly [number, number] | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * WALK_TRIM_FRACTION);
  const low = sorted[cut] ?? sorted[0];
  const high = sorted[sorted.length - 1 - cut] ?? sorted[sorted.length - 1];
  if (low === undefined || high === undefined) return null;
  return [low, high];
}

/**
 * The part of the walk the operator actually circulated in.
 *
 * This is the room's interior for viewing purposes: the viewer may go anywhere
 * inside it and still be somewhere the scanner saw from.
 */
export function denseWalkRegion(walk: readonly WalkPose[]): WalkRegion | null {
  if (walk.length < MIN_POSES) {
    if (walk.length === 0) return null;
    const xs = walk.map((p) => p.position[0]);
    const ys = walk.map((p) => p.position[1]);
    const zs = walk.map((p) => p.position[2]);
    return {
      min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
      max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
    };
  }

  const spans: (readonly [number, number])[] = [];
  for (const axis of [0, 1, 2] as const) {
    const span = trimmedSpan(walk.map((pose) => pose.position[axis]));
    if (span === null) return null;
    spans.push(span);
  }
  const [sx, sy, sz] = spans as [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
  return { min: [sx[0], sy[0], sz[0]], max: [sx[1], sy[1], sz[1]] };
}

/**
 * Thins a walk to at most `budget` poses, keeping both ends.
 *
 * A walk of twenty thousand poses is far more than a viewer needs, and all of
 * it would be shipped to the browser. Even sampling preserves the shape.
 */
export function decimateWalk(walk: readonly WalkPose[], budget: number): WalkPose[] {
  if (budget <= 0) return [];
  if (walk.length <= budget) return [...walk];

  const kept: WalkPose[] = [];
  const stride = (walk.length - 1) / (budget - 1);
  for (let index = 0; index < budget; index += 1) {
    const pose = walk[Math.round(index * stride)];
    if (pose !== undefined) kept.push(pose);
  }
  return kept;
}
