import type { Stereo } from "./tail.js";

// ---------------------------------------------------------------------------
// A set-down heard from where it lands (T-700, rulings R104 and R107).
//
// A variant rendered ahead bakes in the pan of the place it was rendered for,
// and a variant's key leaves position out, so the next piece of its kind may
// land anywhere. Every voice plays at the landing's own dry gain (R57), so a
// move changes only the pan: a kept variant plays as rendered when its pan is
// the landing's, as the ear hears it at contact, within sin 0.2 (the share to
// the right, which is all the pan reads, so a front and a back position that
// mirror each other pan alike). Otherwise it plays as a copy moved to the
// landing: un-panned on the engine's own equal-power law, which recovers a
// direct-only render exactly, and panned to the landing's angle.
//
// The room's send is unchanged. The early reflections keep their delays and
// spectra, those of where the variant was rendered, but the move folds them
// into the landing's direction and they lose their spread: the re-review
// measured reflections at -12.5 to +2.1 dB against the direct sound, their
// left-right correlation 0.36-0.89 before the move and 1 after it. Task 16's
// listening judges it; if it is heard, a variant kept in two parts (a mono
// direct sound and stereo reflections, about 1.5 times the memory) would
// move only the direct sound. Pure, and no Web Audio: the registry stays the
// only file that makes sound.
// ---------------------------------------------------------------------------

/** A render's direct sound: its dry gain (directPath's, R57) and its lateral angle (its sine the share to the right). */
export interface SetDownDirect {
  readonly gain: number;
  readonly azimuthRad: number;
}

/** A variant plays as rendered when its share to the right is within this of the landing's: sin 0.2 (R107). */
export const AS_RENDERED_SIDE = Math.sin(0.2);

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

/** Whether a render made for the angle `renderedAzimuthRad` may play as it is for a landing heard at `heardAzimuthRad` (R107). */
export function playsAsRendered(renderedAzimuthRad: number, heardAzimuthRad: number): boolean {
  return Math.abs(Math.sin(renderedAzimuthRad) - Math.sin(heardAzimuthRad)) <= AS_RENDERED_SIDE;
}

/**
 * `render`, made for the angle `fromAzimuthRad`, panned to `toAzimuthRad` (R104).
 *
 * Un-panned on the equal-power law: with [l, r] the rendered angle's gains,
 * the mono is (l L + r R) / 2, which is the pre-pan source exactly for a
 * direct-only render (l^2 + r^2 = 2). Then panned to the new angle. The
 * samples keep their level: a render is at unit gain, its distance is the
 * voice's dry gain alone (R57), and the same samples feed the room's send,
 * which distance never scales (R58). One pass over the samples.
 */
export function respatializeSetDown(render: Stereo, fromAzimuthRad: number, toAzimuthRad: number): Stereo {
  const [fromLeft, fromRight] = panGains(fromAzimuthRad);
  const [toLeft, toRight] = panGains(toAzimuthRad);
  const length = Math.min(render.left.length, render.right.length);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let n = 0; n < length; n++) {
    const mono = (fromLeft * (render.left[n] ?? 0) + fromRight * (render.right[n] ?? 0)) / 2;
    left[n] = toLeft * mono;
    right[n] = toRight * mono;
  }
  return { left, right, sampleRate: render.sampleRate };
}
