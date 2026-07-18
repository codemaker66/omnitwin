import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  RuntimeProfileVerifiedByteCache,
  type RuntimeProfileVerifiedByteIdentity,
} from "../lib/runtime-profile-verified-byte-cache.js";

function identity(bytes: Buffer): RuntimeProfileVerifiedByteIdentity {
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength,
  };
}

function cache(options: Partial<ConstructorParameters<typeof RuntimeProfileVerifiedByteCache>[0]> = {}) {
  return new RuntimeProfileVerifiedByteCache({
    maximumBytes: 64,
    maximumEntries: 4,
    ttlMilliseconds: 1_000,
    ...options,
  });
}

describe("RuntimeProfileVerifiedByteCache", () => {
  it("coalesces concurrent loads and reuses only SHA-verified bytes", async () => {
    const bytes = Buffer.from("reviewed-runtime-profile-member", "utf8");
    let finish: ((value: Buffer) => void) | undefined;
    const loader = vi.fn(() => new Promise<Buffer>((resolve) => {
      finish = resolve;
    }));
    const store = cache();

    const first = store.load(identity(bytes), undefined, loader);
    const second = store.load(identity(bytes), undefined, loader);
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    finish?.(bytes);

    await expect(first).resolves.toEqual(bytes);
    await expect(second).resolves.toEqual(bytes);
    await expect(store.load(identity(bytes), undefined, loader)).resolves.toEqual(bytes);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(store.snapshot()).toEqual({
      cachedEntries: 1,
      cachedBytes: bytes.byteLength,
      activeFlights: 0,
    });
  });

  it("never caches bytes whose size or SHA-256 differs from the immutable identity", async () => {
    const expected = Buffer.from("expected", "utf8");
    const changed = Buffer.from("changed!", "utf8");
    const loader = vi.fn().mockResolvedValue(changed);
    const store = cache();

    await expect(store.load(identity(expected), undefined, loader)).rejects.toThrow(
      "did not match their immutable identity",
    );
    await expect(store.load(identity(expected), undefined, loader)).rejects.toThrow();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(store.snapshot().cachedEntries).toBe(0);
  });

  it("aborts a shared upstream load only after every waiting consumer leaves", async () => {
    const bytes = Buffer.from("shared", "utf8");
    let upstreamSignal: AbortSignal | undefined;
    const loader = vi.fn((signal: AbortSignal) => new Promise<Buffer>((_resolve, reject) => {
      upstreamSignal = signal;
      signal.addEventListener("abort", () => {
        reject(signal.reason instanceof Error
          ? signal.reason
          : new DOMException("upstream aborted", "AbortError"));
      }, { once: true });
    }));
    const firstController = new AbortController();
    const secondController = new AbortController();
    const store = cache();

    const first = store.load(identity(bytes), firstController.signal, loader);
    const second = store.load(identity(bytes), secondController.signal, loader);
    await Promise.resolve();
    firstController.abort(new DOMException("first left", "AbortError"));
    await expect(first).rejects.toThrow("first left");
    expect(upstreamSignal?.aborted).toBe(false);

    secondController.abort(new DOMException("second left", "AbortError"));
    await expect(second).rejects.toThrow("second left");
    expect(upstreamSignal?.aborted).toBe(true);
    await Promise.resolve();
    expect(store.snapshot().activeFlights).toBe(0);
  });

  it("expires entries and evicts least-recently-used bytes within both bounds", async () => {
    let now = 100;
    const store = cache({
      maximumBytes: 7,
      maximumEntries: 2,
      ttlMilliseconds: 10,
      now: () => now,
    });
    const firstBytes = Buffer.from("four", "utf8");
    const secondBytes = Buffer.from("five", "utf8");
    const firstLoader = vi.fn().mockResolvedValue(firstBytes);
    const secondLoader = vi.fn().mockResolvedValue(secondBytes);

    await store.load(identity(firstBytes), undefined, firstLoader);
    await store.load(identity(secondBytes), undefined, secondLoader);
    expect(store.snapshot()).toEqual({ cachedEntries: 1, cachedBytes: 4, activeFlights: 0 });
    await store.load(identity(firstBytes), undefined, firstLoader);
    expect(firstLoader).toHaveBeenCalledTimes(2);

    now += 11;
    await store.load(identity(firstBytes), undefined, firstLoader);
    expect(firstLoader).toHaveBeenCalledTimes(3);
  });
});
