// A valid River Gate manifest for the stage's own tests: passes the gate and
// the fairness lint for scene 1's four worlds (hammermen, gardeners,
// tailors, cordiners). The planes are listed OUT of depth order on purpose
// so the ordering tests mean something. Synthetic throughout; the shipped
// scene-01-river-gate.ts is the art builder's.
import type { ReactElement } from "react";
import type { PlaneRegistry, SvgPlaneProps } from "../plane-registry.js";
import type { Provenance, SceneManifest, StageLight } from "../stage-manifest.js";

function procedural(source: string): Provenance {
  return {
    kind: "Pr",
    tool: "code (inline SVG)",
    prompt: source,
    licence: "Trades House of Glasgow, in-house",
    fetchedOn: "2026-09-06",
    touchedBy: "stage builder",
  };
}

function generated(prompt: string): Provenance {
  return {
    kind: "G",
    tool: "ElevenLabs sound-generation v1",
    prompt,
    licence: "ElevenLabs commercial",
    fetchedOn: "2026-09-06",
    touchedBy: "sound builder",
  };
}

function cue(id: string, caption: string, prompt: string): SceneManifest["audio"]["cues"][number] {
  return {
    id,
    file: `/trades-house-media/stage/${id}.mp3`,
    durationMs: 380,
    expectedSamples: null,
    gainDb: -3,
    bus: "sfx",
    caption,
    loop: false,
    provenance: generated(prompt),
  };
}

export const FIXTURE_MANIFEST: SceneManifest = {
  sceneIndex: 0,
  act: "I",
  quarterDay: "lammas",
  hue: "#e39b3a",
  frame: "prospect-map",
  planes: [
    { id: "foreground", kind: "svg", depth: 1, src: "river-foreground", bytes: 0, provenance: procedural("stage/art/river-foreground.tsx") },
    { id: "sky", kind: "svg", depth: 0, src: "river-sky", bytes: 0, provenance: procedural("stage/art/river-sky.tsx") },
    { id: "lantern", kind: "lantern", depth: 0.5, src: "river-gate", bytes: 0, provenance: procedural("lantern/presets/river-gate.glsl.ts") },
    { id: "skyline", kind: "svg", depth: 0.25, src: "river-skyline", bytes: 0, provenance: procedural("stage/art/river-skyline.tsx") },
  ],
  ink: { planeId: "foreground", segments: 900, bytes: 40_000 },
  lantern: "river-gate",
  audio: {
    cues: [
      cue("chain-swing", "[the chain knocks the post]", "a short chain clink against a wooden post, one hit, dry, close"),
      cue("water-plunk", "[a plunk]", "a single small stone dropped into still river water at night, close, no splash tail"),
      cue("lantern-gutter", "[a whoosh of flame]", "a lantern flame guttering in a gust, one short whoosh, close"),
      cue("rope-creak", "[a rope creaks]", "an old mooring rope creaking once under slow strain, close, dry"),
    ],
    bed: { water: 0.6, wind: 0.3, fire: 0, room: 0, voices: 0.15, night: 0 },
    oneShots: [{ cue: "rope-creak", everyMsMin: 20_000, everyMsMax: 40_000 }],
  },
  props: [
    {
      id: "port-chain",
      label: "The port chain",
      box: { x: 12, y: 62, w: 6, h: 22 },
      states: [
        {
          at: 1,
          spring: "camera",
          cue: "chain-swing",
          caption: "[the chain swings and knocks the post]",
          reducedMotion: { colorStep: "rgb(227 155 58 / 0.5)", caption: "[the chain hangs a little to one side]" },
        },
        {
          at: 3,
          spring: "camera",
          cue: "chain-swing",
          caption: "[the chain swings wider]",
          aside: "You are not the first to try that chain.",
          reducedMotion: { colorStep: "rgb(227 155 58 / 0.7)", caption: "[the chain hangs further over]" },
        },
      ],
      persistKey: "chainSwing",
    },
    {
      id: "water",
      label: "The water",
      box: { x: 0, y: 66, w: 100, h: 34 },
      states: [
        {
          at: 1,
          spring: "placementBounce",
          cue: "water-plunk",
          caption: "[a ring spreads on the water]",
          reducedMotion: { colorStep: "rgb(120 140 170 / 0.4)", caption: "[the water darkens where you touched it]" },
        },
      ],
    },
    {
      id: "lantern",
      label: "The lantern",
      box: { x: 47, y: 50, w: 4, h: 6 },
      states: [
        {
          at: 1,
          spring: "placementBounce",
          cue: "lantern-gutter",
          caption: "[the flame gutters, then rights itself]",
          reducedMotion: { colorStep: "rgb(227 155 58 / 0.3)", caption: "[the flame dims a moment]" },
        },
      ],
    },
    {
      id: "swallow",
      label: "The swallow",
      box: { x: 60, y: 8, w: 8, h: 6 },
      states: [
        {
          at: 1,
          spring: "camera",
          cue: null,
          caption: "[the swallow leaves]",
          reducedMotion: { colorStep: "rgb(232 220 194 / 0.2)", caption: "[the swallow is gone]" },
        },
        {
          at: "distinctProps:3",
          spring: "camera",
          cue: null,
          caption: "[the swallow comes back, once]",
          reducedMotion: { colorStep: "rgb(232 220 194 / 0.4)", caption: "[the swallow is back, once]" },
        },
      ],
    },
  ],
  thursday: null,
  latch: "The port, and the lantern beside it, and the chain.",
};

export const FIXTURE_LIGHTS: readonly StageLight[] = [
  { x: 0.3, y: 0.55, intensity: 0.2, warmth: 0.9 },
  { x: 0.49, y: 0.53, intensity: 1, warmth: 1 },
];

function plane(name: string): (props: SvgPlaneProps) => ReactElement {
  return function FixturePlane({ nowMs, viewportWidth, reducedMotion }: SvgPlaneProps): ReactElement {
    return (
      <svg
        viewBox="0 0 160 90"
        data-plane={name}
        data-now={String(Math.round(nowMs))}
        data-viewport={String(viewportWidth)}
        data-reduced={reducedMotion ? "true" : "false"}
      />
    );
  };
}

export const FIXTURE_REGISTRY: PlaneRegistry = {
  "river-sky": plane("river-sky"),
  "river-skyline": plane("river-skyline"),
  "river-foreground": plane("river-foreground"),
};
