import { describe, expect, it } from "vitest";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
} from "three";
import {
  DOLLHOUSE_SHELL_PRUNE,
  classifyTexel,
  longestEdgeM,
  normalDeviationDeg,
  pruneDollhouseShell,
  pruneShellIslands,
  sampleTexelClass,
  shellPassesEnabled,
  verticalAspect,
  type ShellChunk,
  type ShellPruneThresholds,
  type ShellTextureGrid,
} from "../dollhouse-shell.js";

// -----------------------------------------------------------------------------
// dollhouse-shell — the load-time repair pass.
//
// Two of these tests exist because of specific failures that shipped, and are
// written to fail if either is reintroduced:
//
//   1. "arms every pass it owns" — minIslandTriangles: 0 shipped, twelve lines
//      below a doc comment saying zero disables the island pass. The pass ran,
//      reported zero, cost a traversal and was indistinguishable from a pass
//      that found nothing. A threshold at its own disabling value is the
//      quietest way for this module to become a no-op, so it is asserted
//      directly rather than inferred from a behavioural test.
//
//   2. "welds across chunks" — the island pass originally ran per geometry.
//      A chunk is a spatial TILE, so every real surface arrives cut into
//      pieces at the tile seam, and small-component-within-a-chunk measures
//      the tiler rather than the capture: measured on the shipped asset, a
//      threshold of 32 removed 15.8% of the model and 128 removed 38.3%,
//      nearly all of it wall, floor and ceiling. The seam test below fails if
//      the weld ever goes back inside one chunk.
// -----------------------------------------------------------------------------

/**
 * A connected strip of `triangles` triangles, one component, built from local
 * coordinates only — placement is the caller's transform, so the tests exercise
 * `toShellFrame` rather than baking world positions into the buffer.
 */
function strip(triangles: number): BufferGeometry {
  const positions: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < triangles + 2; i += 1) {
    positions.push(i * 0.1, (i % 2) * 0.1, 0);
  }
  for (let t = 0; t < triangles; t += 1) {
    index.push(t, t + 1, t + 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}

function chunkAt(geometry: BufferGeometry, x: number): ShellChunk {
  return { geometry, toShellFrame: new Matrix4().makeTranslation(x, 0, 0) };
}

function triangleCount(geometry: BufferGeometry): number {
  return Math.floor((geometry.getIndex()?.count ?? 0) / 3);
}

/** Loosen only the cap, so a test about welding is not decided by the cap. */
function uncapped(patch: Partial<ShellPruneThresholds> = {}): ShellPruneThresholds {
  return { ...DOLLHOUSE_SHELL_PRUNE, maxIslandRemovalFraction: 1, ...patch };
}

describe("shipped thresholds", () => {
  it("arms every pass it owns", () => {
    expect(shellPassesEnabled()).toEqual({ tears: true, islands: true });
  });

  it("does not ship a threshold at its own disabling value", () => {
    expect(DOLLHOUSE_SHELL_PRUNE.minIslandTriangles).toBeGreaterThan(0);
    expect(DOLLHOUSE_SHELL_PRUNE.maxTearEdgeM).toBeGreaterThan(0);
    expect(DOLLHOUSE_SHELL_PRUNE.textureGridSize).toBeGreaterThan(0);
    expect(DOLLHOUSE_SHELL_PRUNE.maxRegionTriangles).toBeGreaterThan(0);
    // Zero clearance is the setting that punched holes in the parquet.
    expect(DOLLHOUSE_SHELL_PRUNE.islandClearanceM).toBeGreaterThan(0);
    // A seed fraction over 1 is unreachable and would silently keep every
    // region, which is the same defect wearing a different number.
    expect(DOLLHOUSE_SHELL_PRUNE.minRegionSeedFraction).toBeLessThanOrEqual(1);
  });

  it("keeps the island removal cap a real cap", () => {
    expect(DOLLHOUSE_SHELL_PRUNE.maxIslandRemovalFraction).toBeGreaterThan(0);
    expect(DOLLHOUSE_SHELL_PRUNE.maxIslandRemovalFraction).toBeLessThan(0.5);
  });

  it("reports a disabled island pass as disabled", () => {
    expect(shellPassesEnabled({ ...DOLLHOUSE_SHELL_PRUNE, minIslandTriangles: 0 })).toEqual({
      tears: true,
      islands: false,
    });
  });
});

describe("pruneShellIslands", () => {
  it("welds across chunks, so a surface split at a tile seam survives", () => {
    // Two ten-triangle strips that meet exactly: A spans x 0.0-1.1, B is the
    // same buffer translated to x 1.0-2.1, so B's first two vertices land on
    // A's last two. Welded globally that is ONE 20-triangle component and
    // nothing is debris. Welded per chunk it is two components of ten, both
    // under the threshold, and the whole surface disappears.
    const a = strip(10);
    const b = strip(10);
    const outcome = pruneShellIslands(
      [chunkAt(a, 0), chunkAt(b, 1)],
      uncapped({ minIslandTriangles: 15 }),
    );

    expect(outcome.islands).toBe(1);
    expect(outcome.largestIsland).toBe(20);
    expect(outcome.removed).toBe(0);
    expect(triangleCount(a)).toBe(10);
    expect(triangleCount(b)).toBe(10);
  });

  it("removes a free-floating island and leaves the structure whole", () => {
    const structure = strip(20);
    const debris = strip(3);
    const outcome = pruneShellIslands(
      [chunkAt(structure, 0), chunkAt(debris, 100)],
      uncapped({ minIslandTriangles: 10 }),
    );

    expect(outcome.islands).toBe(2);
    expect(outcome.largestIsland).toBe(20);
    expect(outcome.removed).toBe(3);
    expect(triangleCount(structure)).toBe(20);
    expect(triangleCount(debris)).toBe(0);
  });

  it("spares a small component that sits in the surface around it", () => {
    // The floor-hole case, in miniature. The 20-triangle strip ends at x 2.1;
    // this 3-triangle patch starts 2 cm past it, disconnected but plainly part
    // of the same surface. Dropping it would open a hole, so it is kept — and
    // the pass reports zero rather than pretending it found nothing.
    const structure = strip(20);
    const patch = strip(3);
    const outcome = pruneShellIslands(
      [chunkAt(structure, 0), chunkAt(patch, 2.12)],
      uncapped({ minIslandTriangles: 10, islandClearanceM: 0.12 }),
    );

    expect(outcome.islands).toBe(2);
    expect(outcome.removed).toBe(0);
    expect(triangleCount(patch)).toBe(3);
  });

  it("removes that same component once nothing is near it", () => {
    // Identical geometry, moved into open air: now it is debris.
    const structure = strip(20);
    const patch = strip(3);
    const outcome = pruneShellIslands(
      [chunkAt(structure, 0), chunkAt(patch, 40)],
      uncapped({ minIslandTriangles: 10, islandClearanceM: 0.12 }),
    );

    expect(outcome.removed).toBe(3);
    expect(triangleCount(patch)).toBe(0);
    expect(triangleCount(structure)).toBe(20);
  });

  it("refuses and changes nothing when it would exceed the removal cap", () => {
    const structure = strip(20);
    const debris = strip(3);
    const outcome = pruneShellIslands([chunkAt(structure, 0), chunkAt(debris, 100)], {
      ...DOLLHOUSE_SHELL_PRUNE,
      minIslandTriangles: 10,
      // 3 of 23 triangles is 13%, over this cap.
      maxIslandRemovalFraction: 0.05,
    });

    expect(outcome.refused).toBe(true);
    expect(outcome.removed).toBe(0);
    expect(triangleCount(structure)).toBe(20);
    expect(triangleCount(debris)).toBe(3);
  });

  it("does nothing when the pass is disabled", () => {
    const debris = strip(3);
    const outcome = pruneShellIslands([chunkAt(debris, 0)], {
      ...DOLLHOUSE_SHELL_PRUNE,
      minIslandTriangles: 0,
    });

    expect(outcome.removed).toBe(0);
    expect(triangleCount(debris)).toBe(3);
  });
});

describe("pruneDollhouseShell", () => {
  function sceneWith(...geometries: readonly BufferGeometry[]): Group {
    const root = new Group();
    geometries.forEach((geometry, i) => {
      const mesh = new Mesh(geometry, new MeshBasicMaterial());
      mesh.position.set(i * 100, 0, 0);
      root.add(mesh);
    });
    return root;
  }

  it("drops debris under a root whose own transform is not identity", () => {
    const structure = strip(20);
    const debris = strip(3);
    const root = sceneWith(structure, debris);
    // The shell frame is the ROOT's frame, so a rotated, offset root must not
    // change which components are found.
    root.position.set(4, -2, 7);
    root.rotateY(0.9);

    const report = pruneDollhouseShell(root, uncapped({ minIslandTriangles: 10 }));

    expect(report.meshes).toBe(2);
    expect(report.islands.removed).toBe(3);
    expect(report.trianglesBefore).toBe(23);
    expect(report.trianglesAfter).toBe(20);
    expect(triangleCount(structure)).toBe(20);
  });

  it("is idempotent across the cached scene being mounted again", () => {
    const root = sceneWith(strip(20), strip(3));
    const thresholds = uncapped({ minIslandTriangles: 10 });

    const first = pruneDollhouseShell(root, thresholds);
    const second = pruneDollhouseShell(root, thresholds);

    expect(first.islands.removed).toBe(3);
    expect(second.islands.removed).toBe(0);
    expect(second.trianglesBefore).toBe(20);
    expect(second.trianglesAfter).toBe(20);
  });

  it("skips rather than throws when the root cannot supply world matrices", () => {
    // What drei hands back in a test environment, and what crashed this module
    // once: an object shaped like a scene with none of Object3D's methods on it.
    const notAScene: Partial<Object3D> = { name: "stub" };

    const report = pruneDollhouseShell(notAScene as Object3D);

    expect(report.meshes).toBe(0);
    expect(report.trianglesAfter).toBe(0);
    expect(report.islands.removed).toBe(0);
  });
});

describe("texel classification", () => {
  it("calls bright and blue daylight, and bright and warm a surface", () => {
    expect(classifyTexel(180, 200, 220)).toBe("daylight");
    // Cream plaster: just as bright, frankly warm.
    expect(classifyTexel(230, 215, 190)).toBe("surface");
    // A dark glazing bar: not warm, not bright — only ever a conductor.
    expect(classifyTexel(40, 45, 48)).toBe("neutral");
  });

  it("wraps out-of-range UVs rather than reading off the end", () => {
    const grid: ShellTextureGrid = {
      size: 2,
      data: new Uint8ClampedArray([
        180, 200, 220, 255, 180, 200, 220, 255, 180, 200, 220, 255, 180, 200, 220, 255,
      ]),
    };
    expect(sampleTexelClass(grid, 3.25, -1.75)).toBe("daylight");
    expect(sampleTexelClass(grid, Number.NaN, 0)).toBe("surface");
  });
});

describe("geometric helpers", () => {
  it("measures the longest edge in shell metres", () => {
    const points = [0, 0, 0, 3, 0, 0, 0, 4, 0];
    expect(longestEdgeM(points, 0, 3, 6)).toBeCloseTo(5, 6);
  });

  it("reads a back-to-front neighbour as agreement, not as 175 degrees", () => {
    expect(normalDeviationDeg(0, 1, 0, 0, -1, 0)).toBeCloseTo(0, 6);
    expect(normalDeviationDeg(0, 1, 0, 1, 0, 0)).toBeCloseTo(90, 6);
  });

  it("scores a hanging ribbon above a sheet of envelope", () => {
    // [minX,maxX,minY,maxY,minZ,maxZ]: 0.2 m wide, 3 m tall.
    expect(verticalAspect([0, 0.2, 0, 0.1, 0, 3])).toBeCloseTo(15, 6);
    // A broad flat sheet scores below one.
    expect(verticalAspect([0, 6, 0, 4, 0, 3])).toBeCloseTo(0.5, 6);
    expect(verticalAspect(undefined)).toBe(0);
  });
});
