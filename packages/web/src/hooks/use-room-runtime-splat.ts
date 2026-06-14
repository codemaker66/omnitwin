import { useEffect, useState } from "react";
import type { RuntimePackage } from "@omnitwin/types";
import { useEditorStore } from "../stores/editor-store.js";
import { useCockpitStore } from "../stores/cockpit-store.js";
import { getLatestRuntimePackage } from "../api/runtime-packages.js";
import {
  decideRuntimeAsset,
  runtimeAssetViewTransformForRoom,
  TRADES_HALL_RUNTIME_ROOMS,
  type RuntimeAssetViewTransform,
  type TradesHallRuntimeRoomSlug,
} from "../lib/runtime-package-resolution.js";

// Resolves the registered runtime splat for the room currently open in the
// planner. The cockpit is single-tenant (Trades Hall): the room slug comes from
// the loaded space, the venue is fixed. Mirrors the dev route's proven
// decision pipeline (decideRuntimeAsset → splat URLs + view transform) and
// reflects the runtime-asset status into the cockpit top bar. Public read;
// degrades to the procedural scene whenever no usable package exists.

const RUNTIME_VENUE = "trades-hall";
const PROCEDURAL_STATUS = "Procedural layer / no signed capture";
const IDENTITY_TRANSFORM: RuntimeAssetViewTransform = runtimeAssetViewTransformForRoom("grand-hall");

export type RoomRuntimeSplatStatus = "idle" | "loading" | "loaded" | "none";

export interface RoomRuntimeSplat {
  readonly splatUrls: readonly string[];
  readonly transform: RuntimeAssetViewTransform;
  readonly hasAsset: boolean;
  readonly status: RoomRuntimeSplatStatus;
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

  const decision = decideRuntimeAsset(null, pkg);
  const hasAsset = decision.source === "package" && decision.splatUrls.length > 0;
  const transform = roomSlug !== null ? runtimeAssetViewTransformForRoom(roomSlug) : IDENTITY_TRANSFORM;
  const runtimeLabel = hasAsset ? decision.evidenceLabel : PROCEDURAL_STATUS;

  useEffect(() => {
    useCockpitStore.getState().setRuntimeAssetStatus(runtimeLabel);
  }, [runtimeLabel]);

  return { splatUrls: decision.splatUrls, transform, hasAsset, status };
}
