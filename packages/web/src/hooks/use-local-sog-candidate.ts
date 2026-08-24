import { useCallback, useEffect, useMemo, useState } from "react";
import {
  parseLocalSogCandidateDescriptor,
  selectLocalSogCandidateTier,
  type LocalSogCandidateDescriptor,
  type LocalSogCandidateRequest,
  type LocalSogCandidateSelection,
} from "../lib/local-sog-candidate.js";

const MAX_DESCRIPTOR_BYTES = 256 * 1024;

type StoredCandidateState =
  | { readonly status: "empty" }
  | {
      readonly status: "loading";
      readonly descriptorUrl: string;
      readonly reloadRevision: number;
    }
  | {
      readonly status: "error";
      readonly descriptorUrl: string;
      readonly reloadRevision: number;
      readonly message: string;
    }
  | {
      readonly status: "ready";
      readonly descriptorUrl: string;
      readonly reloadRevision: number;
      readonly candidate: LocalSogCandidateDescriptor;
    };

interface CandidateLoadStateBase {
  readonly retry: () => void;
}

export type LocalSogCandidateLoadState =
  | (CandidateLoadStateBase & {
      readonly status: "inactive";
      readonly explicit: false;
    })
  | (CandidateLoadStateBase & {
      readonly status: "loading";
      readonly explicit: true;
    })
  | (CandidateLoadStateBase & {
      readonly status: "error";
      readonly explicit: true;
      readonly message: string;
      readonly retryable: boolean;
    })
  | (CandidateLoadStateBase & {
      readonly status: "ready";
      readonly explicit: true;
      readonly candidate: LocalSogCandidateDescriptor;
      readonly selection: LocalSogCandidateSelection;
    });

function requireDescriptorResponse(response: Response): void {
  if (response.redirected) {
    throw new Error("The local SOG candidate descriptor response redirected unexpectedly.");
  }
  if (response.status !== 200) {
    throw new Error(`The local SOG candidate descriptor returned HTTP ${String(response.status)}.`);
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new Error("The local SOG candidate descriptor did not return JSON.");
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new Error("The local SOG candidate descriptor returned an invalid content length.");
    }
    if (parsedLength > MAX_DESCRIPTOR_BYTES) {
      throw new Error("The local SOG candidate descriptor exceeds the 256 KiB safety limit.");
    }
  }
}

async function readBoundedDescriptorBody(response: Response): Promise<unknown> {
  if (response.body === null) {
    throw new Error("The local SOG candidate descriptor response was empty.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    let next = await reader.read();
    while (!next.done) {
      totalBytes += next.value.byteLength;
      if (totalBytes > MAX_DESCRIPTOR_BYTES) {
        await reader.cancel();
        throw new Error("The local SOG candidate descriptor exceeds the 256 KiB safety limit.");
      }
      chunks.push(next.value);
      next = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("The local SOG candidate descriptor is not valid UTF-8.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("The local SOG candidate descriptor contains invalid JSON.");
  }
}

async function fetchLocalSogCandidateDescriptor(
  descriptorUrl: string,
  signal: AbortSignal,
): Promise<LocalSogCandidateDescriptor> {
  const response = await fetch(descriptorUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal,
  });
  requireDescriptorResponse(response);
  const value = await readBoundedDescriptorBody(response);
  try {
    return parseLocalSogCandidateDescriptor(value, descriptorUrl);
  } catch {
    throw new Error("The local SOG candidate descriptor does not match the exact Grand Hall candidate grant.");
  }
}

function safeLoadError(error: unknown): string {
  if (!(error instanceof Error) || error.message.length === 0) {
    return "The local SOG candidate descriptor could not be loaded.";
  }
  if (/token=|127\.0\.0\.1|https?:\/\//iu.test(error.message)) {
    return "The local SOG candidate descriptor could not be loaded.";
  }
  return error.message;
}

export function useLocalSogCandidate(
  request: LocalSogCandidateRequest,
  viewportWidth: number,
  maxSplats = 4_000_000,
): LocalSogCandidateLoadState {
  const [reloadRevision, setReloadRevision] = useState(0);
  const [stored, setStored] = useState<StoredCandidateState>({ status: "empty" });
  const retry = useCallback(() => { setReloadRevision((revision) => revision + 1); }, []);
  const descriptorUrl = request.kind === "ready" ? request.descriptorUrl : null;

  useEffect(() => {
    if (descriptorUrl === null) return;
    const controller = new AbortController();
    let active = true;
    setStored({ status: "loading", descriptorUrl, reloadRevision });
    void fetchLocalSogCandidateDescriptor(descriptorUrl, controller.signal)
      .then((candidate) => {
        if (!active) return;
        setStored({ status: "ready", descriptorUrl, reloadRevision, candidate });
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        setStored({
          status: "error",
          descriptorUrl,
          reloadRevision,
          message: safeLoadError(error),
        });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [descriptorUrl, reloadRevision]);

  const currentCandidate =
    descriptorUrl !== null &&
    stored.status === "ready" &&
    stored.descriptorUrl === descriptorUrl &&
    stored.reloadRevision === reloadRevision
      ? stored.candidate
      : null;
  const selection = useMemo(
    () => currentCandidate === null
      ? null
      : selectLocalSogCandidateTier(currentCandidate, viewportWidth, maxSplats),
    [currentCandidate, maxSplats, viewportWidth],
  );

  if (request.kind === "none") {
    return { status: "inactive", explicit: false, retry };
  }
  if (request.kind === "invalid") {
    return {
      status: "error",
      explicit: true,
      message: request.message,
      retryable: false,
      retry,
    };
  }
  if (
    stored.status === "error" &&
    stored.descriptorUrl === request.descriptorUrl &&
    stored.reloadRevision === reloadRevision
  ) {
    return {
      status: "error",
      explicit: true,
      message: stored.message,
      retryable: true,
      retry,
    };
  }
  if (currentCandidate !== null && selection !== null) {
    return {
      status: "ready",
      explicit: true,
      candidate: currentCandidate,
      selection,
      retry,
    };
  }
  return { status: "loading", explicit: true, retry };
}
