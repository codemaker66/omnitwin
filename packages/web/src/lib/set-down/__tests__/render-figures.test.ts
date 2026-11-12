import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CRAFTED_FURNITURE_SLUGS } from "../../../components/meshes/crafted/crafted-slugs.js";
import { bandEnergy, brightnessHz, octaveBandpassSteep, onsetTimesMs, schroederT20, spectralCentroidHz } from "../analysis.js";
import type { SetDownRender } from "../render.js";
import { SURFACES, floorKindForRoom, type SurfaceKind } from "../surfaces.js";
import { SR, clickShare, energy, loudness, setDown } from "./set-down-kit.js";

// ---------------------------------------------------------------------------
// Renders for the ear and for independent analysis: never run in CI. Set
// SET_DOWN_WAV_DIR to a folder and run this file alone; it writes a handful
// of 48 kHz 16-bit stereo WAVs there (dry, centred, at full direct gain) with
// figures.json: each piece's peak, K-weighted loudness, length and render
// time on the Grand Hall's oak, the figures the render tests compare, the
// click shares, play-to-play spreads over 200 seeds (500 for the bare
// poseur and the bare trestle), and how often the safety limiter above
// -6 dBFS holds a play, over those plays and the whole catalogue on every
// surface (ruling R42).
// ---------------------------------------------------------------------------

const OUT = process.env["SET_DOWN_WAV_DIR"] ?? "";

const render = (slug: string, surface: SurfaceKind, seed = 1, room = "grand-hall"): SetDownRender => setDown(slug, surface, { seed, room });

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

const lowShare = (x: Float32Array): number => bandEnergy(x, SR, 60, 200) / energy(x);
const round = (x: number, places = 2): number => Math.round(x * 10 ** places) / 10 ** places;

function timedMs(slug: string, surface: SurfaceKind): number {
  render(slug, surface, 1);
  const times = Array.from({ length: 7 }, (_, i) => {
    const start = performance.now();
    render(slug, surface, 10 + i);
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return times[3] ?? 0;
}

/** How often the safety limiter held these renders, and by how much at most. */
function limiting(renders: readonly SetDownRender[]): { readonly limited: number; readonly largestLimitDb: number } {
  return { limited: renders.filter((r) => r.limitDb > 0).length, largestLimitDb: round(Math.max(0, ...renders.map((r) => r.limitDb))) };
}

function playsOver(slug: string, surface: SurfaceKind, seeds: number): { readonly spreadDb: number; readonly peakMaxDb: number; readonly limited: number; readonly largestLimitDb: number } {
  const renders = Array.from({ length: seeds }, (_, i) => render(slug, surface, 1000 + i));
  const values = renders.map(loudness);
  return { spreadDb: round(Math.max(...values) - Math.min(...values)), peakMaxDb: round(Math.max(...renders.map((r) => r.peakDb))), ...limiting(renders) };
}

describe.skipIf(OUT === "")("set-down renders for listening (SET_DOWN_WAV_DIR)", () => {
  it("writes the WAVs and the figures", () => {
    mkdirSync(OUT, { recursive: true });
    const files: readonly (readonly [string, string, SurfaceKind, number])[] = [
      ["chiavari-oak", "chiavari-chair", "oak-boards-joists", 1],
      ["chiavari-oak-seed2", "chiavari-chair", "oak-boards-joists", 2],
      ["chiavari-carpet", "chiavari-chair", "carpet", 1],
      ["chiavari-stage-deck", "chiavari-chair", "stage-deck", 1],
      ["round-6ft-oak", "round-table-6ft-white", "oak-boards-joists", 1],
      ["staging-deck-oak", "staging-deck-6x4", "oak-boards-joists", 1],
      ["deck-oak-knock", "staging-deck-6x4", "oak-boards-joists", 2],
      ["mic-stand-oak", "mic-stand", "oak-boards-joists", 1],
    ];
    for (const [name, slug, surface, seed] of files) writeFileSync(join(OUT, `${name}.wav`), wav(render(slug, surface, seed)));

    const pieces = CRAFTED_FURNITURE_SLUGS.map((slug) => {
      const r = render(slug, "oak-boards-joists");
      return {
        slug,
        peakDb: round(r.peakDb),
        loudnessDb: round(loudness(r)),
        lengthMs: round((r.left.length / SR) * 1000, 0),
        brightnessHz: round(brightnessHz(r.left, SR), 0),
        above2kIn50msPct: round(100 * clickShare(r.left, 50, 2000), 2),
        limitDb: round(r.limitDb),
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
        brightnessHz: { oak: round(brightnessHz(oak.left, SR), 0), carpet: round(brightnessHz(carpet.left, SR), 0) },
        hannCentroidHz: { oak: round(spectralCentroidHz(oak.left, SR), 0), carpet: round(spectralCentroidHz(carpet.left, SR), 0) },
        t20S: { oak: round(schroederT20(oak.left, SR), 3), carpet: round(schroederT20(carpet.left, SR), 3) },
        share60to200: { oak: round(lowShare(oak.left), 3), deck: round(lowShare(deck.left), 3), reception: round(lowShare(reception.left), 3) },
        onsetsMs: onsetTimesMs(oak.left, SR),
        onsetSeconds: { oak: round(oak.onsetSeconds, 4), carpet: round(carpet.onsetSeconds, 4) },
        t20At1kS: {
          micStand: round(schroederT20(octaveBandpassSteep(stand.left, 1000, SR), SR), 3),
          chiavari: round(schroederT20(octaveBandpassSteep(oak.left, 1000, SR), SR), 3),
        },
        above14kShare: round(bandEnergy(oak.left, SR, 14000, SR / 2) / energy(oak.left), 6),
      };
    });
    const clicks = (
      [
        ["chiavari-chair", "oak-boards-joists"],
        ["chiavari-chair", "carpet"],
        ["staging-deck-6x4", "oak-boards-joists"],
        ["dancefloor-panel", "oak-boards-joists"],
      ] as const
    ).map(([slug, surface]) => {
      const seeds = Array.from({ length: 10 }, (_, i) => render(slug, surface, i + 1));
      return {
        slug,
        surface,
        above1kIn40msPct: seeds.map((r) => round(100 * clickShare(r.left, 40, 1000), 2)),
        above2kIn50msPct: seeds.map((r) => round(100 * clickShare(r.left, 50, 2000), 2)),
      };
    });
    const plays = (
      [
        ["chiavari-chair", "oak-boards-joists", 200],
        ["banquet-chair", "oak-boards-joists", 200],
        ["round-table-6ft-white", "oak-boards-joists", 200],
        ["trestle-6ft", "oak-boards-joists", 500],
        ["poseur-table", "oak-boards-joists", 500],
        ["staging-deck-6x4", "oak-boards-joists", 200],
        ["mic-stand", "carpet", 200],
        ["laptop", "table-top", 200],
      ] as const
    ).map(([slug, surface, seeds]) => ({ slug, surface, seeds, ...playsOver(slug, surface, seeds) }));
    const everyPiece = CRAFTED_FURNITURE_SLUGS.flatMap((slug) => (Object.keys(SURFACES) as SurfaceKind[]).map((surface) => render(slug, surface)));
    const catalogue = {
      renders: everyPiece.length,
      peakMinDb: round(Math.min(...everyPiece.map((r) => r.peakDb))),
      peakMaxDb: round(Math.max(...everyPiece.map((r) => r.peakDb))),
      ...limiting(everyPiece),
    };
    const surfaces = (Object.keys(SURFACES) as SurfaceKind[]).map((surface) => ({ surface, chiavariMedianRenderMs: round(timedMs("chiavari-chair", surface), 2) }));
    const figures = { pieces, features, clicks, plays, catalogue, surfaces };
    writeFileSync(join(OUT, "figures.json"), JSON.stringify(figures, null, 2));
    expect(pieces.length).toBe(CRAFTED_FURNITURE_SLUGS.length);
  }, 600_000);
});
