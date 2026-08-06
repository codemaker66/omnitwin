import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Trusted process-private codec for complete VNSDP01 byte frames.
 *
 * This module is intentionally absent from the package barrel and from the
 * helper's advertised control capabilities. It has no pipe or process logic.
 */

export const TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1 = 160;
export const TRUSTED_WINDOWS_NATIVE_DATA_PLANE_MAX_PAYLOAD_BYTES_V1 = 1_048_576;
export const TRUSTED_WINDOWS_NATIVE_DATA_PLANE_MAX_OBJECTS_PER_TRANSFER_V1 = 100_000;

const MAGIC = Buffer.from([0x56, 0x4e, 0x53, 0x44, 0x50, 0x30, 0x31, 0x00]);
const VERSION = 1;
const FLAG_TERMINAL = 0b0000_0001;
const KIND_SOURCE = 1;
const KIND_OUTPUT = 2;
const KIND_CATALOG = 3;
const MAX_WORK_SEQUENCE = 0xffff_ffff_ffff_ffffn;
const MAX_CHUNK_SEQUENCE = 0xffff_ffff;
const REFERENCE_SUFFIX_HEX_LENGTH = 32;
const REFERENCE_SUFFIX_BYTES = 16;

const VERSION_OFFSET = 8;
const HEADER_SIZE_OFFSET = 10;
const KIND_OFFSET = 12;
const FLAGS_OFFSET = 13;
const RESERVED_U16_OFFSET = 14;
const WORK_SEQUENCE_OFFSET = 16;
const PAYLOAD_LENGTH_OFFSET = 24;
const CHUNK_SEQUENCE_OFFSET = 28;
const SESSION_REF_OFFSET = 32;
const REQUEST_REF_OFFSET = 48;
const SCOPE_REF_OFFSET = 64;
const CONTAINER_REF_OFFSET = 80;
const OBJECT_REF_OFFSET = 96;
const TRANSFER_REF_OFFSET = 112;
const PAYLOAD_SHA256_OFFSET = 128;

const SESSION_REF_PREFIX = "helper_session_";
const REQUEST_REF_PREFIX = "helper_request_";
const SCOPE_REF_PREFIX = "helper_scope_";
const SOURCE_REF_PREFIX = "helper_source_";
const SOURCE_FILE_REF_PREFIX = "helper_source_file_";
const RUN_REF_PREFIX = "helper_run_";
const OUTPUT_FILE_REF_PREFIX = "helper_output_file_";
const CATALOG_REF_PREFIX = "helper_catalog_";
// Codec-private until a later control-plane request binds transfer references.
const TRANSFER_REF_PREFIX = "helper_transfer_";
const LOWER_HEX_PATTERN = /^[a-f0-9]+$/u;
const NODE_INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom");
const TYPED_ARRAY_BUFFER_GETTER = captureTypedArrayGetter("buffer");
const TYPED_ARRAY_BYTE_LENGTH_GETTER = captureTypedArrayGetter("byteLength");
const TYPED_ARRAY_BYTE_OFFSET_GETTER = captureTypedArrayGetter("byteOffset");
const TYPED_ARRAY_TAG_GETTER = captureTypedArrayGetter(Symbol.toStringTag);

export type TrustedWindowsNativeDataPlaneFrameErrorCodeV1 =
  | "FRAME_TOO_SHORT"
  | "FRAME_TOO_LARGE"
  | "INVALID_MAGIC"
  | "INVALID_VERSION"
  | "INVALID_HEADER_SIZE"
  | "INVALID_KIND"
  | "INVALID_FLAGS"
  | "NONZERO_RESERVED"
  | "INVALID_FRAME"
  | "INVALID_WORK_SEQUENCE"
  | "INVALID_CHUNK_SEQUENCE"
  | "ZERO_LENGTH_NON_TERMINAL"
  | "INVALID_EMPTY_OBJECT"
  | "INVALID_REFERENCE"
  | "LENGTH_MISMATCH"
  | "PAYLOAD_HASH_MISMATCH";

export class TrustedWindowsNativeDataPlaneFrameErrorV1 extends Error {
  readonly code: TrustedWindowsNativeDataPlaneFrameErrorCodeV1;

  constructor(code: TrustedWindowsNativeDataPlaneFrameErrorCodeV1) {
    super(`Trusted Windows native data-plane frame rejected: ${code}`);
    this.name = "TrustedWindowsNativeDataPlaneFrameErrorV1";
    this.code = code;
  }
}

const INTERNAL_DATA_PLANE_ERRORS = new WeakMap<
  object,
  TrustedWindowsNativeDataPlaneFrameErrorCodeV1
>();

export type TrustedWindowsNativeDataPlaneTransferOrderErrorCodeV1 =
  | "ALREADY_FINISHED"
  | "BINDING_MISMATCH"
  | "INVALID_FIRST_CHUNK_SEQUENCE"
  | "UNEXPECTED_CHUNK_SEQUENCE"
  | "OBJECT_SWITCH_BEFORE_TERMINAL"
  | "OBJECT_RETURNED"
  | "FRAME_AFTER_TERMINAL"
  | "CHUNK_SEQUENCE_EXHAUSTED"
  | "TOO_MANY_OBJECTS"
  | "NO_FRAMES"
  | "UNTERMINATED_OBJECT";

export class TrustedWindowsNativeDataPlaneTransferOrderErrorV1 extends Error {
  readonly code: TrustedWindowsNativeDataPlaneTransferOrderErrorCodeV1;

  constructor(code: TrustedWindowsNativeDataPlaneTransferOrderErrorCodeV1) {
    super(`Trusted Windows native data-plane transfer rejected: ${code}`);
    this.name = "TrustedWindowsNativeDataPlaneTransferOrderErrorV1";
    this.code = code;
  }
}

interface TransferBindingV1 {
  readonly kind: "source" | "output" | "catalog";
  readonly workSequence: bigint;
  readonly sessionRef: string;
  readonly requestRef: string;
  readonly scopeRef: string;
  readonly transferRef: string;
}

interface ObjectBindingV1 {
  readonly containerRef: string;
  readonly objectRef: string;
  readonly key: string;
}

interface CommonFrameV1 {
  readonly workSequence: bigint;
  readonly chunkSequence: number;
  /** Wire flag bit 0: the final chunk for this source, output, or catalog object. */
  readonly terminal: boolean;
  readonly sessionRef: string;
  readonly requestRef: string;
  readonly scopeRef: string;
  readonly transferRef: string;
  readonly payload: Uint8Array;
}

export interface TrustedWindowsNativeSourceDataPlaneFrameV1 extends CommonFrameV1 {
  readonly kind: "source";
  readonly sourceRef: string;
  readonly sourceFileRef: string;
}

export interface TrustedWindowsNativeOutputDataPlaneFrameV1 extends CommonFrameV1 {
  readonly kind: "output";
  readonly runRef: string;
  readonly outputFileRef: string;
}

export interface TrustedWindowsNativeCatalogDataPlaneFrameV1 extends CommonFrameV1 {
  readonly kind: "catalog";
  readonly sourceRef: string;
  readonly catalogRef: string;
}

export type TrustedWindowsNativeDataPlaneFrameV1 =
  | TrustedWindowsNativeSourceDataPlaneFrameV1
  | TrustedWindowsNativeOutputDataPlaneFrameV1
  | TrustedWindowsNativeCatalogDataPlaneFrameV1;

type NormalizedSourceFrameV1 = Omit<
  TrustedWindowsNativeSourceDataPlaneFrameV1,
  "payload"
> & { readonly payload: Buffer };
type NormalizedOutputFrameV1 = Omit<
  TrustedWindowsNativeOutputDataPlaneFrameV1,
  "payload"
> & { readonly payload: Buffer };
type NormalizedCatalogFrameV1 = Omit<
  TrustedWindowsNativeCatalogDataPlaneFrameV1,
  "payload"
> & { readonly payload: Buffer };
type NormalizedFrameV1 =
  | NormalizedSourceFrameV1
  | NormalizedOutputFrameV1
  | NormalizedCatalogFrameV1;

interface NormalizedCommonFrameV1 {
  readonly workSequence: bigint;
  readonly chunkSequence: number;
  readonly terminal: boolean;
  readonly sessionRef: string;
  readonly requestRef: string;
  readonly scopeRef: string;
  readonly transferRef: string;
  readonly payload: Buffer;
}

interface RedactedFrameSummaryV1 {
  readonly kind: "source" | "output" | "catalog";
  readonly workSequence: string;
  readonly chunkSequence: number;
  readonly terminal: boolean;
  readonly payloadLength: number;
}

interface IntrinsicUint8ArrayWindow {
  readonly buffer: ArrayBufferLike;
  readonly byteLength: number;
  readonly byteOffset: number;
}

type WireKindV1 = typeof KIND_SOURCE | typeof KIND_OUTPUT | typeof KIND_CATALOG;

interface DecodedHeaderV1 {
  readonly kind: WireKindV1;
  readonly flags: number;
  readonly workSequence: bigint;
  readonly chunkSequence: number;
  readonly payloadLength: number;
}

interface DecodedReferencesV1 {
  readonly sessionRef: string;
  readonly requestRef: string;
  readonly scopeRef: string;
  readonly containerRef: string;
  readonly objectRef: string;
  readonly transferRef: string;
}

export interface TrustedWindowsNativeDataPlaneFrameHeaderPreflightV1 {
  readonly kind: TrustedWindowsNativeDataPlaneFrameV1["kind"];
  readonly workSequence: bigint;
  readonly chunkSequence: number;
  readonly terminal: boolean;
  readonly payloadLength: number;
  readonly totalFrameLength: number;
}

/**
 * Validates the complete ordered frame stream for one bound transfer.
 *
 * Each kind-specific `(container, object)` pair is one object. Object chunks
 * must be contiguous, start at one, advance by exactly one, and terminate
 * before the transfer can move to a new object. A completed object can never
 * appear again. Call {@link finish} after the final frame.
 */
export class TrustedWindowsNativeDataPlaneTransferOrderValidatorV1 {
  #binding: TransferBindingV1 | undefined;
  #currentObject: ObjectBindingV1 | undefined;
  readonly #completedObjectKeys = new Set<string>();
  #nextChunkSequence = 1;
  #currentTerminal = false;
  #finished = false;

  get objectCount(): number {
    return this.#completedObjectKeys.size + (this.#currentObject === undefined ? 0 : 1);
  }

  validateFrame(frame: TrustedWindowsNativeDataPlaneFrameV1): void;
  validateFrame(frame: unknown): void {
    if (this.#finished) return failTransferOrder("ALREADY_FINISHED");
    const normalized = withGenericCodecErrors(() => normalizeFrameInput(frame));
    try {
      this.#validateNormalizedFrame(normalized);
    } finally {
      // The validator needs metadata only. Do not leave its private payload copy
      // resident after either a successful check or an ordering failure.
      normalized.payload.fill(0);
    }
  }

  finish(): void {
    if (this.#finished) return failTransferOrder("ALREADY_FINISHED");
    if (this.#currentObject === undefined) return failTransferOrder("NO_FRAMES");
    if (!this.#currentTerminal) return failTransferOrder("UNTERMINATED_OBJECT");
    this.#finished = true;
  }

  #validateNormalizedFrame(frame: NormalizedFrameV1): void {
    const binding = transferBinding(frame);
    if (this.#binding !== undefined && !sameTransferBinding(this.#binding, binding)) {
      return failTransferOrder("BINDING_MISMATCH");
    }

    const object = objectBinding(frame);
    if (this.#currentObject === undefined) {
      validateFirstChunk(frame);
      this.#binding = binding;
      this.#currentObject = object;
    } else if (this.#currentObject.key === object.key) {
      if (this.#currentTerminal) return failTransferOrder("FRAME_AFTER_TERMINAL");
      if (frame.chunkSequence !== this.#nextChunkSequence) {
        return failTransferOrder("UNEXPECTED_CHUNK_SEQUENCE");
      }
      validateChunkSequenceCapacity(frame);
    } else {
      if (!this.#currentTerminal) {
        return failTransferOrder("OBJECT_SWITCH_BEFORE_TERMINAL");
      }
      if (this.#completedObjectKeys.has(object.key)) {
        return failTransferOrder("OBJECT_RETURNED");
      }
      if (
        this.objectCount ===
        TRUSTED_WINDOWS_NATIVE_DATA_PLANE_MAX_OBJECTS_PER_TRANSFER_V1
      ) {
        return failTransferOrder("TOO_MANY_OBJECTS");
      }
      validateFirstChunk(frame);
      this.#completedObjectKeys.add(this.#currentObject.key);
      this.#currentObject = object;
    }

    this.#currentTerminal = frame.terminal;
    this.#nextChunkSequence = frame.chunkSequence === MAX_CHUNK_SEQUENCE
      ? MAX_CHUNK_SEQUENCE
      : frame.chunkSequence + 1;
  }
}

function transferBinding(frame: NormalizedFrameV1): TransferBindingV1 {
  return {
    kind: frame.kind,
    workSequence: frame.workSequence,
    sessionRef: frame.sessionRef,
    requestRef: frame.requestRef,
    scopeRef: frame.scopeRef,
    transferRef: frame.transferRef,
  };
}

function sameTransferBinding(
  expected: TransferBindingV1,
  observed: TransferBindingV1,
): boolean {
  return expected.kind === observed.kind &&
    expected.workSequence === observed.workSequence &&
    expected.sessionRef === observed.sessionRef &&
    expected.requestRef === observed.requestRef &&
    expected.scopeRef === observed.scopeRef &&
    expected.transferRef === observed.transferRef;
}

function objectBinding(frame: NormalizedFrameV1): ObjectBindingV1 {
  const containerRef = frame.kind === "output" ? frame.runRef : frame.sourceRef;
  const objectRef = frame.kind === "source"
    ? frame.sourceFileRef
    : frame.kind === "output"
      ? frame.outputFileRef
      : frame.catalogRef;
  return {
    containerRef,
    objectRef,
    key: `${containerRef}:${objectRef}`,
  };
}

function validateFirstChunk(frame: NormalizedFrameV1): void {
  if (frame.chunkSequence !== 1) {
    return failTransferOrder("INVALID_FIRST_CHUNK_SEQUENCE");
  }
  validateChunkSequenceCapacity(frame);
}

function validateChunkSequenceCapacity(frame: NormalizedFrameV1): void {
  if (frame.chunkSequence === MAX_CHUNK_SEQUENCE && !frame.terminal) {
    return failTransferOrder("CHUNK_SEQUENCE_EXHAUSTED");
  }
}

export function createTrustedWindowsNativeDataPlaneFrameV1(
  input: TrustedWindowsNativeDataPlaneFrameV1,
): TrustedWindowsNativeDataPlaneFrameV1;
export function createTrustedWindowsNativeDataPlaneFrameV1(
  input: unknown,
): TrustedWindowsNativeDataPlaneFrameV1 {
  return withGenericCodecErrors(() => normalizeFrameInput(input));
}

export function encodeTrustedWindowsNativeDataPlaneFrameV1(
  input: TrustedWindowsNativeDataPlaneFrameV1,
): Uint8Array;
export function encodeTrustedWindowsNativeDataPlaneFrameV1(input: unknown): Uint8Array {
  return withGenericCodecErrors(() => {
    const frame = normalizeFrameInput(input);
    try {
      const header = encodeFixedHeader(frame, frame.payload);
      writeFrameReferences(header, frame);
      return Buffer.concat(
        [header, frame.payload],
        header.byteLength + frame.payload.byteLength,
      );
    } finally {
      frame.payload.fill(0);
    }
  });
}

export function decodeTrustedWindowsNativeDataPlaneFrameV1(
  bytes: Uint8Array,
): TrustedWindowsNativeDataPlaneFrameV1;
export function decodeTrustedWindowsNativeDataPlaneFrameV1(
  bytes: unknown,
): TrustedWindowsNativeDataPlaneFrameV1 {
  return withGenericCodecErrors(() => decodeFrame(bytes));
}

/**
 * Validates exactly one fixed header before a caller allocates payload space.
 * The returned summary deliberately excludes references and the payload hash.
 */
export function preflightTrustedWindowsNativeDataPlaneFrameHeaderV1(
  headerBytes: Uint8Array,
): TrustedWindowsNativeDataPlaneFrameHeaderPreflightV1;
export function preflightTrustedWindowsNativeDataPlaneFrameHeaderV1(
  headerBytes: unknown,
): TrustedWindowsNativeDataPlaneFrameHeaderPreflightV1 {
  return withGenericCodecErrors(() => {
    const header = copyExactHeader(headerBytes);
    try {
      const decoded = decodeFixedHeader(header);
      validateFrameReferenceSuffixes(header);
      return Object.freeze({
        kind: decodedWireKind(decoded.kind),
        workSequence: decoded.workSequence,
        chunkSequence: decoded.chunkSequence,
        terminal: (decoded.flags & FLAG_TERMINAL) !== 0,
        payloadLength: decoded.payloadLength,
        totalFrameLength:
          TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1 + decoded.payloadLength,
      });
    } finally {
      header.fill(0);
    }
  });
}

function decodeFrame(bytes: unknown): TrustedWindowsNativeDataPlaneFrameV1 {
  const frame = copyBoundedFrame(bytes);
  let detachedPayload: Buffer | undefined;
  try {
    const header = decodeFixedHeader(frame);
    if (
      intrinsicUint8ArrayByteLength(frame) !==
      TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1 + header.payloadLength
    ) {
      return fail("LENGTH_MISMATCH");
    }
    const references = decodeFrameReferences(frame, header.kind);
    const payload = decodePayload(frame);
    detachedPayload = payload;
    const common = {
      workSequence: header.workSequence,
      chunkSequence: header.chunkSequence,
      terminal: (header.flags & FLAG_TERMINAL) !== 0,
      sessionRef: references.sessionRef,
      requestRef: references.requestRef,
      scopeRef: references.scopeRef,
      transferRef: references.transferRef,
      payload,
    };
    const decoded: NormalizedFrameV1 = header.kind === KIND_SOURCE
      ? {
          ...common,
          kind: "source",
          sourceRef: references.containerRef,
          sourceFileRef: references.objectRef,
        }
      : header.kind === KIND_OUTPUT
        ? {
            ...common,
            kind: "output",
            runRef: references.containerRef,
            outputFileRef: references.objectRef,
          }
        : {
            ...common,
            kind: "catalog",
            sourceRef: references.containerRef,
            catalogRef: references.objectRef,
          };
    const result = attachRedactedRepresentations(decoded);
    detachedPayload = undefined;
    return result;
  } finally {
    frame.fill(0);
    detachedPayload?.fill(0);
  }
}

function copyBoundedFrame(bytes: unknown): Buffer {
  const source = intrinsicUint8ArrayWindow(bytes);
  const originalByteLength = source.byteLength;
  if (originalByteLength < TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1) {
    return fail("FRAME_TOO_SHORT");
  }
  if (
    originalByteLength >
    TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1 +
      TRUSTED_WINDOWS_NATIVE_DATA_PLANE_MAX_PAYLOAD_BYTES_V1
  ) {
    return fail("FRAME_TOO_LARGE");
  }
  const frame = copyIntrinsicUint8ArrayWindow(source);
  if (intrinsicUint8ArrayByteLength(frame) !== originalByteLength) {
    return fail("LENGTH_MISMATCH");
  }
  return frame;
}

function copyExactHeader(bytes: unknown): Buffer {
  const source = intrinsicUint8ArrayWindow(bytes);
  if (source.byteLength < TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1) {
    return fail("FRAME_TOO_SHORT");
  }
  if (source.byteLength !== TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1) {
    return fail("LENGTH_MISMATCH");
  }
  const header = copyIntrinsicUint8ArrayWindow(source);
  if (
    intrinsicUint8ArrayByteLength(header) !==
    TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1
  ) {
    return fail("LENGTH_MISMATCH");
  }
  return header;
}

function normalizeFrameInput(input: unknown): NormalizedFrameV1 {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return fail("INVALID_FRAME");
  }
  const kind = ownDataValue(input, "kind");
  if (kind !== "source" && kind !== "output" && kind !== "catalog") {
    return fail("INVALID_KIND");
  }
  const common = normalizeCommonFrame(input);
  try {
    const normalized: NormalizedFrameV1 = kind === "source"
      ? {
          ...common,
          kind,
          sourceRef: requiredReference(input, "sourceRef", SOURCE_REF_PREFIX),
          sourceFileRef: requiredReference(
            input,
            "sourceFileRef",
            SOURCE_FILE_REF_PREFIX,
          ),
        }
      : kind === "output"
        ? {
            ...common,
            kind,
            runRef: requiredReference(input, "runRef", RUN_REF_PREFIX),
            outputFileRef: requiredReference(
              input,
              "outputFileRef",
              OUTPUT_FILE_REF_PREFIX,
            ),
          }
        : {
            ...common,
            kind,
            sourceRef: requiredReference(input, "sourceRef", SOURCE_REF_PREFIX),
            catalogRef: requiredReference(input, "catalogRef", CATALOG_REF_PREFIX),
          };
    return attachRedactedRepresentations(normalized);
  } catch (error: unknown) {
    // Common-field normalization already owns a copy of the payload. A later
    // kind-specific rejection must not abandon that copy for garbage collection.
    common.payload.fill(0);
    throw error;
  }
}

function normalizeCommonFrame(input: object): NormalizedCommonFrameV1 {
  const terminal = ownDataValue(input, "terminal");
  if (typeof terminal !== "boolean") return fail("INVALID_FLAGS");
  const workSequence = ownDataValue(input, "workSequence");
  if (
    typeof workSequence !== "bigint" ||
    workSequence < 1n ||
    workSequence > MAX_WORK_SEQUENCE
  ) {
    return fail("INVALID_WORK_SEQUENCE");
  }
  const chunkSequence = ownDataValue(input, "chunkSequence");
  if (
    typeof chunkSequence !== "number" ||
    !Number.isInteger(chunkSequence) ||
    chunkSequence < 1 ||
    chunkSequence > MAX_CHUNK_SEQUENCE
  ) {
    return fail("INVALID_CHUNK_SEQUENCE");
  }
  const payload = copyBoundedPayload(ownDataValue(input, "payload"));
  try {
    validatePayloadShape(intrinsicUint8ArrayByteLength(payload), terminal, chunkSequence);
    return {
      workSequence,
      chunkSequence,
      terminal,
      sessionRef: requiredReference(input, "sessionRef", SESSION_REF_PREFIX),
      requestRef: requiredReference(input, "requestRef", REQUEST_REF_PREFIX),
      scopeRef: requiredReference(input, "scopeRef", SCOPE_REF_PREFIX),
      transferRef: requiredReference(input, "transferRef", TRANSFER_REF_PREFIX),
      payload,
    };
  } catch (error: unknown) {
    payload.fill(0);
    throw error;
  }
}

function copyBoundedPayload(value: unknown): Buffer {
  const source = intrinsicUint8ArrayWindow(value);
  const originalByteLength = source.byteLength;
  if (originalByteLength > TRUSTED_WINDOWS_NATIVE_DATA_PLANE_MAX_PAYLOAD_BYTES_V1) {
    return fail("FRAME_TOO_LARGE");
  }
  const copied = copyIntrinsicUint8ArrayWindow(source);
  if (intrinsicUint8ArrayByteLength(copied) !== originalByteLength) {
    return fail("LENGTH_MISMATCH");
  }
  return copied;
}

function validatePayloadShape(
  payloadLength: number,
  terminal: boolean,
  chunkSequence: number,
): void {
  if (payloadLength !== 0) return;
  if (!terminal) return fail("ZERO_LENGTH_NON_TERMINAL");
  if (chunkSequence !== 1) return fail("INVALID_EMPTY_OBJECT");
}

function requiredReference(input: object, key: string, prefix: string): string {
  const value = ownDataValue(input, key);
  if (typeof value !== "string") return fail("INVALID_REFERENCE");
  encodeReferenceSuffix(value, prefix);
  return value;
}

function ownDataValue(input: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (descriptor === undefined || !("value" in descriptor)) return fail("INVALID_FRAME");
  return descriptor.value as unknown;
}

function attachRedactedRepresentations<T extends NormalizedFrameV1>(frame: T): T {
  const summary: RedactedFrameSummaryV1 = Object.freeze({
    kind: frame.kind,
    workSequence: frame.workSequence.toString(10),
    chunkSequence: frame.chunkSequence,
    terminal: frame.terminal,
    payloadLength: intrinsicUint8ArrayByteLength(frame.payload),
  });
  const redact = (): RedactedFrameSummaryV1 => summary;
  Object.defineProperty(frame, NODE_INSPECT_CUSTOM, {
    configurable: false,
    enumerable: false,
    value: redact,
    writable: false,
  });
  Object.defineProperty(frame, "toJSON", {
    configurable: false,
    enumerable: false,
    value: redact,
    writable: false,
  });
  return frame;
}

function withGenericCodecErrors<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error: unknown) {
    const code = isObjectIdentity(error)
      ? INTERNAL_DATA_PLANE_ERRORS.get(error) ?? "INVALID_FRAME"
      : "INVALID_FRAME";
    throw new TrustedWindowsNativeDataPlaneFrameErrorV1(code);
  }
}

function captureTypedArrayGetter(key: PropertyKey): (receiver: object) => unknown {
  const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object | null;
  const descriptor = typedArrayPrototype === null
    ? undefined
    : Object.getOwnPropertyDescriptor(typedArrayPrototype, key);
  const getter: unknown = descriptor === undefined
    ? undefined
    : Reflect.get(descriptor, "get");
  if (typeof getter !== "function") {
    throw new Error("Required typed-array intrinsic is unavailable.");
  }
  return (receiver: object): unknown => Reflect.apply(getter, receiver, []);
}

function intrinsicUint8ArrayWindow(value: unknown): IntrinsicUint8ArrayWindow {
  if (!isObjectIdentity(value)) return fail("INVALID_FRAME");
  let tag: unknown;
  let buffer: unknown;
  let byteLength: unknown;
  let byteOffset: unknown;
  try {
    tag = TYPED_ARRAY_TAG_GETTER(value);
    buffer = TYPED_ARRAY_BUFFER_GETTER(value);
    byteLength = TYPED_ARRAY_BYTE_LENGTH_GETTER(value);
    byteOffset = TYPED_ARRAY_BYTE_OFFSET_GETTER(value);
  } catch {
    return fail("INVALID_FRAME");
  }
  if (
    tag !== "Uint8Array" ||
    typeof byteLength !== "number" ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    typeof byteOffset !== "number" ||
    !Number.isSafeInteger(byteOffset) ||
    byteOffset < 0
  ) {
    return fail("INVALID_FRAME");
  }
  return {
    buffer: buffer as ArrayBufferLike,
    byteLength,
    byteOffset,
  };
}

function intrinsicUint8ArrayByteLength(value: unknown): number {
  return intrinsicUint8ArrayWindow(value).byteLength;
}

function copyIntrinsicUint8ArrayWindow(source: IntrinsicUint8ArrayWindow): Buffer {
  let boundedView: Uint8Array;
  try {
    boundedView = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  } catch {
    return fail("INVALID_FRAME");
  }
  return Buffer.from(boundedView);
}

function isObjectIdentity(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function decodeFixedHeader(frame: Buffer): DecodedHeaderV1 {
  if (!frame.subarray(0, MAGIC.byteLength).equals(MAGIC)) {
    return fail("INVALID_MAGIC");
  }
  if (frame.readUInt16BE(VERSION_OFFSET) !== VERSION) {
    return fail("INVALID_VERSION");
  }
  if (
    frame.readUInt16BE(HEADER_SIZE_OFFSET) !==
    TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1
  ) {
    return fail("INVALID_HEADER_SIZE");
  }

  const kind = decodeWireKind(frame.readUInt8(KIND_OFFSET));
  const flags = frame.readUInt8(FLAGS_OFFSET);
  if ((flags & ~FLAG_TERMINAL) !== 0) {
    return fail("INVALID_FLAGS");
  }
  if (
    frame.readUInt16BE(RESERVED_U16_OFFSET) !== 0
  ) {
    return fail("NONZERO_RESERVED");
  }

  const workSequence = frame.readBigUInt64BE(WORK_SEQUENCE_OFFSET);
  if (workSequence === 0n) {
    return fail("INVALID_WORK_SEQUENCE");
  }
  const payloadLength = frame.readUInt32BE(PAYLOAD_LENGTH_OFFSET);
  if (payloadLength > TRUSTED_WINDOWS_NATIVE_DATA_PLANE_MAX_PAYLOAD_BYTES_V1) {
    return fail("FRAME_TOO_LARGE");
  }
  const chunkSequence = frame.readUInt32BE(CHUNK_SEQUENCE_OFFSET);
  if (chunkSequence === 0) {
    return fail("INVALID_CHUNK_SEQUENCE");
  }
  validatePayloadShape(
    payloadLength,
    (flags & FLAG_TERMINAL) !== 0,
    chunkSequence,
  );
  return { kind, flags, workSequence, chunkSequence, payloadLength };
}

function decodeWireKind(value: number): WireKindV1 {
  if (value !== KIND_SOURCE && value !== KIND_OUTPUT && value !== KIND_CATALOG) {
    return fail("INVALID_KIND");
  }
  return value;
}

function decodedWireKind(
  kind: WireKindV1,
): TrustedWindowsNativeDataPlaneFrameV1["kind"] {
  return kind === KIND_SOURCE
    ? "source"
    : kind === KIND_OUTPUT
      ? "output"
      : "catalog";
}

function validateFrameReferenceSuffixes(frame: Buffer): void {
  for (const offset of [
    SESSION_REF_OFFSET,
    REQUEST_REF_OFFSET,
    SCOPE_REF_OFFSET,
    CONTAINER_REF_OFFSET,
    OBJECT_REF_OFFSET,
    TRANSFER_REF_OFFSET,
  ]) {
    validateReferenceSuffix(frame, offset);
  }
}

function decodeFrameReferences(frame: Buffer, kind: WireKindV1): DecodedReferencesV1 {
  return {
    sessionRef: decodeReference(frame, SESSION_REF_OFFSET, SESSION_REF_PREFIX),
    requestRef: decodeReference(frame, REQUEST_REF_OFFSET, REQUEST_REF_PREFIX),
    scopeRef: decodeReference(frame, SCOPE_REF_OFFSET, SCOPE_REF_PREFIX),
    containerRef: decodeReference(
      frame,
      CONTAINER_REF_OFFSET,
      kind === KIND_OUTPUT ? RUN_REF_PREFIX : SOURCE_REF_PREFIX,
    ),
    objectRef: decodeReference(
      frame,
      OBJECT_REF_OFFSET,
      kind === KIND_SOURCE
        ? SOURCE_FILE_REF_PREFIX
        : kind === KIND_OUTPUT
          ? OUTPUT_FILE_REF_PREFIX
          : CATALOG_REF_PREFIX,
    ),
    transferRef: decodeReference(frame, TRANSFER_REF_OFFSET, TRANSFER_REF_PREFIX),
  };
}

function decodePayload(frame: Buffer): Buffer {
  const payload = frame.subarray(TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1);
  const expectedHash = frame.subarray(
    PAYLOAD_SHA256_OFFSET,
    TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1,
  );
  const observedHash = createHash("sha256").update(payload).digest();
  if (!timingSafeEqual(expectedHash, observedHash)) {
    return fail("PAYLOAD_HASH_MISMATCH");
  }
  return Buffer.from(payload);
}

function encodeFixedHeader(
  frame: TrustedWindowsNativeDataPlaneFrameV1,
  payload: Buffer,
): Buffer {
  const header = Buffer.alloc(TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1);
  MAGIC.copy(header, 0);
  header.writeUInt16BE(VERSION, VERSION_OFFSET);
  header.writeUInt16BE(
    TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1,
    HEADER_SIZE_OFFSET,
  );
  header[KIND_OFFSET] = frame.kind === "source"
    ? KIND_SOURCE
    : frame.kind === "output"
      ? KIND_OUTPUT
      : KIND_CATALOG;
  header[FLAGS_OFFSET] = frame.terminal ? FLAG_TERMINAL : 0;
  header.writeBigUInt64BE(frame.workSequence, WORK_SEQUENCE_OFFSET);
  header.writeUInt32BE(payload.byteLength, PAYLOAD_LENGTH_OFFSET);
  header.writeUInt32BE(frame.chunkSequence, CHUNK_SEQUENCE_OFFSET);
  createHash("sha256").update(payload).digest().copy(header, PAYLOAD_SHA256_OFFSET);
  return header;
}

function writeFrameReferences(
  header: Buffer,
  frame: TrustedWindowsNativeDataPlaneFrameV1,
): void {
  const containerReference = frame.kind === "output"
    ? encodeReferenceSuffix(frame.runRef, RUN_REF_PREFIX)
    : encodeReferenceSuffix(frame.sourceRef, SOURCE_REF_PREFIX);
  const objectReference = frame.kind === "source"
    ? encodeReferenceSuffix(frame.sourceFileRef, SOURCE_FILE_REF_PREFIX)
    : frame.kind === "output"
      ? encodeReferenceSuffix(frame.outputFileRef, OUTPUT_FILE_REF_PREFIX)
      : encodeReferenceSuffix(frame.catalogRef, CATALOG_REF_PREFIX);
  const references: readonly (readonly [number, Buffer])[] = [
    [SESSION_REF_OFFSET, encodeReferenceSuffix(frame.sessionRef, SESSION_REF_PREFIX)],
    [REQUEST_REF_OFFSET, encodeReferenceSuffix(frame.requestRef, REQUEST_REF_PREFIX)],
    [SCOPE_REF_OFFSET, encodeReferenceSuffix(frame.scopeRef, SCOPE_REF_PREFIX)],
    [CONTAINER_REF_OFFSET, containerReference],
    [OBJECT_REF_OFFSET, objectReference],
    [TRANSFER_REF_OFFSET, encodeReferenceSuffix(frame.transferRef, TRANSFER_REF_PREFIX)],
  ];
  for (const [offset, reference] of references) {
    reference.copy(header, offset);
  }
}

function encodeReferenceSuffix(value: string, prefix: string): Buffer {
  const suffix = value.startsWith(prefix) ? value.slice(prefix.length) : "";
  if (
    suffix.length !== REFERENCE_SUFFIX_HEX_LENGTH ||
    !LOWER_HEX_PATTERN.test(suffix)
  ) {
    return fail("INVALID_REFERENCE");
  }
  const decoded = Buffer.from(suffix, "hex");
  if (
    decoded.byteLength !== REFERENCE_SUFFIX_BYTES ||
    decoded.every((byte) => byte === 0)
  ) {
    return fail("INVALID_REFERENCE");
  }
  return decoded;
}

function decodeReference(frame: Buffer, offset: number, prefix: string): string {
  const suffix = validateReferenceSuffix(frame, offset);
  return `${prefix}${suffix.toString("hex")}`;
}

function validateReferenceSuffix(frame: Buffer, offset: number): Buffer {
  const suffix = frame.subarray(offset, offset + REFERENCE_SUFFIX_BYTES);
  if (suffix.every((byte) => byte === 0)) {
    return fail("INVALID_REFERENCE");
  }
  return suffix;
}

function failTransferOrder(
  code: TrustedWindowsNativeDataPlaneTransferOrderErrorCodeV1,
): never {
  throw new TrustedWindowsNativeDataPlaneTransferOrderErrorV1(code);
}

function fail(code: TrustedWindowsNativeDataPlaneFrameErrorCodeV1): never {
  const signal = new Error("Internal data-plane codec rejection.");
  INTERNAL_DATA_PLANE_ERRORS.set(signal, code);
  throw signal;
}
