import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CRAFTED_FURNITURE_SLUGS } from "../../../components/meshes/crafted/crafted-slugs.js";
import { computeBoundingBox, roomGeometries } from "../../../data/room-geometries.js";
import { bandEnergy, brightnessHz, kWeightedLoudness, octaveBandpassSteep, onsetTimesMs, schroederT20, spectralCentroidHz } from "../analysis.js";
import { earlyReflections, reflectionRoomFor, type Reflection } from "../reflections.js";
import { renderSetDown, type SetDownInput, type SetDownRender } from "../render.js";
import { ROOM_ACOUSTICS } from "../rooms.js";
import { SURFACES, floorKindForRoom, type SurfaceKind } from "../surfaces.js";
import { SR, clickShare, energy, inputFor, loudness, setDown } from "./set-down-kit.js";

// ---------------------------------------------------------------------------
// Renders for the ear and for independent analysis: never run in CI. Set
// SET_DOWN_WAV_DIR to a folder and run this file alone; it writes a handful
// of 48 kHz 16-bit stereo WAVs there (dry, centred, at full direct gain) with
// figures.json: each piece's peak, K-weighted loudness and length on the
// Grand Hall's oak, the figures the render tests compare, the click shares,
// play-to-play spreads over 200 seeds (500 for the bare poseur and the bare
// trestle), 2,200 plays in all, and how often the safety limiter above
// -6 dBFS holds a play, over those plays and the whole catalogue on every
// surface (ruling R42). Loudness is the renderer's (momentary, ruling R45),
// with Task 1's gated reading beside it; the rattling pieces' rattle is read
// against the same set-down without it (ruling R44).
//
// It also times every piece's render on this machine (ruling R52): the median
// and the longest of nine plays, dry and with the Grand Hall's early
// reflections as part 3 renders them, and holds the Chiavari's median with
// reflections under 15 ms. Timing depends on the machine and its load, so it
// is measured here and not in CI.
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

/** The Grand Hall's early reflections for a source 2 m off its centre and a listener 1.6 m up near it: the render test's old cost case, which part 3 renders as wired. */
function grandHallReflections(): readonly Reflection[] {
  const geometry = roomGeometries["Grand Hall"];
  if (geometry === undefined) throw new Error("no Grand Hall geometry");
  const box = computeBoundingBox(geometry.wallPolygon);
  const centre = { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
  return earlyReflections(
    reflectionRoomFor(ROOM_ACOUSTICS["grand-hall"], geometry),
    { x: centre.x + 2, y: 0, z: centre.z + 1 },
    { position: { x: centre.x - 1, y: 1.6, z: centre.z - 1 }, right: { x: 1, y: 0, z: 0 } },
  );
}

/** Plays timed per piece, after one untimed play. */
const TIMED_PLAYS = 9;

/** The median and the longest of TIMED_PLAYS renders of `input` over seeds 50 and on, in ms, after one untimed render. */
function timed(input: SetDownInput): { readonly medianMs: number; readonly maxMs: number } {
  renderSetDown(input);
  const times = Array.from({ length: TIMED_PLAYS }, (_, i) => {
    const start = performance.now();
    renderSetDown({ ...input, seed: 50 + i });
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return { medianMs: round(times[Math.floor(TIMED_PLAYS / 2)] ?? 0), maxMs: round(times[TIMED_PLAYS - 1] ?? 0) };
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
        gatedLoudnessDb: round(kWeightedLoudness(r.left, r.right, SR)),
        lengthMs: round((r.left.length / SR) * 1000, 0),
        brightnessHz: round(brightnessHz(r.left, SR), 0),
        above2kIn50msPct: round(100 * clickShare(r.left, 50, 2000), 2),
        limitDb: round(r.limitDb),
      };
    });
    // What a render costs on this machine, every piece on the Grand Hall's oak at half direct gain, off centre.
    const reflections = grandHallReflections();
    const cost = CRAFTED_FURNITURE_SLUGS.map((slug) => {
      const dry = inputFor(slug, "oak-boards-joists", { gain: 0.5, azimuthRad: 0.4 });
      return { slug, dry: timed(dry), withReflections: timed({ ...dry, reflections }) };
    });
    const costSummary = {
      reflections: reflections.length,
      timedPlays: TIMED_PLAYS,
      dryMedianMs: [round(Math.min(...cost.map((c) => c.dry.medianMs))), round(Math.max(...cost.map((c) => c.dry.medianMs)))],
      dryMaxMs: round(Math.max(...cost.map((c) => c.dry.maxMs))),
      withReflectionsMedianMs: [round(Math.min(...cost.map((c) => c.withReflections.medianMs))), round(Math.max(...cost.map((c) => c.withReflections.medianMs)))],
      withReflectionsMaxMs: round(Math.max(...cost.map((c) => c.withReflections.maxMs))),
    };
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
    const playTotals = {
      plays: plays.reduce((sum, p) => sum + p.seeds, 0),
      limited: plays.reduce((sum, p) => sum + p.limited, 0),
      largestLimitDb: round(Math.max(0, ...plays.map((p) => p.largestLimitDb))),
    };
    const everyPiece = CRAFTED_FURNITURE_SLUGS.flatMap((slug) => (Object.keys(SURFACES) as SurfaceKind[]).map((surface) => render(slug, surface)));
    const catalogue = {
      renders: everyPiece.length,
      peakMinDb: round(Math.min(...everyPiece.map((r) => r.peakDb))),
      peakMaxDb: round(Math.max(...everyPiece.map((r) => r.peakDb))),
      ...limiting(everyPiece),
    };
    const surfaces = (Object.keys(SURFACES) as SurfaceKind[]).map((surface) => ({ surface, chiavari: timed(inputFor("chiavari-chair", surface)) }));
    const rattleBand = (r: SetDownRender): number => bandEnergy(r.left.subarray(Math.round(0.035 * SR), Math.round(0.07 * SR)), SR, 1000, 3200);
    const rattles = ["mic-stand", "round-table-6ft-white", "trestle-6ft", "projector-screen"].map((slug) => {
      const rise = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => {
        const input = inputFor(slug, "oak-boards-joists", { seed });
        return round(10 * Math.log10(rattleBand(renderSetDown(input)) / rattleBand(renderSetDown({ ...input, body: { ...input.body, legRattle: false } }))));
      });
      const t20At1kS = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => round(schroederT20(octaveBandpassSteep(render(slug, "oak-boards-joists", seed).left, 1000, SR), SR), 3));
      return { slug, riseDbIn1To3kAt35To70ms: rise, t20At1kS };
    });
    const figures = { pieces, cost, costSummary, features, clicks, plays, playTotals, catalogue, rattles, surfaces };
    writeFileSync(join(OUT, "figures.json"), JSON.stringify(figures, null, 2));
    expect(pieces.length).toBe(CRAFTED_FURNITURE_SLUGS.length);
    expect(playTotals.plays).toBe(2200);
    // The Chiavari in the Grand Hall with its reflections, on this machine (moved here from render.test.ts, ruling R52).
    expect(cost.find((c) => c.slug === "chiavari-chair")?.withReflections.medianMs ?? Number.POSITIVE_INFINITY).toBeLessThan(15);
  }, 900_000);
});
