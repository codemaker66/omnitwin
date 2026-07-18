/**
 * Prepare the audited Reception Room Quality LCC2 fine-frontier composition.
 *
 * Its default mode is deliberately read-only. It reads the four
 * registered asset rows, hashes the matching checked-in files, and prints the
 * exact runtime-package payload plus plain validation results. `--apply` runs
 * the same preflight and then calls the authenticated create-only revision API.
 * This script never inserts, updates, or deletes a runtime package directly.
 *
 * Run from packages/api:
 *   node --env-file=.env --import tsx src/scripts/register-reception-room-quality-frontier.ts
 *
 * Optional checked-in asset location:
 *   ... register-reception-room-quality-frontier.ts --asset-dir C:\path\to\reception
 *
 * `--apply` requires RUNTIME_PACKAGE_API_ORIGIN and
 * RUNTIME_PACKAGE_ADMIN_TOKEN. Do not run it without operator approval.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  RUNTIME_COMPOSITION_DECISION_V1_SCHEMA_VERSION,
  RuntimeCompositionDecisionV1Schema,
  RuntimePackageRevisionReceiptSchema,
  RuntimePackageRevisionCreateResponseSchema,
  RegisterRuntimePackageInputSchema,
  RuntimePackageManifestJsonSchema,
  type CreateRuntimePackageRevisionInput,
  type RegisterRuntimePackageInput,
  type RuntimeCompositionDecisionV1,
  type RuntimeHierarchyNodeRangeV1,
  type RuntimePackage,
  type RuntimePackageRevisionCreateResponse,
  type RuntimePackageRevisionReceipt,
} from "@omnitwin/types";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb, type Database } from "../db/client.js";
import { assetVersions, runtimePackages } from "../db/schema.js";
import { runtimeAssetStorageKeySha256 } from "../lib/runtime-asset-receipt.js";
import { computeRuntimePackageRevisionDigest } from "../services/runtime-package-revisions.js";

const VENUE_SLUG = "trades-hall";
const ROOM_SLUG = "reception-room";

export const EXPECTED_RECEPTION_CAPTURE_SESSION_ID = "a7225d50-0403-46ac-8490-ecc78f6450e7";
export const PROTECTED_RECEPTION_RUNTIME_PACKAGE_ID = "71687e9e-c23d-4f51-b3dd-a6a82c97978d";
export const RECEPTION_QUALITY_FRONTIER_GENERATED_AT = "2026-07-13T12:00:00.000Z";
export const RECEPTION_QUALITY_FRONTIER_DECISION_ID =
  "reception-room-quality-fixed-fine-frontier-v1";
export const RECEPTION_QUALITY_FRONTIER_HIERARCHY_SHA256 =
  "f0a4c782cc0f031830404d409f5c0accdc30ed501fa562169206962ceee64f3e";
export const RECEPTION_QUALITY_FRONTIER_HIERARCHY_VERSION = "0.0.3";
export const RUNTIME_PACKAGE_REVISION_ENDPOINT = "/admin/assets/runtime-package-revisions";

export const REQUIRED_RUNTIME_PACKAGE_REVISION_COLUMNS = [
  "revision",
  "identity_kind",
  "content_digest",
] as const;
export const REQUIRED_RUNTIME_PACKAGE_REVISION_CONSTRAINTS = [
  "runtime_packages_revision_positive",
  "runtime_packages_identity_coherent",
  "runtime_packages_venue_room_revision_unique",
  "runtime_packages_venue_room_digest_unique",
] as const;
export const REQUIRED_RUNTIME_PACKAGE_REVISION_TRIGGERS = [
  "runtime_packages_revision_monotonic",
  "runtime_packages_no_update",
  "runtime_packages_no_delete",
  "runtime_packages_no_truncate",
] as const;

type ReceptionQualityNodeRangeSeed = readonly [nodePath: string, count: number];

function contiguousNodeRanges(
  seeds: readonly ReceptionQualityNodeRangeSeed[],
): readonly RuntimeHierarchyNodeRangeV1[] {
  let start = 0;
  return seeds.map(([nodePath, count]) => {
    const range = { nodePath, start, count };
    start += count;
    return range;
  });
}

export interface ReceptionQualityAssetSpec {
  readonly id: string;
  readonly fileName: string;
  readonly r2Key: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly gaussianCount: number;
}

export interface ReceptionQualityHierarchyAssetSpec
  extends ReceptionQualityAssetSpec {
  readonly hierarchyLevel: number;
  readonly nodeRanges: readonly RuntimeHierarchyNodeRangeV1[];
}

export const RECEPTION_QUALITY_FRONTIER_ASSETS = [
  {
    id: "411cee79-f698-4945-ab0f-1267e6e74c2f",
    fileName: "0_15_0_0.sog",
    r2Key: "venues/trades-hall/rooms/reception-room/xgrids/2026-06-08/lcc2-result/data/3dgs/0_15_0_0.sog",
    sha256: "111a47f7470fc83d1dc7f0bf2e1d3aa96943dd5a453005b840597e8c491d2368",
    sizeBytes: 10_279_160,
    gaussianCount: 602_409,
    hierarchyLevel: 3,
    nodeRanges: contiguousNodeRanges([
      ["0_0_0_0", 3_369],
      ["0_10_0_0", 42_764],
      ["0_11_0_0", 92_554],
      ["0_12_0_0", 55_883],
      ["0_12_0_1", 103_345],
      ["0_12_1_0", 62_915],
      ["0_13_0_0", 59_048],
      ["0_14_0_0", 41_400],
      ["0_15_0_0", 141_131],
    ]),
  },
  {
    id: "47d8e638-4ce1-415e-9c3c-941c91b1ac30",
    fileName: "0_1_0_5.sog",
    r2Key: "venues/trades-hall/rooms/reception-room/xgrids/2026-06-08/lcc2-result/data/3dgs/0_1_0_5.sog",
    sha256: "559dd375950966f8d1aa088a391b7105e364abc5013e7d29ea573728ab208fe1",
    sizeBytes: 10_047_085,
    gaussianCount: 577_816,
    hierarchyLevel: 3,
    nodeRanges: contiguousNodeRanges([
      ["0_15_0_1", 34_023],
      ["0_16_0_0", 98_036],
      ["0_17_0_0", 82_831],
      ["0_18_0_0", 120_561],
      ["0_19_0_0", 20_922],
      ["0_1_0_0", 4_304],
      ["0_1_0_1", 34],
      ["0_1_0_2", 51],
      ["0_1_0_3", 9_170],
      ["0_1_0_4", 86_194],
      ["0_1_0_5", 121_690],
    ]),
  },
  {
    id: "a4d9ff60-62f7-4bee-a7de-e128778325ae",
    fileName: "0_6_0_0.sog",
    r2Key: "venues/trades-hall/rooms/reception-room/xgrids/2026-06-08/lcc2-result/data/3dgs/0_6_0_0.sog",
    sha256: "182525354cd14fa6bc8f6a54c0cbe0e39b5d5c216dd27e2cc4d44d1458ba8238",
    sizeBytes: 10_368_228,
    gaussianCount: 599_740,
    hierarchyLevel: 3,
    nodeRanges: contiguousNodeRanges([
      ["0_20_0_0", 114_797],
      ["0_20_1_0", 117_198],
      ["0_2_0_0", 107_591],
      ["0_3_0_0", 276],
      ["0_4_0_0", 138],
      ["0_5_0_0", 120_119],
      ["0_6_0_0", 139_621],
    ]),
  },
  {
    id: "24637593-577e-4507-b73c-8cd3c8e30039",
    fileName: "0_7_0_0.sog",
    r2Key: "venues/trades-hall/rooms/reception-room/xgrids/2026-06-08/lcc2-result/data/3dgs/0_7_0_0.sog",
    sha256: "3b68d24538523a559730e14d5ed1733f67d9894354e26322e20cf5f4458ccebf",
    sizeBytes: 5_040_628,
    gaussianCount: 222_044,
    hierarchyLevel: 3,
    nodeRanges: contiguousNodeRanges([
      ["0_7_0_0", 143_741],
      ["0_8_0_0", 11_250],
      ["0_9_0_0", 67_053],
    ]),
  },
] as const satisfies readonly ReceptionQualityHierarchyAssetSpec[];

/**
 * These UUIDs were resolved by a read-only lookup against the registered
 * Reception capture on 2026-07-13, then pinned to the already-audited hashes,
 * sizes and object-store keys. They are replacement levels, never runtime
 * members of the fixed frontier.
 */
export const RECEPTION_QUALITY_EXCLUDED_ANCESTOR_ASSETS = [
  {
    id: "63b95174-4ae7-4522-80eb-f48ce7d7a7a6",
    fileName: "0_0.sog",
    r2Key: "venues/trades-hall/rooms/reception-room/xgrids/2026-06-08/lcc2-result/data/3dgs/0_0.sog",
    sha256: "0a5b8c21327be7c747087baab237d1907e0a0277b0d019300e0d6b2e7eba0a16",
    sizeBytes: 9_017_864,
    gaussianCount: 496_034,
    hierarchyLevel: 1,
    nodeRanges: contiguousNodeRanges([
      ["0_0", 268],
      ["0_1", 42_237],
      ["0_10", 9_824],
      ["0_11", 23_459],
      ["0_12", 49_775],
      ["0_13", 18_000],
      ["0_14", 12_940],
      ["0_15", 43_666],
      ["0_16", 20_969],
      ["0_17", 24_747],
      ["0_18", 27_562],
      ["0_19", 3_761],
      ["0_2", 36_733],
      ["0_20", 47_720],
      ["0_3", 72],
      ["0_4", 33],
      ["0_5", 39_605],
      ["0_6", 31_971],
      ["0_7", 34_859],
      ["0_8", 2_276],
      ["0_9", 25_557],
    ]),
  },
  {
    id: "7b9bdc4d-86b5-4083-9d91-1a0a8ed943fe",
    fileName: "0_1_0.sog",
    r2Key: "venues/trades-hall/rooms/reception-room/xgrids/2026-06-08/lcc2-result/data/3dgs/0_1_0.sog",
    sha256: "08c928b2556e2ba38cdf1777c806bb6b7ece249d5e7c442d20c0232ca703005c",
    sizeBytes: 9_845_814,
    gaussianCount: 561_053,
    hierarchyLevel: 2,
    nodeRanges: contiguousNodeRanges([
      ["0_0_0", 645],
      ["0_10_0", 21_274],
      ["0_11_0", 45_337],
      ["0_12_0", 72_241],
      ["0_12_1", 30_419],
      ["0_13_0", 32_977],
      ["0_14_0", 23_922],
      ["0_15_0", 93_642],
      ["0_16_0", 42_000],
      ["0_17_0", 44_558],
      ["0_18_0", 57_290],
      ["0_19_0", 8_704],
      ["0_1_0", 88_044],
    ]),
  },
  {
    id: "3b3180a5-9602-4ddc-be23-b539d8a8b937",
    fileName: "0_20_0.sog",
    r2Key: "venues/trades-hall/rooms/reception-room/xgrids/2026-06-08/lcc2-result/data/3dgs/0_20_0.sog",
    sha256: "72664ef164df58e88e018ab455f67de8c985de4e5f799fc6b45041aa804af2e4",
    sizeBytes: 8_106_037,
    gaussianCount: 432_226,
    hierarchyLevel: 2,
    nodeRanges: contiguousNodeRanges([
      ["0_20_0", 53_374],
      ["0_20_1", 48_466],
      ["0_2_0", 68_837],
      ["0_3_0", 109],
      ["0_4_0", 76],
      ["0_5_0", 72_217],
      ["0_6_0", 64_741],
      ["0_7_0", 74_279],
      ["0_8_0", 4_386],
      ["0_9_0", 45_741],
    ]),
  },
] as const satisfies readonly ReceptionQualityHierarchyAssetSpec[];

export const RECEPTION_QUALITY_ENVIRONMENT_ASSET = {
  id: "c727915e-d9cd-4a37-953f-67c23532b1c5",
  fileName: "env.sog",
  r2Key: "venues/trades-hall/rooms/reception-room/xgrids/2026-06-08/lcc2-result/data/3dgs/env.sog",
  sha256: "1b6927a6d883634d93cc59294c77f2acc02b55da1092bdd6bd637765e8b3f7f8",
  sizeBytes: 129_565,
  gaussianCount: 3_604,
} as const satisfies ReceptionQualityAssetSpec;

export const RECEPTION_QUALITY_AUDITED_ASSETS = [
  ...RECEPTION_QUALITY_FRONTIER_ASSETS,
  ...RECEPTION_QUALITY_EXCLUDED_ANCESTOR_ASSETS,
  RECEPTION_QUALITY_ENVIRONMENT_ASSET,
] as const satisfies readonly ReceptionQualityAssetSpec[];

const DEFAULT_RECEPTION_ASSET_DIRECTORY = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
  "packages",
  "web",
  "public",
  "splats",
  "reception",
);

export interface ReceptionFrontierAssetRecord {
  readonly id: string;
  readonly venueSlug: string;
  readonly roomSlug: string | null;
  readonly captureSessionId: string | null;
  readonly assetKind: string;
  readonly sourceType: string;
  readonly fileName: string;
  readonly fileExt: string;
  readonly r2Key: string | null;
  readonly sha256: string | null;
  readonly sizeBytes: number | null;
  readonly evidenceStatus: string;
  readonly runtimeStatus: string;
}

export interface ReceptionFrontierRuntimePackageRecord {
  readonly id: string;
  readonly venueSlug: string;
  readonly roomSlug: string;
  readonly primaryVisualAssetVersionId: string | null;
  readonly semanticMeshAssetVersionId: string | null;
  readonly collisionAssetVersionId: string | null;
  readonly pointCloudAssetVersionId: string | null;
  readonly manifestJson: unknown;
}

export interface ReceptionRuntimePackageRevisionContractEvidence {
  readonly columns: readonly string[];
  readonly constraints: readonly string[];
  readonly triggers: readonly string[];
}

export interface ReceptionRuntimePackageRevisionContractReadiness
  extends ReceptionRuntimePackageRevisionContractEvidence {
  readonly ready: boolean;
  readonly missingColumns: readonly string[];
  readonly missingConstraints: readonly string[];
  readonly missingTriggers: readonly string[];
}

export interface ReceptionQualityFrontierReadStore {
  readonly readAssetVersions: (
    ids: readonly string[],
  ) => Promise<readonly ReceptionFrontierAssetRecord[]>;
  readonly readRuntimePackages: (
    venueSlug: string,
    roomSlug: string,
  ) => Promise<readonly ReceptionFrontierRuntimePackageRecord[]>;
  readonly readRuntimePackageRevisionContract: () =>
    Promise<ReceptionRuntimePackageRevisionContractEvidence>;
}

export interface ReceptionFrontierLocalInspection {
  readonly id: string;
  readonly fileName: string;
  readonly absolutePath: string;
  readonly sha256: string | null;
  readonly sizeBytes: number | null;
  readonly error: string | null;
}

export interface ReceptionFrontierValidation {
  readonly name: string;
  readonly status: "passed" | "failed";
  readonly detail: string;
}

export interface ReceptionQualityFrontierReport {
  readonly schemaVersion: "venviewer.reception-quality-frontier-preflight.v1";
  readonly generatedAt: string;
  readonly requestedMode: "dry_run" | "apply";
  readonly preflightStatus: "validated_payload" | "validation_failed";
  readonly payload: RegisterRuntimePackageInput;
  readonly expectedContentDigest: string;
  readonly assetDirectory: string;
  readonly localAssets: readonly ReceptionFrontierLocalInspection[];
  readonly databaseAssets: readonly ReceptionFrontierAssetRecord[];
  readonly validations: readonly ReceptionFrontierValidation[];
  readonly existingMatchingCompositionId: string | null;
  readonly protectedPackageId: string;
  readonly apply: {
    readonly databaseReady: boolean;
    readonly databaseBlocker: string | null;
    readonly databaseContract: ReceptionRuntimePackageRevisionContractReadiness;
    readonly endpointDeploymentVerified: boolean;
    readonly endpoint: typeof RUNTIME_PACKAGE_REVISION_ENDPOINT;
    readonly requested: boolean;
    readonly receipt: RuntimePackageRevisionReceipt | null;
    readonly decision: RuntimeCompositionDecisionV1 | null;
  };
}

interface PrepareReceptionQualityFrontierOptions {
  readonly store: ReceptionQualityFrontierReadStore;
  readonly applyRequested?: boolean;
  readonly assetDirectory?: string;
  readonly inspectLocalFiles?: (
    assetDirectory?: string,
  ) => Promise<readonly ReceptionFrontierLocalInspection[]>;
}

interface RunReceptionQualityFrontierOptions extends PrepareReceptionQualityFrontierOptions {
  readonly args: readonly string[];
  readonly createRevision?: (
    input: CreateRuntimePackageRevisionInput,
  ) => Promise<RuntimePackageRevisionCreateResponse>;
  readonly log?: (line: string) => void;
  readonly now?: () => Date;
}

export interface ReceptionQualityFrontierDecisionBinding {
  readonly receipt: RuntimePackageRevisionReceipt;
  readonly runtimePackage: RuntimePackage;
  readonly decidedAt: string;
  readonly decidedBy: string;
}

export interface ReceptionQualityFrontierArgs {
  readonly applyRequested: boolean;
  readonly assetDirectory: string | undefined;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function mismatch(label: string, expected: string | number, actual: string | number | null): string | null {
  return actual === expected ? null : `${label}: expected ${String(expected)}, received ${String(actual)}`;
}

function validation(name: string, errors: readonly string[], successDetail: string): ReceptionFrontierValidation {
  return errors.length === 0
    ? { name, status: "passed", detail: successDetail }
    : { name, status: "failed", detail: errors.join("; ") };
}

export function buildReceptionQualityFrontierPayload(): RegisterRuntimePackageInput {
  const ids = RECEPTION_QUALITY_FRONTIER_ASSETS.map((asset) => asset.id);
  const primaryVisualAssetVersionId = ids[0];
  if (primaryVisualAssetVersionId === undefined) {
    throw new Error("Reception Quality fine-frontier specification has no primary asset.");
  }

  return RegisterRuntimePackageInputSchema.parse({
    venueSlug: VENUE_SLUG,
    roomSlug: ROOM_SLUG,
    primaryVisualAssetVersionId,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: VENUE_SLUG,
      roomSlug: ROOM_SLUG,
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId,
        visualAssetVersionIds: ids,
        visualAssetReceipts: RECEPTION_QUALITY_FRONTIER_ASSETS.map((asset) => ({
          assetVersionId: asset.id,
          fileName: asset.fileName,
          fileExt: ".sog" as const,
          sha256: asset.sha256,
          sizeBytes: asset.sizeBytes,
          storageKeySha256: runtimeAssetStorageKeySha256(asset.r2Key),
        })),
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
      compositionBasis: {
        decisionId: RECEPTION_QUALITY_FRONTIER_DECISION_ID,
        decisionRef: "docs/reports/reception-room-hd-root-investigation.md",
        hierarchySha256: RECEPTION_QUALITY_FRONTIER_HIERARCHY_SHA256,
        format: "sog",
        level: "fine",
        lodSelectionPolicy: "fixed_fine_frontier_v1",
        expectedGaussianCount: 2_002_009,
      },
      generatedAt: RECEPTION_QUALITY_FRONTIER_GENERATED_AT,
      notes: "Internal-only Reception Quality LCC2 fine-frontier composition using four audited leaf SOG assets in declared order. Unverified: signed alignment, metric authority, visual QA, and exposure review remain separate gates.",
    },
    evidenceStatus: "unverified",
    runtimeStatus: "internal_ready",
  });
}

function runtimePackageInputFromApiResponse(
  runtimePackage: RuntimePackage,
): RegisterRuntimePackageInput {
  return RegisterRuntimePackageInputSchema.parse({
    venueSlug: runtimePackage.venueSlug,
    roomSlug: runtimePackage.roomSlug,
    primaryVisualAssetVersionId: runtimePackage.primaryVisualAssetVersionId,
    semanticMeshAssetVersionId: runtimePackage.semanticMeshAssetVersionId,
    collisionAssetVersionId: runtimePackage.collisionAssetVersionId,
    pointCloudAssetVersionId: runtimePackage.pointCloudAssetVersionId,
    manifestJson: runtimePackage.manifestJson,
    evidenceStatus: runtimePackage.evidenceStatus,
    runtimeStatus: runtimePackage.runtimeStatus,
  });
}

function requireEqualBinding(
  label: string,
  actual: string | null | undefined,
  expected: string | null | undefined,
): void {
  if (actual !== expected) {
    throw new Error(
      `Cannot bind the Reception frontier decision: ${label} does not match the validated package receipt.`,
    );
  }
}

function sumAuditedAssetField(
  assets: readonly ReceptionQualityAssetSpec[],
  field: "gaussianCount" | "sizeBytes",
): number {
  return assets.reduce((total, asset) => total + asset[field], 0);
}

/**
 * Creates the decision only after the immutable API has returned a matching
 * receipt and package. The package digest is computed before this decision
 * exists, so the binding cannot create a circular manifest hash.
 */
export function buildReceptionQualityFrontierDecision(
  binding: ReceptionQualityFrontierDecisionBinding,
): RuntimeCompositionDecisionV1 {
  const receipt = RuntimePackageRevisionReceiptSchema.parse(binding.receipt);
  const expectedPackage = buildReceptionQualityFrontierPayload();
  const expectedDigest = computeRuntimePackageRevisionDigest(expectedPackage);
  const expectedPrimary = expectedPackage.primaryVisualAssetVersionId;
  const runtimePackage = binding.runtimePackage;

  requireEqualBinding("package ID", runtimePackage.id, receipt.packageId);
  requireEqualBinding("venue", runtimePackage.venueSlug, expectedPackage.venueSlug);
  requireEqualBinding("room", runtimePackage.roomSlug, expectedPackage.roomSlug);
  requireEqualBinding(
    "primary visual asset",
    runtimePackage.primaryVisualAssetVersionId,
    expectedPrimary,
  );
  requireEqualBinding(
    "manifest primary visual asset",
    runtimePackage.manifestJson.assets.primaryVisualAssetVersionId,
    expectedPrimary,
  );

  const expectedVisualIds = expectedPackage.manifestJson.assets.visualAssetVersionIds;
  const actualVisualIds = runtimePackage.manifestJson.assets.visualAssetVersionIds;
  if (
    expectedVisualIds === undefined ||
    actualVisualIds === undefined ||
    !arraysEqual(actualVisualIds, expectedVisualIds)
  ) {
    throw new Error(
      "Cannot bind the Reception frontier decision: ordered visual asset IDs do not match the validated package receipt.",
    );
  }

  const responseDigest = computeRuntimePackageRevisionDigest(
    runtimePackageInputFromApiResponse(runtimePackage),
  );
  requireEqualBinding("receipt digest", receipt.contentDigest, expectedDigest);
  requireEqualBinding("returned package digest", responseDigest, expectedDigest);

  const frontierGaussianCount = sumAuditedAssetField(
    RECEPTION_QUALITY_FRONTIER_ASSETS,
    "gaussianCount",
  );
  const frontierPayloadBytes = sumAuditedAssetField(
    RECEPTION_QUALITY_FRONTIER_ASSETS,
    "sizeBytes",
  );
  const allRoomAssets = [
    ...RECEPTION_QUALITY_FRONTIER_ASSETS,
    ...RECEPTION_QUALITY_EXCLUDED_ANCESTOR_ASSETS,
  ];

  return RuntimeCompositionDecisionV1Schema.parse({
    schemaVersion: RUNTIME_COMPOSITION_DECISION_V1_SCHEMA_VERSION,
    decisionId: RECEPTION_QUALITY_FRONTIER_DECISION_ID,
    venueSlug: VENUE_SLUG,
    roomSlug: ROOM_SLUG,
    runtimePackage: {
      runtimePackageId: receipt.packageId,
      revision: receipt.revision,
      contentDigest: receipt.contentDigest,
      primaryVisualAssetVersionId: expectedPrimary,
    },
    decidedAt: binding.decidedAt,
    decidedBy: binding.decidedBy,
    decision: "serve_reviewed_fixed_frontier",
    hierarchy: {
      format: "lcc2",
      fileName: "Reception Room.lcc2",
      formatVersion: RECEPTION_QUALITY_FRONTIER_HIERARCHY_VERSION,
      sha256: RECEPTION_QUALITY_FRONTIER_HIERARCHY_SHA256,
      firstDataLevel: 1,
      highestDataLevel: 3,
      allLevels: {
        scope: "all_room_hierarchy_levels_excluding_environment",
        roomAssetCount: allRoomAssets.length,
        gaussianCount: sumAuditedAssetField(allRoomAssets, "gaussianCount"),
        payloadBytes: sumAuditedAssetField(allRoomAssets, "sizeBytes"),
        levelTotals: [
          {
            level: 1,
            assetCount: 1,
            gaussianCount: 496_034,
            payloadBytes: 9_017_864,
          },
          {
            level: 2,
            assetCount: 2,
            gaussianCount: 993_279,
            payloadBytes: 17_951_851,
          },
          {
            level: 3,
            assetCount: RECEPTION_QUALITY_FRONTIER_ASSETS.length,
            gaussianCount: frontierGaussianCount,
            payloadBytes: frontierPayloadBytes,
          },
        ],
      },
    },
    frontier: {
      strategy: "fixed_non_overlapping_frontier",
      format: "sog",
      selectedLevel: 3,
      totals: {
        scope: "selected_room_frontier_excluding_environment",
        assetCount: RECEPTION_QUALITY_FRONTIER_ASSETS.length,
        gaussianCount: frontierGaussianCount,
        payloadBytes: frontierPayloadBytes,
      },
      orderedMembers: RECEPTION_QUALITY_FRONTIER_ASSETS.map((asset, order) => ({
        order,
        role: "frontier_member" as const,
        assetVersionId: asset.id,
        fileName: asset.fileName,
        sha256: asset.sha256,
        sizeBytes: asset.sizeBytes,
        gaussianCount: asset.gaussianCount,
        sourceHierarchySha256: RECEPTION_QUALITY_FRONTIER_HIERARCHY_SHA256,
        hierarchyLevel: asset.hierarchyLevel,
        nodeRanges: asset.nodeRanges.map((range) => ({ ...range })),
      })),
    },
    excludedAncestors: RECEPTION_QUALITY_EXCLUDED_ANCESTOR_ASSETS.map((asset) => ({
      exclusion: "replaced_by_selected_descendants" as const,
      assetVersionId: asset.id,
      fileName: asset.fileName,
      sha256: asset.sha256,
      sizeBytes: asset.sizeBytes,
      gaussianCount: asset.gaussianCount,
      sourceHierarchySha256: RECEPTION_QUALITY_FRONTIER_HIERARCHY_SHA256,
      hierarchyLevel: asset.hierarchyLevel,
      nodeRanges: asset.nodeRanges.map((range) => ({ ...range })),
    })),
    environment: {
      disposition: "excluded_from_room_frontier",
      includedInRoomHierarchyTotals: false,
      asset: {
        assetVersionId: RECEPTION_QUALITY_ENVIRONMENT_ASSET.id,
        fileName: RECEPTION_QUALITY_ENVIRONMENT_ASSET.fileName,
        sha256: RECEPTION_QUALITY_ENVIRONMENT_ASSET.sha256,
        sizeBytes: RECEPTION_QUALITY_ENVIRONMENT_ASSET.sizeBytes,
        gaussianCount: RECEPTION_QUALITY_ENVIRONMENT_ASSET.gaussianCount,
      },
      reason: "Environment inclusion still requires a fixed-view comparison.",
    },
    limitations: [
      "This decision records the internal visual composition, not physical alignment or metric authority.",
      "Environment inclusion, signed alignment, visual review, exposure review, and distribution rights remain separate gates.",
    ],
    evidenceRefs: [
      {
        label: "Quality hierarchy and fixed-frontier inspection",
        ref: "docs/reports/reception-room-hd-evidence.json#quality-sh3-lcc2-container",
      },
      {
        label: "Reception runtime intake hashes and renderer counts",
        ref: "docs/operations/reception-room-runtime-intake-2026-06-13.md",
      },
    ],
  });
}

async function sha256File(absolutePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(absolutePath) as AsyncIterable<Buffer>) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function inspectLocalFile(
  assetDirectory: string,
  asset: ReceptionQualityAssetSpec,
): Promise<ReceptionFrontierLocalInspection> {
  const absolutePath = resolve(assetDirectory, asset.fileName);
  try {
    const file = await stat(absolutePath);
    if (!file.isFile()) {
      throw new Error("path is not a regular file");
    }
    return {
      id: asset.id,
      fileName: asset.fileName,
      absolutePath,
      sha256: await sha256File(absolutePath),
      sizeBytes: file.size,
      error: null,
    };
  } catch (error) {
    return {
      id: asset.id,
      fileName: asset.fileName,
      absolutePath,
      sha256: null,
      sizeBytes: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function inspectReceptionQualityFrontierFiles(
  assetDirectory = DEFAULT_RECEPTION_ASSET_DIRECTORY,
): Promise<readonly ReceptionFrontierLocalInspection[]> {
  const resolvedDirectory = resolve(assetDirectory);
  return Promise.all(
    RECEPTION_QUALITY_AUDITED_ASSETS.map((asset) => inspectLocalFile(resolvedDirectory, asset)),
  );
}

function validateLocalInspections(
  inspections: readonly ReceptionFrontierLocalInspection[],
): readonly ReceptionFrontierValidation[] {
  const rowsById = new Map(inspections.map((inspection) => [inspection.id, inspection]));
  return RECEPTION_QUALITY_AUDITED_ASSETS.map((expected) => {
    const actual = rowsById.get(expected.id);
    if (actual === undefined) {
      return validation(
        `local file ${expected.fileName}`,
        [`missing local inspection for asset ${expected.id}`],
        "",
      );
    }
    const errors = [
      actual.error === null ? null : `file read failed: ${actual.error}`,
      mismatch("fileName", expected.fileName, actual.fileName),
      mismatch("sizeBytes", expected.sizeBytes, actual.sizeBytes),
      mismatch("sha256", expected.sha256, actual.sha256),
    ].filter((value): value is string => value !== null);
    return validation(
      `local file ${expected.fileName}`,
      errors,
      `${String(expected.sizeBytes)} bytes and SHA-256 ${expected.sha256}`,
    );
  });
}

function validateDatabaseAssets(
  rows: readonly ReceptionFrontierAssetRecord[],
): readonly ReceptionFrontierValidation[] {
  const rowsById = new Map<string, ReceptionFrontierAssetRecord[]>();
  for (const row of rows) {
    const matchingRows = rowsById.get(row.id) ?? [];
    matchingRows.push(row);
    rowsById.set(row.id, matchingRows);
  }

  return RECEPTION_QUALITY_AUDITED_ASSETS.map((expected) => {
    const matches = rowsById.get(expected.id) ?? [];
    if (matches.length !== 1) {
      return validation(
        `database asset ${expected.fileName}`,
        [`expected exactly one row for ${expected.id}, received ${String(matches.length)}`],
        "",
      );
    }
    const actual = matches[0];
    if (actual === undefined) {
      return validation(`database asset ${expected.fileName}`, ["asset row is missing"], "");
    }
    const errors = [
      mismatch("venueSlug", VENUE_SLUG, actual.venueSlug),
      mismatch("roomSlug", ROOM_SLUG, actual.roomSlug),
      mismatch("captureSessionId", EXPECTED_RECEPTION_CAPTURE_SESSION_ID, actual.captureSessionId),
      mismatch("assetKind", "splat", actual.assetKind),
      mismatch("sourceType", "xgrids", actual.sourceType),
      mismatch("fileName", expected.fileName, actual.fileName),
      mismatch("fileExt", ".sog", actual.fileExt),
      mismatch("r2Key", expected.r2Key, actual.r2Key),
      mismatch("sha256", expected.sha256, actual.sha256),
      mismatch("sizeBytes", expected.sizeBytes, actual.sizeBytes),
      mismatch("runtimeStatus", "usable", actual.runtimeStatus),
      actual.evidenceStatus === "rejected" ? "evidenceStatus must not be rejected" : null,
    ].filter((value): value is string => value !== null);
    return validation(
      `database asset ${expected.fileName}`,
      errors,
      `${actual.id} is the expected usable Reception SOG row from capture ${EXPECTED_RECEPTION_CAPTURE_SESSION_ID}`,
    );
  });
}

function orderedDatabaseAssets(
  rows: readonly ReceptionFrontierAssetRecord[],
): readonly ReceptionFrontierAssetRecord[] {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  return RECEPTION_QUALITY_AUDITED_ASSETS
    .map((asset) => rowsById.get(asset.id))
    .filter((row): row is ReceptionFrontierAssetRecord => row !== undefined);
}

function hasMatchingComposition(
  existing: ReceptionFrontierRuntimePackageRecord,
  payload: RegisterRuntimePackageInput,
): boolean {
  if (
    existing.venueSlug !== payload.venueSlug ||
    existing.roomSlug !== payload.roomSlug ||
    existing.primaryVisualAssetVersionId !== (payload.primaryVisualAssetVersionId ?? null) ||
    existing.semanticMeshAssetVersionId !== (payload.semanticMeshAssetVersionId ?? null) ||
    existing.collisionAssetVersionId !== (payload.collisionAssetVersionId ?? null) ||
    existing.pointCloudAssetVersionId !== (payload.pointCloudAssetVersionId ?? null)
  ) {
    return false;
  }

  const parsedManifest = RuntimePackageManifestJsonSchema.safeParse(existing.manifestJson);
  if (!parsedManifest.success) return false;
  const existingVisualIds = parsedManifest.data.assets.visualAssetVersionIds;
  const expectedVisualIds = payload.manifestJson.assets.visualAssetVersionIds;
  return existingVisualIds !== undefined &&
    expectedVisualIds !== undefined &&
    arraysEqual(existingVisualIds, expectedVisualIds);
}

function buildPreflightValidations(
  localAssets: readonly ReceptionFrontierLocalInspection[],
  databaseRows: readonly ReceptionFrontierAssetRecord[],
  matchingComposition: ReceptionFrontierRuntimePackageRecord | null,
): readonly ReceptionFrontierValidation[] {
  const compositionValidation = matchingComposition === null
    ? validation(
      "existing ordered composition",
      [],
      "No existing room package declares this exact ordered four-asset composition.",
    )
    : validation(
      "existing ordered composition",
      [],
      `Package ${matchingComposition.id} declares the same asset order. The create API will compare the full content digest and return the exact revision idempotently when appropriate.`,
    );
  return [
    validation(
      "manifest payload",
      [],
      "Shared runtime-package schema accepts the exact internal_ready/unverified payload.",
    ),
    ...validateLocalInspections(localAssets),
    ...validateDatabaseAssets(databaseRows),
    validation(
      "protected legacy package remains read-only",
      [],
      `Apply uses only the create-only revision API and cannot update ${PROTECTED_RECEPTION_RUNTIME_PACKAGE_ID}.`,
    ),
    compositionValidation,
  ];
}

function resolvePreflightStatus(
  validations: readonly ReceptionFrontierValidation[],
): ReceptionQualityFrontierReport["preflightStatus"] {
  return validations.some((item) => item.status === "failed")
    ? "validation_failed"
    : "validated_payload";
}

function missingNames(
  required: readonly string[],
  observed: readonly string[],
): readonly string[] {
  const observedNames = new Set(observed);
  return required.filter((name) => !observedNames.has(name));
}

export function evaluateRuntimePackageRevisionContract(
  evidence: ReceptionRuntimePackageRevisionContractEvidence,
): ReceptionRuntimePackageRevisionContractReadiness {
  const columns = [...new Set(evidence.columns)].sort();
  const constraints = [...new Set(evidence.constraints)].sort();
  const triggers = [...new Set(evidence.triggers)].sort();
  const missingColumns = missingNames(REQUIRED_RUNTIME_PACKAGE_REVISION_COLUMNS, columns);
  const missingConstraints = missingNames(
    REQUIRED_RUNTIME_PACKAGE_REVISION_CONSTRAINTS,
    constraints,
  );
  const missingTriggers = missingNames(REQUIRED_RUNTIME_PACKAGE_REVISION_TRIGGERS, triggers);
  return {
    columns,
    constraints,
    triggers,
    missingColumns,
    missingConstraints,
    missingTriggers,
    ready:
      missingColumns.length === 0 &&
      missingConstraints.length === 0 &&
      missingTriggers.length === 0,
  };
}

export function runtimePackageRevisionDatabaseBlocker(
  readiness: ReceptionRuntimePackageRevisionContractReadiness,
): string | null {
  if (readiness.ready) return null;
  return [
    "Database migration 0052 is not fully deployed; no create request is allowed.",
    readiness.missingColumns.length > 0
      ? `Missing columns: ${readiness.missingColumns.join(", ")}.`
      : null,
    readiness.missingConstraints.length > 0
      ? `Missing constraints: ${readiness.missingConstraints.join(", ")}.`
      : null,
    readiness.missingTriggers.length > 0
      ? `Missing triggers: ${readiness.missingTriggers.join(", ")}.`
      : null,
  ].filter((value): value is string => value !== null).join(" ");
}

export async function prepareReceptionQualityFrontier(
  options: PrepareReceptionQualityFrontierOptions,
): Promise<ReceptionQualityFrontierReport> {
  const assetDirectory = resolve(options.assetDirectory ?? DEFAULT_RECEPTION_ASSET_DIRECTORY);
  const payload = buildReceptionQualityFrontierPayload();
  const ids = RECEPTION_QUALITY_AUDITED_ASSETS.map((asset) => asset.id);
  const inspectLocalFiles = options.inspectLocalFiles ?? inspectReceptionQualityFrontierFiles;
  const [localAssets, databaseRows, existingPackages, revisionContractEvidence] = await Promise.all([
    inspectLocalFiles(assetDirectory),
    options.store.readAssetVersions(ids),
    options.store.readRuntimePackages(VENUE_SLUG, ROOM_SLUG),
    options.store.readRuntimePackageRevisionContract(),
  ]);

  const matchingComposition = existingPackages.find((existing) => hasMatchingComposition(existing, payload)) ?? null;
  const validations = buildPreflightValidations(localAssets, databaseRows, matchingComposition);
  const databaseContract = evaluateRuntimePackageRevisionContract(revisionContractEvidence);

  return {
    schemaVersion: "venviewer.reception-quality-frontier-preflight.v1",
    generatedAt: RECEPTION_QUALITY_FRONTIER_GENERATED_AT,
    requestedMode: options.applyRequested === true ? "apply" : "dry_run",
    preflightStatus: resolvePreflightStatus(validations),
    payload,
    expectedContentDigest: computeRuntimePackageRevisionDigest(payload),
    assetDirectory,
    localAssets,
    databaseAssets: orderedDatabaseAssets(databaseRows),
    validations,
    existingMatchingCompositionId: matchingComposition?.id ?? null,
    protectedPackageId: PROTECTED_RECEPTION_RUNTIME_PACKAGE_ID,
    apply: {
      databaseReady: databaseContract.ready,
      databaseBlocker: runtimePackageRevisionDatabaseBlocker(databaseContract),
      databaseContract,
      endpointDeploymentVerified: false,
      endpoint: RUNTIME_PACKAGE_REVISION_ENDPOINT,
      requested: options.applyRequested === true,
      receipt: null,
      decision: null,
    },
  };
}

export function parseReceptionQualityFrontierArgs(args: readonly string[]): ReceptionQualityFrontierArgs {
  let applyRequested = false;
  let assetDirectory: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--apply") {
      if (applyRequested) throw new Error("--apply may only be supplied once.");
      applyRequested = true;
      continue;
    }
    if (argument === "--asset-dir") {
      if (assetDirectory !== undefined) throw new Error("--asset-dir may only be supplied once.");
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--asset-dir requires a directory path.");
      }
      assetDirectory = value;
      index += 1;
      continue;
    }
    if (argument?.startsWith("--asset-dir=") === true) {
      if (assetDirectory !== undefined) throw new Error("--asset-dir may only be supplied once.");
      const value = argument.slice("--asset-dir=".length);
      if (value.trim() === "") throw new Error("--asset-dir requires a directory path.");
      assetDirectory = value;
      continue;
    }
    throw new Error(`Unknown argument: ${argument ?? "<missing>"}. Use only --asset-dir <path> or --apply.`);
  }
  return { applyRequested, assetDirectory };
}

export async function runReceptionQualityFrontier(
  options: RunReceptionQualityFrontierOptions,
): Promise<ReceptionQualityFrontierReport> {
  const cli = parseReceptionQualityFrontierArgs(options.args);
  let report = await prepareReceptionQualityFrontier({
    store: options.store,
    applyRequested: cli.applyRequested,
    assetDirectory: cli.assetDirectory ?? options.assetDirectory,
    inspectLocalFiles: options.inspectLocalFiles,
  });
  if (report.preflightStatus === "validation_failed") {
    throw new Error("Reception Quality fine-frontier preflight failed. Read the failed validations above; no database write was attempted.");
  }
  if (cli.applyRequested) {
    if (!report.apply.databaseReady) {
      throw new Error(
        `${report.apply.databaseBlocker ?? "Database migration 0052 is not ready."} No API request was sent.`,
      );
    }
    if (options.createRevision === undefined) {
      throw new Error(
        "--apply requires an authenticated immutable revision API client; no request was sent.",
      );
    }
    const response = await options.createRevision({ package: report.payload });
    const decision = buildReceptionQualityFrontierDecision({
      receipt: response.receipt,
      runtimePackage: response.data,
      decidedAt: (options.now?.() ?? new Date()).toISOString(),
      decidedBy: "reception-quality-frontier-registration-script",
    });
    report = {
      ...report,
      apply: {
        ...report.apply,
        endpointDeploymentVerified: true,
        receipt: response.receipt,
        decision,
      },
    };
  }

  const log = options.log ?? ((line: string): void => {
    process.stdout.write(`${line}\n`);
  });
  log(JSON.stringify(report, null, 2));
  return report;
}

export function createReceptionQualityFrontierReadStore(
  db: Database,
): ReceptionQualityFrontierReadStore {
  return {
    readAssetVersions: async (ids) => db
      .select({
        id: assetVersions.id,
        venueSlug: assetVersions.venueSlug,
        roomSlug: assetVersions.roomSlug,
        captureSessionId: assetVersions.captureSessionId,
        assetKind: assetVersions.assetKind,
        sourceType: assetVersions.sourceType,
        fileName: assetVersions.fileName,
        fileExt: assetVersions.fileExt,
        r2Key: assetVersions.r2Key,
        sha256: assetVersions.sha256,
        sizeBytes: assetVersions.sizeBytes,
        evidenceStatus: assetVersions.evidenceStatus,
        runtimeStatus: assetVersions.runtimeStatus,
      })
      .from(assetVersions)
      .where(inArray(assetVersions.id, [...ids])),
    readRuntimePackages: async (venueSlug, roomSlug) => db
      .select({
        id: runtimePackages.id,
        venueSlug: runtimePackages.venueSlug,
        roomSlug: runtimePackages.roomSlug,
        primaryVisualAssetVersionId: runtimePackages.primaryVisualAssetVersionId,
        semanticMeshAssetVersionId: runtimePackages.semanticMeshAssetVersionId,
        collisionAssetVersionId: runtimePackages.collisionAssetVersionId,
        pointCloudAssetVersionId: runtimePackages.pointCloudAssetVersionId,
        manifestJson: runtimePackages.manifestJson,
      })
      .from(runtimePackages)
      .where(and(
        eq(runtimePackages.venueSlug, venueSlug),
        eq(runtimePackages.roomSlug, roomSlug),
      )),
    readRuntimePackageRevisionContract: async () => db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION READ ONLY`);
      await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
      await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
      const result = await tx.execute(sql`
        SELECT 'column'::text AS kind, column_name::text AS name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'runtime_packages'
          AND column_name IN ('revision', 'identity_kind', 'content_digest')
        UNION ALL
        SELECT 'constraint'::text AS kind, constraint_name::text AS name
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'runtime_packages'
          AND constraint_name IN (
            'runtime_packages_revision_positive',
            'runtime_packages_identity_coherent',
            'runtime_packages_venue_room_revision_unique',
            'runtime_packages_venue_room_digest_unique'
          )
        UNION ALL
        SELECT 'trigger'::text AS kind, trigger_name::text AS name
        FROM information_schema.triggers
        WHERE event_object_schema = 'public'
          AND event_object_table = 'runtime_packages'
          AND trigger_name IN (
            'runtime_packages_revision_monotonic',
            'runtime_packages_no_update',
            'runtime_packages_no_delete',
            'runtime_packages_no_truncate'
          )
      `);
      const rows = result.rows as readonly Record<string, unknown>[];
      const names = (kind: string): readonly string[] => rows
        .filter((row) => row["kind"] === kind && typeof row["name"] === "string")
        .map((row) => row["name"] as string)
        .sort();
      return {
        columns: names("column"),
        constraints: names("constraint"),
        triggers: names("trigger"),
      };
    }),
  };
}

function requiredDatabaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  const databaseUrl = env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    throw new Error("DATABASE_URL is required for the read-only asset and duplicate-revision preflight.");
  }
  return databaseUrl;
}

function requiredEnvironmentValue(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required for --apply; no API request was sent.`);
  }
  return value;
}

function safeRuntimePackageApiOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("RUNTIME_PACKAGE_API_ORIGIN must be a valid absolute URL.");
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new Error(
      "RUNTIME_PACKAGE_API_ORIGIN must be a clean origin without credentials, path, query, or fragment.",
    );
  }
  const loopbackHost = url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopbackHost)) {
    throw new Error(
      "RUNTIME_PACKAGE_API_ORIGIN must use HTTPS, except for an HTTP loopback development server.",
    );
  }
  return url.origin;
}

export function createReceptionQualityFrontierApiClient(
  env: Readonly<Record<string, string | undefined>>,
  request: typeof fetch = fetch,
): (input: CreateRuntimePackageRevisionInput) => Promise<RuntimePackageRevisionCreateResponse> {
  const origin = safeRuntimePackageApiOrigin(
    requiredEnvironmentValue(env, "RUNTIME_PACKAGE_API_ORIGIN"),
  );
  const token = requiredEnvironmentValue(env, "RUNTIME_PACKAGE_ADMIN_TOKEN");
  const endpoint = new URL(RUNTIME_PACKAGE_REVISION_ENDPOINT, origin).href;

  return async (input) => {
    const response = await request(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    const responseText = await response.text();
    let responseBody: unknown;
    try {
      responseBody = JSON.parse(responseText) as unknown;
    } catch {
      responseBody = null;
    }
    if (!response.ok) {
      const serverMessage = typeof responseBody === "object" && responseBody !== null &&
        "error" in responseBody && typeof responseBody.error === "string"
        ? `: ${responseBody.error}`
        : "";
      throw new Error(
        `Immutable runtime-package revision API returned HTTP ${String(response.status)}${serverMessage}`,
      );
    }
    return RuntimePackageRevisionCreateResponseSchema.parse(responseBody);
  };
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  const db = createDb(requiredDatabaseUrl(process.env));
  const cli = parseReceptionQualityFrontierArgs(process.argv.slice(2));
  runReceptionQualityFrontier({
    args: process.argv.slice(2),
    store: createReceptionQualityFrontierReadStore(db),
    ...(cli.applyRequested
      ? { createRevision: createReceptionQualityFrontierApiClient(process.env) }
      : {}),
  }).then(
    () => process.exit(0),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
