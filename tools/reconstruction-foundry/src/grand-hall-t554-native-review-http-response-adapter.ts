export const GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_V1 =
  "venviewer.grand-hall-t554-native-review-http-response-adapter.v1";

export type GrandHallT554NativeReviewTileDeliveryDiscardReason =
  | "request-aborted"
  | "request-error"
  | "response-close"
  | "response-error";

export type GrandHallT554NativeReviewTileDeliveryOutcome =
  | {
      readonly status: "recorded";
      readonly responseFinishedAtUtc: string;
    }
  | {
      readonly status: "discarded";
      readonly reason: GrandHallT554NativeReviewTileDeliveryDiscardReason;
    };

export interface GrandHallT554NativeReviewTileDeliveryLifecycle {
  readonly schemaVersion: typeof GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_V1;
  readonly completion: Promise<GrandHallT554NativeReviewTileDeliveryOutcome>;
}

export interface GrandHallT554NativeReviewIncomingMessageLifecycleTarget {
  once(eventName: string, listener: () => void): unknown;
  removeListener(eventName: string, listener: () => void): unknown;
}

export interface GrandHallT554NativeReviewServerResponseLifecycleTarget
  extends GrandHallT554NativeReviewIncomingMessageLifecycleTarget {
  readonly writableFinished: boolean;
}

export interface GrandHallT554NativeReviewTileDeliveryLifecycleInput {
  readonly request?: GrandHallT554NativeReviewIncomingMessageLifecycleTarget;
  readonly response: GrandHallT554NativeReviewServerResponseLifecycleTarget;
  readonly recordTileDelivery: (
    responseFinishedAtUtc: string,
  ) => Promise<void> | void;
}

export class GrandHallT554NativeReviewHttpResponseAdapterError extends Error {
  constructor(
    readonly code: "ARGUMENT_INVALID" | "DELIVERY_RECORD_FAILED",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeReviewHttpResponseAdapterError";
  }
}

function invalid(message: string): never {
  throw new GrandHallT554NativeReviewHttpResponseAdapterError(
    "ARGUMENT_INVALID",
    message,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isLifecycleEmitter(
  value: unknown,
): value is GrandHallT554NativeReviewIncomingMessageLifecycleTarget {
  return (
    isRecord(value) &&
    typeof value.once === "function" &&
    typeof value.removeListener === "function"
  );
}

function isTileDeliveryRecorder(
  value: unknown,
): value is GrandHallT554NativeReviewTileDeliveryLifecycleInput["recordTileDelivery"] {
  return typeof value === "function";
}

/**
 * Binds one tile-delivery mutation to the lifecycle of one Node response.
 *
 * `recordTileDelivery` is invoked exactly once and only after Node emits
 * `finish`. A response close/error or request abort/error that wins the race
 * permanently discards the candidate. The server-owned finish timestamp is
 * minted inside this adapter; browser input cannot supply it.
 */
export function recordGrandHallT554NativeReviewTileDeliveryAfterResponseFinish(
  input: GrandHallT554NativeReviewTileDeliveryLifecycleInput,
): GrandHallT554NativeReviewTileDeliveryLifecycle {
  const untrustedInput: unknown = input;
  if (!isRecord(untrustedInput)) {
    return invalid("A Node response lifecycle input is required.");
  }
  const request = untrustedInput.request;
  const response = untrustedInput.response;
  const recordTileDelivery = untrustedInput.recordTileDelivery;
  if (
    !isLifecycleEmitter(response) ||
    !("writableFinished" in response) ||
    typeof response.writableFinished !== "boolean"
  ) {
    return invalid("response must be a Node ServerResponse.");
  }
  if (!isTileDeliveryRecorder(recordTileDelivery)) {
    return invalid("recordTileDelivery must be a function.");
  }
  const trustedRecordTileDelivery = recordTileDelivery;
  if (
    request !== undefined && !isLifecycleEmitter(request)
  ) {
    return invalid("request must be a Node IncomingMessage when supplied.");
  }

  let settled = false;
  let resolveCompletion:
    | ((outcome: GrandHallT554NativeReviewTileDeliveryOutcome) => void)
    | undefined;
  let rejectCompletion: ((reason: unknown) => void) | undefined;
  const completion = new Promise<GrandHallT554NativeReviewTileDeliveryOutcome>(
    (resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    },
  );

  const detach = (): void => {
    response.removeListener("finish", onFinish);
    response.removeListener("close", onResponseClose);
    response.removeListener("error", onResponseError);
    request?.removeListener("aborted", onRequestAborted);
    request?.removeListener("error", onRequestError);
  };

  const discard = (
    reason: GrandHallT554NativeReviewTileDeliveryDiscardReason,
  ): void => {
    if (settled) return;
    settled = true;
    detach();
    resolveCompletion?.({ status: "discarded", reason });
  };

  function onResponseClose(): void {
    discard("response-close");
  }

  function onResponseError(): void {
    discard("response-error");
  }

  function onRequestAborted(): void {
    discard("request-aborted");
  }

  function onRequestError(): void {
    discard("request-error");
  }

  function onFinish(): void {
    if (settled) return;
    settled = true;
    detach();
    const responseFinishedAtUtc = new Date().toISOString();
    let result: Promise<void> | void;
    try {
      result = trustedRecordTileDelivery(responseFinishedAtUtc);
    } catch (error) {
      rejectCompletion?.(
        new GrandHallT554NativeReviewHttpResponseAdapterError(
          "DELIVERY_RECORD_FAILED",
          "The finished tile response could not be recorded.",
          error,
        ),
      );
      return;
    }
    void Promise.resolve(result).then(
      () => {
        resolveCompletion?.({ status: "recorded", responseFinishedAtUtc });
      },
      (error: unknown) => {
        rejectCompletion?.(
          new GrandHallT554NativeReviewHttpResponseAdapterError(
            "DELIVERY_RECORD_FAILED",
            "The finished tile response could not be recorded.",
            error,
          ),
        );
      },
    );
  }

  response.once("finish", onFinish);
  response.once("close", onResponseClose);
  response.once("error", onResponseError);
  request?.once("aborted", onRequestAborted);
  request?.once("error", onRequestError);

  // Listener registration precedes this check so a finish racing the binding
  // cannot be missed. `settled` makes the event/check pair idempotent.
  if (response.writableFinished) onFinish();

  return Object.freeze({
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_V1,
    completion,
  });
}
