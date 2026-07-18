import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { describe, expect, it } from "vitest";
import { FoundryIntegrityError } from "../errors.js";
import {
  FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_ERROR_CODES,
  FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_PROFILES,
  canonicalizeFoundryActivationV1Json,
  precheckFoundryActivationV1BootstrapEnvelopePairBytes,
  type FoundryActivationV1BootstrapPairSignerInput,
} from "../activation-v1-authenticated-evidence-bytes.js";

const ERROR = FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_ERROR_CODES;
const PROFILE = FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_PROFILES.bootstrap_ceremony;

interface DisposableSigner {
  readonly keyId: string;
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
}

function createSigner(keyId: string): DisposableSigner {
  const pair = generateKeyPairSync("ed25519");
  return Object.freeze({ keyId, privateKey: pair.privateKey, publicKey: pair.publicKey });
}

function preAuthenticationEncoding(payloadType: string, payloadBytes: Buffer): Buffer {
  const payloadTypeBytes = Buffer.from(payloadType, "utf8");
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${String(payloadTypeBytes.byteLength)} `, "ascii"),
    payloadTypeBytes,
    Buffer.from(` ${String(payloadBytes.byteLength)} `, "ascii"),
    payloadBytes,
  ]);
}

function canonicalPayload(marker: string): Buffer {
  return Buffer.from(canonicalizeFoundryActivationV1Json({
    authority: "none",
    schemaVersion: "wire-fixture-only",
    semanticInstallationManifest: "not-claimed",
    marker,
  }), "utf8");
}

function signedEnvelope(
  payloadBytes: Buffer,
  signer: DisposableSigner,
  payloadType: string = PROFILE.payloadType,
): Buffer {
  const signature = sign(
    null,
    preAuthenticationEncoding(payloadType, payloadBytes),
    signer.privateKey,
  );
  return Buffer.from(canonicalizeFoundryActivationV1Json({
    payload: payloadBytes.toString("base64"),
    payloadType,
    signatures: [{ keyid: signer.keyId, sig: signature.toString("base64") }],
  }), "utf8");
}

function rawPayloadSignedEnvelope(payloadBytes: Buffer, signer: DisposableSigner): Buffer {
  const signature = sign(null, payloadBytes, signer.privateKey);
  return Buffer.from(canonicalizeFoundryActivationV1Json({
    payload: payloadBytes.toString("base64"),
    payloadType: PROFILE.payloadType,
    signatures: [{ keyid: signer.keyId, sig: signature.toString("base64") }],
  }), "utf8");
}

function signerInput(signer: DisposableSigner): FoundryActivationV1BootstrapPairSignerInput {
  return { expectedKeyId: signer.keyId, publicKey: signer.publicKey };
}

function mutateSignatureBase64PadBits(envelopeBytes: Buffer): {
  readonly envelopeBytes: Buffer;
  readonly canonicalSignature: string;
  readonly noncanonicalSignature: string;
} {
  const envelopeText = envelopeBytes.toString("utf8");
  const signaturePrefix = '"sig":"';
  const signatureStart = envelopeText.lastIndexOf(signaturePrefix) + signaturePrefix.length;
  const signatureEnd = envelopeText.indexOf('"', signatureStart);
  if (signatureStart < signaturePrefix.length || signatureEnd < 0) {
    throw new Error("The fixture DSSE signature was not found.");
  }
  const canonicalSignature = envelopeText.slice(signatureStart, signatureEnd);
  if (!canonicalSignature.endsWith("==")) {
    throw new Error("The Ed25519 fixture signature does not expose four unused base64 pad bits.");
  }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const paddedCharacterOffset = canonicalSignature.length - 3;
  const canonicalAlphabetIndex = alphabet.indexOf(canonicalSignature[paddedCharacterOffset] ?? "");
  if (canonicalAlphabetIndex < 0 || (canonicalAlphabetIndex & 0x0f) !== 0) {
    throw new Error("The Ed25519 fixture signature is not canonical base64.");
  }
  const noncanonicalPadCharacter = alphabet[canonicalAlphabetIndex | 1];
  if (noncanonicalPadCharacter === undefined) throw new Error("The alternate base64 pad bits are unavailable.");
  const noncanonicalSignature = `${canonicalSignature.slice(0, paddedCharacterOffset)}${noncanonicalPadCharacter}==`;
  return Object.freeze({
    envelopeBytes: Buffer.from(
      `${envelopeText.slice(0, signatureStart)}${noncanonicalSignature}${envelopeText.slice(signatureEnd)}`,
      "utf8",
    ),
    canonicalSignature,
    noncanonicalSignature,
  });
}

function sha256Prefixed(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function expectIntegrityCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(FoundryIntegrityError);
    expect((error as FoundryIntegrityError).code).toBe(code);
  }
}

describe("Activation V1 bootstrap envelope-pair wire precheck", () => {
  it("verifies two signatures against distinct supplied public keys, requires one shared payload, and orders by unsigned ASCII", () => {
    const signerLower = createSigner("a-root");
    const signerUpper = createSigner("Z-root");
    const payloadBytes = canonicalPayload("shared-wire-payload");
    const lowerEnvelope = signedEnvelope(payloadBytes, signerLower);
    const upperEnvelope = signedEnvelope(payloadBytes, signerUpper);

    const result = precheckFoundryActivationV1BootstrapEnvelopePairBytes(
      lowerEnvelope,
      signerInput(signerLower),
      upperEnvelope,
      signerInput(signerUpper),
    );

    expect(result).toMatchObject({
      schemaVersion: "omnitwin.foundry.activation-v1-bootstrap-pair-wire-precheck.v0",
      authority: "none",
      validationScope: "bootstrap_pair_wire_precheck_only",
      ordering: "unsigned_ascii_key_id",
      rootBindingValidation: "not_performed",
      keyIdPublicKeyDigestBindingValidation: "not_performed",
      installationManifestByteEquality: "not_performed",
      installationManifestSemanticValidation: "not_performed",
      bootstrapVerificationReportValidation: "not_performed",
      oneTimeSentinelStateValidation: "not_performed",
      combinedBootstrapEvidenceDigest: "not_computed_specification_incomplete",
      databaseAdmission: "not_performed",
      sharedPayloadIdentity: {
        payloadType: PROFILE.payloadType,
        canonicalPayloadJson: payloadBytes.toString("utf8"),
        payloadByteLength: String(payloadBytes.byteLength),
        payloadSha256: createHash("sha256").update(payloadBytes).digest("hex"),
        perEnvelopePayloadReceiptSha256: sha256Prefixed(Buffer.concat([
          Buffer.from(`${PROFILE.domain}\n`, "utf8"),
          payloadBytes,
        ])),
      },
    });
    expect(result.sharedPayloadIdentity).not.toHaveProperty("receiptSha256");
    expect(result.orderedEnvelopeIdentities.map((identity) => identity.keyId)).toEqual([
      "Z-root",
      "a-root",
    ]);
    expect(result.orderedEnvelopeIdentities[0].signerPublicKeySha256).toBe(
      sha256Prefixed(signerUpper.publicKey.export({ format: "der", type: "spki" })),
    );
    expect(result.orderedEnvelopeIdentities[1].signerPublicKeySha256).toBe(
      sha256Prefixed(signerLower.publicKey.export({ format: "der", type: "spki" })),
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sharedPayloadIdentity)).toBe(true);
    expect(Object.isFrozen(result.orderedEnvelopeIdentities)).toBe(true);
    expect(result.orderedEnvelopeIdentities.every((identity) => Object.isFrozen(identity))).toBe(true);
    for (const forbiddenField of [
      "valid",
      "authenticated",
      "verified",
      "trusted",
      "rootAuthorized",
      "admitted",
      "signatureValid",
      "bootstrapEvidenceSha256",
      "bootstrapReceiptSha256",
      "releaseEligible",
    ]) {
      expect(result).not.toHaveProperty(forbiddenField);
    }
  });

  it("returns the same ordered identity when the A and B inputs are swapped", () => {
    const signerA = createSigner("root-b");
    const signerB = createSigner("root-a");
    const payloadBytes = canonicalPayload("swap-invariant");
    const envelopeA = signedEnvelope(payloadBytes, signerA);
    const envelopeB = signedEnvelope(payloadBytes, signerB);

    const forward = precheckFoundryActivationV1BootstrapEnvelopePairBytes(
      envelopeA,
      signerInput(signerA),
      envelopeB,
      signerInput(signerB),
    );
    const reverse = precheckFoundryActivationV1BootstrapEnvelopePairBytes(
      envelopeB,
      signerInput(signerB),
      envelopeA,
      signerInput(signerA),
    );
    expect(reverse).toEqual(forward);
  });

  it.each([
    ["a", "Z", ["Z", "a"]],
    ["_", "Z", ["Z", "_"]],
    ["a", "_", ["_", "a"]],
    ["aa", "a", ["a", "aa"]],
  ] as const)("orders key IDs %s and %s without locale collation", (keyIdA, keyIdB, expectedOrder) => {
    const signerA = createSigner(keyIdA);
    const signerB = createSigner(keyIdB);
    const payloadBytes = canonicalPayload("ascii-order");
    const result = precheckFoundryActivationV1BootstrapEnvelopePairBytes(
      signedEnvelope(payloadBytes, signerA),
      signerInput(signerA),
      signedEnvelope(payloadBytes, signerB),
      signerInput(signerB),
    );
    expect(result.orderedEnvelopeIdentities.map((identity) => identity.keyId)).toEqual(expectedOrder);
  });

  it("rejects same-length and Unicode-normalization payload differences", () => {
    const signerA = createSigner("root-a");
    const signerB = createSigner("root-b");
    const cases = [
      [canonicalPayload("alpha"), canonicalPayload("bravo")],
      [canonicalPayload("\u00e9"), canonicalPayload("e\u0301")],
    ] as const;
    for (const [payloadA, payloadB] of cases) {
      expectIntegrityCode(
        () => precheckFoundryActivationV1BootstrapEnvelopePairBytes(
          signedEnvelope(payloadA, signerA),
          signerInput(signerA),
          signedEnvelope(payloadB, signerB),
          signerInput(signerB),
        ),
        ERROR.bootstrapPairPayloadMismatch,
      );
    }
  });

  it("rejects one repeated key ID before inspecting either public key", () => {
    const signerA = createSigner("same-root-key-id");
    const signerB = createSigner("same-root-key-id");
    const payloadBytes = canonicalPayload("repeated-id");
    let exportInspectionCount = 0;
    const originalExport = signerA.publicKey.export.bind(signerA.publicKey);
    Object.defineProperty(signerA.publicKey, "export", {
      configurable: true,
      get(): typeof signerA.publicKey.export {
        exportInspectionCount += 1;
        return originalExport;
      },
    });

    expectIntegrityCode(
      () => precheckFoundryActivationV1BootstrapEnvelopePairBytes(
        signedEnvelope(payloadBytes, signerA),
        signerInput(signerA),
        signedEnvelope(payloadBytes, signerB),
        signerInput(signerB),
      ),
      ERROR.bootstrapPairKeyIdRepeated,
    );
    expect(exportInspectionCount).toBe(0);
  });

  it("rejects distinct KeyObjects containing the same Ed25519 material under two key IDs", () => {
    const pair = generateKeyPairSync("ed25519");
    const publicKeyClone = createPublicKey({
      key: pair.publicKey.export({ format: "der", type: "spki" }),
      format: "der",
      type: "spki",
    });
    expect(publicKeyClone).not.toBe(pair.publicKey);
    const signerA: DisposableSigner = {
      keyId: "root-a",
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
    };
    const signerB: DisposableSigner = {
      keyId: "root-b",
      privateKey: pair.privateKey,
      publicKey: publicKeyClone,
    };
    const payloadBytes = canonicalPayload("same-key-material");
    expectIntegrityCode(
      () => precheckFoundryActivationV1BootstrapEnvelopePairBytes(
        signedEnvelope(payloadBytes, signerA),
        signerInput(signerA),
        signedEnvelope(payloadBytes, signerB),
        signerInput(signerB),
      ),
      ERROR.bootstrapPairKeyMaterialRepeated,
    );
  });

  it.each(["A", "B"] as const)("rejects a wrong payload type on side %s", (side) => {
    const signerA = createSigner("root-a");
    const signerB = createSigner("root-b");
    const payloadBytes = canonicalPayload("wrong-type");
    const envelopeA = signedEnvelope(
      payloadBytes,
      signerA,
      side === "A"
        ? FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_PROFILES.runner_terminal.payloadType
        : PROFILE.payloadType,
    );
    const envelopeB = signedEnvelope(
      payloadBytes,
      signerB,
      side === "B"
        ? FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_PROFILES.runner_terminal.payloadType
        : PROFILE.payloadType,
    );
    expectIntegrityCode(
      () => precheckFoundryActivationV1BootstrapEnvelopePairBytes(
        envelopeA,
        signerInput(signerA),
        envelopeB,
        signerInput(signerB),
      ),
      ERROR.payloadTypeMismatch,
    );
  });

  it.each(["A", "B"] as const)("propagates invalid signatures on side %s", (side) => {
    const signerA = createSigner("root-a");
    const signerB = createSigner("root-b");
    const wrongSigner = createSigner("wrong-signature-source");
    const payloadBytes = canonicalPayload("invalid-signature");
    const envelopeA = signedEnvelope(payloadBytes, side === "A" ? wrongSigner : signerA);
    const envelopeB = signedEnvelope(payloadBytes, side === "B" ? wrongSigner : signerB);
    const reboundEnvelopeA = side === "A"
      ? Buffer.from(envelopeA.toString("utf8").replace(wrongSigner.keyId, signerA.keyId), "utf8")
      : envelopeA;
    const reboundEnvelopeB = side === "B"
      ? Buffer.from(envelopeB.toString("utf8").replace(wrongSigner.keyId, signerB.keyId), "utf8")
      : envelopeB;
    expectIntegrityCode(
      () => precheckFoundryActivationV1BootstrapEnvelopePairBytes(
        reboundEnvelopeA,
        signerInput(signerA),
        reboundEnvelopeB,
        signerInput(signerB),
      ),
      ERROR.signatureInvalid,
    );
  });

  it("ignores key-owned export accessors and rejects noncanonical bytes without invoking them", () => {
    const signerA = createSigner("root-a");
    const signerB = createSigner("root-b");
    const payloadBytes = canonicalPayload("original-payload");
    const envelopeA = signedEnvelope(payloadBytes, signerA);
    const envelopeB = signedEnvelope(payloadBytes, signerB);
    const signerBConfig: FoundryActivationV1BootstrapPairSignerInput = {
      expectedKeyId: signerB.keyId,
      publicKey: signerB.publicKey,
    };
    let shadowExportGetterCount = 0;
    let shadowTypeGetterCount = 0;
    Object.defineProperty(signerA.publicKey, "export", {
      configurable: true,
      get(): never {
        shadowExportGetterCount += 1;
        throw new Error("A key-owned export getter must never run.");
      },
    });
    Object.defineProperty(signerA.publicKey, "type", {
      configurable: true,
      get(): never {
        shadowTypeGetterCount += 1;
        throw new Error("A key-owned type getter must never run.");
      },
    });

    const result = precheckFoundryActivationV1BootstrapEnvelopePairBytes(
      envelopeA,
      signerInput(signerA),
      envelopeB,
      signerBConfig,
    );
    expect(result.sharedPayloadIdentity.canonicalPayloadJson).toBe(payloadBytes.toString("utf8"));
    expect(shadowExportGetterCount).toBe(0);
    expect(shadowTypeGetterCount).toBe(0);
    expect(signerBConfig.expectedKeyId).toBe(signerB.keyId);
    expectIntegrityCode(
      () => precheckFoundryActivationV1BootstrapEnvelopePairBytes(
        Buffer.concat([envelopeA, Buffer.from("\n")]),
        signerInput(signerA),
        envelopeB,
        signerBConfig,
      ),
      ERROR.jsonNotCanonical,
    );
    expect(shadowExportGetterCount).toBe(0);
    expect(shadowTypeGetterCount).toBe(0);
  });

  it("uses the module-captured native Map constructor after global Map substitution", () => {
    const signerA = createSigner("root-a");
    const signerB = createSigner("root-b");
    const attackerB = createSigner("root-b");
    const payloadBytes = canonicalPayload("captured-map-constructor");
    const envelopeA = signedEnvelope(payloadBytes, signerA);
    const attackerEnvelopeB = signedEnvelope(payloadBytes, attackerB);
    const nativeMapConstructor = globalThis.Map;
    const poisonedMapConstructor = function (
      entries?: Iterable<readonly [string, KeyObject]>,
    ): Map<string, KeyObject> {
      const copiedEntries = Array.from(entries ?? []);
      if (copiedEntries[0]?.[0] === signerB.keyId) {
        return new nativeMapConstructor([[signerB.keyId, attackerB.publicKey]]);
      }
      return new nativeMapConstructor(copiedEntries);
    };
    let caughtError: unknown;
    try {
      Reflect.set(globalThis, "Map", poisonedMapConstructor);
      precheckFoundryActivationV1BootstrapEnvelopePairBytes(
        envelopeA,
        signerInput(signerA),
        attackerEnvelopeB,
        signerInput(signerB),
      );
    } catch (error) {
      caughtError = error;
    } finally {
      Reflect.set(globalThis, "Map", nativeMapConstructor);
    }
    expect(caughtError).toBeInstanceOf(FoundryIntegrityError);
    expect((caughtError as FoundryIntegrityError).code).toBe(ERROR.signatureInvalid);
  });

  it("uses captured intrinsic Map insertion after Map.prototype.set substitution", () => {
    const signerA = createSigner("root-a");
    const signerB = createSigner("root-b");
    const attackerA = createSigner("root-a");
    const attackerB = createSigner("root-b");
    const payloadBytes = canonicalPayload("captured-map-insertion");
    const attackerEnvelopeA = signedEnvelope(payloadBytes, attackerA);
    const attackerEnvelopeB = signedEnvelope(payloadBytes, attackerB);
    const nativeMapSet: unknown = Reflect.get(Map.prototype, "set");
    if (typeof nativeMapSet !== "function") throw new Error("Native Map.set is unavailable.");
    const poisonedMapSet = function <K, V>(this: Map<K, V>, key: K, value: V): Map<K, V> {
      let replacement = value;
      if (key === signerA.keyId) replacement = attackerA.publicKey as V;
      if (key === signerB.keyId) replacement = attackerB.publicKey as V;
      return Reflect.apply(nativeMapSet, this, [key, replacement]) as Map<K, V>;
    };
    let caughtError: unknown;
    try {
      Reflect.set(Map.prototype, "set", poisonedMapSet);
      precheckFoundryActivationV1BootstrapEnvelopePairBytes(
        attackerEnvelopeA,
        signerInput(signerA),
        attackerEnvelopeB,
        signerInput(signerB),
      );
    } catch (error) {
      caughtError = error;
    } finally {
      Reflect.set(Map.prototype, "set", nativeMapSet);
    }
    expect(caughtError).toBeInstanceOf(FoundryIntegrityError);
    expect((caughtError as FoundryIntegrityError).code).toBe(ERROR.signatureInvalid);
  });

  it("uses intrinsic byte comparison after Buffer.prototype.equals substitution", () => {
    const signerA = createSigner("root-a");
    const signerB = createSigner("root-b");
    const payloadBytes = canonicalPayload("captured-buffer-equals");
    const noncanonicalEnvelopeA = Buffer.concat([
      signedEnvelope(payloadBytes, signerA),
      Buffer.from("\n", "utf8"),
    ]);
    const envelopeB = signedEnvelope(payloadBytes, signerB);
    const nativeBufferEquals: unknown = Reflect.get(Buffer.prototype, "equals");
    if (typeof nativeBufferEquals !== "function") throw new Error("Native Buffer.equals is unavailable.");
    let caughtError: unknown;
    try {
      Reflect.set(Buffer.prototype, "equals", (): boolean => true);
      precheckFoundryActivationV1BootstrapEnvelopePairBytes(
        noncanonicalEnvelopeA,
        signerInput(signerA),
        envelopeB,
        signerInput(signerB),
      );
    } catch (error) {
      caughtError = error;
    } finally {
      Reflect.set(Buffer.prototype, "equals", nativeBufferEquals);
    }
    expect(caughtError).toBeInstanceOf(FoundryIntegrityError);
    expect((caughtError as FoundryIntegrityError).code).toBe(ERROR.jsonNotCanonical);
  });

  it("uses intrinsic base64 re-encoding after Buffer.prototype.toString substitution", () => {
    const signerA = createSigner("root-a");
    const signerB = createSigner("root-b");
    const payloadBytes = canonicalPayload("captured-buffer-to-string");
    const mutated = mutateSignatureBase64PadBits(signedEnvelope(payloadBytes, signerA));
    const envelopeB = signedEnvelope(payloadBytes, signerB);
    expect(Buffer.from(mutated.noncanonicalSignature, "base64")).toEqual(
      Buffer.from(mutated.canonicalSignature, "base64"),
    );
    const nativeBufferToString: unknown = Reflect.get(Buffer.prototype, "toString");
    if (typeof nativeBufferToString !== "function") throw new Error("Native Buffer.toString is unavailable.");
    const poisonedBufferToString = function (this: Buffer, ...arguments_: unknown[]): string {
      const canonical = Reflect.apply(nativeBufferToString, this, arguments_) as string;
      return arguments_[0] === "base64" && canonical === mutated.canonicalSignature
        ? mutated.noncanonicalSignature
        : canonical;
    };
    let caughtError: unknown;
    try {
      Reflect.set(Buffer.prototype, "toString", poisonedBufferToString);
      precheckFoundryActivationV1BootstrapEnvelopePairBytes(
        mutated.envelopeBytes,
        signerInput(signerA),
        envelopeB,
        signerInput(signerB),
      );
    } catch (error) {
      caughtError = error;
    } finally {
      Reflect.set(Buffer.prototype, "toString", nativeBufferToString);
    }
    expect(caughtError).toBeInstanceOf(FoundryIntegrityError);
    expect((caughtError as FoundryIntegrityError).code).toBe(ERROR.base64Invalid);
  });

  it("uses module-captured Buffer statics after ambient substitution", () => {
    const signerA = createSigner("root-a");
    const signerB = createSigner("root-b");
    const payloadBytes = canonicalPayload("captured-buffer-statics-and-length");
    const envelopeA = signedEnvelope(payloadBytes, signerA);
    const envelopeB = signedEnvelope(payloadBytes, signerB);
    const nativeBufferFrom: unknown = Reflect.get(Buffer, "from");
    const nativeBufferAlloc: unknown = Reflect.get(Buffer, "alloc");
    const nativeBufferAllocUnsafe: unknown = Reflect.get(Buffer, "allocUnsafe");
    const nativeBufferConcat: unknown = Reflect.get(Buffer, "concat");
    const poison = (): never => {
      throw new Error("A substituted ambient Buffer static must never run.");
    };
    let result: ReturnType<typeof precheckFoundryActivationV1BootstrapEnvelopePairBytes> | undefined;
    let caughtError: unknown;
    try {
      Reflect.set(Buffer, "from", poison);
      Reflect.set(Buffer, "alloc", poison);
      Reflect.set(Buffer, "allocUnsafe", poison);
      Reflect.set(Buffer, "concat", poison);
      result = precheckFoundryActivationV1BootstrapEnvelopePairBytes(
        envelopeA,
        signerInput(signerA),
        envelopeB,
        signerInput(signerB),
      );
    } catch (error) {
      caughtError = error;
    } finally {
      Reflect.set(Buffer, "from", nativeBufferFrom);
      Reflect.set(Buffer, "alloc", nativeBufferAlloc);
      Reflect.set(Buffer, "allocUnsafe", nativeBufferAllocUnsafe);
      Reflect.set(Buffer, "concat", nativeBufferConcat);
    }
    expect(caughtError).toBeUndefined();
    expect(result?.sharedPayloadIdentity.payloadByteLength).toBe(String(payloadBytes.byteLength));
  });

  it("does not consume a substituted array iterator while constructing DSSE PAE", () => {
    const signerA = createSigner("root-a");
    const signerB = createSigner("root-b");
    const payloadBytes = canonicalPayload("iterator-pae-bypass");
    const rawPayloadEnvelopeA = rawPayloadSignedEnvelope(payloadBytes, signerA);
    const rawPayloadEnvelopeB = rawPayloadSignedEnvelope(payloadBytes, signerB);
    const nativeArrayIteratorDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      Symbol.iterator,
    );
    if (nativeArrayIteratorDescriptor === undefined) throw new Error("Native array iteration is unavailable.");
    const poisonedArrayIterator = function* (this: unknown[]): Generator {
      if (
        this.length === 4 &&
        this[0] instanceof Uint8Array &&
        this[1] instanceof Uint8Array &&
        this[2] instanceof Uint8Array &&
        this[3] instanceof Uint8Array
      ) {
        yield this[3];
        return;
      }
      for (let index = 0; index < this.length; index += 1) yield this[index];
    };
    let caughtError: unknown;
    try {
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        writable: true,
        value: poisonedArrayIterator,
      });
      precheckFoundryActivationV1BootstrapEnvelopePairBytes(
        rawPayloadEnvelopeA,
        signerInput(signerA),
        rawPayloadEnvelopeB,
        signerInput(signerB),
      );
    } catch (error) {
      caughtError = error;
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, nativeArrayIteratorDescriptor);
    }
    expect(caughtError).toBeInstanceOf(FoundryIntegrityError);
    expect((caughtError as FoundryIntegrityError).code).toBe(ERROR.signatureInvalid);
  });

  it("does not consume a substituted array iterator while domain-hashing byte members", () => {
    const signerA = createSigner("root-a");
    const signerB = createSigner("root-b");
    const payloadBytes = canonicalPayload("iterator-domain-hash");
    const envelopeA = signedEnvelope(payloadBytes, signerA);
    const envelopeB = signedEnvelope(payloadBytes, signerB);
    const expectedReceipt = sha256Prefixed(Buffer.concat([
      Buffer.from(`${PROFILE.domain}\n`, "utf8"),
      payloadBytes,
    ]));
    const expectedEnvelopeASha256 = sha256Prefixed(Buffer.concat([
      Buffer.from(`${PROFILE.domain}.dsse-envelope\n`, "utf8"),
      envelopeA,
    ]));
    const nativeArrayIteratorDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      Symbol.iterator,
    );
    if (nativeArrayIteratorDescriptor === undefined) throw new Error("Native array iteration is unavailable.");
    const poisonedArrayIterator = function* (this: unknown[]): Generator {
      if (
        this.length === 2 &&
        this[0] instanceof Uint8Array &&
        this[1] instanceof Uint8Array
      ) {
        yield this[1];
        return;
      }
      for (let index = 0; index < this.length; index += 1) yield this[index];
    };
    let result: ReturnType<typeof precheckFoundryActivationV1BootstrapEnvelopePairBytes> | undefined;
    let caughtError: unknown;
    try {
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        writable: true,
        value: poisonedArrayIterator,
      });
      result = precheckFoundryActivationV1BootstrapEnvelopePairBytes(
        envelopeA,
        signerInput(signerA),
        envelopeB,
        signerInput(signerB),
      );
    } catch (error) {
      caughtError = error;
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, nativeArrayIteratorDescriptor);
    }
    expect(caughtError).toBeUndefined();
    expect(result?.sharedPayloadIdentity.perEnvelopePayloadReceiptSha256).toBe(expectedReceipt);
    const identityA = result?.orderedEnvelopeIdentities.find((identity) => identity.keyId === signerA.keyId);
    expect(identityA?.envelopeSha256).toBe(expectedEnvelopeASha256);
  });

  it("rejects proxy, accessor, extra-member, and non-plain signer configs", () => {
    const signerA = createSigner("root-a");
    const signerB = createSigner("root-b");
    const payloadBytes = canonicalPayload("invalid-config");
    const envelopeA = signedEnvelope(payloadBytes, signerA);
    const envelopeB = signedEnvelope(payloadBytes, signerB);
    const invalidConfigs: unknown[] = [
      new Proxy(signerInput(signerA), {}),
      {
        get expectedKeyId(): string {
          return signerA.keyId;
        },
        publicKey: signerA.publicKey,
      },
      { ...signerInput(signerA), extra: "forbidden" },
      Object.assign(Object.create({ inherited: true }) as object, signerInput(signerA)),
      Object.assign(signerInput(signerA), { [Symbol("extra")]: true }),
    ];
    for (const invalidConfig of invalidConfigs) {
      expectIntegrityCode(
        () => Reflect.apply(precheckFoundryActivationV1BootstrapEnvelopePairBytes, undefined, [
          envelopeA,
          invalidConfig,
          envelopeB,
          signerInput(signerB),
        ]),
        ERROR.bootstrapPairInputShapeInvalid,
      );
    }
  });

  it("rejects wider typed arrays and SharedArrayBuffer-backed envelopes", () => {
    const signerA = createSigner("root-a");
    const signerB = createSigner("root-b");
    const payloadBytes = canonicalPayload("byte-branding");
    const envelopeA = signedEnvelope(payloadBytes, signerA);
    const envelopeB = signedEnvelope(payloadBytes, signerB);
    expectIntegrityCode(
      () => Reflect.apply(precheckFoundryActivationV1BootstrapEnvelopePairBytes, undefined, [
        new Uint16Array(envelopeA.buffer, envelopeA.byteOffset, Math.floor(envelopeA.byteLength / 2)),
        signerInput(signerA),
        envelopeB,
        signerInput(signerB),
      ]),
      ERROR.bytesRequired,
    );

    for (const side of ["A", "B"] as const) {
      const sharedEnvelope = side === "A" ? envelopeA : envelopeB;
      const sharedBuffer = new SharedArrayBuffer(sharedEnvelope.byteLength);
      const sharedView = new Uint8Array(sharedBuffer);
      sharedView.set(sharedEnvelope);
      expectIntegrityCode(
        () => precheckFoundryActivationV1BootstrapEnvelopePairBytes(
          side === "A" ? sharedView : envelopeA,
          signerInput(signerA),
          side === "B" ? sharedView : envelopeB,
          signerInput(signerB),
        ),
        ERROR.bootstrapPairSharedBackingRejected,
      );
    }
  });
});
