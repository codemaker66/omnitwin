import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AIR_ATTENUATION_PER_M,
  FABRIC_FACE_PER_M2,
  OBJECT_ABSORPTION,
  SURFACE_ABSORPTION,
  type SurfaceMaterialId,
} from "../acoustic-data.js";

const sourceText = readFileSync(join(__dirname, "..", "acoustic-data.ts"), "utf8");

/** The source line that starts the row for `id`, quoted or not. */
function rowOf(id: string): string | undefined {
  const start = new RegExp(String.raw`^\s*"?${id}"?:`);
  return sourceText.split("\n").find((line) => start.test(line));
}

describe("acoustic data", () => {
  it("keeps every surface coefficient in [0, 1] with seven bands", () => {
    for (const row of Object.values(SURFACE_ABSORPTION)) {
      expect(row).toHaveLength(7);
      for (const a of row) {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps every object row at seven non-negative bands", () => {
    for (const row of Object.values(OBJECT_ABSORPTION)) {
      expect(row).toHaveLength(7);
      for (const a of row) expect(a).toBeGreaterThanOrEqual(0);
    }
  });

  it("pins known values", () => {
    expect(OBJECT_ABSORPTION["chair-upholstered"][3]).toBe(0.24);
    expect(AIR_ATTENUATION_PER_M[6]).toBe(0.0242);
    expect(AIR_ATTENUATION_PER_M).toHaveLength(7);
    expect(FABRIC_FACE_PER_M2).toEqual(SURFACE_ABSORPTION["velour-drape"]);
  });

  it("repeats the 4 kHz value at 8 kHz for surfaces and objects", () => {
    for (const row of [...Object.values(SURFACE_ABSORPTION), ...Object.values(OBJECT_ABSORPTION)]) {
      expect(row[6]).toBe(row[5]);
    }
  });

  it("makes every object row non-decreasing from 125 Hz to 1 kHz", () => {
    for (const row of Object.values(OBJECT_ABSORPTION)) {
      for (let i = 1; i <= 3; i++) expect(row[i]).toBeGreaterThanOrEqual(row[i - 1] ?? 0);
    }
  });

  it("gives every surface material a source comment on its row", () => {
    for (const id of Object.keys(SURFACE_ABSORPTION) as SurfaceMaterialId[]) {
      const row = rowOf(id);
      expect(row, id).toBeDefined();
      expect(row, id).toMatch(/\/\/ (LAB|FIELD|TEXTBOOK|EST|CALC)\b/);
    }
  });

  it("gives every object a source comment on its row", () => {
    for (const id of Object.keys(OBJECT_ABSORPTION)) {
      const row = rowOf(id);
      expect(row, id).toBeDefined();
      expect(row, id).toMatch(/\/\/ (LAB|FIELD|TEXTBOOK|EST|CALC)\b/);
    }
  });
});
