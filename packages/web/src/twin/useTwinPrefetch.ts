import { useEffect } from "react";
import { twinEquirectPath, type TwinEquirectLod } from "@omnitwin/types";

/** Prefetch warms the 4096 BASE tier only — the 8192 zoom tier is strictly
 *  on-demand (zoom intent on the current node), never speculative traffic. */
const PREFETCH_LOD: TwinEquirectLod = 4096;

/** Debounce (finding [34]): hold-to-walk chaining churns the neighbour set
 *  every ~200-400ms, so an undebounced effect starts-and-aborts a fetch burst
 *  each hop and rarely completes one. Waiting a hair past the inter-hop gap
 *  collapses a chained walk to a single batch, fired once the walk pauses. */
const PREFETCH_DEBOUNCE_MS = 250;

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
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      for (const id of neighborIds) {
        void fetch(`${base}/${twinEquirectPath(id, PREFETCH_LOD)}`, {
          signal: controller.signal,
          priority: "low",
        } as RequestInit)
          .then((response) => (response.ok ? response.blob() : null))
          .catch(() => null);
      }
    }, PREFETCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [neighborIds, base]);
}
