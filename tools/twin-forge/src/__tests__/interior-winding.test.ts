import { describe, expect, it } from "vitest";
import {
  classifyTriangleTowardPoint,
  orientTriangleIndicesTowardCapture,
} from "../interior-winding.js";

describe("classifyTriangleTowardPoint", () => {
  const a = [0, 0, 0] as const;
  const b = [1, 0, 0] as const;
  const c = [0, 1, 0] as const;

  it("classifies normals facing toward and away from a capture witness", () => {
    expect(classifyTriangleTowardPoint(a, b, c, [0.25, 0.25, 1])).toBe("keep");
    expect(classifyTriangleTowardPoint(a, b, c, [0.25, 0.25, -1])).toBe("flip");
  });

  it("classifies coplanar witnesses as ambiguous and zero-area triangles as degenerate", () => {
    expect(classifyTriangleTowardPoint(a, b, c, [0.25, 0.25, 0])).toBe("ambiguous");
    expect(classifyTriangleTowardPoint(a, b, [2, 0, 0], [0, 0, 1])).toBe("degenerate");
  });

  it("rejects non-finite triangle vertices and witnesses", () => {
    expect(() => classifyTriangleTowardPoint([Number.NaN, 0, 0], b, c, [0, 0, 1])).toThrow(
      "triangle vertex a",
    );
    expect(() => classifyTriangleTowardPoint(a, b, c, [0, Number.POSITIVE_INFINITY, 1])).toThrow(
      "capture witness",
    );
  });
});

describe("orientTriangleIndicesTowardCapture", () => {
  it("uses the nearest capture witness to classify each triangle centroid", () => {
    const positions = [
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      10, 0, 0,
      11, 0, 0,
      10, 1, 0,
    ];
    const source = new Uint16Array([0, 1, 2, 3, 4, 5]);

    const result = orientTriangleIndicesTowardCapture({
      positions,
      indices: source,
      capturePositions: [
        [0.25, 0.25, 1],
        [10.25, 0.25, -1],
      ],
    });

    expect([...result.indices]).toEqual([0, 1, 2, 3, 5, 4]);
    expect(result.report).toEqual({
      keep: 1,
      flip: 1,
      ambiguous: 0,
      degenerate: 0,
      triangles: 2,
    });
  });

  it("leaves ambiguous and degenerate triangles unchanged and reports them", () => {
    const source = new Uint16Array([0, 1, 2, 3, 4, 5]);
    const result = orientTriangleIndicesTowardCapture({
      positions: [
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        10, 0, 0,
        11, 0, 0,
        12, 0, 0,
      ],
      indices: source,
      capturePositions: [[0.25, 0.25, 0]],
    });

    expect([...result.indices]).toEqual([...source]);
    expect(result.report).toEqual({
      keep: 0,
      flip: 0,
      ambiguous: 1,
      degenerate: 1,
      triangles: 2,
    });
  });

  it("classifies conflicting equidistant witnesses as ambiguous regardless of capture order", () => {
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const indices = new Uint16Array([0, 1, 2]);
    const above = [1 / 3, 1 / 3, 1] as const;
    const below = [1 / 3, 1 / 3, -1] as const;

    const aboveFirst = orientTriangleIndicesTowardCapture({
      positions,
      indices,
      capturePositions: [above, below],
    });
    const belowFirst = orientTriangleIndicesTowardCapture({
      positions,
      indices,
      capturePositions: [below, above],
    });

    expect([...aboveFirst.indices]).toEqual([0, 1, 2]);
    expect(belowFirst).toEqual(aboveFirst);
    expect(aboveFirst.report.ambiguous).toBe(1);
  });

  it("compares capture distances without overflow or underflow", () => {
    const huge = 1e200;
    const hugeResult = orientTriangleIndicesTowardCapture({
      positions: [0, 0, 0, huge, 0, 0, 0, huge, 0],
      indices: new Uint32Array([0, 1, 2]),
      capturePositions: [[0, 0, huge]],
    });
    expect(hugeResult.report.keep).toBe(1);

    const tiny = 1e-200;
    const tinyResult = orientTriangleIndicesTowardCapture({
      positions: [0, 0, 0, tiny, 0, 0, 0, tiny, 0],
      indices: new Uint16Array([0, 1, 2]),
      capturePositions: [
        [tiny / 3, tiny / 3, -2 * tiny],
        [tiny / 3, tiny / 3, tiny],
      ],
    });
    expect(tinyResult.report.keep).toBe(1);
    expect([...tinyResult.indices]).toEqual([0, 1, 2]);
  });

  it("clones Uint16 indices without mutating the source", () => {
    const source = new Uint16Array([0, 1, 2]);
    const result = orientTriangleIndicesTowardCapture({
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      indices: source,
      capturePositions: [[0, 0, -1]],
    });

    expect(result.indices).toBeInstanceOf(Uint16Array);
    expect(result.indices).not.toBe(source);
    expect([...source]).toEqual([0, 1, 2]);
    expect([...result.indices]).toEqual([0, 2, 1]);
  });

  it("clones Uint32 indices without mutating the source", () => {
    const source = new Uint32Array([0, 1, 2]);
    const result = orientTriangleIndicesTowardCapture({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: source,
      capturePositions: [[0, 0, -1]],
    });

    expect(result.indices).toBeInstanceOf(Uint32Array);
    expect(result.indices).not.toBe(source);
    expect([...source]).toEqual([0, 1, 2]);
    expect([...result.indices]).toEqual([0, 2, 1]);
  });

  it("rejects malformed or non-finite positions", () => {
    expect(() =>
      orientTriangleIndicesTowardCapture({
        positions: [0, 0, 0, 1],
        indices: new Uint16Array(),
        capturePositions: [],
      }),
    ).toThrow("positions length");

    expect(() =>
      orientTriangleIndicesTowardCapture({
        positions: [0, 0, 0, 1, 0, 0, 0, Number.NaN, 0],
        indices: new Uint16Array([0, 1, 2]),
        capturePositions: [[0, 0, 1]],
      }),
    ).toThrow("positions[7]");
  });

  it("rejects malformed or out-of-range indices", () => {
    expect(() =>
      orientTriangleIndicesTowardCapture({
        positions: [0, 0, 0],
        indices: new Uint16Array([0, 0]),
        capturePositions: [[0, 0, 1]],
      }),
    ).toThrow("indices length");

    expect(() =>
      orientTriangleIndicesTowardCapture({
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        indices: new Uint32Array([0, 1, 3]),
        capturePositions: [[0, 0, 1]],
      }),
    ).toThrow("indices[2]");
  });

  it("rejects missing and non-finite capture witnesses for non-empty geometry", () => {
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const indices = new Uint16Array([0, 1, 2]);

    expect(() =>
      orientTriangleIndicesTowardCapture({ positions, indices, capturePositions: [] }),
    ).toThrow("capture position");
    expect(() =>
      orientTriangleIndicesTowardCapture({
        positions,
        indices,
        capturePositions: [[0, 0, Number.NEGATIVE_INFINITY]],
      }),
    ).toThrow("capturePositions[0]");
  });

  it("accepts an empty index buffer and returns an empty report", () => {
    const source = new Uint16Array();
    const result = orientTriangleIndicesTowardCapture({
      positions: [],
      indices: source,
      capturePositions: [],
    });

    expect(result.indices).toBeInstanceOf(Uint16Array);
    expect(result.indices).not.toBe(source);
    expect(result.report).toEqual({
      keep: 0,
      flip: 0,
      ambiguous: 0,
      degenerate: 0,
      triangles: 0,
    });
  });
});
