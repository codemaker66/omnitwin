import { describe, it, expect } from "vitest";
import {
  TRADES_HALL_RUNTIME_ROOMS as SHARED_TRADES_HALL_RUNTIME_ROOMS,
  TRADES_HALL_RUNTIME_ROOM_SLUGS,
  type AssetEvidenceStatus,
  type RuntimePackage,
} from "@omnitwin/types";
import { roomAlignmentIsConfident, roomSplatBundle } from "../../data/room-splat-bundles.js";
import {
  decideRuntimeAsset,
  evidenceStatusLabel,
  plannerRuntimeChipLabel,
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
      plannerRuntimeChipLabel(decideRuntimeAsset(null, null)),
      plannerRuntimeChipLabel(decideRuntimeAsset(null, makePackage({ evidenceStatus: "unverified" }))),
    ];

    for (const label of labels) {
      const lower = label.toLowerCase();
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(lower).not.toContain(phrase);
      }
    }
  });
});

describe("plannerRuntimeChipLabel", () => {
  it("uses the atelier fallback copy when no captured layer resolves", () => {
    expect(plannerRuntimeChipLabel(decideRuntimeAsset(null, null))).toBe(
      "Captured visual layer not yet available — planning on reviewed geometry",
    );
  });

  it("uses the atelier fallback copy when a package exists but is unusable", () => {
    const staged = decideRuntimeAsset(null, makePackage({ assetRuntimeStatus: "staged" }));
    expect(plannerRuntimeChipLabel(staged)).toBe(
      "Captured visual layer not yet available — planning on reviewed geometry",
    );
  });

  it("surfaces the package evidence state when a captured layer is mounted", () => {
    const unverified = decideRuntimeAsset(null, makePackage({ evidenceStatus: "unverified" }));
    expect(plannerRuntimeChipLabel(unverified)).toBe("Runtime asset loaded, not yet verified/signed.");

    const reviewed = decideRuntimeAsset(null, makePackage({ evidenceStatus: "human_reviewed" }));
    expect(plannerRuntimeChipLabel(reviewed)).toBe("Runtime asset loaded, human reviewed.");
  });
});

describe("runtimeAssetViewTransformForRoom", () => {
  it("rotates every captured room from XGRIDS Z-up into the scene's Y-up", () => {
    for (const slug of TRADES_HALL_RUNTIME_ROOM_SLUGS) {
      const transform = runtimeAssetViewTransformForRoom(slug, "staged");
      expect(transform.rotation[0]).toBeCloseTo(-Math.PI / 2);
      expect(transform.rotation[1]).toBe(0);
      expect(transform.rotation[2]).toBe(0);
    }
  });

  it("never scales a room, because captures and the scene are both metric", () => {
    // A scale factor here would mean the capture is not metric or that a room
    // is being squeezed onto a stage it does not fit. Either should stop the
    // pipeline rather than be absorbed into a fudged number, which is what the
    // Reception Room's previous hand-tuned 0.63 was.
    for (const slug of TRADES_HALL_RUNTIME_ROOM_SLUGS) {
      expect(runtimeAssetViewTransformForRoom(slug, "staged").scale).toBe(1);
    }
  });

  it("states where each transform came from instead of presenting it as settled", () => {
    const note = runtimeAssetViewTransformForRoom("reception-room", "staged").note;
    expect(note).toMatch(/derived from/i);
    expect(note).toMatch(/capture/i);
  });

  it("does not claim a reviewed alignment for a whole-floor capture", () => {
    // Robert Adam is a building scan in which the room is only a part, so the
    // derived frame must not read as confirmed.
    expect(roomAlignmentIsConfident("robert-adam-room")).toBe(false);
  });
});

describe("transform is bound to the mounted asset, not the room", () => {
  it("never applies a staged capture's frame to a registered package", () => {
    // The staged transform is derived from one particular XGRIDS walk and is
    // meaningless for any other asset. Applying it to a reviewed, registered
    // package would place that asset using an unrelated capture's origin.
    for (const slug of TRADES_HALL_RUNTIME_ROOM_SLUGS) {
      const transform = runtimeAssetViewTransformForRoom(slug, "package");
      expect(transform.position).toEqual([0, 0, 0]);
      expect(transform.rotation).toEqual([0, 0, 0]);
      expect(transform.scale).toBe(1);
    }
  });

  it("keeps the generic overview camera for a registered package", () => {
    for (const slug of TRADES_HALL_RUNTIME_ROOM_SLUGS) {
      const view = runtimeAssetCameraViewForRoom(slug, "package");
      expect(view.targetBounds).toBeNull();
      expect(view.cameraBounds).toBeNull();
    }
  });

  it("leaves the procedural scene untouched when nothing is mounted", () => {
    for (const slug of TRADES_HALL_RUNTIME_ROOM_SLUGS) {
      expect(runtimeAssetViewTransformForRoom(slug, "none").position).toEqual([0, 0, 0]);
    }
  });
});

describe("runtimeAssetCameraViewForRoom", () => {
  it("keeps every captured room's camera and target inside their own bounds", () => {
    for (const slug of TRADES_HALL_RUNTIME_ROOM_SLUGS) {
      const view = runtimeAssetCameraViewForRoom(slug, "staged");
      const { cameraBounds, targetBounds } = view;
      if (cameraBounds === null || targetBounds === null) {
        throw new Error(`${slug} camera tuning must include runtime bounds.`);
      }
      for (const axis of [0, 1, 2] as const) {
        expect(view.position[axis]).toBeGreaterThanOrEqual(cameraBounds.min[axis]);
        expect(view.position[axis]).toBeLessThanOrEqual(cameraBounds.max[axis]);
        expect(view.target[axis]).toBeGreaterThanOrEqual(targetBounds.min[axis]);
        expect(view.target[axis]).toBeLessThanOrEqual(targetBounds.max[axis]);
      }
    }
  });

  it("keeps every arrival pose inside those same bounds", () => {
    for (const slug of TRADES_HALL_RUNTIME_ROOM_SLUGS) {
      const view = runtimeAssetCameraViewForRoom(slug, "staged");
      const { cameraBounds, targetBounds, arrivalPosition, arrivalTarget } = view;
      if (cameraBounds === null || targetBounds === null) {
        throw new Error(`${slug} camera tuning must include runtime bounds.`);
      }
      if (arrivalPosition === null || arrivalTarget === null) {
        throw new Error(`${slug} camera tuning must include an arrival pose.`);
      }
      for (const axis of [0, 1, 2] as const) {
        expect(arrivalPosition[axis]).toBeGreaterThanOrEqual(cameraBounds.min[axis]);
        expect(arrivalPosition[axis]).toBeLessThanOrEqual(cameraBounds.max[axis]);
        expect(arrivalTarget[axis]).toBeGreaterThanOrEqual(targetBounds.min[axis]);
        expect(arrivalTarget[axis]).toBeLessThanOrEqual(targetBounds.max[axis]);
      }
    }
  });

  it("stays a restrained interior camera rather than a free-flying one", () => {
    for (const slug of TRADES_HALL_RUNTIME_ROOM_SLUGS) {
      const view = runtimeAssetCameraViewForRoom(slug, "staged");
      expect(view.panSpeed).toBeLessThan(1);
      expect(view.rotateSpeed).toBeLessThan(1);
      expect(view.zoomSpeed).toBeLessThan(1);
      expect(view.dampingFactor).toBeGreaterThan(0);
      expect(view.minPolarAngle).toBeGreaterThan(0);
      expect(view.maxPolarAngle).toBeLessThan(Math.PI / 2);
    }
  });

  it("never places the camera above a low room's ceiling", () => {
    for (const slug of TRADES_HALL_RUNTIME_ROOM_SLUGS) {
      const bundle = roomSplatBundle(slug);
      if (bundle === null) continue;
      const view = runtimeAssetCameraViewForRoom(slug, "staged");
      expect(view.position[1]).toBeLessThan(bundle.extentM[1]);
    }
  });

  it("stands further back for a larger room", () => {
    const reception = runtimeAssetCameraViewForRoom("reception-room", "staged");
    const grandHall = runtimeAssetCameraViewForRoom("grand-hall", "staged");
    expect(grandHall.position[2]).toBeGreaterThan(reception.position[2]);
  });
});
