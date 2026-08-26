import { CatmullRomCurve3, MathUtils, Matrix4, Quaternion, Vector3 } from "three";

// -----------------------------------------------------------------------------
// camera-rail — the Arrival's flight path as pure, testable math.
//
// Space: local meters around the Trades Hall anchor. ReorientationPlugin
// (GoogleTilesStage) places the anchor at the scene origin with +Y up and
// cardinal axes aligned, so these numbers survive independent of the globe.
// Position runs through a centripetal Catmull-Rom (no corner kinks at
// keyframes); look-at targets interpolate linearly per segment; segment-local
// progress is smoothstepped so each leg eases in/out without a global
// velocity discontinuity. Roll is always zero (up = +Y): an establishing
// dive, not a barrel roll.
// -----------------------------------------------------------------------------

export interface RailKeyframe {
  readonly t: number;
  readonly position: readonly [number, number, number];
  readonly lookAt: readonly [number, number, number];
}

export interface RailPose {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
}

const UP = new Vector3(0, 1, 0);

/** Smootherstep (Perlin) — zero 1st AND 2nd derivative at the ends. */
function smoother(u: number): number {
  const x = MathUtils.clamp(u, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export function sampleRail(
  keyframes: readonly RailKeyframe[],
  tNorm: number,
): RailPose {
  if (keyframes.length < 2) {
    throw new Error("sampleRail needs at least two keyframes");
  }
  const t = MathUtils.clamp(tNorm, 0, 1);

  // Find the active segment by keyframe time.
  let seg = 0;
  while (seg < keyframes.length - 2 && t > (keyframes[seg + 1] as RailKeyframe).t) {
    seg += 1;
  }
  const a = keyframes[seg] as RailKeyframe;
  const b = keyframes[seg + 1] as RailKeyframe;
  const span = Math.max(b.t - a.t, 1e-9);
  const u = smoother((t - a.t) / span);

  // Global position spline through ALL keyframes (centripetal — no kinks),
  // sampled at the eased global parameter mapped into the curve's 0..1.
  const curve = new CatmullRomCurve3(
    keyframes.map((k) => new Vector3(...k.position)),
    false,
    "centripetal",
  );
  const curveT = (seg + u) / (keyframes.length - 1);
  const position = curve.getPoint(curveT);

  const lookAt = new Vector3(...a.lookAt).lerp(new Vector3(...b.lookAt), u);
  const m = new Matrix4().lookAt(position, lookAt, UP);
  const quaternion = new Quaternion().setFromRotationMatrix(m).normalize();
  return { position, quaternion };
}

/** Flight length — matches the recording's pacing plus a settle beat. */
export const FLIGHT_DURATION_S = 11;

/**
 * SEED rail, tuned live in Task 6 against the reference footage
 * (D:\Davinci exports\trades hall zoom in 2.mov — 9.37 s: city-wide over the
 * Clyde → dive → settle on the Glassford Street facade). Axis mapping of the
 * reoriented frame (which horizontal axis is north) is confirmed in Task 6;
 * until then these x/z values are calibrated by eye, not survey.
 */
export const ARRIVAL_RAIL: readonly RailKeyframe[] = [
  { t: 0.0, position: [-600, 3400, 1400], lookAt: [0, 0, 200] },
  { t: 0.45, position: [-220, 900, 520], lookAt: [0, 8, 60] },
  { t: 0.8, position: [-90, 180, 150], lookAt: [0, 14, 0] },
  { t: 1.0, position: [-58, 26, 40], lookAt: [0, 13, 0] },
];
