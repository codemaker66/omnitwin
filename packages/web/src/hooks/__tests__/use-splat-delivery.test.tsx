import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomSplatLadder } from "../../data/room-splat-bundles.js";
import { useSplatDelivery } from "../use-splat-delivery.js";

const ladder: RoomSplatLadder = {
  environment: [{ url: "sky", file: "sky", tree: false, isEnvironment: true }],
  coarse: [{ url: "coarse", file: "coarse", tree: false, isEnvironment: false }],
  sharp: [
    { url: "fine-a", file: "fine-a", tree: false, isEnvironment: false },
    { url: "fine-b", file: "fine-b", tree: false, isEnvironment: false },
  ],
};
const load = (url: string) => ({ url, splatCount: 10, localBounds: null });
const fail = (url: string) => ({ url, error: new Error("unavailable") });
const tick = () => { act(() => { vi.advanceTimersByTime(400); }); };
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("useSplatDelivery", () => {
  it("does not poll an empty source set or count the sky as room geometry", () => {
    const empty = renderHook(() => useSplatDelivery({ environment: [], coarse: [], sharp: [] }));
    expect(vi.getTimerCount()).toBe(0);
    empty.unmount();
    const { result } = renderHook(() => useSplatDelivery(ladder));
    act(() => { result.current.onLoad(load("sky")); });
    tick();
    expect(result.current.progress.firstView).toBe(false);
    expect(result.current.firstDecodedAtMs).toBeNull();
  });
  it("keeps a complete coarse cover until every finest tile decodes", () => {
    const { result } = renderHook(() => useSplatDelivery(ladder));
    expect(result.current.mounted.map((s) => s.url)).toEqual(["sky", "coarse"]);
    act(() => { result.current.onLoad(load("coarse")); });
    tick();
    expect(result.current.progress).toMatchObject({ firstView: true, settled: 0, total: 2 });
    expect(result.current.mounted.map((s) => s.url)).toEqual(["sky", "coarse", "fine-a", "fine-b"]);
    act(() => { result.current.onLoad(load("fine-a")); });
    tick();
    expect(result.current.mounted.some((s) => s.url === "coarse")).toBe(true);
    act(() => { result.current.onLoad(load("fine-b")); });
    tick();
    expect(result.current.mounted.map((s) => s.url)).toEqual(["sky", "fine-a", "fine-b"]);
    expect(result.current.progress).toMatchObject({ complete: true, settled: 2, failed: 0 });
  });

  it("settles failed finest tiles while retaining the coarse cover", () => {
    const { result } = renderHook(() => useSplatDelivery(ladder));
    act(() => { result.current.onLoad(load("coarse")); result.current.onLoad(load("sky")); });
    tick();
    act(() => { result.current.onLoad(load("fine-a")); result.current.onError(fail("fine-b")); });
    tick();
    expect(result.current.progress).toMatchObject({ complete: true, failed: 1, settled: 2 });
    expect(result.current.mounted.some((s) => s.url === "coarse")).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports late retained coarse and sky decodes after finest failures settle", () => {
    const { result } = renderHook(() => useSplatDelivery(ladder));
    act(() => { vi.advanceTimersByTime(15_200); });
    act(() => { result.current.onError(fail("fine-a")); result.current.onError(fail("fine-b")); });
    tick();
    expect(result.current.progress).toMatchObject({ complete: true, firstView: false, splats: 0, failed: 2 });
    act(() => { result.current.onLoad(load("coarse")); });
    tick();
    expect(result.current.progress).toMatchObject({ complete: true, firstView: true, splats: 10, failed: 2 });
    expect(vi.getTimerCount()).toBe(1);
    act(() => { result.current.onLoad(load("sky")); });
    tick();
    expect(result.current.progress.splats).toBe(20);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts the finest after coarse failure or a stuck coarse deadline", () => {
    const { result, unmount } = renderHook(() => useSplatDelivery(ladder));
    act(() => { result.current.onError(fail("coarse")); });
    tick();
    expect(result.current.stage).toBe("sharpening");
    expect(result.current.progress).toMatchObject({ firstView: false, failed: 0 });
    unmount();
    const pending = renderHook(() => useSplatDelivery(ladder));
    act(() => { vi.advanceTimersByTime(15_200); });
    expect(pending.result.current.stage).toBe("sharpening");
  });

  it("resets on a room change and ignores callbacks from the disposed room", () => {
    const second: RoomSplatLadder = {
      environment: [],
      coarse: [{ url: "second", file: "second", tree: false, isEnvironment: false }],
      sharp: [{ url: "second-fine", file: "second-fine", tree: false, isEnvironment: false }],
    };
    const { result, rerender } = renderHook(({ sources }) => useSplatDelivery(sources), { initialProps: { sources: ladder } });
    const staleLoad = result.current.onLoad;
    act(() => { staleLoad(load("coarse")); });
    tick();
    rerender({ sources: second });
    expect(result.current.mounted.map((s) => s.url)).toEqual(["second"]);
    act(() => { staleLoad(load("second")); result.current.onLoad(load("fine-a")); });
    tick();
    expect(result.current.progress.firstView).toBe(false);
    expect(result.current.stage).toBe("coarse");
  });

  it("does not reset or change callback identities for equivalent ladder props", () => {
    const onProgress = vi.fn();
    const { result, rerender } = renderHook(({ sources }) => useSplatDelivery(sources, onProgress), { initialProps: { sources: ladder } });
    const firstLoad = result.current.onLoad;
    act(() => { firstLoad(load("coarse")); });
    tick();
    rerender({ sources: { ...ladder, sharp: [...ladder.sharp] } });
    expect(result.current.onLoad).toBe(firstLoad);
    expect(result.current.stage).toBe("sharpening");
    const reports = onProgress.mock.calls.length;
    act(() => { vi.advanceTimersByTime(4000); });
    expect(onProgress).toHaveBeenCalledTimes(reports);
  });

  it("starts single-level packages directly and cleans up on unmount", () => {
    const { result, unmount } = renderHook(() => useSplatDelivery({ environment: [], coarse: [], sharp: ladder.sharp }));
    expect(result.current.mounted).toEqual(ladder.sharp);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
