import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  TRADES_HALL_ENQUIRY_VENUE_SLUG,
  type RuntimePackage,
} from "@omnitwin/types";
import { useEditorStore } from "../stores/editor-store.js";
import {
  useCockpitStore,
  type ExactGrandHallRuntimeKey,
} from "../stores/cockpit-store.js";
import { getLatestRuntimePackage } from "../api/runtime-packages.js";
import { getVenue } from "../api/spaces.js";
import { validateGrandHallCapturedSource } from "../lib/grand-hall-captured-source.js";
import type { PlannerRoomIdentity } from "../lib/planner-layer-composition.js";
import {
  decideRuntimeAsset,
  GRAND_HALL_CAPTURE_UNAVAILABLE_STATUS,
  plannerRuntimeChipLabel,
  runtimeAssetViewTransformForRoom,
  TRADES_HALL_RUNTIME_ROOMS,
  type RuntimeAssetViewTransform,
  type TradesHallRuntimeRoomSlug,
} from "../lib/runtime-package-resolution.js";

// Resolves the registered runtime splat for the room currently open in the
// planner. Both the database venue identity and room slug are verified before
// resolving the Trades Hall asset namespace. Generic rooms retain the legacy
// URL decision pipeline; Grand Hall returns only an immutable package ID for
// the authenticated byte-verifying renderer and fails closed without it.

const RUNTIME_VENUE = "trades-hall";
const IDENTITY_TRANSFORM: RuntimeAssetViewTransform = runtimeAssetViewTransformForRoom("grand-hall");

export type RoomRuntimeSplatStatus = "idle" | "loading" | "loaded" | "none";

export interface RoomRuntimeSplat {
  readonly splatUrls: readonly string[];
  readonly transform: RuntimeAssetViewTransform;
  readonly hasAsset: boolean;
  readonly status: RoomRuntimeSplatStatus;
  readonly delivery: "none" | "verified-grand-hall" | "url";
  readonly runtimePackageId: string | null;
  readonly exactGrandHallRuntimeKey: ExactGrandHallRuntimeKey | null;
  readonly roomIdentity: PlannerRoomIdentity | null;
}

interface LoadedRoomRuntimePackage {
  readonly spaceId: string;
  readonly venueId: string;
  readonly roomSlug: string;
  readonly venueSlug: string | null;
  readonly runtimePackage: RuntimePackage | null;
  readonly status: Exclude<RoomRuntimeSplatStatus, "idle" | "loading">;
}

function runtimeRoomSlug(slug: string | null): TradesHallRuntimeRoomSlug | null {
  if (slug === null) return null;
  return TRADES_HALL_RUNTIME_ROOMS.find((room) => room.slug === slug)?.slug ?? null;
}

export function useRoomRuntimeSplat(): RoomRuntimeSplat {
  const space = useEditorStore((s) => s.space);
  const spaceId = space?.id ?? null;
  const spaceSlug = space?.slug ?? null;
  const venueId = space?.venueId ?? null;
  const runtimeSlug = runtimeRoomSlug(spaceSlug);
  const [loaded, setLoaded] = useState<LoadedRoomRuntimePackage | null>(null);

  useEffect(() => {
    if (spaceId === null || spaceSlug === null || venueId === null) {
      setLoaded(null);
      return;
    }
    const request = new AbortController();
    const commitLoaded = (next: LoadedRoomRuntimePackage): void => {
      if (!request.signal.aborted) setLoaded(next);
    };

    const resolveRoom = async (): Promise<void> => {
      try {
        const venue = await getVenue(venueId);
        if (request.signal.aborted) return;
        if (venue.id !== venueId) {
          commitLoaded({
            spaceId,
            venueId,
            roomSlug: spaceSlug,
            venueSlug: null,
            runtimePackage: null,
            status: "none",
          });
          return;
        }

        let runtimePackage: RuntimePackage | null = null;
        if (
          venue.slug === TRADES_HALL_ENQUIRY_VENUE_SLUG
          && runtimeSlug !== null
        ) {
          try {
            runtimePackage = await getLatestRuntimePackage({
              venue: RUNTIME_VENUE,
              room: runtimeSlug,
            });
          } catch {
            runtimePackage = null;
          }
        }
        const exactTarget = runtimePackage === null
          || (
            runtimePackage.venueSlug === RUNTIME_VENUE
            && runtimePackage.roomSlug === runtimeSlug
          );
        commitLoaded({
          spaceId,
          venueId,
          roomSlug: spaceSlug,
          venueSlug: venue.slug,
          runtimePackage: exactTarget ? runtimePackage : null,
          status: runtimePackage !== null && exactTarget ? "loaded" : "none",
        });
      } catch {
        commitLoaded({
          spaceId,
          venueId,
          roomSlug: spaceSlug,
          venueSlug: null,
          runtimePackage: null,
          status: "none",
        });
      }
    };

    void resolveRoom();
    return () => { request.abort(); };
  }, [runtimeSlug, spaceId, spaceSlug, venueId]);

  // React runs effects after render. Bind the response to the room that
  // requested it so a room switch can never expose the previous room's URLs,
  // even for the render before the new request effect clears state.
  const loadedMatches = loaded?.spaceId === spaceId
    && loaded.venueId === venueId
    && loaded.roomSlug === spaceSlug;
  const roomIdentity = useMemo<PlannerRoomIdentity | null>(() => {
    if (spaceId === null || venueId === null || spaceSlug === null) return null;
    if (!loadedMatches) {
      return {
        spaceId,
        venueId,
        roomSlug: spaceSlug,
        status: "pending",
        venueSlug: null,
      };
    }
    if (loaded.venueSlug === null) {
      return {
        spaceId,
        venueId,
        roomSlug: spaceSlug,
        status: "unavailable",
        venueSlug: null,
      };
    }
    return {
      spaceId,
      venueId,
      roomSlug: spaceSlug,
      status: "resolved",
      venueSlug: loaded.venueSlug,
    };
  }, [loaded, loadedMatches, spaceId, spaceSlug, venueId]);
  const pkg = loadedMatches ? loaded.runtimePackage : null;
  const verifiedTradesHallGrandHall = roomIdentity?.status === "resolved"
    && roomIdentity.venueSlug === TRADES_HALL_ENQUIRY_VENUE_SLUG
    && roomIdentity.roomSlug === "grand-hall";
  const exactGrandHall = verifiedTradesHallGrandHall
    && pkg !== null
    && validateGrandHallCapturedSource(pkg).ok;
  const exactGrandHallRuntimePackageId = exactGrandHall ? pkg.id : null;
  const exactGrandHallRuntimeKey = useMemo<ExactGrandHallRuntimeKey | null>(() => {
    if (
      exactGrandHallRuntimePackageId === null
      || spaceId === null
      || venueId === null
    ) {
      return null;
    }
    return {
      spaceId,
      venueId,
      roomSlug: "grand-hall",
      runtimePackageId: exactGrandHallRuntimePackageId,
    };
  }, [exactGrandHallRuntimePackageId, spaceId, venueId]);
  const decision = exactGrandHall ? decideRuntimeAsset(null, null) : decideRuntimeAsset(null, pkg);
  const delivery = exactGrandHall
    ? "verified-grand-hall"
    : decision.source === "package" && decision.splatUrls.length > 0
      ? "url"
      : "none";
  const hasAsset = delivery !== "none";
  const status: RoomRuntimeSplatStatus = spaceId === null || spaceSlug === null || venueId === null
    ? "none"
    : loadedMatches
      ? loaded.status
      : "loading";
  const transform = runtimeSlug !== null
    ? runtimeAssetViewTransformForRoom(runtimeSlug)
    : IDENTITY_TRANSFORM;
  const unresolvedIdentityLabel = roomIdentity?.status === "pending"
    ? "Room identity resolving — architectural layer hidden"
    : roomIdentity?.status === "unavailable"
      ? "Room identity unavailable — architectural layer hidden"
      : null;
  const runtimeLabel = exactGrandHall
    ? "Captured Grand Hall selected — verifying exact protected bytes"
    : verifiedTradesHallGrandHall
      ? GRAND_HALL_CAPTURE_UNAVAILABLE_STATUS
      : unresolvedIdentityLabel ?? plannerRuntimeChipLabel(decision);

  useLayoutEffect(() => {
    const store = useCockpitStore.getState();
    if (exactGrandHallRuntimeKey === null) {
      store.setRuntimeAssetStatus(runtimeLabel);
      return undefined;
    }

    const attemptNonce = store.beginExactGrandHallRuntime(exactGrandHallRuntimeKey);
    return () => {
      useCockpitStore.getState().clearExactGrandHallRuntime(exactGrandHallRuntimeKey, attemptNonce);
    };
  }, [exactGrandHallRuntimeKey, runtimeLabel]);

  useEffect(() => {
    useCockpitStore.getState().setPlannerRoomIdentity(roomIdentity);
  }, [roomIdentity]);

  return {
    splatUrls: delivery === "url" ? decision.splatUrls : [],
    transform,
    hasAsset,
    status,
    delivery,
    runtimePackageId: exactGrandHallRuntimePackageId,
    exactGrandHallRuntimeKey,
    roomIdentity,
  };
}
