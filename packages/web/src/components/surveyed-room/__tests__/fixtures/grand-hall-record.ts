import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  WALL_ATLAS_ORIGIN,
  WALL_ATLAS_PPM,
  WALL_ATLAS_ROW,
  WALL_ATLAS_SIZE,
  WALL_ATLAS_V_MAX,
  WALL_ATLAS_V_MIN,
} from "../../../grand-hall/hall-atlas.js";
import { HALL_HALF_LENGTH, HALL_HALF_WIDTH, HALL_HEIGHT, hallWall, type HallWallId } from "../../../grand-hall/hall-spec.js";
import { parseSurveyRecord, type SurveyRecord } from "../../survey-record.js";

// The Grand Hall written as a survey.json would describe it, for tests only:
// the hall publishes no record of its own (it keeps its own code), but its
// shipped files are the one real survey in the repository, so the room-driven
// path is checked against them through a record that says what hall-spec.ts
// and hall-atlas.ts say.

/** The hall's published survey, relative to packages/web (where the tests run). */
export const GRAND_HALL_SURVEY_FOLDER = "public/rooms/grand-hall/survey-2026-07-11";

/**
 * The hall's walls in outline order: counter-clockwise seen from above,
 * starting at the corner where the end wall meets the window wall.
 */
export const GRAND_HALL_WALL_ORDER: readonly HallWallId[] = ["window", "fireplace", "door", "end"];

const IMAGES = {
  atlas: ["walls-4096.webp", "walls-2048.webp"],
  ceiling: ["ceiling-3072.webp", "ceiling-1536.webp"],
  floor: ["floor-2560.webp", "floor-1280.webp"],
} as const;
const RELIEF_FILE = "walls-relief.bin";

/** A shipped survey file's bytes. */
export function grandHallFile(name: string): ArrayBuffer {
  const file = readFileSync(path.resolve(GRAND_HALL_SURVEY_FOLDER, name));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

/** The record as raw JSON, which a test may change before parsing. */
export function grandHallRecordJson(): Record<string, unknown> {
  const extent = { x: [-HALL_HALF_LENGTH, HALL_HALF_LENGTH], z: [-HALL_HALF_WIDTH, HALL_HALF_WIDTH] };
  const files: Record<string, { bytes: number; sha256: string }> = {};
  for (const name of [...IMAGES.atlas, RELIEF_FILE, ...IMAGES.ceiling, ...IMAGES.floor]) {
    const bytes = Buffer.from(grandHallFile(name));
    files[name] = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  return {
    schemaVersion: 2,
    slug: "grand-hall",
    revision: 7,
    captured: "2026-07-11",
    room: {
      name: "Grand Hall",
      venue: "trades-hall",
      ceilingHeight: HALL_HEIGHT,
      outline: [
        [HALL_HALF_LENGTH, -HALL_HALF_WIDTH],
        [-HALL_HALF_LENGTH, -HALL_HALF_WIDTH],
        [-HALL_HALF_LENGTH, HALL_HALF_WIDTH],
        [HALL_HALF_LENGTH, HALL_HALF_WIDTH],
      ],
    },
    atlas: {
      size: [WALL_ATLAS_SIZE, WALL_ATLAS_SIZE],
      ppm: WALL_ATLAS_PPM,
      vRange: [WALL_ATLAS_V_MIN, WALL_ATLAS_V_MAX],
      row: WALL_ATLAS_ROW,
      files: [...IMAGES.atlas],
    },
    walls: GRAND_HALL_WALL_ORDER.map((id) => {
      const wall = hallWall(id);
      const [x, y] = WALL_ATLAS_ORIGIN[id];
      return { id, reliefId: id, length: wall.length, height: HALL_HEIGHT, kind: "solid", atlas: [x, y, Math.ceil(wall.length * WALL_ATLAS_PPM), WALL_ATLAS_ROW] };
    }),
    relief: { container: "GHR1", file: RELIEF_FILE, order: ["window", "end", "door", "fireplace"] },
    ceiling: { extent, orientation: "columns planner +x, rows from planner +z", files: [...IMAGES.ceiling] },
    floor: { extent, orientation: "columns planner +x, rows from planner +z", files: [...IMAGES.floor] },
    files,
  };
}

/** The record, read and checked as any room's is. */
export function grandHallRecord(): SurveyRecord {
  return parseSurveyRecord(grandHallRecordJson());
}
