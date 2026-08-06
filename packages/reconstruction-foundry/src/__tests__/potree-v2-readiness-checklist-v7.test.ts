import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { domainSeparatedSha256, toCanonicalJson } from "../canonical-json.js";
import { inspectUniversalIntakeWithSourceFactsV6 } from "../intake-receipt.js";
import {
  FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_DIGEST_DOMAIN,
  FoundryOperatorEvidenceChecklistV7Schema,
  compileFoundryOperatorEvidenceChecklistV7,
  serializeFoundryOperatorEvidenceChecklistV7,
  verifyFoundryOperatorEvidenceChecklistV7,
} from "../operator-evidence-checklist-v7.js";
import {
  createPotreeV2SourceFactsCollector,
} from "../potree-v2-source-facts.js";
import {
  FOUNDRY_POTREE_V2_UNKNOWNS,
  createFoundryPotreeV2BundleAssetV7,
  createUniversalSourceFactsV7ArtifactFromReceipt,
} from "../source-facts-v7.js";
import {
  FOUNDRY_SOURCE_READINESS_MAP_V7_DIGEST_DOMAIN,
  FoundrySourceReadinessMapV7Schema,
  compileFoundrySourceReadinessMapV7,
  serializeFoundrySourceReadinessMapV7,
  verifyFoundrySourceReadinessMapV7,
} from "../source-readiness-v7.js";
import { compileFoundrySourceReadinessMapV6 } from "../source-readiness-v6.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

function validPotreeMetadata(): Buffer {
  const attribute = (
    name: "position" | "intensity" | "lcc prediction",
  ): Record<string, unknown> => {
    const position = name === "position";
    return {
      name,
      description: "fixture",
      size: position ? 12 : 1,
      numElements: position ? 3 : 1,
      elementSize: position ? 4 : 1,
      type: position ? "int32" : "uint8",
      min: position ? [0, 0, 0] : [0],
      max: position ? [0, 0, 0] : [255],
      scale: position ? [1, 1, 1] : [1],
      offset: position ? [0, 0, 0] : [0],
    };
  };
  return Buffer.from(JSON.stringify({
    version: "2.0",
    name: "potree",
    description: "minimal deterministic fixture",
    points: 1,
    projection: "",
    hierarchy: { firstChunkSize: 22, stepSize: 4, depth: 0 },
    offset: [0, 0, 0],
    scale: [0.001, 0.001, 0.001],
    spacing: 0.1,
    boundingBox: { min: [0, 0, 0], max: [1, 1, 1] },
    encoding: "DEFAULT",
    attributes: [
      attribute("position"),
      attribute("intensity"),
      attribute("lcc prediction"),
    ],
  }), "utf8");
}

function onePointHierarchy(): Buffer {
  const hierarchy = Buffer.alloc(22);
  hierarchy.writeUInt8(1, 0);
  hierarchy.writeUInt8(0, 1);
  hierarchy.writeUInt32LE(1, 2);
  hierarchy.writeBigUInt64LE(0n, 6);
  hierarchy.writeBigUInt64LE(14n, 14);
  return hierarchy;
}

function potreeFiles(metadata = validPotreeMetadata()): Record<string, Buffer> {
  return {
    "model/metadata.json": metadata,
    "model/hierarchy.bin": onePointHierarchy(),
    "model/octree.bin": Buffer.alloc(14),
  };
}

async function sourceRoot(
  files: Readonly<Record<string, Buffer>>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-potree-readiness-v7-"));
  roots.push(root);
  for (const [path, bytes] of Object.entries(files)) {
    const absolutePath = join(root, ...path.split("/"));
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);
  }
  return root;
}

async function inspectV7(
  files: Readonly<Record<string, Buffer>>,
) {
  const inherited = await inspectUniversalIntakeWithSourceFactsV6(
    await sourceRoot(files),
  );
  if (inherited.sourceFacts.state === "unavailable") {
    return {
      ...inherited,
      sourceFactsV7: createUniversalSourceFactsV7ArtifactFromReceipt(
        inherited.receipt,
        inherited.sourceFacts,
      ),
    };
  }
  const members = ([
    ["metadata", "model/metadata.json"],
    ["hierarchy", "model/hierarchy.bin"],
    ["octree", "model/octree.bin"],
  ] as const).map(([role, path]) => {
    const file = inherited.receipt.files.find((candidate) =>
      candidate.path === path
    );
    if (file === undefined) throw new Error(`missing receipt file ${path}`);
    return { role, path, sizeBytes: file.sizeBytes, sha256: file.sha256 };
  });
  const collector = createPotreeV2SourceFactsCollector("model");
  for (const member of members) {
    const bytes = files[member.path];
    if (bytes === undefined) throw new Error(`missing fixture ${member.path}`);
    collector.observeMember(member.role, bytes, 0);
  }
  const assets = [
    createFoundryPotreeV2BundleAssetV7(collector.finalize(members)),
  ];
  return {
    ...inherited,
    sourceFactsV7: createUniversalSourceFactsV7ArtifactFromReceipt(
      inherited.receipt,
      inherited.sourceFacts,
      assets,
    ),
  };
}

function redigestReadiness<T extends { readonly readinessSha256: string }>(
  value: T,
): T {
  const { readinessSha256: _readinessSha256, ...payload } = value;
  return {
    ...value,
    readinessSha256: domainSeparatedSha256(
      FOUNDRY_SOURCE_READINESS_MAP_V7_DIGEST_DOMAIN,
      toCanonicalJson(payload),
    ),
  } as T;
}

function redigestChecklist<T extends { readonly checklistSha256: string }>(
  value: T,
): T {
  const { checklistSha256: _checklistSha256, ...payload } = value;
  return {
    ...value,
    checklistSha256: domainSeparatedSha256(
      FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_DIGEST_DOMAIN,
      toCanonicalJson(payload),
    ),
  } as T;
}

describe("Potree v2 Source Readiness and Operator Evidence V7", () => {
  it("adds a deterministic established refinement without mutating V6", async () => {
    const files = {
      ...potreeFiles(),
      "other.las": Buffer.from("LASF\0\0\0\0", "ascii"),
    };
    const inspected = await inspectV7(files);
    const readiness = compileFoundrySourceReadinessMapV7({
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFactsV7,
    });
    const repeated = compileFoundrySourceReadinessMapV7({
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFactsV7,
    });

    expect(readiness).toEqual(repeated);
    expect(readiness).toMatchObject({
      schemaVersion: "omnitwin.foundry.source-readiness-map.v7",
      state: "available",
      policy: {
        execution: "not_authorized",
        approval: "none",
        authority: "none",
      },
      summary: {
        potreeBundleCount: 1,
        potreeBundleEstablishedCount: 1,
        potreeBundleFactsNotEstablishedCount: 0,
        potreeMemberSourceCount: 3,
        supersededInheritedPathCount: 3,
      },
    });
    if (readiness.state !== "available") throw new Error("expected V7 readiness");
    expect(readiness.inherited).toEqual(
      compileFoundrySourceReadinessMapV6({
        receipt: inspected.receipt,
        sourceFacts: inspected.sourceFacts,
      }),
    );
    const refinement = readiness.potreeBundleRefinements[0];
    if (refinement === undefined) throw new Error("expected Potree refinement");
    expect(refinement).toMatchObject({
      laneIds: ["point_geometry"],
      status: "facts_established",
      sourceFactsBundle: {
        bundleRoot: "model",
        inspection: {
          state: "established",
          coverage: "complete_metadata_hierarchy_and_exact_octree_layout",
        },
      },
    });
    expect(
      refinement.supersededInheritedEvidence.map((row) => row.path),
    ).toEqual([
      "model/hierarchy.bin",
      "model/metadata.json",
      "model/octree.bin",
    ]);
    expect(
      refinement.supersededInheritedEvidence.some(
        (row) => row.path === "other.las",
      ),
    ).toBe(false);
    expect(readiness.inherited.gaps.some((gap) =>
      gap.sourcePaths.includes("model/metadata.json")
    )).toBe(true);

    const checklist = compileFoundryOperatorEvidenceChecklistV7({ readiness });
    const repeatedChecklist = compileFoundryOperatorEvidenceChecklistV7({
      readiness,
    });
    expect(checklist).toEqual(repeatedChecklist);
    expect(checklist).toMatchObject({
      schemaVersion: "omnitwin.foundry.operator-evidence-checklist.v7",
      state: "available",
      policy: { approval: "none", authority: "none" },
      summary: {
        potreeInspectionFailureRequestCount: 0,
        potreeUnknownRequestCount: FOUNDRY_POTREE_V2_UNKNOWNS.length,
        affectedPotreeMemberSourceCount: 3,
        supersededInheritedSourcePathCount: 3,
      },
    });
    if (checklist.state !== "available") throw new Error("expected V7 checklist");
    expect(
      checklist.potreeEvidenceRequests.map((request) => request.evidenceCode),
    ).toEqual(
      FOUNDRY_POTREE_V2_UNKNOWNS.map((unknown) => unknown.code).sort(),
    );
    expect(checklist.potreeEvidenceRequests.every((request) =>
      request.id.startsWith(`potree-v7:${request.bundleSha256}:`) &&
      request.id.length < 240
    )).toBe(true);
    expect(
      checklist.supersededInheritedRequestRefs.flatMap(
        (reference) => reference.sourcePaths,
      ),
    ).toEqual([
      "model/hierarchy.bin",
      "model/metadata.json",
      "model/octree.bin",
    ]);
    expect(
      checklist.supersededInheritedRequestRefs.some((reference) =>
        reference.sourcePaths.includes("other.las")
      ),
    ).toBe(false);

    expect(FoundrySourceReadinessMapV7Schema.parse(readiness)).toEqual(readiness);
    expect(FoundryOperatorEvidenceChecklistV7Schema.parse(checklist)).toEqual(
      checklist,
    );
    expect(verifyFoundrySourceReadinessMapV7({
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFactsV7,
      readiness,
    })).toEqual(readiness);
    expect(verifyFoundryOperatorEvidenceChecklistV7({ readiness, checklist }))
      .toEqual(checklist);
    expect(serializeFoundrySourceReadinessMapV7(readiness)).toContain(
      readiness.readinessSha256,
    );
    expect(serializeFoundryOperatorEvidenceChecklistV7(checklist)).toContain(
      checklist.checklistSha256,
    );
  });

  it("maps failed inspection and every frozen unknown to exact-member requests", async () => {
    const inspected = await inspectV7(potreeFiles(Buffer.from("{", "utf8")));
    const readiness = compileFoundrySourceReadinessMapV7({
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFactsV7,
    });
    if (readiness.state !== "available") throw new Error("expected V7 readiness");
    expect(readiness.potreeBundleRefinements[0]).toMatchObject({
      status: "facts_not_established",
      sourceFactsBundle: {
        inspection: {
          state: "facts_not_established",
          category: "parse_failure",
          code: "POTREE_V2_METADATA_JSON_INVALID",
          coverage: "none",
        },
        facts: null,
      },
    });

    const checklist = compileFoundryOperatorEvidenceChecklistV7({ readiness });
    if (checklist.state !== "available") throw new Error("expected V7 checklist");
    const failure = checklist.potreeEvidenceRequests.find(
      (request) =>
        request.basisKind === "potree_bundle_inspection_failure",
    );
    expect(failure).toMatchObject({
      evidenceCode: "POTREE_V2_SOURCE_FACTS_NOT_ESTABLISHED",
      inspectionCode: "POTREE_V2_METADATA_JSON_INVALID",
      affectedSources: [
        { role: "hierarchy", path: "model/hierarchy.bin" },
        { role: "metadata", path: "model/metadata.json" },
        { role: "octree", path: "model/octree.bin" },
      ],
    });
    for (const unknown of FOUNDRY_POTREE_V2_UNKNOWNS) {
      expect(checklist.potreeEvidenceRequests).toContainEqual(
        expect.objectContaining({
          basisKind: "potree_bundle_unknown",
          evidenceCode: unknown.code,
          label: unknown.label,
          reason: unknown.reason,
          requestedEvidence: unknown.decisiveNextTest,
        }),
      );
    }
    expect(checklist.summary).toMatchObject({
      potreeEvidenceRequestCount: FOUNDRY_POTREE_V2_UNKNOWNS.length + 1,
      potreeInspectionFailureRequestCount: 1,
      potreeUnknownRequestCount: FOUNDRY_POTREE_V2_UNKNOWNS.length,
    });
  });

  it("rejects digest tampering and self-digested boundary contradictions", async () => {
    const inspected = await inspectV7(potreeFiles());
    const readiness = compileFoundrySourceReadinessMapV7({
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFactsV7,
    });
    if (readiness.state !== "available") throw new Error("expected V7 readiness");
    const refinement = readiness.potreeBundleRefinements[0];
    if (refinement === undefined) throw new Error("expected refinement");

    const plainTamper = {
      ...readiness,
      summary: { ...readiness.summary, potreeMemberSourceCount: 4 },
    };
    expect(FoundrySourceReadinessMapV7Schema.safeParse(plainTamper).success)
      .toBe(false);

    const boundaryTamper = redigestReadiness({
      ...readiness,
      potreeBundleRefinements: [{
        ...refinement,
        supersededInheritedEvidence: [
          ...refinement.supersededInheritedEvidence,
          {
            path: "outside.bin",
            inheritedStatus: "unclassified_format" as const,
            inheritedGapCode: "UNCLASSIFIED_FORMAT" as const,
            refinedStatus: refinement.status,
          },
        ],
      }],
      summary: {
        ...readiness.summary,
        supersededInheritedPathCount: 4,
      },
      readinessSha256: "0".repeat(64),
    });
    expect(FoundrySourceReadinessMapV7Schema.safeParse(boundaryTamper).success)
      .toBe(false);

    const checklist = compileFoundryOperatorEvidenceChecklistV7({ readiness });
    if (checklist.state !== "available") throw new Error("expected V7 checklist");
    const first = checklist.potreeEvidenceRequests[0];
    if (first === undefined) throw new Error("expected Potree request");
    const selfDigestedRequestTamper = redigestChecklist({
      ...checklist,
      potreeEvidenceRequests: [
        { ...first, label: "Tampered request" },
        ...checklist.potreeEvidenceRequests.slice(1),
      ],
      checklistSha256: "0".repeat(64),
    });
    expect(
      FoundryOperatorEvidenceChecklistV7Schema.safeParse(
        selfDigestedRequestTamper,
      ).success,
    ).toBe(false);
    expect(() => verifyFoundryOperatorEvidenceChecklistV7({
      readiness,
      checklist: selfDigestedRequestTamper,
    })).toThrow();
  });

  it("retains the atomic XBIN block with no Potree overlay", async () => {
    const inspected = await inspectV7({
      ...potreeFiles(),
      "vendor.xbin": Buffer.from([1, 2, 3, 4]),
    });
    const readiness = compileFoundrySourceReadinessMapV7({
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFactsV7,
    });
    expect(readiness).toMatchObject({
      state: "blocked",
      inherited: {
        state: "blocked",
        blockedReason: { code: "XGRIDS_XBIN_BLOCKED" },
      },
      potreeBundleRefinements: [],
    });
    const checklist = compileFoundryOperatorEvidenceChecklistV7({ readiness });
    expect(checklist).toMatchObject({
      state: "blocked",
      inherited: { state: "blocked" },
      potreeEvidenceRequests: [],
      supersededInheritedRequestRefs: [],
    });
    expect(verifyFoundrySourceReadinessMapV7({
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFactsV7,
      readiness,
    })).toEqual(readiness);
    expect(verifyFoundryOperatorEvidenceChecklistV7({ readiness, checklist }))
      .toEqual(checklist);
  });
});
