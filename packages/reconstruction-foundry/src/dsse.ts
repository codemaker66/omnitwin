import { verify, type KeyObject } from "node:crypto";
import {
  ReconstructionDsseEnvelopeSchema,
  type ReconstructionDsseEnvelope,
} from "@omnitwin/types";
import { FoundryIntegrityError } from "./errors.js";
import { sha256Bytes } from "./hash.js";

export const DsseEnvelopeSchema = ReconstructionDsseEnvelopeSchema;
export type DsseEnvelope = ReconstructionDsseEnvelope;

export interface DsseVerificationResult {
  readonly payload: Uint8Array;
  readonly payloadSha256: string;
  readonly verifiedKeyIds: readonly string[];
}

export type TrustedDsseKeys = ReadonlyMap<string, KeyObject>;

export function dssePreAuthenticationEncoding(payloadType: string, payload: Uint8Array): Buffer {
  const typeBytes = Buffer.from(payloadType, "utf8");
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${String(typeBytes.length)} `, "ascii"),
    typeBytes,
    Buffer.from(` ${String(payload.byteLength)} `, "ascii"),
    payload,
  ]);
}

function ed25519PublicKey(value: KeyObject): KeyObject {
  if (value.type !== "public") {
    throw new FoundryIntegrityError(
      "DSSE_PRIVATE_KEY_REJECTED",
      "DSSE verification accepts public keys only.",
    );
  }
  if (value.asymmetricKeyType !== "ed25519") {
    throw new FoundryIntegrityError(
      "DSSE_KEY_TYPE_INVALID",
      "DSSE verification requires an Ed25519 public key.",
    );
  }
  return value;
}

export function verifyDsseEnvelope(
  envelopeInput: unknown,
  trustedKeys: TrustedDsseKeys,
  expected: { readonly payloadType: string; readonly payloadSha256: string },
): DsseVerificationResult {
  const envelope = DsseEnvelopeSchema.parse(envelopeInput);
  if (envelope.payloadType !== expected.payloadType || !/^[a-f0-9]{64}$/u.test(expected.payloadSha256)) {
    throw new FoundryIntegrityError("DSSE_SUBJECT_MISMATCH", "DSSE envelope does not target the expected Foundry subject.");
  }
  const payload = Buffer.from(envelope.payload, "base64");
  const payloadSha256 = sha256Bytes(payload);
  if (payloadSha256 !== expected.payloadSha256) {
    throw new FoundryIntegrityError("DSSE_PAYLOAD_DIGEST_MISMATCH", "DSSE payload SHA-256 does not match the expected subject.");
  }
  const pae = dssePreAuthenticationEncoding(envelope.payloadType, payload);
  const verifiedKeyIds = new Set<string>();
  for (const signature of envelope.signatures) {
    const key = trustedKeys.get(signature.keyid);
    if (key === undefined) continue;
    const signatureBytes = Buffer.from(signature.sig, "base64");
    if (verify(null, pae, ed25519PublicKey(key), signatureBytes)) verifiedKeyIds.add(signature.keyid);
  }
  if (verifiedKeyIds.size === 0) {
    throw new FoundryIntegrityError("DSSE_SIGNATURE_INVALID", "DSSE envelope has no valid signature from a trusted key.");
  }
  return { payload, payloadSha256, verifiedKeyIds: [...verifiedKeyIds].sort() };
}
