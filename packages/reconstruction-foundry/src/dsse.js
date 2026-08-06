import { verify } from "node:crypto";
import { ReconstructionDsseEnvelopeSchema, } from "@omnitwin/types/reconstruction-dsse";
import { FoundryIntegrityError } from "./errors.js";
import { sha256Bytes } from "./hash.js";
export const DsseEnvelopeSchema = ReconstructionDsseEnvelopeSchema;
export function dssePreAuthenticationEncoding(payloadType, payload) {
    const typeBytes = Buffer.from(payloadType, "utf8");
    return Buffer.concat([
        Buffer.from(`DSSEv1 ${String(typeBytes.length)} `, "ascii"),
        typeBytes,
        Buffer.from(` ${String(payload.byteLength)} `, "ascii"),
        payload,
    ]);
}
function ed25519PublicKey(value) {
    if (value.type !== "public") {
        throw new FoundryIntegrityError("DSSE_PRIVATE_KEY_REJECTED", "DSSE verification accepts public keys only.");
    }
    if (value.asymmetricKeyType !== "ed25519") {
        throw new FoundryIntegrityError("DSSE_KEY_TYPE_INVALID", "DSSE verification requires an Ed25519 public key.");
    }
    return value;
}
export function verifyDsseEnvelope(envelopeInput, trustedKeys, expected) {
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
    const verifiedKeyIds = new Set();
    for (const signature of envelope.signatures) {
        const key = trustedKeys.get(signature.keyid);
        if (key === undefined)
            continue;
        const signatureBytes = Buffer.from(signature.sig, "base64");
        if (verify(null, pae, ed25519PublicKey(key), signatureBytes))
            verifiedKeyIds.add(signature.keyid);
    }
    if (verifiedKeyIds.size === 0) {
        throw new FoundryIntegrityError("DSSE_SIGNATURE_INVALID", "DSSE envelope has no valid signature from a trusted key.");
    }
    return { payload, payloadSha256, verifiedKeyIds: [...verifiedKeyIds].sort() };
}
//# sourceMappingURL=dsse.js.map