import { describe, expect, it } from "vitest";

// -----------------------------------------------------------------------------
// constellation-depth — the falloff maths and the depth policy, tested directly.
//
// This is the half of the constellation that decides how loudly each mark
// speaks. It is pure arithmetic on purpose: the alternative is a curve tuned by
// eye inside a component nobody can run in CI, which is exactly how a mark 25 m
// away across the hall ends up shouting as loudly as the one at your feet.
//
// The realistic inputs below are MEASURED, not invented. On 2026-08-05 the
// flagship bundle at packages/web/public/twin/trades-hall (149 poses,
// mesh/dollhouse.glb — 144 primitives, 330,200 triangles, 419,218 vertices) was
// walked offline in node: from scan_028 the 83 same-storey marks lie at 2.55 m
// (nearest), 12.18 m (median) and 25.10 m (farthest), seen at sines of
// elevation 0.547, 0.121 and 0.056 respectively. Those are the numbers the
// curve has to behave well across, so those are the numbers the tests use.
// -----------------------------------------------------------------------------

const {
  CONSTELLATION_FALLOFF,
  CONSTELLATION_HALO_MATERIAL,
  CONSTELLATION_OCCLUDER_DROP_M,
  CONSTELLATION_OCCLUDER_MATERIAL,
  CONSTELLATION_OCCLUDER_RENDER_ORDER,
  CONSTELLATION_RENDER_ORDER,
  CONSTELLATION_REWEIGHT_EPSILON_M,
  CONSTELLATION_WEIGHTED_MATERIAL,
  constellationDistanceWeight,
  constellationGrazeWeight,
  constellationNeedsReweight,
  constellationOccluderPosition,
  constellationVertexWeight,
  makeConstellationWeightBuffer,
  writeConstellationWeights,
} = await import("../constellation-depth.js");

const { MESH_OFFSET_M } = await import("../../twin-basis.js");

/** The walk's eye: the camera sits on the scan pose, 1.53 m up at scan_028. */
const EYE: readonly [number, number, number] = [0, 1.53, 0];
/** The tripod subtraction FloorConstellation applies (NavMarkers' datum + 15 mm). */
const MARK_DROP_M = 1.365;

/** A mark `horizontalM` away on the same floor plane as the standing node. */
function markAt(horizontalM: number): [number, number, number] {
  return [horizontalM, EYE[1] - MARK_DROP_M, 0];
}

describe("constellationDistanceWeight", () => {
  it("costs nothing inside the near band — the marks at your feet are full strength", () => {
    expect(constellationDistanceWeight(0)).toBe(1);
    expect(constellationDistanceWeight(1)).toBe(1);
    expect(constellationDistanceWeight(CONSTELLATION_FALLOFF.fullM)).toBe(1);
  });

  it("never climbs back up, anywhere on a 0–60 m sweep", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let d = 0; d <= 60; d += 0.25) {
      const weight = constellationDistanceWeight(d);
      expect(weight).toBeLessThanOrEqual(previous + 1e-12);
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
      previous = weight;
    }
  });

  it("falls strictly through the fade band", () => {
    const { fullM, fadeM } = CONSTELLATION_FALLOFF;
    const step = (fadeM - fullM) / 12;
    let previous = constellationDistanceWeight(fullM);
    for (let d = fullM + step; d < fadeM; d += step) {
      const weight = constellationDistanceWeight(d);
      expect(weight).toBeLessThan(previous);
      previous = weight;
    }
  });

  it("bottoms out at the far weight and stays there — a far mark is quiet, never absent", () => {
    const { fadeM, farWeight } = CONSTELLATION_FALLOFF;
    expect(farWeight).toBeGreaterThan(0);
    expect(constellationDistanceWeight(fadeM)).toBeCloseTo(farWeight, 12);
    expect(constellationDistanceWeight(fadeM + 40)).toBeCloseTo(farWeight, 12);
    // A mark dropped at the far end of the longest measured sight line (25.10 m
    // from scan_028) is still drawn — omitting it would be a lie about where
    // the walk can go.
    expect(constellationDistanceWeight(25.1)).toBeGreaterThan(0);
  });
});

describe("constellationGrazeWeight", () => {
  it("is full strength looking straight down at the mark underfoot", () => {
    expect(constellationGrazeWeight(1.365, 1.365)).toBe(1);
  });

  it("bottoms out at the graze floor when the sight line lies in the floor plane", () => {
    expect(constellationGrazeWeight(0, 12)).toBeCloseTo(CONSTELLATION_FALLOFF.grazeFloor, 12);
    expect(CONSTELLATION_FALLOFF.grazeFloor).toBeGreaterThan(0);
  });

  it("rises strictly as the sight line lifts out of the floor", () => {
    let previous = constellationGrazeWeight(0, 12);
    for (let rise = 0.5; rise <= 12; rise += 0.5) {
      const weight = constellationGrazeWeight(rise, 12);
      expect(weight).toBeGreaterThan(previous);
      previous = weight;
    }
  });

  it("does not care which side of the floor plane the eye is on", () => {
    expect(constellationGrazeWeight(-1.2, 6)).toBeCloseTo(constellationGrazeWeight(1.2, 6), 12);
  });

  it("stays inside 0–1 for impossible geometry rather than exploding", () => {
    // rise > distance cannot happen for a real sight line, but a degenerate
    // pose or a zero-length ray must not hand a NaN to a GPU buffer.
    expect(constellationGrazeWeight(50, 1)).toBe(1);
    expect(constellationGrazeWeight(0, 0)).toBe(1);
    expect(constellationGrazeWeight(-3, 0)).toBe(1);
  });
});

describe("constellationVertexWeight", () => {
  it("never fades the mark the visitor is standing on", () => {
    expect(constellationVertexWeight(EYE, markAt(0))).toBe(1);
  });

  it("returns full strength when the eye is exactly on the mark — no divide by zero", () => {
    const weight = constellationVertexWeight(EYE, [EYE[0], EYE[1], EYE[2]]);
    expect(Number.isNaN(weight)).toBe(false);
    expect(weight).toBe(1);
  });

  it("quietens monotonically all the way across the building", () => {
    let previous = constellationVertexWeight(EYE, markAt(0));
    for (let horizontal = 0.5; horizontal <= 40; horizontal += 0.5) {
      const weight = constellationVertexWeight(EYE, markAt(horizontal));
      expect(weight).toBeLessThan(previous);
      previous = weight;
    }
  });

  it("stays inside 0–1 across a grid of real and pathological positions", () => {
    for (let horizontal = 0; horizontal <= 60; horizontal += 1.5) {
      for (let height = -8; height <= 8; height += 1) {
        const weight = constellationVertexWeight(EYE, [horizontal, height, -horizontal]);
        expect(weight).toBeGreaterThanOrEqual(0);
        expect(weight).toBeLessThanOrEqual(1);
      }
    }
  });

  it("makes the far end of the capture materially quieter than the mark underfoot", () => {
    // The brief's actual requirement, in numbers: at 25.10 m — the longest
    // same-storey sight line measured from scan_028 — the mark must not shout,
    // but it must still be there.
    const underfoot = constellationVertexWeight(EYE, markAt(0));
    const acrossTheRoom = constellationVertexWeight(EYE, markAt(25.1));
    expect(acrossTheRoom).toBeLessThan(underfoot / 4);
    expect(acrossTheRoom).toBeGreaterThan(0.05);
  });

  it("separates the median mark from both extremes", () => {
    const near = constellationVertexWeight(EYE, markAt(2.55));
    const median = constellationVertexWeight(EYE, markAt(12.18));
    const far = constellationVertexWeight(EYE, markAt(25.1));
    expect(near).toBeGreaterThan(median);
    expect(median).toBeGreaterThan(far);
  });
});

describe("a broken pose is the QUIETEST mark, not the loudest", () => {
  /**
   * The trap this whole describe exists for.
   *
   * The obvious guard against a zero-length sight line is `if (!(distanceM > 0))
   * return 1` — you are standing on the mark, so it stays bright. But
   * `!(NaN > 0)` is also true, so a pose that has gone NaN takes that same
   * branch and is painted at FULL strength: the one mark in the building the
   * viewer knows nothing about becomes the loudest thing on the floor. The
   * failure mode is a confident bright claim about a viewpoint that does not
   * exist, which is the exact failure this viewer is built not to make.
   *
   * Finiteness must therefore be tested BEFORE zero, everywhere.
   */
  const QUIETEST = CONSTELLATION_FALLOFF.farWeight * CONSTELLATION_FALLOFF.grazeFloor;

  it("does not mistake a NaN pose for standing on the mark", () => {
    const nan = constellationVertexWeight(EYE, [Number.NaN, Number.NaN, Number.NaN]);
    expect(Number.isNaN(nan)).toBe(false);
    expect(nan).not.toBe(1);
    expect(nan).toBeCloseTo(QUIETEST, 12);
    // …while a genuine zero-length sight line still means exactly what it says.
    expect(constellationVertexWeight(EYE, [EYE[0], EYE[1], EYE[2]])).toBe(1);
  });

  it("quietens an infinite pose too, on any single axis", () => {
    for (const broken of [
      [Number.POSITIVE_INFINITY, EYE[1], 0],
      [0, Number.NEGATIVE_INFINITY, 0],
      [0, EYE[1], Number.NaN],
    ] as const) {
      const weight = constellationVertexWeight(EYE, broken);
      expect(Number.isFinite(weight)).toBe(true);
      expect(weight).toBeLessThan(constellationVertexWeight(EYE, markAt(25.1)) + 1e-9);
    }
  });

  it("keeps the same asymmetry inside the graze term", () => {
    // Zero distance is bright because it is real; a NaN sight line is not.
    expect(constellationGrazeWeight(0, 0)).toBe(1);
    expect(constellationGrazeWeight(Number.NaN, 12)).toBeCloseTo(
      CONSTELLATION_FALLOFF.grazeFloor,
      12,
    );
    expect(constellationGrazeWeight(1, Number.NaN)).toBeCloseTo(
      CONSTELLATION_FALLOFF.grazeFloor,
      12,
    );
    // A negative distance is nonsense rather than a near mark: clamping the
    // sine keeps Math.pow off a negative base with a fractional exponent, which
    // is where the NaN used to come from.
    expect(Number.isFinite(constellationGrazeWeight(1, -5))).toBe(true);
  });

  it("keeps the distance term finite for a non-finite range", () => {
    expect(constellationDistanceWeight(Number.NaN)).toBeCloseTo(
      CONSTELLATION_FALLOFF.farWeight,
      12,
    );
    expect(constellationDistanceWeight(Number.POSITIVE_INFINITY)).toBeCloseTo(
      CONSTELLATION_FALLOFF.farWeight,
      12,
    );
  });

  it("draws nothing rather than NaN if the falloff curve itself is broken", () => {
    // `falloff` is a parameter, so a caller can hand in a curve that is not
    // numbers. Transparent is the only failure value that cannot be mistaken
    // for a claim; NaN in a vertex alpha is read by the driver as it pleases,
    // and in practice that means opaque.
    const broken = { ...CONSTELLATION_FALLOFF, grazeFloor: Number.NaN };
    const weight = constellationVertexWeight(EYE, markAt(8), broken);
    expect(Number.isNaN(weight)).toBe(false);
    expect(weight).toBe(0);
  });
});

describe("writeConstellationWeights", () => {
  it("writes one opaque-white RGBA per vertex, carrying the weight in alpha", () => {
    const positions = new Float32Array([...markAt(0), ...markAt(12.18), ...markAt(25.1)]);
    const out = makeConstellationWeightBuffer(3);

    writeConstellationWeights(positions, EYE, out);

    expect(out).toHaveLength(12);
    for (let vertex = 0; vertex < 3; vertex += 1) {
      // RGB stays white: the tint is the material's, so the vertex buffer can
      // only ever quieten a mark, never recolour one.
      expect(out[vertex * 4]).toBe(1);
      expect(out[vertex * 4 + 1]).toBe(1);
      expect(out[vertex * 4 + 2]).toBe(1);
    }
    expect(out[3]).toBeCloseTo(constellationVertexWeight(EYE, markAt(0)), 6);
    expect(out[7]).toBeCloseTo(constellationVertexWeight(EYE, markAt(12.18)), 6);
    expect(out[11]).toBeCloseTo(constellationVertexWeight(EYE, markAt(25.1)), 6);
  });

  it("returns the buffer it filled, so a caller can flag it dirty in one line", () => {
    const out = makeConstellationWeightBuffer(1);
    expect(writeConstellationWeights(new Float32Array(markAt(4)), EYE, out)).toBe(out);
  });

  it("handles an empty plan without touching anything", () => {
    const out = makeConstellationWeightBuffer(0);
    expect(writeConstellationWeights(new Float32Array(0), EYE, out)).toHaveLength(0);
  });

  it("refuses a buffer too small for the positions rather than truncating in silence", () => {
    // Silent truncation would leave the tail of the graph at whatever weight it
    // last had — a stripe of marks frozen bright while the rest fade.
    expect(() =>
      writeConstellationWeights(new Float32Array(6), EYE, makeConstellationWeightBuffer(1)),
    ).toThrow(RangeError);
  });

  it("refuses a ragged positions array rather than dropping the last mark", () => {
    // `Math.floor(length / 3)` is the natural spelling and it silently discards
    // the tail of a positions buffer that is not a whole number of vertices.
    // The mark it discards keeps whatever weight it was BUILT with — opaque —
    // so the symptom is one permanently bright mark, not a missing one, which
    // is the harder bug to see and the worse one to ship.
    expect(() =>
      writeConstellationWeights(new Float32Array(7), EYE, makeConstellationWeightBuffer(3)),
    ).toThrow(RangeError);
    expect(() =>
      writeConstellationWeights(new Float32Array(5), EYE, makeConstellationWeightBuffer(2)),
    ).toThrow(RangeError);
    // A whole number of vertices is still accepted, including none at all.
    expect(() =>
      writeConstellationWeights(new Float32Array(6), EYE, makeConstellationWeightBuffer(2)),
    ).not.toThrow();
    expect(() =>
      writeConstellationWeights(new Float32Array(0), EYE, makeConstellationWeightBuffer(0)),
    ).not.toThrow();
  });

  it("never writes a non-finite alpha, whatever the pose", () => {
    // Every value this function writes lands in a GPU alpha channel. NaN there
    // is not a quiet mark, it is undefined behaviour with a bright default.
    const positions = new Float32Array([
      ...markAt(4),
      Number.NaN,
      Number.NaN,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      0,
      0,
    ]);
    const out = writeConstellationWeights(positions, EYE, makeConstellationWeightBuffer(3));

    for (const value of out) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("allocates four components per vertex, pre-filled opaque", () => {
    const buffer = makeConstellationWeightBuffer(2);
    expect(buffer).toHaveLength(8);
    expect(Array.from(buffer)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });
});

describe("constellationNeedsReweight", () => {
  it("always writes on the first frame — an unwritten buffer is full brightness", () => {
    expect(constellationNeedsReweight(null, EYE)).toBe(true);
  });

  it("ignores sub-centimetre camera jitter", () => {
    expect(constellationNeedsReweight(EYE, [EYE[0], EYE[1], EYE[2]])).toBe(false);
    const nudge = CONSTELLATION_REWEIGHT_EPSILON_M / 4;
    expect(constellationNeedsReweight(EYE, [EYE[0] + nudge, EYE[1], EYE[2]])).toBe(false);
  });

  it("rewrites once the eye has actually travelled, on any axis", () => {
    const step = CONSTELLATION_REWEIGHT_EPSILON_M * 2;
    expect(constellationNeedsReweight(EYE, [EYE[0] + step, EYE[1], EYE[2]])).toBe(true);
    expect(constellationNeedsReweight(EYE, [EYE[0], EYE[1] + step, EYE[2]])).toBe(true);
    expect(constellationNeedsReweight(EYE, [EYE[0], EYE[1], EYE[2] + step])).toBe(true);
  });

  it("keeps the threshold well under a single walk step", () => {
    expect(CONSTELLATION_REWEIGHT_EPSILON_M).toBeGreaterThan(0);
    expect(CONSTELLATION_REWEIGHT_EPSILON_M).toBeLessThan(0.1);
  });

  it("never freezes the graph against a camera that has gone non-finite", () => {
    // `Math.abs(NaN - x) >= epsilon` is FALSE, so a plain comparison answers
    // "no rewrite needed" to a NaN camera — and keeps answering it for ever,
    // because the eye it is compared against is NaN too from then on. The graph
    // would stick at whatever brightness it last held and never respond to the
    // camera again, including after the camera recovered.
    const broken: [number, number, number] = [Number.NaN, 1.53, 0];
    expect(constellationNeedsReweight(EYE, broken)).toBe(true);
    expect(constellationNeedsReweight(broken, broken)).toBe(true);
    expect(constellationNeedsReweight(broken, EYE)).toBe(true);
    expect(
      constellationNeedsReweight(EYE, [0, Number.POSITIVE_INFINITY, 0]),
    ).toBe(true);
  });
});

describe("the depth policy", () => {
  /**
   * Measured 2026-08-05 by casting a ray straight down from all 149 poses of
   * the flagship bundle into mesh/dollhouse.glb: the mesh's own floor sits
   * BELOW the graph's pose-derived floor at 148 of them (median 0.116 m below).
   * At the single exception, scan_145, it sits 0.092 m ABOVE — high enough to
   * swallow that node's marks whole if the occluder were not lowered.
   */
  const MEASURED_WORST_FLOOR_DISAGREEMENT_M = 0.092;

  it("lowers the occluder past the worst measured floor disagreement", () => {
    expect(CONSTELLATION_OCCLUDER_DROP_M).toBeGreaterThan(MEASURED_WORST_FLOOR_DISAGREEMENT_M);
  });

  it("keeps the drop far below a storey, so walls still occlude", () => {
    // Measured on the same run: lowering the occluder by 0, 0.10, 0.25, 0.50
    // and even 1.00 m left the count of marks behind geometry from scan_028
    // identical at 37 of 83 — the bias is paid for out of nothing. It stays
    // small anyway, because everything it buys is bought by the first 0.1 m.
    expect(CONSTELLATION_OCCLUDER_DROP_M).toBeLessThan(0.5);
  });

  it("queues the occluder after the panorama and the graph after the occluder", () => {
    // PanoStage draws the resting sphere at renderOrder 0 and the arriving one
    // at 1, both transparent with depthWrite off. An occluder drawn BEFORE them
    // would erase the photograph (it writes depth and no colour); a graph drawn
    // before the occluder would never be tested against it.
    expect(CONSTELLATION_OCCLUDER_RENDER_ORDER).toBeGreaterThan(1);
    expect(CONSTELLATION_RENDER_ORDER).toBeGreaterThan(CONSTELLATION_OCCLUDER_RENDER_ORDER);
  });

  it("lowers the occluder from the calibrated mesh offset, never from zero", () => {
    // MESH_OFFSET_M is twin-basis's single alignment surface for this mesh. An
    // occluder that hardcoded [0, -drop, 0] would silently stop tracking the
    // mesh the moment that calibration moved, and the graph would start being
    // clipped by a building standing somewhere the building is not.
    expect(constellationOccluderPosition()).toEqual([
      MESH_OFFSET_M[0],
      MESH_OFFSET_M[1] - CONSTELLATION_OCCLUDER_DROP_M,
      MESH_OFFSET_M[2],
    ]);
  });
});

describe("the material flags", () => {
  it("turns vertex colours on for the weighted layers — the whole falloff hangs on it", () => {
    // three compiles USE_COLOR_ALPHA only when the material asks for vertex
    // colours AND the attribute has four components. Drop either and the
    // per-vertex weights vanish without an error: every mark draws full weight
    // and the fade silently does not exist.
    expect(CONSTELLATION_WEIGHTED_MATERIAL.vertexColors).toBe(true);
    expect(CONSTELLATION_WEIGHTED_MATERIAL.transparent).toBe(true);
  });

  it("depth-tests the graph but never lets it write depth", () => {
    // Testing is the occlusion. NOT writing is what keeps the graph from
    // punching a hole in the nav rings, which are the affordance and outrank it.
    expect(CONSTELLATION_WEIGHTED_MATERIAL.depthTest).toBe(true);
    expect(CONSTELLATION_WEIGHTED_MATERIAL.depthWrite).toBe(false);
    expect(CONSTELLATION_HALO_MATERIAL.depthTest).toBe(true);
    expect(CONSTELLATION_HALO_MATERIAL.depthWrite).toBe(false);
  });

  it("keeps vertex colours OFF the halo, which has no colour attribute", () => {
    // A material that declares USE_COLOR over a geometry with no colour
    // attribute reads the disabled attrib's default — black — and the halo
    // would render as three dark rings on the floor rather than gold ones.
    expect("vertexColors" in CONSTELLATION_HALO_MATERIAL).toBe(false);
  });

  it("makes the occluder write depth and no colour, in the transparent queue", () => {
    expect(CONSTELLATION_OCCLUDER_MATERIAL.colorWrite).toBe(false);
    expect(CONSTELLATION_OCCLUDER_MATERIAL.depthWrite).toBe(true);
    // Transparent is not decoration: it is the only way to be queued AFTER the
    // panorama. An opaque occluder draws in the opaque pass, before every pano
    // sphere, and erases the photograph it was meant to sit behind.
    expect(CONSTELLATION_OCCLUDER_MATERIAL.transparent).toBe(true);
  });
});
