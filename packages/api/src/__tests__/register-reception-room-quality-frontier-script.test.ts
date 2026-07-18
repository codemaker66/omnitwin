import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  RuntimeCompositionDecisionV1Schema,
  type RuntimePackageRevisionCreateResponse,
} from "@omnitwin/types";
import {
  EXPECTED_RECEPTION_CAPTURE_SESSION_ID,
  PROTECTED_RECEPTION_RUNTIME_PACKAGE_ID,
  RECEPTION_QUALITY_AUDITED_ASSETS,
  RECEPTION_QUALITY_ENVIRONMENT_ASSET,
  RECEPTION_QUALITY_EXCLUDED_ANCESTOR_ASSETS,
  RECEPTION_QUALITY_FRONTIER_DECISION_ID,
  RECEPTION_QUALITY_FRONTIER_GENERATED_AT,
  RECEPTION_QUALITY_FRONTIER_HIERARCHY_SHA256,
  RECEPTION_QUALITY_FRONTIER_HIERARCHY_VERSION,
  RECEPTION_QUALITY_FRONTIER_ASSETS,
  REQUIRED_RUNTIME_PACKAGE_REVISION_COLUMNS,
  REQUIRED_RUNTIME_PACKAGE_REVISION_CONSTRAINTS,
  REQUIRED_RUNTIME_PACKAGE_REVISION_TRIGGERS,
  RUNTIME_PACKAGE_REVISION_ENDPOINT,
  buildReceptionQualityFrontierDecision,
  buildReceptionQualityFrontierPayload,
  createReceptionQualityFrontierApiClient,
  inspectReceptionQualityFrontierFiles,
  parseReceptionQualityFrontierArgs,
  prepareReceptionQualityFrontier,
  runReceptionQualityFrontier,
  type ReceptionFrontierAssetRecord,
  type ReceptionFrontierRuntimePackageRecord,
  type ReceptionQualityFrontierReadStore,
} from "../scripts/register-reception-room-quality-frontier.js";
import { runtimeAssetStorageKeySha256 } from "../lib/runtime-asset-receipt.js";
import { computeRuntimePackageRevisionDigest } from "../services/runtime-package-revisions.js";

const scriptPath = fileURLToPath(
  new URL("../scripts/register-reception-room-quality-frontier.ts", import.meta.url),
);

function validAssetRows(): readonly ReceptionFrontierAssetRecord[] {
  return RECEPTION_QUALITY_AUDITED_ASSETS.map((asset) => ({
    id: asset.id,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    captureSessionId: EXPECTED_RECEPTION_CAPTURE_SESSION_ID,
    assetKind: "splat",
    sourceType: "xgrids",
    fileName: asset.fileName,
    fileExt: ".sog",
    r2Key: asset.r2Key,
    sha256: asset.sha256,
    sizeBytes: asset.sizeBytes,
    evidenceStatus: "unverified",
    runtimeStatus: "usable",
  }));
}

function validLocalInspections() {
  return RECEPTION_QUALITY_AUDITED_ASSETS.map((asset) => ({
    id: asset.id,
    fileName: asset.fileName,
    absolutePath: `C:/checked/${asset.fileName}`,
    sha256: asset.sha256,
    sizeBytes: asset.sizeBytes,
    error: null,
  }));
}

function validCreateResponse(): RuntimePackageRevisionCreateResponse {
  const payload = buildReceptionQualityFrontierPayload();
  const contentDigest = computeRuntimePackageRevisionDigest(payload);
  const packageId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
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
      createdAt: "2026-07-13T12:05:00.000Z",
      updatedAt: "2026-07-13T12:05:00.000Z",
      primaryVisualAssetVersion: null,
      primaryVisualAssetUrl: null,
      visualAssetUrls: [],
    },
    receipt: {
      packageId,
      revision: 2,
      contentDigest,
      created: true,
    },
  };
}

function validDecisionBinding(response = validCreateResponse()) {
  return {
    receipt: response.receipt,
    runtimePackage: response.data,
    decidedAt: "2026-07-13T12:06:00.000Z",
    decidedBy: "reception-quality-frontier-registration-script",
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

describe("Reception Room Quality fine-frontier registration preparation", () => {
  it("builds the exact ordered, internal-only runtime package payload", () => {
    const payload = buildReceptionQualityFrontierPayload();
    const expectedIds = [
      "411cee79-f698-4945-ab0f-1267e6e74c2f",
      "47d8e638-4ce1-415e-9c3c-941c91b1ac30",
      "a4d9ff60-62f7-4bee-a7de-e128778325ae",
      "24637593-577e-4507-b73c-8cd3c8e30039",
    ];

    expect(RECEPTION_QUALITY_FRONTIER_ASSETS.map((asset) => asset.fileName)).toEqual([
      "0_15_0_0.sog",
      "0_1_0_5.sog",
      "0_6_0_0.sog",
      "0_7_0_0.sog",
    ]);
    expect(payload.primaryVisualAssetVersionId).toBe(expectedIds[0]);
    expect(payload.manifestJson.assets.visualAssetVersionIds).toEqual(expectedIds);
    expect(payload.manifestJson.assets.visualAssetReceipts).toEqual(
      RECEPTION_QUALITY_FRONTIER_ASSETS.map((asset) => ({
        assetVersionId: asset.id,
        fileName: asset.fileName,
        fileExt: ".sog",
        sha256: asset.sha256,
        sizeBytes: asset.sizeBytes,
        storageKeySha256: runtimeAssetStorageKeySha256(asset.r2Key),
      })),
    );
    expect(payload.manifestJson.assets.primaryVisualAssetVersionId).toBe(expectedIds[0]);
    expect(payload.manifestJson.generatedAt).toBe(RECEPTION_QUALITY_FRONTIER_GENERATED_AT);
    expect(payload.manifestJson.compositionBasis).toEqual({
      decisionId: RECEPTION_QUALITY_FRONTIER_DECISION_ID,
      decisionRef: "docs/reports/reception-room-hd-root-investigation.md",
      hierarchySha256: RECEPTION_QUALITY_FRONTIER_HIERARCHY_SHA256,
      format: "sog",
      level: "fine",
      lodSelectionPolicy: "fixed_fine_frontier_v1",
      expectedGaussianCount: 2_002_009,
    });
    expect(payload.runtimeStatus).toBe("internal_ready");
    expect(payload.evidenceStatus).toBe("unverified");
    expect(payload.runtimeStatus).not.toBe("published");
    expect(JSON.stringify(payload)).not.toContain(PROTECTED_RECEPTION_RUNTIME_PACKAGE_ID);
  });

  it("binds the complete audited hierarchy to a real matching immutable receipt", () => {
    const decision = buildReceptionQualityFrontierDecision(validDecisionBinding());
    const hierarchyAssetIds = [
      ...decision.frontier.orderedMembers.map((asset) => asset.assetVersionId),
      ...decision.excludedAncestors.map((asset) => asset.assetVersionId),
      ...(decision.environment.disposition === "not_present"
        ? []
        : [decision.environment.asset.assetVersionId]),
    ];

    expect(RuntimeCompositionDecisionV1Schema.parse(decision)).toEqual(decision);
    expect(decision.runtimePackage).toEqual({
      runtimePackageId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      revision: 2,
      contentDigest: computeRuntimePackageRevisionDigest(
        buildReceptionQualityFrontierPayload(),
      ),
      primaryVisualAssetVersionId: RECEPTION_QUALITY_FRONTIER_ASSETS[0].id,
    });
    expect(decision.hierarchy).toEqual(expect.objectContaining({
      formatVersion: RECEPTION_QUALITY_FRONTIER_HIERARCHY_VERSION,
      sha256: RECEPTION_QUALITY_FRONTIER_HIERARCHY_SHA256,
      firstDataLevel: 1,
      highestDataLevel: 3,
    }));
    expect(decision.frontier.totals).toEqual({
      scope: "selected_room_frontier_excluding_environment",
      assetCount: 4,
      gaussianCount: 2_002_009,
      payloadBytes: 35_735_101,
    });
    expect(decision.hierarchy.allLevels).toEqual(expect.objectContaining({
      roomAssetCount: 7,
      gaussianCount: 3_491_322,
      payloadBytes: 62_704_816,
    }));
    expect(decision.frontier.orderedMembers[0]?.nodeRanges).toEqual([
      { nodePath: "0_0_0_0", start: 0, count: 3_369 },
      { nodePath: "0_10_0_0", start: 3_369, count: 42_764 },
      { nodePath: "0_11_0_0", start: 46_133, count: 92_554 },
      { nodePath: "0_12_0_0", start: 138_687, count: 55_883 },
      { nodePath: "0_12_0_1", start: 194_570, count: 103_345 },
      { nodePath: "0_12_1_0", start: 297_915, count: 62_915 },
      { nodePath: "0_13_0_0", start: 360_830, count: 59_048 },
      { nodePath: "0_14_0_0", start: 419_878, count: 41_400 },
      { nodePath: "0_15_0_0", start: 461_278, count: 141_131 },
    ]);
    expect(decision.excludedAncestors.map((asset) => asset.assetVersionId)).toEqual(
      RECEPTION_QUALITY_EXCLUDED_ANCESTOR_ASSETS.map((asset) => asset.id),
    );
    expect(decision.environment).toEqual(expect.objectContaining({
      disposition: "excluded_from_room_frontier",
      includedInRoomHierarchyTotals: false,
      asset: expect.objectContaining({
        assetVersionId: RECEPTION_QUALITY_ENVIRONMENT_ASSET.id,
        gaussianCount: 3_604,
      }),
    }));
    expect(hierarchyAssetIds).toEqual(
      RECEPTION_QUALITY_AUDITED_ASSETS.map((asset) => asset.id),
    );
    expect(hierarchyAssetIds.every((id) => !id.startsWith("00000000-"))).toBe(true);
  });

  it("rejects fake or mismatched package receipts before emitting a decision", () => {
    const fakeReceipt = validDecisionBinding();
    fakeReceipt.receipt = {
      ...fakeReceipt.receipt,
      packageId: "not-a-package-id",
    };
    expect(() => buildReceptionQualityFrontierDecision(fakeReceipt)).toThrow();

    const wrongDigest = validDecisionBinding();
    wrongDigest.receipt = {
      ...wrongDigest.receipt,
      contentDigest: "f".repeat(64),
    };
    expect(() => buildReceptionQualityFrontierDecision(wrongDigest)).toThrow(
      "receipt digest",
    );

    const wrongPackage = validDecisionBinding();
    wrongPackage.runtimePackage = {
      ...wrongPackage.runtimePackage,
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    };
    expect(() => buildReceptionQualityFrontierDecision(wrongPackage)).toThrow(
      "package ID",
    );

    const wrongPrimary = validDecisionBinding();
    wrongPrimary.runtimePackage = {
      ...wrongPrimary.runtimePackage,
      primaryVisualAssetVersionId: RECEPTION_QUALITY_FRONTIER_ASSETS[1].id,
    };
    expect(() => buildReceptionQualityFrontierDecision(wrongPrimary)).toThrow(
      "primary visual asset",
    );
  });

  it("rejects tampered totals and ancestry in a formerly valid decision", () => {
    const wrongTotals = structuredClone(
      buildReceptionQualityFrontierDecision(validDecisionBinding()),
    );
    wrongTotals.frontier.totals.gaussianCount += 1;
    expect(RuntimeCompositionDecisionV1Schema.safeParse(wrongTotals).success).toBe(false);

    const wrongAncestry = structuredClone(
      buildReceptionQualityFrontierDecision(validDecisionBinding()),
    );
    const firstRange = wrongAncestry.frontier.orderedMembers[0]?.nodeRanges[0];
    if (firstRange === undefined) throw new Error("Test decision requires a first node range.");
    firstRange.nodePath = "0_99_0_0";
    expect(RuntimeCompositionDecisionV1Schema.safeParse(wrongAncestry).success).toBe(false);
  });

  it("validates local checked-in files against the audited bytes and SHA-256 values", async () => {
    const inspections = await inspectReceptionQualityFrontierFiles();

    expect(inspections).toHaveLength(8);
    expect(inspections.every((inspection) => inspection.error === null)).toBe(true);
    expect(inspections.map(({ fileName, sizeBytes, sha256 }) => ({ fileName, sizeBytes, sha256 }))).toEqual(
      RECEPTION_QUALITY_AUDITED_ASSETS.map(({ fileName, sizeBytes, sha256 }) => ({
        fileName,
        sizeBytes,
        sha256,
      })),
    );
  });

  it("reports a fully validated payload when DB rows and local files match", async () => {
    const report = await prepareReceptionQualityFrontier({
      store: readStore([...validAssetRows()].reverse()),
      inspectLocalFiles: () => Promise.resolve(validLocalInspections()),
    });

    expect(report.preflightStatus).toBe("validated_payload");
    expect(report.validations.every((validation) => validation.status === "passed")).toBe(true);
    expect(report.existingMatchingCompositionId).toBeNull();
    expect(report.apply).toEqual(expect.objectContaining({
      databaseReady: true,
      databaseBlocker: null,
      databaseContract: expect.objectContaining({ ready: true }),
      endpointDeploymentVerified: false,
      endpoint: RUNTIME_PACKAGE_REVISION_ENDPOINT,
      requested: false,
      receipt: null,
      decision: null,
    }));
    expect(report.expectedContentDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(report.databaseAssets.map((asset) => asset.id)).toEqual(
      RECEPTION_QUALITY_AUDITED_ASSETS.map((asset) => asset.id),
    );
  });

  it("keeps a valid payload read-only when migration 0052 is missing", async () => {
    const store = readStore(validAssetRows(), [], {
      columns: [],
      constraints: [],
      triggers: [],
    });
    const report = await prepareReceptionQualityFrontier({
      store,
      inspectLocalFiles: () => Promise.resolve(validLocalInspections()),
    });

    expect(report.preflightStatus).toBe("validated_payload");
    expect(report.apply.databaseReady).toBe(false);
    expect(report.apply.databaseBlocker).toContain("migration 0052");

    const createRevision = vi.fn(() => Promise.resolve(validCreateResponse()));
    await expect(runReceptionQualityFrontier({
      args: ["--apply"],
      store,
      inspectLocalFiles: () => Promise.resolve(validLocalInspections()),
      createRevision,
    })).rejects.toThrow("migration 0052");
    expect(createRevision).not.toHaveBeenCalled();
  });

  it("treats visual composition order as part of the revision identity", async () => {
    const payload = buildReceptionQualityFrontierPayload();
    const visualAssetVersionIds = payload.manifestJson.assets.visualAssetVersionIds;
    if (visualAssetVersionIds === undefined) throw new Error("Test payload requires explicit visual asset ids.");
    const existing: ReceptionFrontierRuntimePackageRecord = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      venueSlug: payload.venueSlug,
      roomSlug: payload.roomSlug,
      primaryVisualAssetVersionId: payload.primaryVisualAssetVersionId ?? null,
      semanticMeshAssetVersionId: null,
      collisionAssetVersionId: null,
      pointCloudAssetVersionId: null,
      manifestJson: {
        ...payload.manifestJson,
        assets: {
          ...payload.manifestJson.assets,
          visualAssetVersionIds: [...visualAssetVersionIds].reverse(),
        },
      },
    };

    const report = await prepareReceptionQualityFrontier({
      store: readStore(validAssetRows(), [existing]),
      inspectLocalFiles: () => Promise.resolve(validLocalInspections()),
    });

    expect(report.preflightStatus).toBe("validated_payload");
    expect(report.existingMatchingCompositionId).toBeNull();
  });

  it.each([
    ["wrong room", { roomSlug: "grand-hall" }],
    ["wrong capture", { captureSessionId: "11111111-1111-4111-8111-111111111111" }],
    ["wrong filename", { fileName: "0_0.sog" }],
    ["wrong hash", { sha256: "0".repeat(64) }],
    ["wrong byte count", { sizeBytes: 1 }],
    ["wrong asset kind", { assetKind: "mesh" }],
    ["wrong file extension", { fileExt: ".spz" }],
    ["non-usable runtime status", { runtimeStatus: "staged" }],
    ["rejected evidence", { evidenceStatus: "rejected" }],
  ] as const)("fails DB validation for %s", async (_label, change) => {
    const [first, ...rest] = validAssetRows();
    if (first === undefined) throw new Error("Test fixture requires a first asset.");
    const changed = { ...first, ...change } as ReceptionFrontierAssetRecord;

    const report = await prepareReceptionQualityFrontier({
      store: readStore([changed, ...rest]),
      inspectLocalFiles: () => Promise.resolve(validLocalInspections()),
    });

    expect(report.preflightStatus).toBe("validation_failed");
    expect(report.validations.some((validation) => validation.status === "failed")).toBe(true);
  });

  it("fails closed when an expected asset row is missing", async () => {
    const report = await prepareReceptionQualityFrontier({
      store: readStore(validAssetRows().slice(1)),
      inspectLocalFiles: () => Promise.resolve(validLocalInspections()),
    });

    expect(report.preflightStatus).toBe("validation_failed");
    expect(report.validations).toContainEqual(expect.objectContaining({
      name: "database asset 0_15_0_0.sog",
      status: "failed",
    }));
  });

  it("fails closed when a checked-in file does not match its audited hash", async () => {
    const local = validLocalInspections();
    const first = local[0];
    if (first === undefined) throw new Error("Test fixture requires a first local inspection.");

    const report = await prepareReceptionQualityFrontier({
      store: readStore(),
      inspectLocalFiles: () => Promise.resolve([{ ...first, sha256: "0".repeat(64) }, ...local.slice(1)]),
    });

    expect(report.preflightStatus).toBe("validation_failed");
    expect(report.validations).toContainEqual(expect.objectContaining({
      name: "local file 0_15_0_0.sog",
      status: "failed",
    }));
  });

  it("reports a matching composition but leaves full-digest idempotency to the create API", async () => {
    const payload = buildReceptionQualityFrontierPayload();
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

    const report = await prepareReceptionQualityFrontier({
      store: readStore(validAssetRows(), [existing]),
      inspectLocalFiles: () => Promise.resolve(validLocalInspections()),
    });

    expect(report.preflightStatus).toBe("validated_payload");
    expect(report.existingMatchingCompositionId).toBe(existing.id);
    expect(report.validations).toContainEqual(expect.objectContaining({
      name: "existing ordered composition",
      status: "passed",
    }));
  });

  it("does not treat the protected legacy package as identical unless its ordered manifest is identical", async () => {
    const legacy: ReceptionFrontierRuntimePackageRecord = {
      id: PROTECTED_RECEPTION_RUNTIME_PACKAGE_ID,
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      primaryVisualAssetVersionId: "99999999-9999-4999-8999-999999999999",
      semanticMeshAssetVersionId: null,
      collisionAssetVersionId: null,
      pointCloudAssetVersionId: null,
      manifestJson: {
        schemaVersion: "venviewer.runtime-package.v1",
        venueSlug: "trades-hall",
        roomSlug: "reception-room",
        packageType: "room-runtime",
        assets: {
          primaryVisualAssetVersionId: "99999999-9999-4999-8999-999999999999",
          semanticMeshAssetVersionId: null,
          collisionAssetVersionId: null,
          pointCloudAssetVersionId: null,
        },
      },
    };

    const report = await prepareReceptionQualityFrontier({
      store: readStore(validAssetRows(), [legacy]),
      inspectLocalFiles: () => Promise.resolve(validLocalInspections()),
    });

    expect(report.preflightStatus).toBe("validated_payload");
    expect(report.protectedPackageId).toBe(PROTECTED_RECEPTION_RUNTIME_PACKAGE_ID);
  });

  it("defaults to dry-run and rejects unknown or ambiguous CLI arguments", () => {
    expect(parseReceptionQualityFrontierArgs([])).toEqual({
      applyRequested: false,
      assetDirectory: undefined,
    });
    expect(parseReceptionQualityFrontierArgs(["--apply"])).toEqual({
      applyRequested: true,
      assetDirectory: undefined,
    });
    expect(parseReceptionQualityFrontierArgs(["--asset-dir", "C:/assets"])).toEqual({
      applyRequested: false,
      assetDirectory: "C:/assets",
    });
    expect(() => parseReceptionQualityFrontierArgs(["--unknown"])).toThrow("Unknown argument");
    expect(() => parseReceptionQualityFrontierArgs(["--apply", "--apply"])).toThrow("only be supplied once");
  });

  it("will not send an administrator token to an unsafe API origin", () => {
    expect(() => createReceptionQualityFrontierApiClient({
      RUNTIME_PACKAGE_API_ORIGIN: "http://api.example.com",
      RUNTIME_PACKAGE_ADMIN_TOKEN: "secret-token",
    })).toThrow("must use HTTPS");
    expect(() => createReceptionQualityFrontierApiClient({
      RUNTIME_PACKAGE_API_ORIGIN: "https://api.example.com/unexpected-path",
      RUNTIME_PACKAGE_ADMIN_TOKEN: "secret-token",
    })).toThrow("clean origin");
    expect(() => createReceptionQualityFrontierApiClient({
      RUNTIME_PACKAGE_API_ORIGIN: "http://127.0.0.1:3000",
      RUNTIME_PACKAGE_ADMIN_TOKEN: "secret-token",
    })).not.toThrow();
  });

  it("fails closed when --apply has no authenticated API client", async () => {
    await expect(runReceptionQualityFrontier({
      args: ["--apply"],
      store: readStore(),
      inspectLocalFiles: () => Promise.resolve(validLocalInspections()),
    })).rejects.toThrow("requires an authenticated immutable revision API client");
  });

  it("sends the exact payload to the create-only API and reports its real receipt", async () => {
    const lines: string[] = [];
    const payload = buildReceptionQualityFrontierPayload();
    const response = validCreateResponse();
    const createRevision = vi.fn(() => Promise.resolve(response));

    const report = await runReceptionQualityFrontier({
      args: ["--apply"],
      store: readStore(),
      inspectLocalFiles: () => Promise.resolve(validLocalInspections()),
      createRevision,
      log: (line) => lines.push(line),
      now: () => new Date("2026-07-13T12:06:00.000Z"),
    });

    expect(createRevision).toHaveBeenCalledWith({ package: payload });
    expect(report.apply.receipt).toEqual(response.receipt);
    expect(report.apply.decision).toEqual(expect.objectContaining({
      schemaVersion: "runtime-composition-decision.v1",
      runtimePackage: expect.objectContaining({
        runtimePackageId: response.receipt.packageId,
        revision: response.receipt.revision,
        contentDigest: response.receipt.contentDigest,
      }),
      decidedAt: "2026-07-13T12:06:00.000Z",
    }));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "null")).toEqual(expect.objectContaining({
      preflightStatus: "validated_payload",
      apply: expect.objectContaining({
        databaseReady: true,
        endpointDeploymentVerified: true,
        requested: true,
        receipt: expect.objectContaining({
          packageId: response.receipt.packageId,
          revision: 2,
        }),
        decision: expect.objectContaining({
          decision: "serve_reviewed_fixed_frontier",
          frontier: expect.objectContaining({
            totals: expect.objectContaining({ gaussianCount: 2_002_009 }),
          }),
        }),
      }),
    }));
  });

  it("contains no database write primitive and cannot mutate the protected package", async () => {
    const source = await readFile(scriptPath, "utf8");

    expect(source).not.toMatch(/\bdb\s*\.\s*(?:insert|update|delete)\s*\(/u);
    expect(source).not.toContain(".set({");
    expect(source).not.toContain("register-runtime-package");
    expect(source).toContain("RUNTIME_PACKAGE_REVISION_ENDPOINT");
  });
});
