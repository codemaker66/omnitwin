import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import type { Space } from "../../api/spaces.js";

vi.mock("../../api/runtime-packages.js", () => ({ getLatestRuntimePackage: vi.fn() }));

const runtimeApi = vi.mocked(await import("../../api/runtime-packages.js"));
const { useRoomRuntimeSplat } = await import("../use-room-runtime-splat.js");
const { useEditorStore } = await import("../../stores/editor-store.js");
const { useCockpitStore } = await import("../../stores/cockpit-store.js");
const { useAuthStore } = await import("../../stores/auth-store.js");
const { deviceDayBundleById, deviceDayViewTransform } = await import("../../data/device-day-splat-bundles.js");

const BUCKET = "https://pub-2bf1ea54c4c642d3b19067b97c55dc5d.r2.dev/splats";

function spaceWith(slug: string): Space {
  return {
    id: "s1", venueId: "v1", name: "Room", slug,
    widthM: "10", lengthM: "10", heightM: "5",
    floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  };
}

function openAt(search: string): void {
  window.history.replaceState(null, "", `/plan/layout-1${search}`);
}

beforeEach(() => {
  useEditorStore.setState({ space: null });
  useCockpitStore.getState().reset();
  useAuthStore.getState().logout();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
});

describe("useRoomRuntimeSplat with a device-day cut", () => {
  it("draws the named cut from the public bucket in production, past the hold, under its own label", () => {
    vi.stubEnv("DEV", false);
    openAt("?splatBundle=l2-2m&profiler=1");
    useEditorStore.setState({ space: spaceWith("grand-hall") });
    const { result } = renderHook(() => useRoomRuntimeSplat());

    const cut = deviceDayBundleById("l2-2m");
    expect(result.current).toMatchObject({ source: "staged", hasAsset: true, status: "none", roomSlug: "grand-hall", environmentUrls: [] });
    expect(result.current.splatUrls).toEqual([0, 1, 2, 3].map((n) => `${BUCKET}/trades-hall/device-day/l2-2m/l2-2m_${String(n)}.sog`));
    expect(result.current.transform).toEqual(cut === null ? null : deviceDayViewTransform(cut));
    expect(useCockpitStore.getState().runtimeAssetStatus).toBe("Device-day timing cut l2-2m · 2 M splats · SH3 · not a look candidate");
    expect(runtimeApi.getLatestRuntimePackage).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown id", "?splatBundle=l2-9m", "grand-hall"],
    ["a manual URL", "?splatUrl=https%3A%2F%2Fexample.com%2Fcapture.sog", "grand-hall"],
    ["a cut of another room", "?splatBundle=l2-2m", "reception-room"],
  ])("ignores %s in production and keeps the hold", (_name, search, room) => {
    vi.stubEnv("DEV", false);
    openAt(search);
    useEditorStore.setState({ space: spaceWith(room) });
    const { result } = renderHook(() => useRoomRuntimeSplat());
    expect(result.current).toMatchObject({ source: "none", hasAsset: false, splatUrls: [], environmentUrls: [] });
    expect(useCockpitStore.getState().runtimeAssetStatus).toBe("Gaussian splats · Work in progress");
  });

  it("puts the cut ahead of the registry and the staged tiles in development", () => {
    vi.stubEnv("DEV", true);
    useAuthStore.getState().setUser({ id: "platform-admin", name: "Platform admin", email: "admin@example.test", role: "admin", platformRole: "admin", venueId: null });
    openAt("?splatBundle=l2-2m-sh1");
    useEditorStore.setState({ space: spaceWith("grand-hall") });
    const { result } = renderHook(() => useRoomRuntimeSplat());
    expect(result.current.source).toBe("staged");
    expect(result.current.splatUrls).toEqual([0, 1, 2, 3].map((n) => `/splats/trades-hall/device-day/l2-2m-sh1/l2-2m-sh1_${String(n)}.sog`));
    expect(result.current.environmentUrls).toEqual([]);
    expect(runtimeApi.getLatestRuntimePackage).not.toHaveBeenCalled();
  });

  it("leaves a room without the query exactly as it was", () => {
    vi.stubEnv("DEV", true);
    openAt("");
    useEditorStore.setState({ space: spaceWith("grand-hall") });
    const { result } = renderHook(() => useRoomRuntimeSplat());
    expect(result.current.source).toBe("staged");
    expect(result.current.splatUrls.every((url) => url.startsWith("/splats/trades-hall/grand-hall/"))).toBe(true);
    expect(result.current.environmentUrls).toEqual(["/splats/trades-hall/grand-hall/env.sog"]);
  });
});
