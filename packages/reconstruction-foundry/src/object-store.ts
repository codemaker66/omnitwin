import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { FoundryIntegrityError } from "./errors.js";
import { FOUNDRY_MAX_FILE_BYTES } from "./inventory.js";
import { assertSafeBundlePath } from "./path-safety.js";

export interface ImmutablePutInput {
  readonly key: string;
  readonly contentType: string;
  readonly contentLength: number;
  readonly body: Readable;
}
export type CandidatePutInput = ImmutablePutInput;

export interface ImmutableGetResult {
  readonly contentLength: number | null;
  readonly body: AsyncIterable<Uint8Array>;
}
export type CandidateGetResult = ImmutableGetResult;

/**
 * Deliberately minimal object-store authority. Foundry core can create an
 * immutable private candidate and read it back; it cannot copy, delete, list,
 * publish, or change bucket policy.
 */
export interface ImmutableObjectStore {
  putIfAbsent(input: ImmutablePutInput): Promise<"created" | "exists">;
  get(key: string): Promise<ImmutableGetResult>;
}
export type CandidateObjectStore = ImmutableObjectStore;

export interface VerifiedCandidateObject {
  readonly key: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export function assertSafeCandidateKey(key: string): void {
  assertSafeBundlePath(key);
  if (!key.startsWith("candidates/")) {
    throw new FoundryIntegrityError("UNSAFE_CANDIDATE_KEY", "Foundry object keys must stay under candidates/.");
  }
}

export function publicReleasePrefixForDigest(releaseDigest: string): string {
  if (!/^[a-f0-9]{64}$/u.test(releaseDigest)) {
    throw new FoundryIntegrityError("INVALID_RELEASE_DIGEST", "A public release prefix requires a lowercase SHA-256 digest.");
  }
  return `releases/sha256/${releaseDigest.slice(0, 2)}/${releaseDigest}`;
}

export function assertSafePublicReleaseKey(key: string): void {
  assertSafeBundlePath(key);
  const match = /^releases\/sha256\/([a-f0-9]{2})\/([a-f0-9]{64})\/(.+)$/u.exec(key);
  if (match === null || match[1] !== match[2]?.slice(0, 2)) {
    throw new FoundryIntegrityError(
      "UNSAFE_PUBLIC_RELEASE_KEY",
      "Public Foundry object keys must stay under their digest-addressed releases/sha256 prefix.",
    );
  }
}

export type ImmutableObjectKeyScope = "candidate" | "public-release";

export function assertSafeImmutableObjectKey(key: string, scope: ImmutableObjectKeyScope): void {
  if (scope === "candidate") {
    assertSafeCandidateKey(key);
  } else {
    assertSafePublicReleaseKey(key);
  }
}

export async function verifyImmutableObject(
  store: ImmutableObjectStore,
  expected: { readonly key: string; readonly sha256: string; readonly sizeBytes: number },
  scope: ImmutableObjectKeyScope,
): Promise<VerifiedCandidateObject> {
  assertSafeImmutableObjectKey(expected.key, scope);
  if (!/^[a-f0-9]{64}$/u.test(expected.sha256) || !Number.isSafeInteger(expected.sizeBytes) || expected.sizeBytes <= 0) {
    throw new FoundryIntegrityError("INVALID_EXPECTED_OBJECT", `Invalid expected immutable object metadata for ${expected.key}.`);
  }
  const result = await store.get(expected.key);
  if (result.contentLength !== null && result.contentLength !== expected.sizeBytes) {
    throw new FoundryIntegrityError("IMMUTABLE_SIZE_MISMATCH", `Immutable object byte length mismatch for ${expected.key}.`);
  }
  const digest = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of result.body) {
    sizeBytes += chunk.byteLength;
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes > FOUNDRY_MAX_FILE_BYTES || sizeBytes > expected.sizeBytes) {
      throw new FoundryIntegrityError("IMMUTABLE_SIZE_MISMATCH", `Immutable object exceeded its declared size: ${expected.key}.`);
    }
    digest.update(chunk);
  }
  const sha256 = digest.digest("hex");
  if (sizeBytes !== expected.sizeBytes || sha256 !== expected.sha256) {
    throw new FoundryIntegrityError("IMMUTABLE_DIGEST_MISMATCH", `Immutable object readback verification failed for ${expected.key}.`);
  }
  return { key: expected.key, sha256, sizeBytes };
}

export async function verifyCandidateObject(
  store: CandidateObjectStore,
  expected: { readonly key: string; readonly sha256: string; readonly sizeBytes: number },
): Promise<VerifiedCandidateObject> {
  try {
    return await verifyImmutableObject(store, expected, "candidate");
  } catch (error: unknown) {
    if (error instanceof FoundryIntegrityError && error.code === "IMMUTABLE_SIZE_MISMATCH") {
      throw new FoundryIntegrityError("CANDIDATE_SIZE_MISMATCH", error.message, { cause: error });
    }
    if (error instanceof FoundryIntegrityError && error.code === "IMMUTABLE_DIGEST_MISMATCH") {
      throw new FoundryIntegrityError("CANDIDATE_DIGEST_MISMATCH", error.message, { cause: error });
    }
    throw error;
  }
}
