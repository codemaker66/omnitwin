import type { Readable, Writable } from "node:stream";

import {
  decodeTrustedWindowsNativeDataPlaneFrameV1,
  encodeTrustedWindowsNativeDataPlaneFrameV1,
  preflightTrustedWindowsNativeDataPlaneFrameHeaderV1,
  TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1,
  type TrustedWindowsNativeDataPlaneFrameV1,
  type TrustedWindowsNativeOutputDataPlaneFrameV1,
} from "./trusted-windows-native-source-data-plane-frame.js";

/**
 * Process-private, direction-bound byte channels for the native helper's fd3/fd4.
 * This module deliberately does not advertise control-plane capabilities.
 */

const NODE_INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom");
const TYPED_ARRAY_BUFFER_GETTER = captureTypedArrayGetter("buffer");
const TYPED_ARRAY_BYTE_LENGTH_GETTER = captureTypedArrayGetter("byteLength");
const TYPED_ARRAY_BYTE_OFFSET_GETTER = captureTypedArrayGetter("byteOffset");
const TYPED_ARRAY_TAG_GETTER = captureTypedArrayGetter(Symbol.toStringTag);
const TYPED_ARRAY_FILL = captureTypedArrayMethod("fill");
const TYPED_ARRAY_SET = captureTypedArrayMethod("set");

export type TrustedWindowsNativeDataPlaneChannelErrorCodeV1 =
  | "INVALID_CHANNEL"
  | "CONCURRENT_READ"
  | "CHANNEL_CLOSED"
  | "CHANNEL_POISONED"
  | "INVALID_DIRECTION"
  | "INVALID_FRAME"
  | "UNEXPECTED_EOF"
  | "INVALID_STREAM_CHUNK"
  | "STREAM_ERROR"
  | "STREAM_CLOSED";

interface RedactedErrorSummaryV1 {
  readonly name: "TrustedWindowsNativeDataPlaneChannelErrorV1";
  readonly code: TrustedWindowsNativeDataPlaneChannelErrorCodeV1;
}

export class TrustedWindowsNativeDataPlaneChannelErrorV1 extends Error {
  readonly code: TrustedWindowsNativeDataPlaneChannelErrorCodeV1;

  constructor(code: TrustedWindowsNativeDataPlaneChannelErrorCodeV1) {
    super(`Trusted Windows native data-plane channel rejected: ${code}`);
    this.name = "TrustedWindowsNativeDataPlaneChannelErrorV1";
    this.code = code;
  }

  [NODE_INSPECT_CUSTOM](): RedactedErrorSummaryV1 {
    return this.#summary();
  }

  toJSON(): RedactedErrorSummaryV1 {
    return this.#summary();
  }

  #summary(): RedactedErrorSummaryV1 {
    return Object.freeze({
      name: "TrustedWindowsNativeDataPlaneChannelErrorV1",
      code: this.code,
    });
  }
}

const INTERNAL_CHANNEL_ERRORS = new WeakMap<
  object,
  TrustedWindowsNativeDataPlaneChannelErrorCodeV1
>();

export type TrustedWindowsNativeDataPlaneBufferDirectionV1 =
  | "source_frames_from_helper"
  | "output_frames_to_helper";

export type TrustedWindowsNativeDataPlaneBufferStageV1 =
  | "stream_chunk"
  | "header"
  | "raw_frame"
  | "encoded_frame";

/** Test-only seam. The supplied bytes have already been overwritten with zeroes. */
export type TrustedWindowsNativeDataPlaneBufferWipeObserverV1 = (
  direction: TrustedWindowsNativeDataPlaneBufferDirectionV1,
  stage: TrustedWindowsNativeDataPlaneBufferStageV1,
  wipedBytes: Uint8Array,
) => void;

type ChannelStateV1 = "open" | "closing" | "closed" | "failed" | "poisoned";

interface RedactedChannelSummaryV1 {
  readonly direction: TrustedWindowsNativeDataPlaneBufferDirectionV1;
  readonly state: ChannelStateV1;
}

interface IntrinsicUint8ArrayWindow {
  readonly buffer: ArrayBufferLike;
  readonly byteLength: number;
  readonly byteOffset: number;
}

interface PendingWriteV1 {
  callbackDone: boolean;
  callbackFailed: boolean;
  drainSeen: boolean;
  needsDrain: boolean;
  ownershipReleased: boolean;
  settled: boolean;
  terminalCode: TrustedWindowsNativeDataPlaneChannelErrorCodeV1 | undefined;
  writeReturned: boolean;
  readonly reject: (reason: object) => void;
  readonly resolve: () => void;
}

interface PendingCloseV1 {
  settled: boolean;
  readonly reject: (reason: object) => void;
  readonly resolve: () => void;
}

export interface TrustedWindowsNativeDataPlaneChannelsOptionsV1 {
  readonly outputFramesToHelper: Writable;
  readonly sourceFramesFromHelper: Readable;
  readonly testOnlyOnBufferWiped?: TrustedWindowsNativeDataPlaneBufferWipeObserverV1;
}

export class TrustedWindowsNativeSourceFramesFromHelperChannelV1 {
  readonly #sourceFramesFromHelper: Readable;
  readonly #wipeObserver: TrustedWindowsNativeDataPlaneBufferWipeObserverV1 | undefined;
  #state: ChannelStateV1 = "open";
  #terminalCode: TrustedWindowsNativeDataPlaneChannelErrorCodeV1 | undefined;
  #activeRead = false;
  #ended = false;
  #waiter: (() => void) | undefined;

  readonly #onReadable = (): void => {
    this.#wakeWaiter();
  };

  readonly #onEnd = (): void => {
    this.#ended = true;
    this.#wakeWaiter();
  };

  readonly #onError = (_foreignError: unknown): void => {
    this.#failTerminal("STREAM_ERROR");
  };

  readonly #onClose = (): void => {
    if (this.#state === "closed" || this.#state === "poisoned") return;
    if (this.#ended && this.#state === "open") {
      this.#state = "closed";
      this.#terminalCode = "CHANNEL_CLOSED";
      this.#wakeWaiter();
      return;
    }
    this.#failTerminal("STREAM_CLOSED", false);
  };

  constructor(
    sourceFramesFromHelper: Readable,
    testOnlyOnBufferWiped?: TrustedWindowsNativeDataPlaneBufferWipeObserverV1,
  ) {
    this.#sourceFramesFromHelper = sourceFramesFromHelper;
    this.#wipeObserver = typeof testOnlyOnBufferWiped === "function"
      ? testOnlyOnBufferWiped
      : undefined;
    try {
      this.#sourceFramesFromHelper.on("error", this.#onError);
      this.#sourceFramesFromHelper.on("readable", this.#onReadable);
      this.#sourceFramesFromHelper.on("end", this.#onEnd);
      this.#sourceFramesFromHelper.on("close", this.#onClose);
      this.#sourceFramesFromHelper.pause();
      const readableEnded: unknown = this.#sourceFramesFromHelper.readableEnded;
      const destroyed: unknown = this.#sourceFramesFromHelper.destroyed;
      if (readableEnded === true) this.#ended = true;
      if (destroyed === true && readableEnded !== true) {
        this.#state = "failed";
        this.#terminalCode = "STREAM_CLOSED";
      }
    } catch {
      this.#removeListenersBestEffort();
      throw new TrustedWindowsNativeDataPlaneChannelErrorV1("INVALID_CHANNEL");
    }
  }

  async readFrame(): Promise<TrustedWindowsNativeDataPlaneFrameV1> {
    if (this.#activeRead) {
      throw new TrustedWindowsNativeDataPlaneChannelErrorV1("CONCURRENT_READ");
    }
    this.#assertReadablePublic();
    this.#activeRead = true;
    try {
      return await this.#readOneFrame();
    } catch (error: unknown) {
      throw publicChannelError(error, this.#terminalCode ?? "STREAM_ERROR");
    } finally {
      this.#activeRead = false;
    }
  }

  closeCleanly(): void {
    if (this.#state === "closed") return;
    if (this.#state === "failed" || this.#state === "poisoned") return;
    this.#state = "closed";
    this.#terminalCode = "CHANNEL_CLOSED";
    this.#wakeWaiter();
    this.#destroyBestEffort();
  }

  poison(): void {
    if (this.#state === "poisoned" || this.#state === "closed") return;
    this.#state = "poisoned";
    this.#terminalCode = "CHANNEL_POISONED";
    this.#wakeWaiter();
    this.#destroyBestEffort();
  }

  [NODE_INSPECT_CUSTOM](): RedactedChannelSummaryV1 {
    return this.#summary();
  }

  toJSON(): RedactedChannelSummaryV1 {
    return this.#summary();
  }

  async #readOneFrame(): Promise<TrustedWindowsNativeDataPlaneFrameV1> {
    let header: Buffer | undefined = Buffer.alloc(
      TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1,
    );
    let rawFrame: Buffer | undefined;
    try {
      await this.#readExactly(header, "header");
      this.#assertFrameProcessingInternal();
      let preflight: ReturnType<
        typeof preflightTrustedWindowsNativeDataPlaneFrameHeaderV1
      >;
      try {
        preflight = preflightTrustedWindowsNativeDataPlaneFrameHeaderV1(header);
      } catch {
        this.#failTerminal("INVALID_FRAME");
        return failInternal("INVALID_FRAME");
      }
      if (preflight.kind === "output") {
        this.#failTerminal("INVALID_DIRECTION");
        return failInternal("INVALID_DIRECTION");
      }

      rawFrame = Buffer.alloc(preflight.totalFrameLength);
      copyOwnedBytes(header, rawFrame, 0);
      wipeOwnedBytes(
        header,
        "source_frames_from_helper",
        "header",
        this.#wipeObserver,
      );
      header = undefined;

      if (preflight.payloadLength > 0) {
        await this.#readExactly(
          rawFrame.subarray(TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1),
          "payload",
        );
      }
      this.#assertFrameProcessingInternal();

      try {
        return decodeTrustedWindowsNativeDataPlaneFrameV1(rawFrame);
      } catch {
        this.#failTerminal("INVALID_FRAME");
        return failInternal("INVALID_FRAME");
      }
    } finally {
      if (header !== undefined) {
        wipeOwnedBytes(
          header,
          "source_frames_from_helper",
          "header",
          this.#wipeObserver,
        );
      }
      if (rawFrame !== undefined) {
        wipeOwnedBytes(
          rawFrame,
          "source_frames_from_helper",
          "raw_frame",
          this.#wipeObserver,
        );
      }
    }
  }

  async #readExactly(target: Uint8Array, phase: "header" | "payload"): Promise<void> {
    let offset = 0;
    while (offset < target.byteLength) {
      this.#assertReadableInternal(phase, offset);
      let chunk: unknown;
      try {
        chunk = this.#sourceFramesFromHelper.read(target.byteLength - offset) as unknown;
      } catch {
        this.#failTerminal("STREAM_ERROR");
        return failInternal("STREAM_ERROR");
      }
      if (chunk === null) {
        if (this.#ended) {
          if (phase === "header" && offset === 0) {
            this.#state = "closed";
            this.#terminalCode = "CHANNEL_CLOSED";
            return failInternal("CHANNEL_CLOSED");
          }
          this.#failTerminal("UNEXPECTED_EOF");
          return failInternal("UNEXPECTED_EOF");
        }
        await this.#waitUntilReadableOrTerminal();
        continue;
      }

      let copied = 0;
      try {
        const window = intrinsicUint8ArrayWindow(chunk);
        if (window.byteLength < 1 || window.byteLength > target.byteLength - offset) {
          this.#failTerminal("INVALID_STREAM_CHUNK");
          return failInternal("INVALID_STREAM_CHUNK");
        }
        const view = intrinsicUint8ArrayView(window);
        TYPED_ARRAY_SET(target, view, offset);
        copied = window.byteLength;
      } catch (error: unknown) {
        if (internalChannelErrorCode(error) !== undefined) throw error;
        this.#failTerminal("INVALID_STREAM_CHUNK");
        return failInternal("INVALID_STREAM_CHUNK");
      } finally {
        wipeUnknownStreamChunk(
          chunk,
          "source_frames_from_helper",
          this.#wipeObserver,
        );
      }
      offset += copied;
    }
  }

  #assertReadablePublic(): void {
    if (this.#state === "poisoned") {
      throw new TrustedWindowsNativeDataPlaneChannelErrorV1("CHANNEL_POISONED");
    }
    if (this.#state === "closed") {
      throw new TrustedWindowsNativeDataPlaneChannelErrorV1("CHANNEL_CLOSED");
    }
    if (this.#state === "failed") {
      throw new TrustedWindowsNativeDataPlaneChannelErrorV1(
        this.#terminalCode ?? "STREAM_ERROR",
      );
    }
  }

  #assertReadableInternal(phase: "header" | "payload", offset: number): void {
    if (this.#state === "open") return;
    if (this.#state === "poisoned") return failInternal("CHANNEL_POISONED");
    if (this.#state === "closed") {
      if (phase === "header" && offset === 0) return failInternal("CHANNEL_CLOSED");
      return failInternal("UNEXPECTED_EOF");
    }
    return failInternal(this.#terminalCode ?? "STREAM_ERROR");
  }

  #assertFrameProcessingInternal(): void {
    if (this.#state === "open") return;
    if (this.#state === "closed" && this.#ended) return;
    if (this.#state === "poisoned") return failInternal("CHANNEL_POISONED");
    if (this.#state === "closed") return failInternal("CHANNEL_CLOSED");
    return failInternal(this.#terminalCode ?? "STREAM_ERROR");
  }

  async #waitUntilReadableOrTerminal(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.#waiter = resolve;
      if (this.#state !== "open" || this.#ended) this.#wakeWaiter();
    });
  }

  #wakeWaiter(): void {
    const waiter = this.#waiter;
    this.#waiter = undefined;
    if (waiter !== undefined) waiter();
  }

  #failTerminal(
    code: TrustedWindowsNativeDataPlaneChannelErrorCodeV1,
    destroy = true,
  ): void {
    if (this.#state !== "open") return;
    this.#state = "failed";
    this.#terminalCode = code;
    this.#wakeWaiter();
    if (destroy) this.#destroyBestEffort();
  }

  #destroyBestEffort(): void {
    try {
      this.#sourceFramesFromHelper.destroy();
    } catch {
      // The channel is already terminal. Never inspect or rethrow a foreign value.
    }
  }

  #removeListenersBestEffort(): void {
    try {
      this.#sourceFramesFromHelper.off("error", this.#onError);
      this.#sourceFramesFromHelper.off("readable", this.#onReadable);
      this.#sourceFramesFromHelper.off("end", this.#onEnd);
      this.#sourceFramesFromHelper.off("close", this.#onClose);
    } catch {
      // Constructor failure is reported with a fixed public error.
    }
  }

  #summary(): RedactedChannelSummaryV1 {
    return Object.freeze({
      direction: "source_frames_from_helper",
      state: this.#state,
    });
  }
}

export class TrustedWindowsNativeOutputFramesToHelperChannelV1 {
  readonly #outputFramesToHelper: Writable;
  readonly #wipeObserver: TrustedWindowsNativeDataPlaneBufferWipeObserverV1 | undefined;
  #state: ChannelStateV1 = "open";
  #terminalCode: TrustedWindowsNativeDataPlaneChannelErrorCodeV1 | undefined;
  #acceptingWrites = true;
  #writeTail: Promise<void> = Promise.resolve();
  #currentWrite: PendingWriteV1 | undefined;
  #pendingClose: PendingCloseV1 | undefined;
  #closePromise: Promise<void> | undefined;
  #finishSeen = false;

  readonly #onDrain = (): void => {
    const pending = this.#currentWrite;
    if (pending === undefined) return;
    pending.drainSeen = true;
    this.#settlePendingWrite(pending);
  };

  readonly #onError = (_foreignError: unknown): void => {
    this.#failTerminal("STREAM_ERROR");
  };

  readonly #onClose = (): void => {
    const pending = this.#currentWrite;
    if (pending !== undefined) {
      pending.ownershipReleased = true;
    }
    if (this.#state === "closed" || this.#state === "poisoned") {
      if (pending !== undefined) this.#settlePendingWrite(pending);
      return;
    }
    if (this.#state === "failed") {
      if (pending !== undefined) this.#settlePendingWrite(pending);
      this.#rejectPendingClose(this.#terminalCode ?? "STREAM_ERROR");
      return;
    }
    if (this.#state === "closing" && this.#finishSeen) {
      this.#state = "closed";
      this.#terminalCode = "CHANNEL_CLOSED";
      this.#resolvePendingClose();
      return;
    }
    this.#failTerminal("STREAM_CLOSED", false);
  };

  readonly #onFinish = (): void => {
    this.#finishSeen = true;
    if (this.#state !== "open") return;
    const pending = this.#currentWrite;
    if (pending !== undefined) pending.ownershipReleased = true;
    this.#failTerminal("STREAM_CLOSED", false);
  };

  constructor(
    outputFramesToHelper: Writable,
    testOnlyOnBufferWiped?: TrustedWindowsNativeDataPlaneBufferWipeObserverV1,
  ) {
    this.#outputFramesToHelper = outputFramesToHelper;
    this.#wipeObserver = typeof testOnlyOnBufferWiped === "function"
      ? testOnlyOnBufferWiped
      : undefined;
    try {
      this.#outputFramesToHelper.on("error", this.#onError);
      this.#outputFramesToHelper.on("drain", this.#onDrain);
      this.#outputFramesToHelper.on("close", this.#onClose);
      this.#outputFramesToHelper.on("finish", this.#onFinish);
      const writableFinished: unknown = this.#outputFramesToHelper.writableFinished;
      const writableEnded: unknown = this.#outputFramesToHelper.writableEnded;
      const destroyed: unknown = this.#outputFramesToHelper.destroyed;
      if (writableFinished === true) {
        this.#state = "closed";
        this.#acceptingWrites = false;
        this.#terminalCode = "CHANNEL_CLOSED";
      } else if (writableEnded === true || destroyed === true) {
        this.#state = "failed";
        this.#acceptingWrites = false;
        this.#terminalCode = "STREAM_CLOSED";
      }
    } catch {
      this.#removeListenersBestEffort();
      throw new TrustedWindowsNativeDataPlaneChannelErrorV1("INVALID_CHANNEL");
    }
  }

  writeFrame(frame: TrustedWindowsNativeOutputDataPlaneFrameV1): Promise<void>;
  writeFrame(frame: unknown): Promise<void> {
    const unavailable = this.#publicUnavailableCode();
    if (!this.#acceptingWrites || unavailable !== undefined) {
      return Promise.reject(new TrustedWindowsNativeDataPlaneChannelErrorV1(
        unavailable ?? "CHANNEL_CLOSED",
      ));
    }

    const operation = this.#writeTail.then(async () => {
      await this.#writeOneFrame(frame);
    });
    this.#writeTail = operation.catch(() => {
      // Preserve serialization; the terminal state carries the fixed failure code.
    });
    return operation.catch((error: unknown) => {
      throw publicChannelError(error, this.#terminalCode ?? "STREAM_ERROR");
    });
  }

  closeCleanly(): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise;
    if (this.#state === "closed") return Promise.resolve();
    const unavailable = this.#publicUnavailableCode();
    if (unavailable !== undefined) {
      return Promise.reject(new TrustedWindowsNativeDataPlaneChannelErrorV1(unavailable));
    }
    this.#acceptingWrites = false;
    const operation = this.#writeTail.then(async () => {
      await this.#endStreamCleanly();
    });
    this.#closePromise = operation.catch((error: unknown) => {
      throw publicChannelError(error, this.#terminalCode ?? "STREAM_ERROR");
    });
    return this.#closePromise;
  }

  poison(): void {
    if (this.#state === "poisoned" || this.#state === "closed") return;
    this.#acceptingWrites = false;
    this.#state = "poisoned";
    this.#terminalCode = "CHANNEL_POISONED";
    const pending = this.#currentWrite;
    if (pending !== undefined) {
      pending.terminalCode = "CHANNEL_POISONED";
      this.#settlePendingWrite(pending);
    }
    this.#rejectPendingClose("CHANNEL_POISONED");
    this.#destroyBestEffort();
  }

  [NODE_INSPECT_CUSTOM](): RedactedChannelSummaryV1 {
    return this.#summary();
  }

  toJSON(): RedactedChannelSummaryV1 {
    return this.#summary();
  }

  async #writeOneFrame(frame: unknown): Promise<void> {
    this.#assertWritableInternal();
    let encoded: Uint8Array | undefined;
    try {
      try {
        encoded = encodeTrustedWindowsNativeDataPlaneFrameV1(
          frame as TrustedWindowsNativeDataPlaneFrameV1,
        );
      } catch {
        this.#failTerminal("INVALID_FRAME");
        return failInternal("INVALID_FRAME");
      }
      let kind: TrustedWindowsNativeDataPlaneFrameV1["kind"];
      try {
        kind = preflightTrustedWindowsNativeDataPlaneFrameHeaderV1(
          encoded.subarray(0, TRUSTED_WINDOWS_NATIVE_DATA_PLANE_HEADER_BYTES_V1),
        ).kind;
      } catch {
        this.#failTerminal("INVALID_FRAME");
        return failInternal("INVALID_FRAME");
      }
      if (kind !== "output") {
        this.#failTerminal("INVALID_DIRECTION");
        return failInternal("INVALID_DIRECTION");
      }
      await this.#writeEncodedFrame(encoded);
      this.#assertWritableInternal();
    } finally {
      if (encoded !== undefined) {
        wipeOwnedBytes(
          encoded,
          "output_frames_to_helper",
          "encoded_frame",
          this.#wipeObserver,
        );
      }
    }
  }

  async #writeEncodedFrame(encoded: Uint8Array): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const pending: PendingWriteV1 = {
        callbackDone: false,
        callbackFailed: false,
        drainSeen: false,
        needsDrain: true,
        ownershipReleased: false,
        settled: false,
        terminalCode: undefined,
        writeReturned: false,
        reject,
        resolve,
      };
      this.#currentWrite = pending;

      let accepted: unknown;
      try {
        accepted = this.#outputFramesToHelper.write(encoded, (error?: Error | null) => {
          if (pending.callbackDone) return;
          pending.callbackDone = true;
          pending.ownershipReleased = true;
          pending.callbackFailed = error !== undefined && error !== null;
          if (pending.callbackFailed) this.#failTerminal("STREAM_ERROR");
          this.#settlePendingWrite(pending);
        });
      } catch {
        pending.writeReturned = true;
        pending.ownershipReleased = true;
        pending.terminalCode = "STREAM_ERROR";
        this.#failTerminal("STREAM_ERROR");
        this.#settlePendingWrite(pending);
        return;
      }

      pending.writeReturned = true;
      if (typeof accepted !== "boolean") {
        pending.terminalCode = "STREAM_ERROR";
        this.#failTerminal("STREAM_ERROR");
        this.#settlePendingWrite(pending);
        return;
      }
      pending.needsDrain = !accepted;
      this.#settlePendingWrite(pending);
    }).finally(() => {
      this.#currentWrite = undefined;
    });
  }

  #settlePendingWrite(pending: PendingWriteV1): void {
    if (pending.settled || !pending.writeReturned) return;
    const terminalCode = pending.terminalCode ?? (
      this.#state === "failed" || this.#state === "poisoned"
        ? this.#terminalCode
        : undefined
    );
    if (terminalCode !== undefined) {
      if (!pending.ownershipReleased) return;
      pending.settled = true;
      pending.reject(internalSignal(terminalCode));
      return;
    }
    if (!pending.callbackDone || pending.callbackFailed) return;
    if (pending.needsDrain && !pending.drainSeen) return;
    pending.settled = true;
    pending.resolve();
  }

  async #endStreamCleanly(): Promise<void> {
    this.#assertWritableInternal();
    this.#state = "closing";
    await new Promise<void>((resolve, reject) => {
      const pending: PendingCloseV1 = { settled: false, reject, resolve };
      this.#pendingClose = pending;
      try {
        this.#outputFramesToHelper.end((error?: Error | null) => {
          if (pending.settled) return;
          if (error !== undefined && error !== null) {
            this.#failTerminal("STREAM_ERROR");
            return;
          }
          pending.settled = true;
          this.#pendingClose = undefined;
          this.#state = "closed";
          this.#terminalCode = "CHANNEL_CLOSED";
          pending.resolve();
        });
      } catch {
        this.#failTerminal("STREAM_ERROR");
      }
    });
  }

  #assertWritableInternal(): void {
    if (this.#state === "open") return;
    if (this.#state === "poisoned") return failInternal("CHANNEL_POISONED");
    if (this.#state === "closed" || this.#state === "closing") {
      return failInternal("CHANNEL_CLOSED");
    }
    return failInternal(this.#terminalCode ?? "STREAM_ERROR");
  }

  #publicUnavailableCode(): TrustedWindowsNativeDataPlaneChannelErrorCodeV1 | undefined {
    if (this.#state === "poisoned") return "CHANNEL_POISONED";
    if (this.#state === "closed" || this.#state === "closing") return "CHANNEL_CLOSED";
    if (this.#state === "failed") return this.#terminalCode ?? "STREAM_ERROR";
    return undefined;
  }

  #failTerminal(
    code: TrustedWindowsNativeDataPlaneChannelErrorCodeV1,
    destroy = true,
  ): void {
    if (
      this.#state === "closed" ||
      this.#state === "poisoned" ||
      this.#state === "failed"
    ) return;
    this.#state = "failed";
    this.#acceptingWrites = false;
    this.#terminalCode = code;
    const pending = this.#currentWrite;
    if (pending !== undefined) {
      pending.terminalCode = code;
      this.#settlePendingWrite(pending);
    }
    this.#rejectPendingClose(code);
    if (destroy) this.#destroyBestEffort();
  }

  #resolvePendingClose(): void {
    const pending = this.#pendingClose;
    if (pending === undefined || pending.settled) return;
    pending.settled = true;
    this.#pendingClose = undefined;
    pending.resolve();
  }

  #rejectPendingClose(code: TrustedWindowsNativeDataPlaneChannelErrorCodeV1): void {
    const pending = this.#pendingClose;
    if (pending === undefined || pending.settled) return;
    pending.settled = true;
    this.#pendingClose = undefined;
    pending.reject(internalSignal(code));
  }

  #destroyBestEffort(): void {
    try {
      this.#outputFramesToHelper.destroy();
    } catch {
      const pending = this.#currentWrite;
      if (pending !== undefined) {
        pending.ownershipReleased = true;
        this.#settlePendingWrite(pending);
      }
    }
  }

  #removeListenersBestEffort(): void {
    try {
      this.#outputFramesToHelper.off("error", this.#onError);
      this.#outputFramesToHelper.off("drain", this.#onDrain);
      this.#outputFramesToHelper.off("close", this.#onClose);
      this.#outputFramesToHelper.off("finish", this.#onFinish);
    } catch {
      // Constructor failure is reported with a fixed public error.
    }
  }

  #summary(): RedactedChannelSummaryV1 {
    return Object.freeze({
      direction: "output_frames_to_helper",
      state: this.#state,
    });
  }
}

export class TrustedWindowsNativeDataPlaneChannelsV1 {
  readonly outputFramesToHelper: TrustedWindowsNativeOutputFramesToHelperChannelV1;
  readonly sourceFramesFromHelper: TrustedWindowsNativeSourceFramesFromHelperChannelV1;

  constructor(
    outputFramesToHelper: Writable,
    sourceFramesFromHelper: Readable,
    testOnlyOnBufferWiped?: TrustedWindowsNativeDataPlaneBufferWipeObserverV1,
  ) {
    let outputChannel: TrustedWindowsNativeOutputFramesToHelperChannelV1 | undefined;
    try {
      outputChannel = new TrustedWindowsNativeOutputFramesToHelperChannelV1(
        outputFramesToHelper,
        testOnlyOnBufferWiped,
      );
      this.sourceFramesFromHelper =
        new TrustedWindowsNativeSourceFramesFromHelperChannelV1(
          sourceFramesFromHelper,
          testOnlyOnBufferWiped,
        );
      this.outputFramesToHelper = outputChannel;
    } catch (error: unknown) {
      outputChannel?.poison();
      throw publicChannelError(error, "INVALID_CHANNEL");
    }
  }

  async closeCleanly(): Promise<void> {
    try {
      await this.outputFramesToHelper.closeCleanly();
    } finally {
      this.sourceFramesFromHelper.closeCleanly();
    }
  }

  poison(): void {
    this.outputFramesToHelper.poison();
    this.sourceFramesFromHelper.poison();
  }

  [NODE_INSPECT_CUSTOM](): Readonly<{ readonly state: "data_plane_channels" }> {
    return Object.freeze({ state: "data_plane_channels" });
  }

  toJSON(): Readonly<{ readonly state: "data_plane_channels" }> {
    return Object.freeze({ state: "data_plane_channels" });
  }
}

export function createTrustedWindowsNativeDataPlaneChannelsV1(
  options: TrustedWindowsNativeDataPlaneChannelsOptionsV1,
): TrustedWindowsNativeDataPlaneChannelsV1;
export function createTrustedWindowsNativeDataPlaneChannelsV1(
  options: unknown,
): TrustedWindowsNativeDataPlaneChannelsV1 {
  try {
    if (!isObjectIdentity(options)) return failInternal("INVALID_CHANNEL");
    const outputFramesToHelper = ownDataValue(options, "outputFramesToHelper");
    const sourceFramesFromHelper = ownDataValue(options, "sourceFramesFromHelper");
    const observer = optionalOwnDataValue(options, "testOnlyOnBufferWiped");
    if (observer !== undefined && typeof observer !== "function") {
      return failInternal("INVALID_CHANNEL");
    }
    return new TrustedWindowsNativeDataPlaneChannelsV1(
      outputFramesToHelper as Writable,
      sourceFramesFromHelper as Readable,
      observer as TrustedWindowsNativeDataPlaneBufferWipeObserverV1 | undefined,
    );
  } catch (error: unknown) {
    throw publicChannelError(error, "INVALID_CHANNEL");
  }
}

function copyOwnedBytes(source: Uint8Array, target: Uint8Array, offset: number): void {
  TYPED_ARRAY_SET(target, source, offset);
}

function wipeUnknownStreamChunk(
  value: unknown,
  direction: TrustedWindowsNativeDataPlaneBufferDirectionV1,
  observer: TrustedWindowsNativeDataPlaneBufferWipeObserverV1 | undefined,
): void {
  try {
    const window = intrinsicUint8ArrayWindow(value);
    const view = intrinsicUint8ArrayView(window);
    wipeIntrinsicView(view);
    notifyWipeObserver(observer, direction, "stream_chunk", view);
  } catch {
    // Invalid chunks are terminal; never inspect or rethrow a foreign value here.
  }
}

function wipeOwnedBytes(
  value: Uint8Array,
  direction: TrustedWindowsNativeDataPlaneBufferDirectionV1,
  stage: TrustedWindowsNativeDataPlaneBufferStageV1,
  observer: TrustedWindowsNativeDataPlaneBufferWipeObserverV1 | undefined,
): void {
  const window = intrinsicUint8ArrayWindow(value);
  const view = intrinsicUint8ArrayView(window);
  wipeIntrinsicView(view);
  notifyWipeObserver(observer, direction, stage, view);
}

function wipeIntrinsicView(view: Uint8Array): void {
  TYPED_ARRAY_FILL(view, 0);
}

function notifyWipeObserver(
  observer: TrustedWindowsNativeDataPlaneBufferWipeObserverV1 | undefined,
  direction: TrustedWindowsNativeDataPlaneBufferDirectionV1,
  stage: TrustedWindowsNativeDataPlaneBufferStageV1,
  view: Uint8Array,
): void {
  if (observer === undefined) return;
  try {
    Reflect.apply(observer, undefined, [direction, stage, view]);
  } catch {
    // A test observer cannot weaken cleanup or leak a foreign thrown value.
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

function captureTypedArrayMethod(
  key: PropertyKey,
): (receiver: object, ...arguments_: unknown[]) => unknown {
  const method = Reflect.get(Uint8Array.prototype, key) as unknown;
  if (typeof method !== "function") {
    throw new Error("Required typed-array intrinsic is unavailable.");
  }
  return (receiver: object, ...arguments_: unknown[]): unknown =>
    Reflect.apply(method, receiver, arguments_);
}

function intrinsicUint8ArrayWindow(value: unknown): IntrinsicUint8ArrayWindow {
  if (!isObjectIdentity(value)) return failInternal("INVALID_STREAM_CHUNK");
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
    return failInternal("INVALID_STREAM_CHUNK");
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
    return failInternal("INVALID_STREAM_CHUNK");
  }
  return {
    buffer: buffer as ArrayBufferLike,
    byteLength,
    byteOffset,
  };
}

function intrinsicUint8ArrayView(window: IntrinsicUint8ArrayWindow): Uint8Array {
  try {
    return new Uint8Array(window.buffer, window.byteOffset, window.byteLength);
  } catch {
    return failInternal("INVALID_STREAM_CHUNK");
  }
}

function ownDataValue(input: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    return failInternal("INVALID_CHANNEL");
  }
  return descriptor.value as unknown;
}

function optionalOwnDataValue(input: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor)) return failInternal("INVALID_CHANNEL");
  return descriptor.value as unknown;
}

function publicChannelError(
  error: unknown,
  fallback: TrustedWindowsNativeDataPlaneChannelErrorCodeV1,
): TrustedWindowsNativeDataPlaneChannelErrorV1 {
  return new TrustedWindowsNativeDataPlaneChannelErrorV1(
    internalChannelErrorCode(error) ?? fallback,
  );
}

function internalChannelErrorCode(
  error: unknown,
): TrustedWindowsNativeDataPlaneChannelErrorCodeV1 | undefined {
  return isObjectIdentity(error) ? INTERNAL_CHANNEL_ERRORS.get(error) : undefined;
}

function internalSignal(code: TrustedWindowsNativeDataPlaneChannelErrorCodeV1): Error {
  const signal = new Error("Internal data-plane channel rejection.");
  INTERNAL_CHANNEL_ERRORS.set(signal, code);
  return signal;
}

function failInternal(code: TrustedWindowsNativeDataPlaneChannelErrorCodeV1): never {
  throw internalSignal(code);
}

function isObjectIdentity(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}
