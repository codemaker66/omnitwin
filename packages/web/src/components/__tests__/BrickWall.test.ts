import { describe, it, expect } from "vitest";
import {
  computeBrickLayout,
  computeBrickProgress,
  easeHeavyLanding,
  IMPACT_POINT,
  BOUNCE_OVERSHOOT,
  createSeededRandom,
  BLOCK_WIDTH,
  BLOCK_HEIGHT,
  MORTAR_GAP,
  STAGGER_SPAN,
  SCATTER_DISTANCE,
  MAX_SCATTER_ROTATION,
  BRICK_JITTER,
  shouldUpdateBrickWallMatrices,
} from "../BrickWall.js";

// ---------------------------------------------------------------------------
// createSeededRandom
// ---------------------------------------------------------------------------

describe("createSeededRandom", () => {
  it("produces values in [0, 1)", () => {
    const rand = createSeededRandom(42);
    for (let i = 0; i < 100; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic — same seed gives same sequence", () => {
    const a = createSeededRandom(123);
    const b = createSeededRandom(123);
    for (let i = 0; i < 20; i++) {
      expect(a()).toBe(b());
    }
  });

  it("different seeds produce different sequences", () => {
    const a = createSeededRandom(1);
    const b = createSeededRandom(2);
    let identical = true;
    for (let i = 0; i < 10; i++) {
      if (a() !== b()) identical = false;
    }
    expect(identical).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeBrickLayout
// ---------------------------------------------------------------------------

describe("computeBrickLayout", () => {
  it("produces bricks for a standard wall", () => {
    const bricks = computeBrickLayout(10, 7, 42);
    expect(bricks.length).toBeGreaterThan(0);
  });

  it("each brick has rest position within wall bounds (with tolerance)", () => {
    const w = 10;
    const h = 7;
    const bricks = computeBrickLayout(w, h, 42);
    const halfW = w / 2 + BLOCK_WIDTH; // allow for half-brick overhang at edges
    const halfH = h / 2 + BLOCK_HEIGHT;

    for (const b of bricks) {
      expect(b.restX).toBeGreaterThanOrEqual(-halfW);
      expect(b.restX).toBeLessThanOrEqual(halfW);
      expect(b.restY).toBeGreaterThanOrEqual(-halfH);
      expect(b.restY).toBeLessThanOrEqual(halfH);
    }
  });

  it("stagger values are in [0, 1]", () => {
    const bricks = computeBrickLayout(10, 7, 42);
    for (const b of bricks) {
      expect(b.stagger).toBeGreaterThanOrEqual(0);
      expect(b.stagger).toBeLessThanOrEqual(1);
    }
  });

  it("scatter directions are unit vectors", () => {
    const bricks = computeBrickLayout(10, 7, 42);
    for (const b of bricks) {
      const len = Math.sqrt(
        b.scatterDirX ** 2 + b.scatterDirY ** 2 + b.scatterDirZ ** 2,
      );
      expect(len).toBeCloseTo(1, 3);
    }
  });

  it("scatter Y component is always positive (bricks fall from above)", () => {
    const bricks = computeBrickLayout(10, 7, 42);
    for (const b of bricks) {
      expect(b.scatterDirY).toBeGreaterThan(0);
    }
  });

  it("is deterministic — same inputs give same layout", () => {
    const a = computeBrickLayout(10, 7, 42);
    const b = computeBrickLayout(10, 7, 42);
    expect(a).toEqual(b);
  });

  it("different seeds produce different scatter directions", () => {
    const a = computeBrickLayout(10, 7, 1);
    const b = computeBrickLayout(10, 7, 2);
    // At least some bricks should differ
    let allSame = true;
    const count = Math.min(a.length, b.length, 5);
    for (let i = 0; i < count; i++) {
      const ai = a[i];
      const bi = b[i];
      if (ai !== undefined && bi !== undefined && ai.scatterDirX !== bi.scatterDirX) allSame = false;
    }
    expect(allSame).toBe(false);
  });

  it("running bond — odd rows are offset by half a brick", () => {
    const bricks = computeBrickLayout(10, 7, 42);
    const cellW = BLOCK_WIDTH + MORTAR_GAP;
    const cellH = BLOCK_HEIGHT + MORTAR_GAP;
    // Find bricks in row 0 and row 1 by their restY position
    const row0Y = -7 / 2 + cellH * 0.5;
    const row1Y = -7 / 2 + cellH * 1.5;

    const row0 = bricks.filter((b) => Math.abs(b.restY - row0Y) < 0.01);
    const row1 = bricks.filter((b) => Math.abs(b.restY - row1Y) < 0.01);

    expect(row0.length).toBeGreaterThan(0);
    expect(row1.length).toBeGreaterThan(0);

    // Row 0 first brick starts at -halfW + cellW/2
    const r0First = row0.reduce((a, b) => (a.restX < b.restX ? a : b));
    // Row 1 first brick starts at -halfW + cellW (half brick offset)
    const r1First = row1.reduce((a, b) => (a.restX < b.restX ? a : b));

    // The offset should be approximately cellW * 0.5
    const offset = Math.abs(r1First.restX - r0First.restX);
    expect(offset).toBeCloseTo(cellW * 0.5, 1);
  });

  it("returns empty array for zero-size wall", () => {
    const bricks = computeBrickLayout(0, 0, 42);
    expect(bricks.length).toBe(0);
  });

  it("handles very small wall", () => {
    const bricks = computeBrickLayout(0.5, 0.3, 42);
    expect(bricks.length).toBeGreaterThan(0);
    expect(bricks.length).toBeLessThan(10); // only a few bricks
  });

  it("Grand Hall back wall produces reasonable brick count", () => {
    // 21m × 7m wall
    const bricks = computeBrickLayout(21, 7, 100);
    // ~52 cols × 34 rows ≈ 1768
    expect(bricks.length).toBeGreaterThan(1000);
    expect(bricks.length).toBeLessThan(3000);
  });
});

// ---------------------------------------------------------------------------
// easeHeavyLanding
// ---------------------------------------------------------------------------

describe("easeHeavyLanding", () => {
  it("returns 0 at t=0", () => {
    expect(easeHeavyLanding(0)).toBe(0);
  });

  it("returns 1 at t=1", () => {
    expect(easeHeavyLanding(1)).toBe(1);
  });

  it("returns 0 for negative t", () => {
    expect(easeHeavyLanding(-0.5)).toBe(0);
  });

  it("returns 1 for t > 1", () => {
    expect(easeHeavyLanding(1.5)).toBe(1);
  });

  it("is below 1 during approach phase (before impact)", () => {
    for (let t = 0.01; t < IMPACT_POINT; t += 0.05) {
      expect(easeHeavyLanding(t)).toBeLessThan(1);
    }
  });

  it("overshoots past 1 during bounce phase (the dud)", () => {
    // Right after impact, should briefly exceed 1
    let foundOvershoot = false;
    for (let t = IMPACT_POINT + 0.01; t < 1; t += 0.01) {
      if (easeHeavyLanding(t) > 1) foundOvershoot = true;
    }
    expect(foundOvershoot).toBe(true);
  });

  it("overshoot magnitude is bounded by BOUNCE_OVERSHOOT", () => {
    let maxOvershoot = 0;
    for (let t = 0; t <= 1; t += 0.001) {
      const v = easeHeavyLanding(t);
      if (v - 1 > maxOvershoot) maxOvershoot = v - 1;
    }
    expect(maxOvershoot).toBeLessThanOrEqual(BOUNCE_OVERSHOOT + 0.01);
  });

  it("ease-in quadratic during approach — value at midpoint is less than linear", () => {
    // At halfway through approach, ease-in quad gives t²=0.25, not 0.5
    const midApproach = IMPACT_POINT / 2;
    expect(easeHeavyLanding(midApproach)).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// computeBrickProgress
// ---------------------------------------------------------------------------

describe("computeBrickProgress", () => {
  it("all bricks are at 0 when globalProgress is 0", () => {
    expect(computeBrickProgress(0, 0)).toBe(0);
    expect(computeBrickProgress(0, 0.5)).toBe(0);
    expect(computeBrickProgress(0, 1)).toBe(0);
  });

  it("all bricks are at 1 when globalProgress is 1", () => {
    expect(computeBrickProgress(1, 0)).toBe(1);
    expect(computeBrickProgress(1, 0.5)).toBe(1);
    expect(computeBrickProgress(1, 1)).toBe(1);
  });

  it("bottom bricks (stagger=0) start first", () => {
    const bottom = computeBrickProgress(0.3, 0);
    const top = computeBrickProgress(0.3, 1);
    expect(bottom).toBeGreaterThan(top);
  });

  it("at midpoint, bottom bricks are further along than top bricks", () => {
    const bottom = computeBrickProgress(0.5, 0);
    const top = computeBrickProgress(0.5, 1);
    expect(bottom).toBeGreaterThan(top);
  });

  it("returns clamped values in [0, 1]", () => {
    for (let g = 0; g <= 1; g += 0.1) {
      for (let s = 0; s <= 1; s += 0.1) {
        const v = computeBrickProgress(g, s);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("stagger creates a wave — higher stagger means later start", () => {
    const progress = 0.4;
    const lowStagger = computeBrickProgress(progress, 0.1);
    const midStagger = computeBrickProgress(progress, 0.5);
    const highStagger = computeBrickProgress(progress, 0.9);
    expect(lowStagger).toBeGreaterThanOrEqual(midStagger);
    expect(midStagger).toBeGreaterThanOrEqual(highStagger);
  });
});

// ---------------------------------------------------------------------------
// Constants sanity checks
// ---------------------------------------------------------------------------

describe("BrickWall constants", () => {
  it("block dimensions are reasonable for stone blocks", () => {
    expect(BLOCK_WIDTH).toBeGreaterThan(0.1);
    expect(BLOCK_WIDTH).toBeLessThan(1);
    expect(BLOCK_HEIGHT).toBeGreaterThan(0.05);
    expect(BLOCK_HEIGHT).toBeLessThan(0.5);
  });

  it("mortar gap is small but positive", () => {
    expect(MORTAR_GAP).toBeGreaterThan(0);
    expect(MORTAR_GAP).toBeLessThan(0.05);
  });

  it("scatter distance is visible but not extreme", () => {
    expect(SCATTER_DISTANCE).toBeGreaterThan(0.5);
    expect(SCATTER_DISTANCE).toBeLessThan(10);
  });

  it("stagger span is between 0 and 1", () => {
    expect(STAGGER_SPAN).toBeGreaterThan(0);
    expect(STAGGER_SPAN).toBeLessThan(1);
  });

  it("max scatter rotation is reasonable", () => {
    expect(MAX_SCATTER_ROTATION).toBeGreaterThan(0);
    expect(MAX_SCATTER_ROTATION).toBeLessThan(Math.PI);
  });

  it("brick jitter is small but nonzero", () => {
    expect(BRICK_JITTER).toBeGreaterThan(0);
    expect(BRICK_JITTER).toBeLessThan(0.3);
  });

  it("bricks in the same row have slightly different stagger values (jitter)", () => {
    const bricks = computeBrickLayout(10, 7, 42);
    const cellH = BLOCK_HEIGHT + MORTAR_GAP;
    const row0Y = -7 / 2 + cellH * 0.5;
    const row0 = bricks.filter((b) => Math.abs(b.restY - row0Y) < 0.01);
    // With jitter, not all bricks in row 0 should have identical stagger
    const staggers = new Set(row0.map((b) => b.stagger.toFixed(4)));
    expect(staggers.size).toBeGreaterThan(1);
  });
});

describe("shouldUpdateBrickWallMatrices", () => {
  it("refreshes once when a snapped auto-hide target changes", () => {
    expect(shouldUpdateBrickWallMatrices(0, 0, false, true)).toBe(true);
  });

  it("does not refresh when settled and no target changed", () => {
    expect(shouldUpdateBrickWallMatrices(1, 1, false, false)).toBe(false);
  });

  it("refreshes while an animation is still moving toward the target", () => {
    expect(shouldUpdateBrickWallMatrices(0.5, 1, false, false)).toBe(true);
  });
});
