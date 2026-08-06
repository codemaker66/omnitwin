import {
  ApprovedRoomRuntimeProfileSchema,
  RuntimePackagePreviewSchema,
  type ApprovedRoomRuntimeProfile,
  type LatestRuntimePackageQuery,
  type RuntimePackagePreview,
  type RuntimePackagePreviewVisualAsset,
  type RuntimePackage,
} from "@omnitwin/types";
import { API_URL } from "../config/env.js";
import { ApiError, api, getAuthToken } from "./client.js";

// ---------------------------------------------------------------------------
// Runtime package client
//
// Retired browser resolver. Detailed package metadata and direct asset-ID
// streams are platform-admin-only, and URL-mode Spark requests cannot attach
// their bearer token. Public scenes must use a reviewed anonymous profile;
// legacy consumers therefore remain on their safe geometry fallback.
// ---------------------------------------------------------------------------

export function getLatestRuntimePackage(query: LatestRuntimePackageQuery): Promise<RuntimePackage | null> {
  void query;
  return Promise.resolve(null);
}

/**
 * Resolve a server-approved room profile without sending private package
 * receipts, hashes, hierarchy metadata or decision references to the browser.
 */
export async function getApprovedRoomRuntimeProfile(
  query: LatestRuntimePackageQuery,
  signal?: AbortSignal,
): Promise<ApprovedRoomRuntimeProfile | null> {
  const params = new URLSearchParams({
    venue: query.venue,
    room: query.room,
  });
  return api.get(
    `/assets/runtime-packages/approved-profile?${params.toString()}`,
    ApprovedRoomRuntimeProfileSchema.nullable(),
    signal,
  );
}

/**
 * Resolve one exact immutable package through the administrator-only preview
 * route. The response contains descriptors only: no storage keys, direct
 * links, or access credentials. The caller must never substitute the public
 * "latest" package when this exact lookup fails.
 */
export async function getRuntimePackagePreview(
  runtimePackageId: string,
  signal?: AbortSignal,
): Promise<RuntimePackagePreview> {
  const preview = await api.get(
    `/admin/assets/runtime-package-previews/${encodeURIComponent(runtimePackageId)}`,
    RuntimePackagePreviewSchema,
    signal,
  );
  if (preview.runtimePackageId !== runtimePackageId) {
    throw new ApiError(
      0,
      "Runtime preview response did not match the exact requested package",
      "RUNTIME_PACKAGE_PREVIEW_IDENTITY_MISMATCH",
    );
  }
  return preview;
}

export interface OpenRuntimePackagePreviewAsset {
  readonly sourceId: string;
  readonly fileName: string;
  readonly stream: ReadableStream<Uint8Array>;
  readonly streamLength: number;
}

function previewAssetPath(
  runtimePackageId: string,
  asset: RuntimePackagePreviewVisualAsset,
): string {
  return `/admin/assets/runtime-package-previews/${encodeURIComponent(runtimePackageId)}` +
    `/assets/${encodeURIComponent(asset.assetVersionId)}/${encodeURIComponent(asset.fileName)}`;
}

/** Open one exact preview member without putting an access credential in its URL. */
export async function openRuntimePackagePreviewAsset(
  runtimePackageId: string,
  asset: RuntimePackagePreviewVisualAsset,
  signal: AbortSignal,
): Promise<OpenRuntimePackagePreviewAsset> {
  const token = await getAuthToken();
  if (token === null) {
    throw new ApiError(401, "An administrator session is required for this preview", "UNAUTHORIZED");
  }

  const path = previewAssetPath(runtimePackageId, asset);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/octet-stream",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal,
    });
  } catch (error: unknown) {
    if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
    throw new ApiError(0, "Runtime preview stream could not be opened", "NETWORK_ERROR", error);
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ApiError(
      response.status,
      "Runtime preview asset is unavailable",
      "RUNTIME_PACKAGE_PREVIEW_ASSET_UNAVAILABLE",
    );
  }

  const contentLengthHeader = response.headers.get("content-length");
  const contentSha256Header = response.headers.get("x-content-sha256");
  const streamLength = contentLengthHeader !== null && /^\d+$/u.test(contentLengthHeader)
    ? Number(contentLengthHeader)
    : Number.NaN;
  if (
    response.body === null ||
    !Number.isSafeInteger(streamLength) ||
    streamLength <= 0 ||
    streamLength !== asset.sizeBytes ||
    contentSha256Header !== asset.sha256
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new ApiError(
      0,
      "Runtime preview asset did not match its registered byte fingerprint",
      "RUNTIME_PACKAGE_PREVIEW_ASSET_INTEGRITY_FAILED",
    );
  }

  return {
    sourceId: `${runtimePackageId}:${asset.assetVersionId}`,
    fileName: asset.fileName,
    stream: response.body,
    streamLength,
  };
}
