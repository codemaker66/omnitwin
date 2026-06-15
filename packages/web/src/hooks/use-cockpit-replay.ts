import { useEffect, useRef, useState } from "react";
import type { GuestFlowReplayArtifact } from "@omnitwin/types";
import { TRADES_HALL_GUEST_FLOW_REPLAY_INPUT } from "../lib/trades-hall-visual-demo-state.js";
import { runGuestFlowReplayInBrowser } from "../lib/guest-flow-replay-worker.js";
import type { ReplayRoomBounds } from "../lib/cockpit-overlay-projection.js";

// Binds the cockpit scene overlays to a guest-flow replay artifact. The replay
// runs deterministically in the existing Web Worker (with a main-thread
// fallback), so the overlays have real simulated-flow data without any network
// dependency. Loading is gated by `enabled` — the binding stays idle outside the
// spatial-analysis lenses (see shouldLoadReplay) and the artifact is cached, so
// re-entering the Flow/Evidence lens is instant.
//
// SAFE: this is *simulated* guest flow — planning evidence, human review
// required. It is never presented as a measured or certified route.

export type CockpitReplayStatus = "idle" | "loading" | "ready" | "error";

export interface CockpitReplay {
  readonly artifact: GuestFlowReplayArtifact | null;
  readonly bounds: ReplayRoomBounds | null;
  readonly status: CockpitReplayStatus;
}

export function useCockpitReplay(enabled: boolean): CockpitReplay {
  const [artifact, setArtifact] = useState<GuestFlowReplayArtifact | null>(null);
  const [status, setStatus] = useState<CockpitReplayStatus>("idle");
  const artifactRef = useRef<GuestFlowReplayArtifact | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }
    if (artifactRef.current !== null) {
      setStatus("ready");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    void runGuestFlowReplayInBrowser(TRADES_HALL_GUEST_FLOW_REPLAY_INPUT)
      .then((result) => {
        if (cancelled) return;
        artifactRef.current = result.artifact;
        setArtifact(result.artifact);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });
    return () => { cancelled = true; };
  }, [enabled]);

  const bounds = artifact !== null ? artifact.navmesh.roomBounds : null;
  return { artifact, bounds, status };
}
