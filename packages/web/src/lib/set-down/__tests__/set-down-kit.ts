// ---------------------------------------------------------------------------
// Shared helpers for the set-down render tests and the listening renders: one
// way to build an input, and one length rule for loudness, so every render is
// measured like with like.
// ---------------------------------------------------------------------------

import { bandEnergy, kWeightedLoudness } from "../analysis.js";
import { bodyFor } from "../bodies.js";
import type { Reflection } from "../reflections.js";
import { renderSetDown, type SetDownInput, type SetDownRender } from "../render.js";
import { surfaceResponse, type SurfaceKind } from "../surfaces.js";

export const SR = 48000;

export interface SetDownOptions {
  readonly room?: string;
  readonly seed?: number;
  readonly speed?: number;
  readonly kind?: SetDownInput["kind"];
  readonly clothed?: boolean;
  readonly gain?: number;
  readonly azimuthRad?: number;
  readonly reflections?: readonly Reflection[];
  readonly scale?: number;
}

/** The input for `slug` set down with every foot on `surface` (resolved for `room`, the Grand Hall unless given), dry, centred and at full level. */
export function inputFor(slug: string, surface: SurfaceKind, options: SetDownOptions = {}): SetDownInput {
  const body = bodyFor(slug, options.scale);
  const response = surfaceResponse(surface, options.room ?? "grand-hall");
  return {
    body,
    surfaces: body.feet.map(() => response),
    speed: options.speed ?? 1,
    kind: options.kind ?? "drop",
    clothed: options.clothed ?? false,
    direct: { gain: options.gain ?? 1, azimuthRad: options.azimuthRad ?? 0 },
    reflections: options.reflections ?? [],
    seed: options.seed ?? 1,
    sampleRate: SR,
  };
}

export function setDown(slug: string, surface: SurfaceKind, options: SetDownOptions = {}): SetDownRender {
  return renderSetDown(inputFor(slug, surface, options));
}

/** Loudness is always read over the same first 400 ms (BS.1770's momentary block), so renders compare like with like. */
export const LOUDNESS_WINDOW = Math.round(0.4 * SR);

export function windowed(samples: Float32Array): Float32Array {
  const out = new Float32Array(LOUDNESS_WINDOW);
  out.set(samples.subarray(0, Math.min(samples.length, LOUDNESS_WINDOW)));
  return out;
}

export function loudness(render: SetDownRender): number {
  return kWeightedLoudness(windowed(render.left), windowed(render.right), SR);
}

export function energy(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return sum;
}

/** The share of a render's first `ms` milliseconds that lies above `hz`: how much click a landing has. */
export function clickShare(samples: Float32Array, ms: number, hz: number): number {
  const head = samples.subarray(0, Math.round((ms / 1000) * SR));
  const total = energy(head);
  return total > 0 ? bandEnergy(head, SR, hz, SR / 2) / total : 0;
}
