import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GrandHallT554NativeReviewHttpResponseAdapterError,
  recordGrandHallT554NativeReviewTileDeliveryAfterResponseFinish,
  type GrandHallT554NativeReviewIncomingMessageLifecycleTarget,
  type GrandHallT554NativeReviewServerResponseLifecycleTarget,
} from "../grand-hall-t554-native-review-http-response-adapter.js";

class ResponseHarness extends EventEmitter {
  writableFinished = false;
}

class RequestHarness extends EventEmitter {}

function responseHarness(): {
  readonly emitter: ResponseHarness;
  readonly response: GrandHallT554NativeReviewServerResponseLifecycleTarget;
} {
  const emitter = new ResponseHarness();
  return { emitter, response: emitter };
}

function requestHarness(): {
  readonly emitter: RequestHarness;
  readonly request: GrandHallT554NativeReviewIncomingMessageLifecycleTarget;
} {
  const emitter = new RequestHarness();
  return { emitter, request: emitter };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Grand Hall T-554 trusted HTTP response lifecycle adapter", () => {
  it("records exactly once after finish with a server-owned canonical timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T12:34:56.789Z"));
    const { emitter, response } = responseHarness();
    const recorded: string[] = [];
    const lifecycle =
      recordGrandHallT554NativeReviewTileDeliveryAfterResponseFinish({
        response,
        recordTileDelivery: (finishedAtUtc) => {
          recorded.push(finishedAtUtc);
        },
      });

    expect(recorded).toEqual([]);
    emitter.emit("finish");
    emitter.emit("finish");
    emitter.emit("close");

    await expect(lifecycle.completion).resolves.toEqual({
      status: "recorded",
      responseFinishedAtUtc: "2026-08-28T12:34:56.789Z",
    });
    expect(recorded).toEqual(["2026-08-28T12:34:56.789Z"]);
    expect(emitter.listenerCount("finish")).toBe(0);
    expect(emitter.listenerCount("close")).toBe(0);
    expect(emitter.listenerCount("error")).toBe(0);
  });

  it.each([
    ["response close", "close", "response-close"],
    ["response error", "error", "response-error"],
  ] as const)(
    "discards on %s before finish",
    async (_label, eventName, expectedReason) => {
      const { emitter, response } = responseHarness();
      let recordCount = 0;
      const lifecycle =
        recordGrandHallT554NativeReviewTileDeliveryAfterResponseFinish({
          response,
          recordTileDelivery: () => {
            recordCount += 1;
          },
        });

      emitter.emit(eventName, new Error("transport failed"));
      emitter.emit("finish");

      await expect(lifecycle.completion).resolves.toEqual({
        status: "discarded",
        reason: expectedReason,
      });
      expect(recordCount).toBe(0);
    },
  );

  it.each([
    ["request abort", "aborted", "request-aborted"],
    ["request error", "error", "request-error"],
  ] as const)(
    "discards on %s before finish",
    async (_label, eventName, expectedReason) => {
      const { emitter: responseEmitter, response } = responseHarness();
      const { emitter: requestEmitter, request } = requestHarness();
      let recordCount = 0;
      const lifecycle =
        recordGrandHallT554NativeReviewTileDeliveryAfterResponseFinish({
          request,
          response,
          recordTileDelivery: () => {
            recordCount += 1;
          },
        });

      requestEmitter.emit(eventName, new Error("request failed"));
      responseEmitter.emit("finish");

      await expect(lifecycle.completion).resolves.toEqual({
        status: "discarded",
        reason: expectedReason,
      });
      expect(recordCount).toBe(0);
    },
  );

  it("treats a response already marked writableFinished as finished without a race window", async () => {
    const { emitter, response } = responseHarness();
    emitter.writableFinished = true;
    let recordCount = 0;
    const lifecycle =
      recordGrandHallT554NativeReviewTileDeliveryAfterResponseFinish({
        response,
        recordTileDelivery: () => {
          recordCount += 1;
        },
      });

    await expect(lifecycle.completion).resolves.toMatchObject({
      status: "recorded",
    });
    expect(recordCount).toBe(1);
  });

  it("surfaces a failed durable record and never retries it", async () => {
    const { emitter, response } = responseHarness();
    let recordCount = 0;
    const lifecycle =
      recordGrandHallT554NativeReviewTileDeliveryAfterResponseFinish({
        response,
        recordTileDelivery: () => {
          recordCount += 1;
          return Promise.reject(new Error("durable append failed"));
        },
      });

    emitter.emit("finish");
    emitter.emit("finish");

    await expect(lifecycle.completion).rejects.toBeInstanceOf(
      GrandHallT554NativeReviewHttpResponseAdapterError,
    );
    expect(recordCount).toBe(1);
  });

  it("rejects a non-ServerResponse argument before attaching callbacks", () => {
    expect(() => {
      Reflect.apply(
        recordGrandHallT554NativeReviewTileDeliveryAfterResponseFinish,
        undefined,
        [{ response: null, recordTileDelivery: () => undefined }],
      );
    }).toThrowError(
      expect.objectContaining({
        code: "ARGUMENT_INVALID",
      }),
    );
  });
});
