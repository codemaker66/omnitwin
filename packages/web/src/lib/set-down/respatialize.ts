import type { Stereo } from "./tail.js";

// ---------------------------------------------------------------------------
// A set-down heard from where it lands (T-700, ruling R104).
//
// A variant rendered ahead bakes in the pan of the place it was rendered for,
// and a variant's key leaves position out, so the next piece of its kind may
// land anywhere. A kept variant plays as rendered only when its direct sound
// came from within 0.2 rad of the landing's, as the ear hears it at contact,
// and its direct gain is within 1.5 dB of the landing's. Otherwise it plays
// as a copy moved to the landing: un-panned on the engine's own equal-power
// law, which recovers a direct-only render exactly, and panned to the
// landing's angle. The room's send is unchanged; only the early reflections
// stay those of where it was rendered. Pure, and no Web Audio: the registry
// stays the only file that makes sound.
// ---------------------------------------------------------------------------

/** A render's direct sound: its dry gain (directPath's, R57) and its lateral angle (its sine the share to the right). */
export interface SetDownDirect {
  readonly gain: number;
  readonly azimuthRad: number;
}

/** A variant plays as rendered only within this angle of the landing's direct sound, radians (R104). */
export const AS_RENDERED_AZIMUTH_RAD = 0.2;
/** ...and only within this much of the landing's direct gain, dB (R104). */
export const AS_RENDERED_GAIN_DB = 1.5;

/**
 * Equal-power gains for a lateral angle: the share to the right is sin(az),
 * and the law is normalised to unity in each channel at the centre, so a
 * centred sound at full gain peaks at its level; left squared plus right
 * squared is 2 at every angle. The renderer pans with exactly this.
 */
export function panGains(azimuthRad: number): readonly [number, number] {
  const side = Number.isFinite(azimuthRad) ? Math.min(1, Math.max(-1, Math.sin(azimuthRad))) : 0;
  const angle = ((side + 1) * Math.PI) / 4;
  return [Math.SQRT2 * Math.cos(angle), Math.SQRT2 * Math.sin(angle)];
}

/** The angle between two azimuths, radians, 0 to pi: a lateral azimuth runs round the ear, -pi to pi. */
function angleBetween(a: number, b: number): number {
  const turn = 2 * Math.PI;
  const apart = (((a - b) % turn) + turn) % turn;
  return Math.min(apart, turn - apart);
}

/** Whether a render made for `rendered` may play as it is for a landing heard as `heard` (R104). */
export function playsAsRendered(rendered: SetDownDirect, heard: SetDownDirect): boolean {
  const offDb = 20 * Math.log10(heard.gain / rendered.gain);
  return angleBetween(heard.azimuthRad, rendered.azimuthRad) <= AS_RENDERED_AZIMUTH_RAD && Math.abs(offDb) <= AS_RENDERED_GAIN_DB;
}

/** A render moved to another direct sound, and the dry gain it plays at. */
export interface SetDownMoved extends Stereo {
  readonly directGain: number;
}

/**
 * `render`, made for the direct sound `rendered`, heard as `heard` (R104).
 *
 * Un-panned on the equal-power law: with [l, r] the rendered angle's gains,
 * the mono is (l L + r R) / 2, which is the pre-pan source exactly for a
 * direct-only render (l^2 + r^2 = 2). Then panned to the heard angle. Its dry
 * gain is the rendered one scaled by the heard over the rendered: the heard
 * one's. A render is at unit gain and its distance is the dry gain's alone
 * (R57), and the same samples feed the room's send, which distance never
 * scales (R58), so the scale goes on the dry gain, not on the samples. One
 * pass over the samples.
 */
export function respatializeSetDown(render: Stereo, rendered: SetDownDirect, heard: SetDownDirect): SetDownMoved {
  const [fromLeft, fromRight] = panGains(rendered.azimuthRad);
  const [toLeft, toRight] = panGains(heard.azimuthRad);
  const length = Math.min(render.left.length, render.right.length);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let n = 0; n < length; n++) {
    const mono = (fromLeft * (render.left[n] ?? 0) + fromRight * (render.right[n] ?? 0)) / 2;
    left[n] = toLeft * mono;
    right[n] = toRight * mono;
  }
  return { left, right, sampleRate: render.sampleRate, directGain: heard.gain };
}
