import { describe, expect, it } from "vitest";
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_HEIGHT, HALL_OPENINGS, isWindow } from "../hall-spec.js";
import { hallDaylightIrradiance, openingApertures, polygonFormFactor, type Vec3 } from "../hall-lighting-model.js";

// The original tuple implementation of Lambert's polygon formula, kept as the
// oracle for the allocation-free one the bake now runs.
function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function length(a: Vec3): number { return Math.hypot(a[0], a[1], a[2]); }

function referenceFormFactor(point: Vec3, normal: Vec3, polygon: readonly Vec3[]): number {
  const visible: Vec3[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    if (current === undefined || next === undefined) continue;
    const dc = dot(sub(current, point), normal) - 1e-5;
    const dn = dot(sub(next, point), normal) - 1e-5;
    if (dc >= 0) visible.push(current);
    if ((dc >= 0) !== (dn >= 0)) {
      const t = dc / (dc - dn);
      visible.push([current[0] + (next[0] - current[0]) * t, current[1] + (next[1] - current[1]) * t, current[2] + (next[2] - current[2]) * t]);
    }
  }
  if (visible.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < visible.length; i++) {
    const a = visible[i];
    const b = visible[(i + 1) % visible.length];
    if (a === undefined || b === undefined) continue;
    const va = sub(a, point);
    const vb = sub(b, point);
    const la = length(va);
    const lb = length(vb);
    if (la < 1e-6 || lb < 1e-6) continue;
    const theta = Math.acos(Math.max(-1, Math.min(1, dot(va, vb) / (la * lb))));
    const c = cross(va, vb);
    const lc = length(c);
    if (lc < 1e-9) continue;
    sum += theta * (dot(normal, c) / lc);
  }
  return Math.min(1, Math.abs(sum) / (2 * Math.PI));
}

/** A deterministic sequence in [0, 1). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function unit(next: () => number): Vec3 {
  const z = next() * 2 - 1;
  const angle = next() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(angle), z, r * Math.sin(angle)];
}

const APERTURES = HALL_OPENINGS.filter(isWindow).flatMap((opening) => openingApertures(opening));

describe("hall lighting model", () => {
  it("computes each window's form factor as the original tuple arithmetic did", () => {
    const next = random(652);
    for (let sample = 0; sample < 4000; sample++) {
      const point: Vec3 = [(next() * 2 - 1) * HALL_HALF_LENGTH, next() * HALL_HEIGHT, (next() * 2 - 1) * HALL_HALF_WIDTH];
      const normal = unit(next);
      for (const aperture of APERTURES) {
        expect(polygonFormFactor(point, normal, aperture)).toBeCloseTo(referenceFormFactor(point, normal, aperture), 12);
      }
    }
  });

  it("sums the windows into the daylight channel as before", () => {
    const next = random(1010);
    for (let sample = 0; sample < 500; sample++) {
      const point: Vec3 = [(next() * 2 - 1) * HALL_HALF_LENGTH, next() * HALL_HEIGHT, (next() * 1.98 - 0.98) * HALL_HALF_WIDTH];
      const normal = unit(next);
      const expected = APERTURES.reduce((total, aperture) => total + referenceFormFactor(point, normal, aperture), 0) * 0.62 * 4;
      expect(hallDaylightIrradiance(point, normal)).toBeCloseTo(expected, 10);
    }
  });

  it("clips any polygon straddling the receiver's horizon, of any size", () => {
    const next = random(7);
    for (let sample = 0; sample < 200; sample++) {
      const sides = 3 + Math.floor(next() * 40);
      const polygon: Vec3[] = Array.from({ length: sides }, (_, index) => {
        const angle = (index / sides) * Math.PI * 2;
        return [Math.cos(angle) * 2, Math.sin(angle) * 2, 1 + (next() - 0.5) * 0.2];
      });
      const normal = unit(next);
      expect(polygonFormFactor([0, 0, 0], normal, polygon)).toBeCloseTo(referenceFormFactor([0, 0, 0], normal, polygon), 12);
    }
  });
});
