import { describe, it, expect } from "vitest";
import {
  computeSmoothedVelocity,
  vectorLength,
  updateDisplacement,
  updateRotation,
  computeDrapeHeight,
  computeWaveDisplacement,
  CLOTH_HOVER_HEIGHT,
  CLOTH_EDGE_SAG,
  VELOCITY_SMOOTHING,
} from "../useClothPhysics.js";

// ---------------------------------------------------------------------------
// vectorLength
// ---------------------------------------------------------------------------

describe("vectorLength", () => {
  it("returns 0 for zero vector", () => {
    expect(vectorLength([0, 0, 0])).toBe(0);
  });

  it("returns correct length for unit axis vectors", () => {
    expect(vectorLength([1, 0, 0])).toBeCloseTo(1, 10);
    expect(vectorLength([0, 1, 0])).toBeCloseTo(1, 10);
    expect(vectorLength([0, 0, 1])).toBeCloseTo(1, 10);
  });

  it("returns correct length for 3-4-5 scaled triangle", () => {
    expect(vectorLength([3, 4, 0])).toBeCloseTo(5, 10);
  });

  it("returns correct length for diagonal vector", () => {
    expect(vectorLength([1, 1, 1])).toBeCloseTo(Math.sqrt(3), 10);
  });
});

// ---------------------------------------------------------------------------
// computeSmoothedVelocity
// ---------------------------------------------------------------------------

describe("computeSmoothedVelocity", () => {
  it("returns raw velocity when smoothing is 0", () => {
    const result = computeSmoothedVelocity([5, 5, 5], [10, 20, 30], 0);
    expect(result[0]).toBeCloseTo(10, 10);
    expect(result[1]).toBeCloseTo(20, 10);
    expect(result[2]).toBeCloseTo(30, 10);
  });

  it("returns previous velocity when smoothing is 1", () => {
    const result = computeSmoothedVelocity([5, 10, 15], [100, 200, 300], 1);
    expect(result[0]).toBeCloseTo(5, 10);
    expect(result[1]).toBeCloseTo(10, 10);
    expect(result[2]).toBeCloseTo(15, 10);
  });

  it("blends at 0.5 smoothing", () => {
    const result = computeSmoothedVelocity([0, 0, 0], [10, 20, 30], 0.5);
    expect(result[0]).toBeCloseTo(5, 10);
    expect(result[1]).toBeCloseTo(10, 10);
    expect(result[2]).toBeCloseTo(15, 10);
  });

  it("converges toward zero when raw velocity is zero", () => {
    let vel: [number, number, number] = [100, 0, 0];
    for (let i = 0; i < 60; i++) {
      vel = computeSmoothedVelocity(vel, [0, 0, 0], VELOCITY_SMOOTHING);
    }
    // After 60 iterations at 0.85 smoothing: 100 * 0.85^60 ≈ 0.0058
    expect(Math.abs(vel[0])).toBeLessThan(0.01);
  });

  it("dampens to near-zero over ~60 frames when cursor stops", () => {
    // Simulates cursor moving at speed 10 then stopping
    let vel: [number, number, number] = [10, 0, 5];
    for (let i = 0; i < 60; i++) {
      vel = computeSmoothedVelocity(vel, [0, 0, 0], VELOCITY_SMOOTHING);
    }
    expect(vectorLength(vel)).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// updateDisplacement
// ---------------------------------------------------------------------------

describe("updateDisplacement", () => {
  it("returns 0 when speed is 0 and current is 0", () => {
    expect(updateDisplacement(0, 0, 0.016)).toBe(0);
  });

  it("grows displacement when speed increases", () => {
    const result = updateDisplacement(0, 5, 0.016);
    expect(result).toBeGreaterThan(0);
  });

  it("decays displacement when speed drops to 0", () => {
    const result = updateDisplacement(0.8, 0, 0.016);
    expect(result).toBeLessThan(0.8);
  });

  it("caps at MAX_DISPLACEMENT (1.0)", () => {
    // Very high speed for many frames
    let disp = 0;
    for (let i = 0; i < 200; i++) {
      disp = updateDisplacement(disp, 100, 0.016);
    }
    expect(disp).toBeLessThanOrEqual(1.0);
  });

  it("decays toward 0 over time when speed is 0", () => {
    let disp = 1.0;
    for (let i = 0; i < 100; i++) {
      disp = updateDisplacement(disp, 0, 0.016);
    }
    expect(disp).toBeCloseTo(0, 1);
  });

  it("zero velocity produces minimal displacement (idle sway)", () => {
    const result = updateDisplacement(0, 0, 0.016);
    expect(result).toBe(0);
  });

  it("high velocity produces increased displacement", () => {
    let disp = 0;
    for (let i = 0; i < 30; i++) {
      disp = updateDisplacement(disp, 10, 0.016);
    }
    expect(disp).toBeGreaterThan(0.3);
  });
});

// ---------------------------------------------------------------------------
// updateRotation
// ---------------------------------------------------------------------------

describe("updateRotation", () => {
  it("rotates at base speed when velocity is 0", () => {
    const result = updateRotation(0, 0, 1.0);
    expect(result).toBeCloseTo(0.2, 5); // BASE_ROTATION_SPEED = 0.2
  });

  it("rotates faster with higher speed", () => {
    const slow = updateRotation(0, 0, 1.0);
    const fast = updateRotation(0, 10, 1.0);
    expect(fast).toBeGreaterThan(slow);
  });

  it("accumulates rotation over multiple frames", () => {
    let rot = 0;
    for (let i = 0; i < 60; i++) {
      rot = updateRotation(rot, 0, 0.016);
    }
    // ~60 * 0.016 * 0.2 = 0.192 rad
    expect(rot).toBeCloseTo(0.192, 2);
  });

  it("never decreases (always adds positive rotation)", () => {
    let rot = 0;
    for (let i = 0; i < 100; i++) {
      const prev = rot;
      rot = updateRotation(rot, Math.random() * 10, 0.016);
      expect(rot).toBeGreaterThan(prev);
    }
  });
});

// ---------------------------------------------------------------------------
// computeDrapeHeight
// ---------------------------------------------------------------------------

describe("computeDrapeHeight", () => {
  it("returns hoverHeight at center (r=0)", () => {
    expect(computeDrapeHeight(0, CLOTH_HOVER_HEIGHT, CLOTH_EDGE_SAG)).toBe(
      CLOTH_HOVER_HEIGHT,
    );
  });

  it("returns hoverHeight - sag at edge (r=1)", () => {
    expect(computeDrapeHeight(1, CLOTH_HOVER_HEIGHT, CLOTH_EDGE_SAG)).toBeCloseTo(
      CLOTH_HOVER_HEIGHT - CLOTH_EDGE_SAG,
      10,
    );
  });

  it("follows quadratic profile (midpoint at 75% height)", () => {
    const mid = computeDrapeHeight(0.5, CLOTH_HOVER_HEIGHT, CLOTH_EDGE_SAG);
    // At r=0.5: h - sag * 0.25 = 3.0 - 0.8 * 0.25 = 2.8
    expect(mid).toBeCloseTo(CLOTH_HOVER_HEIGHT - CLOTH_EDGE_SAG * 0.25, 10);
  });

  it("clamps r below 0 to center height", () => {
    expect(computeDrapeHeight(-0.5, 3.0, 0.8)).toBe(3.0);
  });

  it("clamps r above 1 to edge height", () => {
    expect(computeDrapeHeight(1.5, 3.0, 0.8)).toBeCloseTo(3.0 - 0.8, 10);
  });

  it("returns hoverHeight when sag is 0", () => {
    expect(computeDrapeHeight(0.5, 5.0, 0)).toBe(5.0);
    expect(computeDrapeHeight(1.0, 5.0, 0)).toBe(5.0);
  });
});

// ---------------------------------------------------------------------------
// computeWaveDisplacement
// ---------------------------------------------------------------------------

describe("computeWaveDisplacement", () => {
  it("returns 0 when displacement is 0 (idle)", () => {
    expect(computeWaveDisplacement(0.5, 1.0, 5.0, 0, 3.0)).toBe(0);
  });

  it("returns 0 when displacement is near zero", () => {
    expect(computeWaveDisplacement(0.5, 1.0, 5.0, 0.0005, 3.0)).toBe(0);
  });

  it("center vertex has less displacement than edge", () => {
    // Edge should generally have larger amplitude
    // (due to edgeFactor = r^2, but waves are sinusoidal so we check magnitudes)
    // Run at multiple times to average out phase
    let centerSum = 0;
    let edgeSum = 0;
    for (let t = 0; t < 100; t++) {
      centerSum += Math.abs(computeWaveDisplacement(0.1, 0, t * 0.1, 0.8, 5.0));
      edgeSum += Math.abs(computeWaveDisplacement(0.9, 0, t * 0.1, 0.8, 5.0));
    }
    expect(edgeSum).toBeGreaterThan(centerSum);
  });

  it("higher displacement intensity produces larger waves", () => {
    let lowSum = 0;
    let highSum = 0;
    for (let t = 0; t < 100; t++) {
      lowSum += Math.abs(computeWaveDisplacement(0.7, 1.0, t * 0.05, 0.2, 3.0));
      highSum += Math.abs(computeWaveDisplacement(0.7, 1.0, t * 0.05, 0.9, 3.0));
    }
    expect(highSum).toBeGreaterThan(lowSum);
  });

  it("higher speed increases turbulence amplitude", () => {
    let slowSum = 0;
    let fastSum = 0;
    for (let t = 0; t < 100; t++) {
      slowSum += Math.abs(computeWaveDisplacement(0.8, 2.0, t * 0.05, 0.8, 0.5));
      fastSum += Math.abs(computeWaveDisplacement(0.8, 2.0, t * 0.05, 0.8, 10.0));
    }
    expect(fastSum).toBeGreaterThan(slowSum);
  });

  it("wave amplitude stays within reasonable bounds", () => {
    // With max displacement and high speed, waves should not exceed ~0.3
    for (let t = 0; t < 200; t++) {
      const d = computeWaveDisplacement(1.0, t * 0.1, t * 0.05, 1.0, 10.0);
      expect(Math.abs(d)).toBeLessThan(0.5);
    }
  });

  it("varies with angle (angular folds)", () => {
    const a1 = computeWaveDisplacement(0.8, 0, 1.0, 0.8, 3.0);
    const a2 = computeWaveDisplacement(0.8, Math.PI / 2, 1.0, 0.8, 3.0);
    // Different angles should generally produce different values
    expect(a1).not.toBeCloseTo(a2, 5);
  });

  it("varies with time (animation)", () => {
    const t1 = computeWaveDisplacement(0.8, 1.0, 0, 0.8, 3.0);
    const t2 = computeWaveDisplacement(0.8, 1.0, 0.5, 0.8, 3.0);
    expect(t1).not.toBeCloseTo(t2, 5);
  });
});

// ---------------------------------------------------------------------------
// Integration: simulated physics loop
// ---------------------------------------------------------------------------

describe("simulated physics loop", () => {
  it("idle cloth has zero displacement after settling", () => {
    // Stationary cursor: velocity always zero
    let vel: [number, number, number] = [0, 0, 0];
    let disp = 0;
    for (let i = 0; i < 60; i++) {
      vel = computeSmoothedVelocity(vel, [0, 0, 0], VELOCITY_SMOOTHING);
      disp = updateDisplacement(disp, vectorLength(vel), 0.016);
    }
    expect(disp).toBe(0);
  });

  it("fast-moving cloth builds displacement, then decays when stopped", () => {
    let vel: [number, number, number] = [0, 0, 0];
    let disp = 0;

    // Phase 1: move fast for 30 frames
    for (let i = 0; i < 30; i++) {
      vel = computeSmoothedVelocity(vel, [20, 0, 0], VELOCITY_SMOOTHING);
      disp = updateDisplacement(disp, vectorLength(vel), 0.016);
    }
    const peakDisp = disp;
    expect(peakDisp).toBeGreaterThan(0.3);

    // Phase 2: stop for 120 frames
    for (let i = 0; i < 120; i++) {
      vel = computeSmoothedVelocity(vel, [0, 0, 0], VELOCITY_SMOOTHING);
      disp = updateDisplacement(disp, vectorLength(vel), 0.016);
    }
    expect(disp).toBeLessThan(0.05);
  });

  it("rotation accumulates continuously", () => {
    let rot = 0;
    for (let i = 0; i < 300; i++) {
      rot = updateRotation(rot, 2.0, 0.016);
    }
    // 300 * 0.016 * (0.2 + 2.0 * 0.15) = 300 * 0.016 * 0.5 = 2.4 rad
    expect(rot).toBeCloseTo(2.4, 1);
  });
});
