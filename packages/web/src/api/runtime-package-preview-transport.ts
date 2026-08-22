import {
  RuntimePackagePreviewSchema,
  type RuntimePackagePreview,
  type RuntimePackagePreviewVisualAsset,
} from "@omnitwin/types";
import { z } from "zod";
import { API_URL } from "../config/env.js";
import { getAuthToken } from "./client.js";

const RuntimePackageIdSchema = z.string().uuid();
const RuntimePackagePreviewEnvelopeSchema = z.object({
  data: RuntimePackagePreviewSchema,
}).strict();

const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_MEMBER_BYTES = 16 * 1024 * 1024;
const PRIVATE_NO_STORE = "private, no-store, max-age=0";
const PRIVATE_VARY = "Origin, Authorization";

export type RuntimePackagePreviewTransportErrorCode =
  | "ABORTED"
  | "AUTH_UNAVAILABLE"
  | "DIGEST_MISMATCH"
  | "DIGEST_UNAVAILABLE"
  | "HEADER_MISMATCH"
  | "HTTP_UNAVAILABLE"
  | "INPUT_INVALID"
  | "MEMBER_MISMATCH"
  | "NETWORK_ERROR"
  | "PACKAGE_MISMATCH"
  | "RESPONSE_SCHEMA_INVALID"
  | "RESPONSE_URL_MISMATCH"
  | "SIZE_MISMATCH";

export class RuntimePackagePreviewTransportError extends Error {
  readonly code: RuntimePackagePreviewTransportErrorCode;
  readonly status: number | null;

  constructor(
    code: RuntimePackagePreviewTransportErrorCode,
    message: string,
    status: number | null = null,
  ) {
    super(message);
    this.name = "RuntimePackagePreviewTransportError";
    this.code = code;
    this.status = status;
  }
}

export interface VerifiedRuntimePackagePreviewMember {
  readonly assetVersionId: string;
  readonly fileName: string;
  readonly fileExt: ".sog" | ".spz";
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly bytes: ArrayBuffer;
}

export interface VerifiedRuntimePackagePreview {
  readonly preview: RuntimePackagePreview;
  readonly members: readonly VerifiedRuntimePackagePreviewMember[];
}

export interface RuntimePackagePreviewTransportDependencies {
  readonly fetch: typeof globalThis.fetch;
  readonly getAuthToken: typeof getAuthToken;
  readonly digest: (bytes: ArrayBuffer) => Promise<string>;
}

const defaultDependencies: RuntimePackagePreviewTransportDependencies = {
  fetch: globalThis.fetch.bind(globalThis),
  getAuthToken,
  digest: sha256Hex,
};

function transportError(
  code: RuntimePackagePreviewTransportErrorCode,
  message: string,
  status: number | null = null,
): RuntimePackagePreviewTransportError {
  return new RuntimePackagePreviewTransportError(code, message, status);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw transportError("ABORTED", "Runtime package preview request was cancelled.");
  }
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === "AbortError";
}

async function awaitWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (next: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      next();
    };
    const onAbort = (): void => {
      settle(() => {
        reject(transportError("ABORTED", "Runtime package preview request was cancelled."));
      });
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(
      (value) => { settle(() => { resolve(value); }); },
      (error: unknown) => {
        settle(() => {
          reject(error instanceof Error
            ? error
            : new Error("Runtime package preview operation failed."));
        });
      },
    );
  });
}

function configuredApiUrl(path: string): string {
  return new URL(`${API_URL.replace(/\/+$/u, "")}${path}`).href;
}

function previewMetadataPath(runtimePackageId: string): string {
  return `/admin/assets/runtime-package-previews/${encodeURIComponent(runtimePackageId)}`;
}

function previewMemberPath(
  preview: RuntimePackagePreview,
  member: RuntimePackagePreviewVisualAsset,
): string {
  return `${previewMetadataPath(preview.runtimePackageId)}/assets/` +
    `${encodeURIComponent(member.assetVersionId)}/${encodeURIComponent(member.fileName)}`;
}

function requireExactHeader(response: Response, name: string, expected: string): void {
  if (response.headers.get(name) !== expected) {
    throw transportError(
      "HEADER_MISMATCH",
      `Runtime package preview response failed ${name} verification.`,
      response.status,
    );
  }
}

function verifyResponseSource(response: Response, expectedUrl: string): void {
  if (response.redirected || response.url !== expectedUrl) {
    throw transportError(
      "RESPONSE_URL_MISMATCH",
      "Runtime package preview response did not come from the requested private API route.",
      response.status,
    );
  }
}

function requireSuccessfulResponse(response: Response): void {
  if (response.status !== 200) {
    throw transportError(
      "HTTP_UNAVAILABLE",
      "Runtime package preview is unavailable.",
      response.status,
    );
  }
}

function requestOptions(token: string, accept: string, signal: AbortSignal): RequestInit {
  return {
    method: "GET",
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    signal,
  };
}

async function requireAuthToken(
  signal: AbortSignal,
  dependencies: RuntimePackagePreviewTransportDependencies,
): Promise<string> {
  throwIfAborted(signal);
  let token: string | null;
  try {
    token = await awaitWithAbort(dependencies.getAuthToken(), signal);
  } catch (error: unknown) {
    if (signal.aborted || isAbortError(error)) throwIfAborted(signal);
    throw transportError("AUTH_UNAVAILABLE", "An authenticated session is required.");
  }
  throwIfAborted(signal);
  if (token === null || token.trim().length === 0) {
    throw transportError("AUTH_UNAVAILABLE", "An authenticated session is required.");
  }
  return token;
}

async function requestPrivateResponse(
  url: string,
  token: string,
  accept: string,
  signal: AbortSignal,
  dependencies: RuntimePackagePreviewTransportDependencies,
): Promise<Response> {
  throwIfAborted(signal);
  let response: Response;
  try {
    response = await awaitWithAbort(
      dependencies.fetch(url, requestOptions(token, accept, signal)),
      signal,
    );
  } catch (error: unknown) {
    if (signal.aborted || isAbortError(error)) {
      throw transportError("ABORTED", "Runtime package preview request was cancelled.");
    }
    throw transportError("NETWORK_ERROR", "Runtime package preview could not be requested.");
  }
  throwIfAborted(signal);
  verifyResponseSource(response, url);
  requireSuccessfulResponse(response);
  return response;
}

function requireDeclaredLength(response: Response, maximum: number): number {
  const value = response.headers.get("content-length");
  if (value === null || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw transportError("HEADER_MISMATCH", "Runtime package preview has an invalid content-length.", response.status);
  }
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size <= 0 || size > maximum) {
    throw transportError("SIZE_MISMATCH", "Runtime package preview exceeds its bounded byte contract.", response.status);
  }
  return size;
}

async function readResponseBytes(
  response: Response,
  expectedSize: number,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  let bytes: ArrayBuffer;
  try {
    bytes = await awaitWithAbort(response.arrayBuffer(), signal);
  } catch (error: unknown) {
    if (signal.aborted || isAbortError(error)) {
      throw transportError("ABORTED", "Runtime package preview request was cancelled.");
    }
    throw transportError("NETWORK_ERROR", "Runtime package preview bytes could not be read.", response.status);
  }
  throwIfAborted(signal);
  if (bytes.byteLength !== expectedSize) {
    throw transportError("SIZE_MISMATCH", "Runtime package preview byte length did not match its declaration.", response.status);
  }
  return bytes;
}

function parseMetadata(bytes: ArrayBuffer, requestedId: string): RuntimePackagePreview {
  let json: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    json = JSON.parse(text) as unknown;
  } catch {
    throw transportError("RESPONSE_SCHEMA_INVALID", "Runtime package preview metadata was not valid JSON.");
  }
  const result = RuntimePackagePreviewEnvelopeSchema.safeParse(json);
  if (!result.success) {
    throw transportError("RESPONSE_SCHEMA_INVALID", "Runtime package preview metadata failed its exact schema.");
  }
  if (result.data.data.runtimePackageId !== requestedId) {
    throw transportError("PACKAGE_MISMATCH", "Runtime package preview metadata identified a different package.");
  }
  if (result.data.data.visualAssets.some((member) => member.sizeBytes > MAX_MEMBER_BYTES)) {
    throw transportError("RESPONSE_SCHEMA_INVALID", "Runtime package preview declares an oversized member.");
  }
  return result.data.data;
}

function verifyMetadataHeaders(response: Response): number {
  requireExactHeader(response, "content-type", "application/json; charset=utf-8");
  requireExactHeader(response, "cache-control", PRIVATE_NO_STORE);
  requireExactHeader(response, "pragma", "no-cache");
  requireExactHeader(response, "vary", PRIVATE_VARY);
  return requireDeclaredLength(response, MAX_METADATA_BYTES);
}

async function fetchMetadataWithToken(
  runtimePackageId: string,
  token: string,
  signal: AbortSignal,
  dependencies: RuntimePackagePreviewTransportDependencies,
): Promise<RuntimePackagePreview> {
  const url = configuredApiUrl(previewMetadataPath(runtimePackageId));
  const response = await requestPrivateResponse(url, token, "application/json", signal, dependencies);
  const declaredLength = verifyMetadataHeaders(response);
  const bytes = await readResponseBytes(response, declaredLength, signal);
  return parseMetadata(bytes, runtimePackageId);
}

function requireValidPreview(value: RuntimePackagePreview): RuntimePackagePreview {
  const parsed = RuntimePackagePreviewSchema.safeParse(value);
  if (!parsed.success || parsed.data.visualAssets.some((member) => member.sizeBytes > MAX_MEMBER_BYTES)) {
    throw transportError("MEMBER_MISMATCH", "Runtime package preview member is not bound to valid metadata.");
  }
  return parsed.data;
}

function requireMember(
  preview: RuntimePackagePreview,
  memberIndex: number,
): RuntimePackagePreviewVisualAsset {
  if (!Number.isSafeInteger(memberIndex) || memberIndex < 0) {
    throw transportError("MEMBER_MISMATCH", "Runtime package preview member index is invalid.");
  }
  const member = preview.visualAssets[memberIndex];
  if (member === undefined) {
    throw transportError("MEMBER_MISMATCH", "Runtime package preview member is not declared by the package.");
  }
  return member;
}

function verifyMemberHeaders(response: Response, member: RuntimePackagePreviewVisualAsset): void {
  requireExactHeader(response, "content-type", "application/octet-stream");
  requireExactHeader(response, "content-length", String(member.sizeBytes));
  requireExactHeader(
    response,
    "content-disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(member.fileName)}`,
  );
  requireExactHeader(response, "cache-control", PRIVATE_NO_STORE);
  requireExactHeader(response, "pragma", "no-cache");
  requireExactHeader(response, "vary", PRIVATE_VARY);
  requireExactHeader(response, "x-content-sha256", member.sha256);
  requireExactHeader(response, "x-content-type-options", "nosniff");
  requireExactHeader(response, "cross-origin-resource-policy", "same-site");
}

async function verifyDigest(
  bytes: ArrayBuffer,
  expected: string,
  signal: AbortSignal,
  dependencies: RuntimePackagePreviewTransportDependencies,
): Promise<void> {
  let digest: string;
  try {
    digest = await awaitWithAbort(dependencies.digest(bytes), signal);
  } catch (error: unknown) {
    if (signal.aborted || isAbortError(error)) {
      throw transportError("ABORTED", "Runtime package preview request was cancelled.");
    }
    throw transportError("DIGEST_UNAVAILABLE", "Runtime package preview SHA-256 could not be computed.");
  }
  throwIfAborted(signal);
  if (digest !== expected) {
    throw transportError("DIGEST_MISMATCH", "Runtime package preview bytes failed SHA-256 verification.");
  }
}

async function fetchMemberWithToken(
  preview: RuntimePackagePreview,
  member: RuntimePackagePreviewVisualAsset,
  token: string,
  signal: AbortSignal,
  dependencies: RuntimePackagePreviewTransportDependencies,
): Promise<VerifiedRuntimePackagePreviewMember> {
  const url = configuredApiUrl(previewMemberPath(preview, member));
  const response = await requestPrivateResponse(url, token, "application/octet-stream", signal, dependencies);
  verifyMemberHeaders(response, member);
  const bytes = await readResponseBytes(response, member.sizeBytes, signal);
  await verifyDigest(bytes, member.sha256, signal, dependencies);
  return { ...member, bytes };
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function fetchRuntimePackagePreviewMetadata(
  runtimePackageId: string,
  signal: AbortSignal,
  dependencies: RuntimePackagePreviewTransportDependencies = defaultDependencies,
): Promise<RuntimePackagePreview> {
  const parsedId = RuntimePackageIdSchema.safeParse(runtimePackageId);
  if (!parsedId.success) {
    throw transportError("INPUT_INVALID", "A valid immutable runtime package identifier is required.");
  }
  const token = await requireAuthToken(signal, dependencies);
  return fetchMetadataWithToken(parsedId.data, token, signal, dependencies);
}

export async function fetchVerifiedRuntimePackagePreviewMember(
  preview: RuntimePackagePreview,
  memberIndex: number,
  signal: AbortSignal,
  dependencies: RuntimePackagePreviewTransportDependencies = defaultDependencies,
): Promise<VerifiedRuntimePackagePreviewMember> {
  const parsedPreview = requireValidPreview(preview);
  const member = requireMember(parsedPreview, memberIndex);
  const token = await requireAuthToken(signal, dependencies);
  return fetchMemberWithToken(parsedPreview, member, token, signal, dependencies);
}

/**
 * Resolve one immutable private package and verify every member sequentially.
 * Sequential transfer deliberately stays below the API's four-transfer ceiling.
 */
export async function fetchVerifiedRuntimePackagePreview(
  runtimePackageId: string,
  signal: AbortSignal,
  dependencies: RuntimePackagePreviewTransportDependencies = defaultDependencies,
): Promise<VerifiedRuntimePackagePreview> {
  const parsedId = RuntimePackageIdSchema.safeParse(runtimePackageId);
  if (!parsedId.success) {
    throw transportError("INPUT_INVALID", "A valid immutable runtime package identifier is required.");
  }
  const token = await requireAuthToken(signal, dependencies);
  const preview = await fetchMetadataWithToken(parsedId.data, token, signal, dependencies);
  const members: VerifiedRuntimePackagePreviewMember[] = [];
  for (const member of preview.visualAssets) {
    throwIfAborted(signal);
    members.push(await fetchMemberWithToken(preview, member, token, signal, dependencies));
  }
  return { preview, members };
}
