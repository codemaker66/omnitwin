import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { RuntimePackage } from "@omnitwin/types";
import type { Space } from "../../api/spaces.js";

vi.mock("../../api/runtime-packages.js", () => ({ getLatestRuntimePackage: vi.fn() }));

const runtimeApi = vi.mocked(await import("../../api/runtime-packages.js"));
const { useRoomRuntimeSplat } = await import("../use-room-runtime-splat.js");
const { useEditorStore } = await import("../../stores/editor-store.js");
const { useCockpitStore } = await import("../../stores/cockpit-store.js");

function spaceWith(slug: string): Space {
  return {
    id: "s1", venueId: "v1", name: "Room", slug,
    widthM: "10", lengthM: "10", heightM: "5",
    floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  };
}

const RECEPTION_ASSET_VERSION_ID = "10000000-0000-4000-8000-000000000002";
const RECEPTION_SPLAT_URL = "https://assets.example/reception-room/lcc2-result-spz/data/3dgs/0_0.spz";

function receptionRoomPackage(): RuntimePackage {
  return {
    id: "rp-reception",
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    primaryVisualAssetVersionId: RECEPTION_ASSET_VERSION_ID,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId: RECEPTION_ASSET_VERSION_ID,
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
    },
    evidenceStatus: "unverified",
    runtimeStatus: "internal_ready",
    createdAt: "2026-06-06T10:00:00.000Z",
    updatedAt: "2026-06-06T10:00:00.000Z",
    primaryVisualAssetUrl: RECEPTION_SPLAT_URL,
    visualAssetUrls: [RECEPTION_SPLAT_URL],
    primaryVisualAssetVersion: {
      id: RECEPTION_ASSET_VERSION_ID,
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      captureSessionId: null,
      assetKind: "splat",
      sourceType: "xgrids",
      r2Key: "venues/trades-hall/rooms/reception-room/xgrids/0_0.spz",
      fileName: "0_0.spz",
      fileExt: ".spz",
      externalUrl: null,
      mimeType: "application/octet-stream",
      sha256: "a".repeat(64),
      sizeBytes: 2048,
      evidenceStatus: "unverified",
      runtimeStatus: "usable",
      notes: null,
      createdAt: "2026-06-06T10:00:00.000Z",
      updatedAt: "2026-06-06T10:00:00.000Z",
    },
  };
}

beforeEach(() => { useEditorStore.setState({ space: null }); useCockpitStore.getState().reset(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("useRoomRuntimeSplat", () => {
  it("stays 'none' with no space and never fetches", () => {
    const { result } = renderHook(() => useRoomRuntimeSplat());
    expect(result.current.status).toBe("none");
    expect(result.current.hasAsset).toBe(false);
    expect(runtimeApi.getLatestRuntimePackage).not.toHaveBeenCalled();
  });

  it("fetches the runtime package for a known room and degrades when none exists", async () => {
    runtimeApi.getLatestRuntimePackage.mockResolvedValue(null);
    useEditorStore.setState({ space: spaceWith("grand-hall") });
    const { result } = renderHook(() => useRoomRuntimeSplat());
    await waitFor(() => { expect(result.current.status).toBe("none"); });
    expect(runtimeApi.getLatestRuntimePackage).toHaveBeenCalledWith({ venue: "trades-hall", room: "grand-hall" });
    expect(result.current.hasAsset).toBe(false);
  });

  it("degrades safely when the package request fails", async () => {
    runtimeApi.getLatestRuntimePackage.mockRejectedValue(new Error("boom"));
    useEditorStore.setState({ space: spaceWith("reception-room") });
    const { result } = renderHook(() => useRoomRuntimeSplat());
    await waitFor(() => { expect(result.current.status).toBe("none"); });
    expect(result.current.hasAsset).toBe(false);
  });

  it("ignores spaces that are not known Trades Hall runtime rooms", () => {
    useEditorStore.setState({ space: spaceWith("some-other-room") });
    const { result } = renderHook(() => useRoomRuntimeSplat());
    expect(result.current.status).toBe("none");
    expect(runtimeApi.getLatestRuntimePackage).not.toHaveBeenCalled();
  });

  it("publishes the atelier fallback status when no package resolves", async () => {
    runtimeApi.getLatestRuntimePackage.mockResolvedValue(null);
    // Seed a stale loaded label so the assertion proves the hook overwrote it.
    useCockpitStore.getState().setRuntimeAssetStatus("Runtime asset loaded, human reviewed.");
    useEditorStore.setState({ space: spaceWith("reception-room") });
    const { result } = renderHook(() => useRoomRuntimeSplat());
    await waitFor(() => { expect(result.current.status).toBe("none"); });
    expect(useCockpitStore.getState().runtimeAssetStatus).toBe(
      "Captured visual layer not yet available — planning on reviewed geometry",
    );
  });

  it("publishes the package evidence label and splat URLs when a package resolves", async () => {
    runtimeApi.getLatestRuntimePackage.mockResolvedValue(receptionRoomPackage());
    useEditorStore.setState({ space: spaceWith("reception-room") });
    const { result } = renderHook(() => useRoomRuntimeSplat());
    await waitFor(() => { expect(result.current.status).toBe("loaded"); });
    expect(result.current.hasAsset).toBe(true);
    expect(result.current.splatUrls).toEqual([RECEPTION_SPLAT_URL]);
    expect(useCockpitStore.getState().runtimeAssetStatus).toBe(
      "Runtime asset loaded, not yet verified/signed.",
    );
  });
});
