import { beforeAll, describe, expect, it } from "vitest";
import { CRAFTED_FURNITURE_SLUGS } from "../../../components/meshes/crafted/crafted-slugs.js";
import { PLANNER_TOUCH_DB } from "../../planner-sound-recipes.js";
import { seededRandom } from "../../planner-sound-render.js";
import { bandEnergy, brightnessHz, octaveBandpassSteep, onsetTimesMs, schroederT20 } from "../analysis.js";
import { bodyFor, type BodyPart, type PartKind } from "../bodies.js";
import { LOSS, contactSeconds, knockSeconds, partModes, surfaceModes } from "../modes.js";
import type { Reflection } from "../reflections.js";
import { SET_DOWN_TOUCH_DB, SET_DOWN_TOUCH_LOUDNESS_DB, footSchedule, renderSetDown, type SetDownInput, type SetDownRender } from "../render.js";
import { SURFACES, floorKindForRoom, surfaceResponse, type SurfaceKind, type SurfaceResponse } from "../surfaces.js";
import { SR, clickShare, energy, inputFor, loudness, sameSamples, setDown } from "./set-down-kit.js";

/** Every surface a piece can stand on (ruling R7), each resolved for the Grand Hall. */
const SURFACE_KINDS: readonly SurfaceKind[] = [
  "oak-boards-joists",
  "oak-parquet",
  "timber-on-slab",
  "carpet",
  "stage-deck",
  "dance-floor",
  "table-top",
];

const COMMON_PIECES = ["chiavari-chair", "banquet-chair", "round-table-6ft-white", "trestle-6ft", "poseur-table"] as const;

const SEEDS = [1, 2, 3, 4, 5] as const;
const TEN_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

function peakOf(render: SetDownRender): number {
  let peak = 0;
  for (const channel of [render.left, render.right]) {
    for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  }
  return 20 * Math.log10(peak);
}

/**
 * Silence reads 0 Hz, 0 s and -120 dB, so a one-sided comparison would pass
 * on a broken render: every render compared is first held to be sounding.
 */
function expectSounding(render: SetDownRender): void {
  expect(render.left.length).toBeGreaterThan(0);
  expect(peakOf(render)).toBeGreaterThan(-40);
}

function lowShare(samples: Float32Array): number {
  return bandEnergy(samples, SR, 60, 200) / energy(samples);
}

function spread(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

describe("the anchor level", () => {
  it("is the palette's touch level, -22 dBFS", () => {
    expect(PLANNER_TOUCH_DB).toBe(-22);
    expect(SET_DOWN_TOUCH_DB).toBe(PLANNER_TOUCH_DB);
  });
});

describe("loss factors and modes", () => {
  const random = seededRandom(7);
  const parts: readonly BodyPart[] = (Object.keys(LOSS) as PartKind[]).map((kind) => ({ kind, lengthM: 0.6, thicknessM: 0.02, share: 1 }));

  it.each(parts.map((part) => ({ part, kind: part.kind })))("rings each $kind mode for 2.2 / (f eta(f))", ({ part }) => {
    const modes = partModes(part, random);
    expect(modes.length).toBeGreaterThan(0);
    const { eta, viscous } = LOSS[part.kind];
    for (const mode of modes) {
      expect(Number.isFinite(mode.hz) && mode.hz > 0 && mode.hz < 20000).toBe(true);
      expect(Number.isFinite(mode.gain) && mode.gain >= 0).toBe(true);
      expect(mode.t60).toBeCloseTo(2.2 / (mode.hz * eta * (1 + (viscous * mode.hz) / 1000)), 9);
    }
  });

  it("rings steel and aluminium longer than wood at every frequency", () => {
    for (const hz of [125, 500, 2000, 8000]) {
      const t60 = (kind: PartKind): number => 2.2 / (hz * LOSS[kind].eta * (1 + (LOSS[kind].viscous * hz) / 1000));
      expect(t60("steel-tube-frame")).toBeGreaterThan(5 * t60("beech-frame"));
      expect(t60("aluminium-frame")).toBeGreaterThan(5 * t60("ply-top"));
      expect(t60("upholstery")).toBeLessThan(t60("mdf-top"));
    }
  });

  it("puts a frame's first mode where the beam formula does: 25 mm beech at 0.45 m near 530 Hz", () => {
    const modes = partModes({ kind: "beech-frame", lengthM: 0.45, thicknessM: 0.025, share: 1 }, seededRandom(1));
    const lowest = Math.min(...modes.map((mode) => mode.hz));
    expect(lowest).toBeGreaterThan(529 * 0.98);
    expect(lowest).toBeLessThan(529 * 1.02);
  });

  it("keeps a piece's own modes from play to play: two plays put each mode within 3.1 % of the other", () => {
    const part: BodyPart = { kind: "mdf-top", lengthM: 1.83, thicknessM: 0.025, share: 0.7 };
    const a = partModes(part, seededRandom(1));
    const b = partModes(part, seededRandom(2));
    expect(a.length).toBe(b.length);
    a.forEach((mode, i) => {
      const other = b[i];
      expect(other).toBeDefined();
      if (other !== undefined) expect(Math.abs(other.hz / mode.hz - 1)).toBeLessThan(0.031);
    });
  });

  it("spreads a board bank over its range and adds the joists' thump", () => {
    const modes = surfaceModes(SURFACES["oak-boards-joists"], seededRandom(3));
    const boards = modes.filter((mode) => mode.hz > 100);
    expect(boards.length).toBe(24);
    for (const mode of boards) {
      expect(mode.hz).toBeGreaterThanOrEqual(150 * 0.985);
      expect(mode.hz).toBeLessThanOrEqual(300 * 1.015);
      expect(mode.t60).toBeCloseTo(2.2 / (mode.hz * 0.07), 9);
    }
    const thump = modes.filter((mode) => mode.hz < 100);
    expect(thump.length).toBe(1);
    const joist = thump[0];
    // A damping ratio of 0.03 is a loss factor of 0.06 (eta = 2 zeta).
    if (joist !== undefined) expect(joist.t60).toBeCloseTo(2.2 / (joist.hz * 2 * 0.03), 9);
  });

  it("hears only the floor beneath a carpet, 18 dB down", () => {
    const carpet = surfaceModes(surfaceResponse("carpet", "north-gallery"), seededRandom(3));
    const oak = surfaceModes(SURFACES["oak-boards-joists"], seededRandom(3)).filter((mode) => mode.hz > 100);
    expect(carpet.length).toBe(24);
    const level = (modes: readonly { readonly gain: number }[]): number => 10 * Math.log10(modes.reduce((sum, mode) => sum + mode.gain ** 2, 0));
    expect(level(carpet) - level(oak)).toBeCloseTo(-18, 0);
  });

  it("gives a stage deck its hollow as well as its boards", () => {
    const modes = surfaceModes(SURFACES["stage-deck"], seededRandom(3));
    expect(modes.filter((mode) => mode.hz < 170).length).toBe(10);
    expect(modes.length).toBe(28);
  });
});

describe("contact times", () => {
  const oak = SURFACES["oak-boards-joists"];

  it("strikes a nylon glide on oak for about 2.4 ms at 1.25 kg and 0.3 m/s, and steel for about 2 ms", () => {
    expect(contactSeconds("glide", oak, 1.25, 0.3)).toBeGreaterThan(0.0022);
    expect(contactSeconds("glide", oak, 1.25, 0.3)).toBeLessThan(0.0027);
    expect(contactSeconds("steel", oak, 1.25, 0.3)).toBeGreaterThan(0.0019);
    expect(contactSeconds("steel", oak, 1.25, 0.3)).toBeLessThan(0.0023);
  });

  it("follows Hertz: longer for more mass, shorter for more speed", () => {
    const base = contactSeconds("steel", oak, 2, 0.5);
    expect(contactSeconds("steel", oak, 4, 0.5) / base).toBeCloseTo(2 ** 0.4, 6);
    expect(contactSeconds("steel", oak, 2, 1) / base).toBeCloseTo(2 ** -0.2, 6);
  });

  it("strikes the same timber face on a slab as on joists: a hard contact's stress never reaches the slab (ruling R47)", () => {
    // The slab is heard in its own board bank and in having no joists to heave (the low-body test below), not in its contact.
    const slab = SURFACES["timber-on-slab"];
    for (const cap of ["glide", "steel", "panel-edge"] as const) {
      for (const [mass, speed] of [[0.25, 0.3], [1.25, 1], [5, 2]] as const) {
        expect(contactSeconds(cap, slab, mass, speed), `${cap} ${String(mass)} kg ${String(speed)} m/s`).toBe(contactSeconds(cap, oak, mass, speed));
      }
      expect(knockSeconds(cap, slab, 1), cap).toBe(knockSeconds(cap, oak, 1));
    }
  });

  it("springs a rubber foot for pi root(m / k), holds felt at 12 ms and every foot on carpet at 45 ms", () => {
    expect(contactSeconds("rubber", oak, 1, 1)).toBeCloseTo(Math.PI * Math.sqrt(1 / 1.1e6), 9);
    expect(contactSeconds("castor", oak, 4, 2)).toBeCloseTo(Math.PI * Math.sqrt(4 / 1.1e6), 9);
    expect(contactSeconds("felt", oak, 1, 1)).toBeCloseTo(0.012, 9);
    for (const cap of ["glide", "steel", "rubber", "felt", "castor", "panel-edge"] as const) {
      expect(contactSeconds(cap, SURFACES.carpet, 1, 1)).toBeCloseTo(0.045, 9);
    }
  });

  it("never returns a time that is not a positive number", () => {
    for (const mass of [0, -1, Number.NaN, 1e9]) {
      for (const speed of [0, -1, Number.NaN, 1e9]) {
        const t = contactSeconds("glide", oak, mass, speed);
        expect(Number.isFinite(t) && t > 0).toBe(true);
      }
    }
  });

  it("knocks a glide on oak at 1 m/s for under half a millisecond, and a soft cap not at all (ruling R34)", () => {
    expect(knockSeconds("glide", oak, 1)).toBeLessThan(0.0005);
    expect(knockSeconds("steel", oak, 1)).toBeLessThan(0.0005);
    expect(knockSeconds("panel-edge", oak, 1)).toBeLessThan(0.001);
    for (const cap of ["rubber", "felt", "castor"] as const) expect(knockSeconds(cap, oak, 1)).toBeNull();
  });
});

describe("every crafted piece on every surface", () => {
  it.each(CRAFTED_FURNITURE_SLUGS)("renders %s: finite, unclipped, in band and unlimited, under 14 kHz and the same for the same seed", (slug) => {
    for (const kind of SURFACE_KINDS) {
      const render = setDown(slug, kind);
      const again = setDown(slug, kind);
      expect(render.sampleRate).toBe(SR);
      expect(render.right.length).toBe(render.left.length);
      let finite = true;
      let clipped = false;
      for (const channel of [render.left, render.right]) {
        for (const sample of channel) {
          if (!Number.isFinite(sample)) finite = false;
          if (Math.abs(sample) >= 1) clipped = true;
        }
      }
      expect(finite, `${slug} on ${kind}`).toBe(true);
      expect(clipped, `${slug} on ${kind}`).toBe(false);
      expect(render.peakDb, `${slug} on ${kind}`).toBeGreaterThanOrEqual(-32);
      expect(render.peakDb, `${slug} on ${kind}`).toBeLessThanOrEqual(-6);
      // The safety limiter holds no catalogue play: each lands in the window on the level rule alone (ruling R42).
      expect(render.limitDb, `${slug} on ${kind}`).toBe(0);
      // Centred with no reflections, both channels are the mono source the peak is read from.
      expect(render.peakDb).toBeCloseTo(peakOf(render), 4);
      const above = bandEnergy(render.left, SR, 14000, SR / 2) / energy(render.left);
      expect(above, `${slug} on ${kind}`).toBeLessThan(0.005);
      // Bit for bit, compared as bytes (ruling R52).
      expect(sameSamples(again.left, render.left), `${slug} on ${kind}`).toBe(true);
      expect(sameSamples(again.right, render.right), `${slug} on ${kind}`).toBe(true);
    }
  });
});

describe("what each surface does to a Chiavari", () => {
  it.each(SEEDS)("is duller and shorter on carpet than on oak boards (seed %i)", (seed) => {
    const oak = setDown("chiavari-chair", "oak-boards-joists", { seed });
    const carpet = setDown("chiavari-chair", "carpet", { seed });
    expectSounding(oak);
    expectSounding(carpet);
    const oakCentroid = brightnessHz(oak.left, SR);
    expect(oakCentroid).toBeGreaterThan(0);
    expect(brightnessHz(carpet.left, SR)).toBeLessThan(0.5 * oakCentroid);
    const carpetT20 = schroederT20(carpet.left, SR);
    expect(carpetT20).toBeGreaterThan(0);
    expect(carpetT20).toBeLessThan(schroederT20(oak.left, SR));
  });

  it.each(TEN_SEEDS)("clicks on oak, 2-25 % of its first 50 ms above 2 kHz, and barely at all on carpet (seed %i, ruling R34)", (seed) => {
    const oak = setDown("chiavari-chair", "oak-boards-joists", { seed });
    const carpet = setDown("chiavari-chair", "carpet", { seed });
    expectSounding(oak);
    expectSounding(carpet);
    const click = clickShare(oak.left, 50, 2000);
    expect(click).toBeGreaterThanOrEqual(0.02);
    expect(click).toBeLessThanOrEqual(0.25);
    expect(clickShare(carpet.left, 50, 2000)).toBeLessThanOrEqual(click / 10);
  });

  it.each(SEEDS)("booms more from a stage deck than from the floor, 60-200 Hz (seed %i)", (seed) => {
    const oak = setDown("chiavari-chair", "oak-boards-joists", { seed });
    const deck = setDown("chiavari-chair", "stage-deck", { seed });
    expectSounding(oak);
    expectSounding(deck);
    expect(lowShare(oak.left)).toBeGreaterThan(0);
    expect(lowShare(deck.left)).toBeGreaterThan(1.5 * lowShare(oak.left));
  });

  it.each(SEEDS)("has less low body on the Reception Room's slab than on the Grand Hall's boards (seed %i)", (seed) => {
    const hall = setDown("chiavari-chair", floorKindForRoom("grand-hall"), { seed, room: "grand-hall" });
    const reception = setDown("chiavari-chair", floorKindForRoom("reception-room"), { seed, room: "reception-room" });
    expectSounding(hall);
    expectSounding(reception);
    expect(lowShare(reception.left)).toBeLessThan(0.7 * lowShare(hall.left));
  });

  it("is heard from its first contact, and nothing after its first 50 ms is louder than its landing (seeds 1-100, ruling R43)", () => {
    const head = Math.round(0.05 * SR);
    for (let seed = 1; seed <= 100; seed += 1) {
      const render = setDown("chiavari-chair", "oak-boards-joists", { seed });
      expect(onsetTimesMs(render.left, SR)[0], `seed ${String(seed)}`).toBe(0);
      let landing = 0;
      let after = 0;
      render.left.forEach((sample, i) => {
        if (i < head) landing = Math.max(landing, Math.abs(sample));
        else after = Math.max(after, Math.abs(sample));
      });
      expect(after, `seed ${String(seed)}`).toBeLessThan(landing);
    }
  });
});

describe("a surface's high cut and hardness, as they reach the render (ruling R52)", () => {
  const oak = SURFACES["oak-boards-joists"];
  /** `slug` set down on oak with `patch` applied to the surface under every foot. */
  const onOak = (slug: string, patch: Partial<SurfaceResponse>, seed: number): SetDownRender => {
    const input = inputFor(slug, "oak-boards-joists", { seed });
    const surface: SurfaceResponse = { ...oak, ...patch };
    return renderSetDown({ ...input, surfaces: input.surfaces.map(() => surface) });
  };
  /** The 4 kHz octave's energy once the landing is over (from 60 ms), where only the modes still ring. */
  const ringAt4k = (render: SetDownRender): number => energy(octaveBandpassSteep(render.left, 4000, SR).subarray(Math.round(0.06 * SR)));
  /** How long the 1 kHz octave rings. */
  const ringAt1k = (render: SetDownRender): number => schroederT20(octaveBandpassSteep(render.left, 1000, SR), SR);

  // The cut weights the modes, not the struck spot's click or the knocks: those own everything above 2.5 kHz in
  // a hard landing's first 50 ms (a Chiavari's share there moves by under 8 % with the cut), so it is read once the
  // click is over, where a banquet chair's steel frame still rings at 3-6 kHz. Carpet's own 2.5 kHz cut does almost
  // nothing: its 45 ms contact leaves nothing that high to cut (the energy above 2.5 kHz moves by under 2 %).
  it.each(SEEDS)("takes the top off a piece's ring under a 2.5 kHz high cut: a banquet chair's 4 kHz octave after its landing falls below half of oak's (seed %i)", (seed) => {
    const open = onOak("banquet-chair", {}, seed);
    const cut = onOak("banquet-chair", { highCutHz: 2500 }, seed);
    expect(ringAt4k(open)).toBeGreaterThan(0);
    expect(ringAt4k(cut)).toBeLessThan(0.5 * ringAt4k(open));
  });

  it.each(SEEDS)("dulls and damps a landing on a softer surface: at hardness 0.3 a Chiavari clicks under a quarter as much and is darker, and a round table's 1 kHz rings under 0.6 of its time (seed %i)", (seed) => {
    const hard = onOak("chiavari-chair", {}, seed);
    const soft = onOak("chiavari-chair", { hardness: 0.3 }, seed);
    expectSounding(soft);
    expect(clickShare(soft.left, 50, 2000)).toBeLessThan(0.25 * clickShare(hard.left, 50, 2000));
    expect(brightnessHz(soft.left, SR)).toBeLessThan(0.8 * brightnessHz(hard.left, SR));
    const round = ringAt1k(onOak("round-table-6ft-white", {}, seed));
    expect(round).toBeGreaterThan(0);
    expect(ringAt1k(onOak("round-table-6ft-white", { hardness: 0.3 }, seed))).toBeLessThan(0.6 * round);
  });
});

describe("when the feet meet the floor (ruling R43)", () => {
  it("lands every crafted piece's feet as 2-4 groups over 5-35 ms, or 3-15 ms over 15 kg, the first at once (seeds 1-100)", () => {
    for (const slug of CRAFTED_FURNITURE_SLUGS) {
      const body = bodyFor(slug);
      const [low, high] = body.massKg > 15 ? [0.003, 0.015] : [0.005, 0.035];
      for (let seed = 1; seed <= 100; seed += 1) {
        const { landings, groups } = footSchedule(body, seed, 1);
        const at = `${slug} seed ${String(seed)}`;
        expect(landings.length, at).toBe(Math.max(1, body.feet.length));
        expect(landings.reduce((sum, landing) => sum + landing.share, 0), at).toBeCloseTo(1, 9);
        expect(groups[0]?.time, at).toBe(0);
        if (body.feet.length < 2) {
          expect(groups.length, at).toBe(1);
          continue;
        }
        expect(groups.length, at).toBeGreaterThanOrEqual(2);
        expect(groups.length, at).toBeLessThanOrEqual(4);
        const span = groups[groups.length - 1]?.time ?? 0;
        expect(span, at).toBeGreaterThanOrEqual(low);
        expect(span, at).toBeLessThanOrEqual(high);
      }
    }
  });

  it("is the same schedule for the same seed at any speed, and another for another seed", () => {
    const body = bodyFor("chiavari-chair");
    expect(footSchedule(body, 7, 0.5)).toEqual(footSchedule(body, 7, 2));
    expect(footSchedule(body, 8, 1)).not.toEqual(footSchedule(body, 7, 1));
  });
});

describe("what each piece is made of", () => {
  /** The energy in 1-3.2 kHz over 35-70 ms, where the legs rattle. */
  const rattleBand = (render: SetDownRender): number => bandEnergy(render.left.subarray(Math.round(0.035 * SR), Math.round(0.07 * SR)), SR, 1000, 3200);

  /** How far the rattle lifts 1-3.2 kHz over 35-70 ms, in dB, against the same set-down without it. */
  const rattleRise = (slug: string, seed: number): number => {
    const input = inputFor(slug, "oak-boards-joists", { seed });
    expect(input.body.legRattle).toBe(true);
    const rattling = renderSetDown(input);
    const still = renderSetDown({ ...input, body: { ...input.body, legRattle: false } });
    return 10 * Math.log10(rattleBand(rattling) / rattleBand(still));
  };

  it.each(["mic-stand", "round-table-6ft-white", "trestle-6ft"])("rattles %s's folding legs at least 6 dB over the same set-down without them, seeds 1-8 (ruling R44)", (slug) => {
    for (let seed = 1; seed <= 8; seed += 1) expect(rattleRise(slug, seed), `seed ${String(seed)}`).toBeGreaterThanOrEqual(6);
  });

  it("rattles the projector screen's legs by a median of 6 dB and every seed by 3 dB, seeds 1-8 (ruling R69)", () => {
    const rises = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => rattleRise("projector-screen", seed));
    for (const [i, rise] of rises.entries()) expect(rise, `seed ${String(i + 1)}`).toBeGreaterThanOrEqual(3);
    expect(median(rises)).toBeGreaterThanOrEqual(6);
  });

  it("rings a steel mic stand at 1 kHz for 0.2 s and more, seeds 1-8 (ruling R44)", () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const stand = setDown("mic-stand", "oak-boards-joists", { seed });
      expect(schroederT20(octaveBandpassSteep(stand.left, 1000, SR), SR), `seed ${String(seed)}`).toBeGreaterThanOrEqual(0.2);
    }
  });

  it.each(SEEDS)("rings a steel mic stand at 1 kHz for more than twice as long as a beech chair (seed %i)", (seed) => {
    const stand = setDown("mic-stand", "oak-boards-joists", { seed });
    const chair = setDown("chiavari-chair", "oak-boards-joists", { seed });
    expectSounding(stand);
    expectSounding(chair);
    const chairT20 = schroederT20(octaveBandpassSteep(chair.left, 1000, SR), SR);
    expect(chairT20).toBeGreaterThan(0);
    expect(schroederT20(octaveBandpassSteep(stand.left, 1000, SR), SR)).toBeGreaterThan(2 * chairT20);
  });

  it.each(TEN_SEEDS)("knocks a staging deck's and a dance-floor panel's corners on oak too (seed %i, ruling R34)", (seed) => {
    for (const slug of ["staging-deck-6x4", "dancefloor-panel"]) {
      const render = setDown(slug, "oak-boards-joists", { seed });
      expectSounding(render);
      expect(clickShare(render.left, 50, 2000), slug).toBeGreaterThanOrEqual(0.02);
    }
  });
});

describe("levels", () => {
  const oakLoudness = new Map<string, number>();
  beforeAll(() => {
    for (const slug of CRAFTED_FURNITURE_SLUGS) oakLoudness.set(slug, loudness(setDown(slug, "oak-boards-joists")));
  }, 120_000);

  it("keeps every crafted piece on oak boards within 8 dB of K-weighted loudness", () => {
    expect(oakLoudness.size).toBe(CRAFTED_FURNITURE_SLUGS.length);
    expect(spread([...oakLoudness.values()])).toBeLessThanOrEqual(8);
  });

  it("keeps the common pieces within 4 dB of each other", () => {
    expect(spread(COMMON_PIECES.map((slug) => oakLoudness.get(slug) ?? Number.NaN))).toBeLessThanOrEqual(4);
  });

  const PLAYS: readonly (readonly [string, SurfaceKind])[] = [
    ...COMMON_PIECES.map((slug) => [slug, "oak-boards-joists"] as const),
    ["staging-deck-6x4", "oak-boards-joists"],
    ["mic-stand", "carpet"],
    ["laptop", "table-top"],
  ];
  const plays = new Map<string, readonly number[]>();
  beforeAll(() => {
    for (const [slug, kind] of PLAYS) plays.set(`${slug} ${kind}`, Array.from({ length: 200 }, (_, i) => loudness(setDown(slug, kind, { seed: 1000 + i }))));
  }, 300_000);

  it.each(PLAYS)("plays %s on %s within 3 dB of itself across 200 seeds (ruling R36)", (slug, kind) => {
    const values = plays.get(`${slug} ${kind}`) ?? [];
    expect(values.length).toBe(200);
    expect(spread(values)).toBeLessThanOrEqual(3);
  });

  it("sets a Chiavari dropped on oak at 1 m/s to the anchor's loudness, give or take its play's speed, its median peak at the touch level (rulings R36, R45)", () => {
    // Each play is levelled at its own speed, within +-15 % of 1 m/s: 10 log10(0.85) to 10 log10(1.15) dB about the anchor.
    const loudnesses: number[] = [];
    const peaks = Array.from({ length: 21 }, (_, i) => {
      const render = setDown("chiavari-chair", "oak-boards-joists", { seed: 1 + i });
      loudnesses.push(loudness(render));
      return render.peakDb;
    });
    for (const value of loudnesses) {
      expect(value).toBeGreaterThanOrEqual(SET_DOWN_TOUCH_LOUDNESS_DB + 10 * Math.log10(0.85) - 1e-6);
      expect(value).toBeLessThanOrEqual(SET_DOWN_TOUCH_LOUDNESS_DB + 10 * Math.log10(1.15) + 1e-6);
    }
    expect(Math.abs(median(loudnesses) - SET_DOWN_TOUCH_LOUDNESS_DB)).toBeLessThan(0.35);
    expect(Math.abs(median(peaks) - SET_DOWN_TOUCH_DB)).toBeLessThan(0.5);
  });

  it("follows mass and speed in loudness, compressed, and holds the peak to -32..-6 dBFS (ruling R42)", () => {
    const chair = setDown("chiavari-chair", "oak-boards-joists");
    const round = setDown("round-table-6ft-white", "oak-boards-joists");
    const faster = setDown("chiavari-chair", "oak-boards-joists", { speed: 2 });
    for (const render of [chair, round, faster]) {
      expect(render.peakDb).toBeGreaterThan(-32);
      expect(render.peakDb).toBeLessThan(-6);
    }
    expect(loudness(round) - loudness(chair)).toBeCloseTo(3 * Math.log10(30 / 4), 2);
    expect(loudness(faster) - loudness(chair)).toBeCloseTo(10 * Math.log10(2), 2);
    expect(setDown("bar-counter", "oak-boards-joists", { speed: 10 }).peakDb).toBeCloseTo(-6, 3);
    expect(setDown("lapel-microphone", "oak-boards-joists", { speed: 0.1 }).peakDb).toBeCloseTo(-32, 3);
  });

  it("holds a play at -6 dBFS with the safety limiter only when the loudness rule would take it past (ruling R42)", () => {
    const chair = setDown("chiavari-chair", "oak-boards-joists");
    expect(chair.limitDb).toBe(0);
    const slow = setDown("bar-counter", "oak-boards-joists", { speed: 0.3 });
    expect(slow.limitDb).toBe(0);
    expect(slow.peakDb).toBeLessThan(-6);
    const hard = setDown("bar-counter", "oak-boards-joists", { speed: 10 });
    expect(hard.limitDb).toBeGreaterThan(0);
    expect(hard.peakDb).toBeCloseTo(-6, 3);
  });

  it("settles 6 dB softer than it drops, and darker", () => {
    const drop = setDown("chiavari-chair", "oak-boards-joists");
    const settle = setDown("chiavari-chair", "oak-boards-joists", { kind: "settle" });
    expectSounding(settle);
    expect(loudness(settle) - loudness(drop)).toBeCloseTo(10 * Math.log10(0.25), 2);
    expect(brightnessHz(settle.left, SR)).toBeLessThan(brightnessHz(drop.left, SR));
  });
});

describe("when it is heard", () => {
  it("marks the first moment within 20 dB of the peak: at once on oak, well after first contact on carpet (ruling R37)", () => {
    for (const seed of SEEDS) {
      const oak = setDown("chiavari-chair", "oak-boards-joists", { seed });
      const carpet = setDown("chiavari-chair", "carpet", { seed });
      expect(oak.onsetSeconds).toBeGreaterThanOrEqual(0);
      expect(oak.onsetSeconds).toBeLessThan(0.003);
      // Carpet's first 45 ms pulse is nearly silent: it is first heard well after its first contact.
      expect(carpet.onsetSeconds).toBeGreaterThan(oak.onsetSeconds + 0.008);
      expect(carpet.onsetSeconds).toBeLessThan(0.08);
      // It is the first sample of the source reaching a tenth of its peak.
      const at = Math.round(carpet.onsetSeconds * SR);
      const peak = 10 ** (carpet.peakDb / 20);
      expect(Math.abs(carpet.left[at] ?? 0)).toBeGreaterThanOrEqual(0.1 * peak * (1 - 1e-6));
      for (let i = 0; i < at; i += 1) expect(Math.abs(carpet.left[i] ?? 0)).toBeLessThan(0.1 * peak);
    }
  });
});

describe("extras", () => {
  it("brushes a floor-length cloth's hem: 90 ms of noise at 2-6 kHz, about 30 dB under the landing", () => {
    const bare = setDown("round-table-6ft-white", "oak-boards-joists");
    const clothed = setDown("round-table-6ft-white", "oak-boards-joists", { clothed: true });
    // Its noise is drawn after everything else, so the difference is the hem alone, once the
    // two renders are held to the same scale (the hem may nudge the peak each is set by).
    const after = Math.round(0.12 * SR);
    let cross = 0;
    let own = 0;
    for (let i = after; i < bare.left.length; i += 1) {
      cross += (clothed.left[i] ?? 0) * (bare.left[i] ?? 0);
      own += (bare.left[i] ?? 0) ** 2;
    }
    const scale = own > 0 ? cross / own : 1;
    const hem = Float32Array.from(clothed.left, (sample, i) => sample - scale * (bare.left[i] ?? 0));
    expect(energy(hem)).toBeGreaterThan(0);
    expect(bandEnergy(hem, SR, 2000, 6000) / energy(hem)).toBeGreaterThan(0.6);
    let peak = 0;
    let last = 0;
    hem.forEach((sample, i) => {
      peak = Math.max(peak, Math.abs(sample));
      if (Math.abs(sample) > 1e-6) last = i;
    });
    expect(20 * Math.log10(peak) - bare.peakDb).toBeGreaterThan(-36);
    expect(20 * Math.log10(peak) - bare.peakDb).toBeLessThan(-26);
    expect((last / SR) * 1000).toBeLessThan(110);
  });
});

describe("the space", () => {
  it("pans the direct sound at equal power", () => {
    const power = (azimuthRad: number): number => {
      const render = setDown("chiavari-chair", "oak-boards-joists", { azimuthRad });
      return energy(render.left) + energy(render.right);
    };
    const centre = power(0);
    for (const azimuth of [Math.PI / 6, Math.PI / 2, -Math.PI / 3, (3 * Math.PI) / 4]) {
      expect(power(azimuth) / centre).toBeCloseTo(1, 4);
    }
    const right = setDown("chiavari-chair", "oak-boards-joists", { azimuthRad: Math.PI / 2 });
    expect(energy(right.left)).toBeLessThan(1e-9 * energy(right.right));
    // The peak is the mono source's, whatever the pan: hard right puts one channel 3 dB above it.
    expect(right.peakDb).toBeCloseTo(setDown("chiavari-chair", "oak-boards-joists").peakDb, 3);
    expect(peakOf(right) - right.peakDb).toBeCloseTo(10 * Math.log10(2), 2);
  });

  it("scales the whole sound by the direct gain", () => {
    const full = setDown("chiavari-chair", "oak-boards-joists");
    const half = setDown("chiavari-chair", "oak-boards-joists", { gain: 0.5 });
    expect(half.peakDb - full.peakDb).toBeCloseTo(20 * Math.log10(0.5), 4);
  });

  it("folds a reflection under 1 ms into the direct sound, which is still set to the level rule, and lowers the rest by 1 / (1 + g) (ruling R35)", () => {
    const g = 0.5;
    const floor: Reflection = { delaySeconds: 0.0004, gain: [0.6, 0.6, 0.5, g, 0.45, 0.4, 0.4], azimuthRad: 0, order: 1 };
    const wall: Reflection = { delaySeconds: 0.03, gain: [0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4], azimuthRad: Math.PI / 2, order: 1 };
    const open = setDown("chiavari-chair", "oak-boards-joists", { reflections: [wall] });
    const folded = setDown("chiavari-chair", "oak-boards-joists", { reflections: [floor, wall] });
    // The wall is hard right, so the left channel is the direct sound alone: the same with the fold as without.
    expect(folded.peakDb).toBeCloseTo(open.peakDb, 3);
    expect(20 * Math.log10(Math.max(...folded.left.map(Math.abs)))).toBeCloseTo(folded.peakDb, 3);
    expect(folded.left.length).toBe(open.left.length);
    for (let i = 0; i < folded.left.length; i += 97) expect(folded.left[i] ?? 0).toBeCloseTo(open.left[i] ?? 0, 7);
    // What the wall adds to the right channel falls by 1 / (1 + g).
    const start = Math.round(0.03 * SR);
    for (let i = start; i < folded.right.length; i += 89) {
      const openWall = (open.right[i] ?? 0) - (open.left[i] ?? 0);
      const foldedWall = (folded.right[i] ?? 0) - (folded.left[i] ?? 0);
      expect(foldedWall).toBeCloseTo(openWall / (1 + g), 7);
    }
  });

  it("adds each later reflection at its delay, side and 1 kHz gain, low-passed by its 4 kHz loss", () => {
    // On the slab, which has no joists: a suspended floor's own 14 Hz heave is not reflected
    // (it is far below any room's Schroeder frequency), so the copy is exactly the dry sound.
    const dry = setDown("chiavari-chair", "timber-on-slab");
    const delay = 0.03;
    const flat: Reflection = { delaySeconds: delay, gain: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], azimuthRad: Math.PI / 2, order: 1 };
    const dull: Reflection = { ...flat, gain: [0.5, 0.5, 0.5, 0.5, 0.3, 0.1, 0.1] };
    const withFlat = setDown("chiavari-chair", "timber-on-slab", { reflections: [flat] });
    const withDull = setDown("chiavari-chair", "timber-on-slab", { reflections: [dull] });
    const start = Math.round(delay * SR);
    const added = (render: SetDownRender, channel: "left" | "right"): Float32Array =>
      Float32Array.from(render[channel].subarray(0, dry.left.length + start), (sample, i) => sample - (dry[channel][i] ?? 0));
    // Hard right: nothing reaches the left channel, and nothing before its delay.
    expect(energy(added(withFlat, "left"))).toBeLessThan(1e-12);
    expect(energy(added(withFlat, "right").subarray(0, start))).toBeLessThan(1e-12);
    // A flat reflection at 0.5 to the right is the dry centre channel at 0.5 x root 2.
    expect(energy(added(withFlat, "right")) / energy(dry.left)).toBeCloseTo(0.5, 2);
    // Losing the top at 4 kHz darkens the copy.
    expect(brightnessHz(added(withDull, "right"), SR)).toBeLessThan(brightnessHz(added(withFlat, "right"), SR));
  });

  it("drops a reflection more than a second late, rather than making the render that long", () => {
    const dry = setDown("chiavari-chair", "oak-boards-joists");
    const late: Reflection = { delaySeconds: 5, gain: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], azimuthRad: 0, order: 2 };
    const absurd: Reflection = { ...late, delaySeconds: 1e9 };
    const render = setDown("chiavari-chair", "oak-boards-joists", { reflections: [late, absurd] });
    expect(render.left.length).toBe(dry.left.length);
    expect(sameSamples(render.left, dry.left)).toBe(true);
  });

  it("holds the direct gain to 0..1, its contract, so no gain takes a play past the -6 dBFS window (ruling R53)", () => {
    const full = setDown("bar-counter", "oak-boards-joists", { speed: 10 });
    expect(full.peakDb).toBeLessThanOrEqual(-6);
    for (const gain of [1.5, 4, Number.POSITIVE_INFINITY]) {
      const loud = setDown("bar-counter", "oak-boards-joists", { speed: 10, gain });
      expect(sameSamples(loud.left, full.left), String(gain)).toBe(true);
      expect(loud.peakDb, String(gain)).toBe(full.peakDb);
    }
    const silent = setDown("bar-counter", "oak-boards-joists", { speed: 10, gain: -1 });
    expect(silent.left.every((sample) => sample === 0)).toBe(true);
    // A gain that is not a number is taken as 1.
    expect(sameSamples(setDown("bar-counter", "oak-boards-joists", { speed: 10, gain: Number.NaN }).left, full.left)).toBe(true);
  });
});

describe("surfaces under the feet", () => {
  it("treats two copies of one surface as one surface, whatever their identity (ruling R37)", () => {
    const shared = inputFor("chiavari-chair", "dance-floor", { room: "saloon" });
    const response = surfaceResponse("dance-floor", "saloon");
    const copies: SetDownInput = { ...shared, surfaces: shared.surfaces.map(() => ({ ...response })) };
    const a = renderSetDown(shared);
    const b = renderSetDown(copies);
    expect(sameSamples(b.left, a.left)).toBe(true);
  });
});

describe("pieces with no crafted body", () => {
  it("renders an imported model at 1.7 times its size: finite and sounding", () => {
    const render = setDown("imported-thing", "oak-boards-joists", { scale: 1.7 });
    expectSounding(render);
    for (const sample of render.left) expect(Number.isFinite(sample)).toBe(true);
    expect(render.peakDb).toBeGreaterThanOrEqual(-32);
    expect(render.peakDb).toBeLessThanOrEqual(-6);
  });

  it("never throws on a body with no feet, no surfaces or impossible numbers", () => {
    const body = bodyFor("chiavari-chair");
    const odd: SetDownInput = {
      ...inputFor("chiavari-chair", "oak-boards-joists"),
      body: { ...body, feet: [], massKg: Number.NaN },
      surfaces: [],
      speed: Number.NaN,
      direct: { gain: Number.NaN, azimuthRad: Number.NaN },
      reflections: [{ delaySeconds: Number.NaN, gain: [1, 1, 1, 1, 1, 1, 1], azimuthRad: 0, order: 1 }],
    };
    const render = renderSetDown(odd);
    expectSounding(render);
    for (const sample of render.left) expect(Number.isFinite(sample)).toBe(true);
    expect(Number.isFinite(render.onsetSeconds)).toBe(true);
  });
});

// A render's cost is timed in render-figures.test.ts, on a named machine, not here (ruling R52).
