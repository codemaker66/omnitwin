import { describe, expect, it } from "vitest";
import {
  FLOOR_BOARD_LENGTH,
  FLOOR_BOARD_WIDTH,
  FLOOR_DETAIL_FADE,
  FLOOR_SEAM,
  FLOOR_SEED_OFFSET,
  createOakFloorMaterial,
  floorHash,
  floorSeedInputs,
} from "../hall-floor.js";
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH } from "../hall-spec.js";
import { vec3 } from "three/tsl";

describe("the drawn oak floor's distance fades", () => {
  it("lets the seams go before the boards' own tones, so the floor never changes pattern part way across", () => {
    const [seamStart, seamEnd] = FLOOR_DETAIL_FADE.seams;
    const [toneStart, toneEnd] = FLOOR_DETAIL_FADE.tone;
    expect(seamStart).toBeLessThan(seamEnd);
    expect(toneStart).toBeLessThan(toneEnd);
    // The tones are still whole where the seams have gone...
    expect(toneStart).toBeGreaterThanOrEqual(seamStart);
    // ...and last until a board is about a pixel wide (one board a pixel or more).
    expect(toneEnd).toBeGreaterThanOrEqual(1);
    // The seams fade while a board is still a few pixels wide: under a tenth of
    // a pixel each, any later and they alias into lines along the strips.
    expect((FLOOR_SEAM / FLOOR_BOARD_WIDTH) * (1 / seamEnd)).toBeLessThan(0.1);
  });

  it("builds its material", () => {
    const material = createOakFloorMaterial(vec3(1, 1, 1));
    expect(material.emissiveNode).not.toBeNull();
    expect(material.roughnessNode).not.toBeNull();
    material.dispose();
  });
});

/** Where a row's end joints fall along the hall, from its seeds as the shader draws them. */
function rowJoints(z: number): number[] {
  const seeds = floorSeedInputs(0, z);
  const length = FLOOR_BOARD_LENGTH[0] + (FLOOR_BOARD_LENGTH[1] - FLOOR_BOARD_LENGTH[0]) * floorHash(seeds.length);
  const shift = floorHash(seeds.stagger) * 11;
  const joints: number[] = [];
  for (let k = Math.ceil((-HALL_HALF_LENGTH + shift) / length); k * length - shift <= HALL_HALF_LENGTH; k++) joints.push(k * length - shift);
  return joints;
}

/** The share of a half's end joints that fall within 1 cm of a joint in the next row. */
function coincidentJoints(rows: readonly number[]): number {
  let joints = 0;
  let coincident = 0;
  for (let i = 0; i + 1 < rows.length; i++) {
    const here = rowJoints(rows[i] ?? 0);
    const next = rowJoints(rows[i + 1] ?? 0);
    for (const x of here) {
      joints += 1;
      if (next.some((y) => Math.abs(x - y) < 0.01)) coincident += 1;
    }
  }
  return coincident / Math.max(1, joints);
}

describe("the oak floor's hash seeds", () => {
  it("reads a seed as WGSL's u32 does: a negative one as zero and a fraction dropped", () => {
    expect(floorHash(-5)).toBe(floorHash(0));
    expect(floorHash(-0.5)).toBe(floorHash(0));
    expect(floorHash(3.7)).toBe(floorHash(3));
    expect(floorHash(3)).not.toBe(floorHash(4));
    for (const seed of [0, 1, 17, 4113.31, 1_800_000]) {
      expect(floorHash(seed)).toBeGreaterThanOrEqual(0);
      expect(floorHash(seed)).toBeLessThan(1);
    }
  });

  it("seeds every board in the hall above zero and below 2^24", () => {
    let checked = 0;
    let lowest = Infinity;
    let highest = -Infinity;
    for (let x = -10.6; x <= 10.6; x += 0.02) {
      for (let z = -5.3; z <= 5.3; z += FLOOR_BOARD_WIDTH / 2) {
        const seeds = floorSeedInputs(x, z);
        lowest = Math.min(lowest, seeds.row, seeds.column, seeds.stagger, seeds.length, seeds.tone, seeds.figure);
        highest = Math.max(highest, seeds.row, seeds.column, seeds.stagger, seeds.length, seeds.tone, seeds.figure);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100_000);
    expect(lowest).toBeGreaterThan(0);
    expect(highest).toBeLessThan(2 ** 24);
    expect(FLOOR_SEED_OFFSET).toBeGreaterThan(HALL_HALF_WIDTH / FLOOR_BOARD_WIDTH + 1);
  });

  it("gives every row on both sides of the centre line its own stagger and board length", () => {
    for (const sign of [-1, 1]) {
      const rows: number[] = [];
      for (let z = FLOOR_BOARD_WIDTH / 2; z < HALL_HALF_WIDTH; z += FLOOR_BOARD_WIDTH) rows.push(sign * z);
      const staggers = new Set(rows.map((z) => floorHash(floorSeedInputs(0, z).stagger)));
      const lengths = new Set(rows.map((z) => floorHash(floorSeedInputs(0, z).length)));
      expect(staggers.size).toBe(rows.length);
      expect(lengths.size).toBe(rows.length);
    }
  });

  it("staggers the end joints of both halves alike", () => {
    const half = (sign: number): number[] => {
      const rows: number[] = [];
      for (let z = FLOOR_BOARD_WIDTH / 2; z < HALL_HALF_WIDTH; z += FLOOR_BOARD_WIDTH) rows.push(sign * z);
      return rows;
    };
    const windowHalf = coincidentJoints(half(-1));
    const doorHalf = coincidentJoints(half(1));
    // Chance alone puts about one joint in thirty within a centimetre of the next row's.
    expect(windowHalf).toBeLessThan(0.1);
    expect(doorHalf).toBeLessThan(0.1);
  });
});
