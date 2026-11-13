// The walls' relief arriving (hall-arrival.ts): built in slices, the same as built at once.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWallRelief, type WallRelief } from "../hall-relief.js";
import { drawnRelief } from "../hall-walls.js";
import { buildHallWallGeometry, hallWallGeometry } from "../hall-geometry.js";
import { reliefSlicer, sectionCapGeometry } from "../hall-relief-section.js";
import { prepareWallRelief } from "../hall-arrival.js";
import { SlicedBuildCancelled, drain, runSliced } from "../hall-slices.js";

function freshRelief(): WallRelief {
  const bytes = readFileSync(path.resolve("public/rooms/grand-hall/survey-2026-07-11/walls-relief.bin"));
  return parseWallRelief(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

describe("sliced builds", () => {
  function* counting(steps: number) {
    for (let i = 0; i < steps; i++) yield;
    return steps;
  }

  it("drain runs a build to its end; runSliced hands the thread back between slices", async () => {
    expect(drain(counting(5))).toBe(5);
    let yields = 0;
    const result = await runSliced(counting(5), { budgetMs: 0, yieldNow: () => { yields += 1; return Promise.resolve(); } });
    expect(result).toBe(5);
    expect(yields).toBe(5);
    yields = 0;
    await runSliced(counting(5), { budgetMs: 1e9, yieldNow: () => { yields += 1; return Promise.resolve(); } });
    expect(yields).toBe(0);
  });

  it("stops when its owner has gone", async () => {
    let live = true;
    const run = runSliced(counting(10), { budgetMs: 0, yieldNow: () => { live = false; return Promise.resolve(); }, live: () => live });
    await expect(run).rejects.toBeInstanceOf(SlicedBuildCancelled);
  });
});

describe("the relief's arrival", () => {
  it("builds the drawn relief, the walls, the cap and the slicer in slices, and leaves each cached for the hall", async () => {
    const relief = freshRelief();
    let yields = 0;
    const drawn = await prepareWallRelief(relief, { budgetMs: 0, yieldNow: () => { yields += 1; return Promise.resolve(); } });
    // Every few hundred triangles a step: well over a hundred places to hand the thread back.
    expect(yields).toBeGreaterThan(100);
    expect(drawnRelief(relief)).toBe(drawn);
    const walls = hallWallGeometry(drawn);
    expect(hallWallGeometry(drawn)).toBe(walls);
    expect(sectionCapGeometry(drawn)).toBe(sectionCapGeometry(drawn));
    expect(reliefSlicer(drawn)).toBe(reliefSlicer(drawn));
  });

  it("builds exactly what the synchronous build makes", async () => {
    const sliced = hallWallGeometry(await prepareWallRelief(freshRelief(), { budgetMs: 0, yieldNow: () => Promise.resolve() }));
    const atOnce = buildHallWallGeometry(drawnRelief(freshRelief()));
    expect(sliced.stats).toEqual(atOnce.stats);
    for (const [key, geometry] of atOnce.geometries) {
      const other = sliced.geometries.get(key);
      expect(other).toBeDefined();
      for (const name of Object.keys(geometry.attributes)) {
        expect(Array.from(other?.attributes[name]?.array ?? [])).toEqual(Array.from(geometry.attributes[name]?.array ?? []));
      }
      expect(Array.from(other?.index?.array ?? [])).toEqual(Array.from(geometry.index?.array ?? []));
    }
  });

  it("stops without a word when the hall goes before it is done", async () => {
    await expect(prepareWallRelief(freshRelief(), { budgetMs: 0, yieldNow: () => Promise.resolve(), live: () => false })).rejects.toBeInstanceOf(SlicedBuildCancelled);
  });
});
