import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { domainSeparatedSha256, toCanonicalJson } from "../canonical-json.js";
import {
  inspectUniversalIntakeWithSourceFactsV8,
  type InspectUniversalIntakeWithSourceFactsV8Result,
} from "../intake-receipt.js";
import {
  FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_DIGEST_DOMAIN,
  FoundryOperatorEvidenceChecklistV8Schema,
  compileFoundryOperatorEvidenceChecklistV8,
  serializeFoundryOperatorEvidenceChecklistV8,
  verifyFoundryOperatorEvidenceChecklistV8,
} from "../operator-evidence-checklist-v8.js";
import {
  FOUNDRY_POTREE_POINT_VALUES_RESOLVED_UNKNOWN_CODE,
} from "../source-facts-v8.js";
import {
  FOUNDRY_SOURCE_READINESS_MAP_V8_DIGEST_DOMAIN,
  FoundrySourceReadinessMapV8Schema,
  compileFoundrySourceReadinessMapV8,
  serializeFoundrySourceReadinessMapV8,
  verifyFoundrySourceReadinessMapV8,
} from "../source-readiness-v8.js";

const roots: string[] = [];

afterAll(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

function attribute(
  name: "position" | "intensity" | "lcc prediction",
): Record<string, unknown> {
  const position = name === "position";
  return {
    name,
    description: "fixture declaration is not semantic authority",
    size: position ? 12 : 1,
    numElements: position ? 3 : 1,
    elementSize: position ? 4 : 1,
    type: position ? "int32" : "uint8",
    min: position ? [0, 0, 0] : [0],
    max: position ? [10, 20, 30] : [255],
    scale: position ? [1, 1, 1] : [1],
    offset: position ? [0, 0, 0] : [0],
  };
}

function metadata(pointCount: number): Buffer {
  return Buffer.from(JSON.stringify({
    version: "2.0",
    name: "potree",
    description: "deterministic Potree V8 readiness fixture",
    points: pointCount,
    projection: "",
    hierarchy: { firstChunkSize: 22, stepSize: 4, depth: 0 },
    offset: [0, 0, 0],
    scale: [0.001, 0.001, 0.001],
    spacing: 0.1,
    boundingBox: { min: [0, 0, 0], max: [10, 20, 30] },
    encoding: "DEFAULT",
    attributes: [
      attribute("position"),
      attribute("intensity"),
      attribute("lcc prediction"),
    ],
  }), "utf8");
}

function oneLeafHierarchy(pointCount: number): Buffer {
  const hierarchy = Buffer.alloc(22);
  hierarchy.writeUInt8(1, 0);
  hierarchy.writeUInt8(0, 1);
  hierarchy.writeUInt32LE(pointCount, 2);
  hierarchy.writeBigUInt64LE(0n, 6);
  hierarchy.writeBigUInt64LE(BigInt(pointCount * 14), 14);
  return hierarchy;
}

function pointRecord(
  position: readonly [number, number, number],
  intensity: number,
  opaqueVendorByte: number,
): Buffer {
  const record = Buffer.alloc(14);
  record.writeInt32LE(position[0], 0);
  record.writeInt32LE(position[1], 4);
  record.writeInt32LE(position[2], 8);
  record.writeUInt8(intensity, 12);
  record.writeUInt8(opaqueVendorByte, 13);
  return record;
}

async function inspectFixture(
  octreeBytes: Buffer,
  extras: Readonly<Record<string, Buffer>> = {},
): Promise<InspectUniversalIntakeWithSourceFactsV8Result> {
  const pointCount = octreeBytes.length / 14;
  const files: Readonly<Record<string, Buffer>> = {
    "model/metadata.json": metadata(pointCount),
    "model/hierarchy.bin": oneLeafHierarchy(pointCount),
    "model/octree.bin": octreeBytes,
    ...extras,
  };
  const root = await mkdtemp(join(tmpdir(), "foundry-readiness-v8-"));
  roots.push(root);
  for (const [path, bytes] of Object.entries(files)) {
    const absolutePath = join(root, ...path.split("/"));
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);
  }
  return inspectUniversalIntakeWithSourceFactsV8(root);
}

function redigest(
  artifact: Record<string, unknown>,
  digestField: "readinessSha256" | "checklistSha256",
  domain: string,
): Record<string, unknown> {
  const payload = digestField === "readinessSha256"
    ? (({ readinessSha256: _readinessSha256, ...rest }) => rest)(artifact)
    : (({ checklistSha256: _checklistSha256, ...rest }) => rest)(artifact);
  return {
    ...payload,
    [digestField]: domainSeparatedSha256(domain, toCanonicalJson(payload)),
  };
}

let established: InspectUniversalIntakeWithSourceFactsV8Result;
let failed: InspectUniversalIntakeWithSourceFactsV8Result;
let blocked: InspectUniversalIntakeWithSourceFactsV8Result;

beforeAll(async () => {
  established = await inspectFixture(Buffer.concat([
    pointRecord([0, 0, 0], 10, 20),
    pointRecord([10_000, 20_000, 30_000], 255, 100),
  ]));
  failed = await inspectFixture(
    pointRecord([20_000, 0, 0], 10, 20),
  );
  blocked = await inspectFixture(
    pointRecord([0, 0, 0], 10, 20),
    { "vendor.xbin": Buffer.from([1, 2, 3, 4]) },
  );
});

describe("Source Readiness and Operator Evidence V8 overlays", () => {
  it("deterministically binds established values and leaves nine requests", () => {
    const readiness = compileFoundrySourceReadinessMapV8(established);
    const secondReadiness = compileFoundrySourceReadinessMapV8(established);
    expect(serializeFoundrySourceReadinessMapV8(readiness)).toBe(
      serializeFoundrySourceReadinessMapV8(secondReadiness),
    );
    expect(verifyFoundrySourceReadinessMapV8({
      ...established,
      readiness,
    })).toEqual(readiness);
    expect(readiness).toMatchObject({
      state: "available",
      summary: {
        pointValueOutcomeCount: 1,
        decodedValuesEstablishedCount: 1,
        decodedValuesNotEstablishedCount: 0,
        diagnosticPreviewAvailableCount: 1,
        resolvedUnknownCount: 1,
        remainingUnknownCount: 9,
      },
      pointValueRefinements: [{
        status: "decoded_values_established",
        diagnosticPreview: "available",
        processingReadiness: "not_established",
        execution: "not_authorized",
        resolvedUnknownCodes: [
          FOUNDRY_POTREE_POINT_VALUES_RESOLVED_UNKNOWN_CODE,
        ],
      }],
    });
    if (
      readiness.state !== "available" ||
      established.sourceFacts.state !== "available"
    ) {
      throw new Error("expected available V8 artifacts");
    }
    expect(readiness.pointValueRefinements[0]?.sourceFactsBundle).toEqual(
      established.sourceFacts.inherited.potreeBundles[0],
    );
    expect(readiness.pointValueRefinements[0]?.pointValueEvidence).toEqual(
      established.sourceFacts.pointValueBundles[0],
    );

    const checklist = compileFoundryOperatorEvidenceChecklistV8({ readiness });
    const secondChecklist = compileFoundryOperatorEvidenceChecklistV8({
      readiness,
    });
    expect(serializeFoundryOperatorEvidenceChecklistV8(checklist)).toBe(
      serializeFoundryOperatorEvidenceChecklistV8(secondChecklist),
    );
    expect(verifyFoundryOperatorEvidenceChecklistV8({
      readiness,
      checklist,
    })).toEqual(checklist);
    expect(checklist).toMatchObject({
      state: "available",
      summary: {
        inheritedV7PotreeRequestCount: 10,
        resolvedPotreeUnknownRequestCount: 1,
        effectiveRemainingPotreeRequestCount: 9,
        effectiveRemainingPotreeUnknownRequestCount: 9,
      },
      resolvedPotreeUnknownRequestRefs: [{
        inheritedEvidenceCode:
          FOUNDRY_POTREE_POINT_VALUES_RESOLVED_UNKNOWN_CODE,
        pointValueOutcomeCode: "POTREE_V2_POINT_VALUES_ESTABLISHED",
        resolutionStatus: "superseded_in_effective_v8_view_only",
      }],
    });
    if (checklist.state !== "available") {
      throw new Error("expected available V8 checklist");
    }
    expect(checklist.inherited.potreeEvidenceRequests).toHaveLength(10);
    expect(checklist.effectiveRemainingInheritedPotreeRequestIds).toHaveLength(
      9,
    );
    expect(
      checklist.effectiveRemainingInheritedPotreeRequestIds,
    ).not.toContain(
      checklist.resolvedPotreeUnknownRequestRefs[0]?.inheritedRequestId,
    );
  });

  it("leaves all ten inherited requests after point-value failure", () => {
    const readiness = compileFoundrySourceReadinessMapV8(failed);
    expect(readiness).toMatchObject({
      state: "available",
      summary: {
        pointValueOutcomeCount: 1,
        decodedValuesEstablishedCount: 0,
        decodedValuesNotEstablishedCount: 1,
        diagnosticPreviewUnavailableCount: 1,
        resolvedUnknownCount: 0,
        remainingUnknownCount: 10,
      },
      pointValueRefinements: [{
        status: "decoded_values_not_established",
        diagnosticPreview: "unavailable",
        processingReadiness: "not_established",
        execution: "not_authorized",
        resolvedUnknownCodes: [],
      }],
    });
    const checklist = compileFoundryOperatorEvidenceChecklistV8({ readiness });
    expect(checklist).toMatchObject({
      state: "available",
      summary: {
        inheritedV7PotreeRequestCount: 10,
        resolvedPotreeUnknownRequestCount: 0,
        effectiveRemainingPotreeRequestCount: 10,
        effectiveRemainingPotreeUnknownRequestCount: 10,
      },
      resolvedPotreeUnknownRequestRefs: [],
    });
    if (checklist.state !== "available") {
      throw new Error("expected available failure checklist");
    }
    expect(checklist.effectiveRemainingInheritedPotreeRequestIds).toHaveLength(
      10,
    );
  });

  it("retains blocked state with empty overlays", () => {
    const readiness = compileFoundrySourceReadinessMapV8(blocked);
    expect(readiness).toMatchObject({
      state: "blocked",
      pointValueRefinements: [],
      summary: {
        inheritedState: "blocked",
        pointValueOutcomeCount: 0,
      },
    });
    const checklist = compileFoundryOperatorEvidenceChecklistV8({ readiness });
    expect(checklist).toMatchObject({
      state: "blocked",
      pointValueResolutionBasis: [],
      resolvedPotreeUnknownRequestRefs: [],
      effectiveRemainingInheritedPotreeRequestIds: [],
      summary: {
        inheritedState: "blocked",
        effectiveRemainingPotreeRequestCount: 0,
      },
    });
  });

  it("rejects digest, binding, supersession, and ordering forgeries", () => {
    const readiness = compileFoundrySourceReadinessMapV8(established);
    const checklist = compileFoundryOperatorEvidenceChecklistV8({ readiness });
    expect(FoundrySourceReadinessMapV8Schema.safeParse({
      ...readiness,
      readinessSha256: "0".repeat(64),
    }).success).toBe(false);
    expect(FoundryOperatorEvidenceChecklistV8Schema.safeParse({
      ...checklist,
      checklistSha256: "0".repeat(64),
    }).success).toBe(false);

    const reboundReadiness = redigest(
      {
        ...JSON.parse(serializeFoundrySourceReadinessMapV8(readiness)) as
          Record<string, unknown>,
        sourceFactsSha256: "a".repeat(64),
      },
      "readinessSha256",
      FOUNDRY_SOURCE_READINESS_MAP_V8_DIGEST_DOMAIN,
    );
    expect(() => verifyFoundrySourceReadinessMapV8({
      ...established,
      readiness: reboundReadiness,
    })).toThrow();

    const forgedSupersession = JSON.parse(
      serializeFoundryOperatorEvidenceChecklistV8(checklist),
    ) as Record<string, unknown>;
    forgedSupersession.resolvedPotreeUnknownRequestRefs = [];
    const inherited = forgedSupersession.inherited as {
      potreeEvidenceRequests: Array<{ id: string }>;
    };
    forgedSupersession.effectiveRemainingInheritedPotreeRequestIds = inherited
      .potreeEvidenceRequests.map((request) => request.id).sort();
    const forgedSummary = forgedSupersession.summary as Record<string, unknown>;
    forgedSummary.resolvedPotreeUnknownRequestCount = 0;
    forgedSummary.effectiveRemainingPotreeRequestCount = 10;
    forgedSummary.effectiveRemainingPotreeUnknownRequestCount = 10;
    expect(FoundryOperatorEvidenceChecklistV8Schema.safeParse(redigest(
      forgedSupersession,
      "checklistSha256",
      FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_DIGEST_DOMAIN,
    )).success).toBe(false);

    const failedReadiness = compileFoundrySourceReadinessMapV8(failed);
    const failedChecklist = compileFoundryOperatorEvidenceChecklistV8({
      readiness: failedReadiness,
    });
    const forgedOrder = JSON.parse(
      serializeFoundryOperatorEvidenceChecklistV8(failedChecklist),
    ) as Record<string, unknown>;
    forgedOrder.effectiveRemainingInheritedPotreeRequestIds = [
      ...(forgedOrder.effectiveRemainingInheritedPotreeRequestIds as string[]),
    ].reverse();
    expect(FoundryOperatorEvidenceChecklistV8Schema.safeParse(redigest(
      forgedOrder,
      "checklistSha256",
      FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_DIGEST_DOMAIN,
    )).success).toBe(false);
  });
});
