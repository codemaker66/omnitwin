import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { RuntimePackage } from "@omnitwin/types";
import type { Space } from "../../api/spaces.js";
import { GRAND_HALL_CAPTURED_SOG_MEMBERS } from "../../lib/grand-hall-captured-source.js";

vi.mock("../../api/runtime-packages.js", () => ({ getLatestRuntimePackage: vi.fn() }));
vi.mock("../../api/spaces.js", () => ({ getVenue: vi.fn() }));

const runtimeApi = vi.mocked(await import("../../api/runtime-packages.js"));
const spacesApi = vi.mocked(await import("../../api/spaces.js"));
const { useRoomRuntimeSplat } = await import("../use-room-runtime-splat.js");
const { useEditorStore } = await import("../../stores/editor-store.js");
const { useCockpitStore } = await import("../../stores/cockpit-store.js");

function spaceWith(slug: string, venueId = "v1", id = `space-${slug}`): Space {
  return {
    id, venueId, name: "Room", slug,
    widthM: "10", lengthM: "10", heightM: "5",
    floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  };
}

function tradesHallVenue(id = "v1") {
  return {
    id,
    name: "Trades Hall Glasgow",
    slug: "trades-hall-glasgow",
    address: "85 Glassford Street",
    logoUrl: null,
    brandColour: null,
    spaces: [],
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

function grandHallPackage(
  id = "20000000-0000-4000-8000-000000000001",
): RuntimePackage {
  const assetIds = GRAND_HALL_CAPTURED_SOG_MEMBERS.map((_, index) =>
    `10000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
  );
  const first = GRAND_HALL_CAPTURED_SOG_MEMBERS[0];
  const firstId = assetIds[0];
  if (firstId === undefined) throw new Error("Grand Hall fixture missing.");
  const receipts = GRAND_HALL_CAPTURED_SOG_MEMBERS.map((member, index) => ({
    assetVersionId: assetIds[index] ?? "",
    fileName: member.fileName,
    fileExt: ".sog" as const,
    sha256: member.sha256,
    sizeBytes: member.sizeBytes,
    storageKeySha256: String(index + 1).padStart(2, "0").repeat(32),
  }));
  return {
    id,
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
        visualAssetVersionIds: assetIds,
        visualAssetReceipts: receipts,
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
    primaryVisualAssetUrl: "https://untrusted.invalid/primary.sog",
    visualAssetUrls: GRAND_HALL_CAPTURED_SOG_MEMBERS.map(
      (member) => `https://untrusted.invalid/${member.fileName}`,
    ),
  };
}

beforeEach(() => {
  useEditorStore.setState({ space: null });
  useCockpitStore.getState().reset();
  spacesApi.getVenue.mockResolvedValue(tradesHallVenue());
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("useRoomRuntimeSplat", () => {
  it("stays 'none' with no space and never fetches", () => {
    const { result } = renderHook(() => useRoomRuntimeSplat());
    expect(result.current.status).toBe("none");
    expect(result.current.hasAsset).toBe(false);
    expect(result.current.roomIdentity).toBeNull();
    expect(runtimeApi.getLatestRuntimePackage).not.toHaveBeenCalled();
    expect(spacesApi.getVenue).not.toHaveBeenCalled();
  });

  it("fetches the runtime package for a known room and degrades when none exists", async () => {
    runtimeApi.getLatestRuntimePackage.mockResolvedValue(null);
    useEditorStore.setState({ space: spaceWith("grand-hall") });
    const { result } = renderHook(() => useRoomRuntimeSplat());
    await waitFor(() => { expect(result.current.status).toBe("none"); });
    expect(runtimeApi.getLatestRuntimePackage).toHaveBeenCalledWith({ venue: "trades-hall", room: "grand-hall" });
    expect(result.current.hasAsset).toBe(false);
    expect(result.current.delivery).toBe("none");
    expect(result.current.roomIdentity).toEqual({
      spaceId: "space-grand-hall",
      venueId: "v1",
      roomSlug: "grand-hall",
      status: "resolved",
      venueSlug: "trades-hall-glasgow",
    });
    expect(useCockpitStore.getState().runtimeAssetStatus).toBe(
      "Captured Grand Hall unavailable — architectural layer hidden",
    );
  });

  it("degrades safely when the package request fails", async () => {
    runtimeApi.getLatestRuntimePackage.mockRejectedValue(new Error("boom"));
    useEditorStore.setState({ space: spaceWith("reception-room") });
    const { result } = renderHook(() => useRoomRuntimeSplat());
    await waitFor(() => { expect(result.current.status).toBe("none"); });
    expect(result.current.hasAsset).toBe(false);
    expect(result.current.roomIdentity?.status).toBe("resolved");
  });

  it("resolves identity but skips packages for rooms outside the Trades Hall runtime map", async () => {
    useEditorStore.setState({ space: spaceWith("some-other-room") });
    const { result } = renderHook(() => useRoomRuntimeSplat());
    expect(result.current.status).toBe("loading");
    await waitFor(() => { expect(result.current.status).toBe("none"); });
    expect(result.current.roomIdentity?.status).toBe("resolved");
    expect(spacesApi.getVenue).toHaveBeenCalledWith("v1");
    expect(runtimeApi.getLatestRuntimePackage).not.toHaveBeenCalled();
  });

  it("binds the asset namespace to the actual Trades Hall database venue", async () => {
    spacesApi.getVenue.mockResolvedValue({
      ...tradesHallVenue("other-venue"),
      slug: "some-other-venue",
    });
    useEditorStore.setState({ space: spaceWith("grand-hall", "other-venue") });
    const { result } = renderHook(() => useRoomRuntimeSplat());

    expect(result.current.status).toBe("loading");
    await waitFor(() => { expect(result.current.status).toBe("none"); });
    expect(runtimeApi.getLatestRuntimePackage).not.toHaveBeenCalled();
    expect(result.current.hasAsset).toBe(false);
    expect(result.current.roomIdentity).toEqual({
      spaceId: "space-grand-hall",
      venueId: "other-venue",
      roomSlug: "grand-hall",
      status: "resolved",
      venueSlug: "some-other-venue",
    });
    expect(useCockpitStore.getState().plannerRoomIdentity).toEqual(result.current.roomIdentity);
  });

  it("publishes an unavailable keyed identity when venue verification fails", async () => {
    spacesApi.getVenue.mockRejectedValue(new Error("venue unavailable"));
    useEditorStore.setState({ space: spaceWith("grand-hall") });
    const { result } = renderHook(() => useRoomRuntimeSplat());

    expect(result.current.roomIdentity?.status).toBe("pending");
    await waitFor(() => { expect(result.current.roomIdentity?.status).toBe("unavailable"); });
    expect(runtimeApi.getLatestRuntimePackage).not.toHaveBeenCalled();
    expect(useCockpitStore.getState().runtimeAssetStatus).toBe(
      "Room identity unavailable — architectural layer hidden",
    );
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
    expect(result.current.delivery).toBe("url");
    expect(result.current.splatUrls).toEqual([RECEPTION_SPLAT_URL]);
    expect(useCockpitStore.getState().runtimeAssetStatus).toBe(
      "Runtime asset loaded, not yet verified/signed.",
    );
  });

  it("selects Grand Hall only for authenticated verified-preview delivery", async () => {
    runtimeApi.getLatestRuntimePackage.mockResolvedValue(grandHallPackage());
    useEditorStore.setState({ space: spaceWith("grand-hall") });
    const { result } = renderHook(() => useRoomRuntimeSplat());

    await waitFor(() => { expect(result.current.status).toBe("loaded"); });
    expect(result.current).toMatchObject({
      hasAsset: true,
      delivery: "verified-grand-hall",
      runtimePackageId: "20000000-0000-4000-8000-000000000001",
      splatUrls: [],
    });
    expect(result.current.roomIdentity).toMatchObject({
      status: "resolved",
      venueSlug: "trades-hall-glasgow",
      roomSlug: "grand-hall",
    });
    expect(result.current.transform.rotation[0]).toBeCloseTo(-Math.PI / 2);
    expect(result.current.exactGrandHallRuntimeKey).toEqual({
      spaceId: "space-grand-hall",
      venueId: "v1",
      roomSlug: "grand-hall",
      runtimePackageId: "20000000-0000-4000-8000-000000000001",
    });
    expect(useCockpitStore.getState().exactGrandHallRuntime).toEqual({
      key: result.current.exactGrandHallRuntimeKey,
      status: "pending",
      attemptNonce: 1,
    });
    expect(useCockpitStore.getState().runtimeAssetStatus).toMatch(/verifying exact protected bytes/i);
  });

  it("resets exact runtime verification when the room/package key changes", async () => {
    const packageA = grandHallPackage("20000000-0000-4000-8000-000000000001");
    const packageB = grandHallPackage("20000000-0000-4000-8000-000000000002");
    runtimeApi.getLatestRuntimePackage
      .mockResolvedValueOnce(packageA)
      .mockResolvedValueOnce(packageB);
    useEditorStore.setState({ space: spaceWith("grand-hall", "v1", "grand-hall-a") });
    const { result } = renderHook(() => useRoomRuntimeSplat());

    await waitFor(() => {
      expect(result.current.exactGrandHallRuntimeKey?.runtimePackageId).toBe(packageA.id);
    });
    const staleKey = result.current.exactGrandHallRuntimeKey;
    if (staleKey === null) throw new Error("Expected the first exact runtime key.");
    useCockpitStore.getState().completeExactGrandHallRuntime(staleKey, 1, "verified");
    expect(useCockpitStore.getState().exactGrandHallRuntime?.status).toBe("verified");

    act(() => {
      useEditorStore.setState({ space: spaceWith("grand-hall", "v1", "grand-hall-b") });
    });
    expect(useCockpitStore.getState().exactGrandHallRuntime).toBeNull();

    await waitFor(() => {
      expect(result.current.exactGrandHallRuntimeKey).toMatchObject({
        spaceId: "grand-hall-b",
        runtimePackageId: packageB.id,
      });
    });
    expect(useCockpitStore.getState().exactGrandHallRuntime?.status).toBe("pending");

    useCockpitStore.getState().completeExactGrandHallRuntime(staleKey, 1, "failed");
    expect(useCockpitStore.getState().exactGrandHallRuntime).toEqual({
      key: result.current.exactGrandHallRuntimeKey,
      status: "pending",
      attemptNonce: 2,
    });
  });

  it("never exposes the previous room package while the next room request is pending", async () => {
    runtimeApi.getLatestRuntimePackage.mockResolvedValueOnce(receptionRoomPackage());
    useEditorStore.setState({ space: spaceWith("reception-room") });
    const { result } = renderHook(() => useRoomRuntimeSplat());
    await waitFor(() => { expect(result.current.hasAsset).toBe(true); });

    let settleGrandHallRequest: (value: RuntimePackage | null) => void = () => {
      throw new Error("Grand Hall package request did not start.");
    };
    const grandHallRequest = new Promise<RuntimePackage | null>((resolve) => {
      settleGrandHallRequest = resolve;
    });
    runtimeApi.getLatestRuntimePackage.mockReturnValueOnce(grandHallRequest);
    act(() => { useEditorStore.setState({ space: spaceWith("grand-hall") }); });

    expect(result.current.hasAsset).toBe(false);
    expect(result.current.splatUrls).toEqual([]);
    expect(result.current.status).toBe("loading");
    expect(result.current.roomIdentity).toEqual({
      spaceId: "space-grand-hall",
      venueId: "v1",
      roomSlug: "grand-hall",
      status: "pending",
      venueSlug: null,
    });

    await waitFor(() => {
      expect(runtimeApi.getLatestRuntimePackage).toHaveBeenCalledTimes(2);
    });
    act(() => { settleGrandHallRequest(null); });
    await waitFor(() => { expect(result.current.status).toBe("none"); });
  });

  it("ignores an older Trades Hall venue lookup after the same slug opens at another venue", async () => {
    let settleTradesHallLookup: (value: ReturnType<typeof tradesHallVenue>) => void = () => {
      throw new Error("Trades Hall venue lookup did not start.");
    };
    const tradesHallLookup = new Promise<ReturnType<typeof tradesHallVenue>>((resolve) => {
      settleTradesHallLookup = resolve;
    });
    spacesApi.getVenue.mockImplementation((requestedVenueId) => {
      if (requestedVenueId === "v1") return tradesHallLookup;
      return Promise.resolve({
        ...tradesHallVenue("v2"),
        slug: "another-venue",
      });
    });

    useEditorStore.setState({ space: spaceWith("grand-hall", "v1", "trades-space") });
    const { result } = renderHook(() => useRoomRuntimeSplat());
    expect(result.current.roomIdentity?.status).toBe("pending");

    act(() => {
      useEditorStore.setState({ space: spaceWith("grand-hall", "v2", "other-space") });
    });
    await waitFor(() => {
      expect(result.current.roomIdentity).toEqual({
        spaceId: "other-space",
        venueId: "v2",
        roomSlug: "grand-hall",
        status: "resolved",
        venueSlug: "another-venue",
      });
    });

    act(() => { settleTradesHallLookup(tradesHallVenue("v1")); });
    await waitFor(() => {
      expect(result.current.roomIdentity?.venueId).toBe("v2");
      expect(result.current.roomIdentity?.venueSlug).toBe("another-venue");
    });
    expect(runtimeApi.getLatestRuntimePackage).not.toHaveBeenCalled();
  });
});
