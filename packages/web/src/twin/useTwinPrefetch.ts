import { useEffect } from "react";
import { twinEquirectPath, type TwinEquirectLod } from "@omnitwin/types";

/** Warm the tiny PREVIEW first (so an arriving node paints almost instantly and
 *  a hop never sits on black) then the 4096 BASE (sharpens it). The 8192 zoom
 *  tier is strictly on-demand — never speculative traffic. */
const PREFETCH_LODS: readonly TwinEquirectLod[] = [512, 4096];

/**
 * Cache-warm the base-resolution panos of the current node's graph
 * neighbours so travel starts from the HTTP cache instead of the network —
 * the difference between a hop that sharpens instantly and one that sits on
 * its 512 preview while 4096×2048 crosses the wire.
 *
 * Fire-and-forget fetches, aborted on node change/unmount; the bytes are
 * drained so the browser commits them to cache, but no decode happens here
 * (useEquirectTexture does that off-thread on arrival). No-ops quietly where
 * fetch is unavailable (happy-dom tests).
 */
export function useTwinPrefetch(neighborIds: readonly string[], base: string): void {
  useEffect(() => {
    if (typeof fetch !== "function" || neighborIds.length === 0) {
      return;
    }
    // Fired immediately on every arrival — no debounce. A held-key walk WANTS
    // the next nodes warmed; the previous batch is simply aborted as you move
    // on, and the node you actually hop to was already warmed as the prior
    // node's neighbour, so it streams from cache and the crossfade stays smooth.
    const controller = new AbortController();
    for (const id of neighborIds) {
      for (const lod of PREFETCH_LODS) {
        void fetch(`${base}/${twinEquirectPath(id, lod)}`, {
          signal: controller.signal,
          priority: "low",
        } as RequestInit)
          .then((response) => (response.ok ? response.blob() : null))
          .catch(() => null);
      }
    }
    return () => {
      controller.abort();
    };
  }, [neighborIds, base]);
}
