import { PassThrough, Writable } from "node:stream";
import { format, inspect } from "node:util";

import { describe, expect, it } from "vitest";

import {
  createTrustedWindowsNativeDataPlaneChannelsV1,
  TrustedWindowsNativeDataPlaneChannelErrorV1,
  TrustedWindowsNativeOutputFramesToHelperChannelV1,
  TrustedWindowsNativeSourceFramesFromHelperChannelV1,
  type TrustedWindowsNativeDataPlaneBufferStageV1,
  type TrustedWindowsNativeDataPlaneChannelErrorCodeV1,
} from "../trusted-windows-native-source-data-plane-channel.js";
import {
  encodeTrustedWindowsNativeDataPlaneFrameV1,
  TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1,
  TRUSTED_WINDOWS_NATIVE_DATA_PLANE_MAX_PAYLOAD_BYTES_V1,
  type TrustedWindowsNativeCatalogDataPlaneFrameV1,
  type TrustedWindowsNativeDataPlaneFrameV1,
  type TrustedWindowsNativeOutputDataPlaneFrameV1,
  type TrustedWindowsNativeSourceDataPlaneFrameV1,
} from "../trusted-windows-native-source-data-plane-frame.js";

const PAYLOAD_LENGTH_OFFSET = 24;
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

describe("trusted Windows native sourceFramesFromHelper channel", () => {
  it("decodes a frame at every split boundary across header and payload", async () => {
    const expected = sourceFrame({ payload: Buffer.from("split-boundary") });
    const encoded = Buffer.from(encodeTrustedWindowsNativeDataPlaneFrameV1(expected));

    for (let split = 1; split < encoded.byteLength; split += 1) {
      const sourceFramesFromHelper = new PassThrough();
      const channel = new TrustedWindowsNativeSourceFramesFromHelperChannelV1(
        sourceFramesFromHelper,
      );
      const input = Buffer.from(encoded);
      const decodedPromise = channel.readFrame();
      sourceFramesFromHelper.write(input.subarray(0, split));
      sourceFramesFromHelper.end(input.subarray(split));

      await expect(decodedPromise, `split ${String(split)}`).resolves.toEqual(expected);
    }
  });

  it("decodes several coalesced frames one at a time", async () => {
    const expected: readonly TrustedWindowsNativeDataPlaneFrameV1[] = [
      sourceFrame({ payload: Buffer.from("first") }),
      catalogFrame({ payload: Buffer.from("0041d8000042", "hex") }),
      sourceFrame({
        sourceFileRef: "helper_source_file_909192939495969798999a9b9c9d9e9f",
        payload: Buffer.alloc(0),
      }),
    ];
    const sourceFramesFromHelper = new PassThrough();
    const channel = new TrustedWindowsNativeSourceFramesFromHelperChannelV1(
      sourceFramesFromHelper,
    );
    sourceFramesFromHelper.end(Buffer.concat(expected.map((frame) =>
      Buffer.from(encodeTrustedWindowsNativeDataPlaneFrameV1(frame))
    )));

    for (const frame of expected) {
      await expect(channel.readFrame()).resolves.toEqual(frame);
    }
    await expectChannelError(channel.readFrame(), "CHANNEL_CLOSED");
  });

  it("roundtrips the one-mebibyte payload limit", async () => {
    const expected = sourceFrame({
      payload: Buffer.alloc(
        TRUSTED_WINDOWS_NATIVE_DATA_PLANE_MAX_PAYLOAD_BYTES_V1,
        0xa5,
      ),
    });
    const sourceFramesFromHelper = new PassThrough();
    const channel = new TrustedWindowsNativeSourceFramesFromHelperChannelV1(
      sourceFramesFromHelper,
    );
    const decodedPromise = channel.readFrame();
    sourceFramesFromHelper.end(encodeTrustedWindowsNativeDataPlaneFrameV1(expected));

    await expect(decodedPromise).resolves.toEqual(expected);
  });

  it("classifies every truncated offset of a practical frame", async () => {
    const encoded = Buffer.from(encodeTrustedWindowsNativeDataPlaneFrameV1(sourceFrame({
      payload: Buffer.from("truncate"),
    })));

    for (let length = 0; length < encoded.byteLength; length += 1) {
      const sourceFramesFromHelper = new PassThrough();
      const channel = new TrustedWindowsNativeSourceFramesFromHelperChannelV1(
        sourceFramesFromHelper,
      );
      const readPromise = channel.readFrame();
      sourceFramesFromHelper.end(Buffer.from(encoded.subarray(0, length)));
      await expectChannelError(
        readPromise,
        length === 0 ? "CHANNEL_CLOSED" : "UNEXPECTED_EOF",
      );
    }
  });

  it("rejects oversized declarations before allocating a raw frame", async () => {
    const encoded = Buffer.from(encodeTrustedWindowsNativeDataPlaneFrameV1(sourceFrame()));
    const header = Buffer.from(encoded.subarray(
      0,
      TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1,
    ));
    header.writeUInt32BE(
      TRUSTED_WINDOWS_NATIVE_DATA_PLANE_MAX_PAYLOAD_BYTES_V1 + 1,
      PAYLOAD_LENGTH_OFFSET,
    );
    const wipedStages: TrustedWindowsNativeDataPlaneBufferStageV1[] = [];
    const sourceFramesFromHelper = new PassThrough();
    const channel = new TrustedWindowsNativeSourceFramesFromHelperChannelV1(
      sourceFramesFromHelper,
      (_direction, stage, bytes) => {
        wipedStages.push(stage);
        expect(Array.from(bytes).every((byte) => byte === 0)).toBe(true);
      },
    );
    const readPromise = channel.readFrame();
    sourceFramesFromHelper.end(header);

    await expectChannelError(readPromise, "INVALID_FRAME");
    expect(wipedStages).toContain("stream_chunk");
    expect(wipedStages).toContain("header");
    expect(wipedStages).not.toContain("raw_frame");
    await expectChannelError(channel.readFrame(), "INVALID_FRAME");
  });

  it("makes malformed headers, wrong direction, and hash mismatch terminal", async () => {
    const cases: readonly {
      readonly bytes: Uint8Array;
      readonly code: TrustedWindowsNativeDataPlaneChannelErrorCodeV1;
    }[] = [
      {
        bytes: mutated(
          encodeTrustedWindowsNativeDataPlaneFrameV1(sourceFrame()),
          0,
          0x58,
        ),
        code: "INVALID_FRAME",
      },
      {
        bytes: encodeTrustedWindowsNativeDataPlaneFrameV1(outputFrame()),
        code: "INVALID_DIRECTION",
      },
      {
        bytes: mutated(
          encodeTrustedWindowsNativeDataPlaneFrameV1(sourceFrame()),
          PAYLOAD_SHA256_OFFSET,
          0,
        ),
        code: "INVALID_FRAME",
      },
    ];

    for (const testCase of cases) {
      const sourceFramesFromHelper = new PassThrough();
      const channel = new TrustedWindowsNativeSourceFramesFromHelperChannelV1(
        sourceFramesFromHelper,
      );
      const readPromise = channel.readFrame();
      sourceFramesFromHelper.end(testCase.bytes);
      await expectChannelError(readPromise, testCase.code);
      await expectChannelError(channel.readFrame(), testCase.code);
    }
  });

  it("permits only one pending read without disturbing the first read", async () => {
    const expected = sourceFrame();
    const sourceFramesFromHelper = new PassThrough();
    const channel = new TrustedWindowsNativeSourceFramesFromHelperChannelV1(
      sourceFramesFromHelper,
    );
    const first = channel.readFrame();
    await expectChannelError(channel.readFrame(), "CONCURRENT_READ");
    sourceFramesFromHelper.end(encodeTrustedWindowsNativeDataPlaneFrameV1(expected));
    await expect(first).resolves.toEqual(expected);
  });

  it("makes stream error and premature close terminal without inspecting errors", async () => {
    const privateText = "C:\\private\\helper-source";
    let prototypeTrapCalls = 0;
    const hostileError = new Proxy(new Error(privateText), {
      getPrototypeOf: () => {
        prototypeTrapCalls += 1;
        throw new Error(privateText);
      },
    });
    const erroredStream = new PassThrough();
    const errored = new TrustedWindowsNativeSourceFramesFromHelperChannelV1(
      erroredStream,
    );
    const erroredRead = errored.readFrame();
    erroredStream.emit("error", hostileError);
    const error = await expectChannelError(erroredRead, "STREAM_ERROR");
    expect(error.message).not.toContain(privateText);
    expect(prototypeTrapCalls).toBe(0);
    await expectChannelError(errored.readFrame(), "STREAM_ERROR");

    const closedStream = new PassThrough();
    const closed = new TrustedWindowsNativeSourceFramesFromHelperChannelV1(
      closedStream,
    );
    const closedRead = closed.readFrame();
    closedStream.destroy();
    await expectChannelError(closedRead, "STREAM_CLOSED");
    await expectChannelError(closed.readFrame(), "STREAM_CLOSED");

    const alreadyClosedStream = new PassThrough();
    alreadyClosedStream.destroy();
    await nextTurn();
    const alreadyClosed = new TrustedWindowsNativeSourceFramesFromHelperChannelV1(
      alreadyClosedStream,
    );
    await expectChannelError(alreadyClosed.readFrame(), "STREAM_CLOSED");
  });

  it("supports explicit clean close and poison", async () => {
    const cleanStream = new PassThrough();
    const clean = new TrustedWindowsNativeSourceFramesFromHelperChannelV1(cleanStream);
    const pendingCleanRead = clean.readFrame();
    clean.closeCleanly();
    await expectChannelError(pendingCleanRead, "CHANNEL_CLOSED");
    await expectChannelError(clean.readFrame(), "CHANNEL_CLOSED");

    const poisonedStream = new PassThrough();
    const poisoned = new TrustedWindowsNativeSourceFramesFromHelperChannelV1(
      poisonedStream,
    );
    const pendingPoisonedRead = poisoned.readFrame();
    poisoned.poison();
    await expectChannelError(pendingPoisonedRead, "CHANNEL_POISONED");
    await expectChannelError(poisoned.readFrame(), "CHANNEL_POISONED");
  });
});

describe("trusted Windows native outputFramesToHelper channel", () => {
  it("writes the one-mebibyte payload limit", async () => {
    const outputFramesToHelper = new ControlledWritable([true]);
    const channel = new TrustedWindowsNativeOutputFramesToHelperChannelV1(
      outputFramesToHelper,
    );
    const writePromise = channel.writeFrame(outputFrame({
      payload: Buffer.alloc(
        TRUSTED_WINDOWS_NATIVE_DATA_PLANE_MAX_PAYLOAD_BYTES_V1,
        0x5a,
      ),
    }));
    await waitFor(() => outputFramesToHelper.writes.length === 1);
    expect(outputFramesToHelper.writes[0]?.snapshot).toHaveLength(
      TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1 +
        TRUSTED_WINDOWS_NATIVE_DATA_PLANE_MAX_PAYLOAD_BYTES_V1,
    );
    outputFramesToHelper.completeWrite(0);
    await expect(writePromise).resolves.toBeUndefined();
  });

  it("waits for both the write callback and drain in either order", async () => {
    for (const callbackFirst of [false, true]) {
      const outputFramesToHelper = new ControlledWritable([false]);
      const channel = new TrustedWindowsNativeOutputFramesToHelperChannelV1(
        outputFramesToHelper,
      );
      let settled = false;
      const writePromise = channel.writeFrame(outputFrame()).then(() => {
        settled = true;
      });
      await waitFor(() => outputFramesToHelper.writes.length === 1);

      if (callbackFirst) {
        outputFramesToHelper.completeWrite(0);
        await nextTurn();
        expect(settled).toBe(false);
        outputFramesToHelper.emit("drain");
      } else {
        outputFramesToHelper.emit("drain");
        await nextTurn();
        expect(settled).toBe(false);
        outputFramesToHelper.completeWrite(0);
      }
      await writePromise;
      expect(settled).toBe(true);
    }
  });

  it("serializes concurrent writes without retaining later encoded frames", async () => {
    const outputFramesToHelper = new ControlledWritable([true, true, true]);
    const channel = new TrustedWindowsNativeOutputFramesToHelperChannelV1(
      outputFramesToHelper,
    );
    const frames = [
      outputFrame({ payload: Buffer.from("one") }),
      outputFrame({ payload: Buffer.from("two") }),
      outputFrame({ payload: Buffer.from("three") }),
    ] as const;
    const writes = frames.map((frame) => channel.writeFrame(frame));

    await waitFor(() => outputFramesToHelper.writes.length === 1);
    expect(outputFramesToHelper.writes).toHaveLength(1);
    outputFramesToHelper.completeWrite(0);
    await waitFor(() => outputFramesToHelper.writes.length === 2);
    outputFramesToHelper.completeWrite(1);
    await waitFor(() => outputFramesToHelper.writes.length === 3);
    outputFramesToHelper.completeWrite(2);
    await Promise.all(writes);

    expect(outputFramesToHelper.writes.map((write) => write.snapshot)).toEqual(
      frames.map((frame) => Buffer.from(encodeTrustedWindowsNativeDataPlaneFrameV1(frame))),
    );
  });

  it("wipes the encoded frame only after write ownership ends", async () => {
    const outputFramesToHelper = new ControlledWritable([false]);
    const observedWipes: Uint8Array[] = [];
    const channel = new TrustedWindowsNativeOutputFramesToHelperChannelV1(
      outputFramesToHelper,
      (direction, stage, bytes) => {
        if (direction === "output_frames_to_helper" && stage === "encoded_frame") {
          observedWipes.push(bytes);
        }
      },
    );
    const writePromise = channel.writeFrame(outputFrame({
      payload: Buffer.from("PRIVATE_OUTPUT_BYTES"),
    }));
    await waitFor(() => outputFramesToHelper.writes.length === 1);
    const owned = outputFramesToHelper.writes[0]?.chunk;
    if (owned === undefined) expect.fail("Expected one owned write buffer");
    expect(Array.from(owned).some((byte) => byte !== 0)).toBe(true);

    outputFramesToHelper.emit("drain");
    await nextTurn();
    expect(Array.from(owned).some((byte) => byte !== 0)).toBe(true);
    expect(observedWipes).toHaveLength(0);

    outputFramesToHelper.completeWrite(0);
    await writePromise;
    expect(Array.from(owned).every((byte) => byte === 0)).toBe(true);
    expect(observedWipes).toHaveLength(1);
    expect(Array.from(observedWipes[0] ?? []).every((byte) => byte === 0)).toBe(true);
  });

  it("makes invalid frames and wrong-direction frames terminal", async () => {
    const malformedOutput = new ControlledWritable([true]);
    const malformed = new TrustedWindowsNativeOutputFramesToHelperChannelV1(
      malformedOutput,
    );
    await expectChannelError(
      writeRuntime(malformed, { ...outputFrame(), payload: [] }),
      "INVALID_FRAME",
    );
    await expectChannelError(malformed.writeFrame(outputFrame()), "INVALID_FRAME");
    expect(malformedOutput.writes).toHaveLength(0);

    const wrongDirectionOutput = new ControlledWritable([true]);
    const wrongDirection = new TrustedWindowsNativeOutputFramesToHelperChannelV1(
      wrongDirectionOutput,
    );
    await expectChannelError(
      writeRuntime(wrongDirection, sourceFrame()),
      "INVALID_DIRECTION",
    );
    await expectChannelError(
      wrongDirection.writeFrame(outputFrame()),
      "INVALID_DIRECTION",
    );
    expect(wrongDirectionOutput.writes).toHaveLength(0);
  });

  it("makes callback error, stream error, and close terminal", async () => {
    const privateText = "C:\\private\\output-name";
    let prototypeTrapCalls = 0;
    const hostileError = new Proxy(new Error(privateText), {
      getPrototypeOf: () => {
        prototypeTrapCalls += 1;
        throw new Error(privateText);
      },
    });

    const callbackOutput = new ControlledWritable([true]);
    const callbackChannel = new TrustedWindowsNativeOutputFramesToHelperChannelV1(
      callbackOutput,
    );
    const callbackWrite = callbackChannel.writeFrame(outputFrame());
    await waitFor(() => callbackOutput.writes.length === 1);
    callbackOutput.completeWrite(0, hostileError);
    const callbackFailure = await expectChannelError(callbackWrite, "STREAM_ERROR");
    expect(callbackFailure.message).not.toContain(privateText);
    expect(prototypeTrapCalls).toBe(0);
    await expectChannelError(callbackChannel.writeFrame(outputFrame()), "STREAM_ERROR");

    const erroredOutput = new ControlledWritable([true]);
    const errored = new TrustedWindowsNativeOutputFramesToHelperChannelV1(
      erroredOutput,
    );
    erroredOutput.emit("error", hostileError);
    await expectChannelError(errored.writeFrame(outputFrame()), "STREAM_ERROR");
    expect(prototypeTrapCalls).toBe(0);

    const closedOutput = new ControlledWritable([true]);
    const closed = new TrustedWindowsNativeOutputFramesToHelperChannelV1(
      closedOutput,
    );
    closedOutput.emit("close");
    await expectChannelError(closed.writeFrame(outputFrame()), "STREAM_CLOSED");

    const finishedOutput = new ControlledWritable([true]);
    const finished = new TrustedWindowsNativeOutputFramesToHelperChannelV1(
      finishedOutput,
    );
    finishedOutput.emit("finish");
    await expectChannelError(finished.writeFrame(outputFrame()), "STREAM_CLOSED");

    const alreadyClosedOutput = new ControlledWritable([true]);
    alreadyClosedOutput.destroy();
    await nextTurn();
    const alreadyClosed = new TrustedWindowsNativeOutputFramesToHelperChannelV1(
      alreadyClosedOutput,
    );
    await expectChannelError(alreadyClosed.writeFrame(outputFrame()), "STREAM_CLOSED");
  });

  it("supports clean close, poison, and reuse rejection", async () => {
    const cleanOutput = new ControlledWritable([]);
    const clean = new TrustedWindowsNativeOutputFramesToHelperChannelV1(
      cleanOutput,
    );
    await expect(clean.closeCleanly()).resolves.toBeUndefined();
    expect(cleanOutput.endCalls).toBe(1);
    await expectChannelError(clean.writeFrame(outputFrame()), "CHANNEL_CLOSED");
    await expect(clean.closeCleanly()).resolves.toBeUndefined();

    const poisonedOutput = new ControlledWritable([]);
    const poisoned = new TrustedWindowsNativeOutputFramesToHelperChannelV1(
      poisonedOutput,
    );
    poisoned.poison();
    await expectChannelError(poisoned.writeFrame(outputFrame()), "CHANNEL_POISONED");
    await expectChannelError(poisoned.closeCleanly(), "CHANNEL_POISONED");
  });

  it("ignores a hostile wipe observer without inspecting its thrown Proxy", async () => {
    const privateText = "PRIVATE_WIPE_OBSERVER";
    let prototypeTrapCalls = 0;
    const hostileThrownValue = new Proxy(new Error(privateText), {
      getPrototypeOf: () => {
        prototypeTrapCalls += 1;
        throw new Error(privateText);
      },
    });
    const outputFramesToHelper = new ControlledWritable([true]);
    const channel = new TrustedWindowsNativeOutputFramesToHelperChannelV1(
      outputFramesToHelper,
      () => {
        throw hostileThrownValue;
      },
    );
    const writePromise = channel.writeFrame(outputFrame());
    await waitFor(() => outputFramesToHelper.writes.length === 1);
    outputFramesToHelper.completeWrite(0);

    await expect(writePromise).resolves.toBeUndefined();
    expect(prototypeTrapCalls).toBe(0);
  });
});

describe("trusted Windows native data-plane channel factory privacy", () => {
  it("uses direction-named channels and redacts inspection and JSON", () => {
    const outputFramesToHelper = new ControlledWritable([]);
    const sourceFramesFromHelper = new PassThrough();
    const channels = createTrustedWindowsNativeDataPlaneChannelsV1({
      outputFramesToHelper,
      sourceFramesFromHelper,
    });

    expect(channels.outputFramesToHelper).toBeInstanceOf(
      TrustedWindowsNativeOutputFramesToHelperChannelV1,
    );
    expect(channels.sourceFramesFromHelper).toBeInstanceOf(
      TrustedWindowsNativeSourceFramesFromHelperChannelV1,
    );
    const rendered = [
      inspect(channels),
      inspect(channels.outputFramesToHelper),
      inspect(channels.sourceFramesFromHelper),
      format("%O", channels),
      JSON.stringify(channels),
      JSON.stringify(channels.outputFramesToHelper),
      JSON.stringify(channels.sourceFramesFromHelper),
    ].join("\n");
    for (const privateMarker of [
      SESSION,
      REQUEST,
      SCOPE,
      SOURCE,
      SOURCE_FILE,
      RUN,
      OUTPUT_FILE,
      TRANSFER,
    ]) {
      expect(rendered).not.toContain(privateMarker);
    }
    expect(JSON.parse(JSON.stringify(channels))).toEqual({
      state: "data_plane_channels",
    });
    channels.poison();
  });

  it("sanitizes hostile factory access and public error representations", () => {
    const privateText = "C:\\private\\factory";
    let prototypeTrapCalls = 0;
    const hostileThrownValue = new Proxy(new Error(privateText), {
      getPrototypeOf: () => {
        prototypeTrapCalls += 1;
        throw new Error(privateText);
      },
    });
    const hostileOptions = new Proxy({}, {
      getOwnPropertyDescriptor: () => {
        throw hostileThrownValue;
      },
    });

    let observed: unknown;
    try {
      createChannelsRuntime(hostileOptions);
      expect.fail("Expected hostile channel options to fail closed");
    } catch (error: unknown) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(TrustedWindowsNativeDataPlaneChannelErrorV1);
    expect(observed).toMatchObject({ code: "INVALID_CHANNEL" });
    const rendered = [inspect(observed), format("%O", observed), JSON.stringify(observed)]
      .join("\n");
    expect(rendered).not.toContain(privateText);
    expect(prototypeTrapCalls).toBe(0);
  });
});

interface ControlledWrite {
  readonly callback: (error?: Error | null) => void;
  readonly chunk: Uint8Array;
  readonly snapshot: Buffer;
}

class ControlledWritable extends Writable {
  readonly writes: ControlledWrite[] = [];
  endCalls = 0;
  readonly #writeResults: boolean[];

  constructor(writeResults: readonly boolean[]) {
    super({
      write: (_chunk, _encoding, callback) => {
        callback();
      },
    });
    this.#writeResults = [...writeResults];
    this.on("finish", () => {
      this.endCalls += 1;
    });
    Object.defineProperty(this, "write", {
      configurable: false,
      enumerable: false,
      value: (chunk: Uint8Array, callback: (error?: Error | null) => void): boolean =>
        this.#recordWrite(chunk, callback),
      writable: false,
    });
  }

  #recordWrite(chunk: Uint8Array, callback: (error?: Error | null) => void): boolean {
    this.writes.push({
      callback,
      chunk,
      snapshot: Buffer.from(chunk),
    });
    return this.#writeResults.shift() ?? true;
  }

  completeWrite(index: number, error?: Error | null): void {
    const write = this.writes[index];
    if (write === undefined) expect.fail(`Missing controlled write ${String(index)}`);
    write.callback(error);
  }
}

function sourceFrame(
  overrides: Partial<TrustedWindowsNativeSourceDataPlaneFrameV1> = {},
): TrustedWindowsNativeSourceDataPlaneFrameV1 {
  return {
    kind: "source",
    workSequence: 1n,
    chunkSequence: 1,
    terminal: true,
    sessionRef: SESSION,
    requestRef: REQUEST,
    scopeRef: SCOPE,
    sourceRef: SOURCE,
    sourceFileRef: SOURCE_FILE,
    transferRef: TRANSFER,
    payload: Buffer.from("source"),
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
    payload: Buffer.from("output"),
    ...overrides,
  };
}

function mutated(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  const result = Uint8Array.from(bytes);
  result[offset] = value;
  return result;
}

function writeRuntime(
  channel: TrustedWindowsNativeOutputFramesToHelperChannelV1,
  frame: unknown,
): Promise<void> {
  const writeFrame: unknown = Reflect.get(channel, "writeFrame");
  if (typeof writeFrame !== "function") throw new Error("Missing writeFrame method");
  return Reflect.apply(writeFrame, channel, [frame]) as Promise<void>;
}

function createChannelsRuntime(input: unknown): unknown {
  return Reflect.apply(createTrustedWindowsNativeDataPlaneChannelsV1, undefined, [input]);
}

async function expectChannelError(
  promise: Promise<unknown>,
  code: TrustedWindowsNativeDataPlaneChannelErrorCodeV1,
): Promise<TrustedWindowsNativeDataPlaneChannelErrorV1> {
  try {
    await promise;
    expect.fail(`Expected ${code}`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(TrustedWindowsNativeDataPlaneChannelErrorV1);
    if (!(error instanceof TrustedWindowsNativeDataPlaneChannelErrorV1)) throw error;
    expect(error.code).toBe(code);
    expect(error.message).toBe(
      `Trusted Windows native data-plane channel rejected: ${code}`,
    );
    return error;
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await nextTurn();
  }
  expect.fail("Timed out waiting for controlled stream state");
}

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}
