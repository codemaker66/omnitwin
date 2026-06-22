import { describe, it, expect } from "vitest";
import {
  TRADES_HALL_RUNTIME_ROOMS as SHARED_TRADES_HALL_RUNTIME_ROOMS,
  type AssetEvidenceStatus,
  type RuntimePackage,
} from "@omnitwin/types";
import {
  decideRuntimeAsset,
  evidenceStatusLabel,
  runtimeAssetCameraViewForRoom,
  runtimeAssetViewTransformForRoom,
  runtimeRoomTargetFromSearchParams,
} from "../runtime-package-resolution.js";

const ASSET_VERSION_ID = "10000000-0000-4000-8000-000000000001";

function makePackage(overrides: {
  assetUrl?: string | null;
  evidenceStatus?: AssetEvidenceStatus;
  runtimeStatus?: "draft" | "internal_ready" | "published" | "archived";
  assetRuntimeStatus?: "staged" | "usable" | "rejected" | "archived";
  assetKind?: "splat" | "mesh";
  assetFileExt?: ".ply" | ".spz" | ".sog";
  assetFileName?: string;
} = {}): RuntimePackage {
  const evidenceStatus = overrides.evidenceStatus ?? "machine_checked";
  const runtimeStatus = overrides.runtimeStatus ?? "published";
  const assetRuntimeStatus = overrides.assetRuntimeStatus ?? "usable";
  const assetKind = overrides.assetKind ?? "splat";
  const assetFileExt = overrides.assetFileExt ?? ".ply";
  const assetFileName = overrides.assetFileName ?? "scene.ply";
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
    visualAssetUrls: [],
    primaryVisualAssetVersion: {
      id: ASSET_VERSION_ID,
      venueSlug: "trades-hall",
      roomSlug: "robert-adam-room",
      captureSessionId: null,
      assetKind,
      sourceType: "xgrids",
      r2Key: `venues/trades-hall/rooms/robert-adam-room/xgrids/${assetFileName}`,
      fileName: assetFileName,
      fileExt: assetFileExt,
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

    const reception = runtimeRoomTargetFromSearchParams(new URLSearchParams({
      venue: "trades-hall",
      room: "reception-room",
    }));
    expect(reception.roomLabel).toBe("Reception Room");
  });

  it("stays aligned with every shared Trades Hall runtime room", () => {
    for (const room of SHARED_TRADES_HALL_RUNTIME_ROOMS) {
      const target = runtimeRoomTargetFromSearchParams(new URLSearchParams({
        venue: "trades-hall",
        room: room.slug,
      }));
      expect(target).toMatchObject({
        venue: "trades-hall",
        room: room.slug,
        roomLabel: room.displayName,
        sourceHint: room.primaryCaptureSource,
        error: null,
      });
    }
  });

  it("rejects unsupported room params with a fallback target", () => {
    const target = runtimeRoomTargetFromSearchParams(new URLSearchParams({ room: "made-up-room" }));
    expect(target.room).toBe("grand-hall");
    expect(target.error).toMatch(/Unsupported room/i);
  });
});

describe("decideRuntimeAsset", () => {
  it("ignores manual URLs and uses registered packages only", () => {
    const decision = decideRuntimeAsset("https://manual.example/scene.ply", makePackage());
    expect(decision.source).toBe("package");
    expect(decision.splatUrl).toBe("https://assets.example/robert-adam-room/scene.ply");
    expect(decision.splatUrls).toEqual(["https://assets.example/robert-adam-room/scene.ply"]);
    expect(decision.isProceduralFallback).toBe(false);
    expect(decision.evidenceStatus).toBe("machine_checked");
  });

  it("renders the usable registered package", () => {
    const decision = decideRuntimeAsset(null, makePackage({ evidenceStatus: "human_reviewed" }));
    expect(decision.source).toBe("package");
    expect(decision.splatUrl).toBe("https://assets.example/robert-adam-room/scene.ply");
    expect(decision.splatUrls).toEqual(["https://assets.example/robert-adam-room/scene.ply"]);
    expect(decision.evidenceStatus).toBe("human_reviewed");
    expect(decision.isProceduralFallback).toBe(false);
  });

  it("allows a registered SOG runtime package for XGRIDS output", () => {
    const decision = decideRuntimeAsset(null, makePackage({
      assetUrl: "https://assets.example/reception-room/data/3dgs/0_1_0.sog",
    }));
    expect(decision.source).toBe("package");
    expect(decision.splatUrl).toBe("https://assets.example/reception-room/data/3dgs/0_1_0.sog");
    expect(decision.evidenceLabel).toMatch(/runtime asset loaded/i);
  });

  it("prefers a validated SOG chunk set over the primary visual URL", () => {
    const decision = decideRuntimeAsset(null, {
      ...makePackage({
        assetUrl: "https://assets.example/reception-room/data/3dgs/0_1_0.sog",
      }),
      visualAssetUrls: [
        "https://assets.example/reception-room/data/3dgs/0_0.sog",
        "https://assets.example/reception-room/data/3dgs/0_1_0.sog",
        "https://assets.example/reception-room/data/3dgs/0_1_0.sog",
        "https://assets.example/dev/text-splats/0_2.sog",
      ],
    });

    expect(decision.splatUrls).toEqual([
      "https://assets.example/reception-room/data/3dgs/0_0.sog",
      "https://assets.example/reception-room/data/3dgs/0_1_0.sog",
    ]);
  });

  it("uses the registered Reception Room SPZ visual chunks with unverified copy", () => {
    const decision = decideRuntimeAsset(null, {
      ...makePackage({
        assetUrl: "https://assets.example/reception-room/lcc2-result-spz/data/3dgs/0_0.spz",
        evidenceStatus: "unverified",
        assetFileExt: ".spz",
        assetFileName: "0_0.spz",
      }),
      roomSlug: "reception-room",
      visualAssetUrls: [
        "https://assets.example/reception-room/lcc2-result-spz/data/3dgs/0_0.spz",
        "https://assets.example/reception-room/lcc2-result-spz/data/3dgs/0_13_0_0.spz",
      ],
    });

    expect(decision.source).toBe("package");
    expect(decision.splatUrl).toBe("https://assets.example/reception-room/lcc2-result-spz/data/3dgs/0_0.spz");
    expect(decision.splatUrls).toEqual([
      "https://assets.example/reception-room/lcc2-result-spz/data/3dgs/0_0.spz",
      "https://assets.example/reception-room/lcc2-result-spz/data/3dgs/0_13_0_0.spz",
    ]);
    expect(decision.splatUrls.every((url) => url.endsWith(".spz"))).toBe(true);
    expect(decision.evidenceStatus).toBe("unverified");
    expect(decision.evidenceLabel).toBe("Runtime asset loaded, not yet verified/signed.");
  });

  it("falls back when no runtime package exists", () => {
    const decision = decideRuntimeAsset(null, null);
    expect(decision.source).toBe("none");
    expect(decision.splatUrl).toBeNull();
    expect(decision.splatUrls).toEqual([]);
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

    const demoDecision = decideRuntimeAsset(null, makePackage({
      assetUrl: "https://assets.example/dev/demo/scene.ply",
    }));
    expect(demoDecision.source).toBe("none");
    expect(demoDecision.splatUrl).toBeNull();
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
    expect(evidenceStatusLabel("unverified")).toBe("Runtime asset loaded, not yet verified/signed.");
    expect(evidenceStatusLabel("machine_checked")).toBe("Runtime asset loaded, machine checked; human review required.");
    expect(evidenceStatusLabel("human_reviewed")).toBe("Runtime asset loaded, human reviewed.");
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

describe("runtimeAssetViewTransformForRoom", () => {
  it("uses an approximate Z-up to Y-up transform for the Reception Room XGRIDS runtime package", () => {
    const transform = runtimeAssetViewTransformForRoom("reception-room");
    expect(transform.rotation[0]).toBeCloseTo(-Math.PI / 2);
    expect(transform.scale).toBeCloseTo(0.63);
    expect(transform.note).toMatch(/visual QA/i);
  });

  it("does not invent transforms for rooms without registered visual alignment", () => {
    const transform = runtimeAssetViewTransformForRoom("grand-hall");
    expect(transform).toMatchObject({
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
    });
  });
});

describe("runtimeAssetCameraViewForRoom", () => {
  it("starts the Reception Room from a bounded cinematic interior inspection camera", () => {
    const cameraView = runtimeAssetCameraViewForRoom("reception-room");
    expect(cameraView.position[1]).toBeLessThan(20);
    expect(cameraView.position[2]).toBeLessThan(22);
    expect(cameraView.target[2]).toBeLessThan(0);
    expect(cameraView.arrivalPosition).toEqual([0.25, 7.15, 14.1]);
    expect(cameraView.arrivalTarget).toEqual([0, 1.2, -4]);
    expect(cameraView.arrivalDurationMs).toBe(1400);
    expect(cameraView.fov).toBeGreaterThanOrEqual(46);
    expect(cameraView.minDistance).toBeLessThanOrEqual(1.25);
    expect(cameraView.maxDistance).toBeLessThanOrEqual(14);
    expect(cameraView.panSpeed).toBeLessThan(1);
    expect(cameraView.rotateSpeed).toBeLessThan(1);
    expect(cameraView.zoomSpeed).toBeLessThan(1);
    expect(cameraView.dampingFactor).toBeGreaterThan(0);
    expect(cameraView.dampingFactor).toBeLessThanOrEqual(0.14);
    expect(cameraView.minPolarAngle).toBeGreaterThan(0);
    expect(cameraView.maxPolarAngle).toBeLessThan(Math.PI / 2);
    expect(cameraView.targetBounds).not.toBeNull();
    expect(cameraView.cameraBounds).not.toBeNull();
    if (cameraView.targetBounds === null || cameraView.cameraBounds === null) {
      throw new Error("Reception Room camera tuning must include runtime bounds.");
    }
    expect(cameraView.position[0]).toBeGreaterThanOrEqual(cameraView.cameraBounds.min[0]);
    expect(cameraView.position[0]).toBeLessThanOrEqual(cameraView.cameraBounds.max[0]);
    expect(cameraView.position[1]).toBeGreaterThanOrEqual(cameraView.cameraBounds.min[1]);
    expect(cameraView.position[1]).toBeLessThanOrEqual(cameraView.cameraBounds.max[1]);
    expect(cameraView.position[2]).toBeGreaterThanOrEqual(cameraView.cameraBounds.min[2]);
    expect(cameraView.position[2]).toBeLessThanOrEqual(cameraView.cameraBounds.max[2]);
    expect(cameraView.target[0]).toBeGreaterThanOrEqual(cameraView.targetBounds.min[0]);
    expect(cameraView.target[0]).toBeLessThanOrEqual(cameraView.targetBounds.max[0]);
    expect(cameraView.target[1]).toBeGreaterThanOrEqual(cameraView.targetBounds.min[1]);
    expect(cameraView.target[1]).toBeLessThanOrEqual(cameraView.targetBounds.max[1]);
    expect(cameraView.target[2]).toBeGreaterThanOrEqual(cameraView.targetBounds.min[2]);
    expect(cameraView.target[2]).toBeLessThanOrEqual(cameraView.targetBounds.max[2]);
    if (cameraView.arrivalPosition === null || cameraView.arrivalTarget === null) {
      throw new Error("Reception Room camera tuning must include a cinematic arrival pose.");
    }
    expect(cameraView.arrivalPosition[0]).toBeGreaterThanOrEqual(cameraView.cameraBounds.min[0]);
    expect(cameraView.arrivalPosition[0]).toBeLessThanOrEqual(cameraView.cameraBounds.max[0]);
    expect(cameraView.arrivalPosition[1]).toBeGreaterThanOrEqual(cameraView.cameraBounds.min[1]);
    expect(cameraView.arrivalPosition[1]).toBeLessThanOrEqual(cameraView.cameraBounds.max[1]);
    expect(cameraView.arrivalPosition[2]).toBeGreaterThanOrEqual(cameraView.cameraBounds.min[2]);
    expect(cameraView.arrivalPosition[2]).toBeLessThanOrEqual(cameraView.cameraBounds.max[2]);
    expect(cameraView.arrivalTarget[0]).toBeGreaterThanOrEqual(cameraView.targetBounds.min[0]);
    expect(cameraView.arrivalTarget[0]).toBeLessThanOrEqual(cameraView.targetBounds.max[0]);
    expect(cameraView.arrivalTarget[1]).toBeGreaterThanOrEqual(cameraView.targetBounds.min[1]);
    expect(cameraView.arrivalTarget[1]).toBeLessThanOrEqual(cameraView.targetBounds.max[1]);
    expect(cameraView.arrivalTarget[2]).toBeGreaterThanOrEqual(cameraView.targetBounds.min[2]);
    expect(cameraView.arrivalTarget[2]).toBeLessThanOrEqual(cameraView.targetBounds.max[2]);
    expect(cameraView.note).toMatch(/interior/i);
  });

  it("keeps an overview camera for rooms without registered runtime camera tuning", () => {
    const cameraView = runtimeAssetCameraViewForRoom("grand-hall");
    expect(cameraView).toMatchObject({
      position: [0, 20, 22],
      target: [0, 1.8, 0],
      arrivalPosition: null,
      arrivalTarget: null,
      arrivalDurationMs: 0,
      fov: 42,
      minDistance: 1.5,
      maxDistance: 34,
      panSpeed: 0.8,
      rotateSpeed: 1,
      zoomSpeed: 1,
      dampingFactor: 0.14,
      minPolarAngle: 0,
      maxPolarAngle: Math.PI * 0.49,
      targetBounds: null,
      cameraBounds: null,
    });
  });
});
