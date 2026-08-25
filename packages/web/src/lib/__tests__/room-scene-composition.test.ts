import { describe, expect, it } from "vitest";
import type { RoomSceneLayerLoadState } from "../room-scene-composition.js";
import {
  layerStateForRoomResolve,
  resolveRoomSceneComposition,
} from "../room-scene-composition.js";
import { createGrandHallRoomSceneManifest } from "../grand-hall-room-scene.js";
import { syntheticGrandHallRoomOnlyEvidence } from "../../test-fixtures/grand-hall-room-only-evidence.js";

const PACKAGE_ID = "22222222-2222-4222-8222-222222222222";
const EVIDENCE = syntheticGrandHallRoomOnlyEvidence();

describe("resolveRoomSceneComposition", () => {
  it("renders captured appearance by default and never substitutes the proxy when it fails", () => {
    const manifest = createGrandHallRoomSceneManifest(PACKAGE_ID, EVIDENCE);
    const failed: Readonly<Record<string, RoomSceneLayerLoadState>> = {
      "grand-hall-captured-appearance": {
        status: "failed",
        loadedUnits: 7,
        totalUnits: 11,
      },
      "grand-hall-pose-envelope": {
        status: "ready",
        loadedUnits: 1,
        totalUnits: 1,
      },
    };
    const result = resolveRoomSceneComposition(manifest, {
      presentation: "appearance",
      layerStates: failed,
    });

    expect(result.visibleLayerIds).toEqual(["grand-hall-captured-appearance"]);
    expect(result.visibleLayerIds).not.toContain("grand-hall-pose-envelope");
    expect(result.activeLoadState.status).toBe("failed");
  });

  it("shows only the explicit structural diagnostic when selected", () => {
    const manifest = createGrandHallRoomSceneManifest(PACKAGE_ID, EVIDENCE);
    const result = resolveRoomSceneComposition(manifest, {
      presentation: "structural-proxy",
      layerStates: {
        "grand-hall-pose-envelope": {
          status: "ready",
          loadedUnits: 1,
          totalUnits: 1,
        },
      },
    });

    expect(result.visibleLayerIds).toEqual(["grand-hall-pose-envelope"]);
    expect(result.activeLoadState.status).toBe("ready");
  });

  it("maps actual atomic layer state into Room Resolves input", () => {
    expect(layerStateForRoomResolve({ status: "loading", loadedUnits: 4, totalUnits: 11 })).toEqual({
      splatStatus: "loaded",
      hasAsset: true,
      totalChunks: 11,
      loadedChunks: 4,
      failedChunks: 0,
      atomicReady: false,
    });
    expect(layerStateForRoomResolve({ status: "ready", loadedUnits: 11, totalUnits: 11 })).toEqual({
      splatStatus: "loaded",
      hasAsset: true,
      totalChunks: 11,
      loadedChunks: 11,
      failedChunks: 0,
      atomicReady: true,
    });
    expect(layerStateForRoomResolve({ status: "ready", loadedUnits: 7, totalUnits: 11 })).toEqual({
      splatStatus: "loaded",
      hasAsset: true,
      totalChunks: 11,
      loadedChunks: 7,
      failedChunks: 4,
      atomicReady: false,
    });
  });

  it("aggregates every visible appearance-related layer before resolving", () => {
    const manifest = createGrandHallRoomSceneManifest(PACKAGE_ID, EVIDENCE);
    const appearance = manifest.layerDescriptors[0];
    if (appearance === undefined) throw new Error("Expected captured appearance layer.");
    const layeredManifest = {
      ...manifest,
      layerDescriptors: [
        ...manifest.layerDescriptors,
        { ...appearance, id: "grand-hall-hero-diagnostic", kind: "HeroVolume" as const },
      ],
    };
    const result = resolveRoomSceneComposition(layeredManifest, {
      presentation: "appearance",
      layerStates: {
        "grand-hall-captured-appearance": { status: "ready", loadedUnits: 11, totalUnits: 11 },
        "grand-hall-hero-diagnostic": { status: "failed", loadedUnits: 0, totalUnits: 1 },
      },
    });

    expect(result.visibleLayerIds).toEqual([
      "grand-hall-captured-appearance",
      "grand-hall-hero-diagnostic",
    ]);
    expect(result.activeLoadState).toEqual({
      status: "failed",
      loadedUnits: 11,
      totalUnits: 12,
    });
  });
});
