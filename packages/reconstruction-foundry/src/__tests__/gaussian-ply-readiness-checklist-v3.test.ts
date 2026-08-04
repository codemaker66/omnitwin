import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FOUNDRY_OPERATOR_EVIDENCE_UNKNOWN_CODES,
  FoundryOperatorEvidenceChecklistV3Schema,
  compileFoundryOperatorEvidenceChecklistV3,
  serializeFoundryOperatorEvidenceChecklistV3,
} from "../operator-evidence-checklist-v3.js";
import {
  inspectUniversalIntakeWithSourceFactsV2,
  inspectUniversalIntakeWithSourceFactsV3,
} from "../intake-receipt.js";
import { FOUNDRY_GAUSSIAN_PLY_UNKNOWNS } from "../source-facts-v3.js";
import { compileFoundrySourceReadinessMapV2 } from "../source-readiness-v2.js";
import {
  FoundrySourceReadinessMapV3Schema,
  compileFoundrySourceReadinessMapV3,
  serializeFoundrySourceReadinessMapV3,
} from "../source-readiness-v3.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function sourceRoot(files: Readonly<Record<string, Buffer>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-gaussian-ply-v3-"));
  roots.push(root);
  await Promise.all(
    Object.entries(files).map(([name, bytes]) => writeFile(join(root, name), bytes)),
  );
  return root;
}

function gaussianPlyFixture(): Buffer {
  const properties = [
    "x",
    "y",
    "z",
    "f_dc_0",
    "f_dc_1",
    "f_dc_2",
    "opacity",
    "scale_0",
    "scale_1",
    "scale_2",
    "rot_0",
    "rot_1",
    "rot_2",
    "rot_3",
  ] as const;
  const header = Buffer.from(
    [
      "ply",
      "format binary_little_endian 1.0",
      "comment Exported from Brush",
      "comment SH degree: 0",
      "element vertex 1",
      ...properties.map((property) => `property float ${property}`),
      "end_header",
      "",
    ].join("\n"),
    "ascii",
  );
  const payload = Buffer.alloc(properties.length * 4);
  payload.writeFloatLE(1, properties.indexOf("rot_0") * 4);
  return Buffer.concat([header, payload]);
}

function ordinaryPointPlyFixture(): Buffer {
  return Buffer.from(
    [
      "ply",
      "format ascii 1.0",
      "element vertex 1",
      "property float x",
      "property float y",
      "property float z",
      "end_header",
      "0 0 0",
      "",
    ].join("\n"),
    "ascii",
  );
}

describe("Gaussian PLY Source Readiness and Operator Evidence V3", () => {
  it("promotes only Gaussian PLY into the visual-scene lane and maps every frozen unknown explicitly", async () => {
    const root = await sourceRoot({ "scene.ply": gaussianPlyFixture() });

    const legacy = await inspectUniversalIntakeWithSourceFactsV2(root);
    const legacyReadiness = compileFoundrySourceReadinessMapV2(legacy);
    expect(legacy.sourceFacts).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v2",
      state: "available",
      summary: { assetCount: 0, untargetedFileCount: 1 },
    });
    expect(legacyReadiness).toMatchObject({
      schemaVersion: "omnitwin.foundry.source-readiness-map.v2",
      state: "available",
      files: [{ status: "outside_source_facts_v2", laneIds: ["visual_scene_representation"] }],
    });

    const inspected = await inspectUniversalIntakeWithSourceFactsV3(root);
    expect(inspected.sourceFacts).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v3",
      state: "available",
      summary: { assetCount: 1, establishedCount: 1, untargetedFileCount: 0 },
      assets: [{
        source: { path: "scene.ply", inputType: "gaussian_ply" },
        format: "gaussian_ply",
        inspection: { state: "established" },
      }],
    });

    const readiness = compileFoundrySourceReadinessMapV3(inspected);
    expect(readiness).toMatchObject({
      schemaVersion: "omnitwin.foundry.source-readiness-map.v3",
      state: "available",
      policy: { authority: "none" },
      summary: {
        factsEstablishedCount: 1,
        factsNotEstablishedCount: 0,
        outsideSourceFactsV3Count: 0,
      },
      files: [{
        path: "scene.ply",
        status: "facts_established",
        inputType: "gaussian_ply",
        format: "gaussian_ply",
        laneIds: ["visual_scene_representation"],
      }],
    });
    if (readiness.state !== "available") throw new Error("expected V3 readiness");
    expect(readiness.gaps.map((gap) => gap.code)).not.toContain(
      "OUTSIDE_SOURCE_FACTS_V3",
    );

    const checklist = compileFoundryOperatorEvidenceChecklistV3({ readiness });
    expect(checklist).toMatchObject({
      schemaVersion: "omnitwin.foundry.operator-evidence-checklist.v3",
      state: "available",
      policy: { authority: "none" },
      summary: {
        evidenceRequestCount: 12,
        highCount: 0,
        normalCount: 11,
        conditionalCount: 1,
      },
    });
    if (checklist.state !== "available") throw new Error("expected V3 checklist");

    const gaussianItems = checklist.items.filter((item) =>
      item.evidenceCode.startsWith("GAUSSIAN_PLY_"),
    );
    expect(gaussianItems.map((item) => item.evidenceCode).sort()).toEqual(
      FOUNDRY_GAUSSIAN_PLY_UNKNOWNS.map((unknown) => unknown.code).sort(),
    );
    expect(new Map(gaussianItems.map((item) => [item.evidenceCode, item.category]))).toEqual(
      new Map([
        ["GAUSSIAN_PLY_ACCURACY_UNKNOWN", "independent_control"],
        ["GAUSSIAN_PLY_ATTRIBUTE_VALUES_UNKNOWN", "bounded_inspection"],
        ["GAUSSIAN_PLY_ENCODING_SEMANTICS_UNKNOWN", "format_identification"],
        ["GAUSSIAN_PLY_FRAME_UNKNOWN", "registration_input"],
        ["GAUSSIAN_PLY_PHYSICAL_BOUNDS_UNKNOWN", "bounded_inspection"],
        ["GAUSSIAN_PLY_PROVENANCE_UNKNOWN", "source_provenance"],
        ["GAUSSIAN_PLY_REGISTRATION_UNKNOWN", "independent_control"],
        ["GAUSSIAN_PLY_RENDERER_COMPATIBILITY_UNKNOWN", "bounded_inspection"],
        ["GAUSSIAN_PLY_RIGHTS_UNKNOWN", "rights_decision"],
        ["GAUSSIAN_PLY_UNITS_UNKNOWN", "source_provenance"],
        ["GAUSSIAN_PLY_VISUAL_FIDELITY_UNKNOWN", "appearance_reference"],
      ]),
    );
    expect(gaussianItems.every((item) => item.evidencePriority === "normal")).toBe(true);
    expect(FoundrySourceReadinessMapV3Schema.parse(readiness)).toEqual(readiness);
    expect(FoundryOperatorEvidenceChecklistV3Schema.parse(checklist)).toEqual(checklist);
    expect(serializeFoundrySourceReadinessMapV3(readiness)).toContain(
      readiness.readinessSha256,
    );
    expect(serializeFoundryOperatorEvidenceChecklistV3(checklist)).toContain(
      checklist.checklistSha256,
    );
    const tamperedReadiness = structuredClone(readiness);
    tamperedReadiness.readinessSha256 = "0".repeat(64);
    expect(FoundrySourceReadinessMapV3Schema.safeParse(tamperedReadiness).success).toBe(false);
    const tamperedChecklist = structuredClone(checklist);
    tamperedChecklist.checklistSha256 = "0".repeat(64);
    expect(
      FoundryOperatorEvidenceChecklistV3Schema.safeParse(tamperedChecklist).success,
    ).toBe(false);
  });

  it("keeps an ordinary PLY point cloud outside Source Facts V3", async () => {
    const root = await sourceRoot({ "points.ply": ordinaryPointPlyFixture() });
    const inspected = await inspectUniversalIntakeWithSourceFactsV3(root);
    expect(inspected.sourceFacts).toMatchObject({
      state: "available",
      summary: { assetCount: 0, untargetedFileCount: 1 },
    });

    const readiness = compileFoundrySourceReadinessMapV3(inspected);
    expect(readiness).toMatchObject({
      state: "available",
      summary: { outsideSourceFactsV3Count: 1 },
      files: [{
        path: "points.ply",
        status: "outside_source_facts_v3",
        inputType: null,
        format: null,
        laneIds: ["point_geometry"],
      }],
    });
    if (readiness.state !== "available") throw new Error("expected V3 readiness");
    expect(readiness.gaps.map((gap) => gap.code)).toContain(
      "OUTSIDE_SOURCE_FACTS_V3",
    );
  });

  it("retains the global XBIN block and freezes the explicit V3 evidence-code registry", async () => {
    const root = await sourceRoot({
      "scene.ply": gaussianPlyFixture(),
      "vendor.xbin": Buffer.from([1, 2, 3, 4]),
    });
    const inspected = await inspectUniversalIntakeWithSourceFactsV3(root);
    expect(inspected.sourceFacts).toMatchObject({ state: "unavailable", assets: [] });
    const readiness = compileFoundrySourceReadinessMapV3(inspected);
    expect(readiness).toMatchObject({ state: "blocked", files: [], gaps: [] });
    expect(compileFoundryOperatorEvidenceChecklistV3({ readiness })).toMatchObject({
      state: "blocked",
      groups: [],
      items: [],
    });

    expect(Object.isFrozen(FOUNDRY_OPERATOR_EVIDENCE_UNKNOWN_CODES)).toBe(true);
    expect(
      FOUNDRY_OPERATOR_EVIDENCE_UNKNOWN_CODES.filter((code) =>
        code.startsWith("GAUSSIAN_PLY_"),
      ),
    ).toEqual(FOUNDRY_GAUSSIAN_PLY_UNKNOWNS.map((unknown) => unknown.code));
  });
});
