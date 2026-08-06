import { useEffect, useMemo, useState } from "react";
import type {
  ApprovedRoomRuntimePresentationContract,
  ApprovedRoomRuntimeProfile,
  RuntimePackagePreview,
} from "@omnitwin/types";
import {
  getApprovedRoomRuntimeProfile,
  getRuntimePackagePreview,
} from "../../api/runtime-packages.js";
import { API_URL } from "../../config/env.js";
import type { SparkSplatSource } from "../../components/scene/spark-splat-source.js";
import { parseRuntimeSplatUrl } from "../../lib/runtime-visual-asset.js";
import {
  canLoadDirectReceptionPreview,
  receptionTileUrls,
} from "./reception-dolly-path.js";
import {
  matchesReceptionLivingHallPresentationContract,
  RECEPTION_LIVING_HALL_PRESENTATION_CONTRACT,
} from "./reception-presentation-contract.js";

const LIVING_HALL_RUNTIME_TARGET = {
  venue: "trades-hall",
  room: "reception-room",
} as const;

const PUBLIC_REVIEWED_PROFILE_ID = "quality-sog-fine-v1";
const PRIVATE_REVIEWED_PROFILE_IDS = new Set([
  PUBLIC_REVIEWED_PROFILE_ID,
  "mobile-spz-fine-v1",
]);
const REVIEWED_RECEPTION_ASSET_COUNT = 4;
const PUBLIC_PROFILE_MEMBER_PATH =
  /^\/assets\/runtime-profiles\/quality-sog-fine-v1\/members\/([0-3])\/content\.sog$/u;

const LOADING_PRODUCTION_ASSET: LivingHallRuntimeAsset = {
  splatUrls: [],
  splatSources: [],
  presentationContract: null,
  status: "loading",
};

export type LivingHallRuntimeAssetStatus =
  | "direct-preview"
  | "loading"
  | "ready"
  | "fallback"
  | "private-preview-loading"
  | "private-preview-ready"
  | "private-preview-fallback";

export interface LivingHallRuntimeAsset {
  readonly splatUrls: readonly string[];
  readonly splatSources: readonly SparkSplatSource[];
  readonly presentationContract: ApprovedRoomRuntimePresentationContract | null;
  readonly status: LivingHallRuntimeAssetStatus;
}

interface LivingHallRuntimeSelectionInput {
  readonly isDevelopment: boolean;
  readonly sceneParameter: string | null;
  readonly approvedProfile: ApprovedRoomRuntimeProfile | null;
}

/** Validate the delivery URLs attached to the server's public Quality
 * attestation. Exact asset IDs, hashes, receipts, and reviewed filenames stay
 * on the server; the browser checks only safe rendering invariants. */
function selectApprovedQualityUrls(
  profile: ApprovedRoomRuntimeProfile,
): readonly string[] {
  const urls = profile.visualAssetUrls;
  if (
    profile.venueSlug !== LIVING_HALL_RUNTIME_TARGET.venue ||
    profile.roomSlug !== LIVING_HALL_RUNTIME_TARGET.room ||
    profile.profileId !== PUBLIC_REVIEWED_PROFILE_ID ||
    !matchesReceptionLivingHallPresentationContract(profile.presentationContract) ||
    urls.length !== REVIEWED_RECEPTION_ASSET_COUNT ||
    new Set(urls).size !== REVIEWED_RECEPTION_ASSET_COUNT
  ) {
    return [];
  }

  const parsedUrls: string[] = [];
  let profileOrigin: string | null = null;
  let expectedApiOrigin: string;
  try {
    expectedApiOrigin = new URL(API_URL).origin;
  } catch {
    return [];
  }
  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    if (url === undefined) return [];
    const parsed = parseRuntimeSplatUrl(url);
    if (!parsed.ok || parsed.url === null || parsed.extension !== ".sog") return [];
    let deliveryUrl: URL;
    try {
      deliveryUrl = new URL(parsed.url);
    } catch {
      return [];
    }
    const memberMatch = PUBLIC_PROFILE_MEMBER_PATH.exec(deliveryUrl.pathname);
    if (
      deliveryUrl.username.length > 0 ||
      deliveryUrl.password.length > 0 ||
      deliveryUrl.search.length > 0 ||
      deliveryUrl.hash.length > 0 ||
      memberMatch?.[1] !== String(index) ||
      deliveryUrl.origin !== expectedApiOrigin ||
      (profileOrigin !== null && deliveryUrl.origin !== profileOrigin)
    ) {
      return [];
    }
    profileOrigin = deliveryUrl.origin;
    parsedUrls.push(parsed.url);
  }

  return parsedUrls;
}

/**
 * Select the only splat URLs the Living Hall may mount.
 *
 * Development uses the four checked-in evidence leaves and never consults
 * the registry. Production receives only an opaque server review attestation
 * and its four render URLs; private package evidence never enters this hook.
 */
export function selectLivingHallSplatUrls({
  isDevelopment,
  sceneParameter,
  approvedProfile,
}: LivingHallRuntimeSelectionInput): readonly string[] {
  if (isDevelopment) {
    return canLoadDirectReceptionPreview(isDevelopment, sceneParameter)
      ? receptionTileUrls()
      : [];
  }

  return approvedProfile === null ? [] : selectApprovedQualityUrls(approvedProfile);
}

/** The authenticated server has already checked exact package membership and
 * returns an opaque reviewed profile ID. The browser deliberately does not
 * duplicate the private receipt/hash allowlist. */
export function selectLivingHallPrivatePreviewSources(
  preview: RuntimePackagePreview,
): readonly SparkSplatSource[] {
  if (
    preview.venueSlug !== LIVING_HALL_RUNTIME_TARGET.venue ||
    preview.roomSlug !== LIVING_HALL_RUNTIME_TARGET.room ||
    preview.manifestJson.venueSlug !== LIVING_HALL_RUNTIME_TARGET.venue ||
    preview.manifestJson.roomSlug !== LIVING_HALL_RUNTIME_TARGET.room
  ) {
    return [];
  }

  if (
    preview.reviewedProfileId === null ||
    !PRIVATE_REVIEWED_PROFILE_IDS.has(preview.reviewedProfileId)
  ) {
    return [];
  }

  return preview.visualAssets.map((asset) => ({
    kind: "private-stream",
    id: `${preview.runtimePackageId}:${asset.assetVersionId}`,
    runtimePackageId: preview.runtimePackageId,
    asset,
  }));
}

function urlSources(urls: readonly string[]): readonly SparkSplatSource[] {
  return urls.map((url) => ({ kind: "url", id: url, url }));
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface UseLivingHallRuntimeAssetInput {
  readonly isDevelopment: boolean;
  readonly sceneParameter: string | null;
  readonly previewPackageId?: string | null;
}

/** Resolve the production Reception Room package without weakening Tier C.
 * A missing, rejected, malformed, partial, or unreachable package resolves to
 * an empty URL list, so the page never imports or mounts its 3D scene. */
export function useLivingHallRuntimeAsset({
  isDevelopment,
  sceneParameter,
  previewPackageId = null,
}: UseLivingHallRuntimeAssetInput): LivingHallRuntimeAsset {
  const directUrls = useMemo(
    () => isDevelopment
      ? selectLivingHallSplatUrls({
          isDevelopment: true,
          sceneParameter,
          approvedProfile: null,
        })
      : [],
    [isDevelopment, sceneParameter],
  );
  const directSources = useMemo(() => urlSources(directUrls), [directUrls]);
  const [productionAsset, setProductionAsset] = useState<LivingHallRuntimeAsset>(
    LOADING_PRODUCTION_ASSET,
  );
  const privatePreviewRequested = previewPackageId !== null;

  useEffect(() => {
    if (isDevelopment && !privatePreviewRequested) {
      // Clear any earlier production result before a later mode switch can
      // start another request. The cancelled flag below also prevents a late
      // promise from writing remote URLs into the development state.
      setProductionAsset(LOADING_PRODUCTION_ASSET);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    if (privatePreviewRequested) {
      setProductionAsset({
        splatUrls: [],
        splatSources: [],
        presentationContract: null,
        status: "private-preview-loading",
      });
      if (!UUID_PATTERN.test(previewPackageId)) {
        setProductionAsset({
          splatUrls: [],
          splatSources: [],
          presentationContract: null,
          status: "private-preview-fallback",
        });
        return () => {
          cancelled = true;
          controller.abort();
        };
      }

      void getRuntimePackagePreview(previewPackageId, controller.signal)
        .then((preview) => {
          if (cancelled) return;
          const splatSources = selectLivingHallPrivatePreviewSources(preview);
          setProductionAsset({
            splatUrls: [],
            splatSources,
            presentationContract: splatSources.length > 0
              ? RECEPTION_LIVING_HALL_PRESENTATION_CONTRACT
              : null,
            status: splatSources.length > 0
              ? "private-preview-ready"
              : "private-preview-fallback",
          });
        })
        .catch(() => {
          if (cancelled) return;
          setProductionAsset({
            splatUrls: [],
            splatSources: [],
            presentationContract: null,
            status: "private-preview-fallback",
          });
        });

      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    setProductionAsset(LOADING_PRODUCTION_ASSET);
    void getApprovedRoomRuntimeProfile(LIVING_HALL_RUNTIME_TARGET, controller.signal)
      .then((approvedProfile) => {
        if (cancelled) return;
        const splatUrls = selectLivingHallSplatUrls({
          isDevelopment: false,
          sceneParameter: null,
          approvedProfile,
        });
        setProductionAsset({
          splatUrls,
          splatSources: urlSources(splatUrls),
          presentationContract: splatUrls.length > 0
            ? approvedProfile?.presentationContract ?? null
            : null,
          status: splatUrls.length > 0 ? "ready" : "fallback",
        });
      })
      .catch(() => {
        if (cancelled) return;
        setProductionAsset({
          splatUrls: [],
          splatSources: [],
          presentationContract: null,
          status: "fallback",
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isDevelopment, previewPackageId, privatePreviewRequested]);

  if (isDevelopment && !privatePreviewRequested) {
    return {
      splatUrls: directUrls,
      splatSources: directSources,
      presentationContract: directUrls.length > 0
        ? RECEPTION_LIVING_HALL_PRESENTATION_CONTRACT
        : null,
      status: directUrls.length > 0 ? "direct-preview" : "fallback",
    };
  }

  return productionAsset;
}
