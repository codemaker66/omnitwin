import { describe, expect, it } from "vitest";
import type { BufferGeometry } from "three";
import { MeshBuilder } from "../mesh-builder.js";

/** Volume enclosed by a closed mesh, positive when its faces turn outward. */
function signedVolume(geometry: BufferGeometry): number {
  const position = geometry.getAttribute("position");
  const index = geometry.index;
  if (index === null) return 0;
  let volume = 0;
  for (let t = 0; t < index.count; t += 3) {
    const [a, b, c] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    const [ax, ay, az] = [position.getX(a), position.getY(a), position.getZ(a)];
    const [bx, by, bz] = [position.getX(b), position.getY(b), position.getZ(b)];
    const [cx, cy, cz] = [position.getX(c), position.getY(c), position.getZ(c)];
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return volume;
}

const BALL: readonly (readonly [number, number])[] = [[0, -1], [0.7, -0.7], [1, 0], [0.7, 0.7], [0, 1]];

describe("MeshBuilder", () => {
  it("faces a lathe outward whichever way its profile is drawn", () => {
    const climbing = new MeshBuilder();
    climbing.lathe([2, 1, -3], BALL, 24);
    const falling = new MeshBuilder();
    falling.lathe([2, 1, -3], [...BALL].reverse(), 24);
    const up = signedVolume(climbing.build());
    expect(up).toBeGreaterThan(2.5);
    expect(signedVolume(falling.build())).toBeCloseTo(up, 9);
  });

  it("leaves out the zero-area halves of the quads at a lathe's poles", () => {
    const builder = new MeshBuilder();
    builder.lathe([0, 0, 0], BALL, 12);
    // Four bands of 12 quads, less one triangle per quad at each pole.
    expect(builder.triangles).toBe(4 * 12 * 2 - 2 * 12);
  });

  it("keeps a lathe's corners sharp past its crease, and its curves smooth", () => {
    const drum: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [1, 2], [0, 2]];
    // The normals' heights at the vertices off the axis (the rims' rings).
    const rimNormalsY = (geometry: BufferGeometry): number[] => {
      const position = geometry.getAttribute("position");
      const normal = geometry.getAttribute("normal");
      const ys: number[] = [];
      for (let i = 0; i < position.count; i++) {
        if (Math.hypot(position.getX(i), position.getZ(i)) > 0.5) ys.push(normal.getY(i));
      }
      return ys;
    };
    const smooth = new MeshBuilder();
    smooth.lathe([0, 0, 0], drum, 8);
    const creased = new MeshBuilder();
    creased.lathe([0, 0, 0], drum, 8, 1, 1, 0, Math.PI / 3);
    // Smooth throughout (the default), each rim's one ring leans toward its cap and the side shades as a ball's.
    // (Normals are stored as 32-bit floats.)
    expect(Math.max(...rimNormalsY(smooth.build()).map(Math.abs))).toBeCloseTo(1 / Math.sqrt(5), 6);
    // Creased, each rim has a ring facing its cap (straight down or up) and one facing out (level).
    const ys = rimNormalsY(creased.build());
    expect(ys.every((y) => Math.abs(y) < 1e-6 || Math.abs(Math.abs(y) - 1) < 1e-6)).toBe(true);
    expect(ys.filter((y) => Math.abs(y) < 1e-6).length).toBe(2 * 9);
    // The same faces and volume: only the corners' normals change.
    expect(creased.triangles).toBe(smooth.triangles);
    expect(signedVolume(creased.build())).toBeCloseTo(signedVolume(smooth.build()), 9);
    // A ball's gentler turns (44-46°) stay smooth under the same crease: one ring a point.
    const ball = new MeshBuilder();
    ball.lathe([0, 0, 0], BALL, 12, 1, 1, 0, Math.PI / 3);
    expect(ball.build().getAttribute("position").count).toBe(BALL.length * 13);
  });

  it("merges another builder moved by a translation, with its indices offset", () => {
    const first = new MeshBuilder();
    first.lathe([0, 0, 0], BALL, 6);
    const part = new MeshBuilder();
    part.lathe([0, 0, 0], BALL, 6);
    const merged = new MeshBuilder();
    merged.merge(first);
    merged.merge(part, [5, -2, 1]);
    expect(merged.vertices).toBe(first.vertices + part.vertices);
    expect(merged.triangles).toBe(first.triangles + part.triangles);
    const data = merged.arrays();
    const source = part.arrays();
    const offset = first.vertices;
    expect(data.positions[offset * 3]).toBeCloseTo((source.positions[0] ?? 0) + 5, 6);
    expect(data.positions[offset * 3 + 1]).toBeCloseTo((source.positions[1] ?? 0) - 2, 6);
    expect(data.positions[offset * 3 + 2]).toBeCloseTo((source.positions[2] ?? 0) + 1, 6);
    expect(data.indices[first.triangles * 3]).toBe((source.indices[0] ?? 0) + offset);
    expect(signedVolume(merged.build())).toBeCloseTo(2 * signedVolume(part.build()), 5);
  });
});
