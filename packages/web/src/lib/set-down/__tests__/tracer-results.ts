// ---------------------------------------------------------------------------
// The offline ray tracer's results (tools/set-down-acoustics), read for the
// tests that hold the room model to it (T-677, Task 7).
//
// The tracer (raytrace.py) traces each room's prism empty, half dressed and
// fully dressed, and writes results.json. The calibration test checks the
// model against it; the room test checks that rooms.ts carries the factors
// fitted from it. This file is the one place that reads it, defines the half
// dressing, and states the fitting rule.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { BandValues } from "../bands.js";
import { absorberFor, contentsAbsorption, referenceDinner, reverberationTimes } from "../room-acoustics.js";
import { ROOM_ACOUSTICS, UNCALIBRATED, type RoomSlug } from "../rooms.js";

/** The repository's tools/set-down-acoustics folder, where the tracer lives. */
export const TRACER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../tools/set-down-acoustics");

export const TRACED_ROOMS = [
  "grand-hall",
  "saloon",
  "robert-adam-room",
  "reception-room",
  "north-gallery",
  "south-gallery",
] as const satisfies readonly RoomSlug[];

export type TracedRoom = (typeof TRACED_ROOMS)[number];

/**
 * Rays per band each room is traced with (ruling R31): 200,000, and ten times
 * that in the galleries, whose late decay rests on a few long-lived rays.
 */
export const TRACER_RAYS: Readonly<Record<TracedRoom, number>> = {
  "grand-hall": 200000,
  saloon: 200000,
  "robert-adam-room": 200000,
  "reception-room": 200000,
  "north-gallery": 2000000,
  "south-gallery": 2000000,
};

export type Dressing = "empty" | "half" | "dressed";
export const DRESSINGS: readonly Dressing[] = ["empty", "half", "dressed"];

/** Band indices the model is held to the tracer in: 250 Hz to 4 kHz. */
export const CHECKED_BANDS = [1, 2, 3, 4, 5] as const;

/** A calibration factor is clamped to this range. */
export const CALIBRATION_RANGE = { min: 0.7, max: 1.3 } as const;
/** A band whose empty T20 fit is poorer than this keeps a factor of 1. */
export const MIN_FIT_R2 = 0.95;

const NO_CONTENTS: BandValues = [0, 0, 0, 0, 0, 0, 0];

const bands = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]);
const roomResult = z.object({
  empty: bands,
  half: bands,
  dressed: bands,
  r2: z.object({ empty: bands, half: bands, dressed: bands }),
  rays: z.number().int().positive(),
  seed: z.number().int(),
  seed2: z.object({ empty: bands, dressed: bands }),
  /** Set when the room's export is identical to another's, whose trace it shares. */
  sameRoomAs: z.enum(TRACED_ROOMS).optional(),
});
const tracerFile = z.record(z.enum(TRACED_ROOMS), roomResult);

export type TracerRoomResult = z.infer<typeof roomResult>;
export type TracerResults = z.infer<typeof tracerFile>;

let cached: TracerResults | null = null;

/** results.json, validated. Throws if it is missing or malformed. */
export function tracerResults(): TracerResults {
  cached ??= tracerFile.parse(JSON.parse(readFileSync(resolve(TRACER_DIR, "results.json"), "utf8")));
  return cached;
}

/**
 * The pieces of each dressing: none, the first half of the reference dinner
 * (its first ceil(n / 2) items, in referenceDinner's order; the listening
 * page's 50 %), or all of it.
 */
export function dressingItems(slug: RoomSlug, dressing: Dressing): ReturnType<typeof referenceDinner> {
  if (dressing === "empty") return [];
  const dinner = referenceDinner(slug);
  return dressing === "dressed" ? dinner : dinner.slice(0, Math.ceil(dinner.length / 2));
}

/** The added absorption of a dressing, m2 per band. */
export function dressingContents(slug: RoomSlug, dressing: Dressing): BandValues {
  if (dressing === "empty") return NO_CONTENTS;
  return contentsAbsorption(dressingItems(slug, dressing).map(absorberFor));
}

function band(values: BandValues, i: number): number {
  return values[i] ?? Number.NaN;
}

function clamp(value: number): number {
  return Math.min(CALIBRATION_RANGE.max, Math.max(CALIBRATION_RANGE.min, value));
}

/** Rounded to 3 decimals as Math.round does (half up), the way rooms.ts records them. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Eyring's times for a room and dressing, uncalibrated. */
export function uncalibratedTimes(slug: RoomSlug, dressing: Dressing): BandValues {
  return reverberationTimes({ ...ROOM_ACOUSTICS[slug], calibration: UNCALIBRATED }, dressingContents(slug, dressing));
}

/**
 * The calibration fitted from the tracer, per band: tracer empty / Eyring
 * empty (uncalibrated), clamped to 0.7-1.3 and rounded to 3 decimals; 1 where
 * the tracer's empty fit has r2 under 0.95.
 */
export function fittedCalibration(slug: RoomSlug): BandValues {
  const traced = tracerResults()[slug];
  const eyring = uncalibratedTimes(slug, "empty");
  const factor = (i: number): number =>
    band(traced.r2.empty, i) < MIN_FIT_R2 ? 1 : round3(clamp(band(traced.empty, i) / band(eyring, i)));
  return [factor(0), factor(1), factor(2), factor(3), factor(4), factor(5), factor(6)];
}
