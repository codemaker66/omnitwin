import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useChunkArrivals } from "../use-chunk-arrivals.js";

// CARD A2: chunk arrivals drive the resolve phase. The accumulator is a
// plain hook so dedupe and reset semantics are testable without a canvas.

describe("useChunkArrivals", () => {
  it("counts distinct chunk arrivals and ignores duplicates", () => {
    const { result } = renderHook(() => useChunkArrivals("/a.sog|/b.sog"));
    expect(result.current.loadedCount).toBe(0);

    act(() => { result.current.markLoaded("/a.sog"); });
    expect(result.current.loadedCount).toBe(1);

    act(() => { result.current.markLoaded("/a.sog"); });
    expect(result.current.loadedCount).toBe(1);

    act(() => { result.current.markLoaded("/b.sog"); });
    expect(result.current.loadedCount).toBe(2);
  });

  it("resets when the chunk list key changes to a disjoint set (room switch)", () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useChunkArrivals(key),
      { initialProps: { key: "/a.sog|/b.sog" } },
    );
    act(() => { result.current.markLoaded("/a.sog"); });
    expect(result.current.loadedCount).toBe(1);

    rerender({ key: "/c.sog|/d.sog" });
    expect(result.current.loadedCount).toBe(0);
  });

  it("preserves arrivals for chunks that survive a partial-overlap key change", () => {
    // A still-mounted chunk (same url, already loaded) never re-fires its
    // onRendered, so wiping it from the count would wedge the phase machine.
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useChunkArrivals(key),
      { initialProps: { key: "/a.sog|/b.sog" } },
    );
    act(() => { result.current.markLoaded("/a.sog"); });
    expect(result.current.loadedCount).toBe(1);

    rerender({ key: "/a.sog|/c.sog" });
    expect(result.current.loadedCount).toBe(1);

    act(() => { result.current.markLoaded("/c.sog"); });
    expect(result.current.loadedCount).toBe(2);
  });

  it("counts permanent chunk failures separately so the phase can settle", () => {
    const { result } = renderHook(() => useChunkArrivals("/a.sog|/b.sog"));
    act(() => { result.current.markFailed("/b.sog"); });
    expect(result.current.failedCount).toBe(1);
    expect(result.current.loadedCount).toBe(0);

    // Duplicate failure reports never double-count.
    act(() => { result.current.markFailed("/b.sog"); });
    expect(result.current.failedCount).toBe(1);
  });

  it("keeps markLoaded identity stable across arrivals", () => {
    const { result, rerender } = renderHook(() => useChunkArrivals("/a.sog|/b.sog"));
    const first = result.current.markLoaded;
    act(() => { result.current.markLoaded("/a.sog"); });
    expect(result.current.loadedCount).toBe(1);
    rerender();
    expect(result.current.markLoaded).toBe(first);
  });

  it("ignores late outcomes for URLs removed by a room switch", () => {
    const { result, rerender } = renderHook(({ urls }) => useChunkArrivals(urls), {
      initialProps: { urls: "/a.sog" },
    });
    const oldLoaded = result.current.markLoaded;
    const oldFailed = result.current.markFailed;
    rerender({ urls: "/b.sog" });
    act(() => { oldLoaded("/a.sog"); oldFailed("/other.sog"); });
    expect(result.current.loadedCount).toBe(0);
    expect(result.current.failedCount).toBe(0);
  });

  it("replaces a failed outcome with a successful retry without double counting", () => {
    const { result } = renderHook(() => useChunkArrivals("/a.sog"));
    act(() => { result.current.markFailed("/a.sog"); result.current.markLoaded("/a.sog"); });
    expect(result.current.loadedCount).toBe(1);
    expect(result.current.failedCount).toBe(0);
    act(() => { result.current.markFailed("/a.sog"); });
    expect(result.current.failedCount).toBe(0);
  });

  it("requires fresh draws after renderer replacement and rejects old-generation outcomes for the same URLs", () => {
    const { result, rerender } = renderHook(({ key, generation }) => useChunkArrivals(key, generation), {
      initialProps: { key: "/a.sog|/b.sog", generation: 1 },
    });
    const oldLoaded = result.current.markLoaded;
    const oldFailed = result.current.markFailed;
    act(() => { oldLoaded("/a.sog"); oldFailed("/b.sog"); });
    expect(result.current.loadedCount).toBe(1);
    expect(result.current.failedCount).toBe(1);
    rerender({ key: "/a.sog|/b.sog", generation: 2 });
    expect(result.current.loadedCount).toBe(0);
    expect(result.current.failedCount).toBe(0);
    act(() => { oldLoaded("/a.sog"); oldFailed("/b.sog"); });
    expect(result.current.loadedCount).toBe(0);
    expect(result.current.failedCount).toBe(0);
    act(() => { result.current.markLoaded("/a.sog"); });
    const currentLoaded = result.current.markLoaded;
    rerender({ key: "/a.sog|/c.sog", generation: 2 });
    expect(result.current.loadedCount).toBe(1);
    expect(result.current.markLoaded).toBe(currentLoaded);
  });
});
