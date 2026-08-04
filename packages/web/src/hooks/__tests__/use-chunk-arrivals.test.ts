import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useChunkArrivals } from "../use-chunk-arrivals.js";

// CARD A2: chunk arrivals drive the resolve phase. The accumulator is a
// plain hook so dedupe and reset semantics are testable without a canvas.

describe("useChunkArrivals", () => {
  it("counts distinct chunk arrivals and ignores duplicates", () => {
    const { result } = renderHook(() => useChunkArrivals("a|b"));
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
    // onLoad, so wiping it from the count would wedge the phase machine.
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
    const { result, rerender } = renderHook(() => useChunkArrivals("a|b"));
    const first = result.current.markLoaded;
    act(() => { result.current.markLoaded("/a.sog"); });
    rerender();
    expect(result.current.markLoaded).toBe(first);
  });
});
