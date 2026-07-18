import { createHash, createPublicKey, KeyObject, verify as verifySignature } from "node:crypto";
import { types as nodeUtilTypes } from "node:util";
import { FoundryIntegrityError } from "./errors.js";

export const FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_MAX_ENVELOPE_BYTES = 1024 * 1024;
export const FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_MAX_PAYLOAD_BYTES = 512 * 1024;
export const FOUNDRY_ACTIVATION_V1_JSON_MAX_DEPTH = 128;

export const FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_PROFILES = Object.freeze({
  bootstrap_ceremony: Object.freeze({
    domain: "omnitwin.foundry.derivative-bootstrap-ceremony.v1",
    payloadType: "application/vnd.omnitwin.foundry.derivative-bootstrap-ceremony.v1+json",
  }),
  admin_action: Object.freeze({
    domain: "omnitwin.foundry.derivative-admin-action.v1",
    payloadType: "application/vnd.omnitwin.foundry.derivative-admin-action.v1+json",
  }),
  predecessor_source: Object.freeze({
    domain: "omnitwin.foundry.derivative-predecessor-source.v1",
    payloadType: "application/vnd.omnitwin.foundry.derivative-predecessor-source.v1+json",
  }),
  gateway_token_commitment: Object.freeze({
    domain: "omnitwin.foundry.derivative-gateway-token-commitment.v1",
    payloadType: "application/vnd.omnitwin.foundry.derivative-gateway-token-commitment.v1+json",
  }),
  runner_terminal: Object.freeze({
    domain: "omnitwin.foundry.derivative-runner-terminal-receipt.v1",
    payloadType: "application/vnd.omnitwin.foundry.derivative-runner-terminal-receipt.v1+json",
  }),
  provider_result: Object.freeze({
    domain: "omnitwin.foundry.derivative-provider-result-evidence.v1",
    payloadType: "application/vnd.omnitwin.foundry.derivative-provider-result-evidence.v1+json",
  }),
  storage_create: Object.freeze({
    domain: "omnitwin.foundry.derivative-storage-create.v1",
    payloadType: "application/vnd.omnitwin.foundry.derivative-storage-create.v1+json",
  }),
  storage_read: Object.freeze({
    domain: "omnitwin.foundry.derivative-storage-read.v1",
    payloadType: "application/vnd.omnitwin.foundry.derivative-storage-read.v1+json",
  }),
  glb_verifier: Object.freeze({
    domain: "omnitwin.foundry.derivative-glb-verifier-receipt.v1",
    payloadType: "application/vnd.omnitwin.foundry.derivative-glb-verifier-receipt.v1+json",
  }),
} as const);

export type FoundryActivationV1SignedEvidenceKind =
  keyof typeof FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_PROFILES;

export const FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_ERROR_CODES = Object.freeze({
  bytesRequired: "FOUNDRY_ACTIVATION_V1_BYTES_REQUIRED",
  byteLimitInvalid: "FOUNDRY_ACTIVATION_V1_BYTE_LIMIT_INVALID",
  byteLimitExceeded: "FOUNDRY_ACTIVATION_V1_BYTE_LIMIT_EXCEEDED",
  utf8BomForbidden: "FOUNDRY_ACTIVATION_V1_UTF8_BOM_FORBIDDEN",
  utf8Invalid: "FOUNDRY_ACTIVATION_V1_UTF8_INVALID",
  jsonSyntaxInvalid: "FOUNDRY_ACTIVATION_V1_JSON_SYNTAX_INVALID",
  jsonDuplicateKey: "FOUNDRY_ACTIVATION_V1_JSON_DUPLICATE_KEY",
  jsonNumberForbidden: "FOUNDRY_ACTIVATION_V1_JSON_NUMBER_FORBIDDEN",
  jsonKeyNotAscii: "FOUNDRY_ACTIVATION_V1_JSON_KEY_NOT_ASCII",
  jsonStringNotScalar: "FOUNDRY_ACTIVATION_V1_JSON_STRING_NOT_UNICODE_SCALAR",
  jsonValueUnsupported: "FOUNDRY_ACTIVATION_V1_JSON_VALUE_UNSUPPORTED",
  jsonCycle: "FOUNDRY_ACTIVATION_V1_JSON_CYCLE",
  jsonDepthExceeded: "FOUNDRY_ACTIVATION_V1_JSON_DEPTH_EXCEEDED",
  jsonNotCanonical: "FOUNDRY_ACTIVATION_V1_JSON_NOT_CANONICAL",
  evidenceKindInvalid: "FOUNDRY_ACTIVATION_V1_EVIDENCE_KIND_INVALID",
  envelopeShapeInvalid: "FOUNDRY_ACTIVATION_V1_ENVELOPE_SHAPE_INVALID",
  payloadTypeMismatch: "FOUNDRY_ACTIVATION_V1_PAYLOAD_TYPE_MISMATCH",
  profileBindingMismatch: "FOUNDRY_ACTIVATION_V1_PROFILE_BINDING_MISMATCH",
  base64Invalid: "FOUNDRY_ACTIVATION_V1_BASE64_INVALID",
  signatureLengthInvalid: "FOUNDRY_ACTIVATION_V1_SIGNATURE_LENGTH_INVALID",
  keyIdInvalid: "FOUNDRY_ACTIVATION_V1_KEY_ID_INVALID",
  keyIdMismatch: "FOUNDRY_ACTIVATION_V1_KEY_ID_MISMATCH",
  publicKeyMapInvalid: "FOUNDRY_ACTIVATION_V1_PUBLIC_KEY_MAP_INVALID",
  publicKeyMissing: "FOUNDRY_ACTIVATION_V1_PUBLIC_KEY_MISSING",
  privateKeyRejected: "FOUNDRY_ACTIVATION_V1_PRIVATE_KEY_REJECTED",
  keyTypeInvalid: "FOUNDRY_ACTIVATION_V1_KEY_TYPE_INVALID",
  signatureInvalid: "FOUNDRY_ACTIVATION_V1_SIGNATURE_INVALID",
  bootstrapPairInputShapeInvalid: "FOUNDRY_ACTIVATION_V1_BOOTSTRAP_PAIR_INPUT_SHAPE_INVALID",
  bootstrapPairSharedBackingRejected: "FOUNDRY_ACTIVATION_V1_BOOTSTRAP_PAIR_SHARED_BACKING_REJECTED",
  bootstrapPairKeyIdRepeated: "FOUNDRY_ACTIVATION_V1_BOOTSTRAP_PAIR_KEY_ID_REPEATED",
  bootstrapPairKeyMaterialRepeated: "FOUNDRY_ACTIVATION_V1_BOOTSTRAP_PAIR_KEY_MATERIAL_REPEATED",
  bootstrapPairPayloadMismatch: "FOUNDRY_ACTIVATION_V1_BOOTSTRAP_PAIR_PAYLOAD_MISMATCH",
} as const);

export type FoundryActivationV1SignedEvidenceErrorCode =
  (typeof FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_ERROR_CODES)[keyof typeof FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_ERROR_CODES];

export type FoundryActivationV1JsonValue =
  | null
  | boolean
  | string
  | readonly FoundryActivationV1JsonValue[]
  | { readonly [key: string]: FoundryActivationV1JsonValue };

export interface FoundryActivationV1CanonicalJsonParseResult {
  readonly canonicalJson: string;
  readonly value: FoundryActivationV1JsonValue;
}

export interface FoundryActivationV1SignedEvidenceIdentity {
  readonly evidenceKind: FoundryActivationV1SignedEvidenceKind;
  readonly domain: string;
  readonly payloadType: string;
  readonly keyId: string;
  readonly signerPublicKeySha256: string;
  readonly canonicalPayloadJson: string;
  readonly canonicalEnvelopeJson: string;
  readonly payloadByteLength: string;
  readonly envelopeByteLength: string;
  readonly payloadSha256: string;
  readonly receiptSha256: string;
  readonly envelopeSha256: string;
}

export interface FoundryActivationV1BootstrapPairSharedPayloadIdentity {
  readonly payloadType: string;
  readonly canonicalPayloadJson: string;
  readonly payloadByteLength: string;
  readonly payloadSha256: string;
  readonly perEnvelopePayloadReceiptSha256: string;
}

export interface FoundryActivationV1BootstrapPairWirePrecheck {
  readonly schemaVersion: "omnitwin.foundry.activation-v1-bootstrap-pair-wire-precheck.v0";
  readonly authority: "none";
  readonly validationScope: "bootstrap_pair_wire_precheck_only";
  readonly ordering: "unsigned_ascii_key_id";
  readonly rootBindingValidation: "not_performed";
  readonly keyIdPublicKeyDigestBindingValidation: "not_performed";
  readonly installationManifestByteEquality: "not_performed";
  readonly installationManifestSemanticValidation: "not_performed";
  readonly bootstrapVerificationReportValidation: "not_performed";
  readonly oneTimeSentinelStateValidation: "not_performed";
  readonly combinedBootstrapEvidenceDigest: "not_computed_specification_incomplete";
  readonly databaseAdmission: "not_performed";
  readonly sharedPayloadIdentity: FoundryActivationV1BootstrapPairSharedPayloadIdentity;
  readonly orderedEnvelopeIdentities: readonly [
    FoundryActivationV1SignedEvidenceIdentity,
    FoundryActivationV1SignedEvidenceIdentity,
  ];
}

export interface FoundryActivationV1BootstrapPairSignerInput {
  readonly expectedKeyId: string;
  readonly publicKey: KeyObject;
}

const ERROR = FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_ERROR_CODES;
const NATIVE_BUFFER = Buffer;
const INTRINSIC_BUFFER_FROM = (() => {
  const from: unknown = Reflect.get(NATIVE_BUFFER, "from");
  if (typeof from !== "function") throw new Error("The Node.js runtime does not expose intrinsic Buffer creation.");
  return (input: string | readonly number[] | Uint8Array, encoding?: BufferEncoding): Buffer => Reflect.apply(
    from,
    NATIVE_BUFFER,
    encoding === undefined ? [input] : [input, encoding],
  ) as Buffer;
})();
const INTRINSIC_BUFFER_ALLOC = (() => {
  const alloc: unknown = Reflect.get(NATIVE_BUFFER, "alloc");
  if (typeof alloc !== "function") throw new Error("The Node.js runtime does not expose intrinsic zeroed Buffer allocation.");
  return (size: number): Buffer => Reflect.apply(alloc, NATIVE_BUFFER, [size]) as Buffer;
})();
const INTRINSIC_BUFFER_ALLOC_UNSAFE = (() => {
  const allocUnsafe: unknown = Reflect.get(NATIVE_BUFFER, "allocUnsafe");
  if (typeof allocUnsafe !== "function") throw new Error("The Node.js runtime does not expose intrinsic Buffer allocation.");
  return (size: number): Buffer => Reflect.apply(allocUnsafe, NATIVE_BUFFER, [size]) as Buffer;
})();
const INTRINSIC_BUFFER_TO_STRING = (() => {
  const toString: unknown = Reflect.get(NATIVE_BUFFER.prototype, "toString");
  if (typeof toString !== "function") throw new Error("The Node.js runtime does not expose intrinsic Buffer encoding.");
  return (input: Buffer, encoding: BufferEncoding): string => Reflect.apply(toString, input, [encoding]) as string;
})();
const UTF8_BOM = INTRINSIC_BUFFER_FROM([0xef, 0xbb, 0xbf]);
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const INTRINSIC_TYPED_ARRAY_TAG = (() => {
  const descriptor = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, Symbol.toStringTag);
  const getter: unknown = descriptor === undefined ? undefined : Reflect.get(descriptor, "get");
  if (typeof getter !== "function") {
    throw new Error("The JavaScript runtime does not expose intrinsic typed-array branding.");
  }
  return (input: Uint8Array): unknown => Reflect.apply(getter, input, []);
})();
const INTRINSIC_TYPED_ARRAY_BYTE_LENGTH = (() => {
  const descriptor = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength");
  const getter: unknown = descriptor === undefined ? undefined : Reflect.get(descriptor, "get");
  if (typeof getter !== "function") {
    throw new Error("The JavaScript runtime does not expose intrinsic typed-array byte length.");
  }
  return (input: Uint8Array): number => Reflect.apply(getter, input, []) as number;
})();
const INTRINSIC_TYPED_ARRAY_BUFFER = (() => {
  const descriptor = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer");
  const getter: unknown = descriptor === undefined ? undefined : Reflect.get(descriptor, "get");
  if (typeof getter !== "function") {
    throw new Error("The JavaScript runtime does not expose intrinsic typed-array backing buffers.");
  }
  return (input: Uint8Array): ArrayBufferLike => Reflect.apply(getter, input, []) as ArrayBufferLike;
})();
const INTRINSIC_TYPED_ARRAY_SET = (() => {
  const set: unknown = Reflect.get(Uint8Array.prototype, "set");
  if (typeof set !== "function") throw new Error("The JavaScript runtime does not expose intrinsic typed-array set.");
  return (target: Uint8Array, source: Uint8Array, offset: number = 0): void => {
    Reflect.apply(set, target, [source, offset]);
  };
})();
const INTRINSIC_BUFFER_CONCAT = (members: readonly Uint8Array[]): Buffer => {
  let totalByteLength = 0;
  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    if (member === undefined) throw new TypeError("Intrinsic Buffer concatenation requires dense byte members.");
    totalByteLength += INTRINSIC_TYPED_ARRAY_BYTE_LENGTH(member);
    if (!Number.isSafeInteger(totalByteLength)) {
      throw new RangeError("The intrinsic Buffer concatenation length is not a safe integer.");
    }
  }
  const result = INTRINSIC_BUFFER_ALLOC_UNSAFE(totalByteLength);
  let offset = 0;
  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    if (member === undefined) throw new TypeError("Intrinsic Buffer concatenation requires dense byte members.");
    INTRINSIC_TYPED_ARRAY_SET(result, member, offset);
    offset += INTRINSIC_TYPED_ARRAY_BYTE_LENGTH(member);
  }
  return result;
};
const INTRINSIC_KEY_OBJECT_TYPE = (() => {
  const descriptor = Object.getOwnPropertyDescriptor(KeyObject.prototype, "type");
  const getter: unknown = descriptor === undefined ? undefined : Reflect.get(descriptor, "get");
  if (typeof getter !== "function") throw new Error("The Node.js runtime does not expose intrinsic KeyObject type.");
  return (key: KeyObject): unknown => Reflect.apply(getter, key, []);
})();
const NATIVE_IS_KEY_OBJECT = (() => {
  const check: unknown = Reflect.get(nodeUtilTypes, "isKeyObject");
  if (typeof check !== "function") throw new Error("The Node.js runtime does not expose native KeyObject branding.");
  return (input: unknown): boolean => Reflect.apply(check, nodeUtilTypes, [input]) as boolean;
})();
const NATIVE_IS_PROXY = (() => {
  const check: unknown = Reflect.get(nodeUtilTypes, "isProxy");
  if (typeof check !== "function") throw new Error("The Node.js runtime does not expose native proxy detection.");
  return (input: unknown): boolean => Reflect.apply(check, nodeUtilTypes, [input]) as boolean;
})();
const NATIVE_IS_SHARED_ARRAY_BUFFER = (() => {
  const check: unknown = Reflect.get(nodeUtilTypes, "isSharedArrayBuffer");
  if (typeof check !== "function") throw new Error("The Node.js runtime does not expose native SharedArrayBuffer branding.");
  return (input: unknown): boolean => Reflect.apply(check, nodeUtilTypes, [input]) as boolean;
})();
const ED25519_SPKI_DER_PREFIX = INTRINSIC_BUFFER_FROM("302a300506032b6570032100", "hex");
const ED25519_SPKI_DER_BYTE_LENGTH = 44;
const NATIVE_MAP = Map;
const NATIVE_SET = Set;
const INTRINSIC_MAP_GET = (() => {
  const get: unknown = Reflect.get(Map.prototype, "get");
  if (typeof get !== "function") throw new Error("The JavaScript runtime does not expose intrinsic Map lookup.");
  return (map: object, key: string): unknown => Reflect.apply(get, map, [key]);
})();
const INTRINSIC_MAP_SET = (() => {
  const set: unknown = Reflect.get(Map.prototype, "set");
  if (typeof set !== "function") throw new Error("The JavaScript runtime does not expose intrinsic Map insertion.");
  return (map: Map<string, KeyObject>, key: string, value: KeyObject): void => {
    Reflect.apply(set, map, [key, value]);
  };
})();
const INTRINSIC_SET_ADD = (() => {
  const add: unknown = Reflect.get(Set.prototype, "add");
  if (typeof add !== "function") throw new Error("The JavaScript runtime does not expose intrinsic Set insertion.");
  return <Value>(set: Set<Value>, value: Value): void => {
    Reflect.apply(add, set, [value]);
  };
})();
const INTRINSIC_SET_HAS = (() => {
  const has: unknown = Reflect.get(Set.prototype, "has");
  if (typeof has !== "function") throw new Error("The JavaScript runtime does not expose intrinsic Set lookup.");
  return <Value>(set: Set<Value>, value: Value): boolean => Reflect.apply(has, set, [value]) as boolean;
})();
const INTRINSIC_SET_DELETE = (() => {
  const deleteMember: unknown = Reflect.get(Set.prototype, "delete");
  if (typeof deleteMember !== "function") throw new Error("The JavaScript runtime does not expose intrinsic Set deletion.");
  return <Value>(set: Set<Value>, value: Value): void => {
    Reflect.apply(deleteMember, set, [value]);
  };
})();
const INTRINSIC_PUBLIC_KEY_EXPORT = (() => {
  const sentinelSpki = INTRINSIC_BUFFER_CONCAT([ED25519_SPKI_DER_PREFIX, INTRINSIC_BUFFER_ALLOC(32)]);
  const sentinelPublicKey = createPublicKey({ key: sentinelSpki, format: "der", type: "spki" });
  const publicKeyPrototype: unknown = Object.getPrototypeOf(sentinelPublicKey);
  if (publicKeyPrototype === null || typeof publicKeyPrototype !== "object") {
    throw new Error("The Node.js runtime does not expose the native public-key prototype.");
  }
  const descriptor = Object.getOwnPropertyDescriptor(publicKeyPrototype, "export");
  const exportMethod: unknown = descriptor === undefined ? undefined : Reflect.get(descriptor, "value");
  if (typeof exportMethod !== "function") {
    throw new Error("The Node.js runtime does not expose intrinsic public-key export.");
  }
  return (key: KeyObject): unknown => Reflect.apply(exportMethod, key, [{ format: "der", type: "spki" }]);
})();

function byteArraysEqual(left: Uint8Array, right: Uint8Array): boolean {
  const leftByteLength = INTRINSIC_TYPED_ARRAY_BYTE_LENGTH(left);
  if (leftByteLength !== INTRINSIC_TYPED_ARRAY_BYTE_LENGTH(right)) return false;
  for (let index = 0; index < leftByteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function beginsWithBytes(input: Uint8Array, prefix: Uint8Array): boolean {
  const inputByteLength = INTRINSIC_TYPED_ARRAY_BYTE_LENGTH(input);
  const prefixByteLength = INTRINSIC_TYPED_ARRAY_BYTE_LENGTH(prefix);
  if (inputByteLength < prefixByteLength) return false;
  for (let index = 0; index < prefixByteLength; index += 1) {
    if (input[index] !== prefix[index]) return false;
  }
  return true;
}

function fail(code: FoundryActivationV1SignedEvidenceErrorCode, message: string, options?: ErrorOptions): never {
  throw new FoundryIntegrityError(code, message, options);
}

function hasOnlyUnicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function assertUnicodeScalarString(value: string): void {
  if (!hasOnlyUnicodeScalars(value)) {
    fail(ERROR.jsonStringNotScalar, "Foundry activation V1 JSON strings must contain only Unicode scalar values.");
  }
}

function assertAsciiKey(key: string): void {
  for (let index = 0; index < key.length; index += 1) {
    if (key.charCodeAt(index) > 0x7f) {
      fail(ERROR.jsonKeyNotAscii, "Foundry activation V1 JSON object keys must contain only ASCII characters.");
    }
  }
}

function compareUnsignedAscii(left: string, right: string): number {
  const commonLength = Math.min(left.length, right.length);
  for (let index = 0; index < commonLength; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function quotedJsonString(value: string): string {
  assertUnicodeScalarString(value);
  return JSON.stringify(value);
}

function canonicalizeValue(value: unknown, ancestors: Set<object>, depth: number): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return quotedJsonString(value);
  if (typeof value === "number") {
    fail(ERROR.jsonNumberForbidden, "Foundry activation V1 canonical JSON forbids every JSON numeric leaf.");
  }
  if (typeof value !== "object") {
    fail(ERROR.jsonValueUnsupported, `Foundry activation V1 canonical JSON does not support ${typeof value} values.`);
  }
  if (depth >= FOUNDRY_ACTIVATION_V1_JSON_MAX_DEPTH) {
    fail(
      ERROR.jsonDepthExceeded,
      `Foundry activation V1 canonical JSON exceeds its ${String(FOUNDRY_ACTIVATION_V1_JSON_MAX_DEPTH)}-container nesting limit.`,
    );
  }
  if (INTRINSIC_SET_HAS(ancestors, value)) {
    fail(ERROR.jsonCycle, "Foundry activation V1 canonical JSON cannot contain a cyclic value.");
  }

  INTRINSIC_SET_ADD(ancestors, value);
  try {
    if (Array.isArray(value)) {
      const members: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !("value" in descriptor)) {
          fail(ERROR.jsonValueUnsupported, "Foundry activation V1 canonical JSON arrays must be dense data arrays.");
        }
        members[index] = canonicalizeValue(descriptor.value, ancestors, depth + 1);
      }
      const allowedKeys = new NATIVE_SET<string>();
      INTRINSIC_SET_ADD(allowedKeys, "length");
      for (let index = 0; index < value.length; index += 1) INTRINSIC_SET_ADD(allowedKeys, String(index));
      const arrayKeys = Reflect.ownKeys(value);
      for (let index = 0; index < arrayKeys.length; index += 1) {
        const key = arrayKeys[index];
        if (typeof key !== "string" || !INTRINSIC_SET_HAS(allowedKeys, key)) {
          fail(ERROR.jsonValueUnsupported, "Foundry activation V1 canonical JSON arrays cannot have additional properties.");
        }
      }
      let output = "[";
      for (let index = 0; index < members.length; index += 1) {
        if (index > 0) output += ",";
        output += members[index] ?? "";
      }
      return `${output}]`;
    }

    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) {
      fail(ERROR.jsonValueUnsupported, "Foundry activation V1 canonical JSON objects must be plain data objects.");
    }
    const entries: Array<readonly [string, unknown]> = [];
    const objectKeys = Reflect.ownKeys(value);
    for (let index = 0; index < objectKeys.length; index += 1) {
      const key = objectKeys[index];
      if (typeof key !== "string") {
        fail(ERROR.jsonValueUnsupported, "Foundry activation V1 canonical JSON objects cannot have symbol keys.");
      }
      assertAsciiKey(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
        fail(ERROR.jsonValueUnsupported, "Foundry activation V1 canonical JSON objects must contain enumerable data members only.");
      }
      entries[entries.length] = [key, descriptor.value];
    }
    for (let index = 1; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry === undefined) throw new Error("Canonical JSON entry sorting encountered a sparse array.");
      let insertionIndex = index;
      while (insertionIndex > 0) {
        const previous = entries[insertionIndex - 1];
        if (previous === undefined || compareUnsignedAscii(previous[0], entry[0]) <= 0) break;
        entries[insertionIndex] = previous;
        insertionIndex -= 1;
      }
      entries[insertionIndex] = entry;
    }
    let output = "{";
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry === undefined) throw new Error("Canonical JSON entry rendering encountered a sparse array.");
      if (index > 0) output += ",";
      output += `${quotedJsonString(entry[0])}:${canonicalizeValue(entry[1], ancestors, depth + 1)}`;
    }
    return `${output}}`;
  } finally {
    INTRINSIC_SET_DELETE(ancestors, value);
  }
}

export function canonicalizeFoundryActivationV1Json(input: unknown): string {
  return canonicalizeValue(input, new NATIVE_SET<object>(), 0);
}

class DuplicateAwareJsonParser {
  readonly #text: string;
  #offset = 0;

  constructor(text: string) {
    this.#text = text;
  }

  parse(): FoundryActivationV1JsonValue {
    this.#skipWhitespace();
    const value = this.#parseValue(0);
    this.#skipWhitespace();
    if (this.#offset !== this.#text.length) this.#syntax("Unexpected trailing JSON bytes.");
    return value;
  }

  #parseValue(depth: number): FoundryActivationV1JsonValue {
    const token = this.#text[this.#offset];
    if (token === "{" || token === "[") {
      if (depth >= FOUNDRY_ACTIVATION_V1_JSON_MAX_DEPTH) {
        fail(
          ERROR.jsonDepthExceeded,
          `Foundry activation V1 canonical JSON exceeds its ${String(FOUNDRY_ACTIVATION_V1_JSON_MAX_DEPTH)}-container nesting limit.`,
        );
      }
      if (token === "{") return this.#parseObject(depth);
      return this.#parseArray(depth);
    }
    if (token === "\"") return this.#parseString();
    if (token === "t") return this.#parseLiteral("true", true);
    if (token === "f") return this.#parseLiteral("false", false);
    if (token === "n") return this.#parseLiteral("null", null);
    if (token === "-" || (token !== undefined && token >= "0" && token <= "9")) {
      fail(ERROR.jsonNumberForbidden, "Foundry activation V1 canonical JSON forbids every JSON numeric leaf.");
    }
    this.#syntax("Expected a JSON value.");
  }

  #parseLiteral<T extends boolean | null>(text: string, value: T): T {
    if (!this.#text.startsWith(text, this.#offset)) this.#syntax(`Invalid JSON token at byte ${String(this.#offset)}.`);
    this.#offset += text.length;
    return value;
  }

  #parseObject(depth: number): FoundryActivationV1JsonValue {
    this.#offset += 1;
    this.#skipWhitespace();
    const output = Object.create(null) as Record<string, FoundryActivationV1JsonValue>;
    const keys = new NATIVE_SET<string>();
    if (this.#consume("}")) return Object.freeze(output);

    for (;;) {
      if (this.#text[this.#offset] !== "\"") this.#syntax("JSON object members must begin with a string key.");
      const key = this.#parseString();
      assertAsciiKey(key);
      if (INTRINSIC_SET_HAS(keys, key)) {
        fail(ERROR.jsonDuplicateKey, `Foundry activation V1 JSON contains the duplicate object key ${JSON.stringify(key)}.`);
      }
      INTRINSIC_SET_ADD(keys, key);
      this.#skipWhitespace();
      if (!this.#consume(":")) this.#syntax("JSON object keys must be followed by a colon.");
      this.#skipWhitespace();
      output[key] = this.#parseValue(depth + 1);
      this.#skipWhitespace();
      if (this.#consume("}")) return Object.freeze(output);
      if (!this.#consume(",")) this.#syntax("JSON object members must be separated by a comma.");
      this.#skipWhitespace();
    }
  }

  #parseArray(depth: number): FoundryActivationV1JsonValue {
    this.#offset += 1;
    this.#skipWhitespace();
    const output: FoundryActivationV1JsonValue[] = [];
    if (this.#consume("]")) return Object.freeze(output);

    for (;;) {
      output[output.length] = this.#parseValue(depth + 1);
      this.#skipWhitespace();
      if (this.#consume("]")) return Object.freeze(output);
      if (!this.#consume(",")) this.#syntax("JSON array members must be separated by a comma.");
      this.#skipWhitespace();
    }
  }

  #parseString(): string {
    this.#offset += 1;
    let output = "";
    while (this.#offset < this.#text.length) {
      const character = this.#text[this.#offset];
      if (character === "\"") {
        this.#offset += 1;
        assertUnicodeScalarString(output);
        return output;
      }
      if (character === "\\") {
        this.#offset += 1;
        output += this.#parseEscape();
        continue;
      }
      if (character === undefined || character.charCodeAt(0) < 0x20) {
        this.#syntax("JSON strings cannot contain an unescaped control character.");
      }
      output += character;
      this.#offset += 1;
    }
    this.#syntax("Unterminated JSON string.");
  }

  #parseEscape(): string {
    const escape = this.#text[this.#offset];
    this.#offset += 1;
    if (escape === "\"" || escape === "\\" || escape === "/") return escape;
    if (escape === "b") return "\b";
    if (escape === "f") return "\f";
    if (escape === "n") return "\n";
    if (escape === "r") return "\r";
    if (escape === "t") return "\t";
    if (escape !== "u") this.#syntax("Invalid JSON string escape.");
    const hexadecimal = this.#text.slice(this.#offset, this.#offset + 4);
    if (!/^[0-9A-Fa-f]{4}$/u.test(hexadecimal)) this.#syntax("Invalid JSON Unicode escape.");
    this.#offset += 4;
    return String.fromCharCode(Number.parseInt(hexadecimal, 16));
  }

  #skipWhitespace(): void {
    for (;;) {
      const character = this.#text[this.#offset];
      if (character !== " " && character !== "\t" && character !== "\r" && character !== "\n") return;
      this.#offset += 1;
    }
  }

  #consume(expected: string): boolean {
    if (this.#text[this.#offset] !== expected) return false;
    this.#offset += 1;
    return true;
  }

  #syntax(message: string): never {
    fail(ERROR.jsonSyntaxInvalid, `${message} Offset ${String(this.#offset)}.`);
  }
}

function copyBoundedBytes(input: Uint8Array, maximumByteLength: number): Buffer {
  let inputBrand: unknown;
  try {
    inputBrand = INTRINSIC_TYPED_ARRAY_TAG(input);
  } catch {
    fail(ERROR.bytesRequired, "Foundry activation V1 canonical JSON must be supplied as raw Uint8Array bytes.");
  }
  if (inputBrand !== "Uint8Array") {
    fail(ERROR.bytesRequired, "Foundry activation V1 canonical JSON must be supplied as raw Uint8Array bytes.");
  }
  let actualByteLength: number;
  try {
    actualByteLength = INTRINSIC_TYPED_ARRAY_BYTE_LENGTH(input);
  } catch {
    fail(ERROR.bytesRequired, "Foundry activation V1 canonical JSON must be supplied as raw Uint8Array bytes.");
  }
  if (!Number.isSafeInteger(maximumByteLength) || maximumByteLength < 0) {
    fail(ERROR.byteLimitInvalid, "The Foundry activation V1 JSON byte limit must be a non-negative safe integer.");
  }
  if (actualByteLength > maximumByteLength) {
    fail(
      ERROR.byteLimitExceeded,
      `Foundry activation V1 JSON exceeds its ${String(maximumByteLength)}-byte limit.`,
    );
  }
  const copy = INTRINSIC_BUFFER_ALLOC_UNSAFE(actualByteLength);
  try {
    INTRINSIC_TYPED_ARRAY_SET(copy, input);
  } catch (cause) {
    fail(ERROR.bytesRequired, "Foundry activation V1 canonical JSON bytes could not be snapshotted.", { cause });
  }
  return copy;
}

function decodeFatalUtf8(bytes: Buffer): string {
  if (beginsWithBytes(bytes, UTF8_BOM)) {
    fail(ERROR.utf8BomForbidden, "Foundry activation V1 canonical JSON must not begin with a UTF-8 BOM.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (cause) {
    fail(ERROR.utf8Invalid, "Foundry activation V1 canonical JSON is not fatal-decodable UTF-8.", {
      cause,
    });
  }
}

export function parseFoundryActivationV1CanonicalJsonBytes(
  input: Uint8Array,
  maximumByteLength: number,
): FoundryActivationV1CanonicalJsonParseResult {
  const bytes = copyBoundedBytes(input, maximumByteLength);
  const text = decodeFatalUtf8(bytes);
  const value = new DuplicateAwareJsonParser(text).parse();
  const canonicalJson = canonicalizeFoundryActivationV1Json(value);
  if (!byteArraysEqual(INTRINSIC_BUFFER_FROM(canonicalJson, "utf8"), bytes)) {
    fail(
      ERROR.jsonNotCanonical,
      "Foundry activation V1 JSON bytes must exactly equal their unsigned-ASCII-key-ordered canonical encoding.",
    );
  }
  return Object.freeze({ canonicalJson, value });
}

function isJsonObject(value: FoundryActivationV1JsonValue): value is { readonly [key: string]: FoundryActivationV1JsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireExactObjectKeys(
  value: FoundryActivationV1JsonValue,
  expectedKeys: readonly string[],
  subject: string,
): asserts value is { readonly [key: string]: FoundryActivationV1JsonValue } {
  if (!isJsonObject(value)) {
    fail(ERROR.envelopeShapeInvalid, `${subject} must be a JSON object.`);
  }
  const actualKeys = Object.keys(value);
  const sortedExpected: string[] = [];
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const expectedKey = expectedKeys[index];
    if (expectedKey === undefined) throw new Error("Expected JSON object keys must be dense.");
    sortedExpected[index] = expectedKey;
  }
  const sortStrings = (members: string[]): void => {
    for (let index = 1; index < members.length; index += 1) {
      const member = members[index];
      if (member === undefined) throw new Error("JSON object key sorting encountered a sparse array.");
      let insertionIndex = index;
      while (insertionIndex > 0) {
        const previous = members[insertionIndex - 1];
        if (previous === undefined || compareUnsignedAscii(previous, member) <= 0) break;
        members[insertionIndex] = previous;
        insertionIndex -= 1;
      }
      members[insertionIndex] = member;
    }
  };
  sortStrings(actualKeys);
  sortStrings(sortedExpected);
  let keysMatch = actualKeys.length === sortedExpected.length;
  for (let index = 0; keysMatch && index < actualKeys.length; index += 1) {
    keysMatch = actualKeys[index] === sortedExpected[index];
  }
  if (!keysMatch) {
    fail(ERROR.envelopeShapeInvalid, `${subject} has missing or unknown members.`);
  }
}

function requireStringMember(
  value: { readonly [key: string]: FoundryActivationV1JsonValue },
  key: string,
  subject: string,
): string {
  const member = value[key];
  if (typeof member !== "string") {
    fail(ERROR.envelopeShapeInvalid, `${subject}.${key} must be a string.`);
  }
  return member;
}

function decodeCanonicalBase64(value: string, subject: string): Buffer {
  if (!CANONICAL_BASE64.test(value)) {
    fail(ERROR.base64Invalid, `${subject} must be padded RFC 4648 canonical base64.`);
  }
  const decoded = INTRINSIC_BUFFER_FROM(value, "base64");
  if (INTRINSIC_BUFFER_TO_STRING(decoded, "base64") !== value) {
    fail(ERROR.base64Invalid, `${subject} must decode and re-encode byte-for-byte identically.`);
  }
  return decoded;
}

function assertPrintableKeyId(keyId: string): void {
  if (!/^[\x20-\x7e]{1,128}$/u.test(keyId)) {
    fail(ERROR.keyIdInvalid, "Foundry activation V1 key IDs must contain 1-128 printable ASCII bytes.");
  }
}

function resolveExpectedPublicKey(
  trustedPublicKeys: ReadonlyMap<string, KeyObject>,
  expectedKeyId: string,
): {
  readonly publicKey: KeyObject;
  readonly signerPublicKeySha256: string;
} {
  const mapInput: unknown = trustedPublicKeys;
  if (mapInput === null || typeof mapInput !== "object") {
    fail(ERROR.publicKeyMapInvalid, "Foundry activation V1 verification requires a read-only map of public keys.");
  }
  let isProxyMap: boolean;
  try {
    isProxyMap = NATIVE_IS_PROXY(mapInput);
  } catch (cause) {
    fail(ERROR.publicKeyMapInvalid, "The Foundry activation V1 public-key map cannot be proxy-brand checked.", { cause });
  }
  if (isProxyMap) {
    fail(ERROR.publicKeyMapInvalid, "Foundry activation V1 verification rejects proxy public-key maps.");
  }
  let keyInput: unknown;
  try {
    keyInput = INTRINSIC_MAP_GET(mapInput, expectedKeyId);
  } catch (cause) {
    fail(ERROR.publicKeyMapInvalid, "Foundry activation V1 verification requires an actual Map of public keys.", { cause });
  }
  if (keyInput === undefined) {
    fail(ERROR.publicKeyMissing, "The expected Foundry activation V1 key ID is absent from the public-key map.");
  }
  let isNativeUnproxiedKeyObject: boolean;
  try {
    isNativeUnproxiedKeyObject = NATIVE_IS_KEY_OBJECT(keyInput) && !NATIVE_IS_PROXY(keyInput);
  } catch (cause) {
    fail(ERROR.keyTypeInvalid, "The Foundry activation V1 key cannot be native-brand checked.", { cause });
  }
  if (!isNativeUnproxiedKeyObject) {
    fail(ERROR.keyTypeInvalid, "Foundry activation V1 verification requires an actual Node.js KeyObject.");
  }
  const key = keyInput as KeyObject;
  let intrinsicKeyType: unknown;
  try {
    intrinsicKeyType = INTRINSIC_KEY_OBJECT_TYPE(key);
  } catch (cause) {
    fail(ERROR.keyTypeInvalid, "The Foundry activation V1 key does not have valid KeyObject internals.", { cause });
  }
  if (intrinsicKeyType === "private") {
    fail(ERROR.privateKeyRejected, "Foundry activation V1 verification accepts public keys only.");
  }
  if (intrinsicKeyType !== "public") {
    fail(ERROR.keyTypeInvalid, "Foundry activation V1 verification requires an asymmetric public key.");
  }
  let exportedSpkiInput: unknown;
  try {
    exportedSpkiInput = INTRINSIC_PUBLIC_KEY_EXPORT(key);
  } catch (cause) {
    fail(ERROR.keyTypeInvalid, "The Foundry activation V1 public key cannot export RFC 8410 SPKI DER.", { cause });
  }
  let spkiBytes: Buffer;
  try {
    spkiBytes = copyBoundedBytes(exportedSpkiInput as Uint8Array, 1024);
  } catch (cause) {
    fail(ERROR.keyTypeInvalid, "The Foundry activation V1 public key has an invalid SPKI DER encoding.", { cause });
  }
  let normalizedPublicKey: KeyObject;
  try {
    normalizedPublicKey = createPublicKey({ key: spkiBytes, format: "der", type: "spki" });
  } catch (cause) {
    fail(ERROR.keyTypeInvalid, "The Foundry activation V1 public key has an invalid SPKI DER encoding.", { cause });
  }
  if (
    INTRINSIC_TYPED_ARRAY_BYTE_LENGTH(spkiBytes) !== ED25519_SPKI_DER_BYTE_LENGTH ||
    !beginsWithBytes(spkiBytes, ED25519_SPKI_DER_PREFIX)
  ) {
    fail(ERROR.keyTypeInvalid, "Foundry activation V1 verification requires an Ed25519 public key.");
  }
  return Object.freeze({
    publicKey: normalizedPublicKey,
    signerPublicKeySha256: `sha256:${sha256Hex(spkiBytes)}`,
  });
}

function preAuthenticationEncoding(payloadType: string, payloadBytes: Buffer): Buffer {
  const payloadTypeBytes = INTRINSIC_BUFFER_FROM(payloadType, "utf8");
  const payloadTypeByteLength = INTRINSIC_TYPED_ARRAY_BYTE_LENGTH(payloadTypeBytes);
  const payloadByteLength = INTRINSIC_TYPED_ARRAY_BYTE_LENGTH(payloadBytes);
  return INTRINSIC_BUFFER_CONCAT([
    INTRINSIC_BUFFER_FROM(`DSSEv1 ${String(payloadTypeByteLength)} `, "ascii"),
    payloadTypeBytes,
    INTRINSIC_BUFFER_FROM(` ${String(payloadByteLength)} `, "ascii"),
    payloadBytes,
  ]);
}

function sha256Hex(...members: readonly Uint8Array[]): string {
  const hash = createHash("sha256");
  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    if (member === undefined) throw new TypeError("SHA-256 members must be dense byte arrays.");
    hash.update(member);
  }
  return hash.digest("hex");
}

function isJsonArray(
  value: FoundryActivationV1JsonValue,
): value is readonly FoundryActivationV1JsonValue[] {
  return Array.isArray(value);
}

function profileFor(evidenceKind: FoundryActivationV1SignedEvidenceKind): {
  readonly domain: string;
  readonly payloadType: string;
} {
  if (!Object.hasOwn(FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_PROFILES, evidenceKind)) {
    fail(ERROR.evidenceKindInvalid, "The requested Foundry activation V1 signed-evidence kind is not closed by the V1 profile.");
  }
  return FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_PROFILES[evidenceKind];
}

function assertPayloadProfileBinding(
  value: FoundryActivationV1JsonValue,
  evidenceKind: FoundryActivationV1SignedEvidenceKind,
): void {
  if (evidenceKind === "bootstrap_ceremony") return;
  if (
    !isJsonObject(value) ||
    value.evidenceKind !== evidenceKind ||
    value.authority !== "none"
  ) {
    fail(
      ERROR.profileBindingMismatch,
      "The signed payload must bind the selected Foundry activation V1 evidenceKind and authority none.",
    );
  }
}

function snapshotExpectedVerificationIdentity(input: unknown): {
  readonly evidenceKind: FoundryActivationV1SignedEvidenceKind;
  readonly expectedKeyId: string;
} {
  if (input === null || typeof input !== "object") {
    fail(ERROR.evidenceKindInvalid, "The expected Foundry activation V1 signed-evidence identity must be an object.");
  }
  const evidenceKindDescriptor = Object.getOwnPropertyDescriptor(input, "evidenceKind");
  if (
    evidenceKindDescriptor === undefined ||
    !("value" in evidenceKindDescriptor) ||
    typeof evidenceKindDescriptor.value !== "string" ||
    !Object.hasOwn(FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_PROFILES, evidenceKindDescriptor.value)
  ) {
    fail(ERROR.evidenceKindInvalid, "The requested Foundry activation V1 signed-evidence kind is not closed by the V1 profile.");
  }
  const keyIdDescriptor = Object.getOwnPropertyDescriptor(input, "expectedKeyId");
  if (
    keyIdDescriptor === undefined ||
    !("value" in keyIdDescriptor) ||
    typeof keyIdDescriptor.value !== "string"
  ) {
    fail(ERROR.keyIdInvalid, "The expected Foundry activation V1 key ID must be an own string data member.");
  }
  return Object.freeze({
    evidenceKind: evidenceKindDescriptor.value as FoundryActivationV1SignedEvidenceKind,
    expectedKeyId: keyIdDescriptor.value,
  });
}

/**
 * Verifies one exact Activation V1 wire-level DSSE envelope and returns only its
 * byte identity. For bootstrap this is one independently signed envelope, not
 * the paired envelopeA/envelopeB ceremony or its combined digest. This primitive
 * does not perform per-kind semantic validation, trust/workload admission,
 * database admission, authorization, signing, release, or publication.
 */
export function verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
  envelopeBytesInput: Uint8Array,
  trustedPublicKeys: ReadonlyMap<string, KeyObject>,
  expected: {
    readonly evidenceKind: FoundryActivationV1SignedEvidenceKind;
    readonly expectedKeyId: string;
  },
): FoundryActivationV1SignedEvidenceIdentity {
  const envelopeBytes = copyBoundedBytes(
    envelopeBytesInput,
    FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_MAX_ENVELOPE_BYTES,
  );
  const expectedIdentity = snapshotExpectedVerificationIdentity(expected);
  const profile = profileFor(expectedIdentity.evidenceKind);
  assertPrintableKeyId(expectedIdentity.expectedKeyId);
  const resolvedPublicKey = resolveExpectedPublicKey(trustedPublicKeys, expectedIdentity.expectedKeyId);
  const envelope = parseFoundryActivationV1CanonicalJsonBytes(
    envelopeBytes,
    FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_MAX_ENVELOPE_BYTES,
  );
  requireExactObjectKeys(envelope.value, ["payloadType", "payload", "signatures"], "The DSSE envelope");

  const payloadType = requireStringMember(envelope.value, "payloadType", "The DSSE envelope");
  if (payloadType !== profile.payloadType) {
    fail(ERROR.payloadTypeMismatch, "The DSSE payload type does not equal the selected Foundry activation V1 profile.");
  }
  const encodedPayload = requireStringMember(envelope.value, "payload", "The DSSE envelope");
  const payloadBytes = decodeCanonicalBase64(encodedPayload, "The DSSE payload");
  const payloadByteLength = INTRINSIC_TYPED_ARRAY_BYTE_LENGTH(payloadBytes);
  if (payloadByteLength > FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_MAX_PAYLOAD_BYTES) {
    fail(
      ERROR.byteLimitExceeded,
      `The decoded DSSE payload exceeds its ${String(FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_MAX_PAYLOAD_BYTES)}-byte limit.`,
    );
  }

  const signatures = envelope.value.signatures;
  if (signatures === undefined || !isJsonArray(signatures) || signatures.length !== 1) {
    fail(ERROR.envelopeShapeInvalid, "The DSSE envelope must contain exactly one signature object.");
  }
  const signature = signatures[0];
  if (signature === undefined) {
    fail(ERROR.envelopeShapeInvalid, "The DSSE envelope must contain exactly one signature object.");
  }
  requireExactObjectKeys(signature, ["keyid", "sig"], "The DSSE signature");
  const keyId = requireStringMember(signature, "keyid", "The DSSE signature");
  assertPrintableKeyId(keyId);
  if (keyId !== expectedIdentity.expectedKeyId) {
    fail(ERROR.keyIdMismatch, "The DSSE signature key ID does not equal the exact expected Foundry activation V1 key ID.");
  }
  const signatureBytes = decodeCanonicalBase64(
    requireStringMember(signature, "sig", "The DSSE signature"),
    "The DSSE signature",
  );
  if (INTRINSIC_TYPED_ARRAY_BYTE_LENGTH(signatureBytes) !== 64) {
    fail(ERROR.signatureLengthInvalid, "Foundry activation V1 Ed25519 signatures must decode to exactly 64 bytes.");
  }
  if (!verifySignature(
    null,
    preAuthenticationEncoding(payloadType, payloadBytes),
    resolvedPublicKey.publicKey,
    signatureBytes,
  )) {
    fail(ERROR.signatureInvalid, "The exact Foundry activation V1 DSSE PAE has an invalid Ed25519 signature.");
  }

  const payload = parseFoundryActivationV1CanonicalJsonBytes(
    payloadBytes,
    FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_MAX_PAYLOAD_BYTES,
  );
  assertPayloadProfileBinding(payload.value, expectedIdentity.evidenceKind);
  const payloadSha256 = sha256Hex(payloadBytes);
  const receiptSha256 = `sha256:${sha256Hex(INTRINSIC_BUFFER_FROM(`${profile.domain}\n`, "utf8"), payloadBytes)}`;
  const envelopeSha256 = `sha256:${sha256Hex(
    INTRINSIC_BUFFER_FROM(`${profile.domain}.dsse-envelope\n`, "utf8"),
    envelopeBytes,
  )}`;

  return Object.freeze({
    evidenceKind: expectedIdentity.evidenceKind,
    domain: profile.domain,
    payloadType,
    keyId,
    signerPublicKeySha256: resolvedPublicKey.signerPublicKeySha256,
    canonicalPayloadJson: payload.canonicalJson,
    canonicalEnvelopeJson: envelope.canonicalJson,
    payloadByteLength: String(payloadByteLength),
    envelopeByteLength: String(INTRINSIC_TYPED_ARRAY_BYTE_LENGTH(envelopeBytes)),
    payloadSha256,
    receiptSha256,
    envelopeSha256,
  });
}

function snapshotBootstrapPairSignerInput(
  input: unknown,
  side: "A" | "B",
): FoundryActivationV1BootstrapPairSignerInput {
  let isProxy: boolean;
  try {
    isProxy = NATIVE_IS_PROXY(input);
  } catch (cause) {
    fail(
      ERROR.bootstrapPairInputShapeInvalid,
      `Bootstrap signer ${side} cannot be proxy-brand checked.`,
      { cause },
    );
  }
  if (input === null || typeof input !== "object" || isProxy || Array.isArray(input)) {
    fail(
      ERROR.bootstrapPairInputShapeInvalid,
      `Bootstrap signer ${side} must be one plain, unproxied data object.`,
    );
  }
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== Object.prototype) {
    fail(
      ERROR.bootstrapPairInputShapeInvalid,
      `Bootstrap signer ${side} must be one plain, unproxied data object.`,
    );
  }
  const expectedKeys = ["expectedKeyId", "publicKey"] as const;
  const actualKeys = Reflect.ownKeys(input);
  let keysMatch = actualKeys.length === expectedKeys.length;
  for (let expectedIndex = 0; keysMatch && expectedIndex < expectedKeys.length; expectedIndex += 1) {
    const expectedKey = expectedKeys[expectedIndex];
    let found = false;
    for (let actualIndex = 0; actualIndex < actualKeys.length; actualIndex += 1) {
      if (actualKeys[actualIndex] === expectedKey) {
        found = true;
        break;
      }
    }
    if (!found) keysMatch = false;
  }
  if (!keysMatch) {
    fail(
      ERROR.bootstrapPairInputShapeInvalid,
      `Bootstrap signer ${side} must contain exactly expectedKeyId and publicKey.`,
    );
  }
  const keyIdDescriptor = Object.getOwnPropertyDescriptor(input, "expectedKeyId");
  const publicKeyDescriptor = Object.getOwnPropertyDescriptor(input, "publicKey");
  if (
    keyIdDescriptor === undefined ||
    !("value" in keyIdDescriptor) ||
    keyIdDescriptor.enumerable !== true ||
    typeof keyIdDescriptor.value !== "string" ||
    publicKeyDescriptor === undefined ||
    !("value" in publicKeyDescriptor) ||
    publicKeyDescriptor.enumerable !== true
  ) {
    fail(
      ERROR.bootstrapPairInputShapeInvalid,
      `Bootstrap signer ${side} members must be enumerable own data properties with a string key ID.`,
    );
  }
  assertPrintableKeyId(keyIdDescriptor.value);
  return Object.freeze({
    expectedKeyId: keyIdDescriptor.value,
    publicKey: publicKeyDescriptor.value as KeyObject,
  });
}

function snapshotBootstrapEnvelopeBytes(input: Uint8Array): Buffer {
  let backingBuffer: ArrayBufferLike;
  try {
    backingBuffer = INTRINSIC_TYPED_ARRAY_BUFFER(input);
  } catch {
    fail(ERROR.bytesRequired, "Bootstrap envelopes must be supplied as raw Uint8Array bytes.");
  }
  if (NATIVE_IS_SHARED_ARRAY_BUFFER(backingBuffer)) {
    fail(
      ERROR.bootstrapPairSharedBackingRejected,
      "Bootstrap pair envelopes cannot use SharedArrayBuffer backing because it cannot be snapshotted deterministically.",
    );
  }
  return copyBoundedBytes(
    input,
    FOUNDRY_ACTIVATION_V1_SIGNED_EVIDENCE_MAX_ENVELOPE_BYTES,
  );
}

function createSingletonPublicKeyMap(keyId: string, publicKey: KeyObject): Map<string, KeyObject> {
  const map = new NATIVE_MAP<string, KeyObject>();
  INTRINSIC_MAP_SET(map, keyId, publicKey);
  return map;
}

/**
 * Performs only the fully specified wire-level portion of the two-envelope
 * bootstrap ceremony. Both input byte arrays and signer configs are snapshotted
 * before public-key normalization; key-owned lookup/export hooks are never
 * invoked. Each exact one-signature envelope's
 * signature is verified against its caller-supplied public key;
 * their canonical payload bytes must be identical; key IDs and normalized
 * RFC 8410 SPKI identities must be distinct; and identities are returned in
 * unsigned-ASCII key-ID order. The frozen contract does not specify the
 * combined bootstrap digest's domain/framing or the root-binding tuple, so this
 * function deliberately computes neither and is not bootstrap admission. Each
 * nested receiptSha256 remains the ordinary per-envelope payload-domain digest,
 * never the missing combined bootstrap evidence digest.
 */
export function precheckFoundryActivationV1BootstrapEnvelopePairBytes(
  envelopeABytesInput: Uint8Array,
  signerAInput: FoundryActivationV1BootstrapPairSignerInput,
  envelopeBBytesInput: Uint8Array,
  signerBInput: FoundryActivationV1BootstrapPairSignerInput,
): FoundryActivationV1BootstrapPairWirePrecheck {
  const envelopeABytes = snapshotBootstrapEnvelopeBytes(envelopeABytesInput);
  const envelopeBBytes = snapshotBootstrapEnvelopeBytes(envelopeBBytesInput);
  const signerA = snapshotBootstrapPairSignerInput(signerAInput, "A");
  const signerB = snapshotBootstrapPairSignerInput(signerBInput, "B");
  if (signerA.expectedKeyId === signerB.expectedKeyId) {
    fail(
      ERROR.bootstrapPairKeyIdRepeated,
      "The two bootstrap envelopes must use distinct key IDs.",
    );
  }
  const identityA = verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
    envelopeABytes,
    createSingletonPublicKeyMap(signerA.expectedKeyId, signerA.publicKey),
    { evidenceKind: "bootstrap_ceremony", expectedKeyId: signerA.expectedKeyId },
  );
  const identityB = verifyFoundryActivationV1SignedEvidenceEnvelopeBytes(
    envelopeBBytes,
    createSingletonPublicKeyMap(signerB.expectedKeyId, signerB.publicKey),
    { evidenceKind: "bootstrap_ceremony", expectedKeyId: signerB.expectedKeyId },
  );

  if (identityA.signerPublicKeySha256 === identityB.signerPublicKeySha256) {
    fail(
      ERROR.bootstrapPairKeyMaterialRepeated,
      "The two bootstrap envelopes must use distinct normalized Ed25519 public-key material.",
    );
  }
  if (
    identityA.payloadType !== identityB.payloadType ||
    identityA.canonicalPayloadJson !== identityB.canonicalPayloadJson ||
    identityA.payloadByteLength !== identityB.payloadByteLength ||
    identityA.payloadSha256 !== identityB.payloadSha256 ||
    identityA.receiptSha256 !== identityB.receiptSha256
  ) {
    fail(
      ERROR.bootstrapPairPayloadMismatch,
      "The two bootstrap envelopes must contain byte-identical canonical payloads and payload types.",
    );
  }

  const orderedEnvelopeIdentities = Object.freeze(
    compareUnsignedAscii(identityA.keyId, identityB.keyId) < 0
      ? [identityA, identityB] as const
      : [identityB, identityA] as const,
  );
  const sharedPayloadIdentity = Object.freeze({
    payloadType: identityA.payloadType,
    canonicalPayloadJson: identityA.canonicalPayloadJson,
    payloadByteLength: identityA.payloadByteLength,
    payloadSha256: identityA.payloadSha256,
    perEnvelopePayloadReceiptSha256: identityA.receiptSha256,
  });

  return Object.freeze({
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
    sharedPayloadIdentity,
    orderedEnvelopeIdentities,
  });
}
