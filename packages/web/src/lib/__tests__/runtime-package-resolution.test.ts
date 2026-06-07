import { describe, it, expect } from "vitest";
import type { AssetEvidenceStatus, RuntimePackage } from "@omnitwin/types";
import {
  decideRuntimeAsset,
  evidenceStatusLabel,
  runtimeRoomTargetFromSearchParams,
} from "../runtime-package-resolution.js";

const ASSET_VERSION_ID = "10000000-0000-4000-8000-000000000001";

function makePackage(overrides: {
  assetUrl?: string | null;
  evidenceStatus?: AssetEvidenceStatus;
  runtimeStatus?: "draft" | "internal_ready" | "published" | "archived";
  assetRuntimeStatus?: "staged" | "usable" | "rejected" | "archived";
  assetKind?: "splat" | "mesh";
} = {}): RuntimePackage {
  const evidenceStatus = overrides.evidenceStatus ?? "machine_checked";
  const runtimeStatus = overrides.runtimeStatus ?? "published";
  const assetRuntimeStatus = overrides.assetRuntimeStatus ?? "usable";
  const assetKind = overrides.assetKind ?? "splat";
  return {
    id: "rp1",
    venueSlug: "trades-hall",
    roomSlug: "robert-adam-room",
    primaryVisualAssetVersionId: ASSET_VERSION_ID,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: "trades-hall",
      roomSlug: "robert-adam-room",
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId: ASSET_VERSION_ID,
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
    },
    evidenceStatus,
    runtimeStatus,
    createdAt: "2026-06-06T10:00:00.000Z",
    updatedAt: "2026-06-06T10:00:00.000Z",
    primaryVisualAssetUrl: overrides.assetUrl === undefined
      ? "https://assets.example/robert-adam-room/scene.ply"
      : overrides.assetUrl,
    primaryVisualAssetVersion: {
      id: ASSET_VERSION_ID,
      venueSlug: "trades-hall",
      roomSlug: "robert-adam-room",
      captureSessionId: null,
      assetKind,
      sourceType: "xgrids",
      r2Key: "venues/trades-hall/rooms/robert-adam-room/xgrids/scene.ply",
      fileName: "scene.ply",
      fileExt: ".ply",
      externalUrl: null,
      mimeType: "application/octet-stream",
      sha256: "a".repeat(64),
      sizeBytes: 2048,
      evidenceStatus,
      runtimeStatus: assetRuntimeStatus,
      notes: null,
      createdAt: "2026-06-06T10:00:00.000Z",
      updatedAt: "2026-06-06T10:00:00.000Z",
    },
  };
}

const FORBIDDEN_PHRASES = [
  "production ready",
  "approved for occupancy",
  "survey-grade",
  "photoreal digital twin",
  "legally compliant",
  "certified safe",
  "fire approved",
  "guaranteed accessible",
  "black label",
];

describe("runtimeRoomTargetFromSearchParams", () => {
  it("defaults to Trades Hall Grand Hall", () => {
    const target = runtimeRoomTargetFromSearchParams(new URLSearchParams());
    expect(target).toMatchObject({
      venue: "trades-hall",
      room: "grand-hall",
      roomLabel: "Grand Hall",
      error: null,
    });
  });

  it("parses supported room query params", () => {
    const robertAdam = runtimeRoomTargetFromSearchParams(new URLSearchParams({
      venue: "trades-hall",
      room: "robert-adam-room",
    }));
    expect(robertAdam.roomLabel).toBe("Robert Adam Room");
    expect(robertAdam.sourceHint).toBe("xgrids");

    const saloon = runtimeRoomTargetFromSearchParams(new URLSearchParams({
      venue: "trades-hall",
      room: "saloon",
    }));
    expect(saloon.roomLabel).toBe("Saloon");
  });

  it("rejects unsupported room params with a fallback target", () => {
    const target = runtimeRoomTargetFromSearchParams(new URLSearchParams({ room: "made-up-room" }));
    expect(target.room).toBe("grand-hall");
    expect(target.error).toMatch(/Unsupported room/i);
  });
});

describe("decideRuntimeAsset", () => {
  it("uses a manual dev URL even when a usable package exists", () => {
    const decision = decideRuntimeAsset("https://manual.example/scene.ply", makePackage());
    expect(decision.source).toBe("manual");
    expect(decision.splatUrl).toBe("https://manual.example/scene.ply");
    expect(decision.isProceduralFallback).toBe(false);
    expect(decision.evidenceStatus).toBeNull();
  });

  it("renders the usable package when there is no manual override", () => {
    const decision = decideRuntimeAsset(null, makePackage({ evidenceStatus: "human_reviewed" }));
    expect(decision.source).toBe("package");
    expect(decision.splatUrl).toBe("https://assets.example/robert-adam-room/scene.ply");
    expect(decision.evidenceStatus).toBe("human_reviewed");
    expect(decision.isProceduralFallback).toBe(false);
  });

  it("falls back when no runtime package exists", () => {
    const decision = decideRuntimeAsset(null, null);
    expect(decision.source).toBe("none");
    expect(decision.splatUrl).toBeNull();
    expect(decision.isProceduralFallback).toBe(true);
    expect(decision.evidenceLabel).toBe("No real asset loaded yet");
  });

  it("falls back when a package exists but object storage URL is unresolved", () => {
    const decision = decideRuntimeAsset(null, makePackage({ assetUrl: null }));
    expect(decision.source).toBe("none");
    expect(decision.splatUrl).toBeNull();
  });

  it("falls back for staged packages and staged primary assets", () => {
    expect(decideRuntimeAsset(null, makePackage({ runtimeStatus: "draft" })).source).toBe("none");
    expect(decideRuntimeAsset(null, makePackage({ assetRuntimeStatus: "staged" })).source).toBe("none");
  });

  it("does not treat fixture/demo URLs as package runtime assets", () => {
    const decision = decideRuntimeAsset(null, makePackage({
      assetUrl: "https://assets.example/dev/splat-fixture/scene.ply",
    }));
    expect(decision.source).toBe("none");
    expect(decision.splatUrl).toBeNull();
  });

  it("does not treat non-splat primary assets as package runtime assets", () => {
    const decision = decideRuntimeAsset(null, makePackage({
      assetKind: "mesh",
      assetUrl: "https://assets.example/mesh.glb",
    }));
    expect(decision.source).toBe("none");
    expect(decision.splatUrl).toBeNull();
  });
});

describe("evidenceStatusLabel", () => {
  it("returns an honest label for each status", () => {
    expect(evidenceStatusLabel("unverified")).toBe("Runtime asset loaded, not yet verified/signed");
    expect(evidenceStatusLabel("machine_checked")).toMatch(/machine checked/i);
    expect(evidenceStatusLabel("human_reviewed")).toMatch(/human reviewed/i);
  });

  it("never emits unsafe public claim phrases", () => {
    const statuses: AssetEvidenceStatus[] = ["unverified", "machine_checked", "human_reviewed"];
    const labels = [
      ...statuses.map((status) => evidenceStatusLabel(status)),
      decideRuntimeAsset("https://m/x.ply", null).evidenceLabel,
      decideRuntimeAsset(null, null).evidenceLabel,
      decideRuntimeAsset(null, makePackage({
        assetUrl: "https://assets.example/dev/splat-fixture/scene.ply",
      })).evidenceLabel,
    ];

    for (const label of labels) {
      const lower = label.toLowerCase();
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(lower).not.toContain(phrase);
      }
    }
  });
});
