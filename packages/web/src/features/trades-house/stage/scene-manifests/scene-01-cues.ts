// -----------------------------------------------------------------------------
// scene-01-cues — the River Gate's cue table: every sound the scene can make,
// generated on 2026-09-06 with ElevenLabs sound generation (provenance kind
// "G", the exact prompt on every card) under the owner's override of that day.
//
// What the files are, so the engine can trust the numbers here: each take was
// decoded, summed to mono, the one-shots trimmed so the transient lands 5 ms
// into the file and the tail ends in a short fade, peak-normalised to -12 dBFS
// (the beds to -3 dBFS, untrimmed so the model's loop seam survives), and
// re-encoded with LAME 3.100 as mono 44.1 kHz MP3 behind a hand-written
// Xing/Info + LAME frame carrying the encoder delay (576) and padding, so a
// gapless-aware decoder returns exactly `expectedSamples` frames. `durationMs`
// and `expectedSamples` are the PCM counts fed to the encoder, checked against
// two decoders. The full record, prompts, takes and measurements are in
// public/trades-house-media/stage/scene-01/README.md.
//
// Fairness lint: no cue id, file name or caption carries a word from the scene's
// four worlds (hammermen, gardeners, tailors, cordiners) or a Craft name; the
// prompts may describe materials freely and are not shown to the reader.
// -----------------------------------------------------------------------------
import type { BedMix, Cue, OneShot, Provenance } from "../stage-manifest.js";

const BASE = "/trades-house-media/stage/scene-01/";

function file(id: string): string {
  return `${BASE}${id}.mp3`;
}

function generated(prompt: string): Provenance {
  return {
    kind: "G",
    tool: "ElevenLabs sound-generation v1",
    prompt,
    licence: "ElevenLabs commercial licence under the account's plan",
    fetchedOn: "2026-09-06",
    touchedBy: "the assembling session",
  };
}

export const SCENE_01_CUES: readonly Cue[] = [
  // The ceremony's four "ui" cues: press, commit, continue, reply.
  {
    id: "paper-touch",
    file: file("paper-touch"),
    durationMs: 366,
    expectedSamples: 16126,
    gainDb: -6,
    bus: "ui",
    caption: "[a fingertip on the paper]",
    loop: false,
    provenance: generated(
      "A single fingertip lightly touching thick handmade paper, one soft dry tap, close-miked, no room reverb, silence after.",
    ),
  },
  {
    id: "seal-strike",
    file: file("seal-strike"),
    durationMs: 513,
    expectedSamples: 22631,
    gainDb: -6,
    bus: "ui",
    caption: "[the seal strikes the wax]",
    loop: false,
    provenance: generated(
      "A brass seal pressed firmly into warm soft sealing wax on a wooden desk, one soft heavy thud with a faint waxy squash, close, dry, no ringing.",
    ),
  },
  {
    id: "page-turn",
    file: file("page-turn"),
    durationMs: 682,
    expectedSamples: 30095,
    gainDb: -6,
    bus: "ui",
    caption: "[the page turns]",
    loop: false,
    provenance: generated(
      "One page of heavy laid paper turned in a large old ledger, a single dry rustle and settle, close, quiet room, silence after.",
    ),
  },
  {
    id: "quill",
    file: file("quill"),
    durationMs: 1485,
    expectedSamples: 65488,
    gainDb: -6,
    bus: "ui",
    caption: "[a quill on the paper]",
    loop: false,
    provenance: generated(
      "A quill nib writing a short line on thick paper, fine scratching strokes with one small pause, close-miked, dry, no music.",
    ),
  },
  // The six pokeables' material cues, at 0 dB on the sfx bus.
  {
    id: "chain-swing",
    file: file("chain-swing"),
    durationMs: 1205,
    expectedSamples: 53139,
    gainDb: 0,
    bus: "sfx",
    caption: "[the chain swings against the post]",
    loop: false,
    provenance: generated(
      "A heavy chain of links swinging once and knocking against a wooden post, a dull clink and the links settling, outdoors by water at night, no ringing clang.",
    ),
  },
  {
    id: "water-plunk",
    file: file("water-plunk"),
    durationMs: 805,
    expectedSamples: 35500,
    gainDb: 0,
    bus: "sfx",
    caption: "[a stone drops into the river]",
    loop: false,
    provenance: generated(
      "A small stone dropped into a slow wide river, one deep hollow plunk with a soft splash, quiet evening, no other sounds.",
    ),
  },
  {
    id: "lantern-gutter",
    file: file("lantern-gutter"),
    durationMs: 805,
    expectedSamples: 35498,
    gainDb: 0,
    bus: "sfx",
    caption: "[the lantern flame gutters]",
    loop: false,
    provenance: generated(
      "An oil lantern flame guttering in a sudden gust of wind, a short soft whoosh and flutter of flame, then steadying, close, quiet.",
    ),
  },
  {
    id: "swallow-wings",
    file: file("swallow-wings"),
    durationMs: 685,
    expectedSamples: 30219,
    gainDb: 0,
    bus: "sfx",
    caption: "[the swallow takes off]",
    loop: false,
    provenance: generated(
      "A single small bird bursting off a wooden post into flight, a quick sharp flutter of small wings, four rapid beats, close-miked, clear and present, quiet dusk, no chirping.",
    ),
  },
  {
    id: "toll-lid",
    file: file("toll-lid"),
    durationMs: 605,
    expectedSamples: 26677,
    gainDb: 0,
    bus: "sfx",
    caption: "[the toll box lid creaks open]",
    loop: false,
    provenance: generated(
      "Old wooden chest lid creaking open, hinge creak, short, close-miked, dry, then silence.",
    ),
  },
  {
    id: "toll-coin",
    file: file("toll-coin"),
    durationMs: 324,
    expectedSamples: 14286,
    gainDb: 0,
    bus: "sfx",
    caption: "[a coin drops into the toll box]",
    loop: false,
    provenance: generated(
      "One coin dropped into a small wooden box, a single short clink on wood, close, dry, silence after.",
    ),
  },
  {
    id: "toll-coins",
    file: file("toll-coins"),
    durationMs: 885,
    expectedSamples: 39028,
    gainDb: 0,
    bus: "sfx",
    caption: "[a handful of coins into the toll box]",
    loop: false,
    provenance: generated(
      "A handful of coins poured into a small wooden box, a brief tumble of clinks against wood, close, dry.",
    ),
  },
  {
    id: "toll-bolt",
    file: file("toll-bolt"),
    durationMs: 685,
    expectedSamples: 30193,
    gainDb: 0,
    bus: "sfx",
    caption: "[the bolt slides shut]",
    loop: false,
    provenance: generated(
      "A small bolt on a wooden box sliding shut, one short scrape and a firm click, close, dry.",
    ),
  },
  {
    id: "apple-turn",
    file: file("apple-turn"),
    durationMs: 485,
    expectedSamples: 21376,
    gainDb: 0,
    bus: "sfx",
    caption: "[the apple core turns in the water]",
    loop: false,
    provenance: generated(
      "Something small turning over in still water beside a wooden jetty, a single soft lap and gurgle, very quiet, close.",
    ),
  },
  // The scheduled one-shots (Appendix D): a rope creak every 20 to 40 s, gulls
  // at most twice a minute, and the far bell once at scene entry.
  {
    id: "rope-creak",
    file: file("rope-creak"),
    durationMs: 2005,
    expectedSamples: 88417,
    gainDb: -6,
    bus: "sfx",
    caption: "[a mooring rope creaks]",
    loop: false,
    provenance: generated(
      "A thick wet mooring rope creaking slowly once as a boat pulls against a wooden jetty, one long low creak that eases off and stops, then quiet evening water, outdoors.",
    ),
  },
  {
    id: "gull",
    file: file("gull"),
    durationMs: 1205,
    expectedSamples: 53140,
    gainDb: -10,
    bus: "sfx",
    caption: "[a gull, far off]",
    loop: false,
    provenance: generated(
      "One distant gull calling twice over a wide river at dusk, far away, soft, with faint open air, no other birds.",
    ),
  },
  {
    id: "far-bell",
    file: file("far-bell"),
    durationMs: 2874,
    expectedSamples: 126742,
    gainDb: -8,
    bus: "sfx",
    caption: "[a far bell, one strike]",
    loop: false,
    provenance: generated(
      "A distant church bell, one single strike, heard across a river on a still evening, soft and far, with a long fading decay, no other sounds.",
    ),
  },
  // The three beds, generated with the model's loop mode, 20 s each.
  {
    id: "bed-water",
    file: file("bed-water"),
    durationMs: 20000,
    expectedSamples: 882000,
    gainDb: -12,
    bus: "ambience",
    caption: "[the river, wide and slow]",
    loop: true,
    provenance: generated(
      "A slow wide river at dusk heard from mid-distance, a steady gentle flow and soft lapping against a stone bank, calm, no rain, no wind, no birds, seamless ambience loop.",
    ),
  },
  {
    id: "bed-wind",
    file: file("bed-wind"),
    durationMs: 20000,
    expectedSamples: 882000,
    gainDb: -12,
    bus: "ambience",
    caption: "[wind over the estuary wall]",
    loop: true,
    provenance: generated(
      "Wind blowing steadily across a stone sea wall at night, recorded close, loud and full, a deep continuous rush of air with slow surges, no whistling, no rain, no water, no birds, seamless ambience loop.",
    ),
  },
  {
    id: "bed-voices",
    file: file("bed-voices"),
    durationMs: 20000,
    expectedSamples: 882000,
    gainDb: -12,
    bus: "ambience",
    caption: "[a far murmur of the town]",
    loop: true,
    provenance: generated(
      "A distant market crowd murmuring across water on a summer evening, many soft voices blended together with no intelligible words, no music, no bells, seamless ambience loop.",
    ),
  },
];

/** Appendix D, scene 1: water 0.6, wind 0.3, voices 0.15; fire, room and night silent. */
export const SCENE_01_BED: BedMix = { water: 0.6, wind: 0.3, fire: 0, room: 0, voices: 0.15, night: 0 };

/** Appendix D, scene 1: a rope creak every 20 to 40 s; gulls at most twice a minute. The far bell is played once at scene entry by the stage, not scheduled. */
export const SCENE_01_ONE_SHOTS: readonly OneShot[] = [
  { cue: "rope-creak", everyMsMin: 20_000, everyMsMax: 40_000 },
  { cue: "gull", everyMsMin: 30_000, everyMsMax: 60_000 },
];
