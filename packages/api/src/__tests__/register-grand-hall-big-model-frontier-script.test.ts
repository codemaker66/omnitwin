import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Lcc2HighestDetailFrontierReceiptV0 } from "@omnitwin/reconstruction-foundry-cli";
import {
  GRAND_HALL_ROOM_ONLY_MAX_TOTAL_BYTES,
  GrandHallRoomOnlyRuntimeEvidenceMaterialV2Schema,
  GrandHallRoomOnlyRuntimeEvidenceV2Schema,
  computeGrandHallRoomOnlyRuntimeEvidenceV2Sha256,
  computeGrandHallRoomOnlyVisualMemberSetSha256,
  type GrandHallRoomOnlyVisualMemberV2,
} from "@omnitwin/types";
import { describe, expect, it, vi } from "vitest";
import {
  GRAND_HALL_APPLY_BLOCKER,
  GRAND_HALL_APPLY_BLOCKER_CODE,
  GRAND_HALL_DEFAULT_OBJECT_PREFIX,
  GRAND_HALL_FRONTIER_GAUSSIAN_COUNT,
  GRAND_HALL_FRONTIER_MEMBERS,
  GRAND_HALL_FRONTIER_RECEIPT_SHA256,
  GRAND_HALL_FRONTIER_TOTAL_BYTES,
  GRAND_HALL_LOD_SELECTION_POLICY,
  GRAND_HALL_MANIFEST_SHA256,
  GRAND_HALL_PRIVATE_STORAGE_ROOT,
  buildGrandHallAssetRegistrationInputs,
  buildGrandHallRuntimePackagePayload,
  parseGrandHallRegistrationArgs,
  prepareGrandHallRegistration,
  runGrandHallRegistration,
  validateGrandHallFrontierReceipt,
  type GrandHallAssetRecord,
  type GrandHallRegistrationReadStore,
} from "../scripts/register-grand-hall-big-model-frontier.js";
import {
  REQUIRED_RUNTIME_PACKAGE_REVISION_COLUMNS,
  REQUIRED_RUNTIME_PACKAGE_REVISION_CONSTRAINTS,
  REQUIRED_RUNTIME_PACKAGE_REVISION_TRIGGERS,
} from "../scripts/register-reception-room-quality-frontier.js";
import {
  buildGrandHallRoomOnlyAssetRegistrationInputs,
  buildGrandHallRoomOnlyRuntimePackagePayload,
  grandHallRoomOnlyRuntimeAdmissionError,
  isCanonicalGrandHallRuntimePackage,
  type GrandHallRoomOnlyRuntimeAdmission,
} from "../lib/grand-hall-frontier-contract.js";
import { syntheticGrandHallRoomOnlyAdmission } from "./fixtures/grand-hall-room-only-evidence.js";
import { computeRuntimePackageRevisionDigest } from "../services/runtime-package-revisions.js";

const MANIFEST_PATH = "C:/GRAND_HALL_BIG_MODEL_VARIATIONS/scans_BIG_MODEL_TH_GH_1/lcc2-result/Grand_Hall.lcc2";
const scriptPath = fileURLToPath(
  new URL("../scripts/register-grand-hall-big-model-frontier.ts", import.meta.url),
);
const contractPath = fileURLToPath(
  new URL("../lib/grand-hall-frontier-contract.ts", import.meta.url),
);
const packageJsonPath = fileURLToPath(new URL("../../package.json", import.meta.url));

function assetId(index: number): string {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function validReceipt(): Lcc2HighestDetailFrontierReceiptV0 {
  return {
    schemaVersion: "omnitwin.reconstruction-foundry/lcc2-highest-detail-frontier-receipt/v0",
    sourceManifest: {
      fileName: "Grand_Hall.lcc2",
      sizeBytes: 124_070,
      sha256: `sha256:${GRAND_HALL_MANIFEST_SHA256}`,
    },
    source: {
      lcc2Version: "0.0.3",
      guid: "2d483e031ad40e259c75f765d6f5fcbb",
      fileType: "quality",
      splatType: ".sog",
      totalLevels: 5,
      totalSplatsAcrossAlternatives: 11_487_038,
      lodSplatsHighestToLowest: [6_019_684, 2_945_194, 1_451_051, 715_516, 355_593],
    },
    selection: {
      policy: "authoritative_leaf_nodes_v1",
      depth: 5,
      nodeCount: 37,
      gaussianCount: GRAND_HALL_FRONTIER_GAUSSIAN_COUNT,
      sizeBytes: GRAND_HALL_FRONTIER_TOTAL_BYTES,
      members: GRAND_HALL_FRONTIER_MEMBERS.map((member) => ({
        fileIndex: member.fileIndex,
        relativePath: member.relativePath,
        depth: member.depth,
        nodeIds: Array.from({ length: member.nodeCount }, (_, index) =>
          `${member.fileName}:${String(index)}`
        ),
        nodeCount: member.nodeCount,
        gaussianCount: member.gaussianCount,
        sizeBytes: member.sizeBytes,
        sha256: `sha256:${member.sha256}`,
      })),
    },
    ancestorAlternatives: Array.from({ length: 12 }, (_, index) => ({
      fileIndex: index,
      relativePath: `data/3dgs/ancestor-${String(index)}.sog`,
      depth: Math.min(index + 1, 4),
      nodeIds: [`ancestor-${String(index)}`],
      nodeCount: 1,
      gaussianCount: 1,
      sizeBytes: 1,
      sha256: `sha256:${"a".repeat(64)}`,
    })),
    environment: {
      policy: "exclude",
      runtimeLoaded: false,
      fileIndex: 23,
      relativePath: "data/3dgs/env.sog",
      gaussianCount: 11_296,
      sizeBytes: 414_176,
      sha256: `sha256:${"b".repeat(64)}`,
    },
    runtime: {
      memberPaths: GRAND_HALL_FRONTIER_MEMBERS.map((member) => member.relativePath),
      gaussianCount: GRAND_HALL_FRONTIER_GAUSSIAN_COUNT,
      sizeBytes: GRAND_HALL_FRONTIER_TOTAL_BYTES,
    },
    proof: {
      sourceOfTruth: "root.child[].data.3dgs",
      everyLeafAtHighestDepth: true,
      everyDeclaredNonEnvironmentFileReferenced: true,
      everyFileUsedByExactlyOneDepth: true,
      everyFileRangeContiguousAndNonOverlapping: true,
      everyLevelMatchesPublishedLodCount: true,
      parentAndChildFilesAreAlternatives: true,
      levels: [],
      everyDeclaredSplatFilePresent: true,
      noDeclaredSplatPathIsLinked: true,
      everyDeclaredContainerValidated: true,
      everyEmbeddedGaussianCountMatchesManifest: true,
      allHashedFilesStable: true,
      networkAccess: "none",
      sourceWrites: "none",
    },
    receiptSha256: GRAND_HALL_FRONTIER_RECEIPT_SHA256,
  };
}

function args() {
  return {
    manifestPath: resolve(MANIFEST_PATH),
    objectPrefix: GRAND_HALL_DEFAULT_OBJECT_PREFIX,
  } as const;
}

function assetRows(): readonly GrandHallAssetRecord[] {
  return GRAND_HALL_FRONTIER_MEMBERS.map((member, index) => ({
    id: assetId(index),
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    captureSessionId: null,
    assetKind: "splat",
    sourceType: "xgrids",
    fileName: member.fileName,
    fileExt: ".sog",
    r2Key: `${GRAND_HALL_DEFAULT_OBJECT_PREFIX}${member.relativePath}`,
    externalUrl: null,
    mimeType: "application/octet-stream",
    sha256: member.sha256,
    sizeBytes: member.sizeBytes,
    evidenceStatus: "unverified",
    runtimeStatus: "usable",
  }));
}

function croppedOutputRows(): readonly GrandHallAssetRecord[] {
  return buildGrandHallRoomOnlyAssetRegistrationInputs(
    syntheticGrandHallRoomOnlyAdmission(),
  ).map((input, index) => ({
    id: assetId(index + 100),
    venueSlug: input.venueSlug,
    roomSlug: input.roomSlug ?? null,
    captureSessionId: null,
    assetKind: input.assetKind,
    sourceType: input.sourceType,
    fileName: input.fileName,
    fileExt: input.fileExt,
    r2Key: input.r2Key ?? null,
    externalUrl: null,
    mimeType: input.mimeType ?? null,
    sha256: input.sha256 ?? null,
    sizeBytes: input.sizeBytes ?? null,
    evidenceStatus: input.evidenceStatus,
    runtimeStatus: input.runtimeStatus,
  }));
}

function syntheticAdmissionWithMembers(
  members: readonly GrandHallRoomOnlyVisualMemberV2[],
): GrandHallRoomOnlyRuntimeAdmission {
  const base = syntheticGrandHallRoomOnlyAdmission().evidence;
  const { evidenceSha256: _evidenceSha256, ...baseMaterial } = base;
  const material = GrandHallRoomOnlyRuntimeEvidenceMaterialV2Schema.parse({
    ...baseMaterial,
    croppedVisual: {
      ...baseMaterial.croppedVisual,
      memberSetSha256: computeGrandHallRoomOnlyVisualMemberSetSha256(members),
      memberCount: members.length,
      totalBytes: members.reduce((total, member) => total + member.sizeBytes, 0),
      totalGaussianCount: members.reduce(
        (total, member) => total + member.gaussianCount,
        0,
      ),
      members,
    },
  });
  const evidence = GrandHallRoomOnlyRuntimeEvidenceV2Schema.parse({
    ...material,
    evidenceSha256: computeGrandHallRoomOnlyRuntimeEvidenceV2Sha256(material),
  });
  return { evidence, acceptedEvidenceSha256: evidence.evidenceSha256 };
}

function readStore(rows: readonly GrandHallAssetRecord[] = []): GrandHallRegistrationReadStore {
  return {
    readAssetVersionsByStorageKeys: vi.fn(() => Promise.resolve(rows)),
    readRuntimePackageRevisionContract: vi.fn(() => Promise.resolve({
      columns: REQUIRED_RUNTIME_PACKAGE_REVISION_COLUMNS,
      constraints: REQUIRED_RUNTIME_PACKAGE_REVISION_CONSTRAINTS,
      triggers: REQUIRED_RUNTIME_PACKAGE_REVISION_TRIGGERS,
    })),
    hasAssetStorageKeyUniqueConstraint: vi.fn(() => Promise.resolve(true)),
  };
}

describe("Grand Hall big-model read-only intake", () => {
  it("pins the exact ordered eleven-member SOG frontier and totals", () => {
    expect(GRAND_HALL_FRONTIER_MEMBERS.map((member) => member.fileName)).toEqual([
      "0_0_0_1_0_1.sog",
      "0_1_0_1_0_0.sog",
      "0_2_0_0_1_1.sog",
      "0_3_0_0_0_0.sog",
      "0_3_0_1_0_1.sog",
      "0_4_0_1_0_0.sog",
      "0_5_0_0_0_1.sog",
      "0_5_0_1_0_1.sog",
      "0_6_0_0_0_1.sog",
      "0_7_0_0_0_0.sog",
      "0_7_0_0_0_1.sog",
    ]);
    expect(GRAND_HALL_FRONTIER_MEMBERS.reduce((sum, member) => sum + member.sizeBytes, 0))
      .toBe(GRAND_HALL_FRONTIER_TOTAL_BYTES);
    expect(GRAND_HALL_FRONTIER_MEMBERS.reduce((sum, member) => sum + member.gaussianCount, 0))
      .toBe(GRAND_HALL_FRONTIER_GAUSSIAN_COUNT);
    expect(validateGrandHallFrontierReceipt(validReceipt()).status).toBe("passed");
  });

  it.each([
    ["member order", (receipt: Lcc2HighestDetailFrontierReceiptV0) => ({
      ...receipt,
      selection: { ...receipt.selection, members: [...receipt.selection.members].reverse() },
    })],
    ["member hash", (receipt: Lcc2HighestDetailFrontierReceiptV0) => ({
      ...receipt,
      selection: {
        ...receipt.selection,
        members: receipt.selection.members.map((member, index) =>
          index === 0 ? { ...member, sha256: `sha256:${"0".repeat(64)}` } : member
        ),
      },
    })],
    ["byte total", (receipt: Lcc2HighestDetailFrontierReceiptV0) => ({
      ...receipt,
      runtime: { ...receipt.runtime, sizeBytes: receipt.runtime.sizeBytes + 1 },
    })],
    ["environment inclusion", (receipt: Lcc2HighestDetailFrontierReceiptV0) => ({
      ...receipt,
      environment: { ...receipt.environment, runtimeLoaded: true },
    })],
    ["receipt identity", (receipt: Lcc2HighestDetailFrontierReceiptV0) => ({
      ...receipt,
      receiptSha256: `sha256:${"f".repeat(64)}`,
    })],
  ] as const)("rejects a changed %s", (_label, mutate) => {
    expect(validateGrandHallFrontierReceipt(mutate(validReceipt())).status).toBe("failed");
  });

  it("accepts either the absolute manifest or its exact root and confines object keys", () => {
    expect(parseGrandHallRegistrationArgs(["--manifest", MANIFEST_PATH])).toEqual(args());
    expect(parseGrandHallRegistrationArgs([
      "--root",
      "C:/GRAND_HALL_BIG_MODEL_VARIATIONS/scans_BIG_MODEL_TH_GH_1/lcc2-result",
    ])).toEqual(args());
    expect(() => parseGrandHallRegistrationArgs([])).toThrow("exactly one");
    expect(() => parseGrandHallRegistrationArgs([
      "--manifest",
      MANIFEST_PATH,
      "--object-prefix",
      "venues/trades-hall/rooms/reception-room/escape/",
    ])).toThrow("private key prefix");
  });

  it("rejects --apply before any database or filesystem callback can run", async () => {
    const store = readStore();
    const inspectFrontier = vi.fn(() => Promise.resolve(validReceipt()));

    await expect(runGrandHallRegistration({
      args: ["--manifest", MANIFEST_PATH, "--apply"],
      store,
      inspectFrontier,
      log: vi.fn(),
    })).rejects.toThrow(GRAND_HALL_APPLY_BLOCKER_CODE);
    expect(store.readAssetVersionsByStorageKeys).not.toHaveBeenCalled();
    expect(store.readRuntimePackageRevisionContract).not.toHaveBeenCalled();
    expect(store.hasAssetStorageKeyUniqueConstraint).not.toHaveBeenCalled();
    expect(inspectFrontier).not.toHaveBeenCalled();
  });

  it.each([
    ["separate", ["--manifest", MANIFEST_PATH, "--capture-session-id", assetId(40)]],
    ["equals", ["--manifest", MANIFEST_PATH, `--capture-session-id=${assetId(40)}`]],
  ] as const)("rejects the removed capture-session option (%s form)", (_label, cli) => {
    expect(() => parseGrandHallRegistrationArgs(cli)).toThrow("not accepted");
  });

  it("proposes private AssetVersion identities with captureSessionId and externalUrl fixed null", () => {
    const inputs = buildGrandHallAssetRegistrationInputs(args());

    expect(inputs).toHaveLength(11);
    expect(inputs.every((input) =>
      input.r2Key?.startsWith(GRAND_HALL_PRIVATE_STORAGE_ROOT) === true &&
      input.captureSessionId === null &&
      input.externalUrl === null &&
      input.fileExt === ".sog" &&
      input.evidenceStatus === "unverified" &&
      input.runtimeStatus === "usable"
    )).toBe(true);
    expect(JSON.stringify(inputs)).not.toMatch(/env\.sog|\.spz|\.obj|\.ply/iu);
  });

  it("builds the exact proposed package only from null-session exact rows", () => {
    const rows = assetRows();
    const payload = buildGrandHallRuntimePackagePayload(rows);

    expect(payload.primaryVisualAssetVersionId).toBe(rows[0]?.id);
    expect(payload.manifestJson.assets.visualAssetVersionIds).toEqual(rows.map((row) => row.id));
    expect(payload.manifestJson.assets.visualAssetReceipts?.map((receipt) => receipt.fileName)).toEqual(
      GRAND_HALL_FRONTIER_MEMBERS.map((member) => member.fileName),
    );
    expect(payload.manifestJson.compositionBasis).toEqual(expect.objectContaining({
      decisionRef: GRAND_HALL_FRONTIER_RECEIPT_SHA256,
      hierarchySha256: GRAND_HALL_MANIFEST_SHA256,
      lodSelectionPolicy: GRAND_HALL_LOD_SELECTION_POLICY,
      expectedGaussianCount: GRAND_HALL_FRONTIER_GAUSSIAN_COUNT,
    }));
    expect(payload.semanticMeshAssetVersionId).toBeNull();
    expect(payload.collisionAssetVersionId).toBeNull();
    expect(payload.pointCloudAssetVersionId).toBeNull();
    expect(payload.manifestJson.generatedAt).toBeUndefined();

    const first = rows[0];
    if (first === undefined) throw new Error("Test fixture needs a first row.");
    expect(() => buildGrandHallRuntimePackagePayload([
      { ...first, captureSessionId: assetId(50) },
      ...rows.slice(1),
    ])).toThrow("does not match");
  });

  it("rejects legacy v1 and uses the same accepted-v2 predicate at registration and serving", () => {
    const rows = assetRows();
    const legacy = buildGrandHallRuntimePackagePayload(rows);
    expect(isCanonicalGrandHallRuntimePackage(legacy, rows)).toBe(false);

    const admission = syntheticGrandHallRoomOnlyAdmission();
    const croppedRows = croppedOutputRows();
    const input = buildGrandHallRoomOnlyRuntimePackagePayload(croppedRows, admission);
    expect(isCanonicalGrandHallRuntimePackage(
      input,
      croppedRows,
      admission.acceptedEvidenceSha256,
    )).toBe(true);
    expect(isCanonicalGrandHallRuntimePackage(
      { ...input, evidenceStatus: "unverified" },
      croppedRows,
      admission.acceptedEvidenceSha256,
    )).toBe(false);

    const first = croppedRows[0];
    if (first === undefined) throw new Error("Test fixture needs a first row.");
    expect(isCanonicalGrandHallRuntimePackage(input, [
      { ...first, captureSessionId: assetId(80) },
      ...croppedRows.slice(1),
    ], admission.acceptedEvidenceSha256)).toBe(false);
    expect(isCanonicalGrandHallRuntimePackage({
      ...input,
      pointCloudAssetVersionId: assetId(81),
    }, croppedRows, admission.acceptedEvidenceSha256)).toBe(false);

    const alteredNotes = {
      ...input,
      manifestJson: {
        ...input.manifestJson,
        notes: "Self-consistent but non-canonical Grand Hall package notes.",
      },
    };
    const addedGeneratedAt = {
      ...input,
      manifestJson: {
        ...input.manifestJson,
        generatedAt: "2026-08-22T12:00:00.000Z",
      },
    };
    expect(computeRuntimePackageRevisionDigest(alteredNotes)).not.toBe(
      computeRuntimePackageRevisionDigest(input),
    );
    expect(computeRuntimePackageRevisionDigest(addedGeneratedAt)).not.toBe(
      computeRuntimePackageRevisionDigest(input),
    );
    expect(isCanonicalGrandHallRuntimePackage(
      alteredNotes,
      croppedRows,
      admission.acceptedEvidenceSha256,
    )).toBe(false);
    expect(isCanonicalGrandHallRuntimePackage(
      addedGeneratedAt,
      croppedRows,
      admission.acceptedEvidenceSha256,
    )).toBe(false);
  });

  it("rejects renamed, reordered, subset, or mixed legacy source bytes as cropped output", () => {
    const legacy = GRAND_HALL_FRONTIER_MEMBERS[3];
    if (legacy === undefined) throw new Error("Legacy frontier fixture is incomplete.");
    const renamedLegacy = {
      fileName: "renamed-source-byte.sog",
      fileExt: ".sog" as const,
      sha256: legacy.sha256,
      sizeBytes: legacy.sizeBytes,
      gaussianCount: legacy.gaussianCount,
    };
    const subsetAdmission = syntheticAdmissionWithMembers([renamedLegacy]);
    expect(grandHallRoomOnlyRuntimeAdmissionError(subsetAdmission)).toMatch(
      /source-frontier member/u,
    );

    const distinct = syntheticGrandHallRoomOnlyAdmission().evidence.croppedVisual.members[0];
    if (distinct === undefined) throw new Error("Synthetic cropped fixture is incomplete.");
    const mixedAdmission = syntheticAdmissionWithMembers([distinct, renamedLegacy].reverse());
    expect(grandHallRoomOnlyRuntimeAdmissionError(mixedAdmission)).toMatch(
      /source-frontier member/u,
    );
  });

  it("rejects an admission whose atomic browser package exceeds the shared total cap", () => {
    const admission = syntheticGrandHallRoomOnlyAdmission();
    const oversizedAdmission = {
      ...admission,
      evidence: {
        ...admission.evidence,
        croppedVisual: {
          ...admission.evidence.croppedVisual,
          totalBytes: GRAND_HALL_ROOM_ONLY_MAX_TOTAL_BYTES + 1,
        },
      },
    } as GrandHallRoomOnlyRuntimeAdmission;

    expect(grandHallRoomOnlyRuntimeAdmissionError(oversizedAdmission)).toMatch(
      /immutable schema/u,
    );
  });

  it("emits a useful dry-run with an explicit server-bound registration blocker", async () => {
    const report = await prepareGrandHallRegistration({
      args: args(),
      store: readStore(),
      inspectFrontier: () => Promise.resolve(validReceipt()),
    });

    expect(report.preflightStatus).toBe("validated_dry_run");
    expect(report).toMatchObject({
      artifactRole: "legacy_source_diagnostic",
      runtimeAdmissible: false,
    });
    expect(report.requestedMode).toBe("dry_run");
    expect(report.proposedRuntimePackage).toBeNull();
    expect(report.registration).toEqual({
      status: "blocked",
      code: GRAND_HALL_APPLY_BLOCKER_CODE,
      detail: GRAND_HALL_APPLY_BLOCKER,
    });
  });

  it("can report an exact existing composition but still grants no apply capability", async () => {
    const report = await prepareGrandHallRegistration({
      args: args(),
      store: readStore(assetRows()),
      inspectFrontier: () => Promise.resolve(validReceipt()),
    });

    expect(report.preflightStatus).toBe("validated_dry_run");
    expect(report.proposedRuntimePackage?.manifestJson.assets.visualAssetVersionIds).toEqual(
      assetRows().map((row) => row.id),
    );
    expect(report.registration.status).toBe("blocked");
  });

  it("treats an existing non-null capture-session claim as a conflict", async () => {
    const rows = [...assetRows()];
    const first = rows[0];
    if (first === undefined) throw new Error("Test fixture needs a first row.");
    rows[0] = { ...first, captureSessionId: assetId(60) };

    const report = await prepareGrandHallRegistration({
      args: args(),
      store: readStore(rows),
      inspectFrontier: () => Promise.resolve(validReceipt()),
    });

    expect(report.preflightStatus).toBe("validation_failed");
    expect(report.proposedRuntimePackage).toBeNull();
    expect(report.validations).toContainEqual(expect.objectContaining({
      name: `database asset ${first.fileName}`,
      status: "failed",
      detail: expect.stringContaining("captureSessionId"),
    }));
  });

  it("fails dry-run readiness when immutable database guards are absent", async () => {
    const store: GrandHallRegistrationReadStore = {
      ...readStore(),
      readRuntimePackageRevisionContract: vi.fn(() => Promise.resolve({
        columns: [],
        constraints: [],
        triggers: [],
      })),
      hasAssetStorageKeyUniqueConstraint: vi.fn(() => Promise.resolve(false)),
    };
    const report = await prepareGrandHallRegistration({
      args: args(),
      store,
      inspectFrontier: () => Promise.resolve(validReceipt()),
    });

    expect(report.preflightStatus).toBe("validation_failed");
  });

  it("is exposed as a read-only operator command with no latent upload/API mutation client", async () => {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      readonly scripts?: Record<string, string>;
    };
    const source = await readFile(scriptPath, "utf8");
    const contractSource = await readFile(contractPath, "utf8");

    expect(packageJson.scripts?.["assets:register-grand-hall-big-model-frontier"]).toBe(
      "node --env-file=.env --import tsx src/scripts/register-grand-hall-big-model-frontier.ts",
    );
    expect(source).toContain(GRAND_HALL_APPLY_BLOCKER_CODE);
    expect(contractSource).toContain("captureSessionId: null");
    expect(source).not.toContain("PutObjectCommand");
    expect(source).not.toContain("GetObjectCommand");
    expect(source).not.toContain("RUNTIME_PACKAGE_ADMIN_TOKEN");
    expect(source).not.toContain("RUNTIME_PACKAGE_API_ORIGIN");
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(/\bdb\s*\.\s*(?:insert|update|delete)\s*\(/u);
  });
});
