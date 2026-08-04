import { describe, expect, it, vi } from "vitest";

vi.mock("@omnitwin/reconstruction-foundry", async () =>
  import("./support/reconstruction-foundry-canonical-mock.js")
);
import {
  resolveRuntimeVisualAssetComposition,
  resolveRuntimeVisualAssetUrls,
  type AssetVersionRow,
  type RuntimePackageRow,
} from "../routes/assets.js";

const NOW = new Date("2026-07-13T00:00:00.000Z");
const PRIMARY_ID = "10000000-0000-4000-8000-000000000001";
const LEAF_2_ID = "10000000-0000-4000-8000-000000000002";
const LEAF_3_ID = "10000000-0000-4000-8000-000000000003";

function splatAsset(
  id: string,
  overrides: Partial<AssetVersionRow> = {},
): AssetVersionRow {
  return {
    id,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    captureSessionId: null,
    assetKind: "splat",
    sourceType: "xgrids",
    fileName: `${id}.sog`,
    fileExt: ".sog",
    r2Key: `venues/trades-hall/rooms/reception-room/lcc2/${id}.sog`,
    externalUrl: null,
    mimeType: "application/octet-stream",
    sha256: "a".repeat(64),
    sizeBytes: 1_024,
    evidenceStatus: "machine_checked",
    runtimeStatus: "usable",
    notes: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function runtimePackage(visualAssetVersionIds?: string[]): RuntimePackageRow {
  return {
    id: "10000000-0000-4000-8000-000000000004",
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    revision: 1,
    identityKind: "legacy",
    contentDigest: null,
    primaryVisualAssetVersionId: PRIMARY_ID,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId: PRIMARY_ID,
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
        ...(visualAssetVersionIds === undefined ? {} : { visualAssetVersionIds }),
      },
    },
    evidenceStatus: "machine_checked",
    runtimeStatus: "published",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("resolveRuntimeVisualAssetComposition", () => {
  it("falls back to the exact primary asset for a legacy manifest", () => {
    const primary = splatAsset(PRIMARY_ID);

    expect(resolveRuntimeVisualAssetComposition(runtimePackage(), [primary])).toEqual([primary]);
  });

  it("returns only declared assets in manifest order, not database order", () => {
    const primary = splatAsset(PRIMARY_ID);
    const leaf2 = splatAsset(LEAF_2_ID);
    const leaf3 = splatAsset(LEAF_3_ID);
    const pkg = runtimePackage([LEAF_3_ID, PRIMARY_ID, LEAF_2_ID]);

    expect(resolveRuntimeVisualAssetComposition(pkg, [primary, leaf2, leaf3])).toEqual([
      leaf3,
      primary,
      leaf2,
    ]);
  });

  it("resolves every visual URL in order or fails the complete set", () => {
    const primary = splatAsset(PRIMARY_ID);
    const leaf2 = splatAsset(LEAF_2_ID);
    const origin = "https://api.venviewer.example";

    expect(resolveRuntimeVisualAssetUrls([primary, leaf2], origin)).toEqual([
      `${origin}/assets/runtime-assets/${PRIMARY_ID}/${PRIMARY_ID}.sog`,
      `${origin}/assets/runtime-assets/${LEAF_2_ID}/${LEAF_2_ID}.sog`,
    ]);
    expect(resolveRuntimeVisualAssetUrls([primary, leaf2], null)).toBeNull();
  });

  it("rejects duplicate resolved URLs instead of shrinking the composition", () => {
    const sharedUrl = "https://assets.venviewer.example/reception/shared.sog";

    expect(resolveRuntimeVisualAssetUrls([
      splatAsset(PRIMARY_ID, { r2Key: null, externalUrl: sharedUrl }),
      splatAsset(LEAF_2_ID, { r2Key: null, externalUrl: sharedUrl }),
    ], null)).toBeNull();
  });

  it("rejects a partial composition when a declared asset is unregistered", () => {
    const pkg = runtimePackage([PRIMARY_ID, LEAF_2_ID]);

    expect(resolveRuntimeVisualAssetComposition(pkg, [splatAsset(PRIMARY_ID)])).toBeNull();
  });

  it("rejects undeclared candidate assets instead of inferring room membership", () => {
    const pkg = runtimePackage([PRIMARY_ID, LEAF_2_ID]);

    expect(resolveRuntimeVisualAssetComposition(pkg, [
      splatAsset(PRIMARY_ID),
      splatAsset(LEAF_2_ID),
      splatAsset(LEAF_3_ID),
    ])).toBeNull();
  });

  it.each([
    ["another venue", { venueSlug: "another-venue" }],
    ["another room", { roomSlug: "grand-hall" }],
    ["a non-runtime asset kind", { assetKind: "mesh", fileExt: ".glb", fileName: "leaf.glb", r2Key: "venues/trades-hall/rooms/reception-room/leaf.glb" }],
    ["a staged asset", { runtimeStatus: "staged" }],
    ["a rejected asset", { evidenceStatus: "rejected" }],
    ["an asset without storage", { r2Key: null, externalUrl: null }],
    ["a fixture asset", { r2Key: "dev/splat-fixture/leaf.sog" }],
    ["an unsupported storage extension", { r2Key: "venues/trades-hall/rooms/reception-room/leaf.glb" }],
    ["a mismatched declared extension", { fileExt: ".spz" }],
  ] satisfies readonly (readonly [string, Partial<AssetVersionRow>])[])(
    "rejects %s anywhere in the atomic composition",
    (_label, invalidOverrides) => {
      const pkg = runtimePackage([PRIMARY_ID, LEAF_2_ID]);

      expect(resolveRuntimeVisualAssetComposition(pkg, [
        splatAsset(PRIMARY_ID),
        splatAsset(LEAF_2_ID, invalidOverrides),
      ])).toBeNull();
    },
  );
});
