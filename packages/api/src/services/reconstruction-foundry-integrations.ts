import { createHash, createPublicKey, type KeyObject } from "node:crypto";
import { Readable } from "node:stream";
import {
  S3CandidateObjectStore,
  S3ImmutableObjectStore,
  transferImmutableCandidateObject,
  verifyCandidateObject,
  verifyDsseEnvelope,
  verifyRemoteCandidateRelease,
} from "@omnitwin/reconstruction-foundry";
import {
  CanonicalJsonValueSchema,
  ReconstructionDsseEnvelopeSchema,
  sha256Hex,
  stableCanonicalJson,
} from "@omnitwin/types";
import { z } from "zod";
import type { Database } from "../db/client.js";
import type { Env } from "../env.js";
import {
  ReconstructionFoundryService,
  type ReconstructionAttestationVerifier,
  type ReconstructionCandidateVerifier,
  type ReconstructionPrivateEvidenceStore,
  type ReconstructionReleasePublisher,
  type VerifiedReconstructionPublication,
} from "./reconstruction-foundry.js";

const PUBLICATION_CONCURRENCY = 6;
const MAX_PRIVATE_ATTESTATION_BYTES = 4 * 1024 * 1024;

interface FoundryStorageConfig {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly candidateBucket: string;
  readonly releaseBucket: string;
  readonly publicUrl: string;
}

function storageConfig(env: Env): FoundryStorageConfig | null {
  if (
    env.FOUNDRY_R2_ACCOUNT_ID === undefined ||
    env.FOUNDRY_R2_ACCESS_KEY_ID === undefined ||
    env.FOUNDRY_R2_SECRET_ACCESS_KEY === undefined ||
    env.FOUNDRY_R2_CANDIDATE_BUCKET === undefined ||
    env.FOUNDRY_R2_RELEASE_BUCKET === undefined ||
    env.FOUNDRY_R2_PUBLIC_URL === undefined
  ) {
    return null;
  }
  return {
    accountId: env.FOUNDRY_R2_ACCOUNT_ID,
    accessKeyId: env.FOUNDRY_R2_ACCESS_KEY_ID,
    secretAccessKey: env.FOUNDRY_R2_SECRET_ACCESS_KEY,
    candidateBucket: env.FOUNDRY_R2_CANDIDATE_BUCKET,
    releaseBucket: env.FOUNDRY_R2_RELEASE_BUCKET,
    publicUrl: env.FOUNDRY_R2_PUBLIC_URL.replace(/\/+$/u, ""),
  };
}

function objectStores(config: FoundryStorageConfig): {
  readonly candidate: S3CandidateObjectStore;
  readonly release: S3ImmutableObjectStore;
} {
  const common = {
    accountId: config.accountId,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  };
  return {
    candidate: new S3CandidateObjectStore({ ...common, bucketName: config.candidateBucket }),
    release: new S3ImmutableObjectStore({
      ...common,
      bucketName: config.releaseBucket,
      keyScope: "public-release",
    }),
  };
}

function candidateVerifier(
  config: FoundryStorageConfig,
  candidate: S3CandidateObjectStore,
): ReconstructionCandidateVerifier {
  return {
    async verifyCandidate(input) {
      const verified = await verifyRemoteCandidateRelease({
        candidatePrefix: input.candidateR2Prefix,
        store: candidate,
      });
      return {
        candidateBucket: config.candidateBucket,
        candidateR2Prefix: verified.candidatePrefix,
        candidateManifestR2Key: verified.candidateManifestKey,
        qaReportR2Key: verified.candidateQaReportKey,
        releaseManifestSha256: verified.releaseManifestObject.sha256,
        manifest: verified.manifest,
        qaReport: verified.qaReport,
      };
    },
  };
}

async function readPrivateBytes(input: {
  readonly candidate: S3CandidateObjectStore;
  readonly key: string;
  readonly sha256: string;
  readonly maxBytes: number;
  readonly expectedSizeBytes?: number;
}): Promise<Buffer> {
  const result = await input.candidate.get(input.key);
  if (
    result.contentLength !== null &&
    (result.contentLength <= 0 ||
      result.contentLength > input.maxBytes ||
      (input.expectedSizeBytes !== undefined && result.contentLength !== input.expectedSizeBytes))
  ) {
    throw new Error(`Private Foundry object size is invalid: ${input.key}.`);
  }
  const digest = createHash("sha256");
  const chunks: Buffer[] = [];
  let sizeBytes = 0;
  for await (const chunk of result.body) {
    const bytes = Buffer.from(chunk);
    sizeBytes += bytes.byteLength;
    if (
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes > input.maxBytes ||
      (input.expectedSizeBytes !== undefined && sizeBytes > input.expectedSizeBytes)
    ) {
      throw new Error(`Private Foundry object exceeded its verified bound: ${input.key}.`);
    }
    digest.update(bytes);
    chunks.push(bytes);
  }
  if (
    sizeBytes <= 0 ||
    (input.expectedSizeBytes !== undefined && sizeBytes !== input.expectedSizeBytes) ||
    digest.digest("hex") !== input.sha256
  ) {
    throw new Error(`Private Foundry object failed exact-byte verification: ${input.key}.`);
  }
  return Buffer.concat(chunks, sizeBytes);
}

function privateEvidenceStore(
  candidate: S3CandidateObjectStore,
): ReconstructionPrivateEvidenceStore {
  return {
    async putIfAbsentAndVerify(input) {
      const bytes = Buffer.from(input.bytes);
      if (
        bytes.byteLength !== input.sizeBytes ||
        bytes.byteLength > input.maxBytes ||
        createHash("sha256").update(bytes).digest("hex") !== input.sha256
      ) {
        throw new Error("Private evidence write does not match its declared bytes.");
      }
      const disposition = await candidate.putIfAbsent({
        key: input.key,
        contentType: input.contentType,
        contentLength: input.sizeBytes,
        body: Readable.from([bytes]),
      });
      await readPrivateBytes({
        candidate,
        key: input.key,
        sha256: input.sha256,
        maxBytes: input.maxBytes,
        expectedSizeBytes: input.sizeBytes,
      });
      return disposition;
    },
    readVerified(input) {
      return readPrivateBytes({
        candidate,
        key: input.key,
        sha256: input.sha256,
        maxBytes: input.maxBytes,
        expectedSizeBytes: input.sizeBytes,
      });
    },
  };
}

interface TrustedKeySet {
  readonly keys: ReadonlyMap<string, KeyObject>;
  readonly fingerprints: ReadonlyMap<string, string>;
}

function trustedKeys(raw: string | undefined): TrustedKeySet | null {
  if (raw === undefined) return null;
  const encodedKeys = z.record(z.string().min(1), z.string().min(1)).parse(JSON.parse(raw));
  const keys = new Map<string, KeyObject>();
  const fingerprints = new Map<string, string>();
  for (const [keyId, encoded] of Object.entries(encodedKeys)) {
    const der = Buffer.from(encoded, "base64");
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    const canonicalDer = Buffer.from(key.export({ format: "der", type: "spki" }));
    if (key.asymmetricKeyType !== "ed25519" || !canonicalDer.equals(der)) {
      throw new Error(`Foundry key ${keyId} is not canonical Ed25519 SPKI DER.`);
    }
    keys.set(keyId, key);
    fingerprints.set(keyId, createHash("sha256").update(canonicalDer).digest("hex"));
  }
  return { keys, fingerprints };
}

function attestationVerifier(
  candidate: S3CandidateObjectStore,
  trusted: TrustedKeySet,
): ReconstructionAttestationVerifier {
  return {
    async verifyAndStoreAttestation(input) {
      const verified = verifyDsseEnvelope(input.envelope, trusted.keys, {
        payloadType: input.signingPayload.payloadType,
        payloadSha256: input.signingPayload.payloadSha256,
      });
      if (!Buffer.from(verified.payload).equals(Buffer.from(input.signingPayload.payloadUtf8, "utf8"))) {
        throw new Error("Verified DSSE payload bytes do not equal the server-issued signing payload.");
      }
      const keyId = verified.verifiedKeyIds[0];
      if (keyId === undefined) throw new Error("No configured Ed25519 key verified the DSSE envelope.");
      const publicKeyFingerprint = trusted.fingerprints.get(keyId);
      if (publicKeyFingerprint === undefined) throw new Error("Verified Ed25519 key fingerprint is unavailable.");

      const bytes = Buffer.from(input.canonicalEnvelopeBytes);
      // putIfAbsent's contract is "created" | "exists" — both are acceptable
      // for an immutable attestation write; verification below is the guard.
      await candidate.putIfAbsent({
        key: input.expectedPrivateR2Key,
        contentType: "application/vnd.dsse.envelope.v1+json",
        contentLength: bytes.byteLength,
        body: Readable.from([bytes]),
      });
      await verifyCandidateObject(candidate, {
        key: input.expectedPrivateR2Key,
        sha256: input.expectedEnvelopeSha256,
        sizeBytes: bytes.byteLength,
      });
      return {
        releaseId: input.signingPayload.releaseId,
        releaseDigest: input.signingPayload.releaseDigest,
        qaReportDigest: input.signingPayload.qaReportDigest,
        reviewId: input.signingPayload.reviewId,
        reviewDigest: input.signingPayload.reviewDigest,
        payloadSha256: verified.payloadSha256,
        envelopeSha256: input.expectedEnvelopeSha256,
        keyId,
        publicKeyFingerprint,
        r2Key: input.expectedPrivateR2Key,
        verifiedAt: new Date().toISOString(),
      };
    },
    async reverifyStoredAttestation(input) {
      const currentKey = trusted.keys.get(input.metadata.keyId);
      const currentFingerprint = trusted.fingerprints.get(input.metadata.keyId);
      if (
        currentKey === undefined ||
        currentFingerprint === undefined ||
        currentFingerprint !== input.metadata.publicKeyFingerprint
      ) {
        throw new Error("The attestation key is no longer in the current trusted-key set.");
      }
      const bytes = await readPrivateBytes({
        candidate,
        key: input.metadata.r2Key,
        sha256: input.metadata.envelopeSha256,
        maxBytes: MAX_PRIVATE_ATTESTATION_BYTES,
      });
      let raw: unknown;
      try {
        raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
      } catch (error: unknown) {
        throw new Error("Stored attestation is not valid UTF-8 JSON.", { cause: error });
      }
      const envelope = ReconstructionDsseEnvelopeSchema.parse(raw);
      const verified = verifyDsseEnvelope(envelope, trusted.keys, {
        payloadType: input.signingPayload.payloadType,
        payloadSha256: input.signingPayload.payloadSha256,
      });
      if (
        !verified.verifiedKeyIds.includes(input.metadata.keyId) ||
        !Buffer.from(verified.payload).equals(Buffer.from(input.signingPayload.payloadUtf8, "utf8"))
      ) {
        throw new Error("Stored attestation no longer verifies against current trust and exact payload bytes.");
      }
    },
  };
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<readonly R[]> {
  const results: R[] = new Array<R>(values.length);
  let cursor = 0;
  const run = async (): Promise<void> => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      const value = values[index];
      if (value !== undefined) results[index] = await worker(value);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => run(),
  ));
  return results;
}

function publisher(
  config: FoundryStorageConfig,
  candidate: S3CandidateObjectStore,
  release: S3ImmutableObjectStore,
): ReconstructionReleasePublisher {
  return {
    async publishRelease(input): Promise<VerifiedReconstructionPublication> {
      const publishedAt = new Date().toISOString();
      const transfers = await mapWithConcurrency(
        input.registration.manifest.files,
        PUBLICATION_CONCURRENCY,
        async (file) => {
          const sourceKey = `${input.registration.candidateR2Prefix}/${file.path}`;
          const destinationKey = `${input.publicR2Prefix}/${file.path}`;
          const receipt = await transferImmutableCandidateObject({
            sourceStore: candidate,
            destinationStore: release,
            sourceKey,
            destinationKey,
            contentType: file.mimeType,
            sha256: file.sha256,
            sizeBytes: file.sizeBytes,
          });
          return {
            path: file.path,
            sha256: file.sha256,
            sizeBytes: file.sizeBytes,
            disposition: receipt.disposition,
          };
        },
      );
      const verifiedAt = new Date().toISOString();
      const verificationMaterial = CanonicalJsonValueSchema.parse({
        releaseDigest: input.registration.manifest.releaseDigest,
        publicR2Prefix: input.publicR2Prefix,
        transfers,
      });
      const publicBaseUrl = `${config.publicUrl}/${input.publicR2Prefix}`;
      return {
        releaseId: input.registration.id,
        releaseDigest: input.registration.manifest.releaseDigest,
        qaReportDigest: input.registration.qaReport.reportDigest,
        reviewId: input.review.id,
        reviewDigest: input.review.reviewDigest,
        attestationId: input.attestation.id,
        attestationEnvelopeSha256: input.attestation.envelopeSha256,
        candidateR2Prefix: input.registration.candidateR2Prefix,
        releaseBucket: config.releaseBucket,
        publicR2Prefix: input.publicR2Prefix,
        publicManifestR2Key: input.publicManifestR2Key,
        publicBaseUrl,
        publicManifestUrl: `${publicBaseUrl}/manifest.json`,
        manifestSha256: input.registration.manifest.sourceManifestSha256,
        verificationDigest: sha256Hex(stableCanonicalJson(verificationMaterial)),
        fileCount: input.registration.manifest.fileCount,
        totalBytes: input.registration.manifest.totalBytes,
        publishedAt,
        verifiedAt,
      };
    },
  };
}

export function createReconstructionFoundryService(
  db: Database,
  env: Env,
): ReconstructionFoundryService {
  const storage = storageConfig(env);
  const trusted = trustedKeys(env.FOUNDRY_ED25519_PUBLIC_KEYS_JSON);
  const stores = storage === null ? null : objectStores(storage);
  return new ReconstructionFoundryService({
    db,
    ...(storage === null || stores === null ? {} : {
      candidateVerifier: candidateVerifier(storage, stores.candidate),
      privateEvidenceStore: privateEvidenceStore(stores.candidate),
      publisher: publisher(storage, stores.candidate, stores.release),
      ...(trusted === null ? {} : { attestationVerifier: attestationVerifier(stores.candidate, trusted) }),
    }),
  });
}
