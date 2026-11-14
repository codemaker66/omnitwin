import { describe, expect, it } from "vitest";
import {
  WALL_ATLAS_ORIGIN,
  WALL_ATLAS_PPM,
  WALL_ATLAS_ROW,
  WALL_ATLAS_SIZE,
  WALL_ATLAS_V_MAX,
  WALL_ATLAS_V_MIN,
  wallAtlasUv,
} from "../../grand-hall/hall-atlas.js";
import { HALL_WALLS } from "../../grand-hall/hall-spec.js";
import { roomAtlasUv } from "../room-atlas.js";
import type { SurveyAtlas } from "../survey-record.js";

/** The Grand Hall's atlas, written as a survey record would give it. */
const GRAND_HALL_ATLAS: SurveyAtlas = {
  size: [WALL_ATLAS_SIZE, WALL_ATLAS_SIZE],
  ppm: WALL_ATLAS_PPM,
  vRange: [WALL_ATLAS_V_MIN, WALL_ATLAS_V_MAX],
  row: WALL_ATLAS_ROW,
  files: ["walls-4096.webp", "walls-2048.webp"],
};

describe("surveyed room atlas", () => {
  it("maps every Grand Hall wall's points exactly as wallAtlasUv does", () => {
    let compared = 0;
    for (const wall of HALL_WALLS) {
      const [x, y] = WALL_ATLAS_ORIGIN[wall.id];
      const strip = { atlas: [x, y, Math.ceil(wall.length * WALL_ATLAS_PPM), WALL_ATLAS_ROW] as [number, number, number, number] };
      for (let i = 0; i <= 20; i++) {
        const u = (wall.length * i) / 20;
        for (let j = 0; j <= 12; j++) {
          const v = WALL_ATLAS_V_MIN + ((WALL_ATLAS_V_MAX - WALL_ATLAS_V_MIN) * j) / 12;
          const expected = wallAtlasUv(wall.id, u, v);
          const actual = roomAtlasUv(GRAND_HALL_ATLAS, strip, u, v);
          expect(Object.is(actual[0], expected[0]) && Object.is(actual[1], expected[1]), `${wall.id} (${String(u)}, ${String(v)})`).toBe(true);
          compared++;
        }
      }
    }
    expect(compared).toBe(HALL_WALLS.length * 21 * 13);
  });

  it("puts a strip's corners where the record says, on a non-square atlas", () => {
    const atlas: SurveyAtlas = { size: [4096, 2304], ppm: 200, vRange: [-0.02, 5.535], row: 1111, files: ["walls-4096.webp"] };
    const rear = { atlas: [0, 1119, 1421, 1111] as [number, number, number, number] };
    // The top of the strip (v = vMax) is image row 1119, counted down.
    const [u0, top] = roomAtlasUv(atlas, rear, 0, 5.535);
    expect(u0).toBe(0);
    expect(top).toBeCloseTo(1 - 1119 / 2304, 12);
    // Its bottom (v = vMin) is 1111 rows lower.
    const [u1, bottom] = roomAtlasUv(atlas, rear, 7.101, -0.02);
    expect(u1).toBeCloseTo(1420.2 / 4096, 12);
    expect(bottom).toBeCloseTo(1 - (1119 + 1111) / 2304, 9);
  });
});
