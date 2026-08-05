import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { e57PointToThree } from "../../twin-basis.js";
import {
  MEASURE_APPROX_MARK,
  formatLength,
  isLevelAtPrintedPrecision,
  measureBetween,
  spellLength,
  type MeasureVec3,
} from "../measure-math.js";

// -----------------------------------------------------------------------------
// measure-math — the arithmetic behind the two-point measure, and the honesty of
// the figure it prints.
//
// Two things are on trial here, and the second is the one that cost this module
// its first review.
//
// The first is the axis convention. three.js is Y-up and the capture frame is
// Z-up, so "how far apart in plan" and "how much higher" are questions about the
// E57 frame, not about whichever three axis happens to look vertical. The
// convention tests below do NOT restate the swap — they build points in the
// capture frame, map them through the pinned `e57PointToThree`, and assert the
// answers come back in capture-frame terms, across all eight octants. That is
// the whole content of the module's "one alignment" claim, and it is enforced
// rather than asserted in prose: a hand-rolled permutation that happened to
// agree in the positive octant cannot survive the other seven.
//
// The second is uncertainty, and the finding is worth restating in the suite
// because a future reader will be tempted by exactly the same thing. This module
// used to derive a ± from the manifest `tier`. `tier` comes from an argv default
// in tools/twin-forge/src/cli.ts and its own schema calls it a planning tier
// that never implies certification. So the ± was a command-line flag presented
// as an instrument specification, to a planner who may order a marquee against
// it. The tests below therefore do not check that the ± is correct — they check
// that NO numeral for uncertainty exists on the module's surface or in its
// source, in any unit, and they read the source file to do it. A regression here
// is not a wrong number; it is a fabricated one.
// -----------------------------------------------------------------------------

const ORIGIN: MeasureVec3 = [0, 0, 0];

/**
 * Read a module of this feature as text.
 *
 * Resolved from the Vitest root (packages/web) rather than from
 * `import.meta.url`: Vitest transforms this file, so `import.meta.url` is not a
 * `file:` URL and `fileURLToPath` throws on it. The existence check is not
 * ceremony — without it a moved file would make every source guard below pass
 * vacuously on an empty string, which is the failure mode that makes a guard
 * worse than none.
 */
function readMeasureSource(basename: string): string {
  const path = resolve(process.cwd(), "src/twin/measure", basename);
  expect(existsSync(path), `source guard cannot find ${path}`).toBe(true);
  return readFileSync(path, "utf8");
}

/**
 * The same module with its comments removed.
 *
 * The identifier guards below have to run on CODE, because the prose is where
 * the refutation is recorded: the header of measure-math.ts quotes the forge's
 * `tier: { type: "string", default: "ops-grade-2cm" }` verbatim, and a guard
 * that cannot tell an explanation from a use would force that explanation to be
 * deleted to stay green — which is precisely backwards. Neither module contains
 * a URL or a `//` inside a string literal, so this stays a strip and not a
 * parser.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

const MEASURE_MATH_SOURCE = readMeasureSource("measure-math.ts");
const MEASURE_COPY_SOURCE = readMeasureSource("measure-copy.ts");
const MEASURE_MATH_CODE = stripComments(MEASURE_MATH_SOURCE);
const MEASURE_COPY_CODE = stripComments(MEASURE_COPY_SOURCE);

describe("measureBetween — geometry", () => {
  it("returns known distances exactly", () => {
    // 3-4-5 and 1-2-2-3 are exact in IEEE-754, so `toBe` is meaningful here:
    // it pins the arithmetic, not a rounding window that would hide a real
    // error of a few millimetres.
    expect(measureBetween(ORIGIN, [3, 0, 4]).straightM).toBe(5);
    expect(measureBetween(ORIGIN, [1, 2, 2]).straightM).toBe(3);
  });

  it("reports zero plan distance for a purely vertical span", () => {
    const span = measureBetween(ORIGIN, [0, 2.5, 0]);
    expect(span.planM).toBe(0);
    expect(span.riseM).toBe(2.5);
    expect(span.straightM).toBe(2.5);
  });

  it("reports zero rise for a purely horizontal span", () => {
    const span = measureBetween(ORIGIN, [1, 0, 1]);
    expect(span.riseM).toBe(0);
    expect(span.planM).toBeCloseTo(Math.SQRT2, 12);
  });

  it("splits plan and rise in the CAPTURE frame across every octant", () => {
    // The enforcement of the module's alignment claim. Points are built in E57
    // terms (Z-up metres) and mapped through the pinned basis module, so this
    // asserts agreement with twin-basis rather than restating its axis swap.
    //
    // Every sign combination is exercised on both endpoints. A hand-rolled swap
    // that transposed two axes, or dropped a negation, agrees with the real one
    // in some octants and not others — a single positive-octant sample is the
    // test that lets that through, so there isn't one.
    const magnitudes: MeasureVec3 = [2, 3, 5];
    const signs = [-1, 1] as const;

    for (const sx of signs) {
      for (const sy of signs) {
        for (const sz of signs) {
          const fromE57: MeasureVec3 = [
            sx * magnitudes[0],
            sy * magnitudes[1],
            sz * magnitudes[2],
          ];
          // Deliberately not the mirror of `from`: a symmetric pair would let a
          // sign error in the DELTA cancel out.
          const toE57: MeasureVec3 = [
            fromE57[0] + 1.25,
            fromE57[1] - 4.5,
            fromE57[2] + 0.75,
          ];

          const span = measureBetween(e57PointToThree(fromE57), e57PointToThree(toE57));

          expect(span.riseM).toBeCloseTo(toE57[2] - fromE57[2], 12);
          expect(span.planM).toBeCloseTo(
            Math.sqrt((toE57[0] - fromE57[0]) ** 2 + (toE57[1] - fromE57[1]) ** 2),
            12,
          );
          expect(span.straightM).toBeCloseTo(
            Math.sqrt(1.25 ** 2 + 4.5 ** 2 + 0.75 ** 2),
            12,
          );
        }
      }
    }
  });

  it("reads the capture's up-axis, not three's — a pure E57-Z move is all rise", () => {
    // The sharpest single case: 2 m straight up in the BUILDING. If the split
    // ever went through the render frame's Y this becomes all plan and no rise.
    const span = measureBetween(e57PointToThree([1, 1, 0]), e57PointToThree([1, 1, 2]));
    expect(span.planM).toBeCloseTo(0, 12);
    expect(span.riseM).toBeCloseTo(2, 12);
  });

  it("reads a pure E57-Y move as all plan — the axis a naive swap gets wrong", () => {
    const span = measureBetween(e57PointToThree([0, 0, 1]), e57PointToThree([0, 3, 1]));
    expect(span.planM).toBeCloseTo(3, 12);
    expect(span.riseM).toBeCloseTo(0, 12);
  });

  it("signs the rise by pick order and never signs the other two", () => {
    const up = measureBetween(ORIGIN, [0, 2, 0]);
    const down = measureBetween([0, 2, 0], ORIGIN);

    expect(up.riseM).toBe(2);
    expect(down.riseM).toBe(-2);
    // The straight line and the plan distance are lengths: order-free.
    expect(down.straightM).toBe(up.straightM);
    expect(down.planM).toBe(up.planM);
  });

  it("survives a degenerate span without producing a bare or absent figure", () => {
    const span = measureBetween(ORIGIN, ORIGIN);
    expect(span.straightM).toBe(0);
    // Zero is still a rendered figure, and it still carries its mark.
    expect(span.straightLabel).toBe("≈ 0.00 m");
  });
});

// -----------------------------------------------------------------------------
// The refutation, pinned. These are the tests that fail if somebody reinstates a
// tolerance — whether as a tier lookup, a constant, or a "temporary" literal.
// -----------------------------------------------------------------------------

describe("measure uncertainty — no numeral, by construction", () => {
  it("takes no tier and no other manifest field", () => {
    // The signature IS the guarantee: a value never handed in cannot leak out.
    // `.length` counts declared parameters, so a third one reappearing — under
    // any name — fails here before it can be plumbed to a lookup table.
    expect(measureBetween.length).toBe(2);
  });

  it("exposes no tolerance on the span it returns", () => {
    const span = measureBetween(ORIGIN, [3, 2, 6]);
    for (const banned of ["toleranceM", "tier", "tolerance", "sigma", "rms", "accuracyM"]) {
      expect(Object.hasOwn(span, banned)).toBe(false);
    }
    // Exactly the six figures the module is allowed to publish, and no seventh.
    expect(Object.keys(span).sort()).toEqual(
      ["planLabel", "planM", "riseLabel", "riseM", "straightLabel", "straightM"].sort(),
    );
  });

  it("prints no ± and no interval, on any figure", () => {
    const span = measureBetween(ORIGIN, [3, 2, 6]);
    for (const label of [span.straightLabel, span.planLabel, span.riseLabel]) {
      expect(label).not.toContain("±");
      expect(label).not.toContain("+/-");
      expect(label).not.toContain("cm");
      expect(label).not.toMatch(/\bplus or minus\b/i);
    }
    expect(spellLength(4.62)).not.toMatch(/plus or minus|±/i);
  });

  it("carries no tolerance arithmetic in its own code", () => {
    // A source read rather than an API check, because the failure mode is a
    // reintroduced PRIVATE helper feeding a public label — invisible to every
    // assertion that can only see exports. The banned tokens are the shapes the
    // refuted revision actually used, plus the obvious renames.
    for (const banned of [
      "MEASURE_TIER_TOLERANCE_M",
      "measureTolerance",
      "formatTolerance",
      "toleranceM",
      "SQRT2",
    ]) {
      expect(MEASURE_MATH_CODE).not.toContain(banned);
      expect(MEASURE_COPY_CODE).not.toContain(banned);
    }
    // `tier` survives only inside the block explaining why it is not used, and
    // comments are stripped above — so any hit here is a real read or index.
    expect(MEASURE_MATH_CODE).not.toMatch(/\btier\b/);
    expect(MEASURE_COPY_CODE).not.toMatch(/\btier\b/);
  });

  it("builds no interval by interpolation in either module", () => {
    // The one arithmetic shape a token sweep would miss: a ± assembled into a
    // template literal from a variable. Checked on raw source, since the
    // header's prose "± 3 cm" cannot match a `±${` pattern.
    for (const source of [MEASURE_MATH_SOURCE, MEASURE_COPY_SOURCE]) {
      expect(source).not.toMatch(/±\s*\$\{/);
    }
  });
});

describe("measure formatting", () => {
  it("never prints a bare number", () => {
    const span = measureBetween(ORIGIN, [3, 2, 6]);
    for (const label of [span.straightLabel, span.planLabel, span.riseLabel]) {
      expect(label).toContain(MEASURE_APPROX_MARK);
      expect(label).toMatch(/^≈ \d+\.\d{2} m$/);
    }
  });

  it("keeps two decimals, including the trailing zero", () => {
    // Uniform width in a monospace column. The digit count is a rendering
    // convention, NOT a precision claim — see the note in measure-math.ts on
    // why encoding doubt in significant figures is the same sin as the ±.
    expect(formatLength(4.6)).toBe("≈ 4.60 m");
    expect(formatLength(12)).toBe("≈ 12.00 m");
  });

  it("rounds to the centimetre and stays locale-free", () => {
    expect(formatLength(4.6149)).toBe("≈ 4.61 m");
    expect(formatLength(4.6151)).toBe("≈ 4.62 m");
    // A decimal comma here would be a different number to half of Europe, and
    // these figures are metres in a British venue's own units.
    expect(formatLength(1234.5)).not.toContain(",");
  });

  it("never prints a negative zero", () => {
    expect(formatLength(-0)).toBe("≈ 0.00 m");
    expect(formatLength(-0.001)).toBe("≈ 0.00 m");
  });

  it("spells the qualification out for a live region", () => {
    // Screen readers say "m" as a letter and treat "≈" inconsistently — some
    // say nothing at all, which would strip the only qualification the visible
    // figure carries. The spoken form says it outright.
    expect(spellLength(4.62)).toBe("approximately 4.62 metres");
    expect(spellLength(1)).toBe("approximately 1.00 metres");
    expect(spellLength(4.62)).not.toContain(MEASURE_APPROX_MARK);
  });
});

describe("isLevelAtPrintedPrecision", () => {
  it("is true exactly when the rise renders as zero", () => {
    // Derived from the formatter, so the word and the figure beside it cannot
    // disagree. These bounds are the rounding boundary, not a tolerance: they
    // are a fact about `toFixed(2)`, and they would move if the rendering did.
    expect(isLevelAtPrintedPrecision(0)).toBe(true);
    expect(isLevelAtPrintedPrecision(0.004)).toBe(true);
    expect(isLevelAtPrintedPrecision(-0.004)).toBe(true);
    expect(isLevelAtPrintedPrecision(0.006)).toBe(false);
    expect(isLevelAtPrintedPrecision(-0.006)).toBe(false);
  });

  it("agrees with the label the same span would print", () => {
    for (const rise of [0, 0.003, 0.005, 0.02, 0.5, -0.003, -0.02, -2]) {
      expect(isLevelAtPrintedPrecision(rise)).toBe(
        formatLength(Math.abs(rise)) === "≈ 0.00 m",
      );
    }
  });
});
