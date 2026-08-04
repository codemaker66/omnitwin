import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  KeyObject,
  sign,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  FOUNDRY_ACTIVATION_V1_JSON_MAX_DEPTH,
  FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_ERROR_CODES,
  FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_MAX_ENVELOPE_BYTES,
  FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_MAX_PAYLOAD_BYTES,
  FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_PROFILES,
  canonicalizeFoundryActivationV1Json,
  parseFoundryActivationV1CanonicalJsonBytes,
  verifyFoundryActivationV1SignedEvidenceEnvelopeBytes,
  type FoundryActivationV1SignedEvidenceKind,
} from "../activation-v1-authenticated-evidence-bytes.js";
import { FoundryIntegrityError } from "../errors.js";

const canonicalDecimalSchema = z.string().regex(/^(?:0|[1-9][0-9]*)$/u);
const rawSha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const prefixedSha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const evidenceKindSchema = z.enum([
  "bootstrap_ceremony",
  "admin_action",
  "predecessor_source",
  "gateway_token_commitment",
  "runner_terminal",
  "provider_result",
  "storage_create",
  "storage_read",
  "glb_verifier",
]);
const positiveVectorSchema = z.object({
  id: z.string().min(1),
  evidenceKind: evidenceKindSchema,
  domain: z.string().min(1),
  payloadType: z.string().min(1),
  keyId: z.string().min(1),
  publicKeySpkiBase64: z.string().min(1),
  publicKeySpkiSha256: prefixedSha256Schema,
  payloadCanonicalJson: z.string().min(1),
  payloadBase64: z.string().min(1),
  payloadByteLength: canonicalDecimalSchema,
  payloadSha256: rawSha256Schema,
  receiptSha256: prefixedSha256Schema,
  signatureBase64: z.string().min(1),
  envelopeCanonicalJson: z.string().min(1),
  envelopeBase64: z.string().min(1),
  envelopeByteLength: canonicalDecimalSchema,
  envelopeRawSha256: rawSha256Schema,
  envelopeSha256: prefixedSha256Schema,
}).strict();
const positiveCanonicalJsonVectorSchema = z.object({
  id: z.string().min(1),
  canonicalJson: z.string().min(1),
  rawBase64: z.string().min(1),
  byteLength: canonicalDecimalSchema,
  sha256: rawSha256Schema,
}).strict();
const negativeCanonicalBase64VectorSchema = z.object({
  id: z.string().min(1),
  encoded: z.string(),
  expectedErrorCode: z.literal("FOUNDRY_ACTIVATION_V1_BASE64_INVALID"),
}).strict();
const negativeCanonicalJsonVectorSchema = z.object({
  id: z.string().min(1),
  rawBase64: z.string().min(1),
  maximumByteLength: canonicalDecimalSchema,
  expectedErrorCode: z.enum([
    "FOUNDRY_ACTIVATION_V1_UTF8_BOM_FORBIDDEN",
    "FOUNDRY_ACTIVATION_V1_UTF8_INVALID",
    "FOUNDRY_ACTIVATION_V1_JSON_DUPLICATE_KEY",
    "FOUNDRY_ACTIVATION_V1_JSON_NUMBER_FORBIDDEN",
    "FOUNDRY_ACTIVATION_V1_JSON_KEY_NOT_ASCII",
    "FOUNDRY_ACTIVATION_V1_JSON_STRING_NOT_UNICODE_SCALAR",
    "FOUNDRY_ACTIVATION_V1_JSON_NOT_CANONICAL",
  ]),
}).strict();
const vectorFixtureSchema = z.object({
  schemaVersion: z.literal("omnitwin.foundry.activation-v1-authenticated-evidence-byte-vectors.v1"),
  authority: z.literal("none"),
  semanticReceiptValidation: z.literal("not_performed"),
  databaseAdmission: z.literal("not_performed"),
  privateKeyMaterial: z.literal("not_included"),
  sourceContract: z.object({
    path: z.literal("docs/specs/omnitwin-foundry-authenticated-result-evidence-v1.md"),
    byteLength: canonicalDecimalSchema,
    sha256: rawSha256Schema,
  }).strict(),
  positiveVectors: z.array(positiveVectorSchema).min(1),
  positiveCanonicalJsonVectors: z.array(positiveCanonicalJsonVectorSchema).min(1),
  negativeCanonicalBase64Vectors: z.array(negativeCanonicalBase64VectorSchema).min(1),
  negativeCanonicalJsonVectors: z.array(negativeCanonicalJsonVectorSchema).min(1),
}).strict();
const vectorSchemaDocumentSchema = z.object({
  $schema: z.literal("https://json-schema.org/draft/2020-12/schema"),
  $id: z.literal("https://omnitwin.local/schemas/omnitwin-foundry-activation-v1-authenticated-evidence-byte-vectors.schema.json"),
  title: z.literal("OmniTwin Foundry Activation V1 authenticated-evidence byte vectors"),
  type: z.literal("object"),
  additionalProperties: z.literal(false),
  required: z.array(z.string()).min(1),
  properties: z.record(z.unknown()),
  $defs: z.record(z.unknown()),
}).strict();

const vectorUrl = new URL(
  "../../../../docs/specs/omnitwin-foundry-activation-v1-authenticated-evidence-byte-vectors.json",
  import.meta.url,
);
const vectorSchemaUrl = new URL(
  "../../../../docs/specs/omnitwin-foundry-activation-v1-authenticated-evidence-byte-vectors.schema.json",
  import.meta.url,
);
const sourceContractUrl = new URL(
  "../../../../docs/specs/omnitwin-foundry-authenticated-result-evidence-v1.md",
  import.meta.url,
);
const [vectorBytes, vectorSchemaBytes, sourceContractBytes] = await Promise.all([
  readFile(vectorUrl),
  readFile(vectorSchemaUrl),
  readFile(sourceContractUrl),
]);
const vectors = vectorFixtureSchema.parse(JSON.parse(vectorBytes.toString("utf8")));
const vectorSchemaDocument = vectorSchemaDocumentSchema.parse(
  JSON.parse(vectorSchemaBytes.toString("utf8")),
);
const fixedVector = vectors.positiveVectors[0];
if (fixedVector === undefined) throw new Error("The fixed Activation V1 evidence vector is missing.");

const ERROR = FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_ERROR_CODES;
const EVIDENCE_KINDS = [
  "bootstrap_ceremony",
  "admin_action",
  "predecessor_source",
  "gateway_token_commitment",
  "runner_terminal",
  "provider_result",
  "storage_create",
  "storage_read",
  "glb_verifier",
] as const satisfies readonly FoundryActivationV1SignedEvidenceKind[];
const EXPECTED_SIGNED_EVIDENCE_PROFILES = {
  bootstrap_ceremony: {
    domain: "omnitwin.foundry.derivative-bootstrap-ceremony.v1",
    payloadType: "application/vnd.omnitwin.foundry.derivative-bootstrap-ceremony.v1+json",
  },
  admin_action: {
    domain: "omnitwin.foundry.derivative-admin-action.v1",
    payloadType: "application/vnd.omnitwin.foundry.derivative-admin-action.v1+json",
  },
  predecessor_source: {
    domain: "omnitwin.foundry.derivative-predecessor-source.v1",
    payloadType: "application/vnd.omnitwin.foundry.derivative-predecessor-source.v1+json",
  },
  gateway_token_commitment: {
    domain: "omnitwin.foundry.derivative-gateway-token-commitment.v1",
    payloadType: "application/vnd.omnitwin.foundry.derivative-gateway-token-commitment.v1+json",
  },
  runner_terminal: {
    domain: "omnitwin.foundry.derivative-runner-terminal-receipt.v1",
    payloadType: "application/vnd.omnitwin.foundry.derivative-runner-terminal-receipt.v1+json",
  },
  provider_result: {
    domain: "omnitwin.foundry.derivative-provider-result-evidence.v1",
    payloadType: "application/vnd.omnitwin.foundry.derivative-provider-result-evidence.v1+json",
  },
  storage_create: {
    domain: "omnitwin.foundry.derivative-storage-create.v1",
    payloadType: "application/vnd.omnitwin.foundry.derivative-storage-create.v1+json",
  },
  storage_read: {
    domain: "omnitwin.foundry.derivative-storage-read.v1",
    payloadType: "application/vnd.omnitwin.foundry.derivative-storage-read.v1+json",
  },
  glb_verifier: {
    domain: "omnitwin.foundry.derivative-glb-verifier-receipt.v1",
    payloadType: "application/vnd.omnitwin.foundry.derivative-glb-verifier-receipt.v1+json",
  },
} as const satisfies Readonly<Record<FoundryActivationV1SignedEvidenceKind, {
  readonly domain: string;
  readonly payloadType: string;
}>>;
const fixedEnvelopeSchema = z.object({
  payload: z.string(),
  payloadType: z.string(),
  signatures: z.array(z.object({ keyid: z.string(), sig: z.string() }).strict()).length(1),
}).strict();

interface TestSignature {
  keyid: string;
  sig: string;
}

interface TestEnvelope {
  payload: string;
  payloadType: string;
  signatures: TestSignature[];
}

function sha256Hex(...members: readonly Uint8Array[]): string {
  const hash = createHash("sha256");
  for (const member of members) hash.update(member);
  return hash.digest("hex");
}

function pae(payloadType: string, payloadBytes: Uint8Array): Buffer {
  const payloadTypeBytes = Buffer.from(payloadType, "utf8");
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${String(payloadTypeBytes.byteLength)} `, "ascii"),
    payloadTypeBytes,
    Buffer.from(` ${String(payloadBytes.byteLength)} `, "ascii"),
    payloadBytes,
  ]);
}

function createSignedEnvelope(
  payloadBytes: Buffer,
  evidenceKind: FoundryActivationV1SignedEvidenceKind,
  privateKey: KeyObject,
  keyId: string,
  payloadType = FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_PROFILES[evidenceKind].payloadType,
): TestEnvelope {
  return {
    payload: payloadBytes.toString("base64"),
    payloadType,
    signatures: [{
      keyid: keyId,
      sig: sign(null, pae(payloadType, payloadBytes), privateKey).toString("base64"),
    }],
  };
}

function canonicalEnvelopeBytes(envelope: unknown): Buffer {
  return Buffer.from(canonicalizeFoundryActivationV1Json(envelope), "utf8");
}

function createProfilePayloadBytes(evidenceKind: FoundryActivationV1SignedEvidenceKind): Buffer {
  const value = evidenceKind === "bootstrap_ceremony"
    ? { ceremony: "wire-only-fixture" }
    : { authority: "none", evidenceKind, fixture: "wire-only" };
  return Buffer.from(canonicalizeFoundryActivationV1Json(value), "utf8");
}

function createDisposableFixture(evidenceKind: FoundryActivationV1SignedEvidenceKind = "admin_action") {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyId = `test-${evidenceKind}`;
  const payloadBytes = createProfilePayloadBytes(evidenceKind);
  const envelope = createSignedEnvelope(payloadBytes, evidenceKind, privateKey, keyId);
  return {
    evidenceKind,
    publicKey,
    privateKey,
    keyId,
    payloadBytes,
    envelope,
    envelopeBytes: canonicalEnvelopeBytes(envelope),
  };
}

function expectIntegrityCode(action: () => unknown, expectedCode: string): FoundryIntegrityError {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  if (!(caught instanceof FoundryIntegrityError)) {
    throw new Error(`Expected FoundryIntegrityError ${expectedCode}.`, { cause: caught });
  }
  expect(caught.code).toBe(expectedCode);
  return caught;
}

describe("Activation V1 canonical JSON bytes", () => {
  it("pins the strict vector document and its source contract", () => {
    expect(vectorSchemaDocument.additionalProperties).toBe(false);
    expect(vectorSchemaDocument.required).toEqual(expect.arrayContaining([
      "positiveVectors",
      "positiveCanonicalJsonVectors",
      "negativeCanonicalBase64Vectors",
      "negativeCanonicalJsonVectors",
    ]));
    expect(sourceContractBytes.byteLength).toBe(Number(vectors.sourceContract.byteLength));
    expect(sha256Hex(sourceContractBytes)).toBe(vectors.sourceContract.sha256);
    expect(vectors.authority).toBe("none");
    expect(vectors.semanticReceiptValidation).toBe("not_performed");
    expect(vectors.databaseAdmission).toBe("not_performed");
    expect(vectors.privateKeyMaterial).toBe("not_included");
  });

  it.each(vectors.positiveCanonicalJsonVectors.map((vector) => [vector.id, vector] as const))(
    "accepts shared canonical JSON vector %s",
    (_id, vector) => {
      const raw = Buffer.from(vector.rawBase64, "base64");
      expect(raw.toString("utf8")).toBe(vector.canonicalJson);
      expect(raw.byteLength).toBe(Number(vector.byteLength));
      expect(sha256Hex(raw)).toBe(vector.sha256);
      expect(parseFoundryActivationV1CanonicalJsonBytes(raw, raw.byteLength).canonicalJson)
        .toBe(vector.canonicalJson);
    },
  );

  it.each(vectors.negativeCanonicalJsonVectors.map((vector) => [vector.id, vector] as const))(
    "rejects shared canonical JSON vector %s",
    (_id, vector) => {
      expectIntegrityCode(
        () => parseFoundryActivationV1CanonicalJsonBytes(
          Buffer.from(vector.rawBase64, "base64"),
          Number(vector.maximumByteLength),
        ),
        vector.expectedErrorCode,
      );
    },
  );

  it("uses unsigned ASCII key order and preserves the allowed JSON primitives", () => {
    expect(canonicalizeFoundryActivationV1Json({
      a: "lower",
      _: "under",
      Z: "zulu",
      A: "alpha",
    })).toBe('{"A":"alpha","Z":"zulu","_":"under","a":"lower"}');
    expect(canonicalizeFoundryActivationV1Json({
      empty: "",
      escaped: "\b\f\n\r\t\"\\/",
      flags: [true, false, null],
      ordinal: "10",
      unicode: "😀",
      zero: "0",
    })).toBe('{"empty":"","escaped":"\\b\\f\\n\\r\\t\\"\\\\/","flags":[true,false,null],"ordinal":"10","unicode":"😀","zero":"0"}');
    expect(canonicalizeFoundryActivationV1Json({})).toBe("{}");
    expect(canonicalizeFoundryActivationV1Json([])).toBe("[]");
  });

  it("rejects numeric leaves and unsupported JavaScript values", () => {
    expectIntegrityCode(() => canonicalizeFoundryActivationV1Json({ value: 1 }), ERROR.jsonNumberForbidden);
    expectIntegrityCode(() => canonicalizeFoundryActivationV1Json({ value: -0 }), ERROR.jsonNumberForbidden);
    expectIntegrityCode(() => canonicalizeFoundryActivationV1Json({ value: undefined }), ERROR.jsonValueUnsupported);
    expectIntegrityCode(() => canonicalizeFoundryActivationV1Json({ value: Symbol("x") }), ERROR.jsonValueUnsupported);
    expectIntegrityCode(() => canonicalizeFoundryActivationV1Json({ value: 1n }), ERROR.jsonValueUnsupported);
    expectIntegrityCode(() => canonicalizeFoundryActivationV1Json(new Date(0)), ERROR.jsonValueUnsupported);

    const accessor = {};
    Object.defineProperty(accessor, "value", { enumerable: true, get: () => "not-read" });
    expectIntegrityCode(() => canonicalizeFoundryActivationV1Json(accessor), ERROR.jsonValueUnsupported);

    const sparse: string[] = [];
    sparse.length = 1;
    expectIntegrityCode(() => canonicalizeFoundryActivationV1Json(sparse), ERROR.jsonValueUnsupported);
  });

  it("rejects cycles, non-ASCII keys, lone surrogates, and exotic members", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expectIntegrityCode(() => canonicalizeFoundryActivationV1Json(cyclic), ERROR.jsonCycle);
    expectIntegrityCode(() => canonicalizeFoundryActivationV1Json({ "é": "value" }), ERROR.jsonKeyNotAscii);
    expectIntegrityCode(() => canonicalizeFoundryActivationV1Json({ value: "\ud800" }), ERROR.jsonStringNotScalar);

    const symbolKeyed = { value: "ok" };
    Object.defineProperty(symbolKeyed, Symbol("extra"), { enumerable: true, value: "no" });
    expectIntegrityCode(() => canonicalizeFoundryActivationV1Json(symbolKeyed), ERROR.jsonValueUnsupported);

    const arrayWithExtra = ["ok"];
    Object.defineProperty(arrayWithExtra, "extra", { enumerable: true, value: "no" });
    expectIntegrityCode(() => canonicalizeFoundryActivationV1Json(arrayWithExtra), ERROR.jsonValueUnsupported);
  });

  it("fails with a stable code at the explicit nesting boundary", () => {
    let allowed: unknown = "leaf";
    for (let index = 0; index < FOUNDRY_ACTIVATION_V1_JSON_MAX_DEPTH; index += 1) allowed = [allowed];
    const allowedJson = canonicalizeFoundryActivationV1Json(allowed);
    expect(parseFoundryActivationV1CanonicalJsonBytes(Buffer.from(allowedJson), allowedJson.length).canonicalJson)
      .toBe(allowedJson);

    const tooDeep = [allowed];
    expectIntegrityCode(() => canonicalizeFoundryActivationV1Json(tooDeep), ERROR.jsonDepthExceeded);
    const tooDeepJson = `${"[".repeat(FOUNDRY_ACTIVATION_V1_JSON_MAX_DEPTH + 1)}"leaf"${"]".repeat(FOUNDRY_ACTIVATION_V1_JSON_MAX_DEPTH + 1)}`;
    expectIntegrityCode(
      () => parseFoundryActivationV1CanonicalJsonBytes(Buffer.from(tooDeepJson), tooDeepJson.length),
      ERROR.jsonDepthExceeded,
    );

    const fixture = createDisposableFixture();
    expectIntegrityCode(
      () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
        Buffer.from(tooDeepJson),
        new Map([[fixture.keyId, fixture.publicKey]]),
        { evidenceKind: fixture.evidenceKind, expectedKeyId: fixture.keyId },
      ),
      ERROR.jsonDepthExceeded,
    );
  });

  it("requires raw bytes and a non-negative safe byte limit", () => {
    expectIntegrityCode(
      () => Reflect.apply(parseFoundryActivationV1CanonicalJsonBytes, undefined, ["{}", 2]),
      ERROR.bytesRequired,
    );
    expectIntegrityCode(
      () => Reflect.apply(parseFoundryActivationV1CanonicalJsonBytes, undefined, [
        new Uint16Array([0x007b, 0x007d]),
        4,
      ]),
      ERROR.bytesRequired,
    );
    for (const invalidLimit of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expectIntegrityCode(
        () => parseFoundryActivationV1CanonicalJsonBytes(Buffer.from("{}"), invalidLimit),
        ERROR.byteLimitInvalid,
      );
    }
    expectIntegrityCode(
      () => parseFoundryActivationV1CanonicalJsonBytes(Buffer.from("{}"), 1),
      ERROR.byteLimitExceeded,
    );
  });

  it("uses intrinsic typed-array length instead of an overridable property", () => {
    const misreported = new Uint8Array(Buffer.from("{}"));
    Object.defineProperty(misreported, "byteLength", { configurable: true, value: 0 });
    expectIntegrityCode(
      () => parseFoundryActivationV1CanonicalJsonBytes(misreported, 1),
      ERROR.byteLimitExceeded,
    );
    expect(parseFoundryActivationV1CanonicalJsonBytes(misreported, 2).canonicalJson).toBe("{}");

    const overEnvelopeLimit = new Uint8Array(
      FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_MAX_ENVELOPE_BYTES + 1,
    );
    Object.defineProperty(overEnvelopeLimit, "byteLength", { configurable: true, value: 0 });
    expectIntegrityCode(
      () => Reflect.apply(verifyFoundryActivationV1SignedEvidenceEnvelopeBytes, undefined, [
        overEnvelopeLimit,
        new Map(),
        { evidenceKind: "admin_action", expectedKeyId: "test-key" },
      ]),
      ERROR.byteLimitExceeded,
    );
  });
});

describe("Activation V1 fixed public signed-evidence vector", () => {
  it("pins all nine profile domains and payload types independently of the implementation table", () => {
    expect(FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_PROFILES).toEqual(
      EXPECTED_SIGNED_EVIDENCE_PROFILES,
    );
  });

  it("verifies exact public bytes, PAE identity, lengths, and digests", () => {
    const publicKeySpki = Buffer.from(fixedVector.publicKeySpkiBase64, "base64");
    const publicKey = createPublicKey({ key: publicKeySpki, format: "der", type: "spki" });
    const payloadBytes = Buffer.from(fixedVector.payloadBase64, "base64");
    const envelopeBytes = Buffer.from(fixedVector.envelopeBase64, "base64");

    expect(`sha256:${sha256Hex(publicKeySpki)}`).toBe(fixedVector.publicKeySpkiSha256);
    expect(publicKeySpki.toString("base64")).toBe(fixedVector.publicKeySpkiBase64);
    expect(payloadBytes.toString("utf8")).toBe(fixedVector.payloadCanonicalJson);
    expect(payloadBytes.toString("base64")).toBe(fixedVector.payloadBase64);
    expect(payloadBytes.byteLength).toBe(Number(fixedVector.payloadByteLength));
    expect(sha256Hex(payloadBytes)).toBe(fixedVector.payloadSha256);
    expect(envelopeBytes.toString("utf8")).toBe(fixedVector.envelopeCanonicalJson);
    expect(envelopeBytes.toString("base64")).toBe(fixedVector.envelopeBase64);
    expect(envelopeBytes.byteLength).toBe(Number(fixedVector.envelopeByteLength));
    expect(sha256Hex(envelopeBytes)).toBe(fixedVector.envelopeRawSha256);
    const parsedEnvelope = fixedEnvelopeSchema.parse(JSON.parse(fixedVector.envelopeCanonicalJson));
    expect(parsedEnvelope.payload).toBe(fixedVector.payloadBase64);
    expect(parsedEnvelope.payloadType).toBe(fixedVector.payloadType);
    expect(parsedEnvelope.signatures[0]!.keyid).toBe(fixedVector.keyId);
    expect(parsedEnvelope.signatures[0]!.sig).toBe(fixedVector.signatureBase64);

    const result = verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
      envelopeBytes,
      new Map([[fixedVector.keyId, publicKey]]),
      { evidenceKind: fixedVector.evidenceKind, expectedKeyId: fixedVector.keyId },
    );
    expect(result).toEqual({
      evidenceKind: fixedVector.evidenceKind,
      domain: fixedVector.domain,
      payloadType: fixedVector.payloadType,
      keyId: fixedVector.keyId,
      signerPublicKeySha256: fixedVector.publicKeySpkiSha256,
      canonicalPayloadJson: fixedVector.payloadCanonicalJson,
      canonicalEnvelopeJson: fixedVector.envelopeCanonicalJson,
      payloadByteLength: fixedVector.payloadByteLength,
      envelopeByteLength: fixedVector.envelopeByteLength,
      payloadSha256: fixedVector.payloadSha256,
      receiptSha256: fixedVector.receiptSha256,
      envelopeSha256: fixedVector.envelopeSha256,
    });
    expect(result.receiptSha256).toBe(
      `sha256:${sha256Hex(Buffer.from(`${fixedVector.domain}\n`), payloadBytes)}`,
    );
    expect(result.envelopeSha256).toBe(
      `sha256:${sha256Hex(Buffer.from(`${fixedVector.domain}.dsse-envelope\n`), envelopeBytes)}`,
    );
    expect(Object.isFrozen(result)).toBe(true);
    for (const forbiddenField of [
      "authority",
      "authorized",
      "trusted",
      "verified",
      "admitted",
      "admissionVerdict",
      "databaseAdmission",
      "signatureValid",
      "releaseEligible",
    ]) {
      expect(result).not.toHaveProperty(forbiddenField);
    }
  });
});

describe("Activation V1 signed-evidence envelope verification", () => {
  it.each(EVIDENCE_KINDS)("verifies the closed single-envelope wire profile %s", (evidenceKind) => {
    const fixture = createDisposableFixture(evidenceKind);
    const result = verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
      fixture.envelopeBytes,
      new Map([[fixture.keyId, fixture.publicKey]]),
      { evidenceKind, expectedKeyId: fixture.keyId },
    );
    expect(result.evidenceKind).toBe(evidenceKind);
    expect(result.domain).toBe(EXPECTED_SIGNED_EVIDENCE_PROFILES[evidenceKind].domain);
    expect(result.payloadType).toBe(EXPECTED_SIGNED_EVIDENCE_PROFILES[evidenceKind].payloadType);
    expect(result.payloadByteLength).toBe(String(fixture.payloadBytes.byteLength));
    expect(result.keyId).toBe(fixture.keyId);
    const publicKeySpki = fixture.publicKey.export({ format: "der", type: "spki" });
    expect(result.signerPublicKeySha256).toBe(`sha256:${sha256Hex(publicKeySpki)}`);
  });

  it("rejects noncanonical, missing, unknown, or non-single-signature envelope shapes", () => {
    const fixture = createDisposableFixture();
    const keys = new Map([[fixture.keyId, fixture.publicKey]]);
    const expected = { evidenceKind: fixture.evidenceKind, expectedKeyId: fixture.keyId } as const;
    const verify = (bytes: Buffer): unknown => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(bytes, keys, expected);

    expectIntegrityCode(() => verify(Buffer.concat([fixture.envelopeBytes, Buffer.from("\n")])), ERROR.jsonNotCanonical);
    expectIntegrityCode(
      () => verify(Buffer.from(JSON.stringify({
        payloadType: fixture.envelope.payloadType,
        payload: fixture.envelope.payload,
        signatures: fixture.envelope.signatures,
      }))),
      ERROR.jsonNotCanonical,
    );
    expectIntegrityCode(
      () => verify(canonicalEnvelopeBytes({ ...fixture.envelope, unknown: "value" })),
      ERROR.envelopeShapeInvalid,
    );
    const { payload: _omittedPayload, ...missingPayload } = fixture.envelope;
    expectIntegrityCode(() => verify(canonicalEnvelopeBytes(missingPayload)), ERROR.envelopeShapeInvalid);
    expectIntegrityCode(
      () => verify(canonicalEnvelopeBytes({ ...fixture.envelope, signatures: [] })),
      ERROR.envelopeShapeInvalid,
    );
    expectIntegrityCode(
      () => verify(canonicalEnvelopeBytes({
        ...fixture.envelope,
        signatures: [fixture.envelope.signatures[0]!, fixture.envelope.signatures[0]!],
      })),
      ERROR.envelopeShapeInvalid,
    );
    expectIntegrityCode(
      () => verify(canonicalEnvelopeBytes({
        ...fixture.envelope,
        signatures: [{ ...fixture.envelope.signatures[0]!, unknown: "value" }],
      })),
      ERROR.envelopeShapeInvalid,
    );
    expectIntegrityCode(
      () => verify(canonicalEnvelopeBytes({ ...fixture.envelope, signatures: "not-an-array" })),
      ERROR.envelopeShapeInvalid,
    );
  });

  it.each(vectors.negativeCanonicalBase64Vectors.map((vector) => [vector.id, vector] as const))(
    "rejects shared canonical-base64 vector %s",
    (_id, vector) => {
      const fixture = createDisposableFixture();
      expectIntegrityCode(
        () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
          canonicalEnvelopeBytes({ ...fixture.envelope, payload: vector.encoded }),
          new Map([[fixture.keyId, fixture.publicKey]]),
          { evidenceKind: fixture.evidenceKind, expectedKeyId: fixture.keyId },
        ),
        vector.expectedErrorCode,
      );
    },
  );

  it("rejects malformed base64 and non-64-byte signatures", () => {
    const fixture = createDisposableFixture();
    const keys = new Map([[fixture.keyId, fixture.publicKey]]);
    const expected = { evidenceKind: fixture.evidenceKind, expectedKeyId: fixture.keyId } as const;
    const verifySignatureValue = (sig: string): unknown => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
      canonicalEnvelopeBytes({
        ...fixture.envelope,
        signatures: [{ keyid: fixture.keyId, sig }],
      }),
      keys,
      expected,
    );
    expectIntegrityCode(() => verifySignatureValue("AR=="), ERROR.base64Invalid);
    expectIntegrityCode(() => verifySignatureValue(Buffer.alloc(63).toString("base64")), ERROR.signatureLengthInvalid);
    expectIntegrityCode(() => verifySignatureValue(Buffer.alloc(65).toString("base64")), ERROR.signatureLengthInvalid);
  });

  it("rejects invalid, unexpected, absent, private, and non-Ed25519 keys", () => {
    const fixture = createDisposableFixture();
    const expected = { evidenceKind: fixture.evidenceKind, expectedKeyId: fixture.keyId } as const;
    expectIntegrityCode(
      () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
        canonicalEnvelopeBytes({
          ...fixture.envelope,
          signatures: [{ ...fixture.envelope.signatures[0]!, keyid: "\n" }],
        }),
        new Map([[fixture.keyId, fixture.publicKey]]),
        expected,
      ),
      ERROR.keyIdInvalid,
    );
    expectIntegrityCode(
      () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
        canonicalEnvelopeBytes({
          ...fixture.envelope,
          signatures: [{ ...fixture.envelope.signatures[0]!, keyid: "x".repeat(129) }],
        }),
        new Map([[fixture.keyId, fixture.publicKey]]),
        expected,
      ),
      ERROR.keyIdInvalid,
    );
    for (const invalidExpectedKeyId of ["", "\u001f", "x".repeat(129)]) {
      expectIntegrityCode(
        () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
          fixture.envelopeBytes,
          new Map([[invalidExpectedKeyId, fixture.publicKey]]),
          { evidenceKind: fixture.evidenceKind, expectedKeyId: invalidExpectedKeyId },
        ),
        ERROR.keyIdInvalid,
      );
    }
    expectIntegrityCode(
      () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(fixture.envelopeBytes, new Map(), expected),
      ERROR.publicKeyMissing,
    );
    expectIntegrityCode(
      () => Reflect.apply(verifyFoundryActivationV1SignedEvidenceEnvelopeBytes, undefined, [
        fixture.envelopeBytes,
        {},
        expected,
      ]),
      ERROR.publicKeyMapInvalid,
    );
    expectIntegrityCode(
      () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
        fixture.envelopeBytes,
        new Map([[fixture.keyId, fixture.privateKey]]),
        expected,
      ),
      ERROR.privateKeyRejected,
    );
    Object.defineProperty(fixture.privateKey, "type", { configurable: true, value: "public" });
    expectIntegrityCode(
      () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
        fixture.envelopeBytes,
        new Map([[fixture.keyId, fixture.privateKey]]),
        expected,
      ),
      ERROR.privateKeyRejected,
    );
    expectIntegrityCode(
      () => Reflect.apply(verifyFoundryActivationV1SignedEvidenceEnvelopeBytes, undefined, [
        fixture.envelopeBytes,
        new Map([[fixture.keyId, {
          type: "public",
          asymmetricKeyType: "ed25519",
          key: fixture.privateKey,
        }]]),
        expected,
      ]),
      ERROR.keyTypeInvalid,
    );
    const forgedKeyObject = new Proxy({
      type: "public",
      asymmetricKeyType: "ed25519",
      key: fixture.privateKey,
    }, {
      getPrototypeOf: () => KeyObject.prototype,
    });
    expect(forgedKeyObject instanceof KeyObject).toBe(true);
    expectIntegrityCode(
      () => Reflect.apply(verifyFoundryActivationV1SignedEvidenceEnvelopeBytes, undefined, [
        fixture.envelopeBytes,
        new Map([[fixture.keyId, forgedKeyObject]]),
        expected,
      ]),
      ERROR.keyTypeInvalid,
    );
    expectIntegrityCode(
      () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
        fixture.envelopeBytes,
        new Map([[fixture.keyId, new Proxy(fixture.publicKey, {})]]),
        expected,
      ),
      ERROR.keyTypeInvalid,
    );
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expectIntegrityCode(
      () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
        fixture.envelopeBytes,
        new Map([[fixture.keyId, rsa.publicKey]]),
        expected,
      ),
      ERROR.keyTypeInvalid,
    );
    Object.defineProperty(rsa.publicKey, "asymmetricKeyType", {
      configurable: true,
      value: "ed25519",
    });
    expectIntegrityCode(
      () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
        fixture.envelopeBytes,
        new Map([[fixture.keyId, rsa.publicKey]]),
        expected,
      ),
      ERROR.keyTypeInvalid,
    );

    const genuineExport = fixture.publicKey.export({ format: "der", type: "spki" });
    const substitutedExport = generateKeyPairSync("ed25519").publicKey.export({
      format: "der",
      type: "spki",
    });
    let shadowExportCallCount = 0;
    Object.defineProperty(fixture.publicKey, "export", {
      configurable: true,
      value: () => {
        shadowExportCallCount += 1;
        return substitutedExport;
      },
    });
    const shadowedExportResult = verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
      fixture.envelopeBytes,
      new Map([[fixture.keyId, fixture.publicKey]]),
      expected,
    );
    expect(shadowExportCallCount).toBe(0);
    expect(shadowedExportResult.signerPublicKeySha256).toBe(`sha256:${sha256Hex(genuineExport)}`);
    let shadowTypeCallCount = 0;
    Object.defineProperty(fixture.publicKey, "type", {
      configurable: true,
      get(): never {
        shadowTypeCallCount += 1;
        throw new Error("A key-owned type getter must never run.");
      },
    });
    const shadowedTypeResult = verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
      fixture.envelopeBytes,
      new Map([[fixture.keyId, fixture.publicKey]]),
      expected,
    );
    expect(shadowTypeCallCount).toBe(0);
    expect(shadowedTypeResult.signerPublicKeySha256).toBe(`sha256:${sha256Hex(genuineExport)}`);
  });

  it("rejects key substitution, key-ID substitution, PAE mismatch, and signature tampering", () => {
    const fixture = createDisposableFixture();
    const replacement = generateKeyPairSync("ed25519");
    expectIntegrityCode(
      () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
        fixture.envelopeBytes,
        new Map([[fixture.keyId, replacement.publicKey]]),
        { evidenceKind: fixture.evidenceKind, expectedKeyId: fixture.keyId },
      ),
      ERROR.signatureInvalid,
    );

    const otherKeyId = "other-key";
    expectIntegrityCode(
      () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
        fixture.envelopeBytes,
        new Map([[otherKeyId, fixture.publicKey]]),
        { evidenceKind: fixture.evidenceKind, expectedKeyId: otherKeyId },
      ),
      ERROR.keyIdMismatch,
    );

    const paeMismatchSignature = sign(
      null,
      pae("application/vnd.omnitwin.wrong.v1+json", fixture.payloadBytes),
      fixture.privateKey,
    ).toString("base64");
    expectIntegrityCode(
      () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
        canonicalEnvelopeBytes({
          ...fixture.envelope,
          signatures: [{ keyid: fixture.keyId, sig: paeMismatchSignature }],
        }),
        new Map([[fixture.keyId, fixture.publicKey]]),
        { evidenceKind: fixture.evidenceKind, expectedKeyId: fixture.keyId },
      ),
      ERROR.signatureInvalid,
    );

    const tamperedSignature = Buffer.from(fixture.envelope.signatures[0]!.sig, "base64");
    tamperedSignature[0] = tamperedSignature[0]! ^ 1;
    expectIntegrityCode(
      () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
        canonicalEnvelopeBytes({
          ...fixture.envelope,
          signatures: [{ keyid: fixture.keyId, sig: tamperedSignature.toString("base64") }],
        }),
        new Map([[fixture.keyId, fixture.publicKey]]),
        { evidenceKind: fixture.evidenceKind, expectedKeyId: fixture.keyId },
      ),
      ERROR.signatureInvalid,
    );
  });

  it("rejects an invalid profile, wrong payload type, or mismatched payload binding", () => {
    const fixture = createDisposableFixture();
    expectIntegrityCode(
      () => Reflect.apply(verifyFoundryActivationV1SignedEvidenceEnvelopeBytes, undefined, [
        fixture.envelopeBytes,
        new Map([[fixture.keyId, fixture.publicKey]]),
        { evidenceKind: "not-a-profile", expectedKeyId: fixture.keyId },
      ]),
      ERROR.evidenceKindInvalid,
    );
    expectIntegrityCode(
      () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
        fixture.envelopeBytes,
        new Map([[fixture.keyId, fixture.publicKey]]),
        { evidenceKind: "runner_terminal", expectedKeyId: fixture.keyId },
      ),
      ERROR.payloadTypeMismatch,
    );

    for (const payloadValue of [
      { authority: "none", evidenceKind: "runner_terminal" },
      { authority: "some", evidenceKind: "admin_action" },
      { evidenceKind: "admin_action" },
    ]) {
      const payloadBytes = Buffer.from(canonicalizeFoundryActivationV1Json(payloadValue));
      const envelope = createSignedEnvelope(
        payloadBytes,
        "admin_action",
        fixture.privateKey,
        fixture.keyId,
      );
      expectIntegrityCode(
        () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
          canonicalEnvelopeBytes(envelope),
          new Map([[fixture.keyId, fixture.publicKey]]),
          { evidenceKind: "admin_action", expectedKeyId: fixture.keyId },
        ),
        ERROR.profileBindingMismatch,
      );
    }
  });

  it("uses intrinsic Map lookup and ignores an overridden re-entrant get method", () => {
    const fixture = createDisposableFixture();
    const expectedIdentity: {
      evidenceKind: FoundryActivationV1SignedEvidenceKind;
      expectedKeyId: string;
    } = { evidenceKind: fixture.evidenceKind, expectedKeyId: fixture.keyId };
    let overriddenGetCallCount = 0;
    class MutatingMap extends Map<string, KeyObject> {
      override get(key: string): KeyObject | undefined {
        overriddenGetCallCount += 1;
        expectedIdentity.evidenceKind = "runner_terminal";
        expectedIdentity.expectedKeyId = "mutated-after-snapshot";
        return super.get(key);
      }
    }
    const keys = new MutatingMap([[fixture.keyId, fixture.publicKey]]);
    const result = verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
      fixture.envelopeBytes,
      keys,
      expectedIdentity,
    );
    expect(result.evidenceKind).toBe(fixture.evidenceKind);
    expect(result.keyId).toBe(fixture.keyId);
    expect(result.domain).toBe(FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_PROFILES[fixture.evidenceKind].domain);
    expect(overriddenGetCallCount).toBe(0);
    expect(expectedIdentity).toEqual({ evidenceKind: fixture.evidenceKind, expectedKeyId: fixture.keyId });
  });

  it("does not invoke an overridden Map lookup that attempts to replace snapshotted bytes", () => {
    const fixture = createDisposableFixture();
    const alternatePayload = Buffer.from(canonicalizeFoundryActivationV1Json({
      authority: "none",
      evidenceKind: fixture.evidenceKind,
      fixture: "wire-twin",
    }));
    expect(alternatePayload.byteLength).toBe(fixture.payloadBytes.byteLength);
    const alternateEnvelope = canonicalEnvelopeBytes(createSignedEnvelope(
      alternatePayload,
      fixture.evidenceKind,
      fixture.privateKey,
      fixture.keyId,
    ));
    expect(alternateEnvelope.byteLength).toBe(fixture.envelopeBytes.byteLength);
    const mutableEnvelope = Buffer.from(fixture.envelopeBytes);
    let overriddenGetCallCount = 0;
    class MutatingEnvelopeMap extends Map<string, KeyObject> {
      override get(key: string): KeyObject | undefined {
        overriddenGetCallCount += 1;
        alternateEnvelope.copy(mutableEnvelope);
        return super.get(key);
      }
    }
    const result = verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
      mutableEnvelope,
      new MutatingEnvelopeMap([[fixture.keyId, fixture.publicKey]]),
      { evidenceKind: fixture.evidenceKind, expectedKeyId: fixture.keyId },
    );
    expect(result.canonicalPayloadJson).toBe(fixture.payloadBytes.toString("utf8"));
    expect(overriddenGetCallCount).toBe(0);
    expect(mutableEnvelope).toEqual(fixture.envelopeBytes);
  });

  it("rejects accessor-shaped or missing expected identity members", () => {
    const fixture = createDisposableFixture();
    const keys = new Map([[fixture.keyId, fixture.publicKey]]);
    const accessorExpected = {
      get evidenceKind(): FoundryActivationV1SignedEvidenceKind {
        return fixture.evidenceKind;
      },
      expectedKeyId: fixture.keyId,
    };
    expectIntegrityCode(
      () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
        fixture.envelopeBytes,
        keys,
        accessorExpected,
      ),
      ERROR.evidenceKindInvalid,
    );
    expectIntegrityCode(
      () => Reflect.apply(verifyFoundryActivationV1SignedEvidenceEnvelopeBytes, undefined, [
        fixture.envelopeBytes,
        keys,
        { evidenceKind: fixture.evidenceKind },
      ]),
      ERROR.keyIdInvalid,
    );
  });

  it("rejects correctly signed noncanonical or malformed payload bytes", () => {
    const fixture = createDisposableFixture();
    const cases: ReadonlyArray<readonly [string, Buffer, string]> = [
      [
        "reordered keys",
        Buffer.from('{"evidenceKind":"admin_action","authority":"none"}'),
        ERROR.jsonNotCanonical,
      ],
      [
        "duplicate key",
        Buffer.from('{"authority":"none","authority":"none","evidenceKind":"admin_action"}'),
        ERROR.jsonDuplicateKey,
      ],
      [
        "numeric leaf",
        Buffer.from('{"authority":"none","evidenceKind":"admin_action","value":1}'),
        ERROR.jsonNumberForbidden,
      ],
      [
        "UTF-8 BOM",
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"authority":"none"}')]),
        ERROR.utf8BomForbidden,
      ],
      [
        "invalid UTF-8",
        Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x22, 0x7d]),
        ERROR.utf8Invalid,
      ],
      [
        "lone surrogate",
        Buffer.from('{"authority":"none","evidenceKind":"admin_action","x":"\\ud800"}'),
        ERROR.jsonStringNotScalar,
      ],
      [
        "non-ASCII key",
        Buffer.from('{"authority":"none","evidenceKind":"admin_action","é":"x"}'),
        ERROR.jsonKeyNotAscii,
      ],
    ];
    for (const [_name, payloadBytes, errorCode] of cases) {
      const envelope = createSignedEnvelope(
        payloadBytes,
        "admin_action",
        fixture.privateKey,
        fixture.keyId,
      );
      expectIntegrityCode(
        () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
          canonicalEnvelopeBytes(envelope),
          new Map([[fixture.keyId, fixture.publicKey]]),
          { evidenceKind: "admin_action", expectedKeyId: fixture.keyId },
        ),
        errorCode,
      );
    }
  });

  it("accepts the exact payload limit and rejects one byte over it", () => {
    const fixture = createDisposableFixture();
    const prefix = '{"authority":"none","evidenceKind":"admin_action","x":"';
    const suffix = '"}';
    const fillLength = FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_MAX_PAYLOAD_BYTES
      - Buffer.byteLength(prefix)
      - Buffer.byteLength(suffix);
    const exactPayload = Buffer.from(`${prefix}${"a".repeat(fillLength)}${suffix}`);
    expect(exactPayload.byteLength).toBe(FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_MAX_PAYLOAD_BYTES);
    const exactEnvelope = canonicalEnvelopeBytes(createSignedEnvelope(
      exactPayload,
      "admin_action",
      fixture.privateKey,
      fixture.keyId,
    ));
    expect(exactEnvelope.byteLength).toBeLessThanOrEqual(
      FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_MAX_ENVELOPE_BYTES,
    );
    expect(verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
      exactEnvelope,
      new Map([[fixture.keyId, fixture.publicKey]]),
      { evidenceKind: "admin_action", expectedKeyId: fixture.keyId },
    ).payloadByteLength).toBe(String(FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_MAX_PAYLOAD_BYTES));

    const overPayload = Buffer.from(`${prefix}${"a".repeat(fillLength + 1)}${suffix}`);
    const overEnvelope = canonicalEnvelopeBytes(createSignedEnvelope(
      overPayload,
      "admin_action",
      fixture.privateKey,
      fixture.keyId,
    ));
    expectIntegrityCode(
      () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
        overEnvelope,
        new Map([[fixture.keyId, fixture.publicKey]]),
        { evidenceKind: "admin_action", expectedKeyId: fixture.keyId },
      ),
      ERROR.byteLimitExceeded,
    );
  });

  it("enforces the raw envelope limit at its exact boundary", () => {
    const fixture = createDisposableFixture();
    const keys = new Map([[fixture.keyId, fixture.publicKey]]);
    const expected = { evidenceKind: fixture.evidenceKind, expectedKeyId: fixture.keyId } as const;
    expectIntegrityCode(
      () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
        Buffer.alloc(FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_MAX_ENVELOPE_BYTES + 1, 0x20),
        keys,
        expected,
      ),
      ERROR.byteLimitExceeded,
    );
    expectIntegrityCode(
      () => verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
        Buffer.alloc(FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_MAX_ENVELOPE_BYTES, 0x20),
        keys,
        expected,
      ),
      ERROR.jsonSyntaxInvalid,
    );
  });
});
