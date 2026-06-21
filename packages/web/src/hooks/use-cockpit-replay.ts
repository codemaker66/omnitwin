import { useEffect, useMemo, useState } from "react";
import type { GuestFlowReplayArtifact, GuestFlowReplayInput } from "@omnitwin/types";
import { buildGuestFlowReplayInputFromLayout } from "../lib/guest-flow-layout-input.js";
import { runGuestFlowReplayInBrowser } from "../lib/guest-flow-replay-worker.js";
import type { ReplayRoomBounds } from "../lib/cockpit-overlay-projection.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useRoomDimensionsStore } from "../stores/room-dimensions-store.js";
import { useCockpitStore } from "../stores/cockpit-store.js";
import { RENDER_SCALE } from "../constants/scale.js";

// Binds the cockpit's spatial-analysis surfaces (scene overlays, minimap, Flow
// lens panel) to a guest-flow replay artifact derived from the *live* placed
// layout. The input is built from the actual furniture (real tables/stages/bar →
// flow obstacles, layout-derived destinations) plus the planner-set guest count
// + arrival window, then run deterministically in the existing Web Worker (with
// a main-thread fallback). Rearranging the room — or changing the guest count —
// re-simulates; there is no hardcoded demo input on this path.
//
// SHARED CACHE: the artifact is cached at module scope keyed by a signature of
// its input, so the several consumers that mount in the Flow/Evidence lenses run
// the simulation exactly ONCE per unique layout (in-flight runs are deduped),
// and re-entering a lens without a change is instant. Runs are debounced so a
// burst of edits coalesces.
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
/** Soft cap so a long editing session doesn't grow the cache unbounded. */
const MAX_CACHE_ENTRIES = 16;

const resultCache = new Map<string, GuestFlowReplayArtifact>();
const inFlight = new Map<string, Promise<GuestFlowReplayArtifact>>();

/** Test hook: clear the shared replay cache between cases. */
export function __resetCockpitReplayCache(): void {
  resultCache.clear();
  inFlight.clear();
}

/** One simulation per signature, shared across all hook instances. */
function resolveArtifact(signature: string, input: GuestFlowReplayInput): Promise<GuestFlowReplayArtifact> {
  const cached = resultCache.get(signature);
  if (cached !== undefined) return Promise.resolve(cached);
  const pending = inFlight.get(signature);
  if (pending !== undefined) return pending;
  const promise = runGuestFlowReplayInBrowser(input)
    .then((result) => {
      if (resultCache.size >= MAX_CACHE_ENTRIES) resultCache.clear();
      resultCache.set(signature, result.artifact);
      inFlight.delete(signature);
      return result.artifact;
    })
    .catch((error: unknown) => {
      inFlight.delete(signature);
      throw error instanceof Error ? error : new Error("guest flow replay failed");
    });
  inFlight.set(signature, promise);
  return promise;
}

export function useCockpitReplay(enabled: boolean): CockpitReplay {
  const placedItems = usePlacementStore((state) => state.placedItems);
  const dimensions = useRoomDimensionsStore((state) => state.dimensions);
  const plannedGuestCount = useCockpitStore((state) => state.plannedGuestCount);
  const arrivalMinutes = useCockpitStore((state) => state.flowArrivalMinutes);

  // Live layout + planner scenario → schema-valid GuestFlowReplayInput.
  const input = useMemo(
    () => buildGuestFlowReplayInputFromLayout({
      roomWidthM: dimensions.width / RENDER_SCALE,
      roomLengthM: dimensions.length / RENDER_SCALE,
      placedItems,
      plannedGuestCount,
      phase: { phaseId: null, label: "Arrival", durationMinutes: Math.max(1, Math.round(arrivalMinutes)) },
    }),
    [placedItems, dimensions, plannedGuestCount, arrivalMinutes],
  );
  const signature = useMemo(() => JSON.stringify(input), [input]);

  const [artifact, setArtifact] = useState<GuestFlowReplayArtifact | null>(null);
  const [status, setStatus] = useState<CockpitReplayStatus>("idle");

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }
    const cached = resultCache.get(signature);
    if (cached !== undefined) {
      setArtifact(cached);
      setStatus("ready");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    const timer = setTimeout(() => {
      resolveArtifact(signature, input)
        .then((resolved) => {
          if (cancelled) return;
          setArtifact(resolved);
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
