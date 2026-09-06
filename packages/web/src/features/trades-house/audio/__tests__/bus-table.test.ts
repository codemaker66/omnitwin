import { describe, expect, it } from "vitest";
import { BUS_NAMES } from "../../stage/stage-manifest.js";
import { BUS_GAIN_DB } from "../audio-types.js";
import { busSumDbfs, dbToLinear, linearToDb } from "../gain.js";

describe("the bus table", () => {
  it("sums, at full scale on every bus, to -3 dBFS or below: the compressor is a crash guard, not a limiter", () => {
    expect(busSumDbfs(BUS_GAIN_DB)).toBeLessThanOrEqual(-3);
  });

  it("names every bus the manifest can route to, and nothing else", () => {
    expect(Object.keys(BUS_GAIN_DB).sort()).toEqual([...BUS_NAMES].sort());
    for (const name of BUS_NAMES) {
      expect(BUS_GAIN_DB[name]).toBeLessThan(0);
      expect(Number.isFinite(BUS_GAIN_DB[name])).toBe(true);
    }
  });

  it("keeps the hierarchy: the pokes hottest, the ceremony and music under them, the beds felt not heard", () => {
    expect(BUS_GAIN_DB.sfx).toBeGreaterThan(BUS_GAIN_DB.music);
    expect(BUS_GAIN_DB.sfx).toBeGreaterThan(BUS_GAIN_DB.ui);
    expect(BUS_GAIN_DB.music).toBeGreaterThan(BUS_GAIN_DB.ambience);
    expect(BUS_GAIN_DB.ui).toBeGreaterThan(BUS_GAIN_DB.ambience);
  });

  it("records why the first table was corrected: -14, -12, -9, -12 summed above full scale", () => {
    const firstDraft = { ambience: -14, music: -12, sfx: -9, ui: -12 };
    expect(busSumDbfs(firstDraft)).toBeGreaterThan(-3);
    expect(busSumDbfs(firstDraft)).toBeCloseTo(0.48, 2);
  });

  it("does amplitude decibels", () => {
    expect(dbToLinear(0)).toBe(1);
    expect(dbToLinear(-6)).toBeCloseTo(0.5012, 4);
    expect(dbToLinear(-20)).toBeCloseTo(0.1, 6);
    expect(linearToDb(dbToLinear(-14))).toBeCloseTo(-14, 9);
    expect(busSumDbfs({ a: -6, b: -6 })).toBeCloseTo(0.0206, 3);
  });
});
