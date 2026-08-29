import { once } from "node:events";
import {
  createServer,
  request as makeHttpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bindGrandHallT554NativeReviewTileToHttpResponseV2,
  GrandHallT554NativeReviewHttpResponseAdapterErrorV2,
  type GrandHallT554NativeReviewFacadeTileDeliveryV2,
  type GrandHallT554NativeReviewHttpRequestLifecycleTargetV2,
  type GrandHallT554NativeReviewHttpResponseDeliveryLifecycleV2,
  type GrandHallT554NativeReviewHttpResponseLifecycleTargetV2,
} from "../grand-hall-t554-native-review-http-response-adapter-v2.js";

type Listener = (...arguments_: readonly unknown[]) => void;

class LifecycleEmitterHarness {
  readonly #listeners = new Map<string, Set<Listener>>();

  once(eventName: string, listener: Listener): void {
    let listeners = this.#listeners.get(eventName);
    if (listeners === undefined) {
      listeners = new Set();
      this.#listeners.set(eventName, listeners);
    }
    listeners.add(listener);
  }

  removeListener(eventName: string, listener: Listener): void {
    const listeners = this.#listeners.get(eventName);
    listeners?.delete(listener);
    if (listeners?.size === 0) this.#listeners.delete(eventName);
  }

  emit(eventName: string, ...arguments_: readonly unknown[]): void {
    const listeners = [...(this.#listeners.get(eventName) ?? [])];
    this.#listeners.delete(eventName);
    for (const listener of listeners) listener(...arguments_);
  }

  listenerCount(eventName: string): number {
    return this.#listeners.get(eventName)?.size ?? 0;
  }
}

class RequestHarness
  extends LifecycleEmitterHarness
  implements GrandHallT554NativeReviewHttpRequestLifecycleTargetV2
{
  aborted = false;
}

class ResponseHarness
  extends LifecycleEmitterHarness
  implements GrandHallT554NativeReviewHttpResponseLifecycleTargetV2
{
  destroyed = false;
  headersSent = false;
  writableEnded = false;
  writableFinished = false;
}

function nativeLifecycleTargets(
  request: IncomingMessage,
  response: ServerResponse,
): {
  readonly request: GrandHallT554NativeReviewHttpRequestLifecycleTargetV2;
  readonly response: GrandHallT554NativeReviewHttpResponseLifecycleTargetV2;
} {
  // These assignments intentionally make the test a compile-time compatibility
  // gate for the real Node request/response types, not just the harness below.
  const requestTarget: GrandHallT554NativeReviewHttpRequestLifecycleTargetV2 =
    request;
  const responseTarget: GrandHallT554NativeReviewHttpResponseLifecycleTargetV2 =
    response;
  return { request: requestTarget, response: responseTarget };
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
}

function deferred(): Deferred {
  let resolve: (() => void) | undefined;
  let reject: ((reason: unknown) => void) | undefined;
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return {
    promise,
    resolve: () => resolve?.(),
    reject: (reason: unknown) => reject?.(reason),
  };
}

interface Harness {
  readonly request: RequestHarness;
  readonly response: ResponseHarness;
  readonly commit: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly discard: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly tile: GrandHallT554NativeReviewFacadeTileDeliveryV2;
}

function harness(): Harness {
  const request = new RequestHarness();
  const response = new ResponseHarness();
  const commit = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const discard = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  return {
    request,
    response,
    commit,
    discard,
    tile: {
      commitDeliveryAfterSuccessfulSend: commit,
      discardAfterFailedSend: discard,
    },
  };
}

function bind(
  testHarness: Harness,
): GrandHallT554NativeReviewHttpResponseDeliveryLifecycleV2 {
  return bindGrandHallT554NativeReviewTileToHttpResponseV2({
    request: testHarness.request,
    response: testHarness.response,
    tile: testHarness.tile,
  });
}

function expectListeners(testHarness: Harness, expectedCount: number): void {
  expect(testHarness.request.listenerCount("aborted")).toBe(expectedCount);
  expect(testHarness.request.listenerCount("error")).toBe(expectedCount);
  expect(testHarness.response.listenerCount("finish")).toBe(expectedCount);
  expect(testHarness.response.listenerCount("close")).toBe(expectedCount);
  expect(testHarness.response.listenerCount("error")).toBe(expectedCount);
}

type Signal =
  | "finish"
  | "request-aborted"
  | "request-error"
  | "response-close"
  | "response-error"
  | "synchronous-send-failure";

const SIGNALS: readonly Signal[] = [
  "finish",
  "request-aborted",
  "request-error",
  "response-close",
  "response-error",
  "synchronous-send-failure",
];

interface InitialBooleanState {
  readonly label: string;
  readonly requestAborted: boolean;
  readonly responseDestroyed: boolean;
  readonly headersSent: boolean;
  readonly writableEnded: boolean;
  readonly writableFinished: boolean;
  readonly expectedReason:
    | "request-aborted"
    | "response-close"
    | "response-send-already-started"
    | undefined;
}

const BOOLEAN_VALUES = [false, true] as const;
const INITIAL_BOOLEAN_STATES: readonly InitialBooleanState[] =
  BOOLEAN_VALUES.flatMap((requestAborted) =>
    BOOLEAN_VALUES.flatMap((responseDestroyed) =>
      BOOLEAN_VALUES.flatMap((headersSent) =>
        BOOLEAN_VALUES.flatMap((writableEnded) =>
          BOOLEAN_VALUES.map((writableFinished) => ({
            label: [
              `requestAborted=${String(requestAborted)}`,
              `responseDestroyed=${String(responseDestroyed)}`,
              `headersSent=${String(headersSent)}`,
              `writableEnded=${String(writableEnded)}`,
              `writableFinished=${String(writableFinished)}`,
            ].join(", "),
            requestAborted,
            responseDestroyed,
            headersSent,
            writableEnded,
            writableFinished,
            expectedReason: requestAborted
              ? ("request-aborted" as const)
              : responseDestroyed
                ? ("response-close" as const)
                : headersSent || writableEnded || writableFinished
                  ? ("response-send-already-started" as const)
                  : undefined,
          })),
        ),
      ),
    ),
  );

function signal(
  testHarness: Harness,
  lifecycle: GrandHallT554NativeReviewHttpResponseDeliveryLifecycleV2,
  selectedSignal: Signal,
): void {
  switch (selectedSignal) {
    case "finish":
      testHarness.response.emit("finish");
      return;
    case "request-aborted":
      testHarness.request.emit("aborted");
      return;
    case "request-error":
      testHarness.request.emit("error", new Error("request failed"));
      return;
    case "response-close":
      testHarness.response.emit("close");
      return;
    case "response-error":
      testHarness.response.emit("error", new Error("response failed"));
      return;
    case "synchronous-send-failure":
      lifecycle.discardAfterSynchronousSendFailure();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Grand Hall T-554 native review HTTP response adapter v2", () => {
  it("binds before response work, commits once on finish, and waits for the durable callback", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T12:34:56.789Z"));
    const testHarness = harness();
    const commitGate = deferred();
    testHarness.commit.mockReturnValue(commitGate.promise);

    const lifecycle = bind(testHarness);
    expect(Object.isFrozen(lifecycle)).toBe(true);
    expectListeners(testHarness, 1);

    testHarness.response.emit("finish");
    testHarness.response.emit("finish");
    expect(testHarness.commit).toHaveBeenCalledTimes(1);
    expect(testHarness.discard).not.toHaveBeenCalled();
    expectListeners(testHarness, 0);

    let completionSettled = false;
    void lifecycle.completion.then(() => {
      completionSettled = true;
    });
    await Promise.resolve();
    expect(completionSettled).toBe(false);

    commitGate.resolve();
    await expect(lifecycle.completion).resolves.toEqual({
      status: "committed",
      responseFinishedAtUtc: "2026-08-29T12:34:56.789Z",
    });
    expect(completionSettled).toBe(true);
  });

  it("commits through a real Node HTTP finish lifecycle after pre-send binding", async () => {
    const commit = vi.fn<() => Promise<void>>().mockResolvedValue();
    const discard = vi.fn<() => Promise<void>>().mockResolvedValue();
    let resolveLifecycle:
      | ((
          lifecycle: GrandHallT554NativeReviewHttpResponseDeliveryLifecycleV2,
        ) => void)
      | undefined;
    const lifecycleReady =
      new Promise<GrandHallT554NativeReviewHttpResponseDeliveryLifecycleV2>(
        (resolve) => {
          resolveLifecycle = resolve;
        },
      );
    const server = createServer((request, response) => {
      const nativeTargets = nativeLifecycleTargets(request, response);
      const lifecycle = bindGrandHallT554NativeReviewTileToHttpResponseV2({
        ...nativeTargets,
        tile: {
          commitDeliveryAfterSuccessfulSend: commit,
          discardAfterFailedSend: discard,
        },
      });
      resolveLifecycle?.(lifecycle);
      response.statusCode = 200;
      response.end("ok");
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Expected a TCP address for the HTTP test server.");
      }
      await new Promise<void>((resolve, reject) => {
        const request = makeHttpRequest(
          {
            hostname: "127.0.0.1",
            port: address.port,
            path: "/",
            method: "GET",
          },
          (response) => {
            response.once("error", reject);
            response.resume();
            response.once("end", resolve);
          },
        );
        request.once("error", reject);
        request.end();
      });

      await expect((await lifecycleReady).completion).resolves.toMatchObject({
        status: "committed",
      });
      expect(commit).toHaveBeenCalledTimes(1);
      expect(discard).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      });
    }
  });

  it.each([
    ["request-aborted", "request-aborted"],
    ["request-error", "request-error"],
    ["response-close", "response-close"],
    ["response-error", "response-error"],
    ["synchronous-send-failure", "synchronous-send-failure"],
  ] as const)(
    "discards once on %s and waits for the durable callback",
    async (selectedSignal, expectedReason) => {
      const testHarness = harness();
      const discardGate = deferred();
      testHarness.discard.mockReturnValue(discardGate.promise);
      const lifecycle = bind(testHarness);

      signal(testHarness, lifecycle, selectedSignal);
      signal(testHarness, lifecycle, selectedSignal);
      expect(testHarness.discard).toHaveBeenCalledTimes(1);
      expect(testHarness.commit).not.toHaveBeenCalled();
      expectListeners(testHarness, 0);

      let completionSettled = false;
      void lifecycle.completion.then(() => {
        completionSettled = true;
      });
      await Promise.resolve();
      expect(completionSettled).toBe(false);

      discardGate.resolve();
      await expect(lifecycle.completion).resolves.toEqual({
        status: "discarded",
        reason: expectedReason,
      });
      expect(completionSettled).toBe(true);
    },
  );

  it("makes every ordered pair of terminal signals mutually exclusive", async () => {
    for (const first of SIGNALS) {
      for (const second of SIGNALS) {
        const testHarness = harness();
        const lifecycle = bind(testHarness);

        signal(testHarness, lifecycle, first);
        signal(testHarness, lifecycle, second);
        await lifecycle.completion;

        expect(
          testHarness.commit,
          `${first} then ${second}: commit`,
        ).toHaveBeenCalledTimes(first === "finish" ? 1 : 0);
        expect(
          testHarness.discard,
          `${first} then ${second}: discard`,
        ).toHaveBeenCalledTimes(first === "finish" ? 0 : 1);
        expectListeners(testHarness, 0);
      }
    }
  });

  it("discards an already-finished response as a late bind without retaining listeners", async () => {
    const testHarness = harness();
    testHarness.response.writableFinished = true;

    const lifecycle = bind(testHarness);
    testHarness.response.emit("finish");

    await expect(lifecycle.completion).resolves.toEqual({
      status: "discarded",
      reason: "response-send-already-started",
    });
    expect(testHarness.commit).not.toHaveBeenCalled();
    expect(testHarness.discard).toHaveBeenCalledTimes(1);
    expectListeners(testHarness, 0);
  });

  it.each(INITIAL_BOOLEAN_STATES)(
    "fails closed for the complete initial-state matrix: $label",
    async (initialState) => {
      const testHarness = harness();
      testHarness.request.aborted = initialState.requestAborted;
      testHarness.response.destroyed = initialState.responseDestroyed;
      testHarness.response.headersSent = initialState.headersSent;
      testHarness.response.writableEnded = initialState.writableEnded;
      testHarness.response.writableFinished = initialState.writableFinished;

      const lifecycle = bind(testHarness);

      if (initialState.expectedReason === undefined) {
        expectListeners(testHarness, 1);
        testHarness.response.emit("finish");
        await expect(lifecycle.completion).resolves.toMatchObject({
          status: "committed",
        });
        expect(testHarness.commit).toHaveBeenCalledTimes(1);
        expect(testHarness.discard).not.toHaveBeenCalled();
      } else {
        await expect(lifecycle.completion).resolves.toEqual({
          status: "discarded",
          reason: initialState.expectedReason,
        });
        expect(testHarness.commit).not.toHaveBeenCalled();
        expect(testHarness.discard).toHaveBeenCalledTimes(1);
      }
      expectListeners(testHarness, 0);
    },
  );

  it.each([
    ["aborted request", "request-aborted"],
    ["destroyed response", "response-close"],
  ] as const)(
    "discards an already-%s transport without retaining listeners",
    async (initialState, expectedReason) => {
      const testHarness = harness();
      if (initialState === "aborted request") {
        testHarness.request.aborted = true;
      } else {
        testHarness.response.destroyed = true;
      }

      const lifecycle = bind(testHarness);

      await expect(lifecycle.completion).resolves.toEqual({
        status: "discarded",
        reason: expectedReason,
      });
      expect(testHarness.commit).not.toHaveBeenCalled();
      expect(testHarness.discard).toHaveBeenCalledTimes(1);
      expectListeners(testHarness, 0);
    },
  );

  it.each(["synchronous", "asynchronous"] as const)(
    "preserves a %s commit callback failure as DELIVERY_COMMIT_FAILED",
    async (failureMode) => {
      const testHarness = harness();
      const cause = new Error("commit failed");
      if (failureMode === "synchronous") {
        testHarness.commit.mockImplementation(() => {
          throw cause;
        });
      } else {
        testHarness.commit.mockRejectedValue(cause);
      }
      const lifecycle = bind(testHarness);

      testHarness.response.emit("finish");

      await expect(lifecycle.completion).rejects.toEqual(
        expect.objectContaining({
          code: "DELIVERY_COMMIT_FAILED",
          cause,
        }),
      );
      expect(testHarness.commit).toHaveBeenCalledTimes(1);
      expect(testHarness.discard).not.toHaveBeenCalled();
      expectListeners(testHarness, 0);
    },
  );

  it.each(["synchronous", "asynchronous"] as const)(
    "preserves a %s discard callback failure as DELIVERY_DISCARD_FAILED",
    async (failureMode) => {
      const testHarness = harness();
      const cause = new Error("discard failed");
      if (failureMode === "synchronous") {
        testHarness.discard.mockImplementation(() => {
          throw cause;
        });
      } else {
        testHarness.discard.mockRejectedValue(cause);
      }
      const lifecycle = bind(testHarness);

      lifecycle.discardAfterSynchronousSendFailure();

      await expect(lifecycle.completion).rejects.toEqual(
        expect.objectContaining({
          code: "DELIVERY_DISCARD_FAILED",
          cause,
        }),
      );
      expect(testHarness.discard).toHaveBeenCalledTimes(1);
      expect(testHarness.commit).not.toHaveBeenCalled();
      expectListeners(testHarness, 0);
    },
  );

  it("observes an early callback rejection internally while preserving the original rejection", async () => {
    const testHarness = harness();
    const cause = new Error("commit failed before router await");
    testHarness.commit.mockRejectedValue(cause);
    const lifecycle = bind(testHarness);
    const unhandledReasons: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledReasons.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      testHarness.response.emit("finish");
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(unhandledReasons).toEqual([]);
      await expect(lifecycle.completion).rejects.toEqual(
        expect.objectContaining({
          code: "DELIVERY_COMMIT_FAILED",
          cause,
        }),
      );
    } finally {
      process.removeListener("unhandledRejection", onUnhandledRejection);
    }
  });

  it("makes the synchronous-send-failure trigger idempotent after either disposition", async () => {
    const discardedHarness = harness();
    const discardedLifecycle = bind(discardedHarness);
    discardedLifecycle.discardAfterSynchronousSendFailure();
    discardedLifecycle.discardAfterSynchronousSendFailure();
    await discardedLifecycle.completion;
    expect(discardedHarness.discard).toHaveBeenCalledTimes(1);

    const committedHarness = harness();
    const committedLifecycle = bind(committedHarness);
    committedHarness.response.emit("finish");
    committedLifecycle.discardAfterSynchronousSendFailure();
    await committedLifecycle.completion;
    expect(committedHarness.commit).toHaveBeenCalledTimes(1);
    expect(committedHarness.discard).not.toHaveBeenCalled();
  });

  it("captures one tile's callback pair when it binds", async () => {
    const testHarness = harness();
    const replacementCommit = vi.fn<() => Promise<void>>().mockResolvedValue();
    const replacementDiscard = vi.fn<() => Promise<void>>().mockResolvedValue();
    const mutableTile = {
      commitDeliveryAfterSuccessfulSend:
        testHarness.tile.commitDeliveryAfterSuccessfulSend,
      discardAfterFailedSend: testHarness.tile.discardAfterFailedSend,
    };
    const lifecycle = bindGrandHallT554NativeReviewTileToHttpResponseV2({
      request: testHarness.request,
      response: testHarness.response,
      tile: mutableTile,
    });

    mutableTile.commitDeliveryAfterSuccessfulSend = replacementCommit;
    mutableTile.discardAfterFailedSend = replacementDiscard;
    testHarness.response.emit("finish");

    await lifecycle.completion;
    expect(testHarness.commit).toHaveBeenCalledTimes(1);
    expect(testHarness.discard).not.toHaveBeenCalled();
    expect(replacementCommit).not.toHaveBeenCalled();
    expect(replacementDiscard).not.toHaveBeenCalled();
  });

  it.each([
    ["missing input", undefined],
    [
      "invalid request",
      { request: null, response: new ResponseHarness(), tile: harness().tile },
    ],
    [
      "invalid response",
      { request: new RequestHarness(), response: null, tile: harness().tile },
    ],
    [
      "missing request state",
      {
        request: new LifecycleEmitterHarness(),
        response: new ResponseHarness(),
        tile: harness().tile,
      },
    ],
    [
      "missing response state",
      {
        request: new RequestHarness(),
        response: new LifecycleEmitterHarness(),
        tile: harness().tile,
      },
    ],
    [
      "invalid facade tile",
      {
        request: new RequestHarness(),
        response: new ResponseHarness(),
        tile: {},
      },
    ],
  ] as const)(
    "rejects %s before binding listeners",
    (_label, malformedInput) => {
      expect(() => {
        Reflect.apply(
          bindGrandHallT554NativeReviewTileToHttpResponseV2,
          undefined,
          [malformedInput],
        );
      }).toThrowError(
        expect.objectContaining({
          code: "ARGUMENT_INVALID",
        }) as GrandHallT554NativeReviewHttpResponseAdapterErrorV2,
      );
    },
  );
});
