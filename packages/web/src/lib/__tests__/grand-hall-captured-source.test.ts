import { describe, expect, it } from "vitest";
import {
  RuntimePackagePreviewSchema,
  RuntimePackageSchema,
  type RuntimePackage,
  type RuntimePackagePreview,
} from "@omnitwin/types";
import {
  GRAND_HALL_CAPTURED_SOG_MEMBERS,
  validateGrandHallCapturedPreview,
  validateGrandHallCapturedSource,
} from "../grand-hall-captured-source.js";
import { decideRuntimeAsset } from "../runtime-package-resolution.js";

const ASSET_IDS = GRAND_HALL_CAPTURED_SOG_MEMBERS.map((_, index) =>
  `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

function grandHallPackage(): RuntimePackage {
  const visualAssetReceipts = GRAND_HALL_CAPTURED_SOG_MEMBERS.map((member, index) => ({
    assetVersionId: ASSET_IDS[index] ?? "",
    fileName: member.fileName,
    fileExt: ".sog" as const,
    sha256: member.sha256,
    sizeBytes: member.sizeBytes,
    storageKeySha256: (index + 1).toString(16).padStart(2, "0").repeat(32),
  }));
  const visualAssetUrls = GRAND_HALL_CAPTURED_SOG_MEMBERS.map(
    (member) => `https://assets.example/grand-hall/data/3dgs/${member.fileName}`,
  );
  const firstId = ASSET_IDS[0] ?? "";
  const first = GRAND_HALL_CAPTURED_SOG_MEMBERS[0];
  if (first === undefined) throw new Error("Grand Hall source contract must have a primary member.");

  return {
    id: "grand-hall-runtime-package",
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    primaryVisualAssetVersionId: firstId,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId: firstId,
        visualAssetVersionIds: [...ASSET_IDS],
        visualAssetReceipts,
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
      compositionBasis: {
        decisionId: "grand-hall-big-model-sog-fine-v1",
        decisionRef: "sha256:8e7514e75aa19345dda1955f2cee3f9369339c553c2711c084cd04be4c9c1352",
        hierarchySha256: "927a92699de222e99d2684ca2567a35ab1e523a036461e6e01236b7b77b7f659",
        format: "sog",
        level: "fine",
        lodSelectionPolicy: "authoritative-leaf-nodes-exclude-environment-v1",
        expectedGaussianCount: 6_019_684,
      },
    },
    evidenceStatus: "human_reviewed",
    runtimeStatus: "published",
    createdAt: "2026-08-21T12:00:00.000Z",
    updatedAt: "2026-08-21T12:00:00.000Z",
    primaryVisualAssetVersion: {
      id: firstId,
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      captureSessionId: null,
      assetKind: "splat",
      sourceType: "xgrids",
      r2Key: `venues/trades-hall/rooms/grand-hall/${first.fileName}`,
      fileName: first.fileName,
      fileExt: ".sog",
      externalUrl: null,
      mimeType: "application/octet-stream",
      sha256: first.sha256,
      sizeBytes: first.sizeBytes,
      evidenceStatus: "human_reviewed",
      runtimeStatus: "usable",
      notes: null,
      createdAt: "2026-08-21T12:00:00.000Z",
      updatedAt: "2026-08-21T12:00:00.000Z",
    },
    primaryVisualAssetUrl: visualAssetUrls[0] ?? null,
    visualAssetUrls,
  };
}

function grandHallPreview(): RuntimePackagePreview {
  const pkg = grandHallPackage();
  const receipts = pkg.manifestJson.assets.visualAssetReceipts;
  if (receipts === undefined) throw new Error("Expected exact Grand Hall receipts.");
  return RuntimePackagePreviewSchema.parse({
    scope: "exact_private_runtime_package_preview",
    runtimePackageId: "20000000-0000-4000-8000-000000000001",
    venueSlug: pkg.venueSlug,
    roomSlug: pkg.roomSlug,
    revision: 1,
    identityKind: "content_sha256",
    contentDigest: "c".repeat(64),
    manifestJson: pkg.manifestJson,
    evidenceStatus: pkg.evidenceStatus,
    runtimeStatus: "published",
    reviewedProfileId: null,
    issuedAt: "2026-08-21T12:00:00.000Z",
    visualAssets: receipts.map((receipt) => ({
      assetVersionId: receipt.assetVersionId,
      fileName: receipt.fileName,
      fileExt: receipt.fileExt,
      sha256: receipt.sha256,
      sizeBytes: receipt.sizeBytes,
    })),
  });
}

describe("validateGrandHallCapturedSource", () => {
  it("accepts only the exact ordered 11-member supplied SOG metadata", () => {
    const pkg = RuntimePackageSchema.parse(grandHallPackage());
    expect(validateGrandHallCapturedSource(pkg)).toEqual({ ok: true });
    expect(decideRuntimeAsset(null, pkg).source).toBe("none");
    expect(validateGrandHallCapturedPreview(grandHallPreview())).toEqual({ ok: true });
  });

  it("never treats an exact-looking external URL as byte authority", () => {
    const pkg = grandHallPackage();
    pkg.visualAssetUrls = GRAND_HALL_CAPTURED_SOG_MEMBERS.map(
      (member) => `https://attacker.invalid/arbitrary/${member.fileName}`,
    );
    pkg.primaryVisualAssetUrl = pkg.visualAssetUrls[0] ?? null;

    // Immutable receipt metadata remains valid; URL transport is deliberately
    // ignored and the generic URL renderer is never admitted for Grand Hall.
    expect(validateGrandHallCapturedSource(pkg)).toEqual({ ok: true });
    expect(decideRuntimeAsset(null, pkg)).toMatchObject({
      source: "none",
      splatUrls: [],
    });
  });

  it("rejects an ancestor or environment member added to the fine frontier", () => {
    const pkg = grandHallPackage();
    const receipts = pkg.manifestJson.assets.visualAssetReceipts;
    const ids = pkg.manifestJson.assets.visualAssetVersionIds;
    if (receipts === undefined || ids === undefined) throw new Error("Expected exact receipts.");
    const environmentAssetId = "10000000-0000-4000-8000-000000000099";
    ids.push(environmentAssetId);
    receipts.push({
      assetVersionId: environmentAssetId,
      fileName: "env.sog",
      fileExt: ".sog",
      sha256: "f".repeat(64),
      sizeBytes: 1,
      storageKeySha256: "e".repeat(64),
    });
    expect(validateGrandHallCapturedSource(pkg)).toMatchObject({ ok: false });
    expect(decideRuntimeAsset(null, pkg).source).toBe("none");
  });

  it("rejects reordering even when all member identities remain present", () => {
    const pkg = grandHallPackage();
    const receipts = pkg.manifestJson.assets.visualAssetReceipts;
    const ids = pkg.manifestJson.assets.visualAssetVersionIds;
    if (receipts === undefined || ids === undefined) throw new Error("Expected exact receipts.");
    [receipts[0], receipts[1]] = [receipts[1]!, receipts[0]!];
    [ids[0], ids[1]] = [ids[1]!, ids[0]!];
    [pkg.visualAssetUrls[0], pkg.visualAssetUrls[1]] = [pkg.visualAssetUrls[1]!, pkg.visualAssetUrls[0]!];
    expect(validateGrandHallCapturedSource(pkg)).toMatchObject({ ok: false });
  });

  it("rejects a substituted byte digest or size", () => {
    const digestSwap = grandHallPackage();
    const digestReceipts = digestSwap.manifestJson.assets.visualAssetReceipts;
    if (digestReceipts === undefined || digestReceipts[4] === undefined) throw new Error("Expected exact receipts.");
    digestReceipts[4] = { ...digestReceipts[4], sha256: "f".repeat(64) };
    expect(validateGrandHallCapturedSource(digestSwap)).toMatchObject({ ok: false });

    const sizeSwap = grandHallPackage();
    const sizeReceipts = sizeSwap.manifestJson.assets.visualAssetReceipts;
    if (sizeReceipts === undefined || sizeReceipts[7] === undefined) throw new Error("Expected exact receipts.");
    sizeReceipts[7] = { ...sizeReceipts[7], sizeBytes: sizeReceipts[7].sizeBytes + 1 };
    expect(validateGrandHallCapturedSource(sizeSwap)).toMatchObject({ ok: false });
  });

  it("rejects a mixed codec or a different LOD decision", () => {
    const codecSwap = grandHallPackage();
    const codecReceipts = codecSwap.manifestJson.assets.visualAssetReceipts;
    if (codecReceipts === undefined || codecReceipts[0] === undefined) throw new Error("Expected exact receipts.");
    codecReceipts[0] = { ...codecReceipts[0], fileName: "0_0_0_1_0_1.spz", fileExt: ".spz" };
    expect(validateGrandHallCapturedSource(codecSwap)).toMatchObject({ ok: false });

    const lodSwap = grandHallPackage();
    if (lodSwap.manifestJson.compositionBasis === undefined) throw new Error("Expected composition basis.");
    lodSwap.manifestJson.compositionBasis = {
      ...lodSwap.manifestJson.compositionBasis,
      level: "medium",
    };
    expect(validateGrandHallCapturedSource(lodSwap)).toMatchObject({ ok: false });
  });

  it("rejects preview metadata whose protected member identity is substituted", () => {
    const preview = grandHallPreview();
    const fourth = preview.visualAssets[3];
    if (fourth === undefined) throw new Error("Expected fourth Grand Hall member.");
    preview.visualAssets[3] = { ...fourth, sha256: "f".repeat(64) };
    expect(validateGrandHallCapturedPreview(preview)).toMatchObject({ ok: false });
  });
});
