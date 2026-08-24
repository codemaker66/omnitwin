import { useCallback, useEffect, useState } from "react";
import {
  parseLocalGrandHallEvidenceDescriptor,
  verifyLocalGrandHallPresentationManifest,
  type LocalGrandHallEvidenceDescriptor,
  type LocalGrandHallEvidenceRequest,
} from "../lib/local-grand-hall-evidence.js";

export const LOCAL_GRAND_HALL_DESCRIPTOR_MAX_BYTES = 512 * 1024;

type StoredEvidenceState =
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
      readonly candidate: LocalGrandHallEvidenceDescriptor;
    };

interface EvidenceLoadStateBase {
  readonly retry: () => void;
}

export type LocalGrandHallEvidenceLoadState =
  | (EvidenceLoadStateBase & {
      readonly status: "inactive";
      readonly explicit: false;
    })
  | (EvidenceLoadStateBase & {
      readonly status: "loading";
      readonly explicit: true;
    })
  | (EvidenceLoadStateBase & {
      readonly status: "error";
      readonly explicit: true;
      readonly message: string;
      readonly retryable: boolean;
    })
  | (EvidenceLoadStateBase & {
      readonly status: "ready";
      readonly explicit: true;
      readonly candidate: LocalGrandHallEvidenceDescriptor;
    });

function requireDescriptorResponse(response: Response): void {
  if (response.redirected) {
    throw new Error("The local room-evidence descriptor response redirected unexpectedly.");
  }
  if (response.status !== 200) {
    throw new Error(
      `The local room-evidence descriptor returned HTTP ${String(response.status)}.`,
    );
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new Error("The local room-evidence descriptor did not return JSON.");
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength === null) return;
  const parsedLength = Number(contentLength);
  if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
    throw new Error("The local room-evidence descriptor returned an invalid content length.");
  }
  if (parsedLength > LOCAL_GRAND_HALL_DESCRIPTOR_MAX_BYTES) {
    throw new Error("The local room-evidence descriptor exceeds the 512 KiB safety limit.");
  }
}

async function readBoundedDescriptorBody(response: Response): Promise<unknown> {
  if (response.body === null) {
    throw new Error("The local room-evidence descriptor response was empty.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    let next = await reader.read();
    while (!next.done) {
      totalBytes += next.value.byteLength;
      if (totalBytes > LOCAL_GRAND_HALL_DESCRIPTOR_MAX_BYTES) {
        await reader.cancel();
        throw new Error("The local room-evidence descriptor exceeds the 512 KiB safety limit.");
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
    throw new Error("The local room-evidence descriptor is not valid UTF-8.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("The local room-evidence descriptor contains invalid JSON.");
  }
}

async function fetchLocalGrandHallEvidenceDescriptor(
  descriptorUrl: string,
  signal: AbortSignal,
): Promise<LocalGrandHallEvidenceDescriptor> {
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
  let candidate: LocalGrandHallEvidenceDescriptor;
  try {
    candidate = parseLocalGrandHallEvidenceDescriptor(value, descriptorUrl);
    await verifyLocalGrandHallPresentationManifest(candidate);
  } catch {
    throw new Error(
      "The local room-evidence descriptor does not match the exact Grand Hall all-source grant.",
    );
  }
  return candidate;
}

function safeLoadError(error: unknown): string {
  if (!(error instanceof Error) || error.message.length === 0) {
    return "The local room-evidence descriptor could not be loaded.";
  }
  if (/token=|127\.0\.0\.1|https?:\/\//iu.test(error.message)) {
    return "The local room-evidence descriptor could not be loaded.";
  }
  return error.message;
}

export function useLocalGrandHallEvidence(
  request: LocalGrandHallEvidenceRequest,
): LocalGrandHallEvidenceLoadState {
  const [reloadRevision, setReloadRevision] = useState(0);
  const [stored, setStored] = useState<StoredEvidenceState>({ status: "empty" });
  const retry = useCallback(() => {
    setReloadRevision((revision) => revision + 1);
  }, []);
  const descriptorUrl = request.kind === "ready" ? request.descriptorUrl : null;

  useEffect(() => {
    if (descriptorUrl === null) return;
    const controller = new AbortController();
    let active = true;
    setStored({ status: "loading", descriptorUrl, reloadRevision });
    void fetchLocalGrandHallEvidenceDescriptor(descriptorUrl, controller.signal)
      .then((candidate) => {
        if (!active) return;
        setStored({
          status: "ready",
          descriptorUrl,
          reloadRevision,
          candidate,
        });
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
  if (
    stored.status === "ready" &&
    stored.descriptorUrl === request.descriptorUrl &&
    stored.reloadRevision === reloadRevision
  ) {
    return {
      status: "ready",
      explicit: true,
      candidate: stored.candidate,
      retry,
    };
  }
  return { status: "loading", explicit: true, retry };
}
