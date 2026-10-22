// The first floor's plan for the tests (hall-neighbours.ts, hall-beyond.ts): the venue's 2010 FIRST plan as
// measure/first-floor.py builds it locally, where a machine has built it, or else a synthetic plan of a few
// rectangles. The plan's vectors are not published (the venue's drawing; review F2, 22 October 2026), so the
// repository and CI never hold them: the tests of the real registration run only where the local file exists.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Where measure/first-floor.py writes the plan for a local build (gitignored). */
export const LOCAL_FIRST_FLOOR = path.resolve("public/rooms/grand-hall/survey-2026-07-11/local/first-floor-2010.json");

/** Whether this machine has built the real plan. */
export const HAS_LOCAL_FIRST_FLOOR = existsSync(LOCAL_FIRST_FLOOR);

type Ring = [number, number][];
const rect = (x0: number, z0: number, x1: number, z1: number): Ring => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

/**
 * A plan of the same shape as first-floor-2010.json, synthetic: a corridor wall beyond the door wall, a
 * cross wall, a room's walls beyond the end wall, and a floor between them, all clear of the hall's bodies.
 */
export function syntheticFirstFloorJson(): Record<string, unknown> {
  const wall = (id: string, outline: Ring) => ({ id, outline, holes: [], source: "synthetic test plan (no venue drawing), drawing paths 0" });
  return {
    version: 1,
    frame: "planner",
    source: { file: "synthetic.pdf", sha256: "0".repeat(64), page: 1, what: "a synthetic plan for the tests", paths: 4 },
    registration: {
      affine: [[1, 0, 0], [0, 1, 0]],
      residuals: { fitted: { hall: { metres: 10, median: 0.01, p90: 0.02 }, saloon: { metres: 10, median: 0.05, p90: 0.1 } } },
    },
    walls: [
      wall("corridor", rect(-12, 9.0, 12, 9.3)),
      wall("cross", rect(7.4, 6.6, 7.7, 8.9)),
      wall("end-room", rect(12.2, -6, 12.5, 9.0)),
    ],
    floor: [{ id: "floor", outline: rect(-11.5, 6.7, 7.4, 9.0), holes: [], source: "synthetic test plan (no venue drawing): its floor" }],
  };
}

/** The real plan where built locally, else the synthetic one, as parsed JSON. */
export function firstFloorJson(): unknown {
  if (!HAS_LOCAL_FIRST_FLOOR) return syntheticFirstFloorJson();
  const parsed: unknown = JSON.parse(readFileSync(LOCAL_FIRST_FLOOR, "utf8"));
  return parsed;
}
