// ---------------------------------------------------------------------------
// The set-down Worker's messages (T-700, ruling R48): the jobs the main thread
// posts, the answers the Worker posts back, and a runtime check of each.
//
// A job is a set-down to render (renderSetDown's input) or a room's late tail
// (renderRoomTail's). An answer carries the two rendered channels as the
// Worker's own buffers, transferred, never copied, and the Worker's time for
// the work. A message crosses a thread, so neither side trusts its shape: the
// Worker checks every job and the client every answer (AGENTS.md). The checks
// cover every field the engine reads and name the first one at fault, so a
// job the engine would read as NaN, or throw on, is refused by name.
//
// Each check is written against its type, so a field added to the engine's
// input fails to compile here until it is checked. Only types are imported,
// so the main thread's client takes this module without the engine.
// ---------------------------------------------------------------------------

import type { BandValues } from "./bands.js";
import type { BodyFamily, BodyPart, Foot, FootCap, PartKind, SetDownBody } from "./bodies.js";
import type { Reflection } from "./reflections.js";
import type { SetDownInput } from "./render.js";
import type { ModeBank, SurfaceKind, SurfaceResponse } from "./surfaces.js";

/**
 * The rates a job may ask for, Hz: those renderSetDown renders at as asked
 * (render.ts's saneRate renders any other rate at 48 kHz, so the answer would
 * not be at the rate asked). At the highest, a tail's 5 s cap is 15.4 MB of
 * two channels.
 */
export const SET_DOWN_RATES_HZ = { lowest: 8000, highest: 384000 } as const;

/** A tail's options, as renderRoomTail takes them. */
export interface TailOptions {
  readonly sampleRate: number;
  readonly seed: number;
  readonly onsetSeconds: number;
}

/** A set-down to render. `key` is the caller's name for it, for cancelling and caching; `id` is the client's own. */
export interface SetDownRenderJob {
  readonly kind: "render";
  readonly id: number;
  readonly key: string;
  readonly input: SetDownInput;
}

/** A room's late tail to render. */
export interface SetDownTailJob extends TailOptions {
  readonly kind: "tail";
  readonly id: number;
  readonly key: string;
  readonly rt: BandValues;
}

export type SetDownJob = SetDownRenderJob | SetDownTailJob;

/** A rendered set-down: renderSetDown's figures, its channels as transferred buffers, and the Worker's time. */
export interface SetDownRenderAnswer {
  readonly kind: "render";
  readonly id: number;
  readonly ok: true;
  readonly left: ArrayBuffer;
  readonly right: ArrayBuffer;
  readonly sampleRate: number;
  readonly peakDb: number;
  readonly onsetSeconds: number;
  readonly limitDb: number;
  readonly workMs: number;
}

/** A rendered tail, its channels as transferred buffers, and the Worker's time. */
export interface SetDownTailAnswer {
  readonly kind: "tail";
  readonly id: number;
  readonly ok: true;
  readonly left: ArrayBuffer;
  readonly right: ArrayBuffer;
  readonly sampleRate: number;
  readonly workMs: number;
}

/**
 * A job the Worker refused or failed, and why. Its kind and id are the job's
 * where the job had them: a message that is not a job has neither.
 */
export interface SetDownRefusal {
  readonly kind: SetDownJob["kind"] | null;
  readonly id: number | null;
  readonly ok: false;
  readonly error: string;
}

export type SetDownAnswer = SetDownRenderAnswer | SetDownTailAnswer | SetDownRefusal;

// --- Checks --------------------------------------------------------------------

/** What is wrong with a value, by its path in the message, or null when nothing is. */
type Check = (value: unknown, path: string) => string | null;

/** One check per field of T, every field required, so a type and its check cannot drift apart. */
type Checks<T> = { readonly [K in keyof T]-?: Check };

/** A value as an error names it: a primitive as itself, anything else by its sort. */
function shown(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}...` : value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "a list";
  return typeof value === "object" ? "an object" : `a ${typeof value}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const finite: Check = (value, path) =>
  typeof value === "number" && Number.isFinite(value) ? null : `${path} is not a finite number: ${shown(value)}`;

const whole: Check = (value, path) => (Number.isSafeInteger(value) ? null : `${path} is not a whole number: ${shown(value)}`);

const text: Check = (value, path) => (typeof value === "string" ? null : `${path} is not a string: ${shown(value)}`);

const flag: Check = (value, path) => (typeof value === "boolean" ? null : `${path} is not true or false: ${shown(value)}`);

const rate: Check = (value, path) =>
  typeof value === "number" && value >= SET_DOWN_RATES_HZ.lowest && value <= SET_DOWN_RATES_HZ.highest
    ? null
    : `${path} is not a sample rate from ${String(SET_DOWN_RATES_HZ.lowest)} to ${String(SET_DOWN_RATES_HZ.highest)} Hz: ${shown(value)}`;

const buffer: Check = (value, path) => (value instanceof ArrayBuffer ? null : `${path} is not an ArrayBuffer: ${shown(value)}`);

function exactly(...allowed: readonly (string | number | boolean)[]): Check {
  return (value, path) =>
    allowed.some((one) => one === value) ? null : `${path} is not ${allowed.map(shown).join(" or ")}: ${shown(value)}`;
}

/** A string naming one of `names`' keys. */
function oneOf(names: Readonly<Record<string, true>>, what: string): Check {
  return (value, path) => (typeof value === "string" && Object.hasOwn(names, value) ? null : `${path} is not ${what}: ${shown(value)}`);
}

function nullable(check: Check): Check {
  return (value, path) => (value === null ? null : check(value, path));
}

function list(check: Check): Check {
  return (value, path) => {
    if (!Array.isArray(value)) return `${path} is not a list: ${shown(value)}`;
    const items: readonly unknown[] = value;
    for (let i = 0; i < items.length; i += 1) {
      const problem = check(items[i], `${path}[${String(i)}]`);
      if (problem !== null) return problem;
    }
    return null;
  };
}

/** Seven finite values, one per octave band. */
const bands: Check = (value, path) =>
  Array.isArray(value) && value.length === 7 ? list(finite)(value, path) : `${path} is not seven band values: ${shown(value)}`;

function shape<T>(checks: Checks<T>): Check {
  return (value, path) => {
    if (!isRecord(value)) return `${path} is not an object: ${shown(value)}`;
    for (const key in checks) {
      const problem = checks[key](value[key], `${path}.${key}`);
      if (problem !== null) return problem;
    }
    return null;
  };
}

// --- The engine's names, each list exhaustive by its type -----------------------------

const FOOT_CAPS: Readonly<Record<FootCap, true>> = { glide: true, rubber: true, felt: true, steel: true, castor: true, "panel-edge": true };

const PART_KINDS: Readonly<Record<PartKind, true>> = {
  "beech-frame": true,
  "steel-tube-frame": true,
  "aluminium-frame": true,
  "ply-top": true,
  "mdf-top": true,
  "phenolic-deck": true,
  "cast-base": true,
  "cabinet-carcass": true,
  "av-plastic": true,
  "av-glass": true,
  upholstery: true,
};

const BODY_FAMILIES: Readonly<Record<BodyFamily, true>> = {
  chair: true,
  "round-table": true,
  "rect-table": true,
  poseur: true,
  stage: true,
  "dance-floor": true,
  lectern: true,
  "av-stand": true,
  "av-small": true,
  cabinet: true,
  divider: true,
  highchair: true,
};

const SURFACE_KINDS: Readonly<Record<SurfaceKind, true>> = {
  "oak-boards-joists": true,
  "oak-parquet": true,
  "timber-on-slab": true,
  carpet: true,
  "stage-deck": true,
  "dance-floor": true,
  "table-top": true,
};

// --- Jobs -------------------------------------------------------------------------

const modeBank = shape<ModeBank>({ lowHz: finite, highHz: finite, count: finite, eta: finite, gainDb: finite });

const surface = shape<SurfaceResponse>({
  kind: oneOf(SURFACE_KINDS, "a surface kind"),
  hardness: finite,
  boards: nullable(modeBank),
  thump: nullable(shape<NonNullable<SurfaceResponse["thump"]>>({ hz: finite, zeta: finite })),
  cavity: nullable(modeBank),
  highCutHz: finite,
  beneath: nullable(modeBank),
});

const body = shape<SetDownBody>({
  slug: text,
  family: oneOf(BODY_FAMILIES, "a body family"),
  massKg: finite,
  feet: list(shape<Foot>({ x: finite, z: finite, cap: oneOf(FOOT_CAPS, "a foot cap") })),
  parts: list(shape<BodyPart>({ kind: oneOf(PART_KINDS, "a part kind"), lengthM: finite, thicknessM: finite, share: finite })),
  legRattle: flag,
  seatPuff: flag,
  castorRoll: flag,
});

const reflection = shape<Reflection>({ delaySeconds: finite, gain: bands, azimuthRad: finite, order: exactly(1, 2) });

const inputShape = shape<SetDownInput>({
  body,
  surfaces: list(surface),
  speed: finite,
  kind: exactly("drop", "settle"),
  clothed: flag,
  direct: shape<SetDownInput["direct"]>({ gain: finite, azimuthRad: finite }),
  reflections: list(reflection),
  seed: whole,
  sampleRate: rate,
});

/** The input's shape, then one surface for each foot, in the feet's order (as SetDownInput says). */
const input: Check = (value, path) => {
  const problem = inputShape(value, path);
  if (problem !== null || !isRecord(value) || !isRecord(value["body"])) return problem;
  const feet = value["body"]["feet"];
  const surfaces = value["surfaces"];
  if (!Array.isArray(feet) || !Array.isArray(surfaces) || feet.length === surfaces.length) return null;
  return `${path}.surfaces has ${String(surfaces.length)} surfaces for ${String(feet.length)} feet`;
};

const renderJob = shape<SetDownRenderJob>({ kind: exactly("render"), id: whole, key: text, input });

const tailJob = shape<SetDownTailJob>({ kind: exactly("tail"), id: whole, key: text, rt: bands, sampleRate: rate, seed: whole, onsetSeconds: finite });

/** What is wrong with a job, naming the first field at fault, or null if it is a sound job. */
export function setDownJobProblem(value: unknown): string | null {
  if (!isRecord(value)) return `the job is not an object: ${shown(value)}`;
  if (value["kind"] === "render") return renderJob(value, "job");
  if (value["kind"] === "tail") return tailJob(value, "job");
  return `job.kind is not "render" or "tail": ${shown(value["kind"])}`;
}

export function isSetDownJob(value: unknown): value is SetDownJob {
  return setDownJobProblem(value) === null;
}

// --- Answers --------------------------------------------------------------------------

const renderAnswer = shape<SetDownRenderAnswer>({
  kind: exactly("render"),
  id: whole,
  ok: exactly(true),
  left: buffer,
  right: buffer,
  sampleRate: rate,
  peakDb: finite,
  onsetSeconds: finite,
  limitDb: finite,
  workMs: finite,
});

const tailAnswer = shape<SetDownTailAnswer>({ kind: exactly("tail"), id: whole, ok: exactly(true), left: buffer, right: buffer, sampleRate: rate, workMs: finite });

const refusal = shape<SetDownRefusal>({ kind: nullable(exactly("render", "tail")), id: nullable(whole), ok: exactly(false), error: text });

/** What is wrong with an answer's shape, naming the first field at fault, or null if it is a sound answer. */
export function setDownAnswerProblem(value: unknown): string | null {
  if (!isRecord(value)) return `the answer is not an object: ${shown(value)}`;
  if (value["ok"] === false) return refusal(value, "answer");
  if (value["kind"] === "render") return renderAnswer(value, "answer");
  if (value["kind"] === "tail") return tailAnswer(value, "answer");
  return `answer.kind is not "render" or "tail": ${shown(value["kind"])}`;
}

export function isSetDownAnswer(value: unknown): value is SetDownAnswer {
  return setDownAnswerProblem(value) === null;
}
