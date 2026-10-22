// ---------------------------------------------------------------------------
// useHallDetail — the walls' 2 mm detail layer for as long as the hall is shown
//
// GrandHallModel's detail layer (hall-detail.ts), made for the device's slots
// and photographs and nothing else: turning the real sky or the timeline's
// preview on or off rebuilds the hall's materials, which sample this same
// layer, so its worker, its resident tiles and its array on the GPU (90 MB on
// a computer) survive the rebuild instead of being thrown away and fetched
// again. Mounted, it starts (fetching the tiles' index) and asks for a frame
// whenever a tile arrives; its one wake timer (DetailWake) asks for one when
// it wants to look again. Unmounted or replaced, the timer is cleared and the
// layer disposed, its fetches aborted and its worker terminated.
// ---------------------------------------------------------------------------

import { useEffect, useMemo } from "react";
import { DETAIL_ATLAS_TEXEL_MM, DetailWake, HallDetailLayer, type HallDetailOptions } from "./hall-detail.js";

export interface HallDetailHandle {
  readonly layer: HallDetailLayer;
  /** Asks for a frame when the layer wants to look again (DetailFrameResult.wakeMs). */
  readonly wake: DetailWake;
}

/** What a test may give the layer in place of the network and the worker. */
export type HallDetailSeams = Pick<HallDetailOptions, "decoder" | "fetchBytes" | "fetchIndex" | "now">;

/** The walls' detail layer for `slots` (the device's: hall-finish.ts) and photographs at `quality`. */
export function useHallDetail(slots: number, quality: number, invalidate: () => void, seams: HallDetailSeams = {}): HallDetailHandle {
  const { decoder, fetchBytes, fetchIndex, now } = seams;
  const handle = useMemo(() => {
    const layer = new HallDetailLayer({
      slots, atlasTexelMm: DETAIL_ATLAS_TEXEL_MM / Math.max(quality, 0.125),
      ...(decoder === undefined ? {} : { decoder }), ...(fetchBytes === undefined ? {} : { fetchBytes }),
      ...(fetchIndex === undefined ? {} : { fetchIndex }), ...(now === undefined ? {} : { now }),
    });
    return { layer, wake: new DetailWake(invalidate) };
  }, [decoder, fetchBytes, fetchIndex, invalidate, now, quality, slots]);

  useEffect(() => {
    const { layer, wake } = handle;
    layer.onChange = () => { invalidate(); };
    layer.start();
    if (import.meta.env.DEV) window.__venHallDetail = layer;
    return () => {
      layer.onChange = null;
      wake.cancel();
      layer.dispose();
      if (import.meta.env.DEV && window.__venHallDetail === layer) delete window.__venHallDetail;
    };
  }, [handle, invalidate]);

  return handle;
}
