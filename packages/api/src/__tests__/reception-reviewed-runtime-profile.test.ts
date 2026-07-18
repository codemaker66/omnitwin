import { describe, expect, it, vi } from "vitest";
import type { RegisterRuntimePackageInput } from "@omnitwin/types";

// The matcher only needs canonical JSON from the foundry package. Loading that
// package's broad entry point would also initialize unrelated reconstruction
// schemas, so keep this focused unit test on the exact dependency in use.
vi.mock("@omnitwin/reconstruction-foundry", () => {
  type CanonicalJson =
    | null
    | boolean
    | number
    | string
    | readonly CanonicalJson[]
    | { readonly [key: string]: CanonicalJson };

  function toCanonicalJson(value: unknown): CanonicalJson {
    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "string"
    ) {
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("Canonical number must be finite.");
      return Object.is(value, -0) ? 0 : value;
    }
    if (Array.isArray(value)) return value.map(toCanonicalJson);
    if (typeof value === "object") {
      const output: Record<string, CanonicalJson> = {};
      for (const [key, member] of Object.entries(value)) {
        if (member === undefined) throw new Error("Canonical member must be defined.");
        output[key] = toCanonicalJson(member);
      }
      return output;
    }
    throw new Error("Unsupported canonical JSON value.");
  }

  function stableCanonicalJson(value: CanonicalJson): string {
    if (value === null) return "null";
    if (
      typeof value === "boolean" ||
      typeof value === "string" ||
      typeof value === "number"
    ) {
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    }
    if (Array.isArray(value)) {
      return `[${value.map(stableCanonicalJson).join(",")}]`;
    }
    const object = value as { readonly [key: string]: CanonicalJson };
    return `{${Object.keys(object)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableCanonicalJson(object[key] ?? null)}`)
      .join(",")}}`;
  }

  return { stableCanonicalJson, toCanonicalJson };
});
vi.mock("@omnitwin/reconstruction-foundry-cli", () => ({
  inspectLcc2HighestDetailFrontier: vi.fn(),
}));

import {
  isReceptionReviewedProfilePresentationCandidate,
  matchReceptionReviewedRuntimeProfile,
  receptionRuntimeProfileManifestFingerprint,
} from "../lib/reception-reviewed-runtime-profile.js";
import { computeRuntimePackageRevisionDigest } from "../services/runtime-package-revisions.js";
import {
  RECEPTION_QUALITY_FRONTIER_ASSETS,
  buildReceptionQualityFrontierPayload,
} from "../scripts/register-reception-room-quality-frontier.js";
import {
  RECEPTION_MOBILE_FRONTIER_ASSETS,
  buildReceptionMobileFrontierPayload,
} from "../scripts/register-reception-room-mobile-frontier.js";

const QUALITY_PROFILE_FINGERPRINT =
  "411267117cfb069affb4facca45f68c9c2d54bd6473c3bc0ea76afd26202bc9a";
const MOBILE_PROFILE_FINGERPRINT =
  "5b34b91c79ce43b90cddbaac6b8e3dcda4d83c9c511e60d4a18df66e9daab650";

interface RuntimeProfilePackageFixture {
  readonly venueSlug: string;
  readonly roomSlug: string;
  readonly primaryVisualAssetVersionId: string | null;
  readonly semanticMeshAssetVersionId: string | null;
  readonly collisionAssetVersionId: string | null;
  readonly pointCloudAssetVersionId: string | null;
  readonly manifestJson: RegisterRuntimePackageInput["manifestJson"];
  readonly evidenceStatus: RegisterRuntimePackageInput["evidenceStatus"];
  readonly runtimeStatus: RegisterRuntimePackageInput["runtimeStatus"];
  readonly identityKind: string;
  readonly contentDigest: string | null;
}

interface RuntimeProfileAssetFixture {
  readonly id: string;
  readonly fileName: string;
  readonly fileExt: ".sog" | ".spz";
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly r2Key: string;
  readonly externalUrl: string | null;
}

interface RuntimeAssetSpec {
  readonly id: string;
  readonly fileName: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly r2Key: string;
}

interface RuntimeProfileFixture {
  readonly runtimePackage: RuntimeProfilePackageFixture;
  readonly visualAssets: readonly RuntimeProfileAssetFixture[];
}

function packageRecord(
  payload: RegisterRuntimePackageInput,
): RuntimeProfilePackageFixture {
  return {
    venueSlug: payload.venueSlug,
    roomSlug: payload.roomSlug,
    primaryVisualAssetVersionId: payload.primaryVisualAssetVersionId ?? null,
    semanticMeshAssetVersionId: payload.semanticMeshAssetVersionId ?? null,
    collisionAssetVersionId: payload.collisionAssetVersionId ?? null,
    pointCloudAssetVersionId: payload.pointCloudAssetVersionId ?? null,
    manifestJson: payload.manifestJson,
    evidenceStatus: payload.evidenceStatus,
    runtimeStatus: payload.runtimeStatus,
    identityKind: "content_sha256",
    contentDigest: computeRuntimePackageRevisionDigest(payload),
  };
}

function assetRecords(
  assets: readonly RuntimeAssetSpec[],
  fileExt: RuntimeProfileAssetFixture["fileExt"],
): readonly RuntimeProfileAssetFixture[] {
  return assets.map((asset) => ({
    id: asset.id,
    fileName: asset.fileName,
    fileExt,
    sha256: asset.sha256,
    sizeBytes: asset.sizeBytes,
    r2Key: asset.r2Key,
    externalUrl: null,
  }));
}

function qualityFixture(): RuntimeProfileFixture {
  return {
    runtimePackage: packageRecord(buildReceptionQualityFrontierPayload()),
    visualAssets: assetRecords(RECEPTION_QUALITY_FRONTIER_ASSETS, ".sog"),
  };
}

function mobileFixture(): RuntimeProfileFixture {
  return {
    runtimePackage: packageRecord(buildReceptionMobileFrontierPayload()),
    visualAssets: assetRecords(RECEPTION_MOBILE_FRONTIER_ASSETS, ".spz"),
  };
}

function withCurrentContentDigest(
  runtimePackage: RuntimeProfilePackageFixture,
): RuntimeProfilePackageFixture {
  return {
    ...runtimePackage,
    contentDigest: computeRuntimePackageRevisionDigest(runtimePackage),
  };
}

function requireFirstAsset(
  assets: readonly RuntimeProfileAssetFixture[],
): RuntimeProfileAssetFixture {
  const asset = assets[0];
  if (asset === undefined) throw new Error("Expected a reviewed runtime asset fixture.");
  return asset;
}

describe("Reception reviewed runtime profile matcher", () => {
  it("matches exact Quality bytes but blocks anonymous presentation without a reviewed transform", () => {
    const fixture = qualityFixture();

    expect(
      receptionRuntimeProfileManifestFingerprint(fixture.runtimePackage.manifestJson),
    ).toBe(QUALITY_PROFILE_FINGERPRINT);
    expect(
      matchReceptionReviewedRuntimeProfile(
        fixture.runtimePackage,
        fixture.visualAssets,
      ),
    ).toBe("quality-sog-fine-v1");
    expect(
      isReceptionReviewedProfilePresentationCandidate("quality-sog-fine-v1"),
    ).toBe(false);
    expect(
      isReceptionReviewedProfilePresentationCandidate(
        "quality-sog-fine-v1",
        "a".repeat(64),
      ),
    ).toBe(false);
  });

  it("matches the exact Mobile builder output to its separate reviewed profile", () => {
    const fixture = mobileFixture();

    expect(
      receptionRuntimeProfileManifestFingerprint(fixture.runtimePackage.manifestJson),
    ).toBe(MOBILE_PROFILE_FINGERPRINT);
    expect(
      matchReceptionReviewedRuntimeProfile(
        fixture.runtimePackage,
        fixture.visualAssets,
      ),
    ).toBe("mobile-spz-fine-v1");
    expect(
      isReceptionReviewedProfilePresentationCandidate("mobile-spz-fine-v1"),
    ).toBe(false);
  });

  it("rejects an identity-kind mutation", () => {
    const fixture = qualityFixture();
    const runtimePackage = {
      ...fixture.runtimePackage,
      identityKind: "legacy",
    };

    expect(
      matchReceptionReviewedRuntimeProfile(runtimePackage, fixture.visualAssets),
    ).toBeNull();
  });

  it("rejects a manifest receipt mutation even when the content digest is updated", () => {
    const fixture = qualityFixture();
    const receipts = fixture.runtimePackage.manifestJson.assets.visualAssetReceipts;
    if (receipts === undefined || receipts[0] === undefined) {
      throw new Error("Expected Quality runtime asset receipts.");
    }
    const manifestJson = {
      ...fixture.runtimePackage.manifestJson,
      assets: {
        ...fixture.runtimePackage.manifestJson.assets,
        visualAssetReceipts: receipts.map((receipt, index) =>
          index === 0
            ? { ...receipt, fileName: `mutated-${receipt.fileName}` }
            : receipt
        ),
      },
    };
    const runtimePackage = withCurrentContentDigest({
      ...fixture.runtimePackage,
      manifestJson,
    });

    expect(
      matchReceptionReviewedRuntimeProfile(runtimePackage, fixture.visualAssets),
    ).toBeNull();
  });

  it("rejects a registered-asset order mutation", () => {
    const fixture = qualityFixture();
    const first = fixture.visualAssets[0];
    const second = fixture.visualAssets[1];
    if (first === undefined || second === undefined) {
      throw new Error("Expected at least two Quality runtime assets.");
    }
    const visualAssets = [second, first, ...fixture.visualAssets.slice(2)];

    expect(
      matchReceptionReviewedRuntimeProfile(fixture.runtimePackage, visualAssets),
    ).toBeNull();
  });

  it("rejects a registered-asset byte hash mutation", () => {
    const fixture = qualityFixture();
    const first = requireFirstAsset(fixture.visualAssets);
    const visualAssets = [
      {
        ...first,
        sha256: first.sha256 === "0".repeat(64) ? "1".repeat(64) : "0".repeat(64),
      },
      ...fixture.visualAssets.slice(1),
    ];

    expect(
      matchReceptionReviewedRuntimeProfile(fixture.runtimePackage, visualAssets),
    ).toBeNull();
  });

  it("rejects a registered-asset storage-key mutation", () => {
    const fixture = qualityFixture();
    const first = requireFirstAsset(fixture.visualAssets);
    const visualAssets = [
      { ...first, r2Key: `${first.r2Key}.mutated` },
      ...fixture.visualAssets.slice(1),
    ];

    expect(
      matchReceptionReviewedRuntimeProfile(fixture.runtimePackage, visualAssets),
    ).toBeNull();
  });

  it("rejects a composition mutation even when the content digest is updated", () => {
    const fixture = qualityFixture();
    const compositionBasis = fixture.runtimePackage.manifestJson.compositionBasis;
    if (compositionBasis === undefined) {
      throw new Error("Expected a Quality composition basis.");
    }
    const manifestJson = {
      ...fixture.runtimePackage.manifestJson,
      compositionBasis: {
        ...compositionBasis,
        expectedGaussianCount: compositionBasis.expectedGaussianCount + 1,
      },
    };
    const runtimePackage = withCurrentContentDigest({
      ...fixture.runtimePackage,
      manifestJson,
    });

    expect(
      matchReceptionReviewedRuntimeProfile(runtimePackage, fixture.visualAssets),
    ).toBeNull();
  });

  it("rejects a different room even when package and manifest remain consistent", () => {
    const fixture = qualityFixture();
    const runtimePackage = withCurrentContentDigest({
      ...fixture.runtimePackage,
      roomSlug: "grand-hall",
      manifestJson: {
        ...fixture.runtimePackage.manifestJson,
        roomSlug: "grand-hall",
      },
    });

    expect(
      matchReceptionReviewedRuntimeProfile(runtimePackage, fixture.visualAssets),
    ).toBeNull();
  });

  it("rejects a validly-shaped content digest that does not match the package", () => {
    const fixture = qualityFixture();
    const digest = fixture.runtimePackage.contentDigest;
    if (digest === null) throw new Error("Expected a Quality package content digest.");
    const runtimePackage = {
      ...fixture.runtimePackage,
      contentDigest: `${digest.startsWith("0") ? "1" : "0"}${digest.slice(1)}`,
    };

    expect(
      matchReceptionReviewedRuntimeProfile(runtimePackage, fixture.visualAssets),
    ).toBeNull();
  });
});
