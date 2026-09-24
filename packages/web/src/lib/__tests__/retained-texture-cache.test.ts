import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { RetainedTextureCache } from "../retained-texture-cache.js";

interface FakeTexture {
  readonly name: string;
  readonly dispose: Mock<() => void>;
}

function factory(): { readonly created: FakeTexture[]; readonly create: (name: string) => () => FakeTexture } {
  const created: FakeTexture[] = [];
  return {
    created,
    create: (name) => () => {
      const texture = { name, dispose: vi.fn<() => void>() };
      created.push(texture);
      return texture;
    },
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("RetainedTextureCache", () => {
  it("shares one texture for identical keys and never across different keys", () => {
    const cache = new RetainedTextureCache<FakeTexture>({ idleMs: 1000, maxIdle: 4 });
    const { created, create } = factory();
    const first = cache.acquire("table-1", create("a"));
    const second = cache.acquire("table-1", create("b"));
    const other = cache.acquire("table-2", create("c"));
    expect(second).toBe(first);
    expect(other).not.toBe(first);
    expect(created.map((texture) => texture.name)).toEqual(["a", "c"]);
  });

  it("reuses a released texture within the idle window, then disposes it exactly once", () => {
    const cache = new RetainedTextureCache<FakeTexture>({ idleMs: 1000, maxIdle: 4 });
    const { created, create } = factory();
    const texture = cache.acquire("plate", create("a"));
    cache.release("plate", "retain");
    vi.advanceTimersByTime(999);
    expect(cache.acquire("plate", create("b"))).toBe(texture);
    // The returning user cancelled the expiry that was already running.
    vi.advanceTimersByTime(5000);
    expect(texture?.dispose).not.toHaveBeenCalled();

    cache.release("plate", "retain");
    vi.advanceTimersByTime(1000);
    expect(texture?.dispose).toHaveBeenCalledOnce();
    expect(cache.size).toBe(0);
    cache.release("plate", "retain");
    vi.runAllTimers();
    expect(texture?.dispose).toHaveBeenCalledOnce();

    const fresh = cache.acquire("plate", create("c"));
    expect(fresh).not.toBe(texture);
    expect(created.map((entry) => entry.name)).toEqual(["a", "c"]);
  });

  it("disposes only after the last user, at once when released without retention", () => {
    const cache = new RetainedTextureCache<FakeTexture>({ idleMs: 1000, maxIdle: 4 });
    const { create } = factory();
    const texture = cache.acquire("plate", create("a"));
    cache.acquire("plate", create("b"));
    cache.release("plate", "dispose");
    expect(texture?.dispose).not.toHaveBeenCalled();
    cache.release("plate", "dispose");
    expect(texture?.dispose).toHaveBeenCalledOnce();
    expect(cache.size).toBe(0);
  });

  it("disposes the least recently released idle textures beyond the limit", () => {
    const cache = new RetainedTextureCache<FakeTexture>({ idleMs: 60_000, maxIdle: 2 });
    const { create } = factory();
    const textures = ["a", "b", "c"].map((name) => cache.acquire(name, create(name)));
    cache.release("b", "retain");
    cache.release("a", "retain");
    expect(textures.map((texture) => texture?.dispose.mock.calls.length)).toEqual([0, 0, 0]);
    cache.release("c", "retain");
    expect(textures.map((texture) => texture?.dispose.mock.calls.length)).toEqual([0, 1, 0]);
    expect(cache.size).toBe(2);
  });

  it("does not cache a texture that could not be created", () => {
    const cache = new RetainedTextureCache<FakeTexture>({ idleMs: 1000, maxIdle: 4 });
    expect(cache.acquire("plate", () => null)).toBeNull();
    expect(cache.size).toBe(0);
    cache.release("plate", "retain");
    expect(cache.size).toBe(0);
  });
});
