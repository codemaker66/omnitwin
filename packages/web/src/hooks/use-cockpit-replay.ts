import { useEffect, useMemo, useRef, useState } from "react";
import type { GuestFlowReplayArtifact } from "@omnitwin/types";
import { buildGuestFlowReplayInputFromLayout } from "../lib/guest-flow-layout-input.js";
import { runGuestFlowReplayInBrowser } from "../lib/guest-flow-replay-worker.js";
import type { ReplayRoomBounds } from "../lib/cockpit-overlay-projection.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useRoomDimensionsStore } from "../stores/room-dimensions-store.js";
import { RENDER_SCALE } from "../constants/scale.js";

// Binds the cockpit scene overlays to a guest-flow replay artifact derived from
// the *live* placed layout. The input is built from the actual furniture (real
// tables/stages/bar → flow obstacles, layout-derived destinations) via
// `buildGuestFlowReplayInputFromLayout`, then run deterministically in the
// existing Web Worker (with a main-thread fallback). Rearranging the room
// changes the simulated flow — there is no hardcoded demo input on this path.
//
// The artifact is cached by a signature of its input, so re-entering the
// Flow/Evidence lens (or toggling a layer) without changing the layout is
// instant, while an actual layout change re-runs the sim. Runs are debounced so
// a burst of edits coalesces into one simulation. Loading is gated by `enabled`
// — the binding stays idle outside the spatial-analysis lenses.
//
// SAFE: this is *simulated* guest flow — planning evidence, human review
// required. It is never presented as a measured or certified route.

export type CockpitReplayStatus = "idle" | "loading" | "ready" | "error";

export interface CockpitReplay {
  readonly artifact: GuestFlowReplayArtifact | null;
  readonly bounds: ReplayRoomBounds | null;
  readonly status: CockpitReplayStatus;
}

/** Coalesce a burst of layout edits into a single simulation run. */
const RUN_DEBOUNCE_MS = 250;

export function useCockpitReplay(enabled: boolean): CockpitReplay {
  const placedItems = usePlacementStore((state) => state.placedItems);
  const dimensions = useRoomDimensionsStore((state) => state.dimensions);

  // Live layout → schema-valid GuestFlowReplayInput (pure, deterministic).
  const input = useMemo(
    () => buildGuestFlowReplayInputFromLayout({
      roomWidthM: dimensions.width / RENDER_SCALE,
      roomLengthM: dimensions.length / RENDER_SCALE,
      placedItems,
    }),
    [placedItems, dimensions],
  );
  // Cheap structural signature; the builder is deterministic so stringify is stable.
  const signature = useMemo(() => JSON.stringify(input), [input]);

  const [artifact, setArtifact] = useState<GuestFlowReplayArtifact | null>(null);
  const [status, setStatus] = useState<CockpitReplayStatus>("idle");
  const cacheRef = useRef<Map<string, GuestFlowReplayArtifact>>(new Map());

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }
    const cached = cacheRef.current.get(signature);
    if (cached !== undefined) {
      setArtifact(cached);
      setStatus("ready");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    const timer = setTimeout(() => {
      void runGuestFlowReplayInBrowser(input)
        .then((result) => {
          if (cancelled) return;
          cacheRef.current.set(signature, result.artifact);
          setArtifact(result.artifact);
          setStatus("ready");
        })
        .catch(() => {
          if (cancelled) return;
          setStatus("error");
        });
    }, RUN_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, signature, input]);

  const bounds = artifact !== null ? artifact.navmesh.roomBounds : null;
  return { artifact, bounds, status };
}
