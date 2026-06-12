import {
  GuestFlowReplayArtifactSchema,
  runGuestFlowReplayV0,
  type GuestFlowReplayArtifact,
  type GuestFlowReplayInput,
} from "@omnitwin/types";
import type {
  GuestFlowReplayWorkerRequest,
  GuestFlowReplayWorkerResponse,
} from "../workers/guest-flow-replay.worker.js";

export type GuestFlowReplayRunMode = "worker" | "main-thread-fallback";

export interface GuestFlowReplayBrowserResult {
  readonly artifact: GuestFlowReplayArtifact;
  readonly mode: GuestFlowReplayRunMode;
}

export interface GuestFlowReplayBrowserOptions {
  readonly preferWorker?: boolean;
  readonly timeoutMs?: number;
  readonly workerFactory?: (() => Worker) | null;
}

let requestCounter = 0;

function directResult(input: GuestFlowReplayInput): GuestFlowReplayBrowserResult {
  return {
    artifact: GuestFlowReplayArtifactSchema.parse(runGuestFlowReplayV0(input)),
    mode: "main-thread-fallback",
  };
}

function defaultWorkerFactory(): Worker | null {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("../workers/guest-flow-replay.worker.ts", import.meta.url), { type: "module" });
}

export function canUseGuestFlowReplayWorker(): boolean {
  return typeof Worker !== "undefined";
}

export function runGuestFlowReplayInBrowser(
  input: GuestFlowReplayInput,
  options: GuestFlowReplayBrowserOptions = {},
): Promise<GuestFlowReplayBrowserResult> {
  if (options.preferWorker === false) {
    return Promise.resolve(directResult(input));
  }

  const worker = options.workerFactory === null
    ? null
    : options.workerFactory !== undefined
      ? options.workerFactory()
      : defaultWorkerFactory();
  if (worker === null) {
    return Promise.resolve(directResult(input));
  }

  const id = `guest-flow-${String(++requestCounter)}`;
  const request: GuestFlowReplayWorkerRequest = { id, input };
  const timeoutMs = options.timeoutMs ?? 2500;

  return new Promise<GuestFlowReplayBrowserResult>((resolve) => {
    let settled = false;
    const finish = (result: GuestFlowReplayBrowserResult): void => {
      if (settled) return;
      settled = true;
      worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish(directResult(input));
    }, timeoutMs);

    worker.onmessage = (event: MessageEvent<GuestFlowReplayWorkerResponse>) => {
      if (event.data.id !== id || settled) return;
      clearTimeout(timer);
      if (event.data.ok) {
        finish({
          artifact: GuestFlowReplayArtifactSchema.parse(event.data.artifact),
          mode: "worker",
        });
        return;
      }
      finish(directResult(input));
    };
    worker.onerror = () => {
      clearTimeout(timer);
      finish(directResult(input));
    };
    worker.postMessage(request);
  });
}
