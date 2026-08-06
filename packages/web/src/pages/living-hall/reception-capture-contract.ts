import {
  sha256Hex,
  stableCanonicalJson,
  type CanonicalJsonValue,
} from "@omnitwin/types";
import bindingManifest from "./reception-capture-binding-v1.json";
import { RECEPTION_FIXED_FINE_REVIEW_PROFILE } from "./reception-viewer-profile.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,95}$/u;
export const RECEPTION_CAPTURE_SCHEMA_VERSION =
  "venviewer.reception-renderer-capture.v1";

export interface ReceptionCaptureAsset {
  readonly sourceId: string;
  readonly requestPath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface ReceptionRendererBinding {
  readonly digest: string;
  readonly runtimeBuildDigest: string;
  readonly runtimeEnvironmentDigest: string;
  readonly profileDigest: string;
  readonly toneMapDigest: string;
  readonly exposureDigest: string;
  readonly colourSpaceDigest: string;
}

export interface ReceptionCaptureConfiguration {
  readonly schemaVersion: typeof RECEPTION_CAPTURE_SCHEMA_VERSION;
  readonly candidateId: string;
  readonly viewId: string;
  readonly captureNonce: string;
  readonly profileId: string;
  readonly expectedSplatCount: number;
  readonly assetSetSha256: string;
  readonly assets: readonly ReceptionCaptureAsset[];
  readonly rendererBinding: ReceptionRendererBinding;
}

function canonical(value: unknown): string {
  return stableCanonicalJson(value as CanonicalJsonValue);
}

function componentDigest(domain: string, value: unknown): string {
  return sha256Hex(`${domain}${canonical(value)}`);
}

function captureRuntimeBuildDigest(): string {
  if (typeof __VENVIEWER_RECEPTION_CAPTURE_RUNTIME_BUILD_DIGEST__ === "string") {
    return __VENVIEWER_RECEPTION_CAPTURE_RUNTIME_BUILD_DIGEST__;
  }
  if (import.meta.env.MODE === "test") return "0".repeat(64);
  throw new Error("Reception capture build digest is unavailable.");
}

function captureRuntimeEnvironmentDigest(): string {
  if (typeof __VENVIEWER_RECEPTION_CAPTURE_RUNTIME_ENVIRONMENT_DIGEST__ === "string") {
    return __VENVIEWER_RECEPTION_CAPTURE_RUNTIME_ENVIRONMENT_DIGEST__;
  }
  if (import.meta.env.MODE === "test") return "0".repeat(64);
  throw new Error("Reception capture runtime environment digest is unavailable.");
}

export function receptionAssetSetDigest(assets: readonly ReceptionCaptureAsset[]): string {
  const identity = [...assets]
    .sort((left, right) => left.requestPath.localeCompare(right.requestPath))
    .map(({ requestPath: requestedPath, sha256: digest, sizeBytes }) => ({
      requestedPath,
      digest,
      sizeBytes,
    }));
  return sha256Hex(JSON.stringify(identity));
}

export function receptionRendererBinding(): ReceptionRendererBinding {
  const domains = bindingManifest.digestDomains;
  const runtimeBuildDigest = captureRuntimeBuildDigest();
  const runtimeEnvironmentDigest = captureRuntimeEnvironmentDigest();
  if (!SHA256.test(runtimeBuildDigest)) throw new Error("Reception capture build digest is invalid.");
  if (!SHA256.test(runtimeEnvironmentDigest)) {
    throw new Error("Reception capture runtime environment digest is invalid.");
  }
  const components = {
    colourSpaceDigest: componentDigest(domains.colourSpace, bindingManifest.colourSpace),
    exposureDigest: componentDigest(domains.exposure, bindingManifest.exposure),
    profileDigest: componentDigest(domains.profile, RECEPTION_FIXED_FINE_REVIEW_PROFILE),
    runtimeBuildDigest,
    runtimeEnvironmentDigest,
    toneMapDigest: componentDigest(domains.toneMap, bindingManifest.toneMap),
  };
  return {
    digest: componentDigest(domains.rendererBinding, components),
    ...components,
  };
}

export function buildReceptionCaptureConfiguration(
  selection: {
    readonly candidateId: string;
    readonly runtimeProfileId: string;
    readonly expectedGaussianCount: number;
    readonly captureAssets: readonly ReceptionCaptureAsset[];
    readonly reviewView: { readonly id: string; readonly experimentalViewId?: string };
  },
  captureNonce: string,
): ReceptionCaptureConfiguration {
  return {
    schemaVersion: RECEPTION_CAPTURE_SCHEMA_VERSION,
    candidateId: assertReceptionCaptureId(selection.candidateId, "Capture candidate"),
    viewId: assertReceptionCaptureId(
      selection.reviewView.experimentalViewId ?? selection.reviewView.id,
      "Capture view",
    ),
    captureNonce: assertReceptionCaptureId(captureNonce, "Capture challenge"),
    profileId: assertReceptionCaptureId(selection.runtimeProfileId, "Capture profile"),
    expectedSplatCount: selection.expectedGaussianCount,
    assetSetSha256: receptionAssetSetDigest(selection.captureAssets),
    assets: selection.captureAssets,
    rendererBinding: receptionRendererBinding(),
  };
}

export function assertReceptionCaptureId(value: string, label: string): string {
  if (!SAFE_ID.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

export function receptionFrameDigest(value: unknown): string {
  return componentDigest(bindingManifest.digestDomains.frame, value);
}

export const RECEPTION_CAPTURE_BINDING_MANIFEST = bindingManifest;
