import { describe, expect, it } from "vitest";
import { RegisterRuntimePackageInputSchema } from "@omnitwin/types";
import { runtimeAssetStorageKeySha256 } from "../lib/runtime-asset-receipt.js";
import {
  validateRuntimeVisualAssetReceipts,
  type AssetVersionRow,
} from "../routes/assets.js";

const ASSET_ID = "10000000-0000-4000-8000-000000000001";
const KEY = "venues/trades-hall/rooms/reception-room/quality/member.sog";
const SHA256 = "a".repeat(64);
const NOW = new Date("2026-07-14T12:00:00.000Z");

const asset: AssetVersionRow = {
  id: ASSET_ID,
  venueSlug: "trades-hall",
  roomSlug: "reception-room",
  captureSessionId: null,
  assetKind: "splat",
  sourceType: "xgrids",
  r2Key: KEY,
  fileName: "member.sog",
  fileExt: ".sog",
  externalUrl: null,
  mimeType: "application/octet-stream",
  sha256: SHA256,
  sizeBytes: 1_024,
  evidenceStatus: "machine_checked",
  runtimeStatus: "usable",
  notes: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function input(storageKeySha256 = runtimeAssetStorageKeySha256(KEY)) {
  return RegisterRuntimePackageInputSchema.parse({
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    primaryVisualAssetVersionId: ASSET_ID,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId: ASSET_ID,
        visualAssetVersionIds: [ASSET_ID],
        visualAssetReceipts: [{
          assetVersionId: ASSET_ID,
          fileName: asset.fileName,
          fileExt: ".sog",
          sha256: SHA256,
          sizeBytes: asset.sizeBytes,
          storageKeySha256,
        }],
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
    },
    evidenceStatus: "machine_checked",
    runtimeStatus: "internal_ready",
  });
}

describe("runtime visual asset receipt admission", () => {
  it("accepts the exact registered member and rejects a changed storage identity", () => {
    expect(validateRuntimeVisualAssetReceipts(input(), [asset])).toBeNull();
    expect(validateRuntimeVisualAssetReceipts(input("b".repeat(64)), [asset])).toContain(
      "does not match",
    );
  });
});
