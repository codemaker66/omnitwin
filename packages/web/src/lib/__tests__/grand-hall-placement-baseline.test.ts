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
// figures master's own planner code gives (grand-hall-baseline.ts).
//
// Since #391 the hall is the laser scan's 21.135 by 10.59 m, 6.7 m high.
// The figures in the fixture were taken on 13 November 2026 from master's
// planner code at origin/master c85f60ac, at that size, not from this
// branch: the helper copied with its imports pointed at a `git archive` of
// c85f60ac's packages/web/src (the 46 planner files the helper reaches, each
// checked against c85f60ac's own blob), taken twice, the same both times.
// From the record before it (cdb6eb8f's) only the theatre fills changed, as
// #410's rear walkway explains: 20 rows and 280 seats where there were 21 and
// 294, 268 where 280 with the doors kept clear, and the planner's own theatre
// fill likewise; every other section is byte for byte the same. So the test
// proves that this branch decides the Grand Hall exactly as master does.
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

  it("opens as the 21.135 × 10.59 × 6.7 m room the hall's scan measured, the size master's figures were taken at", () => {
    expect(dims).toStrictEqual({ width: 21.135, length: 10.59, height: 6.7 });
    expect(recorded()["dims"]).toStrictEqual({ width: 21.135, length: 10.59, height: 6.7 });
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
