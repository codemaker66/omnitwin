// The walls' detail layer's lifetime in GrandHallModel (useHallDetail): what
// the hall leaves behind when it goes, and what a change of sky keeps.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { DETAIL_LEVELS, DETAIL_TILE_TEXELS } from "../hall-detail-decode.js";
import type { DetailDecoder } from "../hall-detail.js";
import { useHallDetail, type HallDetailSeams } from "../use-hall-detail.js";

afterEach(() => { cleanup(); });

/** A decoder that counts what is asked of it. */
function countingDecoder() {
  const counts = { decodes: 0, disposals: 0 };
  const decoder: DetailDecoder = {
    decode: () => {
      counts.decodes += 1;
      return Promise.resolve(Array.from({ length: DETAIL_LEVELS }, (_, level) => new Uint8Array((DETAIL_TILE_TEXELS >> level) ** 2 * 4)));
    },
    recycle: () => undefined,
    dispose: () => { counts.disposals += 1; },
  };
  return { decoder, counts };
}

/** The tiles' index never arrives (the layer is idle): this is about the layer's lifetime, not its tiles. */
const quietIndex: HallDetailSeams["fetchIndex"] = () => new Promise(() => undefined);

describe("useHallDetail", () => {
  it("disposes the layer, its decoder (the worker) and its wake timer when the hall unmounts", () => {
    const { decoder, counts } = countingDecoder();
    let frames = 0;
    const invalidate = (): void => { frames += 1; };
    const seams: HallDetailSeams = { decoder, fetchIndex: quietIndex };
    const { result, unmount } = renderHook(() => useHallDetail(16, 1, invalidate, seams));
    const { layer, wake } = result.current;
    expect(layer.enabled).toBe(true);
    wake.request(10_000);
    expect(wake.pending).toBe(true);
    unmount();
    expect(counts.disposals).toBe(1);
    expect(layer.enabled).toBe(false);
    expect(wake.pending).toBe(false);
    expect(layer.onChange).toBeNull();
    expect(frames).toBe(0);
  });

  it("keeps the same layer across renders that change nothing it depends on (a change of sky)", () => {
    const { decoder, counts } = countingDecoder();
    const invalidate = (): void => undefined;
    const seams: HallDetailSeams = { decoder, fetchIndex: quietIndex };
    const { result, rerender, unmount } = renderHook(({ sky }: { sky: boolean }) => {
      void sky;
      return useHallDetail(16, 1, invalidate, seams);
    }, { initialProps: { sky: false } });
    const first = result.current.layer;
    rerender({ sky: true });
    expect(result.current.layer).toBe(first);
    expect(counts.disposals).toBe(0);
    unmount();
    expect(counts.disposals).toBe(1);
  });

  it("replaces and disposes the layer when the device's slots change", () => {
    const { decoder, counts } = countingDecoder();
    const invalidate = (): void => undefined;
    const seams: HallDetailSeams = { decoder, fetchIndex: quietIndex };
    const { result, rerender, unmount } = renderHook(({ slots }: { slots: number }) => useHallDetail(slots, 1, invalidate, seams), { initialProps: { slots: 16 } });
    const first = result.current.layer;
    rerender({ slots: 32 });
    expect(result.current.layer).not.toBe(first);
    expect(first.enabled).toBe(false);
    expect(counts.disposals).toBe(1);
    unmount();
    expect(counts.disposals).toBe(2);
  });

  it("replaces and disposes the layer when the renderer is replaced (a graphics reset)", () => {
    // The layer fills its slot array on the GPU device by copy alone and then lets the decoded bytes go: on a new
    // device the array is empty while the old layer would believe its tiles resident.
    const { decoder, counts } = countingDecoder();
    const invalidate = (): void => undefined;
    const seams: HallDetailSeams = { decoder, fetchIndex: quietIndex };
    const { result, rerender, unmount } = renderHook(({ renderer }: { renderer: object }) => useHallDetail(16, 1, invalidate, seams, renderer), {
      initialProps: { renderer: { device: "lost" } },
    });
    const first = result.current.layer;
    rerender({ renderer: { device: "fresh" } });
    expect(result.current.layer).not.toBe(first);
    expect(first.enabled).toBe(false);
    expect(result.current.layer.enabled).toBe(true);
    expect(counts.disposals).toBe(1);
    unmount();
    expect(counts.disposals).toBe(2);
  });
});
