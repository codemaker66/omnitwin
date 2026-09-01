import { describe, expect, it } from "vitest";
import {
  PLANNER_TOOLS,
  SCALE_MAX,
  SCALE_MIN,
  clampScale,
  formatDegrees,
  formatMetres,
  formatScale,
  rotationFromDrag,
  scaleFromDrag,
  scrubRotation,
  scrubScale,
} from "../planner-tools.js";
import { ROTATION_SNAP_RAD } from "../selection.js";

// ---------------------------------------------------------------------------
// The tool pill's pure model. The drag maths run inside pointer handlers at
// frame rate, so every edge (degenerate grabs, snap boundaries, clamps) is
// pinned here where it costs microseconds, not screen glitches.
// ---------------------------------------------------------------------------

const CENTRE = { x: 2, z: 3 };

describe("PLANNER_TOOLS", () => {
  it("offers exactly the five hands, Select first", () => {
    expect(PLANNER_TOOLS.map((t) => t.id)).toEqual([
      "select", "move", "rotate", "scale", "measure",
    ]);
  });
});

describe("rotationFromDrag", () => {
  it("sweeps the object by the pointer's angular delta, snapped to 15°", () => {
    // Grab due south of the centre, drag a quarter-turn to due east.
    const grab = { x: 2, z: 4 };
    const current = { x: 3, z: 3 };
    const result = rotationFromDrag(CENTRE, grab, current, 0);
    expect(result).toBeCloseTo(Math.PI / 2, 10);
  });

  it("snaps a near-quarter-turn onto the 15° lattice", () => {
    const grab = { x: 2, z: 4 };
    // 84° of sweep — the nearest 15° step from zero is 90°.
    const angle = (84 * Math.PI) / 180;
    const current = { x: 2 + Math.sin(angle), z: 3 + Math.cos(angle) };
    const result = rotationFromDrag(CENTRE, grab, current, 0);
    expect(result % ROTATION_SNAP_RAD).toBeCloseTo(0, 10);
    expect(result).toBeCloseTo(Math.PI / 2, 10);
  });

  it("Shift frees the rotation from the lattice", () => {
    const grab = { x: 2, z: 4 };
    const angle = (84 * Math.PI) / 180;
    const current = { x: 2 + Math.sin(angle), z: 3 + Math.cos(angle) };
    const result = rotationFromDrag(CENTRE, grab, current, 0, true);
    expect(result).toBeCloseTo(angle, 6);
  });

  it("keeps the initial rotation when the grab is on the centre (degenerate)", () => {
    expect(rotationFromDrag(CENTRE, { x: 2.01, z: 3 }, { x: 3, z: 3 }, 1.1)).toBe(1.1);
    expect(rotationFromDrag(CENTRE, { x: 2, z: 4 }, { x: 2.01, z: 3.01 }, 1.1)).toBe(1.1);
  });

  it("applies the sweep on top of the rotation the object had at grab", () => {
    const grab = { x: 2, z: 4 };
    const current = { x: 3, z: 3 };
    const initial = Math.PI / 4; // 45°, already on the lattice
    const result = rotationFromDrag(CENTRE, grab, current, initial);
    expect(result).toBeCloseTo(initial + Math.PI / 2, 10);
  });
});

describe("scaleFromDrag", () => {
  it("scales by the distance ratio from the centre, snapped to 5%", () => {
    const grab = { x: 2, z: 4 }; // 1 m out
    const current = { x: 2, z: 4.53 }; // 1.53 m out → raw ×1.53 → snap ×1.55
    expect(scaleFromDrag(CENTRE, grab, current, 1)).toBeCloseTo(1.55, 10);
  });

  it("Shift frees the scale from the 5% lattice", () => {
    const grab = { x: 2, z: 4 };
    const current = { x: 2, z: 4.53 };
    expect(scaleFromDrag(CENTRE, grab, current, 1, true)).toBeCloseTo(1.53, 10);
  });

  it("clamps to the range the footprint engine stands behind", () => {
    const grab = { x: 2, z: 3.5 };
    expect(scaleFromDrag(CENTRE, grab, { x: 2, z: 33 }, 1)).toBe(SCALE_MAX);
    expect(scaleFromDrag(CENTRE, grab, { x: 2, z: 3.13 }, 1)).toBeCloseTo(SCALE_MIN, 10);
  });

  it("keeps the initial scale for a degenerate centre grab", () => {
    expect(scaleFromDrag(CENTRE, { x: 2.01, z: 3 }, { x: 4, z: 3 }, 1.4)).toBeCloseTo(1.4, 10);
  });
});

describe("scrubbing", () => {
  it("rotation scrub moves half a degree per pixel on a 1° lattice", () => {
    const result = scrubRotation(0, 90); // 45°
    expect(result).toBeCloseTo(Math.PI / 4, 10);
    // Never lands between whole degrees.
    const stepped = scrubRotation(0, 91); // 45.5° → rounds to a whole degree
    const degrees = (stepped * 180) / Math.PI;
    expect(Math.abs(degrees - Math.round(degrees))).toBeLessThan(1e-9);
  });

  it("scale scrub moves in fine hundredth steps and clamps", () => {
    expect(scrubScale(1, 10)).toBeCloseTo(1.05, 10);
    expect(scrubScale(1, -10)).toBeCloseTo(0.95, 10);
    expect(scrubScale(1, 100000)).toBe(SCALE_MAX);
    expect(scrubScale(1, -100000)).toBe(SCALE_MIN);
  });
});

describe("formatting — tabular, metric", () => {
  it("degrees normalise to [0°, 360°)", () => {
    expect(formatDegrees(0)).toBe("0°");
    expect(formatDegrees(Math.PI / 2)).toBe("90°");
    expect(formatDegrees(-Math.PI / 2)).toBe("270°");
    expect(formatDegrees(Math.PI * 2)).toBe("0°");
  });

  it("scale reads as a multiplier, metres as metres", () => {
    expect(formatScale(1.5)).toBe("×1.50");
    expect(formatMetres(3.2)).toBe("3.20 m");
  });
});

describe("clampScale", () => {
  it("holds both ends", () => {
    expect(clampScale(0)).toBe(SCALE_MIN);
    expect(clampScale(99)).toBe(SCALE_MAX);
    expect(clampScale(1)).toBe(1);
  });
});
