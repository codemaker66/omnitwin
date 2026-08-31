import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_VISIBLE_FIRST_LANES,
  grandHallVisibleFirstLanePlan,
  grandHallVisibleFirstSanitizedParentEnvironment,
} from "./grand-hall-visual-lineage-orchestrator.js";

describe("Grand Hall visible-first process orchestrator", () => {
  it("creates three sequential process lanes with distinct server ports and directories", () => {
    const evidenceDirectory = path.resolve("evidence", "fresh-run");
    const plan = grandHallVisibleFirstLanePlan(evidenceDirectory, 5_240);
    expect(plan.map((entry) => ({
      representation: entry.lane.representation,
      evidenceDirectory: entry.evidenceDirectory,
      baseUrl: entry.baseUrl,
    }))).toEqual([
      {
        representation: "sog",
        evidenceDirectory: path.join(evidenceDirectory, "sog"),
        baseUrl: "http://127.0.0.1:5240",
      },
      {
        representation: "spz",
        evidenceDirectory: path.join(evidenceDirectory, "spz"),
        baseUrl: "http://127.0.0.1:5241",
      },
      {
        representation: "ply",
        evidenceDirectory: path.join(evidenceDirectory, "ply"),
        baseUrl: "http://127.0.0.1:5242",
      },
    ]);
  });

  it("excludes the PLY lane from captured-radiance ranking", () => {
    expect(GRAND_HALL_VISIBLE_FIRST_LANES.map((lane) => ({
      representation: lane.representation,
      radianceRankingEligible: lane.radianceRankingEligible,
    }))).toEqual([
      { representation: "sog", radianceRankingEligible: true },
      { representation: "spz", radianceRankingEligible: true },
      { representation: "ply", radianceRankingEligible: false },
    ]);
  });

  it("rejects a base port that cannot reserve the three-lane range", () => {
    expect(() => grandHallVisibleFirstLanePlan(path.resolve("evidence"), 65_533)).toThrow(
      /reserve three/u,
    );
  });

  it("removes inherited modes that could reuse or retry the controlled browser run", () => {
    expect(grandHallVisibleFirstSanitizedParentEnvironment({
      PATH: "preserved",
      CI: "true",
      E2E_BROWSER_CHANNEL: "chrome",
      E2E_WEB_SERVER: "preview",
      GRAND_HALL_LINEAGE_CAPTURE_MODE: "difix-no-reference-v1",
    })).toEqual({ PATH: "preserved" });
  });
});
