import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeBoundingBox, roomGeometries } from "../../data/room-geometries.js";
import { scaleForRendering } from "../../constants/scale.js";
import { computeGrandHallBaseline } from "./grand-hall-baseline.js";

// ---------------------------------------------------------------------------
// The Grand Hall is the product's main room and a rectangle centred on the
// origin. Teaching the planner a room's real outline (audit editor-save-4:
// the Robert Adam Room's walls are not a box round the origin) must change
// nothing here: where a piece may stand, where the walls pull it, what the
// ghost says, and every table, chair and seat Fill sets are held to the
// figures taken from the code before that change (grand-hall-baseline.ts).
// ---------------------------------------------------------------------------

function recorded(): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve("src/lib/__tests__/fixtures/grand-hall-placement-baseline.json"), "utf8")) as Record<string, unknown>;
}

/** Through JSON, as the recorded figures went: every number survives exactly. */
function asRecorded(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

describe("the Grand Hall's placement decisions", () => {
  // The room exactly as it reached the planner's room store when the figures were taken.
  const geometry = roomGeometries["Grand Hall"];
  if (geometry === undefined) throw new Error("no Grand Hall geometry");
  const box = computeBoundingBox(geometry.wallPolygon);
  const dims = scaleForRendering({ width: box.width, length: box.depth, height: geometry.ceilingHeight });

  it("opens as the 21 × 10.5 × 7 m room it always was", () => {
    expect(dims).toStrictEqual({ width: 21, length: 10.5, height: 7 });
    expect(recorded()["dims"]).toStrictEqual({ width: 21, length: 10.5, height: 7 });
  });

  const want = recorded();
  const got = asRecorded(computeGrandHallBaseline(dims));

  it("records every section it compares", () => {
    expect(Object.keys(got).sort()).toStrictEqual(Object.keys(want).sort());
  });

  it.each([
    ["names the same pieces", "kinds"],
    ["lets a piece stand on exactly the same floor", "bounds"],
    ["decides the same at each wall, to a millionth of a metre either side", "flush"],
    ["pulls a piece to the same walls", "snap"],
    ["gives the ghost the same verdicts, pushes and refusals", "ghost"],
    ["sets the same banquet rounds for every guest count, doors kept clear or not", "banquet"],
    ["sets the same theatre seats for every guest count, doors kept clear or not", "theatre"],
    ["designs the same gangway fill", "gangways"],
    ["adds the same tables for a seat shortfall", "shortfall"],
    ["places the same pieces through the planner's own actions", "store"],
  ])("%s", (_name, section) => {
    expect(want[section]).toBeDefined();
    expect(got[section]).toStrictEqual(want[section]);
  });
});
