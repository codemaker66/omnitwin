// How closely the two gangway sweeps look: gangway-review.against-walls.test.ts (lone chairs set through the
// Saloon's alcoves, and pieces slid flush along every wall of the three shaped rooms) and
// gangway-review.click-sweep.test.ts (a click with every footprint in hand all over each shaped room).
//
// One environment variable decides it, here and nowhere else: VENVIEWER_FULL_SWEEPS. Set to the string "1",
// the sweeps run at their full density, as they were written. Unset, or anything else, they run at the
// per-pull-request density: the same sweeps of every shaped room and every piece in hand, each step a whole
// multiple of the full step (chairs every 9 cm through the alcoves for 3 cm, pieces slid 20 cm at a time for
// 1 cm, with the places where a piece's end meets a wall's end added, and a pointer every 0.92 m for 0.23 m),
// so the placements judged are among the full sweep's, in about a ninth of the time. Every hand-picked case
// in those files runs alike at both densities.
//
// Each sweep asserts how many placements it judged, in the range its density gives: a sweep that silently
// judges nothing, or a per-pull-request run that has quietly become the full one, fails.
//
// Nothing runs the full density on a schedule. To run it, from the repository root, one file per command:
//   VENVIEWER_FULL_SWEEPS=1 pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/gangway-review.against-walls.test.ts
//   VENVIEWER_FULL_SWEEPS=1 pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/gangway-review.click-sweep.test.ts

/** Whether the sweeps run at their full density: only when VENVIEWER_FULL_SWEEPS is the string "1". */
export const FULL_SWEEPS: boolean = process.env["VENVIEWER_FULL_SWEEPS"] === "1";

/** How many placements a sweep must judge: more than `above`, and no more than `atMost`. */
export interface JudgedRange {
  readonly above: number;
  readonly atMost: number;
}

export interface SweepDensity {
  readonly name: "full" | "per pull request";
  /** Lone chairs through each Saloon alcove: a step of `stepM`, `stepsOut` steps out from the back wall and `stepsAlong` steps along from the pier. */
  readonly alcoves: { readonly stepM: number; readonly stepsOut: number; readonly stepsAlong: number; readonly judged: JudgedRange; readonly againstAWallAbove: number };
  /**
   * A piece slid flush along every wall, `stepM` at a time; with `withEndsExactly`, also set at the four places
   * where its end is exactly at one of the wall's ends, either side, which a stride coarser than a centimetre
   * need not reach (the centimetre stride reaches them already).
   */
  readonly slide: { readonly stepM: number; readonly withEndsExactly: boolean; readonly judged: JudgedRange; readonly againstAWallAbove: number };
  /** A click every `pointerStepM` over a room's bounds; the clicks of one piece in one room, and of all of them in all three rooms. */
  readonly clicks: { readonly pointerStepM: number; readonly judgedEach: JudgedRange; readonly judgedInAll: JudgedRange; readonly againstAWallInAllAbove: number };
}

const NO_CEILING = Number.POSITIVE_INFINITY;

// The counts, measured at c5d94610 with these sweeps (22 November 2026), fewest to most:
//   full: alcoves, per turn, judged 6,024 to 6,364, against a wall 236 to 404; slide, per piece and room,
//   judged 4,524 to 8,725, against a wall 4,320 to 8,369; clicks, per piece and room, judged 5,498 to 9,590,
//   in all 768,610, against a wall in all 484,128.
//   per pull request: alcoves judged 724 to 784, against a wall 64 to 112; slide judged 249 to 506, against a
//   wall 230 to 483; clicks judged 360 to 622, in all 50,791, against a wall in all 32,883.
// Each per-pull-request floor keeps the headroom the full floor has over the fewest it measured (alcoves
// 4,000 of 6,024 and 100 of 236; slide 1,000 of 4,524 and 500 of 4,320; clicks 1,000 of 5,498, 100,000 of
// 768,610 and 30,000 of 484,128), rounded down. Its ceiling is half the fewest the full density judges: a
// per-pull-request run that judges more is not running at its own density.
const FULL: SweepDensity = {
  name: "full",
  alcoves: { stepM: 0.03, stepsOut: 30, stepsAlong: 60, judged: { above: 4000, atMost: NO_CEILING }, againstAWallAbove: 100 },
  slide: { stepM: 0.01, withEndsExactly: false, judged: { above: 1000, atMost: NO_CEILING }, againstAWallAbove: 500 },
  clicks: { pointerStepM: 0.23, judgedEach: { above: 1000, atMost: NO_CEILING }, judgedInAll: { above: 100_000, atMost: NO_CEILING }, againstAWallInAllAbove: 30_000 },
};

const PER_PULL_REQUEST: SweepDensity = {
  name: "per pull request",
  alcoves: { stepM: 0.09, stepsOut: 10, stepsAlong: 20, judged: { above: 480, atMost: 3000 }, againstAWallAbove: 25 },
  slide: { stepM: 0.2, withEndsExactly: true, judged: { above: 55, atMost: 2250 }, againstAWallAbove: 25 },
  clicks: { pointerStepM: 0.92, judgedEach: { above: 65, atMost: 2750 }, judgedInAll: { above: 6600, atMost: 384_000 }, againstAWallInAllAbove: 2000 },
};

/** The density the sweeps run at. */
export const SWEEP_DENSITY: SweepDensity = FULL_SWEEPS ? FULL : PER_PULL_REQUEST;
