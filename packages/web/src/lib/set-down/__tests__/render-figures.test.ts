import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CRAFTED_FURNITURE_SLUGS } from "../../../components/meshes/crafted/crafted-slugs.js";
import { fft } from "../../planner-sound-render.js";
import { bandEnergy, kWeightedLoudness, octaveBandpassSteep, onsetTimesMs, schroederT20, spectralCentroidHz } from "../analysis.js";
import { bodyFor } from "../bodies.js";
import { renderSetDown, type SetDownInput, type SetDownRender } from "../render.js";
import { SURFACES, floorKindForRoom, surfaceResponse, type SurfaceKind } from "../surfaces.js";

// ---------------------------------------------------------------------------
// Renders for the ear and for independent analysis: never run in CI. Set
// SET_DOWN_WAV_DIR to a folder and run this file alone; it writes a handful
// of 48 kHz 16-bit stereo WAVs there (dry, centred, at full direct gain) with
// figures.json: each piece's peak, K-weighted loudness, length and render
// time on the Grand Hall's oak, and the figures the render tests compare.
// ---------------------------------------------------------------------------

const OUT = process.env["SET_DOWN_WAV_DIR"] ?? "";
const SR = 48000;

function inputFor(slug: string, surface: SurfaceKind, seed: number, room = "grand-hall"): SetDownInput {
  const body = bodyFor(slug);
  const response = surfaceResponse(surface, room);
  return {
    body,
    surfaces: body.feet.map(() => response),
    speed: 1,
    kind: "drop",
    clothed: false,
    direct: { gain: 1, azimuthRad: 0 },
    reflections: [],
    seed,
    sampleRate: SR,
  };
}

const render = (slug: string, surface: SurfaceKind, seed = 1, room = "grand-hall"): SetDownRender => renderSetDown(inputFor(slug, surface, seed, room));

/** A 16-bit PCM stereo WAV of a render. */
function wav(r: SetDownRender): Uint8Array {
  const frames = r.left.length;
  const bytes = new Uint8Array(44 + frames * 4);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string): void => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + frames * 4, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, r.sampleRate, true);
  view.setUint32(28, r.sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * 4, true);
  const pcm = (x: number): number => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
  for (let i = 0; i < frames; i += 1) {
    view.setInt16(44 + i * 4, pcm(r.left[i] ?? 0), true);
    view.setInt16(46 + i * 4, pcm(r.right[i] ?? 0), true);
  }
  return bytes;
}

const WINDOW = Math.round(0.4 * SR);
function windowed(samples: Float32Array): Float32Array {
  const out = new Float32Array(WINDOW);
  out.set(samples.subarray(0, Math.min(samples.length, WINDOW)));
  return out;
}
const loudness = (r: SetDownRender): number => kWeightedLoudness(windowed(r.left), windowed(r.right), SR);
const energy = (x: Float32Array): number => x.reduce((sum, v) => sum + v * v, 0);
const lowShare = (x: Float32Array): number => bandEnergy(x, SR, 60, 200) / energy(x);
const round = (x: number, places = 2): number => Math.round(x * 10 ** places) / 10 ** places;

/** The power-weighted mean frequency of the whole render, unwindowed (as the render tests read brightness). */
function brightnessHz(samples: Float32Array): number {
  let n = 1;
  while (n < samples.length) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(samples);
  fft(re, im);
  let weighted = 0;
  let total = 0;
  for (let k = 1; k <= n / 2; k += 1) {
    const power = (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2;
    weighted += (power * k * SR) / n;
    total += power;
  }
  return total > 0 ? weighted / total : 0;
}

function timedMs(slug: string, surface: SurfaceKind): number {
  render(slug, surface, 1);
  const times = Array.from({ length: 7 }, (_, i) => {
    const start = performance.now();
    render(slug, surface, 10 + i);
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return times[3] ?? 0;
}

describe.skipIf(OUT === "")("set-down renders for listening (SET_DOWN_WAV_DIR)", () => {
  it("writes the WAVs and the figures", () => {
    mkdirSync(OUT, { recursive: true });
    const files: readonly (readonly [string, string, SurfaceKind])[] = [
      ["chiavari-oak", "chiavari-chair", "oak-boards-joists"],
      ["chiavari-carpet", "chiavari-chair", "carpet"],
      ["chiavari-stage-deck", "chiavari-chair", "stage-deck"],
      ["round-6ft-oak", "round-table-6ft-white", "oak-boards-joists"],
      ["staging-deck-oak", "staging-deck-6x4", "oak-boards-joists"],
      ["mic-stand-oak", "mic-stand", "oak-boards-joists"],
    ];
    for (const [name, slug, surface] of files) writeFileSync(join(OUT, `${name}.wav`), wav(render(slug, surface)));

    const pieces = CRAFTED_FURNITURE_SLUGS.map((slug) => {
      const r = render(slug, "oak-boards-joists");
      return {
        slug,
        peakDb: round(r.peakDb),
        loudnessDb: round(loudness(r)),
        lengthMs: round((r.left.length / SR) * 1000, 0),
        brightnessHz: round(brightnessHz(r.left), 0),
        medianRenderMs: round(timedMs(slug, "oak-boards-joists"), 2),
      };
    });
    const features = [1, 2, 3, 4, 5].map((seed) => {
      const oak = render("chiavari-chair", "oak-boards-joists", seed);
      const carpet = render("chiavari-chair", "carpet", seed);
      const deck = render("chiavari-chair", "stage-deck", seed);
      const reception = render("chiavari-chair", floorKindForRoom("reception-room"), seed, "reception-room");
      const stand = render("mic-stand", "oak-boards-joists", seed);
      return {
        seed,
        brightnessHz: { oak: round(brightnessHz(oak.left), 0), carpet: round(brightnessHz(carpet.left), 0) },
        hannCentroidHz: { oak: round(spectralCentroidHz(oak.left, SR), 0), carpet: round(spectralCentroidHz(carpet.left, SR), 0) },
        t20S: { oak: round(schroederT20(oak.left, SR), 3), carpet: round(schroederT20(carpet.left, SR), 3) },
        share60to200: { oak: round(lowShare(oak.left), 3), deck: round(lowShare(deck.left), 3), reception: round(lowShare(reception.left), 3) },
        onsetsMs: onsetTimesMs(oak.left, SR),
        t20At1kS: {
          micStand: round(schroederT20(octaveBandpassSteep(stand.left, 1000, SR), SR), 3),
          chiavari: round(schroederT20(octaveBandpassSteep(oak.left, 1000, SR), SR), 3),
        },
        above14kShare: round(bandEnergy(oak.left, SR, 14000, SR / 2) / energy(oak.left), 6),
      };
    });
    const plays = (
      [
        ["chiavari-chair", "oak-boards-joists"],
        ["banquet-chair", "oak-boards-joists"],
        ["round-table-6ft-white", "oak-boards-joists"],
        ["trestle-6ft", "oak-boards-joists"],
        ["poseur-table", "oak-boards-joists"],
        ["staging-deck-6x4", "oak-boards-joists"],
        ["mic-stand", "carpet"],
        ["laptop", "table-top"],
      ] as const
    ).map(([slug, surface]) => {
      const values = Array.from({ length: 20 }, (_, i) => loudness(render(slug, surface, 100 + i)));
      return { slug, surface, spreadDb: round(Math.max(...values) - Math.min(...values)) };
    });
    const surfaces = (Object.keys(SURFACES) as SurfaceKind[]).map((surface) => ({ surface, chiavariMedianRenderMs: round(timedMs("chiavari-chair", surface), 2) }));
    const figures = { pieces, features, plays, surfaces };
    writeFileSync(join(OUT, "figures.json"), JSON.stringify(figures, null, 2));
    expect(pieces.length).toBe(CRAFTED_FURNITURE_SLUGS.length);
  });
});
