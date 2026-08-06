import type { SparkSplatSource } from "../../components/scene/spark-splat-source.js";
import type { ReceptionCaptureAsset } from "./reception-capture-contract.js";
import {
  RECEPTION_MOBILE_RUNTIME_PROFILE,
  RECEPTION_QUALITY_RUNTIME_PROFILE,
} from "./reception-runtime-profiles.js";
import type { ReceptionReviewView } from "./reception-review-views.js";

export type ReceptionLocalPreflightCandidateId = "quality" | "mobile";

export interface ReceptionLocalPreflightSelection {
  readonly candidateId: ReceptionLocalPreflightCandidateId;
  readonly runtimeProfileId: "quality-sog-fine-v1" | "mobile-spz-fine-v1";
  readonly label: string;
  readonly expectedGaussianCount: number;
  readonly splatSources: readonly SparkSplatSource[];
  readonly captureAssets: readonly ReceptionCaptureAsset[];
  readonly reviewView: ReceptionReviewView;
}

const DEFAULT_MOBILE_FILE_ORIGIN = "http://127.0.0.1:4174";

/**
 * The replay runner owns these development-only origins. Keeping the parser
 * here means a malformed workstation setting fails before a capture can mix
 * an unexpected asset source into the fixed comparison.
 */
export function resolveReceptionLocalAssetOrigin(
  configured: string | undefined,
  fallback: string,
): string {
  const candidate = configured?.trim();
  if (candidate === undefined || candidate.length === 0) return fallback;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("A Reception local comparison origin is not a valid URL.");
  }
  const port = Number(parsed.port);
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !Number.isInteger(port) ||
    port < 1_024 ||
    port > 65_535
  ) {
    throw new Error(
      "A Reception local comparison origin must be an explicit 127.0.0.1 HTTP port.",
    );
  }
  return parsed.origin;
}

const QUALITY_FILE_ORIGIN = resolveReceptionLocalAssetOrigin(
  import.meta.env.VITE_RECEPTION_QUALITY_ORIGIN,
  "",
);
const MOBILE_FILE_ORIGIN = resolveReceptionLocalAssetOrigin(
  import.meta.env.VITE_RECEPTION_MOBILE_ORIGIN,
  DEFAULT_MOBILE_FILE_ORIGIN,
);

function urlSources(
  candidateId: ReceptionLocalPreflightCandidateId,
  urls: readonly string[],
): readonly SparkSplatSource[] {
  return urls.map((url) => ({
    kind: "url",
    id: `local-preflight:${candidateId}:${url.slice(url.lastIndexOf("/") + 1)}`,
    url,
  }));
}

function captureAssets(
  candidateId: ReceptionLocalPreflightCandidateId,
  sources: readonly SparkSplatSource[],
  assets: readonly { readonly fileName: string; readonly sha256: string; readonly sizeBytes: number }[],
): readonly ReceptionCaptureAsset[] {
  return assets.map((asset, index) => {
    const source = sources[index];
    if (source === undefined) throw new Error(`${candidateId} capture source is missing.`);
    return {
      sourceId: source.id,
      requestPath: `/${asset.fileName}`,
      sha256: asset.sha256,
      sizeBytes: asset.sizeBytes,
    };
  });
}

/**
 * Build one of two hard-coded, reviewed local candidates. There is no path for
 * a query string to become an arbitrary asset URL.
 */
export function selectReceptionLocalPreflight(
  candidateId: ReceptionLocalPreflightCandidateId,
  reviewView: ReceptionReviewView,
): ReceptionLocalPreflightSelection {
  if (candidateId === "mobile") {
    const splatSources = urlSources(
      candidateId,
      RECEPTION_MOBILE_RUNTIME_PROFILE.assets.map(
        (asset) => `${MOBILE_FILE_ORIGIN}/${asset.fileName}`,
      ),
    );
    return {
      candidateId,
      runtimeProfileId: RECEPTION_MOBILE_RUNTIME_PROFILE.id,
      label: "Mobile SPZ · fixed fine frontier · SH0",
      expectedGaussianCount:
        RECEPTION_MOBILE_RUNTIME_PROFILE.compositionBasis.expectedGaussianCount,
      splatSources,
      captureAssets: captureAssets(candidateId, splatSources, RECEPTION_MOBILE_RUNTIME_PROFILE.assets),
      reviewView,
    };
  }

  const splatSources = urlSources(
    candidateId,
    RECEPTION_QUALITY_RUNTIME_PROFILE.assets.map((asset) =>
      QUALITY_FILE_ORIGIN.length === 0
        ? `/splats/reception/${asset.fileName}`
        : `${QUALITY_FILE_ORIGIN}/${asset.fileName}`
    ),
  );
  return {
    candidateId,
    runtimeProfileId: RECEPTION_QUALITY_RUNTIME_PROFILE.id,
    label: "Quality SOG · fixed fine frontier · SH3",
    expectedGaussianCount:
      RECEPTION_QUALITY_RUNTIME_PROFILE.compositionBasis.expectedGaussianCount,
    splatSources,
    captureAssets: captureAssets(candidateId, splatSources, RECEPTION_QUALITY_RUNTIME_PROFILE.assets),
    reviewView,
  };
}
