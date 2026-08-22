import { threeDirToE57 } from "../twin-basis.js";

// -----------------------------------------------------------------------------
// measure-math — the two-point measure.
//
// WHY THIS IS NOT lib/measurement.ts. The planner already ships a measure tool
// (src/lib/measurement.ts + stores/measurement-store.ts) and none of it can be
// reused here. It divides X and Z by the planner's floor-area inflation
// (constants/scale.js `toRealWorld`) and leaves Y alone; twin space is E57
// metres 1:1, so running twin points through it would shrink every horizontal
// figure by the render scale while leaving heights correct — the most
// convincing kind of wrong. Two frames, two modules.
//
// WHY THE AXIS SPLIT GOES THROUGH twin-basis. "How far apart in plan" and "how
// much higher" are questions about the building, and the building's up-axis is
// the capture frame's Z, not whichever three.js axis currently points up. The
// delta is handed to `threeDirToE57` — the pinned exact inverse of
// `e57PointToThree` — and read in capture terms.
//
// The strength of that claim is exactly what the suite enforces, and no more:
// measure-math.test.ts drives points through `e57PointToThree` in all eight
// octants and asserts this module's plan/rise split agrees with the capture
// frame every time. That is a statement about agreement with twin-basis, which
// is testable here. It is NOT a repo-wide "the conversion exists in exactly one
// place" guarantee: this module cannot see the rest of the repo, so it does not
// claim to police it.
//
// -----------------------------------------------------------------------------
// UNCERTAINTY: THIS MODULE SHIPS NO NUMERAL FOR IT. READ THIS BEFORE ADDING ONE.
//
// An earlier revision printed "6.40 m ± 3 cm", deriving the ± from the
// manifest's `tier`. That was refuted, and the refutation is the whole reason
// this block exists:
//
//   1. `tier` is not a measurement. Its provenance is an argv default —
//      tools/twin-forge/src/cli.ts declares `tier: { type: "string", default:
//      "ops-grade-2cm" }` and the live manifest carries that default through
//      untouched. Nobody measured anything. Printing a ± derived from it
//      presents a command-line flag as an instrument specification, to a
//      planner who may order a marquee against it.
//
//   2. `tier` does not mean what that arithmetic needed it to mean. Its own
//      schema (packages/types/src/twin.ts) documents it as an "ADR-015-aligned
//      planning tier; never implies certification (ADR-012)". ADR-015 is a
//      DEVICE-CLASS ladder — which kind of rig captured this — not a per-pose
//      registration sigma. Reading a sigma off it was an invention.
//
// WHAT WOULD MAKE A ± POSSIBLE. One thing only: the forge writing a MEASURED
// registration residual into the manifest — a per-bundle 6-DoF pose-graph
// residual (e.g. an RMS over the registered poses) produced by the registration
// solve itself, carried in a new manifest field. No such field exists today;
// there is no `registrationRms`, or anything equivalent, anywhere in
// packages/types. Until one exists and is populated from a real solve, any ±
// this module could print would be fabricated.
//
// WHAT IS NOT IT. The floor-height alignment residual the forge's atlas step
// already computes (tools/twin-forge/e57-scripts/floor_atlas.py, the per-sweep
// dz bar) is NOT that number and must never be promoted into one. It constrains
// ONE axis — how well each sweep's floor plane agrees on height. A measurement
// between two picked points is a 6-DoF question: in-plane translation and all
// three rotations are unconstrained by a floor-height agreement, and a
// horizontal span is precisely the case that residual says nothing about.
// Quoting it as this tool's ± would understate the spread on the figures a
// planner uses most.
//
// WHAT SHIPS INSTEAD. The figures carry a qualitative mark ("≈") and the panel
// carries a sentence saying what kind of measurement this is and what to do
// before spending money against it (measure-copy.ts, MEASURE_CONFIDENCE_NOTE).
// Words can be true without a measurement behind them; a number cannot.
// -----------------------------------------------------------------------------

/** A point in three.js world space, metres. Callers holding a three `Vector3`
 *  pass `[v.x, v.y, v.z]` — this module stays free of a three.js import so it
 *  can be tested, and reasoned about, without a renderer. */
export type MeasureVec3 = readonly [number, number, number];

/** One measurement, with every figure it is allowed to print. */
export interface MeasureSpan {
  /** Straight-line distance, metres. Never negative. */
  readonly straightM: number;
  /** Distance in plan — the shadow on the floor, metres. Never negative. */
  readonly planM: number;
  /** Height difference, metres, SIGNED: positive when the second point picked
   *  is the higher one. Direction is information a planner wants (is the beam
   *  above or below the truss line), so it is not thrown away here. */
  readonly riseM: number;
  /** Ready-to-render, e.g. "≈ 4.62 m". */
  readonly straightLabel: string;
  readonly planLabel: string;
  /** MAGNITUDE of the rise. The direction word is copy, not arithmetic — see
   *  measureRiseWord in measure-copy.ts. */
  readonly riseLabel: string;
}

/**
 * The mark every figure carries. It is a qualitative statement — "this is an
 * approximation" — and deliberately not a quantitative one, because this
 * capture publishes nothing that could quantify it (see the block above).
 *
 * Exported so the copy list, the tests and the layer all name the same
 * character rather than three files each typing their own lookalike (there are
 * several: U+2248, U+2245, an ASCII tilde).
 */
export const MEASURE_APPROX_MARK = "≈";

/**
 * Metres to a fixed two decimals.
 *
 * THIS IS A RENDERING CONVENTION, NOT A PRECISION CLAIM, and the distinction is
 * the one this module got wrong before. It is tempting to encode honesty in the
 * digit count — print "6.4 m" rather than "6.40 m" to hint at a decimetre of
 * doubt — but a digit count IS a numeral for uncertainty, spelled in
 * significant figures, and the capture supports that claim no better than it
 * supported "± 3 cm". So the figure prints at the resolution the arithmetic
 * works at, uniformly, and everything said about confidence is said in words.
 *
 * Deliberately NOT twin-rooms' `metres()`: that helper trims the trailing zero
 * because a room is 5.4 m long, not 5.40 m. Three figures in a monospace column
 * need one width, and a column that jitters between one and two decimals reads
 * as a machine unsure which it means.
 *
 * Locale-free by construction: `toFixed` is specified to emit "." regardless of
 * locale, unlike `toLocaleString`, which would print "4,60" in half of Europe —
 * a different number, not a different rendering.
 *
 * NEGATIVE ZERO is handled by the `Math.round`, not by a guard. `(-0.004)`
 * would print "-0.00" straight through `toFixed`, but `Math.round(-0.4)` is
 * `-0`, `-0 / 100` is `-0`, and `(-0).toFixed(2)` is specified to be "0.00" —
 * so the sign is already gone by the time the string is made. An earlier
 * revision carried an explicit `rounded === 0 ? 0 : rounded` fold here; mutation
 * testing showed it was unreachable (deleting it changed no observable
 * behaviour), and a branch that cannot fire is a branch that misleads the next
 * reader into thinking it is load-bearing. The `-0` cases stay pinned in the
 * suite: they now guard this composition rather than that guard.
 *
 * Not exported: every caller goes through `formatLength`, so there is no route
 * in this module to a rendered figure without its approximation mark.
 */
function fixedMetres(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/**
 * A length as this tool renders it, e.g. "≈ 4.62 m" — the ONLY way this module
 * renders a length. There is deliberately no exported "just the number"
 * formatter: a bare figure from a measuring tool is the liability this module
 * exists to remove, and the cheapest enforcement is to make the unsafe form
 * unreachable.
 */
export function formatLength(valueM: number): string {
  return `${MEASURE_APPROX_MARK} ${fixedMetres(valueM)} m`;
}

/**
 * The same figure for a live region, in words. Screen readers voice "m" as the
 * letter and treat "≈" inconsistently — some say "almost equal to", some say
 * nothing at all, and "nothing at all" would strip the only qualification the
 * visible figure carries. So the spoken form spends the syllables the visible
 * label saves and says "approximately" outright.
 */
export function spellLength(valueM: number): string {
  return `approximately ${fixedMetres(valueM)} metres`;
}

/**
 * True when a height difference does not survive the rounding this tool prints
 * at — i.e. when the rise renders as zero.
 *
 * This is the successor to the old `|rise| <= tolerance` test, and it is a
 * deliberately weaker, honest claim. It says nothing about what the capture can
 * resolve; it says only that the figure about to be shown reads as zero, so
 * calling it a rise would be naming a number we are not printing. Derived from
 * the formatter rather than from a second epsilon constant, so the word and the
 * figure beside it can never disagree.
 */
export function isLevelAtPrintedPrecision(riseM: number): boolean {
  return fixedMetres(Math.abs(riseM)) === fixedMetres(0);
}

/**
 * Measure between two points in three.js world space.
 *
 * `from` and `to` are in pick order; only `riseM` carries that order (as a
 * sign). Distances use `Math.sqrt` of the sum of squares rather than
 * `Math.hypot`: at building scale neither can overflow, and sqrt is exact for
 * the Pythagorean cases the tests pin, where hypot's precision is
 * implementation-defined.
 *
 * Takes no tier, and no other manifest field. It cannot: nothing the manifest
 * publishes describes this capture's measurement error (see the block at the
 * top of this file), so a parameter for it would only invite one to be invented
 * again.
 */
export function measureBetween(from: MeasureVec3, to: MeasureVec3): MeasureSpan {
  // Re-expressed in the CAPTURE frame before the split, so "plan" and "rise"
  // mean what the building means by them. The conversion is the pinned inverse
  // in twin-basis; it is never rewritten here.
  const delta = threeDirToE57([to[0] - from[0], to[1] - from[1], to[2] - from[2]]);
  const planM = Math.sqrt(delta[0] * delta[0] + delta[1] * delta[1]);
  const riseM = delta[2];
  const straightM = Math.sqrt(planM * planM + riseM * riseM);

  return {
    straightM,
    planM,
    riseM,
    straightLabel: formatLength(straightM),
    planLabel: formatLength(planM),
    riseLabel: formatLength(Math.abs(riseM)),
  };
}
