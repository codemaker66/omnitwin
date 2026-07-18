import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { RuntimePackageRevisionCreateResponse } from "@omnitwin/types";
import type { Lcc2HighestDetailFrontierReceiptV0 } from "@omnitwin/reconstruction-foundry-cli";
import { runtimeAssetStorageKeySha256 } from "../lib/runtime-asset-receipt.js";
import { computeRuntimePackageRevisionDigest } from "../services/runtime-package-revisions.js";
import {
  EXPECTED_RECEPTION_CAPTURE_SESSION_ID,
  PROTECTED_RECEPTION_RUNTIME_PACKAGE_ID,
  RUNTIME_PACKAGE_REVISION_ENDPOINT,
  REQUIRED_RUNTIME_PACKAGE_REVISION_COLUMNS,
  REQUIRED_RUNTIME_PACKAGE_REVISION_CONSTRAINTS,
  REQUIRED_RUNTIME_PACKAGE_REVISION_TRIGGERS,
  type ReceptionFrontierAssetRecord,
  type ReceptionFrontierRuntimePackageRecord,
  type ReceptionQualityFrontierReadStore,
} from "../scripts/register-reception-room-quality-frontier.js";
import {
  RECEPTION_MOBILE_FRONTIER_ASSETS,
  RECEPTION_MOBILE_ANCESTOR_ASSETS,
  RECEPTION_MOBILE_FRONTIER_DECISION_ID,
  RECEPTION_MOBILE_FRONTIER_GENERATED_AT,
  RECEPTION_MOBILE_FRONTIER_HIERARCHY_SHA256,
  RECEPTION_MOBILE_FRONTIER_RECEIPT_SHA256,
  RECEPTION_MOBILE_REGISTERED_ASSETS,
  buildReceptionMobileFrontierPayload,
  parseReceptionMobileFrontierArgs,
  prepareReceptionMobileFrontier,
  runReceptionMobileFrontier,
  validateReceptionMobileFrontierCreateResponse,
} from "../scripts/register-reception-room-mobile-frontier.js";

const scriptPath = fileURLToPath(
  new URL("../scripts/register-reception-room-mobile-frontier.ts", import.meta.url),
);
const MANIFEST_PATH = "C:/checked/Reception Room Mobile.lcc2";

function validAssetRows(): readonly ReceptionFrontierAssetRecord[] {
  return RECEPTION_MOBILE_REGISTERED_ASSETS.map((asset) => ({
    id: asset.id,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    captureSessionId: EXPECTED_RECEPTION_CAPTURE_SESSION_ID,
    assetKind: "splat",
    sourceType: "xgrids",
    fileName: asset.fileName,
    fileExt: ".spz",
    r2Key: asset.r2Key,
    sha256: asset.sha256,
    sizeBytes: asset.sizeBytes,
    evidenceStatus: "unverified",
    runtimeStatus: "usable",
  }));
}

function validFrontierReceipt(): Lcc2HighestDetailFrontierReceiptV0 {
  const selectedNodeCounts = [5, 5, 6, 2] as const;
  const ancestorDepths = [1, 2, 2] as const;
  const ancestorNodeCounts = [16, 9, 7] as const;
  return {
    schemaVersion: "omnitwin.reconstruction-foundry/lcc2-highest-detail-frontier-receipt/v0",
    sourceManifest: {
      fileName: "Reception Room Mobile.lcc2",
      sizeBytes: 56_168,
      sha256: `sha256:${RECEPTION_MOBILE_FRONTIER_HIERARCHY_SHA256}`,
    },
    source: {
      lcc2Version: "0.0.3",
      guid: "05eddf2f6217755d32a06d04cfac49f1",
      fileType: "portable",
      splatType: ".spz",
      totalLevels: 3,
      totalSplatsAcrossAlternatives: 3_455_732,
      lodSplatsHighestToLowest: [1_978_258, 985_690, 491_784],
    },
    selection: {
      policy: "authoritative_leaf_nodes_v1",
      depth: 3,
      nodeCount: 18,
      gaussianCount: 1_978_258,
      sizeBytes: 30_010_681,
      members: RECEPTION_MOBILE_FRONTIER_ASSETS.map((asset, index) => ({
        fileIndex: index + 3,
        relativePath: `data/3dgs/${asset.fileName}`,
        depth: 3,
        nodeIds: [],
        nodeCount: selectedNodeCounts[index] ?? 0,
        gaussianCount: asset.gaussianCount,
        sizeBytes: asset.sizeBytes,
        sha256: `sha256:${asset.sha256}`,
      })),
    },
    ancestorAlternatives: RECEPTION_MOBILE_ANCESTOR_ASSETS.map((asset, index) => ({
      fileIndex: index,
      relativePath: `data/3dgs/${asset.fileName}`,
      depth: ancestorDepths[index] ?? 0,
      nodeIds: [],
      nodeCount: ancestorNodeCounts[index] ?? 0,
      gaussianCount: asset.gaussianCount,
      sizeBytes: asset.sizeBytes,
      sha256: `sha256:${asset.sha256}`,
    })),
    environment: {
      policy: "exclude",
      runtimeLoaded: false,
      fileIndex: 7,
      relativePath: "data/3dgs/env.spz",
      gaussianCount: 3_971,
      sizeBytes: 72_986,
      sha256: "sha256:00ba83257962930fc002c1c9a16b1bf96185dc9f9244c27374facd061775f84b",
    },
    runtime: {
      memberPaths: RECEPTION_MOBILE_FRONTIER_ASSETS.map(
        (asset) => `data/3dgs/${asset.fileName}`,
      ),
      gaussianCount: 1_978_258,
      sizeBytes: 30_010_681,
    },
    proof: {
      sourceOfTruth: "root.child[].data.3dgs",
      everyLeafAtHighestDepth: true,
      everyDeclaredNonEnvironmentFileReferenced: true,
      everyFileUsedByExactlyOneDepth: true,
      everyFileRangeContiguousAndNonOverlapping: true,
      everyLevelMatchesPublishedLodCount: true,
      parentAndChildFilesAreAlternatives: true,
      levels: [
        { depth: 1, nodeCount: 16, fileCount: 1, gaussianCount: 491_784 },
        { depth: 2, nodeCount: 16, fileCount: 2, gaussianCount: 985_690 },
        { depth: 3, nodeCount: 18, fileCount: 4, gaussianCount: 1_978_258 },
      ],
      everyDeclaredSplatFilePresent: true,
      noDeclaredSplatPathIsLinked: true,
      everyDeclaredContainerValidated: true,
      everyEmbeddedGaussianCountMatchesManifest: true,
      allHashedFilesStable: true,
      networkAccess: "none",
      sourceWrites: "none",
    },
    receiptSha256: RECEPTION_MOBILE_FRONTIER_RECEIPT_SHA256,
  };
}

function readStore(
  assets: readonly ReceptionFrontierAssetRecord[] = validAssetRows(),
  packages: readonly ReceptionFrontierRuntimePackageRecord[] = [],
  revisionContract: {
    readonly columns: readonly string[];
    readonly constraints: readonly string[];
    readonly triggers: readonly string[];
  } = {
    columns: REQUIRED_RUNTIME_PACKAGE_REVISION_COLUMNS,
    constraints: REQUIRED_RUNTIME_PACKAGE_REVISION_CONSTRAINTS,
    triggers: REQUIRED_RUNTIME_PACKAGE_REVISION_TRIGGERS,
  },
): ReceptionQualityFrontierReadStore {
  return {
    readAssetVersions: vi.fn(() => Promise.resolve(assets)),
    readRuntimePackages: vi.fn(() => Promise.resolve(packages)),
    readRuntimePackageRevisionContract: vi.fn(() => Promise.resolve(revisionContract)),
  };
}

function validCreateResponse(): RuntimePackageRevisionCreateResponse {
  const payload = buildReceptionMobileFrontierPayload();
  const contentDigest = computeRuntimePackageRevisionDigest(payload);
  const packageId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  return {
    data: {
      id: packageId,
      venueSlug: payload.venueSlug,
      roomSlug: payload.roomSlug,
      primaryVisualAssetVersionId: payload.primaryVisualAssetVersionId ?? null,
      semanticMeshAssetVersionId: null,
      collisionAssetVersionId: null,
      pointCloudAssetVersionId: null,
      manifestJson: payload.manifestJson,
      evidenceStatus: payload.evidenceStatus,
      runtimeStatus: payload.runtimeStatus,
      createdAt: "2026-07-14T08:35:00.000Z",
      updatedAt: "2026-07-14T08:35:00.000Z",
      primaryVisualAssetVersion: null,
      primaryVisualAssetUrl: null,
      visualAssetUrls: [],
    },
    receipt: {
      packageId,
      revision: 3,
      contentDigest,
      created: true,
    },
  };
}

describe("Reception Room Mobile fine-frontier registration preparation", () => {
  it("builds the exact ordered, receipt-bound, internal-only Mobile payload", () => {
    const payload = buildReceptionMobileFrontierPayload();
    const expectedIds = RECEPTION_MOBILE_FRONTIER_ASSETS.map((asset) => asset.id);

    expect(RECEPTION_MOBILE_FRONTIER_ASSETS.map((asset) => asset.fileName)).toEqual([
      "0_13_0_0.spz",
      "0_3_0_0.spz",
      "0_7_0_1.spz",
      "0_8_0_0.spz",
    ]);
    expect(payload.primaryVisualAssetVersionId).toBe(expectedIds[0]);
    expect(payload.manifestJson.assets.visualAssetVersionIds).toEqual(expectedIds);
    expect(payload.manifestJson.assets.visualAssetReceipts).toEqual(
      RECEPTION_MOBILE_FRONTIER_ASSETS.map((asset) => ({
        assetVersionId: asset.id,
        fileName: asset.fileName,
        fileExt: ".spz",
        sha256: asset.sha256,
        sizeBytes: asset.sizeBytes,
        storageKeySha256: runtimeAssetStorageKeySha256(asset.r2Key),
      })),
    );
    expect(payload.manifestJson.compositionBasis).toEqual({
      decisionId: RECEPTION_MOBILE_FRONTIER_DECISION_ID,
      decisionRef: "docs/reports/reception-room-hd-evidence.json#mobile-sh0-lcc2-spz-container",
      hierarchySha256: RECEPTION_MOBILE_FRONTIER_HIERARCHY_SHA256,
      format: "spz",
      level: "fine",
      lodSelectionPolicy: "fixed_fine_frontier_v1",
      expectedGaussianCount: 1_978_258,
    });
    expect(payload.manifestJson.generatedAt).toBe(RECEPTION_MOBILE_FRONTIER_GENERATED_AT);
    expect(payload.runtimeStatus).toBe("internal_ready");
    expect(payload.runtimeStatus).not.toBe("published");
    expect(payload.evidenceStatus).toBe("unverified");
    expect(JSON.stringify(payload)).not.toContain(PROTECTED_RECEPTION_RUNTIME_PACKAGE_ID);
  });

  it("reports a fully validated dry-run when DB rows and local files match", async () => {
    const report = await prepareReceptionMobileFrontier({
      store: readStore([...validAssetRows()].reverse()),
      manifestPath: MANIFEST_PATH,
      inspectFrontier: () => Promise.resolve(validFrontierReceipt()),
    });

    expect(report.preflightStatus).toBe("validated_payload");
    expect(report.validations.every((item) => item.status === "passed")).toBe(true);
    expect(report.databaseAssets.map((asset) => asset.id)).toEqual(
      RECEPTION_MOBILE_REGISTERED_ASSETS.map((asset) => asset.id),
    );
    expect(report.expectedContentDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(report.apply).toEqual(expect.objectContaining({
      databaseReady: true,
      databaseBlocker: null,
      databaseContract: expect.objectContaining({ ready: true }),
      endpointDeploymentVerified: false,
      endpoint: RUNTIME_PACKAGE_REVISION_ENDPOINT,
      requested: false,
      receipt: null,
    }));
  });

  it("validates the payload but blocks apply when migration 0052 is missing", async () => {
    const store = readStore(validAssetRows(), [], {
      columns: [],
      constraints: [],
      triggers: [],
    });
    const report = await prepareReceptionMobileFrontier({
      store,
      manifestPath: MANIFEST_PATH,
      inspectFrontier: () => Promise.resolve(validFrontierReceipt()),
    });

    expect(report.preflightStatus).toBe("validated_payload");
    expect(report.apply.databaseReady).toBe(false);
    expect(report.apply.databaseBlocker).toContain("migration 0052");
    expect(report.apply.databaseContract.missingColumns).toEqual(
      expect.arrayContaining(["revision", "identity_kind", "content_digest"]),
    );

    const createRevision = vi.fn(() => Promise.resolve(validCreateResponse()));
    await expect(runReceptionMobileFrontier({
      args: ["--manifest", MANIFEST_PATH, "--apply"],
      store,
      inspectFrontier: () => Promise.resolve(validFrontierReceipt()),
      createRevision,
    })).rejects.toThrow("migration 0052");
    expect(createRevision).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong room", { roomSlug: "grand-hall" }],
    ["wrong capture", { captureSessionId: "11111111-1111-4111-8111-111111111111" }],
    ["wrong filename", { fileName: "wrong.spz" }],
    ["wrong hash", { sha256: "0".repeat(64) }],
    ["wrong byte count", { sizeBytes: 1 }],
    ["wrong R2 key", { r2Key: "wrong/key.spz" }],
    ["wrong extension", { fileExt: ".sog" }],
    ["non-usable status", { runtimeStatus: "staged" }],
    ["rejected evidence", { evidenceStatus: "rejected" }],
  ] as const)("fails closed for a DB row with %s", async (_label, change) => {
    const [first, ...rest] = validAssetRows();
    if (first === undefined) throw new Error("Test fixture requires a first asset.");
    const report = await prepareReceptionMobileFrontier({
      store: readStore([{ ...first, ...change } as ReceptionFrontierAssetRecord, ...rest]),
      manifestPath: MANIFEST_PATH,
      inspectFrontier: () => Promise.resolve(validFrontierReceipt()),
    });

    expect(report.preflightStatus).toBe("validation_failed");
    expect(report.validations.some((item) => item.status === "failed")).toBe(true);
  });

  it("fails closed for a missing or duplicated expected asset row", async () => {
    const missing = await prepareReceptionMobileFrontier({
      store: readStore(validAssetRows().slice(1)),
      manifestPath: MANIFEST_PATH,
      inspectFrontier: () => Promise.resolve(validFrontierReceipt()),
    });
    expect(missing.preflightStatus).toBe("validation_failed");

    const rows = validAssetRows();
    const first = rows[0];
    if (first === undefined) throw new Error("Test fixture requires a first asset.");
    const duplicated = await prepareReceptionMobileFrontier({
      store: readStore([first, first, ...rows.slice(1)]),
      manifestPath: MANIFEST_PATH,
      inspectFrontier: () => Promise.resolve(validFrontierReceipt()),
    });
    expect(duplicated.preflightStatus).toBe("validation_failed");
  });

  it("fails closed when the authoritative hierarchy receipt differs", async () => {
    const receipt = validFrontierReceipt();
    const report = await prepareReceptionMobileFrontier({
      store: readStore(),
      manifestPath: MANIFEST_PATH,
      inspectFrontier: () => Promise.resolve({
        ...receipt,
        receiptSha256: `sha256:${"f".repeat(64)}`,
      }),
    });

    expect(report.preflightStatus).toBe("validation_failed");
    expect(report.validations).toContainEqual(expect.objectContaining({
      name: "authoritative LCC2 frontier receipt",
      status: "failed",
    }));
  });

  it("treats ordered composition as identity while leaving digest idempotency to the API", async () => {
    const payload = buildReceptionMobileFrontierPayload();
    const existing: ReceptionFrontierRuntimePackageRecord = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      venueSlug: payload.venueSlug,
      roomSlug: payload.roomSlug,
      primaryVisualAssetVersionId: payload.primaryVisualAssetVersionId ?? null,
      semanticMeshAssetVersionId: null,
      collisionAssetVersionId: null,
      pointCloudAssetVersionId: null,
      manifestJson: payload.manifestJson,
    };
    const matching = await prepareReceptionMobileFrontier({
      store: readStore(validAssetRows(), [existing]),
      manifestPath: MANIFEST_PATH,
      inspectFrontier: () => Promise.resolve(validFrontierReceipt()),
    });
    expect(matching.existingMatchingCompositionId).toBe(existing.id);

    const ids = payload.manifestJson.assets.visualAssetVersionIds;
    if (ids === undefined) throw new Error("Payload requires visual IDs.");
    const reversed: ReceptionFrontierRuntimePackageRecord = {
      ...existing,
      manifestJson: {
        ...payload.manifestJson,
        assets: {
          ...payload.manifestJson.assets,
          visualAssetVersionIds: [...ids].reverse(),
        },
      },
    };
    const nonMatching = await prepareReceptionMobileFrontier({
      store: readStore(validAssetRows(), [reversed]),
      manifestPath: MANIFEST_PATH,
      inspectFrontier: () => Promise.resolve(validFrontierReceipt()),
    });
    expect(nonMatching.existingMatchingCompositionId).toBeNull();
  });

  it("requires an explicit source directory and rejects ambiguous CLI arguments", () => {
    expect(parseReceptionMobileFrontierArgs(["--manifest", MANIFEST_PATH])).toEqual({
      applyRequested: false,
      manifestPath: MANIFEST_PATH,
    });
    expect(parseReceptionMobileFrontierArgs([
      `--manifest=${MANIFEST_PATH}`,
      "--apply",
    ])).toEqual({
      applyRequested: true,
      manifestPath: MANIFEST_PATH,
    });
    expect(() => parseReceptionMobileFrontierArgs([])).toThrow("--manifest is required");
    expect(() => parseReceptionMobileFrontierArgs(["--unknown"])).toThrow("Unknown argument");
    expect(() => parseReceptionMobileFrontierArgs([
      "--manifest", "C:/a.lcc2", "--manifest", "C:/b.lcc2",
    ])).toThrow("only be supplied once");
    expect(() => parseReceptionMobileFrontierArgs([
      "--manifest", "relative/Reception Room Mobile.lcc2",
    ])).toThrow("absolute local path");
  });

  it("fails closed when --apply has no authenticated create-only client", async () => {
    await expect(runReceptionMobileFrontier({
      args: ["--manifest", MANIFEST_PATH, "--apply"],
      store: readStore(),
      inspectFrontier: () => Promise.resolve(validFrontierReceipt()),
    })).rejects.toThrow("requires an authenticated immutable revision API client");
  });

  it("sends the exact payload and retains only a matching immutable receipt", async () => {
    const response = validCreateResponse();
    const createRevision = vi.fn(() => Promise.resolve(response));
    const lines: string[] = [];
    const report = await runReceptionMobileFrontier({
      args: ["--manifest", MANIFEST_PATH, "--apply"],
      store: readStore(),
      inspectFrontier: () => Promise.resolve(validFrontierReceipt()),
      createRevision,
      log: (line) => lines.push(line),
    });

    expect(createRevision).toHaveBeenCalledWith({
      package: buildReceptionMobileFrontierPayload(),
    });
    expect(report.apply.receipt).toEqual(response.receipt);
    expect(validateReceptionMobileFrontierCreateResponse(response)).toEqual(response.receipt);
    expect(lines).toHaveLength(1);
  });

  it("rejects a response whose receipt or returned package changes identity", () => {
    const wrongDigest = validCreateResponse();
    wrongDigest.receipt = { ...wrongDigest.receipt, contentDigest: "0".repeat(64) };
    expect(() => validateReceptionMobileFrontierCreateResponse(wrongDigest)).toThrow(
      "validated payload digest",
    );

    const wrongPackage = validCreateResponse();
    wrongPackage.data = {
      ...wrongPackage.data,
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    };
    expect(() => validateReceptionMobileFrontierCreateResponse(wrongPackage)).toThrow(
      "package ID",
    );
  });

  it("contains no upload or direct database-write primitive", async () => {
    const source = await readFile(scriptPath, "utf8");

    expect(source).not.toContain("PutObjectCommand");
    expect(source).not.toMatch(/\bdb\s*\.\s*(?:insert|update|delete)\s*\(/u);
    expect(source).not.toContain(".set({");
    expect(source).toContain("RUNTIME_PACKAGE_REVISION_ENDPOINT");
    expect(source).toContain("create-only revision API");
  });
});
