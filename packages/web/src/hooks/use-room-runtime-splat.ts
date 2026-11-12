import { useEffect, useMemo, useState } from "react";
import type { RuntimePackage } from "@omnitwin/types";
import { useEditorStore } from "../stores/editor-store.js";
import { useCockpitStore } from "../stores/cockpit-store.js";
import { useAuthStore } from "../stores/auth-store.js";
import { getLatestRuntimePackage } from "../api/runtime-packages.js";
import { gaussianSplatsAvailable } from "../lib/splat-access.js";
import {
  currentSearch,
  deviceDayBundleForRoom,
  deviceDayRuntimeLabel,
  deviceDayTileUrls,
  deviceDayViewTransform,
} from "../data/device-day-splat-bundles.js";
import {
  decideRuntimeAsset,
  plannerRuntimeChipLabel,
  runtimeAssetViewTransformForRoom,
  TRADES_HALL_RUNTIME_ROOMS,
  type RuntimeAssetDecision,
  type RuntimeAssetViewTransform,
  type RuntimeAssetSource,
  type TradesHallRuntimeRoomSlug,
} from "../lib/runtime-package-resolution.js";

// Resolves the captured splat for the room currently open in the planner. The
// cockpit is single-tenant (Trades Hall): the room slug comes from the loaded
// space, the venue is fixed.
//
// Production keeps Gaussian splats unavailable while this work is in progress.
// Development preserves the shared decision pipeline: a registered, immutable
// RuntimePackage always wins; failing that, the room's staged capture mounts —
// real measured tiles under their honest staged label (the Stage programme's
// S1 decision: planning happens INSIDE the captured room, and the chip says
// exactly what vouches for it, which today is staging, not review). Rooms with
// neither degrade to the atelier fallback (procedural clay + ink scene) —
// never a blank canvas.
//
// One exception, in every build: an allowlisted device-day timing cut named
// by `?splatBundle=` for the open room (data/device-day-splat-bundles.ts)
// replaces the captured layer outright, ahead of the registry and the staged
// tiles, and says so on the status line.

const RUNTIME_VENUE = "trades-hall";
const IDENTITY_TRANSFORM: RuntimeAssetViewTransform = runtimeAssetViewTransformForRoom("grand-hall", "none");

export type RoomRuntimeSplatStatus = "idle" | "loading" | "loaded" | "none";

export interface RoomRuntimeSplat {
  readonly splatUrls: readonly string[];
  /** Explicit environment roles from the selected source, not URL names. */
  readonly environmentUrls: readonly string[];
  readonly transform: RuntimeAssetViewTransform;
  readonly hasAsset: boolean;
  readonly status: RoomRuntimeSplatStatus;
  /** The canonical runtime room slug for the loaded space, when it has one. */
  readonly roomSlug: TradesHallRuntimeRoomSlug | null;
  readonly source: RuntimeAssetSource;
}

function runtimeRoomSlug(slug: string | null): TradesHallRuntimeRoomSlug | null {
  if (slug === null) return null;
  return TRADES_HALL_RUNTIME_ROOMS.find((room) => room.slug === slug)?.slug ?? null;
}

interface DeviceDayCapture {
  readonly decision: RuntimeAssetDecision;
  readonly transform: RuntimeAssetViewTransform;
}

/** The device-day cut this page asked for in this room, as a staged capture; null otherwise. */
function deviceDayCapture(search: string, roomSlug: string | null): DeviceDayCapture | null {
  const bundle = deviceDayBundleForRoom(search, roomSlug);
  const transform = bundle === null ? null : deviceDayViewTransform(bundle);
  if (bundle === null || transform === null) return null;
  const urls = deviceDayTileUrls(bundle);
  return {
    transform,
    // "staged": tiles described by a checked-in manifest with no registry row,
    // which is what Showcase's capture path and the arrival walk expect.
    decision: {
      splatUrl: urls[0] ?? null,
      splatUrls: urls,
      environmentUrls: [],
      source: "staged",
      evidenceStatus: null,
      evidenceLabel: deviceDayRuntimeLabel(bundle),
      isProceduralFallback: false,
    },
  };
}

export function useRoomRuntimeSplat(): RoomRuntimeSplat {
  const spaceSlug = useEditorStore((s) => s.space?.slug ?? null);
  const roomSlug = runtimeRoomSlug(spaceSlug);
  const user = useAuthStore((state) => state.user);
  const splatsAvailable = gaussianSplatsAvailable();
  const search = currentSearch();
  const deviceDay = useMemo(() => deviceDayCapture(search, roomSlug), [search, roomSlug]);
  const canReadRegistry = splatsAvailable && user?.platformRole === "admin" && deviceDay === null;
  const requestKey = JSON.stringify([roomSlug, user?.id, user?.role, user?.venueId, user?.platformRole]);
  const [packageKey, setPackageKey] = useState<string | null>(null);
  const [pkg, setPkg] = useState<RuntimePackage | null>(null);
  const [status, setStatus] = useState<RoomRuntimeSplatStatus>("none");

  useEffect(() => {
    setPackageKey(requestKey);
    if (roomSlug === null || !canReadRegistry) {
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
  }, [canReadRegistry, requestKey, roomSlug]);

  // Memoised because PlannerScene re-renders on every chunk arrival: the
  // staged branches build fresh objects per call, and churning them through
  // the scene during the develop window is pure waste.
  const currentPackage = canReadRegistry && packageKey === requestKey ? pkg : null;
  const decision = useMemo(() => deviceDay?.decision ?? decideRuntimeAsset(null, currentPackage, {
    room: roomSlug,
    // The production hold covers staged captures as well as the registry.
    allowStagedCapture: splatsAvailable,
  }), [deviceDay, currentPackage, roomSlug, splatsAvailable]);
  const hasAsset = decision.source !== "none" && decision.splatUrls.length > 0;
  const transform = useMemo(() => deviceDay?.transform ?? (roomSlug !== null
    ? runtimeAssetViewTransformForRoom(roomSlug, decision.source)
    : IDENTITY_TRANSFORM), [deviceDay, roomSlug, decision.source]);
  const runtimeLabel = deviceDay !== null
    ? decision.evidenceLabel
    : splatsAvailable
      ? plannerRuntimeChipLabel(decision)
      : "Gaussian splats · Work in progress";

  useEffect(() => {
    useCockpitStore.getState().setRuntimeAssetStatus(runtimeLabel);
  }, [runtimeLabel]);

  const currentStatus = !canReadRegistry || roomSlug === null ? "none" : packageKey === requestKey ? status : "loading";
  return { splatUrls: decision.splatUrls, environmentUrls: decision.environmentUrls, transform, hasAsset, status: currentStatus, roomSlug, source: decision.source };
}
