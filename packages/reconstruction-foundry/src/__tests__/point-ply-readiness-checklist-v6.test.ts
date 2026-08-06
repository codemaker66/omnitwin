import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { domainSeparatedSha256, toCanonicalJson } from "../canonical-json.js";
import { inspectUniversalIntakeWithSourceFactsV6 } from "../intake-receipt.js";
import { FOUNDRY_POINT_PLY_UNKNOWNS } from "../source-facts-v6.js";
import {
  FOUNDRY_SOURCE_READINESS_MAP_V6_DIGEST_DOMAIN,
  FoundrySourceReadinessMapV6Schema,
  compileFoundrySourceReadinessMapV6,
  serializeFoundrySourceReadinessMapV6,
} from "../source-readiness-v6.js";
import {
  FoundryOperatorEvidenceChecklistV6Schema,
  compileFoundryOperatorEvidenceChecklistV6,
  serializeFoundryOperatorEvidenceChecklistV6,
  verifyFoundryOperatorEvidenceChecklistV6,
} from "../operator-evidence-checklist-v6.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })
  ));
});

function ordinaryPointPly(): Buffer {
  const header = Buffer.from([
    "ply",
    "format binary_little_endian 1.0",
    "element vertex 2",
    "property float x",
    "property float y",
    "property float z",
    "property uchar red",
    "property uchar green",
    "property uchar blue",
    "end_header",
    "",
  ].join("\n"), "ascii");
  return Buffer.concat([header, Buffer.alloc(2 * 15)]);
}

function asciiPointPly(): Buffer {
  return Buffer.from([
    "ply",
    "format ascii 1.0",
    "element vertex 1",
    "property float x",
    "property float y",
    "property float z",
    "end_header",
    "0 0 0",
    "",
  ].join("\n"), "ascii");
}

async function sourceRoot(files: Readonly<Record<string, Buffer>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-point-readiness-v6-"));
  roots.push(root);
  for (const [name, bytes] of Object.entries(files)) {
    await writeFile(join(root, name), bytes);
  }
  return root;
}

function redigestReadiness<T extends { readonly readinessSha256: string }>(
  value: T,
): T {
  const { readinessSha256: _readinessSha256, ...payload } = value;
  return {
    ...value,
    readinessSha256: domainSeparatedSha256(
      FOUNDRY_SOURCE_READINESS_MAP_V6_DIGEST_DOMAIN,
      toCanonicalJson(payload),
    ),
  } as T;
}

describe("ordinary point PLY Source Readiness and Operator Evidence V6", () => {
  it("propagates all bounded-layout unknowns without authorizing reconstruction", async () => {
    const inspected = await inspectUniversalIntakeWithSourceFactsV6(
      await sourceRoot({ "points.ply": ordinaryPointPly() }),
    );
    const readiness = compileFoundrySourceReadinessMapV6(inspected);

    expect(readiness).toMatchObject({
      schemaVersion: "omnitwin.foundry.source-readiness-map.v6",
      state: "available",
      summary: {
        receiptFileCount: 1,
        factsEstablishedCount: 1,
        factsNotEstablishedCount: 0,
        outsideSourceFactsV6Count: 0,
      },
      policy: {
        execution: "not_authorized",
        authority: "none",
        accuracy: "not_evaluated",
        registration: "not_evaluated",
        rights: "not_evaluated",
      },
      files: [{
        path: "points.ply",
        status: "facts_established",
        inputType: "ply_point_cloud",
        format: "ply",
        laneIds: ["point_geometry"],
        inspection: {
          coverage: "complete_header_and_exact_fixed_width_payload_layout",
        },
      }],
    });
    if (readiness.state !== "available") throw new Error("expected V6 readiness");
    expect(readiness.files[0]?.unknowns.map((unknown) => unknown.code).sort()).toEqual(
      FOUNDRY_POINT_PLY_UNKNOWNS.map((unknown) => unknown.code).sort(),
    );
    expect(readiness.lanes.find((lane) => lane.id === "point_geometry"))
      .toMatchObject({
        status: "all_observed_facts_established",
        counts: { observedFileCount: 1, factsEstablishedCount: 1 },
      });

    const checklist = compileFoundryOperatorEvidenceChecklistV6({ readiness });
    if (checklist.state !== "available") throw new Error("expected V6 checklist");
    expect(checklist.schemaVersion).toBe(
      "omnitwin.foundry.operator-evidence-checklist.v6",
    );
    const pointItems = checklist.items.filter((item) =>
      item.evidenceCode.startsWith("POINT_PLY_")
    );
    expect(pointItems.map((item) => item.evidenceCode).sort()).toEqual(
      FOUNDRY_POINT_PLY_UNKNOWNS.map((unknown) => unknown.code).sort(),
    );
    expect(new Map(pointItems.map((item) => [item.evidenceCode, item.category])))
      .toEqual(new Map([
        ["POINT_PLY_ACCURACY_AND_UNCERTAINTY_UNKNOWN", "independent_control"],
        ["POINT_PLY_ATTRIBUTE_VALUES_UNKNOWN", "bounded_inspection"],
        ["POINT_PLY_FRAME_CRS_AND_AXIS_UNKNOWN", "registration_input"],
        ["POINT_PLY_GEOMETRY_ROLE_UNKNOWN", "source_provenance"],
        ["POINT_PLY_PHYSICAL_BOUNDS_AND_COMPLETENESS_UNKNOWN", "bounded_inspection"],
        ["POINT_PLY_PROPERTY_SEMANTICS_UNKNOWN", "bounded_inspection"],
        ["POINT_PLY_PROVENANCE_AND_CAPTURE_CLASS_UNKNOWN", "source_provenance"],
        ["POINT_PLY_REGISTRATION_UNKNOWN", "independent_control"],
        ["POINT_PLY_RIGHTS_UNKNOWN", "rights_decision"],
        ["POINT_PLY_UNITS_AND_SCALE_UNKNOWN", "source_provenance"],
      ]));

    expect(FoundrySourceReadinessMapV6Schema.parse(readiness)).toEqual(readiness);
    expect(FoundryOperatorEvidenceChecklistV6Schema.parse(checklist)).toEqual(checklist);
    expect(verifyFoundryOperatorEvidenceChecklistV6({ readiness, checklist })).toEqual(
      checklist,
    );
    expect(serializeFoundrySourceReadinessMapV6(readiness)).toContain(
      readiness.readinessSha256,
    );
    expect(serializeFoundryOperatorEvidenceChecklistV6(checklist)).toContain(
      checklist.checklistSha256,
    );
  });

  it("keeps unsupported point variants visible as failed evidence", async () => {
    const inspected = await inspectUniversalIntakeWithSourceFactsV6(
      await sourceRoot({ "ascii.ply": asciiPointPly() }),
    );
    const readiness = compileFoundrySourceReadinessMapV6(inspected);
    expect(readiness).toMatchObject({
      state: "available",
      summary: {
        factsEstablishedCount: 0,
        factsNotEstablishedCount: 1,
        outsideSourceFactsV6Count: 0,
      },
      files: [{
        path: "ascii.ply",
        status: "facts_not_established",
        inputType: "ply_point_cloud",
        format: "ply",
        inspection: {
          category: "unsupported_variant",
          code: "POINT_PLY_ASCII_ENCODING_UNSUPPORTED",
          coverage: "none",
        },
      }],
    });
    if (readiness.state !== "available") throw new Error("expected V6 readiness");
    expect(readiness.files[0]?.unknowns.map((unknown) => unknown.code).sort()).toEqual(
      FOUNDRY_POINT_PLY_UNKNOWNS.map((unknown) => unknown.code).sort(),
    );
    const checklist = compileFoundryOperatorEvidenceChecklistV6({ readiness });
    if (checklist.state !== "available") throw new Error("expected V6 checklist");
    expect(checklist.items.map((item) => item.evidenceCode)).toContain(
      "SOURCE_FACTS_NOT_ESTABLISHED",
    );
    expect(checklist.items.map((item) => item.evidenceCode)).toContain(
      "POINT_PLY_ATTRIBUTE_VALUES_UNKNOWN",
    );
  });

  it("rejects self-digested point success contradictions and unknown omissions", async () => {
    const inspected = await inspectUniversalIntakeWithSourceFactsV6(
      await sourceRoot({ "points.ply": ordinaryPointPly() }),
    );
    const readiness = compileFoundrySourceReadinessMapV6(inspected);
    if (readiness.state !== "available") throw new Error("expected V6 readiness");
    const file = readiness.files[0];
    if (file === undefined) throw new Error("expected point readiness file");

    const contradictory = redigestReadiness({
      ...readiness,
      files: [{
        ...file,
        inspection: {
          state: "established" as const,
          category: "established" as const,
          code: "POINT_PLY_PAYLOAD_LENGTH_MISMATCH" as const,
          coverage: "none" as const,
        },
      }],
      readinessSha256: "0".repeat(64),
    });
    expect(FoundrySourceReadinessMapV6Schema.safeParse(contradictory).success)
      .toBe(false);
    expect(() => compileFoundryOperatorEvidenceChecklistV6({
      readiness: contradictory,
    })).toThrow();

    const lanes = readiness.lanes.map((lane) =>
      lane.id === "point_geometry"
        ? { ...lane, unknowns: [], decisiveNextTests: [] }
        : lane
    );
    const gapCount = new Set([
      ...readiness.gaps.map((gap) => gap.code),
      ...lanes.flatMap((lane) => lane.unknowns.map((unknown) => unknown.code)),
    ]).size;
    const omitted = redigestReadiness({
      ...readiness,
      files: [{ ...file, unknowns: [], decisiveNextTests: [] }],
      lanes,
      summary: { ...readiness.summary, gapCount },
      readinessSha256: "0".repeat(64),
    });
    expect(FoundrySourceReadinessMapV6Schema.safeParse(omitted).success).toBe(
      false,
    );
    expect(() => compileFoundryOperatorEvidenceChecklistV6({
      readiness: omitted,
    })).toThrow();
  });

  it("rejects downgrading a point PLY receipt candidate to outside V6", async () => {
    const outsideInspected = await inspectUniversalIntakeWithSourceFactsV6(
      await sourceRoot({ "cloud.las": Buffer.from("LASF\0\0\0\0", "ascii") }),
    );
    const outsideReadiness = compileFoundrySourceReadinessMapV6(
      outsideInspected,
    );
    const pointInspected = await inspectUniversalIntakeWithSourceFactsV6(
      await sourceRoot({ "points.ply": ordinaryPointPly() }),
    );
    if (
      outsideReadiness.state !== "available" ||
      pointInspected.receipt.files[0] === undefined ||
      outsideReadiness.files[0] === undefined
    ) {
      throw new Error("expected available outside and point evidence");
    }
    expect(outsideReadiness.files[0].status).toBe("outside_source_facts_v6");
    const downgraded = redigestReadiness({
      ...outsideReadiness,
      files: [{
        ...outsideReadiness.files[0],
        detection: pointInspected.receipt.files[0].detection,
      }],
      readinessSha256: "0".repeat(64),
    });
    expect(FoundrySourceReadinessMapV6Schema.safeParse(downgraded).success).toBe(
      false,
    );
    expect(() => compileFoundryOperatorEvidenceChecklistV6({
      readiness: downgraded,
    })).toThrow();
  });

  it("keeps XBIN readiness and checklist output atomic", async () => {
    const inspected = await inspectUniversalIntakeWithSourceFactsV6(
      await sourceRoot({
        "points.ply": ordinaryPointPly(),
        "vendor.xbin": Buffer.from([1, 2, 3, 4]),
      }),
    );
    const readiness = compileFoundrySourceReadinessMapV6(inspected);
    expect(readiness).toMatchObject({
      state: "blocked",
      files: [],
      gaps: [],
      blockedReason: { code: "XGRIDS_XBIN_BLOCKED" },
    });
    expect(compileFoundryOperatorEvidenceChecklistV6({ readiness })).toMatchObject({
      state: "blocked",
      groups: [],
      items: [],
    });
  });
});
