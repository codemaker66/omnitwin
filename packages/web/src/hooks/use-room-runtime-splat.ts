import { useEffect, useMemo, useState } from "react";
import type { RuntimePackage } from "@omnitwin/types";
import { useEditorStore } from "../stores/editor-store.js";
import { useCockpitStore } from "../stores/cockpit-store.js";
import { getLatestRuntimePackage } from "../api/runtime-packages.js";
import {
  decideRuntimeAsset,
  plannerRuntimeChipLabel,
  runtimeAssetViewTransformForRoom,
  TRADES_HALL_RUNTIME_ROOMS,
  type RuntimeAssetViewTransform,
  type TradesHallRuntimeRoomSlug,
} from "../lib/runtime-package-resolution.js";

// Resolves the captured splat for the room currently open in the planner. The
// cockpit is single-tenant (Trades Hall): the room slug comes from the loaded
// space, the venue is fixed.
//
// Precedence is the shared decision pipeline's: a registered, immutable
// RuntimePackage always wins; failing that, the room's staged capture mounts —
// real measured tiles under their honest staged label (the Stage programme's
// S1 decision: planning happens INSIDE the captured room, and the chip says
// exactly what vouches for it, which today is staging, not review). Rooms with
// neither degrade to the atelier fallback (procedural clay + ink scene) —
// never a blank canvas.

const RUNTIME_VENUE = "trades-hall";
const IDENTITY_TRANSFORM: RuntimeAssetViewTransform = runtimeAssetViewTransformForRoom("grand-hall", "none");

export type RoomRuntimeSplatStatus = "idle" | "loading" | "loaded" | "none";

export interface RoomRuntimeSplat {
  readonly splatUrls: readonly string[];
  readonly transform: RuntimeAssetViewTransform;
  readonly hasAsset: boolean;
  readonly status: RoomRuntimeSplatStatus;
  /** The canonical runtime room slug for the loaded space, when it has one. */
  readonly roomSlug: TradesHallRuntimeRoomSlug | null;
}

function runtimeRoomSlug(slug: string | null): TradesHallRuntimeRoomSlug | null {
  if (slug === null) return null;
  return TRADES_HALL_RUNTIME_ROOMS.find((room) => room.slug === slug)?.slug ?? null;
}

export function useRoomRuntimeSplat(): RoomRuntimeSplat {
  const spaceSlug = useEditorStore((s) => s.space?.slug ?? null);
  const roomSlug = runtimeRoomSlug(spaceSlug);
  const [pkg, setPkg] = useState<RuntimePackage | null>(null);
  const [status, setStatus] = useState<RoomRuntimeSplatStatus>("none");

  useEffect(() => {
    if (roomSlug === null) {
      setPkg(null);
      setStatus("none");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setPkg(null);
    void getLatestRuntimePackage({ venue: RUNTIME_VENUE, room: roomSlug })
      .then((loaded) => {
        if (cancelled) return;
        setPkg(loaded);
        setStatus(loaded === null ? "none" : "loaded");
      })
      .catch(() => {
        if (cancelled) return;
        setPkg(null);
        setStatus("none");
      });
    return () => { cancelled = true; };
  }, [roomSlug]);

  // Memoised because PlannerScene re-renders on every chunk arrival: the
  // staged branches build fresh objects per call, and churning them through
  // the scene during the develop window is pure waste.
  const decision = useMemo(() => decideRuntimeAsset(null, pkg, {
    room: roomSlug,
    // The planner is a working surface for people planning real events in
    // these rooms; seeing the staged capture is the point. The label carries
    // the honesty: STAGED_CAPTURE_STATUS flows into the cockpit chip below.
    allowStagedCapture: true,
  }), [pkg, roomSlug]);
  const hasAsset = decision.source !== "none" && decision.splatUrls.length > 0;
  const transform = useMemo(() => (roomSlug !== null
    ? runtimeAssetViewTransformForRoom(roomSlug, decision.source)
    : IDENTITY_TRANSFORM), [roomSlug, decision.source]);
  const runtimeLabel = plannerRuntimeChipLabel(decision);

  useEffect(() => {
    useCockpitStore.getState().setRuntimeAssetStatus(runtimeLabel);
  }, [runtimeLabel]);

  return { splatUrls: decision.splatUrls, transform, hasAsset, status, roomSlug };
}
