export const GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_V2 =
  "venviewer.grand-hall-t554-native-review-http-response-adapter.v2";

export type GrandHallT554NativeReviewHttpResponseDiscardReasonV2 =
  | "request-aborted"
  | "request-error"
  | "response-close"
  | "response-error"
  | "response-send-already-started"
  | "synchronous-send-failure";

export type GrandHallT554NativeReviewHttpResponseDeliveryOutcomeV2 =
  | {
      readonly status: "committed";
      readonly responseFinishedAtUtc: string;
    }
  | {
      readonly status: "discarded";
      readonly reason: GrandHallT554NativeReviewHttpResponseDiscardReasonV2;
    };

type LifecycleListenerV2 = (...arguments_: readonly unknown[]) => void;

/** The lifecycle-only surface used from a Node IncomingMessage. */
export interface GrandHallT554NativeReviewHttpRequestLifecycleTargetV2 {
  readonly aborted: boolean;
  once(eventName: string, listener: LifecycleListenerV2): unknown;
  removeListener(eventName: string, listener: LifecycleListenerV2): unknown;
}

/** The lifecycle-only surface used from a Node ServerResponse. */
export interface GrandHallT554NativeReviewHttpResponseLifecycleTargetV2 {
  readonly destroyed: boolean;
  readonly headersSent: boolean;
  readonly writableEnded: boolean;
  readonly writableFinished: boolean;
  once(eventName: string, listener: LifecycleListenerV2): unknown;
  removeListener(eventName: string, listener: LifecycleListenerV2): unknown;
}

/** The delivery callbacks exposed by one prepared source or mask facade tile. */
export interface GrandHallT554NativeReviewFacadeTileDeliveryV2 {
  readonly commitDeliveryAfterSuccessfulSend: () => Promise<void>;
  readonly discardAfterFailedSend: () => Promise<void>;
}

export interface GrandHallT554NativeReviewHttpResponseAdapterInputV2 {
  readonly request: GrandHallT554NativeReviewHttpRequestLifecycleTargetV2;
  readonly response: GrandHallT554NativeReviewHttpResponseLifecycleTargetV2;
  readonly tile: GrandHallT554NativeReviewFacadeTileDeliveryV2;
}

export interface GrandHallT554NativeReviewHttpResponseDeliveryLifecycleV2 {
  readonly schemaVersion: typeof GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_V2;
  readonly completion: Promise<GrandHallT554NativeReviewHttpResponseDeliveryOutcomeV2>;
  readonly discardAfterSynchronousSendFailure: () => void;
}

export type GrandHallT554NativeReviewHttpResponseAdapterErrorCodeV2 =
  | "ARGUMENT_INVALID"
  | "DELIVERY_COMMIT_FAILED"
  | "DELIVERY_DISCARD_FAILED";

export class GrandHallT554NativeReviewHttpResponseAdapterErrorV2 extends Error {
  constructor(
    readonly code: GrandHallT554NativeReviewHttpResponseAdapterErrorCodeV2,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeReviewHttpResponseAdapterErrorV2";
  }
}

function invalid(message: string): never {
  throw new GrandHallT554NativeReviewHttpResponseAdapterErrorV2(
    "ARGUMENT_INVALID",
    message,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function hasLifecycleEmitterSurface(value: Record<string, unknown>): boolean {
  return (
    typeof value.once === "function" &&
    typeof value.removeListener === "function"
  );
}

function isRequestLifecycleTarget(
  value: unknown,
): value is GrandHallT554NativeReviewHttpRequestLifecycleTargetV2 {
  return (
    isRecord(value) &&
    hasLifecycleEmitterSurface(value) &&
    typeof value.aborted === "boolean"
  );
}

function isResponseLifecycleTarget(
  value: unknown,
): value is GrandHallT554NativeReviewHttpResponseLifecycleTargetV2 {
  return (
    isRecord(value) &&
    hasLifecycleEmitterSurface(value) &&
    typeof value.destroyed === "boolean" &&
    typeof value.headersSent === "boolean" &&
    typeof value.writableEnded === "boolean" &&
    typeof value.writableFinished === "boolean"
  );
}

function isFacadeTileDelivery(
  value: unknown,
): value is GrandHallT554NativeReviewFacadeTileDeliveryV2 {
  return (
    isRecord(value) &&
    typeof value.commitDeliveryAfterSuccessfulSend === "function" &&
    typeof value.discardAfterFailedSend === "function"
  );
}

/**
 * Binds exactly one prepared facade tile to exactly one native HTTP response.
 *
 * Callers must bind before writing response headers or bytes. Node's `finish`
 * event commits the tile; every failed-send signal discards it. The terminal
 * choice is made synchronously, before either asynchronous facade callback is
 * invoked, so racing transport events cannot invoke both callbacks. Only a
 * `finish` event observed after listener attachment may commit. Pre-existing
 * send state is a late bind and therefore discards the prepared delivery.
 */
export function bindGrandHallT554NativeReviewTileToHttpResponseV2(
  input: GrandHallT554NativeReviewHttpResponseAdapterInputV2,
): GrandHallT554NativeReviewHttpResponseDeliveryLifecycleV2 {
  const untrustedInput: unknown = input;
  if (!isRecord(untrustedInput)) {
    return invalid("An HTTP response adapter input is required.");
  }

  const request = untrustedInput.request;
  const response = untrustedInput.response;
  const tile = untrustedInput.tile;
  if (!isRequestLifecycleTarget(request)) {
    return invalid(
      "request must expose aborted, once, and removeListener lifecycle members.",
    );
  }
  if (!isResponseLifecycleTarget(response)) {
    return invalid(
      "response must expose destroyed, headersSent, writableEnded, writableFinished, once, and removeListener lifecycle members.",
    );
  }
  if (!isFacadeTileDelivery(tile)) {
    return invalid(
      "tile must expose commitDeliveryAfterSuccessfulSend and discardAfterFailedSend callbacks.",
    );
  }
  const commitDeliveryAfterSuccessfulSend =
    tile.commitDeliveryAfterSuccessfulSend;
  const discardAfterFailedSend = tile.discardAfterFailedSend;

  let terminalSelected = false;
  let listenersDetached = false;
  let resolveCompletion:
    | ((
        outcome: GrandHallT554NativeReviewHttpResponseDeliveryOutcomeV2,
      ) => void)
    | undefined;
  let rejectCompletion: ((reason: unknown) => void) | undefined;
  const completion =
    new Promise<GrandHallT554NativeReviewHttpResponseDeliveryOutcomeV2>(
      (resolve, reject) => {
        resolveCompletion = resolve;
        rejectCompletion = reject;
      },
    );
  // This adapter can settle from native events before a router reaches its
  // terminal await. Mark the original promise as observed immediately without
  // replacing it: callers still receive and must terminally observe the same
  // rejectable `completion` promise.
  void completion.catch(() => undefined);

  const isTerminalSelected = (): boolean => terminalSelected;

  const detachListeners = (): void => {
    if (listenersDetached) return;
    listenersDetached = true;
    request.removeListener("aborted", onRequestAborted);
    request.removeListener("error", onRequestError);
    response.removeListener("finish", onResponseFinish);
    response.removeListener("close", onResponseClose);
    response.removeListener("error", onResponseError);
  };

  const completeCommit = async (
    responseFinishedAtUtc: string,
  ): Promise<void> => {
    try {
      await commitDeliveryAfterSuccessfulSend();
      resolveCompletion?.(
        Object.freeze({
          status: "committed" as const,
          responseFinishedAtUtc,
        }),
      );
    } catch (error) {
      rejectCompletion?.(
        new GrandHallT554NativeReviewHttpResponseAdapterErrorV2(
          "DELIVERY_COMMIT_FAILED",
          "The finished response's tile delivery could not be committed.",
          error,
        ),
      );
    }
  };

  const completeDiscard = async (
    reason: GrandHallT554NativeReviewHttpResponseDiscardReasonV2,
  ): Promise<void> => {
    try {
      await discardAfterFailedSend();
      resolveCompletion?.(
        Object.freeze({ status: "discarded" as const, reason }),
      );
    } catch (error) {
      rejectCompletion?.(
        new GrandHallT554NativeReviewHttpResponseAdapterErrorV2(
          "DELIVERY_DISCARD_FAILED",
          "The failed response's tile delivery could not be discarded.",
          error,
        ),
      );
    }
  };

  const selectCommit = (): void => {
    if (terminalSelected) return;
    terminalSelected = true;
    detachListeners();
    const responseFinishedAtUtc = new Date().toISOString();
    void completeCommit(responseFinishedAtUtc);
  };

  const selectDiscard = (
    reason: GrandHallT554NativeReviewHttpResponseDiscardReasonV2,
  ): void => {
    if (terminalSelected) return;
    terminalSelected = true;
    detachListeners();
    void completeDiscard(reason);
  };

  function onRequestAborted(): void {
    selectDiscard("request-aborted");
  }

  function onRequestError(): void {
    selectDiscard("request-error");
  }

  function onResponseFinish(): void {
    selectCommit();
  }

  function onResponseClose(): void {
    selectDiscard("response-close");
  }

  function onResponseError(): void {
    selectDiscard("response-error");
  }

  const attachUnlessTerminal = (
    target:
      | GrandHallT554NativeReviewHttpRequestLifecycleTargetV2
      | GrandHallT554NativeReviewHttpResponseLifecycleTargetV2,
    eventName: string,
    listener: LifecycleListenerV2,
  ): void => {
    if (isTerminalSelected()) return;
    target.once(eventName, listener);
    if (isTerminalSelected()) {
      target.removeListener(eventName, listener);
    }
  };

  attachUnlessTerminal(request, "aborted", onRequestAborted);
  attachUnlessTerminal(request, "error", onRequestError);
  attachUnlessTerminal(response, "finish", onResponseFinish);
  attachUnlessTerminal(response, "close", onResponseClose);
  attachUnlessTerminal(response, "error", onResponseError);

  // Listener registration precedes state inspection so neither an event nor an
  // already-terminal state can disappear through the binding window.
  if (!isTerminalSelected()) {
    if (request.aborted) {
      selectDiscard("request-aborted");
    } else if (response.destroyed) {
      selectDiscard("response-close");
    } else if (
      response.headersSent ||
      response.writableEnded ||
      response.writableFinished
    ) {
      selectDiscard("response-send-already-started");
    }
  }

  return Object.freeze({
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_V2,
    completion,
    discardAfterSynchronousSendFailure: (): void => {
      selectDiscard("synchronous-send-failure");
    },
  });
}
