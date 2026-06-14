import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
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
});
