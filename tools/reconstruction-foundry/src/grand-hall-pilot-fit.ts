/**
 * Similarity-fit reproduction for the Grand Hall pilot: Horn's closed-form
 * quaternion method (scale + rotation + translation) with a fixed held-out
 * policy of complete sweep centres. Deterministic: fixed iteration counts,
 * no randomness, no clocks.
 */

export type Vec3 = readonly [number, number, number];

export interface SimilarityFit {
  readonly scale: number;
  readonly rotationRows: readonly [Vec3, Vec3, Vec3];
  readonly translation: Vec3;
  readonly apply: (point: Vec3) => [number, number, number];
}

function centroid(points: readonly Vec3[]): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  const n = points.length;
  return [x / n, y / n, z / n];
}

/**
 * Horn 1987 closed-form absolute orientation. The maximal eigenvector of the
 * 4x4 quaternion matrix is found by power iteration on a positive-shifted
 * copy (fixed 512 iterations, fixed start), which is deterministic and ample
 * for the well-conditioned venue geometry this pilot fits.
 */
export function fitSimilarityHorn(
  source: readonly Vec3[],
  target: readonly Vec3[],
): SimilarityFit {
  if (source.length !== target.length || source.length < 3) {
    throw new Error("similarity fit requires at least three paired points");
  }
  const sc = centroid(source);
  const tc = centroid(target);
  const sCentered = source.map((p): Vec3 => [p[0] - sc[0], p[1] - sc[1], p[2] - sc[2]]);
  const tCentered = target.map((p): Vec3 => [p[0] - tc[0], p[1] - tc[1], p[2] - tc[2]]);
  let sxx = 0;
  let sxy = 0;
  let sxz = 0;
  let syx = 0;
  let syy = 0;
  let syz = 0;
  let szx = 0;
  let szy = 0;
  let szz = 0;
  for (let k = 0; k < sCentered.length; k += 1) {
    const s = sCentered[k];
    const t = tCentered[k];
    if (s === undefined || t === undefined) continue;
    sxx += s[0] * t[0];
    sxy += s[0] * t[1];
    sxz += s[0] * t[2];
    syx += s[1] * t[0];
    syy += s[1] * t[1];
    syz += s[1] * t[2];
    szx += s[2] * t[0];
    szy += s[2] * t[1];
    szz += s[2] * t[2];
  }
  const n4: readonly (readonly number[])[] = [
    [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ];
  // Positive shift so the algebraically largest eigenvalue dominates in magnitude.
  let shift = 0;
  for (const row of n4) for (const value of row) shift += Math.abs(value);
  const shifted = n4.map((row, i) =>
    row.map((value, j) => (i === j ? value + shift : value)),
  );
  let q: readonly number[] = [1, 0, 0, 0];
  for (let iteration = 0; iteration < 512; iteration += 1) {
    const next = shifted.map(
      (row) =>
        (row[0] ?? 0) * (q[0] ?? 0) +
        (row[1] ?? 0) * (q[1] ?? 0) +
        (row[2] ?? 0) * (q[2] ?? 0) +
        (row[3] ?? 0) * (q[3] ?? 0),
    );
    const norm = Math.hypot(next[0] ?? 0, next[1] ?? 0, next[2] ?? 0, next[3] ?? 0);
    q = next.map((value) => value / norm);
  }
  const [w = 1, x = 0, y = 0, z = 0] = q;
  const rotationRows: [Vec3, Vec3, Vec3] = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
  const rotate = (p: Vec3): [number, number, number] => [
    rotationRows[0][0] * p[0] + rotationRows[0][1] * p[1] + rotationRows[0][2] * p[2],
    rotationRows[1][0] * p[0] + rotationRows[1][1] * p[1] + rotationRows[1][2] * p[2],
    rotationRows[2][0] * p[0] + rotationRows[2][1] * p[1] + rotationRows[2][2] * p[2],
  ];
  let dot = 0;
  let magnitude = 0;
  for (let k = 0; k < sCentered.length; k += 1) {
    const s = sCentered[k];
    const t = tCentered[k];
    if (s === undefined || t === undefined) continue;
    const rs = rotate(s);
    dot += rs[0] * t[0] + rs[1] * t[1] + rs[2] * t[2];
    magnitude += s[0] * s[0] + s[1] * s[1] + s[2] * s[2];
  }
  const scale = dot / magnitude;
  const rc = rotate(sc);
  const translation: Vec3 = [tc[0] - scale * rc[0], tc[1] - scale * rc[1], tc[2] - scale * rc[2]];
  const apply = (point: Vec3): [number, number, number] => {
    const rp = rotate(point);
    return [
      scale * rp[0] + translation[0],
      scale * rp[1] + translation[1],
      scale * rp[2] + translation[2],
    ];
  };
  return { scale, rotationRows, translation, apply };
}

/**
 * The bounded Grand Hall diagnostic scope frozen by T-507. Sweep 49 is an
 * adjacent space and is deliberately not a member of this set.
 */
export const PILOT_INCLUDED_SWEEPS: readonly number[] = Object.freeze(
  Array.from({ length: 49 }, (_, sweepIndex) => sweepIndex),
);

/** One complete sweep centre per decade, frozen by T-507 before fitting. */
export const PILOT_HELD_OUT_SWEEPS: readonly number[] = Object.freeze([
  5,
  15,
  25,
  35,
  44,
]);

export const PILOT_SOURCE_FRAME_ID = "colmap-sfm";
export const PILOT_TARGET_FRAME_ID = "e57-global-diagnostic";
export const PILOT_TARGET_FRAME_LABEL =
  "E57 global scan-pose frame (same-lineage diagnostic; not independent survey control)";
export const PILOT_TRANSFORM_ID =
  "colmap-sfm-to-e57-global-diagnostic-proposed";

const PILOT_INCLUDED_SWEEP_SET = new Set(PILOT_INCLUDED_SWEEPS);
const PILOT_HELD_OUT_SWEEP_SET = new Set(PILOT_HELD_OUT_SWEEPS);

export interface PilotCorrespondence {
  readonly sweepIndex: number;
  readonly source: Vec3;
  readonly target: Vec3;
}

export interface ResidualStatistics {
  readonly medianMeters: number;
  readonly rmseMeters: number;
  readonly p95Meters: number;
  readonly maxMeters: number;
}

export interface PilotFitReport {
  readonly sourceFrameId: typeof PILOT_SOURCE_FRAME_ID;
  readonly targetFrameId: typeof PILOT_TARGET_FRAME_ID;
  readonly targetFrameLabel: typeof PILOT_TARGET_FRAME_LABEL;
  readonly scopePolicy: string;
  readonly correspondenceMethod: string;
  readonly heldOutPolicy: string;
  readonly sfmLeakDocumented: string;
  readonly scale: number;
  readonly rotationRows: readonly [Vec3, Vec3, Vec3];
  readonly translation: Vec3;
  readonly fitSet: {
    readonly count: number;
    readonly sweepIndices: readonly number[];
    readonly residuals: ResidualStatistics;
  };
  readonly heldOutSet: {
    readonly count: number;
    readonly sweepIndices: readonly number[];
    readonly residuals: ResidualStatistics;
  };
  readonly overlapFraction: number;
}

/**
 * Selects the exact 0-48 Grand Hall evidence epoch and returns it in sweep
 * order. Out-of-scope observations, including adjacent-space sweep 49, cannot
 * enter either fitting or held-out evaluation. Missing or duplicate in-scope
 * sweeps fail closed instead of silently changing the diagnostic population.
 */
export function selectBoundedPilotCorrespondences(
  correspondences: readonly PilotCorrespondence[],
): readonly PilotCorrespondence[] {
  const bySweep = new Map<number, PilotCorrespondence>();
  for (const correspondence of correspondences) {
    if (!PILOT_INCLUDED_SWEEP_SET.has(correspondence.sweepIndex)) continue;
    if (bySweep.has(correspondence.sweepIndex)) {
      throw new Error(
        `bounded Grand Hall diagnostic has duplicate sweep ${String(correspondence.sweepIndex)}`,
      );
    }
    bySweep.set(correspondence.sweepIndex, correspondence);
  }

  const missing = PILOT_INCLUDED_SWEEPS.filter((sweepIndex) => !bySweep.has(sweepIndex));
  if (missing.length > 0) {
    throw new Error(
      `bounded Grand Hall diagnostic is missing sweeps: ${missing.join(",")}`,
    );
  }

  return PILOT_INCLUDED_SWEEPS.map((sweepIndex) => {
    const correspondence = bySweep.get(sweepIndex);
    if (correspondence === undefined) {
      throw new Error(`bounded Grand Hall diagnostic lost sweep ${String(sweepIndex)}`);
    }
    return correspondence;
  });
}

/** Reports discovered sweep indices that did not enter the bounded population. */
export function deriveExcludedPilotSweepIndices(
  discoveredSweepIndices: readonly number[],
  boundedSweepIndices: readonly number[],
): readonly number[] {
  const bounded = new Set(boundedSweepIndices);
  return [...new Set(discoveredSweepIndices.filter((sweepIndex) => !bounded.has(sweepIndex)))].sort(
    (a, b) => a - b,
  );
}

function residualStatistics(residuals: readonly number[]): ResidualStatistics {
  const sorted = [...residuals].sort((a, b) => a - b);
  const n = sorted.length;
  const median =
    n % 2 === 1
      ? (sorted[(n - 1) / 2] ?? 0)
      : ((sorted[n / 2 - 1] ?? 0) + (sorted[n / 2] ?? 0)) / 2;
  const rmse = Math.sqrt(sorted.reduce((sum, r) => sum + r * r, 0) / n);
  const p95 = sorted[Math.min(n - 1, Math.ceil(0.95 * n) - 1)] ?? 0;
  const max = sorted[n - 1] ?? 0;
  return { medianMeters: median, rmseMeters: rmse, p95Meters: p95, maxMeters: max };
}

export function buildPilotFitReport(
  correspondences: readonly PilotCorrespondence[],
): PilotFitReport {
  const boundedCorrespondences = selectBoundedPilotCorrespondences(correspondences);
  const heldOut = boundedCorrespondences.filter((correspondence) =>
    PILOT_HELD_OUT_SWEEP_SET.has(correspondence.sweepIndex),
  );
  const fitSet = boundedCorrespondences.filter(
    (correspondence) => !PILOT_HELD_OUT_SWEEP_SET.has(correspondence.sweepIndex),
  );
  const fit = fitSimilarityHorn(
    fitSet.map((c) => c.source),
    fitSet.map((c) => c.target),
  );
  const residualOf = (c: PilotCorrespondence): number => {
    const mapped = fit.apply(c.source);
    return Math.hypot(
      mapped[0] - c.target[0],
      mapped[1] - c.target[1],
      mapped[2] - c.target[2],
    );
  };
  return {
    sourceFrameId: PILOT_SOURCE_FRAME_ID,
    targetFrameId: PILOT_TARGET_FRAME_ID,
    targetFrameLabel: PILOT_TARGET_FRAME_LABEL,
    scopePolicy:
      "Exact T-507 Grand Hall sweeps 0-48 only; adjacent-space sweep 49 and all other observations are excluded before fit/holdout partitioning.",
    correspondenceMethod:
      "Per-sweep COLMAP camera centre (mean of the sweep's registered cubeface centres, each -R^T t) matched to the E57 data3D pose translation at the same sweep index; similarity solved on the fit set only by Horn's closed-form quaternion method with uniform weights and no outlier rejection.",
    heldOutPolicy:
      "Complete sweep centres held out before fitting - the frozen T-507 set 5/15/25/35/44 within bounded Grand Hall sweeps 0-48; their residuals are reported separately and never enter the solve.",
    sfmLeakDocumented:
      "Held-out sweep centres derive from the same jointly-optimized COLMAP reconstruction as the fit set, so they are not independent observations; their residuals bound interpolation stability of the diagnostic, not surveyed accuracy.",
    scale: fit.scale,
    rotationRows: fit.rotationRows,
    translation: fit.translation,
    fitSet: {
      count: fitSet.length,
      sweepIndices: fitSet.map((c) => c.sweepIndex),
      residuals: residualStatistics(fitSet.map(residualOf)),
    },
    heldOutSet: {
      count: heldOut.length,
      sweepIndices: heldOut.map((c) => c.sweepIndex),
      residuals: residualStatistics(heldOut.map(residualOf)),
    },
    overlapFraction: boundedCorrespondences.length / PILOT_INCLUDED_SWEEPS.length,
  };
}
