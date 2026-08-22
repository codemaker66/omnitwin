import {
  RegisterAssetVersionInputSchema,
  RegisterRuntimePackageInputSchema,
  stableCanonicalJson,
  type CanonicalJsonValue,
  type RegisterAssetVersionInput,
  type RegisterRuntimePackageInput,
} from "@omnitwin/types";
import { runtimeAssetStorageKeySha256 } from "./runtime-asset-receipt.js";

export const GRAND_HALL_VENUE_SLUG = "trades-hall";
export const GRAND_HALL_ROOM_SLUG = "grand-hall";
export const GRAND_HALL_MANIFEST_FILE_NAME = "Grand_Hall.lcc2";
export const GRAND_HALL_PRIVATE_STORAGE_ROOT =
  "venues/trades-hall/rooms/grand-hall/";
export const GRAND_HALL_DEFAULT_OBJECT_PREFIX =
  `${GRAND_HALL_PRIVATE_STORAGE_ROOT}xgrids/grand-hall-big-model-sog-fine-v1/`;
export const GRAND_HALL_MANIFEST_SHA256 =
  "927a92699de222e99d2684ca2567a35ab1e523a036461e6e01236b7b77b7f659";
export const GRAND_HALL_FRONTIER_RECEIPT_SHA256 =
  "sha256:8e7514e75aa19345dda1955f2cee3f9369339c553c2711c084cd04be4c9c1352";
export const GRAND_HALL_FRONTIER_DECISION_ID = "grand-hall-big-model-sog-fine-v1";
export const GRAND_HALL_LOD_SELECTION_POLICY =
  "authoritative-leaf-nodes-exclude-environment-v1";
export const GRAND_HALL_FRONTIER_GAUSSIAN_COUNT = 6_019_684;
export const GRAND_HALL_FRONTIER_TOTAL_BYTES = 106_479_738;

export interface GrandHallFrontierMemberSpec {
  readonly fileIndex: number;
  readonly relativePath: string;
  readonly fileName: string;
  readonly depth: 5;
  readonly nodeCount: number;
  readonly gaussianCount: number;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export const GRAND_HALL_FRONTIER_MEMBERS = [
  {
    fileIndex: 12,
    relativePath: "data/3dgs/0_0_0_1_0_1.sog",
    fileName: "0_0_0_1_0_1.sog",
    depth: 5,
    nodeCount: 4,
    gaussianCount: 556_880,
    sizeBytes: 9_980_174,
    sha256: "97efa65f9aaddbd69780664c6668817125c3153469918d5f291b348ee0b6d7e1",
  },
  {
    fileIndex: 13,
    relativePath: "data/3dgs/0_1_0_1_0_0.sog",
    fileName: "0_1_0_1_0_0.sog",
    depth: 5,
    nodeCount: 3,
    gaussianCount: 528_394,
    sizeBytes: 9_500_250,
    sha256: "2b0c0cce30cb31a34b253d5985985b3d547debe8bca1a97401eb72ab3ad3bdbf",
  },
  {
    fileIndex: 14,
    relativePath: "data/3dgs/0_2_0_0_1_1.sog",
    fileName: "0_2_0_0_1_1.sog",
    depth: 5,
    nodeCount: 4,
    gaussianCount: 608_233,
    sizeBytes: 10_575_631,
    sha256: "b354ba55785e73a42aa4d108ac0c1fb93c333cbf5bd881e6c75149c2cecccd3e",
  },
  {
    fileIndex: 15,
    relativePath: "data/3dgs/0_3_0_0_0_0.sog",
    fileName: "0_3_0_0_0_0.sog",
    depth: 5,
    nodeCount: 3,
    gaussianCount: 604_745,
    sizeBytes: 10_376_269,
    sha256: "e590fb5d7488071c63f10df33b31e451f3c0348c2209f1bf594015c28a1fff24",
  },
  {
    fileIndex: 16,
    relativePath: "data/3dgs/0_3_0_1_0_1.sog",
    fileName: "0_3_0_1_0_1.sog",
    depth: 5,
    nodeCount: 3,
    gaussianCount: 585_011,
    sizeBytes: 10_207_866,
    sha256: "84b2ff813e0746d8fc8dfcc9d044dba15fef5f62ca137794c30989c04ba82a9d",
  },
  {
    fileIndex: 17,
    relativePath: "data/3dgs/0_4_0_1_0_0.sog",
    fileName: "0_4_0_1_0_0.sog",
    depth: 5,
    nodeCount: 3,
    gaussianCount: 514_640,
    sizeBytes: 9_199_768,
    sha256: "5863e052c6f99316914df9168829543b82fb35db0118b5e02d30e4d326a79d03",
  },
  {
    fileIndex: 18,
    relativePath: "data/3dgs/0_5_0_0_0_1.sog",
    fileName: "0_5_0_0_0_1.sog",
    depth: 5,
    nodeCount: 3,
    gaussianCount: 504_860,
    sizeBytes: 8_975_642,
    sha256: "65fd21b69a1def23cb4bd5b756da7ac03e4451a476a80a61c47b853a0366a8f1",
  },
  {
    fileIndex: 19,
    relativePath: "data/3dgs/0_5_0_1_0_1.sog",
    fileName: "0_5_0_1_0_1.sog",
    depth: 5,
    nodeCount: 4,
    gaussianCount: 551_142,
    sizeBytes: 9_708_760,
    sha256: "d3272fee659e486190af1d2ac9427c39e5536bc85b90b5570df4b6e9e9124631",
  },
  {
    fileIndex: 20,
    relativePath: "data/3dgs/0_6_0_0_0_1.sog",
    fileName: "0_6_0_0_0_1.sog",
    depth: 5,
    nodeCount: 4,
    gaussianCount: 597_926,
    sizeBytes: 10_231_737,
    sha256: "18e23290236bb3f220df2b59f6f255a421151c0f1da7ed633bd00d06eddf0171",
  },
  {
    fileIndex: 21,
    relativePath: "data/3dgs/0_7_0_0_0_0.sog",
    fileName: "0_7_0_0_0_0.sog",
    depth: 5,
    nodeCount: 3,
    gaussianCount: 524_982,
    sizeBytes: 9_417_293,
    sha256: "7c4cca3644294c2955cfe9e41f387e70ce79e1aedcca132392c0493325ce4386",
  },
  {
    fileIndex: 22,
    relativePath: "data/3dgs/0_7_0_0_0_1.sog",
    fileName: "0_7_0_0_0_1.sog",
    depth: 5,
    nodeCount: 3,
    gaussianCount: 442_871,
    sizeBytes: 8_306_348,
    sha256: "5e4409b07084ce7089e77a17d1eec0d2c4691f7a9d9e52f55ef752529d356ea9",
  },
] as const satisfies readonly GrandHallFrontierMemberSpec[];

export interface GrandHallAssetRecord {
  readonly id: string;
  readonly venueSlug: string;
  readonly roomSlug: string | null;
  readonly captureSessionId: string | null;
  readonly assetKind: string;
  readonly sourceType: string;
  readonly fileName: string;
  readonly fileExt: string;
  readonly r2Key: string | null;
  readonly externalUrl: string | null;
  readonly mimeType: string | null;
  readonly sha256: string | null;
  readonly sizeBytes: number | null;
  readonly evidenceStatus: string;
  readonly runtimeStatus: string;
}

export function grandHallObjectKey(
  member: GrandHallFrontierMemberSpec,
  objectPrefix = GRAND_HALL_DEFAULT_OBJECT_PREFIX,
): string {
  return `${objectPrefix}${member.relativePath}`;
}

export function buildGrandHallAssetRegistrationInputs(
  options: { readonly objectPrefix?: string } = {},
): readonly RegisterAssetVersionInput[] {
  const objectPrefix = options.objectPrefix ?? GRAND_HALL_DEFAULT_OBJECT_PREFIX;
  return GRAND_HALL_FRONTIER_MEMBERS.map((member) =>
    RegisterAssetVersionInputSchema.parse({
      venueSlug: GRAND_HALL_VENUE_SLUG,
      roomSlug: GRAND_HALL_ROOM_SLUG,
      captureSessionId: null,
      assetKind: "splat",
      sourceType: "xgrids",
      fileName: member.fileName,
      fileExt: ".sog",
      r2Key: grandHallObjectKey(member, objectPrefix),
      externalUrl: null,
      mimeType: "application/octet-stream",
      sha256: member.sha256,
      sizeBytes: member.sizeBytes,
      evidenceStatus: "unverified",
      runtimeStatus: "usable",
      notes: `Exact member of ${GRAND_HALL_FRONTIER_DECISION_ID}. Capture date, capture-session identity, and documentary rights evidence are not asserted.`,
    })
  );
}

export function grandHallAssetIdentityErrors(
  row: GrandHallAssetRecord,
  input: RegisterAssetVersionInput,
): readonly string[] {
  const checks: readonly [string, unknown, unknown][] = [
    ["venueSlug", row.venueSlug, input.venueSlug],
    ["roomSlug", row.roomSlug, input.roomSlug ?? null],
    ["captureSessionId", row.captureSessionId, null],
    ["assetKind", row.assetKind, input.assetKind],
    ["sourceType", row.sourceType, input.sourceType],
    ["fileName", row.fileName, input.fileName],
    ["fileExt", row.fileExt, input.fileExt],
    ["r2Key", row.r2Key, input.r2Key ?? null],
    ["externalUrl", row.externalUrl, null],
    ["mimeType", row.mimeType, input.mimeType ?? null],
    ["sha256", row.sha256, input.sha256 ?? null],
    ["sizeBytes", row.sizeBytes, input.sizeBytes ?? null],
    ["runtimeStatus", row.runtimeStatus, "usable"],
  ];
  const errors = checks
    .filter(([, actual, expected]) => actual !== expected)
    .map(([label, actual, expected]) =>
      `${label}: expected ${String(expected)}, received ${String(actual)}`
    );
  if (row.evidenceStatus === "rejected") errors.push("evidenceStatus must not be rejected");
  return errors;
}

export function buildGrandHallRuntimePackagePayload(
  registeredAssets: readonly GrandHallAssetRecord[],
): RegisterRuntimePackageInput {
  if (registeredAssets.length !== GRAND_HALL_FRONTIER_MEMBERS.length) {
    throw new Error("The runtime package requires exactly eleven registered Grand Hall assets.");
  }
  const ids: string[] = [];
  const receipts = GRAND_HALL_FRONTIER_MEMBERS.map((member, index) => {
    const asset = registeredAssets[index];
    const expectedInput = buildGrandHallAssetRegistrationInputs()[index];
    if (
      asset === undefined ||
      expectedInput === undefined ||
      grandHallAssetIdentityErrors(asset, expectedInput).length > 0 ||
      asset.evidenceStatus === "rejected"
    ) {
      throw new Error(`Registered asset ${String(index)} does not match the exact Grand Hall member.`);
    }
    if (asset.r2Key === null) {
      throw new Error(`Registered asset ${String(index)} has no private storage key.`);
    }
    ids.push(asset.id);
    return {
      assetVersionId: asset.id,
      fileName: member.fileName,
      fileExt: ".sog" as const,
      sha256: member.sha256,
      sizeBytes: member.sizeBytes,
      storageKeySha256: runtimeAssetStorageKeySha256(asset.r2Key),
    };
  });
  const primaryVisualAssetVersionId = ids[0];
  if (primaryVisualAssetVersionId === undefined) {
    throw new Error("The Grand Hall frontier has no primary visual asset.");
  }
  return RegisterRuntimePackageInputSchema.parse({
    venueSlug: GRAND_HALL_VENUE_SLUG,
    roomSlug: GRAND_HALL_ROOM_SLUG,
    primaryVisualAssetVersionId,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: GRAND_HALL_VENUE_SLUG,
      roomSlug: GRAND_HALL_ROOM_SLUG,
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId,
        visualAssetVersionIds: ids,
        visualAssetReceipts: receipts,
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
      compositionBasis: {
        decisionId: GRAND_HALL_FRONTIER_DECISION_ID,
        decisionRef: GRAND_HALL_FRONTIER_RECEIPT_SHA256,
        hierarchySha256: GRAND_HALL_MANIFEST_SHA256,
        format: "sog",
        level: "fine",
        lodSelectionPolicy: GRAND_HALL_LOD_SELECTION_POLICY,
        expectedGaussianCount: GRAND_HALL_FRONTIER_GAUSSIAN_COUNT,
      },
      notes: "Grand Hall XGRIDS quality frontier. The eleven authoritative leaf SOGs are declared in receipt order; env.sog, all ancestor LODs, SPZ, OBJ, and PLY are excluded. Capture date, capture-session identity, and documentary rights evidence are not asserted.",
    },
    evidenceStatus: "unverified",
    runtimeStatus: "internal_ready",
  });
}

export interface GrandHallRuntimePackageRecord {
  readonly venueSlug: string;
  readonly roomSlug: string;
  readonly primaryVisualAssetVersionId?: string | null;
  readonly semanticMeshAssetVersionId?: string | null;
  readonly collisionAssetVersionId?: string | null;
  readonly pointCloudAssetVersionId?: string | null;
  readonly manifestJson: unknown;
  readonly evidenceStatus: string;
  readonly runtimeStatus: string;
}

/**
 * Admission and serving use the same canonical predicate. This makes directly
 * inserted or historical metadata unable to expose non-frontier Grand Hall
 * bytes even when its receipts are internally self-consistent.
 */
export function isCanonicalGrandHallRuntimePackage(
  pkg: GrandHallRuntimePackageRecord,
  orderedAssets: readonly GrandHallAssetRecord[],
): boolean {
  let expected: RegisterRuntimePackageInput;
  try {
    expected = buildGrandHallRuntimePackagePayload(orderedAssets);
  } catch {
    return false;
  }
  const parsed = RegisterRuntimePackageInputSchema.safeParse({
    venueSlug: pkg.venueSlug,
    roomSlug: pkg.roomSlug,
    primaryVisualAssetVersionId: pkg.primaryVisualAssetVersionId,
    semanticMeshAssetVersionId: pkg.semanticMeshAssetVersionId,
    collisionAssetVersionId: pkg.collisionAssetVersionId,
    pointCloudAssetVersionId: pkg.pointCloudAssetVersionId,
    manifestJson: pkg.manifestJson,
    evidenceStatus: pkg.evidenceStatus,
    runtimeStatus: pkg.runtimeStatus,
  });
  if (!parsed.success) return false;
  const actual = parsed.data;
  return actual.venueSlug === expected.venueSlug &&
    actual.roomSlug === expected.roomSlug &&
    actual.primaryVisualAssetVersionId === expected.primaryVisualAssetVersionId &&
    actual.semanticMeshAssetVersionId === null &&
    actual.collisionAssetVersionId === null &&
    actual.pointCloudAssetVersionId === null &&
    actual.evidenceStatus !== "rejected" &&
    (actual.runtimeStatus === "internal_ready" || actual.runtimeStatus === "published") &&
    stableCanonicalJson(actual.manifestJson as CanonicalJsonValue) ===
      stableCanonicalJson(expected.manifestJson as CanonicalJsonValue);
}
