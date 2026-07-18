import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectUniversalIntakeWithSourceFactsV5 } from "../intake-receipt.js";
import {
  FOUNDRY_CALIBRATION_DOCUMENT_UNKNOWNS,
  FOUNDRY_TRAJECTORY_DOCUMENT_UNKNOWNS,
} from "../source-facts-v5.js";
import {
  FoundrySourceReadinessMapV5Schema,
  compileFoundrySourceReadinessMapV5,
} from "../source-readiness-v5.js";
import {
  FoundryOperatorEvidenceChecklistV5Schema,
  compileFoundryOperatorEvidenceChecklistV5,
} from "../operator-evidence-checklist-v5.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function sourceRoot(files: Readonly<Record<string, Buffer>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-registration-readiness-v5-"));
  roots.push(root);
  for (const [name, bytes] of Object.entries(files)) await writeFile(join(root, name), bytes);
  return root;
}

const POSES = Buffer.from([
  "1780322782.895321,0.000415,0.001354,0.004690,-0.505607,0.009709,-0.001803,0.862707",
  "1780322782.995328,0.000481,0.001416,0.005078,-0.505696,0.009559,-0.002523,0.862655",
  "",
].join("\n"), "utf8");

describe("calibration and trajectory Source Readiness and Operator Evidence V5", () => {
  it("propagates trajectory structure and all unknowns into registration/control evidence", async () => {
    const inspected = await inspectUniversalIntakeWithSourceFactsV5(
      await sourceRoot({ "poses.csv": POSES }),
    );
    const readiness = compileFoundrySourceReadinessMapV5(inspected);

    expect(readiness).toMatchObject({
      schemaVersion: "omnitwin.foundry.source-readiness-map.v5",
      state: "available",
      summary: {
        factsEstablishedCount: 1,
        factsNotEstablishedCount: 0,
        outsideSourceFactsV5Count: 0,
      },
      files: [{
        path: "poses.csv",
        status: "facts_established",
        inputType: "trajectory",
        format: "csv",
        laneIds: ["registration_and_control"],
      }],
    });
    if (readiness.state !== "available") throw new Error("expected V5 readiness");
    expect(readiness.files[0]?.unknowns.map((unknown) => unknown.code).sort()).toEqual(
      FOUNDRY_TRAJECTORY_DOCUMENT_UNKNOWNS.map((unknown) => unknown.code).sort(),
    );
    expect(readiness.lanes.find((lane) => lane.id === "registration_and_control"))
      .toMatchObject({
        status: "all_observed_facts_established",
        counts: { observedFileCount: 1, factsEstablishedCount: 1 },
      });

    const checklist = compileFoundryOperatorEvidenceChecklistV5({ readiness });
    if (checklist.state !== "available") throw new Error("expected V5 checklist");
    expect(checklist.schemaVersion).toBe(
      "omnitwin.foundry.operator-evidence-checklist.v5",
    );
    const trajectoryItems = checklist.items.filter((item) =>
      item.evidenceCode.startsWith("TRAJECTORY_")
    );
    expect(trajectoryItems.map((item) => item.evidenceCode).sort()).toEqual(
      FOUNDRY_TRAJECTORY_DOCUMENT_UNKNOWNS.map((unknown) => unknown.code).sort(),
    );
    expect(new Map(trajectoryItems.map((item) => [item.evidenceCode, item.category])))
      .toEqual(new Map([
        ["TRAJECTORY_ACCURACY_AND_DRIFT_UNKNOWN", "independent_control"],
        ["TRAJECTORY_CLOCK_DOMAIN_AND_TIME_UNITS_UNKNOWN", "registration_input"],
        ["TRAJECTORY_COMPLETENESS_AND_SYNCHRONIZATION_UNKNOWN", "registration_input"],
        ["TRAJECTORY_COORDINATE_FRAME_AND_UNITS_UNKNOWN", "registration_input"],
        ["TRAJECTORY_FIELD_SEMANTICS_UNKNOWN", "bounded_inspection"],
        ["TRAJECTORY_PROVENANCE_UNKNOWN", "source_provenance"],
        ["TRAJECTORY_RIGHTS_UNKNOWN", "rights_decision"],
        ["TRAJECTORY_TRANSFORM_CONVENTION_UNKNOWN", "registration_input"],
      ]));
    expect(FoundrySourceReadinessMapV5Schema.parse(readiness)).toEqual(readiness);
    expect(FoundryOperatorEvidenceChecklistV5Schema.parse(checklist)).toEqual(checklist);
  });

  it("maps calibration declarations without claiming that calibration is valid", async () => {
    const inspected = await inspectUniversalIntakeWithSourceFactsV5(
      await sourceRoot({
        "camera-calibration.json": Buffer.from(
          '{"camera_model":"PINHOLE","fl_x":512,"frames":[]}',
          "utf8",
        ),
      }),
    );
    const readiness = compileFoundrySourceReadinessMapV5(inspected);
    expect(readiness).toMatchObject({
      state: "available",
      files: [{
        inputType: "calibration_bundle",
        format: "json",
        laneIds: ["registration_and_control"],
      }],
      policy: {
        execution: "not_authorized",
        authority: "none",
        accuracy: "not_evaluated",
        registration: "not_evaluated",
      },
    });
    if (readiness.state !== "available") throw new Error("expected V5 readiness");
    expect(readiness.files[0]?.unknowns.map((unknown) => unknown.code).sort()).toEqual(
      FOUNDRY_CALIBRATION_DOCUMENT_UNKNOWNS.map((unknown) => unknown.code).sort(),
    );
    const checklist = compileFoundryOperatorEvidenceChecklistV5({ readiness });
    if (checklist.state !== "available") throw new Error("expected V5 checklist");
    expect(checklist.items.filter((item) => item.evidenceCode.startsWith("CALIBRATION_"))
      .map((item) => item.evidenceCode).sort()).toEqual(
      FOUNDRY_CALIBRATION_DOCUMENT_UNKNOWNS.map((unknown) => unknown.code).sort(),
    );
    expect(checklist.policy).toMatchObject({
      execution: "not_authorized",
      authority: "none",
      accuracy: "not_evaluated",
      registration: "not_evaluated",
    });
  });

  it("keeps ambiguous families untargeted and XBIN evidence atomic", async () => {
    const ambiguous = await inspectUniversalIntakeWithSourceFactsV5(
      await sourceRoot({ "calibration-trajectory.json": Buffer.from("{}", "utf8") }),
    );
    const ambiguousReadiness = compileFoundrySourceReadinessMapV5(ambiguous);
    expect(ambiguousReadiness).toMatchObject({
      state: "available",
      files: [{ status: "ambiguous_format", inputType: null, format: null }],
    });
    expect(ambiguousReadiness.gaps.map((gap) => gap.code)).toContain(
      "AMBIGUOUS_FORMAT",
    );
    const ambiguousChecklist = compileFoundryOperatorEvidenceChecklistV5({
      readiness: ambiguousReadiness,
    });
    if (ambiguousChecklist.state !== "available") throw new Error("expected checklist");
    expect(ambiguousChecklist.items.map((item) => item.evidenceCode)).toContain(
      "AMBIGUOUS_FORMAT",
    );
    expect(ambiguousChecklist.items.some((item) =>
      item.evidenceCode.startsWith("TRAJECTORY_") ||
      item.evidenceCode.startsWith("CALIBRATION_")
    )).toBe(false);

    const blocked = await inspectUniversalIntakeWithSourceFactsV5(
      await sourceRoot({
        "poses.csv": POSES,
        "vendor.xbin": Buffer.from([1, 2, 3, 4]),
      }),
    );
    const blockedReadiness = compileFoundrySourceReadinessMapV5(blocked);
    expect(blockedReadiness).toMatchObject({
      state: "blocked",
      files: [],
      gaps: [],
      blockedReason: { code: "XGRIDS_XBIN_BLOCKED" },
    });
    expect(compileFoundryOperatorEvidenceChecklistV5({ readiness: blockedReadiness }))
      .toMatchObject({ state: "blocked", groups: [], items: [] });
  });
});
