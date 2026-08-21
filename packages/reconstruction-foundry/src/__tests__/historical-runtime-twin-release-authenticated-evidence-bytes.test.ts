import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import {
  RECONSTRUCTION_DSSE_PAYLOAD_TYPE,
  ReconstructionDsseEnvelopeSchema,
  ReconstructionReleaseSigningStatementSchema,
  type ReconstructionDsseEnvelope,
  type ReconstructionReleaseSigningStatement,
} from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import { canonicalizeFoundryActivationV1Json } from "../activation-v1-authenticated-evidence-bytes.js";
import { dssePreAuthenticationEncoding } from "../dsse.js";
import { FoundryIntegrityError } from "../errors.js";
import {
  canonicalHistoricalRuntimeTwinReleaseEnvelopeBytes,
  HISTORICAL_RUNTIME_TWIN_RELEASE_EVIDENCE_ERROR_CODES,
  verifyHistoricalRuntimeTwinReleaseEnvelopeBytes,
} from "../historical-runtime-twin-release-authenticated-evidence-bytes.js";

const RELEASE_ID = "10000000-0000-4000-8000-000000000120";
const REVIEW_ID = "10000000-0000-4000-8000-000000000121";
const REVIEWER_ID = "10000000-0000-4000-8000-000000000122";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const SHA_E = "e".repeat(64);
const SHA_F = "f".repeat(64);
const KEY_ID = "venviewer-twin-release-2026-q3";

function statement(): ReconstructionReleaseSigningStatement {
  return ReconstructionReleaseSigningStatementSchema.parse({
    _type: "https://in-toto.io/Statement/v1",
    subject: [{
      name: `reconstruction-release/trades-hall/${SHA_A}`,
      digest: { sha256: SHA_A },
    }],
    predicateType: "https://venviewer.com/attestations/reconstruction-release/v1",
    predicate: {
      schemaVersion: "venviewer.reconstruction-attestation-predicate.v1",
      venueSlug: "trades-hall",
      releaseKind: "venue_twin_v1",
      releaseId: RELEASE_ID,
      releaseDigest: SHA_A,
      sourceManifestSha256: SHA_B,
      releaseManifestSha256: SHA_C,
      qaReportDigest: SHA_D,
      reviewId: REVIEW_ID,
      reviewDigest: SHA_E,
      reviewedAt: "2026-08-20T09:01:00.000Z",
      reviewerUserId: REVIEWER_ID,
      decision: "approved",
      targetExposure: "public",
      visualEvidence: [{
        label: "Grand Hall overview",
        objectKey: "releases/trades-hall/grand-hall.png",
        sha256: SHA_F,
      }],
      transformArtifactRef: {
        artifactId: "grand-hall-transform",
        artifactDigest: SHA_B,
      },
      sceneAuthorityMapRef: {
        artifactId: "grand-hall-scene-map",
        artifactDigest: SHA_C,
      },
    },
  });
}

function publicKeyFingerprint(publicKey: KeyObject): string {
  const der = publicKey.export({ format: "der", type: "spki" });
  return createHash("sha256").update(der).digest("hex");
}

function signedEnvelope(
  payloadUtf8: string,
  privateKey: KeyObject,
  options: {
    readonly keyId?: string;
    readonly payloadType?: string;
    readonly additionalSignature?: boolean;
    readonly signatureMutation?: boolean;
  } = {},
): Uint8Array {
  const payloadType = options.payloadType ?? RECONSTRUCTION_DSSE_PAYLOAD_TYPE;
  const payload = Buffer.from(payloadUtf8, "utf8");
  const signature = sign(
    null,
    dssePreAuthenticationEncoding(payloadType, payload),
    privateKey,
  );
  if (options.signatureMutation === true) signature[0] = (signature[0] ?? 0) ^ 0xff;
  const envelope: ReconstructionDsseEnvelope = {
    payloadType,
    payload: payload.toString("base64"),
    signatures: [{
      keyid: options.keyId ?? KEY_ID,
      sig: signature.toString("base64"),
    }],
  };
  if (options.additionalSignature === true) {
    envelope.signatures.push({
      keyid: "second-key",
      sig: signature.toString("base64"),
    });
  }
  return canonicalHistoricalRuntimeTwinReleaseEnvelopeBytes(envelope);
}

function fixture(): {
  readonly envelopeBytes: Uint8Array;
  readonly expectedStatement: ReconstructionReleaseSigningStatement;
  readonly publicKey: KeyObject;
  readonly privateKey: KeyObject;
  readonly fingerprint: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const expectedStatement = statement();
  return {
    envelopeBytes: signedEnvelope(JSON.stringify(expectedStatement), privateKey),
    expectedStatement,
    publicKey,
    privateKey,
    fingerprint: publicKeyFingerprint(publicKey),
  };
}

function verifyFixture(input: ReturnType<typeof fixture>, envelopeBytes = input.envelopeBytes) {
  return verifyHistoricalRuntimeTwinReleaseEnvelopeBytes(
    envelopeBytes,
    new Map([[KEY_ID, input.publicKey]]),
    {
      expectedKeyId: KEY_ID,
      expectedPublicKeyFingerprint: input.fingerprint,
      statement: input.expectedStatement,
    },
  );
}

function expectIntegrityCode(action: () => unknown, code: string): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(FoundryIntegrityError);
  expect((caught as FoundryIntegrityError).code).toBe(code);
}

describe("historical-runtime Twin raw authenticated evidence", () => {
  it("verifies exact existing-signer JSON.stringify payload bytes and Ed25519 DSSE PAE", () => {
    const input = fixture();
    const verified = verifyFixture(input);

    expect(verified.payloadType).toBe(RECONSTRUCTION_DSSE_PAYLOAD_TYPE);
    expect(verified.keyId).toBe(KEY_ID);
    expect(verified.publicKeyFingerprint).toBe(input.fingerprint);
    expect(verified.payloadUtf8).toBe(JSON.stringify(input.expectedStatement));
    expect(verified.payloadSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(verified.envelopeSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(verified.payloadByteLength).toBe(
      String(Buffer.byteLength(verified.payloadUtf8, "utf8")),
    );
    expect(verified.envelopeByteLength).toBe(String(input.envelopeBytes.byteLength));
  });

  it("returns envelope identity from the immutable parser snapshot after SAB input mutation", () => {
    const input = fixture();
    const sharedBacking = new SharedArrayBuffer(input.envelopeBytes.byteLength);
    const sharedBytes = new Uint8Array(sharedBacking);
    sharedBytes.set(input.envelopeBytes);
    const parserSnapshot = Buffer.from(input.envelopeBytes);
    const originalExport = input.publicKey.export.bind(input.publicKey);
    Object.defineProperty(input.publicKey, "export", {
      configurable: true,
      value: () => {
        sharedBytes[0] = 0x5b;
        return originalExport({ format: "der", type: "spki" });
      },
    });

    const verified = verifyFixture(input, sharedBytes);

    expect(sharedBytes[0]).toBe(0x5b);
    expect(verified.envelopeUtf8).toBe(parserSnapshot.toString("utf8"));
    expect(verified.envelopeSha256).toBe(
      createHash("sha256").update(parserSnapshot).digest("hex"),
    );
    expect(verified.envelopeByteLength).toBe(String(parserSnapshot.byteLength));
    expect(verified.envelopeSha256).not.toBe(
      createHash("sha256").update(sharedBytes).digest("hex"),
    );
  });

  it("rejects BOM, invalid UTF-8, trailing bytes, and duplicate JSON keys", () => {
    const input = fixture();
    expect(() => verifyFixture(
      input,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(input.envelopeBytes)]),
    )).toThrow();
    expect(() => verifyFixture(input, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d])))
      .toThrow();
    expect(() => verifyFixture(
      input,
      Buffer.concat([Buffer.from(input.envelopeBytes), Buffer.from(" ", "utf8")]),
    )).toThrow();
    const duplicateEnvelope = Buffer.from(
      `{"payload":"AA==","payload":"AA==","payloadType":"${RECONSTRUCTION_DSSE_PAYLOAD_TYPE}","signatures":[]}`,
      "utf8",
    );
    expect(() => verifyFixture(input, duplicateEnvelope)).toThrow();
  });

  it("rejects whitespace, reordered, duplicate-key, or mutated statement bytes", () => {
    const input = fixture();
    const whitespacePayload = JSON.stringify(input.expectedStatement, null, 2);
    expectIntegrityCode(() => verifyFixture(
      input,
      signedEnvelope(whitespacePayload, input.privateKey),
    ), HISTORICAL_RUNTIME_TWIN_RELEASE_EVIDENCE_ERROR_CODES.statementBytesInvalid);

    const reorderedPayload = JSON.stringify({
      predicateType: input.expectedStatement.predicateType,
      _type: input.expectedStatement._type,
      subject: input.expectedStatement.subject,
      predicate: input.expectedStatement.predicate,
    });
    expectIntegrityCode(() => verifyFixture(
      input,
      signedEnvelope(reorderedPayload, input.privateKey),
    ), HISTORICAL_RUNTIME_TWIN_RELEASE_EVIDENCE_ERROR_CODES.statementBytesInvalid);

    const canonicalPayload = JSON.stringify(input.expectedStatement);
    const duplicatePayload = canonicalPayload.replace(
      `"_type":"${input.expectedStatement._type}"`,
      `"_type":"${input.expectedStatement._type}","_type":"${input.expectedStatement._type}"`,
    );
    expect(() => verifyFixture(
      input,
      signedEnvelope(duplicatePayload, input.privateKey),
    )).toThrow();

    const mutatedPayload = canonicalPayload.replace(REVIEW_ID, "20000000-0000-4000-8000-000000000121");
    expectIntegrityCode(() => verifyFixture(
      input,
      signedEnvelope(mutatedPayload, input.privateKey),
    ), HISTORICAL_RUNTIME_TWIN_RELEASE_EVIDENCE_ERROR_CODES.statementIdentityMismatch);
  });

  it("rejects multisig, wrong payload type, wrong key, fingerprint, and signature", () => {
    const input = fixture();
    const payload = JSON.stringify(input.expectedStatement);
    expectIntegrityCode(() => verifyFixture(
      input,
      signedEnvelope(payload, input.privateKey, { additionalSignature: true }),
    ), HISTORICAL_RUNTIME_TWIN_RELEASE_EVIDENCE_ERROR_CODES.signatureShapeInvalid);
    expectIntegrityCode(() => verifyFixture(
      input,
      signedEnvelope(payload, input.privateKey, { payloadType: "application/json" }),
    ), HISTORICAL_RUNTIME_TWIN_RELEASE_EVIDENCE_ERROR_CODES.payloadTypeMismatch);
    expectIntegrityCode(() => verifyFixture(
      input,
      signedEnvelope(payload, input.privateKey, { keyId: "wrong-key" }),
    ), HISTORICAL_RUNTIME_TWIN_RELEASE_EVIDENCE_ERROR_CODES.keyIdInvalid);
    expectIntegrityCode(() => verifyHistoricalRuntimeTwinReleaseEnvelopeBytes(
      input.envelopeBytes,
      new Map([[KEY_ID, input.publicKey]]),
      {
        expectedKeyId: KEY_ID,
        expectedPublicKeyFingerprint: "0".repeat(64),
        statement: input.expectedStatement,
      },
    ), HISTORICAL_RUNTIME_TWIN_RELEASE_EVIDENCE_ERROR_CODES.keyFingerprintMismatch);
    expectIntegrityCode(() => verifyFixture(
      input,
      signedEnvelope(payload, input.privateKey, { signatureMutation: true }),
    ), HISTORICAL_RUNTIME_TWIN_RELEASE_EVIDENCE_ERROR_CODES.signatureInvalid);
  });

  it("rejects raw payload-type and key-ID whitespace aliases without relying on Zod trimming", () => {
    const input = fixture();
    const envelope = ReconstructionDsseEnvelopeSchema.parse(
      JSON.parse(Buffer.from(input.envelopeBytes).toString("utf8")),
    );
    const payloadTypeAlias = Buffer.from(canonicalizeFoundryActivationV1Json({
      ...envelope,
      payloadType: ` ${envelope.payloadType} `,
    }), "utf8");
    expectIntegrityCode(
      () => verifyFixture(input, payloadTypeAlias),
      HISTORICAL_RUNTIME_TWIN_RELEASE_EVIDENCE_ERROR_CODES.payloadTypeMismatch,
    );

    const signature = envelope.signatures[0];
    if (signature === undefined) throw new Error("Twin test fixture requires one signature.");
    const keyIdAlias = Buffer.from(canonicalizeFoundryActivationV1Json({
      ...envelope,
      signatures: [{ ...signature, keyid: ` ${signature.keyid} ` }],
    }), "utf8");
    expectIntegrityCode(
      () => verifyFixture(input, keyIdAlias),
      HISTORICAL_RUNTIME_TWIN_RELEASE_EVIDENCE_ERROR_CODES.keyIdInvalid,
    );
  });

  it("rejects release and latest-review substitutions even when the envelope is valid", () => {
    const input = fixture();
    const wrongRelease = ReconstructionReleaseSigningStatementSchema.parse({
      ...input.expectedStatement,
      predicate: {
        ...input.expectedStatement.predicate,
        releaseId: "20000000-0000-4000-8000-000000000120",
      },
    });
    expectIntegrityCode(() => verifyHistoricalRuntimeTwinReleaseEnvelopeBytes(
      input.envelopeBytes,
      new Map([[KEY_ID, input.publicKey]]),
      {
        expectedKeyId: KEY_ID,
        expectedPublicKeyFingerprint: input.fingerprint,
        statement: wrongRelease,
      },
    ), HISTORICAL_RUNTIME_TWIN_RELEASE_EVIDENCE_ERROR_CODES.statementIdentityMismatch);

    const wrongReview = ReconstructionReleaseSigningStatementSchema.parse({
      ...input.expectedStatement,
      predicate: {
        ...input.expectedStatement.predicate,
        reviewId: "20000000-0000-4000-8000-000000000121",
      },
    });
    expectIntegrityCode(() => verifyHistoricalRuntimeTwinReleaseEnvelopeBytes(
      input.envelopeBytes,
      new Map([[KEY_ID, input.publicKey]]),
      {
        expectedKeyId: KEY_ID,
        expectedPublicKeyFingerprint: input.fingerprint,
        statement: wrongReview,
      },
    ), HISTORICAL_RUNTIME_TWIN_RELEASE_EVIDENCE_ERROR_CODES.statementIdentityMismatch);
  });
});
