import type { PhaseLayoutRuntimeAvailableBinding } from "@omnitwin/types";
import { API_URL } from "../config/env.js";
import { getAuthToken } from "./client.js";

export type HistoricalRuntimeAssetErrorCode =
  | "ABORTED"
  | "AUTH_UNAVAILABLE"
  | "BINDING_MISMATCH"
  | "DIGEST_MISMATCH"
  | "HEADER_MISMATCH"
  | "HTTP_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "SIZE_MISMATCH";

export class HistoricalRuntimeAssetError extends Error {
  readonly code: HistoricalRuntimeAssetErrorCode;
  readonly status: number | null;

  constructor(
    code: HistoricalRuntimeAssetErrorCode,
    message: string,
    status: number | null = null,
  ) {
    super(message);
    this.name = "HistoricalRuntimeAssetError";
    this.code = code;
    this.status = status;
  }
}

export type PhaseLayoutRuntimeVisualAsset =
  PhaseLayoutRuntimeAvailableBinding["visualAssets"][number];

export interface VerifiedHistoricalRuntimeAsset {
  readonly member: PhaseLayoutRuntimeVisualAsset;
  readonly bytes: ArrayBuffer;
}

interface HistoricalRuntimeAssetRequestDependencies {
  readonly fetch: typeof fetch;
  readonly getAuthToken: typeof getAuthToken;
  readonly digest: (bytes: ArrayBuffer) => Promise<string>;
}

const defaultDependencies: HistoricalRuntimeAssetRequestDependencies = {
  fetch: globalThis.fetch.bind(globalThis),
  getAuthToken,
  digest: sha256Hex,
};

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new HistoricalRuntimeAssetError("ABORTED", "Historical runtime request was cancelled.");
  }
}

function isAbortError(value: unknown): boolean {
  return value instanceof DOMException && value.name === "AbortError";
}

function memberBelongsToBinding(
  binding: PhaseLayoutRuntimeAvailableBinding,
  member: PhaseLayoutRuntimeVisualAsset,
): boolean {
  const boundMember = binding.visualAssets[member.memberIndex];
  return boundMember !== undefined &&
    boundMember.memberIndex === member.memberIndex &&
    boundMember.assetVersionId === member.assetVersionId &&
    boundMember.fileName === member.fileName &&
    boundMember.fileExt === member.fileExt &&
    boundMember.mimeType === member.mimeType &&
    boundMember.sha256 === member.sha256 &&
    boundMember.sizeBytes === member.sizeBytes;
}

function requireExactHeader(response: Response, name: string, expected: string): void {
  const actual = response.headers.get(name);
  if (actual !== expected) {
    throw new HistoricalRuntimeAssetError(
      "HEADER_MISMATCH",
      `Historical runtime response failed ${name} verification.`,
      response.status,
    );
  }
}

function memberPath(
  binding: PhaseLayoutRuntimeAvailableBinding,
  member: PhaseLayoutRuntimeVisualAsset,
): string {
  return [
    "/calendar/venues",
    encodeURIComponent(binding.venueId),
    "spaces",
    encodeURIComponent(binding.spaceId),
    "runtime-bindings",
    encodeURIComponent(binding.bindingId),
    "members",
    String(member.memberIndex),
    encodeURIComponent(member.fileName),
  ].join("/");
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

/**
 * Dormant client shape for T-541's future independently authenticated HEAD
 * proof. The current API deliberately returns 404 for member GET and automatic
 * HEAD, while production timeline bindings are unavailable-only. Consequently
 * this function cannot authorize a real ready resource on the current branch;
 * its success path is exercised only as a synthetic contract test.
 */
export async function authorizeHistoricalRuntimeBinding(
  binding: PhaseLayoutRuntimeAvailableBinding,
  signal: AbortSignal,
  dependencies: HistoricalRuntimeAssetRequestDependencies = defaultDependencies,
): Promise<void> {
  throwIfAborted(signal);
  const member = binding.visualAssets[0];
  if (member === undefined || !memberBelongsToBinding(binding, member)) {
    throw new HistoricalRuntimeAssetError(
      "BINDING_MISMATCH",
      "Historical runtime binding has no exact member to authorize.",
    );
  }
  const token = await dependencies.getAuthToken();
  throwIfAborted(signal);
  if (token === null) {
    throw new HistoricalRuntimeAssetError(
      "AUTH_UNAVAILABLE",
      "An authenticated session is required for historical runtime bytes.",
    );
  }

  let response: Response;
  try {
    response = await dependencies.fetch(`${API_URL}${memberPath(binding, member)}`, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal,
    });
  } catch (error: unknown) {
    if (signal.aborted || isAbortError(error)) {
      throw new HistoricalRuntimeAssetError("ABORTED", "Historical runtime request was cancelled.");
    }
    throw new HistoricalRuntimeAssetError(
      "NETWORK_ERROR",
      "Historical runtime binding could not be authorized.",
    );
  }
  if (response.status !== 200) {
    throw new HistoricalRuntimeAssetError(
      "HTTP_UNAVAILABLE",
      "Historical runtime binding is unavailable.",
      response.status,
    );
  }
  requireExactHeader(response, "content-type", member.mimeType);
  requireExactHeader(response, "content-length", String(member.sizeBytes));
  requireExactHeader(response, "cache-control", "private, no-store");
  requireExactHeader(response, "x-content-sha256", member.sha256);
  requireExactHeader(response, "x-runtime-binding-digest", binding.bindingDigest);
  requireExactHeader(
    response,
    "x-runtime-package-content-digest",
    binding.runtimePackageContentDigest,
  );
  requireExactHeader(response, "x-asset-version-id", member.assetVersionId);
}

/**
 * Fetch one immutable phase-runtime member and authenticate every identity
 * header plus the complete response body before returning bytes to a decoder.
 */
export async function fetchVerifiedHistoricalRuntimeAsset(
  binding: PhaseLayoutRuntimeAvailableBinding,
  member: PhaseLayoutRuntimeVisualAsset,
  signal: AbortSignal,
  dependencies: HistoricalRuntimeAssetRequestDependencies = defaultDependencies,
): Promise<VerifiedHistoricalRuntimeAsset> {
  throwIfAborted(signal);
  if (!memberBelongsToBinding(binding, member)) {
    throw new HistoricalRuntimeAssetError(
      "BINDING_MISMATCH",
      "Historical runtime member does not belong to the frozen binding.",
    );
  }
  const token = await dependencies.getAuthToken();
  throwIfAborted(signal);
  if (token === null) {
    throw new HistoricalRuntimeAssetError(
      "AUTH_UNAVAILABLE",
      "An authenticated session is required for historical runtime bytes.",
    );
  }

  let response: Response;
  try {
    response = await dependencies.fetch(`${API_URL}${memberPath(binding, member)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal,
    });
  } catch (error: unknown) {
    if (signal.aborted || isAbortError(error)) {
      throw new HistoricalRuntimeAssetError("ABORTED", "Historical runtime request was cancelled.");
    }
    throw new HistoricalRuntimeAssetError(
      "NETWORK_ERROR",
      "Historical runtime bytes could not be requested.",
    );
  }

  if (response.status !== 200) {
    throw new HistoricalRuntimeAssetError(
      "HTTP_UNAVAILABLE",
      "Historical runtime bytes are unavailable.",
      response.status,
    );
  }

  requireExactHeader(response, "content-type", member.mimeType);
  requireExactHeader(response, "content-length", String(member.sizeBytes));
  requireExactHeader(response, "cache-control", "private, no-store");
  requireExactHeader(response, "x-content-sha256", member.sha256);
  requireExactHeader(response, "x-runtime-binding-digest", binding.bindingDigest);
  requireExactHeader(
    response,
    "x-runtime-package-content-digest",
    binding.runtimePackageContentDigest,
  );
  requireExactHeader(response, "x-asset-version-id", member.assetVersionId);

  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch (error: unknown) {
    if (signal.aborted || isAbortError(error)) {
      throw new HistoricalRuntimeAssetError("ABORTED", "Historical runtime request was cancelled.");
    }
    throw new HistoricalRuntimeAssetError(
      "NETWORK_ERROR",
      "Historical runtime bytes could not be read.",
      response.status,
    );
  }
  throwIfAborted(signal);

  if (bytes.byteLength !== member.sizeBytes) {
    throw new HistoricalRuntimeAssetError(
      "SIZE_MISMATCH",
      "Historical runtime byte length did not match the frozen member.",
      response.status,
    );
  }

  const digest = await dependencies.digest(bytes);
  throwIfAborted(signal);
  if (digest !== member.sha256) {
    throw new HistoricalRuntimeAssetError(
      "DIGEST_MISMATCH",
      "Historical runtime bytes failed SHA-256 verification.",
      response.status,
    );
  }

  return { member, bytes };
}
