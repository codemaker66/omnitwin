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
/** The research's comparable-room range for the empty hall, widened by the curtain uncertainty. */
const GRAND_HALL_EMPTY_MID = { min: 2.0, max: 3.8 } as const;

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

describe("the room model against the ray tracer", () => {
  it("was traced from the committed rooms.json, as results.json records (R38)", () => {
    const { trace } = tracerResults();
    expect(trace.roomsSha256).toBe(committedRoomsSha256());
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

  it("holds every room's calibrated echo within 15 % of the tracer, empty, half and fully dressed, 250 Hz to 8 kHz", () => {
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

  it("puts the empty Grand Hall's mid band in 2.0-3.8 s, or the README explains the difference", () => {
    const rt = model("grand-hall", "empty");
    const mid = (rt[2] + rt[3]) / 2;
    const inRange = mid >= GRAND_HALL_EMPTY_MID.min && mid <= GRAND_HALL_EMPTY_MID.max;
    const explained = /^#+ .*difference explained.*grand hall/im.test(readme());
    expect(inRange || explained, `empty mid band ${mid.toFixed(2)} s`).toBe(true);
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
