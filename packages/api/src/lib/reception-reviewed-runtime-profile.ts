import { createHash } from "node:crypto";
import {
  RegisterRuntimePackageInputSchema,
  RuntimePackageContentDigestSchema,
  RuntimePackageManifestJsonSchema,
  type ReviewedRuntimeProfileId,
  type RuntimePackageManifestJson,
} from "@omnitwin/types";
import { runtimeAssetStorageKeySha256 } from "./runtime-asset-receipt.js";
import { computeRuntimePackageRevisionDigest } from "../services/runtime-package-revisions.js";

interface RuntimeProfilePackageRecord {
  readonly venueSlug: string;
  readonly roomSlug: string;
  readonly primaryVisualAssetVersionId: string | null;
  readonly semanticMeshAssetVersionId: string | null;
  readonly collisionAssetVersionId: string | null;
  readonly pointCloudAssetVersionId: string | null;
  readonly manifestJson: unknown;
  readonly evidenceStatus: string;
  readonly runtimeStatus: string;
  readonly identityKind: string;
  readonly contentDigest: string | null;
}

interface RuntimeProfileAssetRecord {
  readonly id: string;
  readonly fileName: string;
  readonly fileExt: string;
  readonly sha256: string | null;
  readonly sizeBytes: number | null;
  readonly r2Key: string | null;
  readonly externalUrl: string | null;
}

interface ReviewedProfileReceipt {
  readonly id: ReviewedRuntimeProfileId;
  readonly manifestFingerprintSha256: string;
  /** Exact transform bytes reviewed for this browser presentation. Null means
   * the profile is structurally blocked from anonymous presentation. */
  readonly reviewedTransformArtifactSha256: string | null;
  /** Identity may enter the separate public-release gate. This is not release
   * permission; showcase configuration, signed transform and human QA must
   * still approve every response and byte request. */
  readonly publicPresentationCandidate: boolean;
}

/**
 * Server-only profile receipts. Each digest commits to the ordered asset IDs,
 * byte/storage receipts and LOD composition basis, while keeping those private
 * values out of browser bundles and public response bodies.
 */
const REVIEWED_RECEPTION_PROFILES: readonly ReviewedProfileReceipt[] = [
  {
    id: "quality-sog-fine-v1",
    manifestFingerprintSha256: "411267117cfb069affb4facca45f68c9c2d54bd6473c3bc0ea76afd26202bc9a",
    reviewedTransformArtifactSha256: null,
    publicPresentationCandidate: false,
  },
  {
    id: "mobile-spz-fine-v1",
    manifestFingerprintSha256: "5b34b91c79ce43b90cddbaac6b8e3dcda4d83c9c511e60d4a18df66e9daab650",
    reviewedTransformArtifactSha256: null,
    publicPresentationCandidate: false,
  },
] as const;

function manifestFingerprintPayload(manifest: RuntimePackageManifestJson): string {
  return JSON.stringify({
    venueSlug: manifest.venueSlug,
    roomSlug: manifest.roomSlug,
    primaryVisualAssetVersionId: manifest.assets.primaryVisualAssetVersionId,
    visualAssetVersionIds: manifest.assets.visualAssetVersionIds ?? [],
    visualAssetReceipts: manifest.assets.visualAssetReceipts ?? [],
    compositionBasis: manifest.compositionBasis ?? null,
  });
}

export function receptionRuntimeProfileManifestFingerprint(
  manifestJson: unknown,
): string | null {
  const parsed = RuntimePackageManifestJsonSchema.safeParse(manifestJson);
  if (!parsed.success) return null;
  return createHash("sha256")
    .update(manifestFingerprintPayload(parsed.data), "utf8")
    .digest("hex");
}

function immutablePackageContentMatches(record: RuntimeProfilePackageRecord): boolean {
  if (
    record.identityKind !== "content_sha256" ||
    record.contentDigest === null ||
    !RuntimePackageContentDigestSchema.safeParse(record.contentDigest).success
  ) {
    return false;
  }

  const parsed = RegisterRuntimePackageInputSchema.safeParse({
    venueSlug: record.venueSlug,
    roomSlug: record.roomSlug,
    primaryVisualAssetVersionId: record.primaryVisualAssetVersionId,
    semanticMeshAssetVersionId: record.semanticMeshAssetVersionId,
    collisionAssetVersionId: record.collisionAssetVersionId,
    pointCloudAssetVersionId: record.pointCloudAssetVersionId,
    manifestJson: record.manifestJson,
    evidenceStatus: record.evidenceStatus,
    runtimeStatus: record.runtimeStatus,
  });
  return parsed.success &&
    computeRuntimePackageRevisionDigest(parsed.data) === record.contentDigest;
}

function registeredAssetsMatchReceipts(
  manifest: RuntimePackageManifestJson,
  assets: readonly RuntimeProfileAssetRecord[],
): boolean {
  const declaredIds = manifest.assets.visualAssetVersionIds;
  const receipts = manifest.assets.visualAssetReceipts;
  if (
    declaredIds === undefined ||
    receipts === undefined ||
    declaredIds.length !== assets.length ||
    receipts.length !== assets.length
  ) {
    return false;
  }

  return assets.every((asset, index) => {
    const receipt = receipts[index];
    return receipt !== undefined &&
      asset.r2Key !== null &&
      asset.externalUrl === null &&
      declaredIds[index] === asset.id &&
      receipt.assetVersionId === asset.id &&
      receipt.fileName === asset.fileName &&
      receipt.fileExt === asset.fileExt &&
      receipt.sha256 === asset.sha256 &&
      receipt.sizeBytes === asset.sizeBytes &&
      receipt.storageKeySha256 === runtimeAssetStorageKeySha256(asset.r2Key);
  });
}

export function matchReceptionReviewedRuntimeProfile(
  runtimePackage: RuntimeProfilePackageRecord,
  visualAssets: readonly RuntimeProfileAssetRecord[],
): ReviewedRuntimeProfileId | null {
  if (
    runtimePackage.venueSlug !== "trades-hall" ||
    runtimePackage.roomSlug !== "reception-room" ||
    !immutablePackageContentMatches(runtimePackage)
  ) {
    return null;
  }

  const parsedManifest = RuntimePackageManifestJsonSchema.safeParse(runtimePackage.manifestJson);
  if (
    !parsedManifest.success ||
    parsedManifest.data.venueSlug !== runtimePackage.venueSlug ||
    parsedManifest.data.roomSlug !== runtimePackage.roomSlug ||
    parsedManifest.data.assets.primaryVisualAssetVersionId !==
      runtimePackage.primaryVisualAssetVersionId ||
    !registeredAssetsMatchReceipts(parsedManifest.data, visualAssets)
  ) {
    return null;
  }

  const fingerprint = receptionRuntimeProfileManifestFingerprint(parsedManifest.data);
  return REVIEWED_RECEPTION_PROFILES.find((profile) =>
    profile.manifestFingerprintSha256 === fingerprint
  )?.id ?? null;
}

export function isReceptionReviewedProfilePresentationCandidate(
  profileId: ReviewedRuntimeProfileId,
  signedTransformArtifactSha256: string | null = null,
): boolean {
  return REVIEWED_RECEPTION_PROFILES.some((profile) =>
    profile.id === profileId &&
    profile.publicPresentationCandidate &&
    profile.reviewedTransformArtifactSha256 !== null &&
    profile.reviewedTransformArtifactSha256 === signedTransformArtifactSha256
  );
}
