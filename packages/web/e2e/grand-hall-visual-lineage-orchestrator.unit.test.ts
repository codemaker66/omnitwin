import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_VISIBLE_FIRST_LANES,
  assertGrandHallVisibleFirstResidencySequence,
  grandHallVisibleFirstLanePlan,
  grandHallVisibleFirstSanitizedParentEnvironment,
  type GrandHallVisibleFirstResidencyStage,
} from "./grand-hall-visual-lineage-orchestrator.js";

const validResidencyStages: readonly GrandHallVisibleFirstResidencyStage[] = [
  {
    runOrdinal: 1,
    residencyState: "cold_load",
    residencyRunOrdinal: 1,
    sourceRequestCountBefore: 0,
    sourceRequestCountAfter: 11,
    runtimeInstanceId: "grand-hall-runtime-1",
    renderedFrameCountBefore: 5,
    renderedFrameCountAfter: 725,
  },
  {
    runOrdinal: 2,
    residencyState: "resident",
    residencyRunOrdinal: 1,
    sourceRequestCountBefore: 11,
    sourceRequestCountAfter: 11,
    runtimeInstanceId: "grand-hall-runtime-1",
    renderedFrameCountBefore: 725,
    renderedFrameCountAfter: 1_445,
  },
  {
    runOrdinal: 3,
    residencyState: "resident",
    residencyRunOrdinal: 2,
    sourceRequestCountBefore: 11,
    sourceRequestCountAfter: 11,
    runtimeInstanceId: "grand-hall-runtime-1",
    renderedFrameCountBefore: 1_445,
    renderedFrameCountAfter: 2_165,
  },
  {
    runOrdinal: 4,
    residencyState: "resident",
    residencyRunOrdinal: 3,
    sourceRequestCountBefore: 11,
    sourceRequestCountAfter: 11,
    runtimeInstanceId: "grand-hall-runtime-1",
    renderedFrameCountBefore: 2_165,
    renderedFrameCountAfter: 2_885,
  },
];

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
      GRAND_HALL_LINEAGE_BROWSER_PROFILE_V1: "untrusted-parent-profile",
      GRAND_HALL_LINEAGE_CAPTURE_MODE: "difix-no-reference-v1",
    })).toEqual({ PATH: "preserved" });
  });

  it("runs both hardware gates before creating evidence or reading a Grand Hall source", () => {
    const orchestrator = readFileSync(
      new URL("./grand-hall-visual-lineage-orchestrator.ts", import.meta.url),
      "utf8",
    );
    expect(orchestrator.indexOf("await selectGrandHallHardwareBrowserProfile()"))
      .toBeLessThan(orchestrator.indexOf("await mkdir(path.dirname(evidenceDirectory)"));

    const captureSpec = readFileSync(
      new URL("./grand-hall-visual-lineage.local.spec.ts", import.meta.url),
      "utf8",
    );
    const radianceTestStart = captureSpec.indexOf(
      "for (const format of [\"sog\", \"spz\"] as const)",
    );
    const radiancePreflight = captureSpec.indexOf(
      "await browserHardwarePreflightBeforeSourceNavigation(",
      radianceTestStart,
    );
    expect(radiancePreflight).toBeGreaterThan(radianceTestStart);
    expect(radiancePreflight).toBeLessThan(
      captureSpec.indexOf("await readSourceMembers(SOURCE_ROOT, format)", radianceTestStart),
    );

    const plyTestStart = captureSpec.indexOf("supplied PLY at the source-pose interior camera");
    const plyPreflight = captureSpec.indexOf(
      "await browserHardwarePreflightBeforeSourceNavigation(",
      plyTestStart,
    );
    expect(plyPreflight).toBeGreaterThan(plyTestStart);
    expect(plyPreflight).toBeLessThan(
      captureSpec.indexOf("await readPlySource(SOURCE_ROOT)", plyTestStart),
    );
  });

  it("keeps all four captures on one loaded fixture instead of remounting the scene", () => {
    const captureSpec = readFileSync(
      new URL("./grand-hall-visual-lineage.local.spec.ts", import.meta.url),
      "utf8",
    );
    expect(captureSpec).not.toContain("page.goto(\"about:blank\"");
    expect(captureSpec.match(
      /if \(grandHallVisibleFirstRequiresSourceNavigation\(captureRun\)\)/gu,
    )).toHaveLength(2);
    expect(captureSpec).not.toContain("expect(page.url()).toBe(fixturePath)");
    expect(captureSpec.match(/residentFixtureUrl = page\.url\(\);/gu)).toHaveLength(2);
    expect(captureSpec.match(
      /expect\(page\.url\(\)\)\.toBe\(residentFixtureUrl\);/gu,
    )).toHaveLength(2);
  });

  it("accepts one cold load and three advancing captures from the same resident runtime", () => {
    expect(() => {
      assertGrandHallVisibleFirstResidencySequence({
        captures: validResidencyStages,
        sourceMemberCount: 11,
      });
    }).not.toThrow();
  });

  it("rejects the observed 11-to-22 repeat-load failure", () => {
    const captures = validResidencyStages.map((stage, index) => index === 1
      ? { ...stage, sourceRequestCountAfter: 22 }
      : stage);
    expect(() => {
      assertGrandHallVisibleFirstResidencySequence({ captures, sourceMemberCount: 11 });
    }).toThrow(/reload/u);
  });

  it("rejects a changed runtime identity even when source requests stay resident", () => {
    const captures = validResidencyStages.map((stage, index) => index === 2
      ? { ...stage, runtimeInstanceId: "grand-hall-runtime-2" }
      : stage);
    expect(() => {
      assertGrandHallVisibleFirstResidencySequence({ captures, sourceMemberCount: 11 });
    }).toThrow(/runtime identity/u);
  });

  it("rejects incorrect cold/resident ordering", () => {
    const second = validResidencyStages[1];
    const third = validResidencyStages[2];
    if (second === undefined || third === undefined) throw new Error("Test fixture is incomplete.");
    const captures = [validResidencyStages[0], third, second, validResidencyStages[3]]
      .filter((stage): stage is GrandHallVisibleFirstResidencyStage => stage !== undefined);
    expect(() => {
      assertGrandHallVisibleFirstResidencySequence({ captures, sourceMemberCount: 11 });
    }).toThrow(/wrong cold\/resident sequence/u);
  });

  it("rejects insufficient and non-monotonic rendered-frame ranges", () => {
    const shortCapture = validResidencyStages.map((stage, index) => index === 1
      ? { ...stage, renderedFrameCountAfter: stage.renderedFrameCountBefore + 719 }
      : stage);
    expect(() => {
      assertGrandHallVisibleFirstResidencySequence({
        captures: shortCapture,
        sourceMemberCount: 11,
      });
    }).toThrow(/frame ranges/u);

    const rewoundCapture = validResidencyStages.map((stage, index) => index === 2
      ? {
          ...stage,
          renderedFrameCountBefore: 1_444,
          renderedFrameCountAfter: 2_164,
        }
      : stage);
    expect(() => {
      assertGrandHallVisibleFirstResidencySequence({
        captures: rewoundCapture,
        sourceMemberCount: 11,
      });
    }).toThrow(/frame ranges/u);
  });
});
