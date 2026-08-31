import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_BROWSER_CACHE_EVIDENCE_PREFIX,
  GRAND_HALL_VISIBLE_FIRST_CAPTURE_RUNS,
  GRAND_HALL_VISIBLE_FIRST_REPRESENTATIONS,
  grandHallBrowserCacheEvidence,
  grandHallRadianceRankingEligible,
  grandHallVisibleFirstRunLabel,
  parseGrandHallVisibleFirstRepresentation,
} from "./grand-hall-visual-lineage-bakeoff.js";

describe("Grand Hall visible-first browser bake-off contract", () => {
  it("pins the sequential lane order and one-cold-plus-three-warm run plan", () => {
    expect(GRAND_HALL_VISIBLE_FIRST_REPRESENTATIONS).toEqual(["sog", "spz", "ply"]);
    expect(GRAND_HALL_VISIBLE_FIRST_CAPTURE_RUNS).toEqual([
      { ordinal: 1, cacheState: "cold", cacheRunOrdinal: 1 },
      { ordinal: 2, cacheState: "warm", cacheRunOrdinal: 1 },
      { ordinal: 3, cacheState: "warm", cacheRunOrdinal: 2 },
      { ordinal: 4, cacheState: "warm", cacheRunOrdinal: 3 },
    ]);
    expect(GRAND_HALL_VISIBLE_FIRST_CAPTURE_RUNS.map(grandHallVisibleFirstRunLabel)).toEqual([
      "cold-run-1",
      "warm-run-1",
      "warm-run-2",
      "warm-run-3",
    ]);
  });

  it("rejects unknown lane selectors", () => {
    expect(parseGrandHallVisibleFirstRepresentation(undefined)).toBeUndefined();
    expect(parseGrandHallVisibleFirstRepresentation("spz")).toBe("spz");
    expect(() => parseGrandHallVisibleFirstRepresentation("lcc")).toThrow(/Unsupported/u);
  });

  it("keeps PLY structural-only and outside captured-radiance ranking", () => {
    expect(grandHallRadianceRankingEligible("sog")).toBe(true);
    expect(grandHallRadianceRankingEligible("spz")).toBe(true);
    expect(grandHallRadianceRankingEligible("ply")).toBe(false);
  });

  it("serializes cache evidence with the representation process scope", () => {
    const marker = grandHallBrowserCacheEvidence({
      representation: "sog",
      run: GRAND_HALL_VISIBLE_FIRST_CAPTURE_RUNS[1],
      sourceRequestCountBefore: 11,
      sourceRequestCountAfter: 11,
    });
    expect(marker.startsWith(GRAND_HALL_BROWSER_CACHE_EVIDENCE_PREFIX)).toBe(true);
    expect(JSON.parse(marker.slice(GRAND_HALL_BROWSER_CACHE_EVIDENCE_PREFIX.length))).toEqual({
      representation: "sog",
      runOrdinal: 2,
      cacheState: "warm",
      cacheRunOrdinal: 1,
      sourceRequestCountBefore: 11,
      sourceRequestCountAfter: 11,
      browserProcessScope: "one_representation_cold_plus_three_warm",
    });
  });
});
