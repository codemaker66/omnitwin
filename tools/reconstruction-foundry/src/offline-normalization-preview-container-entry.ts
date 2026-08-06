import { type Readable, type Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import {
  decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_BYTES,
} from "../../../packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview-sandbox-wire.js";
import { runFoundryOfflineNormalizeMeshGlbPreviewSandboxWorker } from "../../../packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview-sandbox-worker.js";

export const OFFLINE_NORMALIZATION_PREVIEW_CONTAINER_EXIT_SUCCESS = 0;
export const OFFLINE_NORMALIZATION_PREVIEW_CONTAINER_EXIT_FAILURE = 70;

export type OfflineNormalizationPreviewContainerExitStatus =
  | typeof OFFLINE_NORMALIZATION_PREVIEW_CONTAINER_EXIT_SUCCESS
  | typeof OFFLINE_NORMALIZATION_PREVIEW_CONTAINER_EXIT_FAILURE;

class ContainerEntryFailure extends Error {
  constructor() {
    super("Offline normalization preview container entry failed.");
    this.name = "ContainerEntryFailure";
  }
}

function fail(): never {
  throw new ContainerEntryFailure();
}

function bestEffortZeroize(bytes: Uint8Array | null | undefined): void {
  if (bytes === null || bytes === undefined) return;
  try {
    bytes.fill(0);
  } catch {
    // This is bounded in-memory hygiene, not a secure-erasure claim.
  }
}

const INPUT_BLOCK_BYTES = 64 * 1024;

function boundedChunkView(
  value: unknown,
  remainingBytes: number,
): Uint8Array {
  if (!(value instanceof Uint8Array)) fail();
  if (
    !Number.isSafeInteger(value.byteLength) ||
    value.byteLength <= 0 ||
    value.byteLength > remainingBytes
  ) {
    fail();
  }
  return value;
}

async function readOneEofTerminatedRequest(input: Readable): Promise<Buffer> {
  const blocks: Buffer[] = [];
  let totalBytes = 0;
  let blockOffset = INPUT_BLOCK_BYTES;
  try {
    for await (const value of input as AsyncIterable<unknown>) {
      const chunk = boundedChunkView(
        value,
        FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_BYTES -
          totalBytes,
      );
      let chunkOffset = 0;
      while (chunkOffset < chunk.byteLength) {
        if (blockOffset === INPUT_BLOCK_BYTES) {
          blocks.push(Buffer.allocUnsafe(INPUT_BLOCK_BYTES));
          blockOffset = 0;
        }
        const block = blocks.at(-1);
        if (block === undefined) fail();
        const copyBytes = Math.min(
          chunk.byteLength - chunkOffset,
          INPUT_BLOCK_BYTES - blockOffset,
        );
        block.set(
          chunk.subarray(chunkOffset, chunkOffset + copyBytes),
          blockOffset,
        );
        chunkOffset += copyBytes;
        blockOffset += copyBytes;
      }
      totalBytes += chunk.byteLength;
    }
    if (
      totalBytes <= 0 ||
      totalBytes >
        FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_BYTES
    ) {
      fail();
    }
    const request = Buffer.allocUnsafe(totalBytes);
    let outputOffset = 0;
    for (const block of blocks) {
      const copyBytes = Math.min(block.byteLength, totalBytes - outputOffset);
      block.copy(request, outputOffset, 0, copyBytes);
      outputOffset += copyBytes;
    }
    return request;
  } finally {
    for (const block of blocks) bestEffortZeroize(block);
  }
}

function waitForSingleBoundedWrite(
  output: Writable,
  response: Buffer,
): Promise<void> {
  if (
    output.destroyed ||
    output.writableEnded ||
    output.writableFinished
  ) {
    return Promise.reject(new ContainerEntryFailure());
  }
  return new Promise<void>((resolveWrite, rejectWrite) => {
    let finished = false;
    let waitingForDrain = false;

    const cleanup = (): void => {
      output.removeListener("drain", onDrain);
      output.removeListener("error", onError);
      output.removeListener("finish", onFinish);
      output.removeListener("close", onClose);
    };
    const reject = (): void => {
      cleanup();
      rejectWrite(new ContainerEntryFailure());
    };
    const endOutput = (): void => {
      try {
        output.end();
      } catch {
        reject();
      }
    };
    const onDrain = (): void => {
      if (!waitingForDrain) return;
      waitingForDrain = false;
      endOutput();
    };
    const onError = (): void => {
      reject();
    };
    const onFinish = (): void => {
      finished = true;
      cleanup();
      resolveWrite();
    };
    const onClose = (): void => {
      if (!finished) reject();
    };

    output.once("drain", onDrain);
    output.once("error", onError);
    output.once("finish", onFinish);
    output.once("close", onClose);
    try {
      const accepted = output.write(response);
      if (accepted) {
        endOutput();
      } else {
        waitingForDrain = true;
      }
    } catch {
      reject();
    }
  });
}

/**
 * Runs one bounded stdin/stdout semantic-worker exchange.
 *
 * The caller must end `input`; concatenated or trailing wire messages are
 * rejected by the authenticated wire decoder. This function performs no
 * filesystem, network, subprocess, persistence, environment-configuration,
 * or browser work. It does not establish an operating-system sandbox or its
 * own wall-clock bound; the pinned image must run it beneath the fixed PID-1
 * watchdog, with an independent host deadline as a second layer.
 */
export async function runOfflineNormalizationPreviewContainerEntry(
  input: Readable,
  output: Writable,
): Promise<OfflineNormalizationPreviewContainerExitStatus> {
  let request: Buffer | null = null;
  let workerResponse: Buffer | null = null;
  let response: Buffer | null = null;
  let decodedBinary: Buffer | null = null;
  try {
    request = await readOneEofTerminatedRequest(input);
    const candidateResponse =
      await runFoundryOfflineNormalizeMeshGlbPreviewSandboxWorker(request);
    if (
      !(candidateResponse instanceof Uint8Array) ||
      candidateResponse.byteLength <= 0 ||
      candidateResponse.byteLength >
        FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_BYTES
    ) {
      bestEffortZeroize(candidateResponse);
      fail();
    }
    workerResponse = Buffer.from(candidateResponse);
    bestEffortZeroize(candidateResponse);
    const decoded =
      decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(
        workerResponse,
      );
    if (decoded.kind === "transform_success") {
      decodedBinary = decoded.outputBytes;
    } else if (
      decoded.kind !== "fresh_verifier_success" &&
      decoded.kind !== "failure"
    ) {
      fail();
    }
    response = Buffer.from(workerResponse);
    await waitForSingleBoundedWrite(output, response);
    return decoded.kind === "failure"
      ? OFFLINE_NORMALIZATION_PREVIEW_CONTAINER_EXIT_FAILURE
      : OFFLINE_NORMALIZATION_PREVIEW_CONTAINER_EXIT_SUCCESS;
  } catch {
    return OFFLINE_NORMALIZATION_PREVIEW_CONTAINER_EXIT_FAILURE;
  } finally {
    bestEffortZeroize(decodedBinary);
    bestEffortZeroize(response);
    bestEffortZeroize(workerResponse);
    bestEffortZeroize(request);
  }
}

function isDirectEsmEntry(): boolean {
  const entryPath = process.argv[1];
  return entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url;
}

if (isDirectEsmEntry()) {
  void runOfflineNormalizationPreviewContainerEntry(
    process.stdin,
    process.stdout,
  ).then(
    (exitStatus) => {
      process.exitCode = exitStatus;
    },
    () => {
      process.exitCode = OFFLINE_NORMALIZATION_PREVIEW_CONTAINER_EXIT_FAILURE;
    },
  );
}
