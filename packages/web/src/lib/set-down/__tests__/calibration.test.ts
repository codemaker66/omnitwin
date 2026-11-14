import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OCTAVE_BANDS_HZ } from "../bands.js";
import { reverberationTimes } from "../room-acoustics.js";
import { ROOM_ACOUSTICS } from "../rooms.js";
import {
  CALIBRATION_RANGE,
  CHECKED_BANDS,
  DRESSINGS,
  LOW_OCTAVE_EDGE_HZ,
  TRACED_ROOMS,
  TRACER_DIR,
  TRACER_RAYS,
  committedRaytraceSha256,
  committedRoomsSha256,
  dressingContents,
  fittedCalibration,
  schroederFrequencyHz,
  tracerResults,
  uncalibratedTimes,
  type Dressing,
  type TracedRoom,
} from "./tracer-results.js";

/** The model may differ from the tracer by this share of the tracer's time. */
const MODEL_TOLERANCE = 0.15;
/** The model's change with fullness may differ from the tracer's by this share of the tracer's (ruling R40). */
const FULLNESS_TOLERANCE = 0.15;
/** Two seeds of the tracer must agree to this share of the first. */
const SEED_TOLERANCE = 0.03;
/**
 * Fitted on empty, the model meets the tracer to the factor's 3-decimal
 * rounding (about 0.05 % of a factor near 1) and the trace's 0.1 ms rounding,
 * together under 0.1 %. So the empty check holds by construction except where
 * the clamp binds (ruling R50).
 */
const FIT_ROUNDING = 0.001;
/**
 * A plausibility band for the empty hall's (500 Hz + 1 kHz) / 2: the first
 * hand estimate's 2.14 s with the curtains drawn and about 3.5 s with them
 * open, widened, which takes in La Redoute's measured 3.2 s. Not a measured
 * range: the measured rooms are checked below (ruling R51).
 */
const GRAND_HALL_EMPTY_MID = { min: 2.0, max: 3.8 } as const;
/**
 * La Redoute, Bad Godesberg (1790-92): 1,450 m3, a polished stone floor,
 * plastered masonry walls and a gypsum plaster ceiling, measured empty and
 * unseated: T30 3.2 s, the mean of 500 Hz-2 kHz (Lorenz-Kierakiewitz, DAGA
 * 2020, Table 1). The Grand Hall, of about its volume, has oak boards on
 * joists, a mahogany dado, half-panelled walls and velour curtains, all more
 * absorbent than stone and plaster, so its empty mid band must lie below it.
 */
const LA_REDOUTE_EMPTY_MID_S = 3.2;
/**
 * Schloss Benrath's western and eastern Gartensaal (mid-18th century): parquet
 * floors and wood-panelled walls, measured unoccupied to ISO 3382-1, T30 2.4
 * and 2.5 s (Graef, Lorenz-Kierakiewitz, Pfaendner and Wagner, DAGA 2018,
 * Table 1). The table calls its figures the 125 Hz-4 kHz mean, but its Fig. 4
 * curves give them as the 500 Hz-2 kHz mean (about 2.37 and 2.53 s, read off
 * the figure), and so they are compared here. The volume is not stated; the
 * paper's 1 kHz strength G and T30 put it near 400 m3 by the diffuse-field
 * relation (inferred), against the Saloon's 469 m3. The states match on
 * occupancy only: both unoccupied, while the paper does not state what
 * furniture the halls held, and the model is empty. The 20 % tolerance is
 * about 5 % derived, for the volumes (T grows as V^(1/3) in rooms of one shape
 * and finish: (469 / 400)^(1/3) is 1.05), plus 15 % allowed for finishes and
 * furnishing neither the paper nor the survey pins down (the halls' ceilings,
 * the Saloon's stained glass and marble). The model's figure was known from
 * the first trace (2.49 s) when it was set.
 */
const BENRATH_GARDEN_HALLS_MID_S = (2.4 + 2.5) / 2;
const BENRATH_TOLERANCE = 0.2;
/**
 * Rooms allowed to miss a comparable-room check above, each with its reason
 * under a "Difference explained" heading in tools/set-down-acoustics/README.md.
 * None today. Adding one is a reviewed change to this list, as
 * GALLERY_NON_DIFFUSE is: a README heading alone excuses nothing (ruling R50).
 */
const RANGE_EXCEPTIONS: readonly TracedRoom[] = [];

type CheckedBand = (typeof CHECKED_BANDS)[number];
const GALLERIES: readonly TracedRoom[] = ["north-gallery", "south-gallery"];
/** The bands R32 named the exception over: 250 Hz to 4 kHz. */
const NON_DIFFUSE_SCOPE: readonly CheckedBand[] = [1, 2, 3, 4, 5];

/**
 * GALLERY_NON_DIFFUSE (ruling R32): the galleries' bands, 250 Hz to 4 kHz,
 * where the tracer reads more than 1.3 x uncalibrated Eyring, past the
 * calibration's clamp. The tracer's prism is the galleries' worst case: a
 * flat ceiling over the carpet and hard parallel walls, which keep
 * near-horizontal rays alive, with the furniture as floor absorption and
 * never as an obstacle. The attic's real section is not surveyed, so there
 * the tracer is an upper bound, not a measurement, and the model must lie
 * between uncalibrated Eyring and the tracer instead of within 15 % of it.
 * At 8 kHz the galleries' ratio is past 1.3 too, but air absorption carries
 * that band and the model stays within 15 %, so it keeps the bound (R40).
 * tools/set-down-acoustics/README.md, "Difference explained", has the figures.
 */
const GALLERY_NON_DIFFUSE: Readonly<Record<Dressing, readonly CheckedBand[]>> = {
  empty: [3, 4, 5],
  half: [3, 4, 5],
  dressed: [3, 4, 5],
};

function isNonDiffuse(slug: TracedRoom, dressing: Dressing, band: CheckedBand): boolean {
  return GALLERIES.includes(slug) && GALLERY_NON_DIFFUSE[dressing].includes(band);
}

function percent(share: number): string {
  return `${(100 * share).toFixed(1)} %`;
}

function label(slug: TracedRoom, dressing: Dressing, band: CheckedBand): string {
  return `${slug} ${dressing} ${String(OCTAVE_BANDS_HZ[band])} Hz`;
}

function readme(): string {
  return readFileSync(resolve(TRACER_DIR, "README.md"), "utf8");
}

function model(slug: TracedRoom, dressing: Dressing): ReturnType<typeof reverberationTimes> {
  return reverberationTimes(ROOM_ACOUSTICS[slug], dressingContents(slug, dressing));
}

/** The mean of the 500 Hz, 1 kHz and 2 kHz times, as ISO 3382-1 papers report a room's mid band. */
function mid500To2k(rt: ReturnType<typeof reverberationTimes>): number {
  return (rt[2] + rt[3] + rt[4]) / 3;
}

/** The mean of the 500 Hz and 1 kHz times, the mid band the Grand Hall's plausibility band is set on. */
function mid500And1k(rt: ReturnType<typeof reverberationTimes>): number {
  return (rt[2] + rt[3]) / 2;
}

/** Whether a factor sits at its clamp, where the empty model no longer meets the tracer by construction. */
function clamped(factor: number): boolean {
  return factor === CALIBRATION_RANGE.min || factor === CALIBRATION_RANGE.max;
}

describe("the room model against the ray tracer", () => {
  it("was traced by the committed raytrace.py from the committed rooms.json, as results.json records (R38, R50)", () => {
    const { trace } = tracerResults();
    expect(trace.roomsSha256).toBe(committedRoomsSha256());
    expect(trace.raytraceSha256).toBe(committedRaytraceSha256());
    expect(trace.batch).toBeGreaterThan(0);
    expect(trace.numpy.length).toBeGreaterThan(0);
  });

  it("has every room traced with its own ray count from seed 1, with a second seed alongside", () => {
    const results = tracerResults();
    for (const slug of TRACED_ROOMS) {
      expect(results[slug].rays).toBe(TRACER_RAYS[slug]);
      expect(results[slug].seed).toBe(1);
    }
  });

  it("shares one trace between the two galleries, which are the same room", () => {
    const north = ROOM_ACOUSTICS["north-gallery"];
    const south = ROOM_ACOUSTICS["south-gallery"];
    expect(south.volumeM3).toBe(north.volumeM3);
    expect(south.surfaces).toEqual(north.surfaces);
    const results = tracerResults();
    expect(results["south-gallery"].sameRoomAs).toBe("north-gallery");
    const { sameRoomAs: _twin, ...southFigures } = results["south-gallery"];
    expect(southFigures).toEqual(results["north-gallery"]);
  });

  it("keeps 125 Hz at 1 wherever the room's Schroeder frequency is above the octave's lower edge (R39)", () => {
    const modal: string[] = [];
    for (const slug of TRACED_ROOMS) {
      const schroeder = schroederFrequencyHz(slug);
      const factor = fittedCalibration(slug)[0];
      expect(ROOM_ACOUSTICS[slug].calibration[0]).toBe(factor);
      if (schroeder > LOW_OCTAVE_EDGE_HZ) {
        modal.push(slug);
        expect(factor).toBe(1);
      } else {
        // Above its Schroeder frequency the room keeps the tracer's fit.
        const fit = tracerResults()[slug].empty[0] / uncalibratedTimes(slug, "empty")[0];
        expect(factor).toBeCloseTo(Math.min(CALIBRATION_RANGE.max, Math.max(CALIBRATION_RANGE.min, fit)), 3);
      }
    }
    // The Grand Hall (about 65 Hz) is the one room big enough for its 125 Hz octave.
    expect(modal).toEqual(TRACED_ROOMS.filter((slug) => slug !== "grand-hall"));
    expect(schroederFrequencyHz("grand-hall")).toBeLessThan(70);
  });

  it("is fitted on empty: there it meets the tracer to the factor's rounding, 250 Hz to 8 kHz, unless the clamp binds (R50)", () => {
    // Not evidence of agreement, but the fit itself: each factor is tracer
    // empty / Eyring empty. The checks of the model are the half and fully
    // laid states, and the change with fullness, below.
    const results = tracerResults();
    const misses: string[] = [];
    for (const slug of TRACED_ROOMS) {
      const times = model(slug, "empty");
      const traced = results[slug].empty;
      for (const band of CHECKED_BANDS) {
        if (clamped(ROOM_ACOUSTICS[slug].calibration[band])) continue;
        const error = Math.abs(times[band] - traced[band]) / traced[band];
        if (!(error <= FIT_ROUNDING)) misses.push(`${label(slug, "empty", band)}: ${percent(error)}`);
      }
    }
    expect(misses).toEqual([]);
  });

  it("holds every room within 15 % of the tracer half and fully laid (and empty where the clamp binds), 250 Hz to 8 kHz", () => {
    const results = tracerResults();
    const misses: string[] = [];
    for (const slug of TRACED_ROOMS) {
      for (const dressing of DRESSINGS) {
        const times = model(slug, dressing);
        const traced = results[slug][dressing];
        for (const band of CHECKED_BANDS) {
          if (isNonDiffuse(slug, dressing, band)) continue;
          const error = Math.abs(times[band] - traced[band]) / traced[band];
          if (!(error <= MODEL_TOLERANCE)) {
            misses.push(
              `${label(slug, dressing, band)}: model ${times[band].toFixed(3)} s, tracer ${traced[band].toFixed(3)} s (${percent(error)})`,
            );
          }
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it("changes every room's echo with fullness as the tracer does, within 15 %, 250 Hz to 8 kHz (R40)", () => {
    // The heart of the brief: how the echo shortens as the room fills.
    const results = tracerResults();
    const misses: string[] = [];
    for (const slug of TRACED_ROOMS) {
      const empty = model(slug, "empty");
      for (const dressing of ["half", "dressed"] as const) {
        const times = model(slug, dressing);
        for (const band of CHECKED_BANDS) {
          const modelChange = times[band] / empty[band];
          const tracerChange = results[slug][dressing][band] / results[slug].empty[band];
          const error = Math.abs(modelChange - tracerChange) / tracerChange;
          if (!(error <= FULLNESS_TOLERANCE)) {
            misses.push(
              `${label(slug, dressing, band)}: model x${modelChange.toFixed(3)}, tracer x${tracerChange.toFixed(3)} (${percent(error)})`,
            );
          }
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it("puts the galleries' non-diffuse bands between uncalibrated Eyring and the tracer, and lists exactly those bands", () => {
    const results = tracerResults();
    const misses: string[] = [];
    for (const slug of GALLERIES) {
      for (const dressing of DRESSINGS) {
        const eyring = uncalibratedTimes(slug, dressing);
        const times = model(slug, dressing);
        const traced = results[slug][dressing];
        for (const band of NON_DIFFUSE_SCOPE) {
          const beyondClamp = traced[band] / eyring[band] > CALIBRATION_RANGE.max;
          if (beyondClamp !== isNonDiffuse(slug, dressing, band)) {
            const ratio = (traced[band] / eyring[band]).toFixed(3);
            misses.push(`${label(slug, dressing, band)}: tracer/Eyring ${ratio}, listed ${String(isNonDiffuse(slug, dressing, band))}`);
          }
          if (beyondClamp && !(eyring[band] <= times[band] && times[band] <= traced[band])) {
            misses.push(
              `${label(slug, dressing, band)}: Eyring ${eyring[band].toFixed(3)} s, model ${times[band].toFixed(3)} s, tracer ${traced[band].toFixed(3)} s`,
            );
          }
        }
      }
    }
    expect(misses).toEqual([]);
    expect(readme()).toMatch(/^#+ .*difference explained.*GALLERY_NON_DIFFUSE/im);
  });

  it("puts the empty Grand Hall's mid band in 2.0-3.8 s, unless it is a listed range exception", () => {
    const mid = mid500And1k(model("grand-hall", "empty"));
    const inRange = mid >= GRAND_HALL_EMPTY_MID.min && mid <= GRAND_HALL_EMPTY_MID.max;
    expect(inRange || RANGE_EXCEPTIONS.includes("grand-hall"), `empty mid band ${mid.toFixed(2)} s`).toBe(true);
  });

  it("keeps the empty Grand Hall below La Redoute's measured 3.2 s, the empty unseated stone-floored hall of its size (R51)", () => {
    const mid = mid500To2k(model("grand-hall", "empty"));
    expect(mid < LA_REDOUTE_EMPTY_MID_S || RANGE_EXCEPTIONS.includes("grand-hall"), `${mid.toFixed(2)} s`).toBe(true);
  });

  it("puts the empty Saloon within 20 % of Schloss Benrath's panelled, parquet-floored garden halls, measured unoccupied (R51)", () => {
    const mid = mid500To2k(model("saloon", "empty"));
    const error = Math.abs(mid - BENRATH_GARDEN_HALLS_MID_S) / BENRATH_GARDEN_HALLS_MID_S;
    expect(error <= BENRATH_TOLERANCE || RANGE_EXCEPTIONS.includes("saloon"), `${mid.toFixed(2)} s`).toBe(true);
  });

  it("gives a README 'difference explained' section to exactly the listed exceptions, so no heading can switch a check off (R50)", () => {
    const headings = readme()
      .split("\n")
      .filter((line) => /^#+ .*difference explained/i.test(line));
    const named = (heading: string): boolean =>
      heading.includes("GALLERY_NON_DIFFUSE") ||
      RANGE_EXCEPTIONS.some((slug) => heading.toLowerCase().includes(slug.replace(/-/g, " ")));
    expect(headings.filter((heading) => !named(heading))).toEqual([]);
    expect(headings.some((heading) => heading.includes("GALLERY_NON_DIFFUSE"))).toBe(true);
    for (const slug of RANGE_EXCEPTIONS) {
      expect(headings.some((heading) => heading.toLowerCase().includes(slug.replace(/-/g, " "))), slug).toBe(true);
    }
  });

  it("agrees with a second seed within 3 %, empty and fully dressed, 250 Hz to 8 kHz", () => {
    const results = tracerResults();
    const misses: string[] = [];
    for (const slug of TRACED_ROOMS) {
      for (const dressing of ["empty", "dressed"] as const) {
        const first = results[slug][dressing];
        const second = results[slug].seed2[dressing];
        for (const band of CHECKED_BANDS) {
          const spread = Math.abs(second[band] - first[band]) / first[band];
          if (!(spread <= SEED_TOLERANCE)) misses.push(`${label(slug, dressing, band)}: ${percent(spread)}`);
        }
      }
    }
    expect(misses).toEqual([]);
  });
});
