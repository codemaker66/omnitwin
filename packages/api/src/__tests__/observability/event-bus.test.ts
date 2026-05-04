import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyBaseLogger } from "fastify";
import {
  emit,
  subscribe,
  __resetRegistryForTests,
} from "../../observability/event-bus.js";

// ---------------------------------------------------------------------------
// event-bus — in-process typed pub/sub
//
// Contract under test:
//   1. `emit` with no subscribers is a debug no-op.
//   2. `subscribe` registers; subsequent `emit` fires that subscriber.
//   3. Multiple subscribers fire in registration order.
//   4. One throwing subscriber does NOT skip the next one.
//   5. `emit` returns void immediately — the caller does not await.
//   6. The unsubscribe fn stops future events reaching the subscriber.
//   7. Payloads are passed through unchanged.
// ---------------------------------------------------------------------------

function silentLogger(): FastifyBaseLogger {
  return Fastify({ logger: false }).log;
}

const snapshotPayload = {
  configId: "cfg-1",
  snapshotId: "snap-1",
  version: 1,
  sourceHash: "0".repeat(64),
};

beforeEach(() => {
  __resetRegistryForTests();
});

describe("event-bus", () => {
  it("emit with no subscribers is a no-op (no throw)", () => {
    expect(() => {
      emit(silentLogger(), "snapshot.created", snapshotPayload);
    }).not.toThrow();
  });

  it("fires a registered subscriber", async () => {
    const handler = vi.fn();
    subscribe("snapshot.created", { name: "test-subscriber", handle: handler });

    emit(silentLogger(), "snapshot.created", snapshotPayload);

    await new Promise((r) => setTimeout(r, 0));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(snapshotPayload);
  });

  it("fires multiple subscribers in registration order", async () => {
    const order: string[] = [];
    subscribe("snapshot.created", { name: "first", handle: () => { order.push("first"); } });
    subscribe("snapshot.created", { name: "second", handle: () => { order.push("second"); } });
    subscribe("snapshot.created", { name: "third", handle: () => { order.push("third"); } });

    emit(silentLogger(), "snapshot.created", snapshotPayload);
    await new Promise((r) => setTimeout(r, 0));

    expect(order).toEqual(["first", "second", "third"]);
  });

  it("a throwing subscriber does not prevent later subscribers", async () => {
    const laterHandler = vi.fn();
    subscribe("snapshot.created", {
      name: "crasher",
      handle: () => { throw new Error("boom"); },
    });
    subscribe("snapshot.created", { name: "runs-after-crash", handle: laterHandler });

    emit(silentLogger(), "snapshot.created", snapshotPayload);
    await new Promise((r) => setTimeout(r, 0));

    expect(laterHandler).toHaveBeenCalledTimes(1);
  });

  it("logs at ERROR when a subscriber throws", async () => {
    const errorSpy = vi.fn();
    const logger = { ...silentLogger(), error: errorSpy } as FastifyBaseLogger;

    subscribe("snapshot.created", {
      name: "crasher",
      handle: () => { throw new Error("boom"); },
    });

    emit(logger, "snapshot.created", snapshotPayload);
    await new Promise((r) => setTimeout(r, 0));

    expect(errorSpy).toHaveBeenCalled();
    const firstCallArgs = errorSpy.mock.calls[0];
    expect(firstCallArgs).toBeDefined();
    if (firstCallArgs !== undefined) {
      const ctx = firstCallArgs[0] as Record<string, unknown>;
      expect(ctx["event"]).toBe("snapshot.created");
      expect(ctx["subscriber"]).toBe("crasher");
    }
  });

  it("emit returns void synchronously (caller never blocks on subscribers)", () => {
    subscribe("snapshot.created", {
      name: "slow",
      handle: async () => { await new Promise((r) => setTimeout(r, 50)); },
    });

    const start = Date.now();
    emit(silentLogger(), "snapshot.created", snapshotPayload);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10);
  });

  it("unsubscribe prevents later events reaching the handler", async () => {
    const handler = vi.fn();
    const off = subscribe("snapshot.created", { name: "x", handle: handler });

    emit(silentLogger(), "snapshot.created", snapshotPayload);
    await new Promise((r) => setTimeout(r, 0));
    expect(handler).toHaveBeenCalledTimes(1);

    off();

    emit(silentLogger(), "snapshot.created", snapshotPayload);
    await new Promise((r) => setTimeout(r, 0));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
