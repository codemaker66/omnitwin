import type { RuntimePackagePreview } from "@omnitwin/types";

export interface ReviewedReceptionRuntimeAsset {
  readonly assetVersionId: string;
  readonly fileName: string;
  readonly fileExt: ".sog" | ".spz";
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly storageKeySha256: string;
}

export interface ReviewedReceptionRuntimeProfile {
  readonly id: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
  readonly compositionBasis: {
    readonly decisionId: string;
    readonly decisionRef: string;
    readonly hierarchySha256: string;
    readonly format: "sog" | "spz";
    readonly level: "fine";
    readonly lodSelectionPolicy: "fixed_fine_frontier_v1";
    readonly expectedGaussianCount: number;
  };
  readonly assets: readonly ReviewedReceptionRuntimeAsset[];
}

/** Audited Quality SH3 fine leaves registered on 2026-07-13. */
export const RECEPTION_QUALITY_RUNTIME_PROFILE = {
  id: "quality-sog-fine-v1",
  compositionBasis: {
    decisionId: "reception-room-quality-fixed-fine-frontier-v1",
    decisionRef: "docs/reports/reception-room-hd-root-investigation.md",
    hierarchySha256: "f0a4c782cc0f031830404d409f5c0accdc30ed501fa562169206962ceee64f3e",
    format: "sog",
    level: "fine",
    lodSelectionPolicy: "fixed_fine_frontier_v1",
    expectedGaussianCount: 2_002_009,
  },
  assets: [
    {
      assetVersionId: "411cee79-f698-4945-ab0f-1267e6e74c2f",
      fileName: "0_15_0_0.sog",
      fileExt: ".sog",
      sha256: "111a47f7470fc83d1dc7f0bf2e1d3aa96943dd5a453005b840597e8c491d2368",
      sizeBytes: 10_279_160,
      storageKeySha256: "50505045b936c70efe8313401f515d3c0f95cd8767bd8f58a6396778be4ec179",
    },
    {
      assetVersionId: "47d8e638-4ce1-415e-9c3c-941c91b1ac30",
      fileName: "0_1_0_5.sog",
      fileExt: ".sog",
      sha256: "559dd375950966f8d1aa088a391b7105e364abc5013e7d29ea573728ab208fe1",
      sizeBytes: 10_047_085,
      storageKeySha256: "f44ade4f024332abf216ad05abe29989da967a1e10f7e0261f138525889a1ce1",
    },
    {
      assetVersionId: "a4d9ff60-62f7-4bee-a7de-e128778325ae",
      fileName: "0_6_0_0.sog",
      fileExt: ".sog",
      sha256: "182525354cd14fa6bc8f6a54c0cbe0e39b5d5c216dd27e2cc4d44d1458ba8238",
      sizeBytes: 10_368_228,
      storageKeySha256: "9012ef53acd20ff8e32ca3e57dbcf14fe512b2403c271226925c5d22b5d740a5",
    },
    {
      assetVersionId: "24637593-577e-4507-b73c-8cd3c8e30039",
      fileName: "0_7_0_0.sog",
      fileExt: ".sog",
      sha256: "3b68d24538523a559730e14d5ed1733f67d9894354e26322e20cf5f4458ccebf",
      sizeBytes: 5_040_628,
      storageKeySha256: "1ca711eae873f39e3b615f162b4dace67ffe6f49cbb509d54ed7fa7ce818cfdb",
    },
  ],
} as const satisfies ReviewedReceptionRuntimeProfile;

/** Audited Mobile SH0 SPZ fine leaves from the existing controlled R2 intake. */
export const RECEPTION_MOBILE_RUNTIME_PROFILE = {
  id: "mobile-spz-fine-v1",
  compositionBasis: {
    decisionId: "reception-room-mobile-fixed-fine-frontier-v1",
    decisionRef: "docs/reports/reception-room-hd-evidence.json#mobile-sh0-lcc2-spz-container",
    hierarchySha256: "a5f0ffeda6ae8d20784774aadf0a69205271d1c4a8210c8cacc5487b231b5cc2",
    format: "spz",
    level: "fine",
    lodSelectionPolicy: "fixed_fine_frontier_v1",
    expectedGaussianCount: 1_978_258,
  },
  assets: [
    {
      assetVersionId: "daa01028-999a-4566-a306-9f43242efe1f",
      fileName: "0_13_0_0.spz",
      fileExt: ".spz",
      sha256: "82bbbd033609f99f05c45c177ada552b87b905255ac515014f75561c292bf55c",
      sizeBytes: 8_620_036,
      storageKeySha256: "8216d755907a98c207c2396d9cc78f8bc81d92ef0a37c66fa37ac9aef50de0d7",
    },
    {
      assetVersionId: "1a1a9be2-d397-4c11-b9b5-d83b3b6b38eb",
      fileName: "0_3_0_0.spz",
      fileExt: ".spz",
      sha256: "13200d905d50160034538e705b60c549aaf82348679791f801efa3f9e52171b3",
      sizeBytes: 9_199_830,
      storageKeySha256: "b699a152dafeb03d1b6c410e1bd18079386b44aa51e48783d17dfba0b2a1bdb0",
    },
    {
      assetVersionId: "dfe479b9-e6c7-4749-827d-a8acbc52c764",
      fileName: "0_7_0_1.spz",
      fileExt: ".spz",
      sha256: "5d4e274df25aae56a8989416e1078fc86912b4c7b053b1c7d3c25a6e484a80df",
      sizeBytes: 8_768_751,
      storageKeySha256: "10cc53f169d9ced1999565ec7b81f488ebf6d284aaa2129445f7a9d915814858",
    },
    {
      assetVersionId: "1c895eb8-ad58-4bad-afe3-c9a1ff569170",
      fileName: "0_8_0_0.spz",
      fileExt: ".spz",
      sha256: "925c90a714abf7ed9cacea65a4abf4de1ff225ead2ef503aadcf836068ab62ed",
      sizeBytes: 3_422_064,
      storageKeySha256: "78d048fb60df6cf97f0b53f21dfb9e46d5735ecc6a65300a354a6f72c2faeff5",
    },
  ],
} as const satisfies ReviewedReceptionRuntimeProfile;

export const RECEPTION_PRIVATE_RUNTIME_PROFILES = [
  RECEPTION_QUALITY_RUNTIME_PROFILE,
  RECEPTION_MOBILE_RUNTIME_PROFILE,
] as const satisfies readonly ReviewedReceptionRuntimeProfile[];

function matchesProfile(
  preview: RuntimePackagePreview,
  profile: ReviewedReceptionRuntimeProfile,
): boolean {
  const receipts = preview.manifestJson.assets.visualAssetReceipts;
  const basis = preview.manifestJson.compositionBasis;
  if (
    preview.visualAssets.length !== profile.assets.length ||
    receipts === undefined ||
    receipts.length !== profile.assets.length ||
    basis === undefined ||
    basis.decisionId !== profile.compositionBasis.decisionId ||
    basis.decisionRef !== profile.compositionBasis.decisionRef ||
    basis.hierarchySha256 !== profile.compositionBasis.hierarchySha256 ||
    basis.format !== profile.compositionBasis.format ||
    basis.level !== profile.compositionBasis.level ||
    basis.lodSelectionPolicy !== profile.compositionBasis.lodSelectionPolicy ||
    basis.expectedGaussianCount !== profile.compositionBasis.expectedGaussianCount
  ) {
    return false;
  }

  return profile.assets.every((expected, index) => {
    const asset = preview.visualAssets[index];
    const receipt = receipts[index];
    return asset !== undefined &&
      receipt !== undefined &&
      asset.assetVersionId === expected.assetVersionId &&
      asset.fileName === expected.fileName &&
      asset.fileExt === expected.fileExt &&
      asset.sha256 === expected.sha256 &&
      asset.sizeBytes === expected.sizeBytes &&
      receipt.assetVersionId === expected.assetVersionId &&
      receipt.fileName === expected.fileName &&
      receipt.fileExt === expected.fileExt &&
      receipt.sha256 === expected.sha256 &&
      receipt.sizeBytes === expected.sizeBytes &&
      receipt.storageKeySha256 === expected.storageKeySha256;
  });
}

export function matchReceptionPrivateRuntimeProfile(
  preview: RuntimePackagePreview,
): ReviewedReceptionRuntimeProfile | null {
  return RECEPTION_PRIVATE_RUNTIME_PROFILES.find((profile) =>
    matchesProfile(preview, profile)
  ) ?? null;
}
