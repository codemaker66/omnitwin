import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_BROWSER_SOURCE_RESIDENCY_EVIDENCE_PREFIX,
  GRAND_HALL_VISIBLE_FIRST_CAPTURE_RUNS,
  GRAND_HALL_VISIBLE_FIRST_REPRESENTATIONS,
  grandHallBrowserSourceResidencyEvidence,
  grandHallRadianceRankingEligible,
  grandHallVisibleFirstRequiresSourceNavigation,
  grandHallVisibleFirstRunLabel,
  parseGrandHallVisibleFirstRepresentation,
} from "./grand-hall-visual-lineage-bakeoff.js";

describe("Grand Hall visible-first browser bake-off contract", () => {
  it("pins one cold source load followed by three captures from the resident fixture", () => {
    expect(GRAND_HALL_VISIBLE_FIRST_REPRESENTATIONS).toEqual(["sog", "spz", "ply"]);
    expect(GRAND_HALL_VISIBLE_FIRST_CAPTURE_RUNS).toEqual([
      { ordinal: 1, residencyState: "cold_load", residencyRunOrdinal: 1 },
      { ordinal: 2, residencyState: "resident", residencyRunOrdinal: 1 },
      { ordinal: 3, residencyState: "resident", residencyRunOrdinal: 2 },
      { ordinal: 4, residencyState: "resident", residencyRunOrdinal: 3 },
    ]);
    expect(GRAND_HALL_VISIBLE_FIRST_CAPTURE_RUNS.map(grandHallVisibleFirstRunLabel)).toEqual([
      "cold-load-1",
      "resident-capture-1",
      "resident-capture-2",
      "resident-capture-3",
    ]);
    expect(GRAND_HALL_VISIBLE_FIRST_CAPTURE_RUNS.map(
      grandHallVisibleFirstRequiresSourceNavigation,
    )).toEqual([true, false, false, false]);
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

  it("serializes same-instance source-residency evidence", () => {
    const marker = grandHallBrowserSourceResidencyEvidence({
      representation: "sog",
      run: GRAND_HALL_VISIBLE_FIRST_CAPTURE_RUNS[1],
      sourceRequestCountBefore: 11,
      sourceRequestCountAfter: 11,
      runtimeInstanceId: "f30c3ee5-2f45-4ef7-bc73-5dd31de85d7c",
      renderedFrameCountBefore: 725,
      renderedFrameCountAfter: 1_445,
    });
    expect(marker.startsWith(GRAND_HALL_BROWSER_SOURCE_RESIDENCY_EVIDENCE_PREFIX)).toBe(true);
    expect(JSON.parse(
      marker.slice(GRAND_HALL_BROWSER_SOURCE_RESIDENCY_EVIDENCE_PREFIX.length),
    )).toEqual({
      representation: "sog",
      runOrdinal: 2,
      residencyState: "resident",
      residencyRunOrdinal: 1,
      sourceRequestCountBefore: 11,
      sourceRequestCountAfter: 11,
      runtimeInstanceId: "f30c3ee5-2f45-4ef7-bc73-5dd31de85d7c",
      renderedFrameCountBefore: 725,
      renderedFrameCountAfter: 1_445,
      browserProcessScope: "one_representation_one_cold_load_plus_three_resident_captures",
    });
    expect(marker.length).toBeLessThanOrEqual(500);
  });
});
