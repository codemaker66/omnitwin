import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { format, inspect } from "node:util";

import { describe, expect, it, vi } from "vitest";

import {
  decodeTrustedWindowsNativeDataPlaneFrameV1,
  encodeTrustedWindowsNativeDataPlaneFrameV1,
  createTrustedWindowsNativeDataPlaneFrameV1,
  preflightTrustedWindowsNativeDataPlaneFrameHeaderV1,
  TrustedWindowsNativeDataPlaneFrameErrorV1,
  TrustedWindowsNativeDataPlaneTransferOrderErrorV1,
  TrustedWindowsNativeDataPlaneTransferOrderValidatorV1,
  TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1,
  TRUSTED_WINDOWS_NATIVE_DATA_PLANE_MAX_PAYLOAD_BYTES_V1,
  type TrustedWindowsNativeCatalogDataPlaneFrameV1,
  type TrustedWindowsNativeDataPlaneFrameErrorCodeV1,
  type TrustedWindowsNativeDataPlaneFrameV1,
  type TrustedWindowsNativeDataPlaneTransferOrderErrorCodeV1,
  type TrustedWindowsNativeOutputDataPlaneFrameV1,
  type TrustedWindowsNativeSourceDataPlaneFrameV1,
} from "../trusted-windows-native-source-data-plane-frame.js";

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

const SESSION = "helper_session_000102030405060708090a0b0c0d0e0f";
const REQUEST = "helper_request_101112131415161718191a1b1c1d1e1f";
const SCOPE = "helper_scope_202122232425262728292a2b2c2d2e2f";
const SOURCE = "helper_source_303132333435363738393a3b3c3d3e3f";
const SOURCE_FILE = "helper_source_file_404142434445464748494a4b4c4d4e4f";
const RUN = "helper_run_505152535455565758595a5b5c5d5e5f";
const OUTPUT_FILE = "helper_output_file_606162636465666768696a6b6c6d6e6f";
const TRANSFER = "helper_transfer_707172737475767778797a7b7c7d7e7f";
const CATALOG = "helper_catalog_808182838485868788898a8b8c8d8e8f";
const SOURCE_FILE_2 = "helper_source_file_909192939495969798999a9b9c9d9e9f";
const SOURCE_FILE_3 = "helper_source_file_a0a1a2a3a4a5a6a7a8a9aaabacadaeaf";
const SOURCE_2 = "helper_source_b0b1b2b3b4b5b6b7b8b9babbbcbdbebf";
const SESSION_2 = "helper_session_c0c1c2c3c4c5c6c7c8c9cacbcccdcecf";
const REQUEST_2 = "helper_request_d0d1d2d3d4d5d6d7d8d9dadbdcdddedf";
const SCOPE_2 = "helper_scope_e0e1e2e3e4e5e6e7e8e9eaebecedeeef";
const TRANSFER_2 = "helper_transfer_f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff";

interface GoldenFixture {
  readonly format: string;
  readonly version: number;
  readonly header_size_bytes: number;
  readonly max_payload_bytes: number;
  readonly vectors: readonly GoldenVector[];
}

interface GoldenVector {
  readonly name: string;
  readonly kind: "source" | "output" | "catalog";
  readonly terminal: boolean;
  readonly work_sequence_decimal: string;
  readonly chunk_sequence_decimal: string;
  readonly session_ref: string;
  readonly request_ref: string;
  readonly scope_ref: string;
  readonly container_ref: string;
  readonly object_ref: string;
  readonly transfer_ref: string;
  readonly payload_hex: string;
  readonly payload_sha256_hex: string;
  readonly frame_hex: string;
}

const GOLDEN_FIXTURE = JSON.parse(readFileSync(new URL(
  "../../native/windows-source-helper/test-vectors/vnsdp01-golden-vectors.json",
  import.meta.url,
), "utf8")) as GoldenFixture;

describe("trusted Windows native VNSDP01 data-plane frame codec", () => {
  it("uses the shared Rust/TypeScript golden vectors exactly", () => {
    expect(GOLDEN_FIXTURE).toMatchObject({
      format: "VNSDP01",
      version: 1,
      header_size_bytes: TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1,
      max_payload_bytes: TRUSTED_WINDOWS_NATIVE_DATA_PLANE_MAX_PAYLOAD_BYTES_V1,
    });
    expect(GOLDEN_FIXTURE.vectors).toHaveLength(3);

    for (const vector of GOLDEN_FIXTURE.vectors) {
      const expected = frameFromGolden(vector);
      const encoded = encodeTrustedWindowsNativeDataPlaneFrameV1(expected);
      expect(Buffer.from(encoded).toString("hex"), vector.name).toBe(vector.frame_hex);
      expect(
        createHash("sha256").update(expected.payload).digest("hex"),
        vector.name,
      ).toBe(vector.payload_sha256_hex);
      expect(decodeTrustedWindowsNativeDataPlaneFrameV1(encoded)).toEqual(expected);
    }
  });

  it("preserves raw catalog bytes containing an unpaired UTF-16 surrogate", () => {
    const rawUtf16 = Buffer.from("0041d8000042", "hex");
    const expected = catalogFrame({ payload: rawUtf16 });
    const encoded = encodeTrustedWindowsNativeDataPlaneFrameV1(expected);

    expect(encoded[KIND_OFFSET]).toBe(3);
    expect(Buffer.from(encoded).readUInt32BE(CHUNK_SEQUENCE_OFFSET)).toBe(1);
    const decoded = decodeTrustedWindowsNativeDataPlaneFrameV1(encoded);
    expect(decoded).toEqual(expected);
    expect(decoded.kind).toBe("catalog");
    expect(Buffer.from(decoded.payload)).toEqual(rawUtf16);
    if (decoded.kind !== "catalog") expect.fail("Expected a catalog frame");
    expect(decoded.sourceRef).toBe(SOURCE);
    expect(decoded.catalogRef).toBe(CATALOG);
  });

  it("preflights exactly one header without returning references or its hash", () => {
    const encoded = encodeTrustedWindowsNativeDataPlaneFrameV1(outputFrame({
      workSequence: 0x0102_0304_0506_0708n,
      chunkSequence: 0x0102_0304,
      payload: Buffer.from("private payload"),
    }));
    const header = encoded.subarray(
      0,
      TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1,
    );
    const preflight = preflightTrustedWindowsNativeDataPlaneFrameHeaderV1(header);

    expect(preflight).toEqual({
      kind: "output",
      workSequence: 0x0102_0304_0506_0708n,
      chunkSequence: 0x0102_0304,
      terminal: true,
      payloadLength: 15,
      totalFrameLength: TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1 + 15,
    });
    expect(Object.isFrozen(preflight)).toBe(true);
    expect(Object.keys(preflight)).toEqual([
      "kind",
      "workSequence",
      "chunkSequence",
      "terminal",
      "payloadLength",
      "totalFrameLength",
    ]);
    const inspected = inspect(preflight, { breakLength: Infinity });
    for (const privateMarker of [
      SESSION,
      REQUEST,
      SCOPE,
      RUN,
      OUTPUT_FILE,
      TRANSFER,
      createHash("sha256").update("private payload").digest("hex"),
    ]) {
      expect(inspected).not.toContain(privateMarker);
    }
  });

  it("preflight rejects non-exact, oversized, zero-reference, and zero-progress headers", () => {
    const encoded = Buffer.from(encodeTrustedWindowsNativeDataPlaneFrameV1(sourceFrame({
      terminal: true,
      payload: Buffer.from("payload"),
    })));
    const header = encoded.subarray(
      0,
      TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1,
    );
    expectFrameError(
      () => preflightTrustedWindowsNativeDataPlaneFrameHeaderV1(header.subarray(0, -1)),
      "FRAME_TOO_SHORT",
    );
    expectFrameError(
      () => preflightTrustedWindowsNativeDataPlaneFrameHeaderV1(Buffer.concat([
        header,
        Buffer.from([0]),
      ])),
      "LENGTH_MISMATCH",
    );

    const oversized = Buffer.from(header);
    oversized.writeUInt32BE(
      TRUSTED_WINDOWS_NATIVE_DATA_PLANE_MAX_PAYLOAD_BYTES_V1 + 1,
      PAYLOAD_LENGTH_OFFSET,
    );
    expectFrameError(
      () => preflightTrustedWindowsNativeDataPlaneFrameHeaderV1(oversized),
      "FRAME_TOO_LARGE",
    );

    const zeroReference = Buffer.from(header);
    zeroReference.fill(0, OBJECT_REF_OFFSET, OBJECT_REF_OFFSET + 16);
    expectFrameError(
      () => preflightTrustedWindowsNativeDataPlaneFrameHeaderV1(zeroReference),
      "INVALID_REFERENCE",
    );

    const zeroProgress = Buffer.from(header);
    zeroProgress[FLAGS_OFFSET] = 0;
    zeroProgress.writeUInt32BE(0, PAYLOAD_LENGTH_OFFSET);
    expectFrameError(
      () => preflightTrustedWindowsNativeDataPlaneFrameHeaderV1(zeroProgress),
      "ZERO_LENGTH_NON_TERMINAL",
    );
  });

  it("redacts Node inspection, console formatting, and JSON without hiding trusted access", () => {
    const marker = "PRIVATE_PAYLOAD_MARKER";
    const constructed = createTrustedWindowsNativeDataPlaneFrameV1(sourceFrame({
      payload: Buffer.from(marker),
    }));
    const decoded = decodeTrustedWindowsNativeDataPlaneFrameV1(
      encodeTrustedWindowsNativeDataPlaneFrameV1(constructed),
    );

    for (const frame of [constructed, decoded]) {
      const inspected = inspect(frame, { breakLength: Infinity });
      const consoleFormatted = format("%O", frame);
      const serialized = JSON.stringify(frame);
      expect(inspected).toContain("kind: 'source'");
      expect(inspected).toContain("workSequence: '1'");
      expect(inspected).toContain("chunkSequence: 1");
      expect(inspected).toContain("payloadLength: 22");
      expect(consoleFormatted).toContain("payloadLength: 22");
      expect(JSON.parse(serialized)).toEqual({
        kind: "source",
        workSequence: "1",
        chunkSequence: 1,
        terminal: false,
        payloadLength: 22,
      });
      for (const privateMarker of [SESSION, REQUEST, SCOPE, SOURCE, SOURCE_FILE, TRANSFER, marker]) {
        expect(inspected).not.toContain(privateMarker);
        expect(consoleFormatted).not.toContain(privateMarker);
        expect(serialized).not.toContain(privateMarker);
      }
      expect(Object.prototype.propertyIsEnumerable.call(frame, "toJSON")).toBe(false);
      expect(Object.prototype.propertyIsEnumerable.call(
        frame,
        Symbol.for("nodejs.util.inspect.custom"),
      )).toBe(false);
      expect(frame.sessionRef).toBe(SESSION);
      expect(Buffer.from(frame.payload).toString("utf8")).toBe(marker);
    }
  });

  it("turns malformed runtime inputs into generic codec errors without invoking getters", () => {
    const privateText = "C:\\private\\source.e57";
    let getterCalls = 0;
    const accessorInput = Object.defineProperty({}, "kind", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error(privateText);
      },
    });
    const chunkAccessorInput = Object.defineProperty(
      { ...sourceFrame() },
      "chunkSequence",
      {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          throw new Error(privateText);
        },
      },
    );
    const malformed: readonly [unknown, TrustedWindowsNativeDataPlaneFrameErrorCodeV1][] = [
      [null, "INVALID_FRAME"],
      [{}, "INVALID_FRAME"],
      [{ ...sourceFrame(), kind: "other" }, "INVALID_KIND"],
      [{ ...sourceFrame(), terminal: "false" }, "INVALID_FLAGS"],
      [{ ...sourceFrame(), workSequence: 1 }, "INVALID_WORK_SEQUENCE"],
      [{ ...sourceFrame(), chunkSequence: undefined }, "INVALID_CHUNK_SEQUENCE"],
      [{ ...sourceFrame(), chunkSequence: 0 }, "INVALID_CHUNK_SEQUENCE"],
      [{ ...sourceFrame(), chunkSequence: 1.5 }, "INVALID_CHUNK_SEQUENCE"],
      [{ ...sourceFrame(), chunkSequence: 0x1_0000_0000 }, "INVALID_CHUNK_SEQUENCE"],
      [{ ...sourceFrame(), chunkSequence: Number.NaN }, "INVALID_CHUNK_SEQUENCE"],
      [{ ...sourceFrame(), payload: [] }, "INVALID_FRAME"],
      [{ ...sourceFrame(), payload: new Proxy(new Uint8Array(0), {}) }, "INVALID_FRAME"],
      [{ ...sourceFrame(), sourceRef: undefined }, "INVALID_REFERENCE"],
      [{ ...outputFrame(), outputFileRef: undefined }, "INVALID_REFERENCE"],
      [{ ...catalogFrame(), catalogRef: undefined }, "INVALID_REFERENCE"],
      [accessorInput, "INVALID_FRAME"],
      [chunkAccessorInput, "INVALID_FRAME"],
    ];
    for (const [input, code] of malformed) {
      expectFrameError(() => encodeRuntime(input), code);
    }
    expect(getterCalls).toBe(0);
    expectFrameError(() => decodeRuntime({ byteLength: 160 }), "INVALID_FRAME");
    expectFrameError(
      () => decodeRuntime(new Proxy(new Uint8Array(160), {})),
      "INVALID_FRAME",
    );

    let prototypeTrapCalls = 0;
    const hostileThrownValue = new Proxy(new Error(privateText), {
      getPrototypeOf: () => {
        prototypeTrapCalls += 1;
        throw new Error(privateText);
      },
    });
    const hostileInput = new Proxy({}, {
      getOwnPropertyDescriptor: () => {
        throw hostileThrownValue;
      },
    });
    try {
      encodeRuntime(hostileInput);
      expect.fail("Expected hostile proxy input to fail closed");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(TrustedWindowsNativeDataPlaneFrameErrorV1);
      expect(error).toMatchObject({ code: "INVALID_FRAME" });
      expect((error as Error).message).toBe(
        "Trusted Windows native data-plane frame rejected: INVALID_FRAME",
      );
    }
    expect(prototypeTrapCalls).toBe(0);
  });

  it("wipes owned payload copies after later rejection and metadata-only validation", () => {
    const privatePayload = Buffer.from("owned-copy-cleanup-regression-37-byte!");
    expect(privatePayload.byteLength).toBe(38);
    const fillSpy = vi.spyOn(Buffer.prototype, "fill");
    let observedFillReceivers: unknown[] = [];
    try {
      expectFrameError(
        () => encodeRuntime(sourceFrame({
          payload: privatePayload,
          sessionRef: "invalid",
        })),
        "INVALID_REFERENCE",
      );
      expect(privatePayload.toString("utf8")).toBe(
        "owned-copy-cleanup-regression-37-byte!",
      );

      expectFrameError(
        () => encodeRuntime(sourceFrame({
          payload: privatePayload,
          sourceRef: "invalid",
        })),
        "INVALID_REFERENCE",
      );
      expect(privatePayload.toString("utf8")).toBe(
        "owned-copy-cleanup-regression-37-byte!",
      );

      const validator = new TrustedWindowsNativeDataPlaneTransferOrderValidatorV1();
      validator.validateFrame(sourceFrame({ payload: privatePayload, terminal: true }));
      validator.finish();
      expect(privatePayload.toString("utf8")).toBe(
        "owned-copy-cleanup-regression-37-byte!",
      );
    } finally {
      observedFillReceivers = [...fillSpy.mock.instances];
      fillSpy.mockRestore();
    }

    const wipedCopies = observedFillReceivers.filter((instance) =>
      Buffer.isBuffer(instance) &&
      instance !== privatePayload &&
      instance.byteLength === privatePayload.byteLength &&
      instance.every((byte) => byte === 0)
    );
    expect(wipedCopies).toHaveLength(3);
  });

  it("uses intrinsic typed-array length and rejects shadowed oversize before copying", () => {
    const oversized = new Uint8Array(
      TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1 +
        TRUSTED_WINDOWS_NATIVE_DATA_PLANE_MAX_PAYLOAD_BYTES_V1 + 1,
    );
    Object.defineProperty(oversized, "byteLength", {
      configurable: true,
      value: 0,
    });
    expect(oversized.byteLength).toBe(0);

    for (const action of [
      () => encodeRuntime(sourceFrame({ payload: oversized })),
      () => decodeRuntime(oversized),
    ]) {
      const bufferFrom = vi.spyOn(Buffer, "from");
      let thrown: unknown;
      try {
        action();
      } catch (error: unknown) {
        thrown = error;
      }
      const copyCalls = bufferFrom.mock.calls.length;
      bufferFrom.mockRestore();

      expect(copyCalls).toBe(0);
      expect(thrown).toBeInstanceOf(TrustedWindowsNativeDataPlaneFrameErrorV1);
      expect(thrown).toMatchObject({ code: "FRAME_TOO_LARGE" });
    }
  });

  it("ignores a shadowed typed-array length while making the bounded copy", () => {
    let lengthGetterCalls = 0;
    const payload = Uint8Array.from([0x41, 0x42, 0x43]);
    Object.defineProperty(payload, "length", {
      configurable: true,
      get: () => {
        lengthGetterCalls += 1;
        return 100;
      },
    });

    const encoded = encodeRuntime(sourceFrame({ payload }));
    expect(encoded).toHaveLength(
      TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1 + 3,
    );
    expect(lengthGetterCalls).toBe(0);

    const frame = Uint8Array.from(encoded);
    Object.defineProperty(frame, "length", {
      configurable: true,
      get: () => {
        lengthGetterCalls += 1;
        return 1;
      },
    });
    const decoded = decodeRuntime(frame);
    expect(Buffer.from(decoded.payload).toString("ascii")).toBe("ABC");
    expect(lengthGetterCalls).toBe(0);
  });

  it("uses one terminal chunk at sequence one as the only empty-object form", () => {
    const canonicalEmpty = sourceFrame({
      terminal: true,
      chunkSequence: 1,
      payload: Buffer.alloc(0),
    });
    const encoded = encodeTrustedWindowsNativeDataPlaneFrameV1(canonicalEmpty);
    expect(encoded).toHaveLength(TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1);
    expect(decodeTrustedWindowsNativeDataPlaneFrameV1(encoded)).toEqual(canonicalEmpty);

    expectFrameError(
      () => encodeRuntime(sourceFrame({ terminal: false, payload: Buffer.alloc(0) })),
      "ZERO_LENGTH_NON_TERMINAL",
    );
    expectFrameError(
      () => encodeRuntime(sourceFrame({
        terminal: true,
        chunkSequence: 2,
        payload: Buffer.alloc(0),
      })),
      "INVALID_EMPTY_OBJECT",
    );

    const nonTerminalWire = Buffer.from(encoded);
    nonTerminalWire[FLAGS_OFFSET] = 0;
    expectFrameError(
      () => decodeRuntime(nonTerminalWire),
      "ZERO_LENGTH_NON_TERMINAL",
    );
    const lateEmptyWire = Buffer.from(encoded);
    lateEmptyWire.writeUInt32BE(2, CHUNK_SEQUENCE_OFFSET);
    expectFrameError(
      () => decodeRuntime(lateEmptyWire),
      "INVALID_EMPTY_OBJECT",
    );
  });

  it("roundtrips the one-mebibyte boundary and rejects one byte more", () => {
    const maximum = sourceFrame({
      payload: Buffer.alloc(TRUSTED_WINDOWS_NATIVE_DATA_PLANE_MAX_PAYLOAD_BYTES_V1, 0xa5),
    });
    const encoded = encodeTrustedWindowsNativeDataPlaneFrameV1(maximum);
    expect(encoded).toHaveLength(
      TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1 +
      TRUSTED_WINDOWS_NATIVE_DATA_PLANE_MAX_PAYLOAD_BYTES_V1,
    );
    expect(decodeTrustedWindowsNativeDataPlaneFrameV1(encoded)).toEqual(maximum);

    expectFrameError(
      () => encodeTrustedWindowsNativeDataPlaneFrameV1(sourceFrame({
        payload: Buffer.alloc(
          TRUSTED_WINDOWS_NATIVE_DATA_PLANE_MAX_PAYLOAD_BYTES_V1 + 1,
        ),
      })),
      "FRAME_TOO_LARGE",
    );
    expectFrameError(
      () => decodeTrustedWindowsNativeDataPlaneFrameV1(Buffer.alloc(
        TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1 +
        TRUSTED_WINDOWS_NATIVE_DATA_PLANE_MAX_PAYLOAD_BYTES_V1 + 1,
      )),
      "FRAME_TOO_LARGE",
    );
  });

  it("rejects every malformed fixed-header field", () => {
    const valid = encodeTrustedWindowsNativeDataPlaneFrameV1(sourceFrame({
      payload: Buffer.from("abc"),
    }));
    const cases: readonly [Uint8Array, TrustedWindowsNativeDataPlaneFrameErrorCodeV1][] = [
      [mutated(valid, 0, 0x58), "INVALID_MAGIC"],
      [mutated(valid, VERSION_OFFSET + 1, 2), "INVALID_VERSION"],
      [mutated(valid, HEADER_SIZE_OFFSET + 1, 159), "INVALID_HEADER_SIZE"],
      [mutated(valid, KIND_OFFSET, 4), "INVALID_KIND"],
      [mutated(valid, FLAGS_OFFSET, 2), "INVALID_FLAGS"],
      [mutated(valid, RESERVED_U16_OFFSET, 1), "NONZERO_RESERVED"],
      [mutated(valid, CHUNK_SEQUENCE_OFFSET + 3, 0), "INVALID_CHUNK_SEQUENCE"],
    ];
    for (const [bytes, code] of cases) {
      expectFrameError(() => decodeTrustedWindowsNativeDataPlaneFrameV1(bytes), code);
    }
  });

  it("rejects short, truncated, trailing, hash-mismatched, and zero-sequence frames", () => {
    expectFrameError(
      () => decodeTrustedWindowsNativeDataPlaneFrameV1(Buffer.alloc(
        TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1 - 1,
      )),
      "FRAME_TOO_SHORT",
    );
    const valid = encodeTrustedWindowsNativeDataPlaneFrameV1(sourceFrame({
      payload: Buffer.from("abc"),
    }));

    const declaredShorter = Buffer.from(valid);
    declaredShorter.writeUInt32BE(2, PAYLOAD_LENGTH_OFFSET);
    expectFrameError(
      () => decodeTrustedWindowsNativeDataPlaneFrameV1(declaredShorter),
      "LENGTH_MISMATCH",
    );
    expectFrameError(
      () => decodeTrustedWindowsNativeDataPlaneFrameV1(valid.slice(0, -1)),
      "LENGTH_MISMATCH",
    );
    expectFrameError(
      () => decodeTrustedWindowsNativeDataPlaneFrameV1(Uint8Array.from([...valid, 0])),
      "LENGTH_MISMATCH",
    );
    expectFrameError(
      () => decodeTrustedWindowsNativeDataPlaneFrameV1(
        mutated(valid, PAYLOAD_SHA256_OFFSET, 0),
      ),
      "PAYLOAD_HASH_MISMATCH",
    );

    const zeroSequence = Buffer.from(valid);
    zeroSequence.fill(0, WORK_SEQUENCE_OFFSET, PAYLOAD_LENGTH_OFFSET);
    expectFrameError(
      () => decodeTrustedWindowsNativeDataPlaneFrameV1(zeroSequence),
      "INVALID_WORK_SEQUENCE",
    );
  });

  it("rejects a declared payload larger than the cap before its length mismatch", () => {
    const frame = Buffer.from(encodeTrustedWindowsNativeDataPlaneFrameV1(sourceFrame()));
    frame.writeUInt32BE(
      TRUSTED_WINDOWS_NATIVE_DATA_PLANE_MAX_PAYLOAD_BYTES_V1 + 1,
      PAYLOAD_LENGTH_OFFSET,
    );
    expectFrameError(
      () => decodeTrustedWindowsNativeDataPlaneFrameV1(frame),
      "FRAME_TOO_LARGE",
    );
  });

  it("requires every encoded reference to use its exact lowercase nonzero form", () => {
    const malformedSessions = [
      "helper_session_00000000000000000000000000000000",
      "helper_session_000102030405060708090A0B0C0D0E0F",
      "wrong_000102030405060708090a0b0c0d0e0f",
      "helper_session_000102030405060708090a0b0c0d0e",
    ];
    for (const sessionRef of malformedSessions) {
      expectFrameError(
        () => encodeTrustedWindowsNativeDataPlaneFrameV1(sourceFrame({ sessionRef })),
        "INVALID_REFERENCE",
      );
    }

    const malformedFields: readonly Partial<TrustedWindowsNativeSourceDataPlaneFrameV1>[] = [
      { sessionRef: "bad" },
      { requestRef: "bad" },
      { scopeRef: "bad" },
      { sourceRef: "bad" },
      { sourceFileRef: "bad" },
      { transferRef: "bad" },
    ];
    for (const malformed of malformedFields) {
      expectFrameError(
        () => encodeTrustedWindowsNativeDataPlaneFrameV1(sourceFrame(malformed)),
        "INVALID_REFERENCE",
      );
    }

    expectFrameError(
      () => encodeTrustedWindowsNativeDataPlaneFrameV1(outputFrame({
        runRef: SOURCE,
        outputFileRef: SOURCE_FILE,
      })),
      "INVALID_REFERENCE",
    );
    expectFrameError(
      () => encodeRuntime({ ...catalogFrame(), catalogRef: SOURCE_FILE }),
      "INVALID_REFERENCE",
    );
  });

  it("rejects a zero decoded reference suffix and invalid encode sequences", () => {
    const encoded = Buffer.from(
      encodeTrustedWindowsNativeDataPlaneFrameV1(sourceFrame()),
    );
    for (const offset of [
      SESSION_REF_OFFSET,
      REQUEST_REF_OFFSET,
      SCOPE_REF_OFFSET,
      CONTAINER_REF_OFFSET,
      OBJECT_REF_OFFSET,
      TRANSFER_REF_OFFSET,
    ]) {
      const zeroReference = Buffer.from(encoded);
      zeroReference.fill(0, offset, offset + 16);
      expectFrameError(
        () => decodeTrustedWindowsNativeDataPlaneFrameV1(zeroReference),
        "INVALID_REFERENCE",
      );
    }
    for (const workSequence of [0n, -1n, 0x1_0000_0000_0000_0000n]) {
      expectFrameError(
        () => encodeTrustedWindowsNativeDataPlaneFrameV1(sourceFrame({ workSequence })),
        "INVALID_WORK_SEQUENCE",
      );
    }
  });

  it("writes the full u64 work sequence in big-endian order without number loss", () => {
    const expected = sourceFrame({ workSequence: 0x0102_0304_0506_0708n });
    const encoded = encodeTrustedWindowsNativeDataPlaneFrameV1(expected);
    expect(Buffer.from(encoded).subarray(WORK_SEQUENCE_OFFSET, PAYLOAD_LENGTH_OFFSET))
      .toEqual(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(decodeTrustedWindowsNativeDataPlaneFrameV1(encoded)).toEqual(expected);

    const maximum = sourceFrame({ workSequence: 0xffff_ffff_ffff_ffffn });
    const maximumEncoded = encodeTrustedWindowsNativeDataPlaneFrameV1(maximum);
    expect(Buffer.from(maximumEncoded).subarray(
      WORK_SEQUENCE_OFFSET,
      PAYLOAD_LENGTH_OFFSET,
    )).toEqual(Buffer.alloc(8, 0xff));
    expect(decodeTrustedWindowsNativeDataPlaneFrameV1(maximumEncoded)).toEqual(maximum);
  });

  it("writes the required u32 chunk sequence in big-endian order", () => {
    const expected = outputFrame({
      chunkSequence: 0x0102_0304,
      payload: Buffer.from("final"),
    });
    const encoded = encodeTrustedWindowsNativeDataPlaneFrameV1(expected);
    expect(Buffer.from(encoded).subarray(CHUNK_SEQUENCE_OFFSET, SESSION_REF_OFFSET))
      .toEqual(Buffer.from([1, 2, 3, 4]));
    expect(decodeTrustedWindowsNativeDataPlaneFrameV1(encoded)).toEqual(expected);

    const maximum = outputFrame({
      chunkSequence: 0xffff_ffff,
      payload: Buffer.from("final"),
    });
    const maximumEncoded = encodeTrustedWindowsNativeDataPlaneFrameV1(maximum);
    expect(Buffer.from(maximumEncoded).subarray(
      CHUNK_SEQUENCE_OFFSET,
      SESSION_REF_OFFSET,
    )).toEqual(Buffer.alloc(4, 0xff));
    expect(decodeTrustedWindowsNativeDataPlaneFrameV1(maximumEncoded)).toEqual(maximum);
  });
});

describe("trusted Windows native data-plane transfer order validator", () => {
  it("accepts contiguous chunks and ordered terminal object switches", () => {
    const validator = new TrustedWindowsNativeDataPlaneTransferOrderValidatorV1();

    validator.validateFrame(sourceFrame({
      chunkSequence: 1,
      terminal: false,
      payload: Buffer.from("first"),
    }));
    validator.validateFrame(sourceFrame({
      chunkSequence: 2,
      terminal: true,
      payload: Buffer.from("final"),
    }));
    validator.validateFrame(sourceFrame({
      sourceFileRef: SOURCE_FILE_2,
      chunkSequence: 1,
      terminal: true,
      payload: Buffer.alloc(0),
    }));
    validator.validateFrame(sourceFrame({
      sourceRef: SOURCE_2,
      sourceFileRef: SOURCE_FILE_3,
      chunkSequence: 1,
      terminal: true,
      payload: Buffer.from("other source"),
    }));

    expect(validator.objectCount).toBe(3);
    expect(() => { validator.finish(); }).not.toThrow();
    expectTransferOrderError(() => { validator.finish(); }, "ALREADY_FINISHED");
    expectTransferOrderError(
      () => { validator.validateFrame(sourceFrame({ terminal: true })); },
      "ALREADY_FINISHED",
    );
  });

  it("requires every object to start at chunk one", () => {
    const validator = new TrustedWindowsNativeDataPlaneTransferOrderValidatorV1();
    expectTransferOrderError(
      () => { validator.validateFrame(sourceFrame({
        chunkSequence: 2,
        terminal: true,
      })); },
      "INVALID_FIRST_CHUNK_SEQUENCE",
    );

    validator.validateFrame(sourceFrame({ terminal: true, payload: Buffer.alloc(0) }));
    expect(() => { validator.finish(); }).not.toThrow();
  });

  it("rejects replayed or skipped chunks without advancing state", () => {
    for (const unexpectedChunk of [1, 3]) {
      const validator = new TrustedWindowsNativeDataPlaneTransferOrderValidatorV1();
      validator.validateFrame(sourceFrame({ chunkSequence: 1, terminal: false }));
      expectTransferOrderError(
        () => { validator.validateFrame(sourceFrame({
          chunkSequence: unexpectedChunk,
          terminal: false,
        })); },
        "UNEXPECTED_CHUNK_SEQUENCE",
      );
      validator.validateFrame(sourceFrame({ chunkSequence: 2, terminal: true }));
      expect(() => { validator.finish(); }).not.toThrow();
    }
  });

  it("rejects switching objects before the current object terminates", () => {
    const validator = new TrustedWindowsNativeDataPlaneTransferOrderValidatorV1();
    validator.validateFrame(sourceFrame({ chunkSequence: 1, terminal: false }));
    expectTransferOrderError(
      () => { validator.validateFrame(sourceFrame({
        sourceFileRef: SOURCE_FILE_2,
        terminal: true,
      })); },
      "OBJECT_SWITCH_BEFORE_TERMINAL",
    );

    validator.validateFrame(sourceFrame({ chunkSequence: 2, terminal: true }));
    validator.validateFrame(sourceFrame({
      sourceFileRef: SOURCE_FILE_2,
      terminal: true,
      payload: Buffer.alloc(0),
    }));
    expect(() => { validator.finish(); }).not.toThrow();
  });

  it("rejects every frame after an object's terminal frame", () => {
    const validator = new TrustedWindowsNativeDataPlaneTransferOrderValidatorV1();
    validator.validateFrame(sourceFrame({ terminal: true }));
    expectTransferOrderError(
      () => { validator.validateFrame(sourceFrame({
        chunkSequence: 2,
        terminal: true,
      })); },
      "FRAME_AFTER_TERMINAL",
    );

    validator.validateFrame(sourceFrame({
      sourceFileRef: SOURCE_FILE_2,
      terminal: true,
      payload: Buffer.alloc(0),
    }));
    expect(() => { validator.finish(); }).not.toThrow();
  });

  it("never permits a completed object to return", () => {
    const validator = new TrustedWindowsNativeDataPlaneTransferOrderValidatorV1();
    validator.validateFrame(sourceFrame({ terminal: true }));
    validator.validateFrame(sourceFrame({
      sourceFileRef: SOURCE_FILE_2,
      terminal: true,
    }));
    expectTransferOrderError(
      () => { validator.validateFrame(sourceFrame({ terminal: true })); },
      "OBJECT_RETURNED",
    );
    expect(() => { validator.finish(); }).not.toThrow();
  });

  it("keeps kind, work, session, request, scope, and transfer bindings invariant", () => {
    const mismatches: readonly TrustedWindowsNativeDataPlaneFrameV1[] = [
      catalogFrame(),
      sourceFrame({ workSequence: 2n, terminal: true }),
      sourceFrame({ sessionRef: SESSION_2, terminal: true }),
      sourceFrame({ requestRef: REQUEST_2, terminal: true }),
      sourceFrame({ scopeRef: SCOPE_2, terminal: true }),
      sourceFrame({ transferRef: TRANSFER_2, terminal: true }),
    ];

    for (const mismatch of mismatches) {
      const validator = new TrustedWindowsNativeDataPlaneTransferOrderValidatorV1();
      validator.validateFrame(sourceFrame({ terminal: true }));
      expectTransferOrderError(
        () => { validator.validateFrame(mismatch); },
        "BINDING_MISMATCH",
      );
      expect(() => { validator.finish(); }).not.toThrow();
    }
  });

  it("requires at least one fully terminated object before finish", () => {
    const empty = new TrustedWindowsNativeDataPlaneTransferOrderValidatorV1();
    expectTransferOrderError(() => { empty.finish(); }, "NO_FRAMES");
    empty.validateFrame(sourceFrame({ terminal: true, payload: Buffer.alloc(0) }));
    expect(() => { empty.finish(); }).not.toThrow();

    const unterminated = new TrustedWindowsNativeDataPlaneTransferOrderValidatorV1();
    unterminated.validateFrame(sourceFrame({ terminal: false }));
    expectTransferOrderError(() => { unterminated.finish(); }, "UNTERMINATED_OBJECT");
    unterminated.validateFrame(sourceFrame({ chunkSequence: 2, terminal: true }));
    expect(() => { unterminated.finish(); }).not.toThrow();
  });

  it("sanitizes hostile frame inputs without invoking getters or poisoning state", () => {
    const privateText = "C:\\private\\catalog-name";
    let getterCalls = 0;
    let prototypeTrapCalls = 0;
    const hostileThrownValue = new Proxy(new Error(privateText), {
      getPrototypeOf: () => {
        prototypeTrapCalls += 1;
        throw new Error(privateText);
      },
    });
    const hostile = new Proxy({}, {
      getOwnPropertyDescriptor: () => {
        throw hostileThrownValue;
      },
      get: () => {
        getterCalls += 1;
        throw new Error(privateText);
      },
    });
    const validator = new TrustedWindowsNativeDataPlaneTransferOrderValidatorV1();

    expectFrameError(() => { validateRuntime(validator, hostile); }, "INVALID_FRAME");
    expect(getterCalls).toBe(0);
    expect(prototypeTrapCalls).toBe(0);
    validator.validateFrame(catalogFrame());
    expect(() => { validator.finish(); }).not.toThrow();
  });
});

function sourceFrame(
  overrides: Partial<TrustedWindowsNativeSourceDataPlaneFrameV1> = {},
): TrustedWindowsNativeSourceDataPlaneFrameV1 {
  return {
    kind: "source",
    workSequence: 1n,
    chunkSequence: 1,
    terminal: false,
    sessionRef: SESSION,
    requestRef: REQUEST,
    scopeRef: SCOPE,
    sourceRef: SOURCE,
    sourceFileRef: SOURCE_FILE,
    transferRef: TRANSFER,
    payload: Buffer.alloc(1, 0x01),
    ...overrides,
  };
}

function outputFrame(
  overrides: Partial<TrustedWindowsNativeOutputDataPlaneFrameV1> = {},
): TrustedWindowsNativeOutputDataPlaneFrameV1 {
  return {
    kind: "output",
    workSequence: 1n,
    chunkSequence: 1,
    terminal: true,
    sessionRef: SESSION,
    requestRef: REQUEST,
    scopeRef: SCOPE,
    runRef: RUN,
    outputFileRef: OUTPUT_FILE,
    transferRef: TRANSFER,
    payload: Buffer.alloc(0),
    ...overrides,
  };
}

function catalogFrame(
  overrides: Partial<TrustedWindowsNativeCatalogDataPlaneFrameV1> = {},
): TrustedWindowsNativeCatalogDataPlaneFrameV1 {
  return {
    kind: "catalog",
    workSequence: 1n,
    chunkSequence: 1,
    terminal: true,
    sessionRef: SESSION,
    requestRef: REQUEST,
    scopeRef: SCOPE,
    sourceRef: SOURCE,
    catalogRef: CATALOG,
    transferRef: TRANSFER,
    payload: Buffer.from("catalog"),
    ...overrides,
  };
}

function frameFromGolden(vector: GoldenVector): TrustedWindowsNativeDataPlaneFrameV1 {
  const common = {
    workSequence: BigInt(vector.work_sequence_decimal),
    chunkSequence: Number(vector.chunk_sequence_decimal),
    terminal: vector.terminal,
    sessionRef: vector.session_ref,
    requestRef: vector.request_ref,
    scopeRef: vector.scope_ref,
    transferRef: vector.transfer_ref,
    payload: Buffer.from(vector.payload_hex, "hex"),
  };
  return vector.kind === "source"
    ? {
        ...common,
        kind: "source",
        sourceRef: vector.container_ref,
        sourceFileRef: vector.object_ref,
      }
    : vector.kind === "output"
      ? {
          ...common,
          kind: "output",
          runRef: vector.container_ref,
          outputFileRef: vector.object_ref,
        }
      : {
          ...common,
          kind: "catalog",
          sourceRef: vector.container_ref,
          catalogRef: vector.object_ref,
        };
}

function mutated(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  const result = Uint8Array.from(bytes);
  result[offset] = value;
  return result;
}

function encodeRuntime(input: unknown): Uint8Array {
  return Reflect.apply(
    encodeTrustedWindowsNativeDataPlaneFrameV1,
    undefined,
    [input],
  ) as Uint8Array;
}

function decodeRuntime(input: unknown): TrustedWindowsNativeDataPlaneFrameV1 {
  return Reflect.apply(
    decodeTrustedWindowsNativeDataPlaneFrameV1,
    undefined,
    [input],
  ) as TrustedWindowsNativeDataPlaneFrameV1;
}

function validateRuntime(
  validator: TrustedWindowsNativeDataPlaneTransferOrderValidatorV1,
  input: unknown,
): void {
  validator.validateFrame(input as TrustedWindowsNativeDataPlaneFrameV1);
}

function expectFrameError(
  action: () => unknown,
  code: TrustedWindowsNativeDataPlaneFrameErrorCodeV1,
): void {
  try {
    action();
    expect.fail(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(TrustedWindowsNativeDataPlaneFrameErrorV1);
    if (!(error instanceof TrustedWindowsNativeDataPlaneFrameErrorV1)) throw error;
    expect(error.code).toBe(code);
  }
}

function expectTransferOrderError(
  action: () => unknown,
  code: TrustedWindowsNativeDataPlaneTransferOrderErrorCodeV1,
): void {
  try {
    action();
    expect.fail(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(TrustedWindowsNativeDataPlaneTransferOrderErrorV1);
    if (!(error instanceof TrustedWindowsNativeDataPlaneTransferOrderErrorV1)) {
      throw error;
    }
    expect(error.code).toBe(code);
    expect(error.message).toBe(
      `Trusted Windows native data-plane transfer rejected: ${code}`,
    );
    for (const privateMarker of [
      SESSION,
      REQUEST,
      SCOPE,
      SOURCE,
      SOURCE_FILE,
      TRANSFER,
    ]) {
      expect(error.message).not.toContain(privateMarker);
    }
  }
}
