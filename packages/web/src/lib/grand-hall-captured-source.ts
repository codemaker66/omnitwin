import type { RuntimePackage, RuntimePackagePreview } from "@omnitwin/types";

export interface GrandHallCapturedSourceMember {
  readonly relativePath: string;
  readonly fileName: string;
  readonly gaussianCount: number;
  readonly sizeBytes: number;
  readonly sha256: string;
}

/**
 * The exact highest-detail, non-environment SOG frontier supplied to the
 * project on 2026-08-21. These are replacement leaf nodes; ancestor LODs and
 * env.sog must never be mounted alongside them. The source report records a
 * build start on 2026-08-19; it does not establish the capture date.
 */
export const GRAND_HALL_CAPTURED_SOG_MEMBERS = [
  {
    relativePath: "data/3dgs/0_0_0_1_0_1.sog",
    fileName: "0_0_0_1_0_1.sog",
    gaussianCount: 556_880,
    sizeBytes: 9_980_174,
    sha256: "97efa65f9aaddbd69780664c6668817125c3153469918d5f291b348ee0b6d7e1",
  },
  {
    relativePath: "data/3dgs/0_1_0_1_0_0.sog",
    fileName: "0_1_0_1_0_0.sog",
    gaussianCount: 528_394,
    sizeBytes: 9_500_250,
    sha256: "2b0c0cce30cb31a34b253d5985985b3d547debe8bca1a97401eb72ab3ad3bdbf",
  },
  {
    relativePath: "data/3dgs/0_2_0_0_1_1.sog",
    fileName: "0_2_0_0_1_1.sog",
    gaussianCount: 608_233,
    sizeBytes: 10_575_631,
    sha256: "b354ba55785e73a42aa4d108ac0c1fb93c333cbf5bd881e6c75149c2cecccd3e",
  },
  {
    relativePath: "data/3dgs/0_3_0_0_0_0.sog",
    fileName: "0_3_0_0_0_0.sog",
    gaussianCount: 604_745,
    sizeBytes: 10_376_269,
    sha256: "e590fb5d7488071c63f10df33b31e451f3c0348c2209f1bf594015c28a1fff24",
  },
  {
    relativePath: "data/3dgs/0_3_0_1_0_1.sog",
    fileName: "0_3_0_1_0_1.sog",
    gaussianCount: 585_011,
    sizeBytes: 10_207_866,
    sha256: "84b2ff813e0746d8fc8dfcc9d044dba15fef5f62ca137794c30989c04ba82a9d",
  },
  {
    relativePath: "data/3dgs/0_4_0_1_0_0.sog",
    fileName: "0_4_0_1_0_0.sog",
    gaussianCount: 514_640,
    sizeBytes: 9_199_768,
    sha256: "5863e052c6f99316914df9168829543b82fb35db0118b5e02d30e4d326a79d03",
  },
  {
    relativePath: "data/3dgs/0_5_0_0_0_1.sog",
    fileName: "0_5_0_0_0_1.sog",
    gaussianCount: 504_860,
    sizeBytes: 8_975_642,
    sha256: "65fd21b69a1def23cb4bd5b756da7ac03e4451a476a80a61c47b853a0366a8f1",
  },
  {
    relativePath: "data/3dgs/0_5_0_1_0_1.sog",
    fileName: "0_5_0_1_0_1.sog",
    gaussianCount: 551_142,
    sizeBytes: 9_708_760,
    sha256: "d3272fee659e486190af1d2ac9427c39e5536bc85b90b5570df4b6e9e9124631",
  },
  {
    relativePath: "data/3dgs/0_6_0_0_0_1.sog",
    fileName: "0_6_0_0_0_1.sog",
    gaussianCount: 597_926,
    sizeBytes: 10_231_737,
    sha256: "18e23290236bb3f220df2b59f6f255a421151c0f1da7ed633bd00d06eddf0171",
  },
  {
    relativePath: "data/3dgs/0_7_0_0_0_0.sog",
    fileName: "0_7_0_0_0_0.sog",
    gaussianCount: 524_982,
    sizeBytes: 9_417_293,
    sha256: "7c4cca3644294c2955cfe9e41f387e70ce79e1aedcca132392c0493325ce4386",
  },
  {
    relativePath: "data/3dgs/0_7_0_0_0_1.sog",
    fileName: "0_7_0_0_0_1.sog",
    gaussianCount: 442_871,
    sizeBytes: 8_306_348,
    sha256: "5e4409b07084ce7089e77a17d1eec0d2c4691f7a9d9e52f55ef752529d356ea9",
  },
] as const satisfies readonly GrandHallCapturedSourceMember[];

export const GRAND_HALL_CAPTURED_SOURCE = {
  venueSlug: "trades-hall",
  roomSlug: "grand-hall",
  manifestSha256: "927a92699de222e99d2684ca2567a35ab1e523a036461e6e01236b7b77b7f659",
  frontierReceiptSha256: "sha256:8e7514e75aa19345dda1955f2cee3f9369339c553c2711c084cd04be4c9c1352",
  decisionId: "grand-hall-big-model-sog-fine-v1",
  lodSelectionPolicy: "authoritative-leaf-nodes-exclude-environment-v1",
  gaussianCount: 6_019_684,
  totalBytes: 106_479_738,
} as const;

export type GrandHallCapturedSourceValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

function reject(reason: string): GrandHallCapturedSourceValidation {
  return { ok: false, reason };
}

function exactCompositionBasis(
  basis: RuntimePackage["manifestJson"]["compositionBasis"],
): boolean {
  return basis !== undefined
    && basis.decisionId === GRAND_HALL_CAPTURED_SOURCE.decisionId
    && basis.decisionRef === GRAND_HALL_CAPTURED_SOURCE.frontierReceiptSha256
    && basis.hierarchySha256 === GRAND_HALL_CAPTURED_SOURCE.manifestSha256
    && basis.format === "sog"
    && basis.level === "fine"
    && basis.lodSelectionPolicy === GRAND_HALL_CAPTURED_SOURCE.lodSelectionPolicy
    && basis.expectedGaussianCount === GRAND_HALL_CAPTURED_SOURCE.gaussianCount;
}

/**
 * Ensures a registered Grand Hall package selects exactly the supplied fine
 * frontier metadata. This deliberately does not trust or approve runtime
 * URLs: the protected preview transport separately fetches the receipt-bound
 * R2 object and verifies its delivered byte length and SHA-256 before Spark
 * receives any bytes.
 */
export function validateGrandHallCapturedSource(
  runtimePackage: RuntimePackage,
): GrandHallCapturedSourceValidation {
  const manifest = runtimePackage.manifestJson;
  if (
    runtimePackage.venueSlug !== GRAND_HALL_CAPTURED_SOURCE.venueSlug
    || runtimePackage.roomSlug !== GRAND_HALL_CAPTURED_SOURCE.roomSlug
    || manifest.venueSlug !== GRAND_HALL_CAPTURED_SOURCE.venueSlug
    || manifest.roomSlug !== GRAND_HALL_CAPTURED_SOURCE.roomSlug
  ) {
    return reject("wrong Grand Hall package target");
  }

  if (!exactCompositionBasis(manifest.compositionBasis)) {
    return reject("wrong Grand Hall frontier decision");
  }

  const ids = manifest.assets.visualAssetVersionIds;
  const receipts = manifest.assets.visualAssetReceipts;
  if (
    ids === undefined
    || receipts === undefined
    || ids.length !== GRAND_HALL_CAPTURED_SOG_MEMBERS.length
    || receipts.length !== GRAND_HALL_CAPTURED_SOG_MEMBERS.length
  ) {
    return reject("wrong Grand Hall frontier member count");
  }

  if (
    manifest.assets.primaryVisualAssetVersionId !== ids[0]
    || runtimePackage.primaryVisualAssetVersionId !== ids[0]
    || runtimePackage.primaryVisualAssetVersion?.id !== ids[0]
  ) {
    return reject("wrong Grand Hall primary member");
  }

  let totalBytes = 0;
  for (let index = 0; index < GRAND_HALL_CAPTURED_SOG_MEMBERS.length; index += 1) {
    const expected = GRAND_HALL_CAPTURED_SOG_MEMBERS[index];
    const id = ids[index];
    const receipt = receipts[index];
    if (expected === undefined || id === undefined || receipt === undefined) {
      return reject("incomplete Grand Hall frontier member");
    }
    if (
      receipt.assetVersionId !== id
      || receipt.fileName !== expected.fileName
      || receipt.fileExt !== ".sog"
      || receipt.sha256 !== expected.sha256
      || receipt.sizeBytes !== expected.sizeBytes
    ) {
      return reject(`wrong Grand Hall frontier member at index ${String(index)}`);
    }
    totalBytes += receipt.sizeBytes;
  }

  if (totalBytes !== GRAND_HALL_CAPTURED_SOURCE.totalBytes) {
    return reject("wrong Grand Hall frontier byte total");
  }

  const primary = runtimePackage.primaryVisualAssetVersion;
  const first = GRAND_HALL_CAPTURED_SOG_MEMBERS[0];
  if (
    primary.venueSlug !== GRAND_HALL_CAPTURED_SOURCE.venueSlug
    || primary.roomSlug !== GRAND_HALL_CAPTURED_SOURCE.roomSlug
    || primary.assetKind !== "splat"
    || primary.sourceType !== "xgrids"
    || primary.fileName !== first.fileName
    || primary.fileExt !== ".sog"
    || primary.sha256 !== first.sha256
    || primary.sizeBytes !== first.sizeBytes
  ) {
    return reject("wrong Grand Hall primary asset receipt");
  }

  return { ok: true };
}

/**
 * Validates the authorized exact preview metadata before member bytes are
 * requested. The server has already rejected external URLs and matched every
 * R2 storage key to the immutable receipt; the client repeats the ordered
 * identity check and then independently hashes the delivered bytes.
 */
export function validateGrandHallCapturedPreview(
  preview: RuntimePackagePreview,
): GrandHallCapturedSourceValidation {
  if (
    preview.venueSlug !== GRAND_HALL_CAPTURED_SOURCE.venueSlug
    || preview.roomSlug !== GRAND_HALL_CAPTURED_SOURCE.roomSlug
    || preview.manifestJson.venueSlug !== GRAND_HALL_CAPTURED_SOURCE.venueSlug
    || preview.manifestJson.roomSlug !== GRAND_HALL_CAPTURED_SOURCE.roomSlug
  ) {
    return reject("wrong Grand Hall preview target");
  }
  if (!exactCompositionBasis(preview.manifestJson.compositionBasis)) {
    return reject("wrong Grand Hall preview frontier decision");
  }

  const ids = preview.manifestJson.assets.visualAssetVersionIds;
  const receipts = preview.manifestJson.assets.visualAssetReceipts;
  if (
    ids === undefined
    || receipts === undefined
    || ids.length !== GRAND_HALL_CAPTURED_SOG_MEMBERS.length
    || receipts.length !== GRAND_HALL_CAPTURED_SOG_MEMBERS.length
    || preview.visualAssets.length !== GRAND_HALL_CAPTURED_SOG_MEMBERS.length
    || preview.manifestJson.assets.primaryVisualAssetVersionId !== ids[0]
  ) {
    return reject("wrong Grand Hall preview member count");
  }

  let totalBytes = 0;
  for (let index = 0; index < GRAND_HALL_CAPTURED_SOG_MEMBERS.length; index += 1) {
    const expected = GRAND_HALL_CAPTURED_SOG_MEMBERS[index];
    const id = ids[index];
    const receipt = receipts[index];
    const asset = preview.visualAssets[index];
    if (expected === undefined || id === undefined || receipt === undefined || asset === undefined) {
      return reject("incomplete Grand Hall preview member");
    }
    if (
      receipt.assetVersionId !== id
      || receipt.fileName !== expected.fileName
      || receipt.fileExt !== ".sog"
      || receipt.sha256 !== expected.sha256
      || receipt.sizeBytes !== expected.sizeBytes
      || asset.assetVersionId !== id
      || asset.fileName !== expected.fileName
      || asset.fileExt !== ".sog"
      || asset.sha256 !== expected.sha256
      || asset.sizeBytes !== expected.sizeBytes
    ) {
      return reject(`wrong Grand Hall preview member at index ${String(index)}`);
    }
    totalBytes += asset.sizeBytes;
  }

  return totalBytes === GRAND_HALL_CAPTURED_SOURCE.totalBytes
    ? { ok: true }
    : reject("wrong Grand Hall preview byte total");
}
