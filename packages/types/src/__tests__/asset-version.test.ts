import { describe, it, expect } from "vitest";
import {
  AssetVersionSchema,
  LatestRuntimePackageQuerySchema,
  RegisterAssetVersionInputSchema,
  RegisterRuntimePackageInputSchema,
  RoomManifestSchema,
  RuntimePackageManifestJsonSchema,
  RuntimePackageSchema,
  assetKindAllowsExtension,
  isForbiddenAssetFixtureKey,
  isR2ObjectKeyShape,
  runtimeFileExtensionForKey,
  splatExtensionForKey,
} from "../asset-version.js";

const ASSET_VERSION_ID = "10000000-0000-4000-8000-000000000001";
const SEMANTIC_ASSET_VERSION_ID = "10000000-0000-4000-8000-000000000002";
const COLLISION_ASSET_VERSION_ID = "10000000-0000-4000-8000-000000000003";
const SHA = "a".repeat(64);
const R2_KEY = "venues/trades-hall/rooms/robert-adam-room/xgrids/2026-06-06/scene.ply";

const manifestJson = {
  schemaVersion: "venviewer.runtime-package.v1" as const,
  venueSlug: "trades-hall",
  roomSlug: "robert-adam-room",
  packageType: "room-runtime" as const,
  assets: {
    primaryVisualAssetVersionId: ASSET_VERSION_ID,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
  },
  generatedAt: "2026-06-06T10:00:00.000Z",
};

const validVersionInput = {
  venueSlug: "trades-hall",
  roomSlug: "robert-adam-room",
  assetKind: "splat" as const,
  sourceType: "xgrids" as const,
  r2Key: R2_KEY,
  fileName: "scene.ply",
  fileExt: ".ply" as const,
  sha256: SHA,
  sizeBytes: 2_048,
};

describe("runtime file extension helpers", () => {
  it("returns the extension for supported runtime asset files", () => {
    expect(runtimeFileExtensionForKey("a/b/scene.ply")).toBe(".ply");
    expect(runtimeFileExtensionForKey("a/b/scene.spz")).toBe(".spz");
    expect(runtimeFileExtensionForKey("a/SCENE.SPLAT")).toBe(".splat");
    expect(runtimeFileExtensionForKey("a/scene.glb")).toBe(".glb");
    expect(runtimeFileExtensionForKey("a/cloud.e57")).toBe(".e57");
    expect(runtimeFileExtensionForKey("a/manifest.json")).toBe(".json");
  });

  it("separates Spark splat extensions from broader registry formats", () => {
    expect(splatExtensionForKey("a/b/scene.ply")).toBe(".ply");
    expect(splatExtensionForKey("a/b/scene.spz?signature=abc")).toBe(".spz");
    expect(splatExtensionForKey("a/b/scene.glb")).toBeNull();
  });

  it("pins asset kind to allowed file formats", () => {
    expect(assetKindAllowsExtension("splat", ".ply")).toBe(true);
    expect(assetKindAllowsExtension("mesh", ".glb")).toBe(true);
    expect(assetKindAllowsExtension("mesh", ".ply")).toBe(false);
    expect(assetKindAllowsExtension("video", ".json")).toBe(false);
  });
});

describe("R2 key and fixture rejection", () => {
  it("accepts object keys and rejects URLs/root-relative paths", () => {
    expect(isR2ObjectKeyShape(R2_KEY)).toBe(true);
    expect(isR2ObjectKeyShape("https://assets.example/scene.ply")).toBe(false);
    expect(isR2ObjectKeyShape("/venues/trades-hall/scene.ply")).toBe(false);
    expect(isR2ObjectKeyShape("venues/trades-hall/../scene.ply")).toBe(false);
    expect(isR2ObjectKeyShape("venues\\trades-hall\\scene.ply")).toBe(false);
  });

  it("flags fixture/demo markers regardless of case", () => {
    expect(isForbiddenAssetFixtureKey("dev/Splat-Fixture/scene.spz")).toBe(true);
    expect(isForbiddenAssetFixtureKey("dev/textsplats/x.ply")).toBe(true);
    expect(isForbiddenAssetFixtureKey("a/spark-fixture/y.splat")).toBe(true);
    expect(isForbiddenAssetFixtureKey(R2_KEY)).toBe(false);
  });
});

describe("RegisterAssetVersionInputSchema", () => {
  it("accepts a room-scoped XGRIDS splat and applies safe defaults", () => {
    const parsed = RegisterAssetVersionInputSchema.parse(validVersionInput);
    expect(parsed.venueSlug).toBe("trades-hall");
    expect(parsed.roomSlug).toBe("robert-adam-room");
    expect(parsed.evidenceStatus).toBe("unverified");
    expect(parsed.runtimeStatus).toBe("staged");
  });

  it("accepts a master scan with a nullable room slug", () => {
    const parsed = RegisterAssetVersionInputSchema.parse({
      ...validVersionInput,
      roomSlug: null,
      assetKind: "point_cloud",
      fileName: "master.e57",
      fileExt: ".e57",
      r2Key: "venues/trades-hall/master/matterport/master.e57",
      sourceType: "matterport",
    });
    expect(parsed.roomSlug).toBeNull();
  });

  it("rejects fixture/demo asset keys", () => {
    const result = RegisterAssetVersionInputSchema.safeParse({
      ...validVersionInput,
      r2Key: "dev/splat-fixture/scene.ply",
    });
    expect(result.success).toBe(false);
  });

  it("rejects arbitrary URL registration", () => {
    const result = RegisterAssetVersionInputSchema.safeParse({
      ...validVersionInput,
      r2Key: "https://assets.example/scene.ply",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a file extension that does not match the R2 key", () => {
    const result = RegisterAssetVersionInputSchema.safeParse({
      ...validVersionInput,
      fileExt: ".spz",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a format not allowed for the asset kind", () => {
    const result = RegisterAssetVersionInputSchema.safeParse({
      ...validVersionInput,
      assetKind: "mesh",
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed hashes and unknown statuses", () => {
    expect(RegisterAssetVersionInputSchema.safeParse({ ...validVersionInput, sha256: "nope" }).success).toBe(false);
    expect(RegisterAssetVersionInputSchema.safeParse({ ...validVersionInput, runtimeStatus: "published" }).success).toBe(false);
    expect(RegisterAssetVersionInputSchema.safeParse({ ...validVersionInput, evidenceStatus: "certified" }).success).toBe(false);
  });
});

describe("runtime package manifest schemas", () => {
  it("accepts a strict v1 manifest", () => {
    const parsed = RuntimePackageManifestJsonSchema.parse(manifestJson);
    expect(parsed.assets.primaryVisualAssetVersionId).toBe(ASSET_VERSION_ID);
  });

  it("rejects unknown manifest fields", () => {
    const result = RuntimePackageManifestJsonSchema.safeParse({
      ...manifestJson,
      arbitraryClaim: true,
    });
    expect(result.success).toBe(false);
  });

  it("requires package fields to match manifest fields", () => {
    const result = RegisterRuntimePackageInputSchema.safeParse({
      venueSlug: "trades-hall",
      roomSlug: "saloon",
      primaryVisualAssetVersionId: ASSET_VERSION_ID,
      manifestJson,
      runtimeStatus: "usable",
    });
    expect(result.success).toBe(false);
  });

  it("requires a primary visual asset before a package can be usable", () => {
    const result = RegisterRuntimePackageInputSchema.safeParse({
      venueSlug: "trades-hall",
      roomSlug: "saloon",
      primaryVisualAssetVersionId: null,
      manifestJson: {
        ...manifestJson,
        roomSlug: "saloon",
        assets: {
          primaryVisualAssetVersionId: null,
          semanticMeshAssetVersionId: null,
          collisionAssetVersionId: null,
        },
      },
      runtimeStatus: "usable",
    });
    expect(result.success).toBe(false);
  });
});

describe("response schemas", () => {
  const assetVersion = {
    id: ASSET_VERSION_ID,
    venueSlug: "trades-hall",
    roomSlug: "robert-adam-room",
    captureSessionId: null,
    assetKind: "splat",
    sourceType: "xgrids",
    r2Key: R2_KEY,
    fileName: "scene.ply",
    fileExt: ".ply",
    externalUrl: null,
    mimeType: "application/octet-stream",
    sha256: SHA,
    sizeBytes: 2048,
    evidenceStatus: "machine_checked",
    runtimeStatus: "usable",
    notes: null,
    createdAt: "2026-06-06T10:00:00.000Z",
    updatedAt: "2026-06-06T10:00:00.000Z",
  };

  it("parses AssetVersion, RoomManifest, and RuntimePackage API shapes", () => {
    expect(AssetVersionSchema.parse(assetVersion).runtimeStatus).toBe("usable");

    expect(RoomManifestSchema.parse({
      id: "rm1",
      venueSlug: "trades-hall",
      roomSlug: "saloon",
      displayName: "Saloon",
      matterportMasterReference: null,
      alignmentStatus: "approximate",
      primaryCaptureSource: null,
      notes: null,
      createdAt: "2026-06-06T10:00:00.000Z",
      updatedAt: "2026-06-06T10:00:00.000Z",
    }).roomSlug).toBe("saloon");

    const pkg = RuntimePackageSchema.parse({
      id: "rp1",
      venueSlug: "trades-hall",
      roomSlug: "robert-adam-room",
      primaryVisualAssetVersionId: ASSET_VERSION_ID,
      semanticMeshAssetVersionId: null,
      collisionAssetVersionId: null,
      pointCloudAssetVersionId: null,
      manifestJson,
      evidenceStatus: "machine_checked",
      runtimeStatus: "internal_ready",
      createdAt: "2026-06-06T10:00:00.000Z",
      updatedAt: "2026-06-06T10:00:00.000Z",
      primaryVisualAssetVersion: assetVersion,
      primaryVisualAssetUrl: "https://assets.example/scene.ply",
    });
    expect(pkg.primaryVisualAssetVersion?.sourceType).toBe("xgrids");
  });

  it("parses the latest runtime package room query", () => {
    expect(LatestRuntimePackageQuerySchema.parse({
      venue: "trades-hall",
      room: "grand-hall",
    }).room).toBe("grand-hall");
  });

  it("pins semantic/collision ids in the manifest when present", () => {
    const result = RegisterRuntimePackageInputSchema.safeParse({
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      primaryVisualAssetVersionId: ASSET_VERSION_ID,
      semanticMeshAssetVersionId: SEMANTIC_ASSET_VERSION_ID,
      collisionAssetVersionId: COLLISION_ASSET_VERSION_ID,
      manifestJson: {
        ...manifestJson,
        roomSlug: "grand-hall",
        assets: {
          primaryVisualAssetVersionId: ASSET_VERSION_ID,
          semanticMeshAssetVersionId: SEMANTIC_ASSET_VERSION_ID,
          collisionAssetVersionId: COLLISION_ASSET_VERSION_ID,
          pointCloudAssetVersionId: null,
        },
      },
      runtimeStatus: "draft",
    });
    expect(result.success).toBe(true);
  });
});
