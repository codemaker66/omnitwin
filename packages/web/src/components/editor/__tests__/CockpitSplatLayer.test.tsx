import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeSplatLayerProps } from "../../scene/NativeSplatLayer.js";
import { useChunkArrivals } from "../../../hooks/use-chunk-arrivals.js";
import { captureAvailability, inkTargetOpacity, roomResolvePhase } from "../../../lib/room-resolve-model.js";

const native = vi.hoisted(() => ({ sources: new Map<string, NativeSplatLayerProps>() }));
const frame = vi.hoisted(() => ({ current: null as (() => void) | null, invalidate: vi.fn(), reduced: false }));
vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: { invalidate: () => void }) => unknown) => selector(frame),
  useFrame: (callback: () => void) => { frame.current = callback; },
}));
vi.mock("../../../lib/reduced-motion.js", () => ({ prefersReducedMotion: () => frame.reduced }));
vi.mock("../../scene/NativeSplatLayer.js", () => ({
  NativeSplatLayer: (props: NativeSplatLayerProps) => { native.sources.set(props.url, props); return null; },
}));

import { CockpitSplatLayer } from "../CockpitSplatLayer.js";

const transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, note: "identity" } as const;

function Choreography({ urls, active = true }: { urls: readonly string[]; active?: boolean }) {
  const arrivals = useChunkArrivals(urls.join("|"));
  const availability = captureAvailability({ urls, environmentUrls: [], loadedUrls: arrivals.loadedUrls, failedUrls: arrivals.failedUrls });
  const phase = roomResolvePhase({ splatStatus: "loaded", hasAsset: true, totalChunks: urls.length,
    loadedChunks: arrivals.loadedCount, failedChunks: arrivals.failedCount, captureAvailability: availability });
  const ink = inkTargetOpacity({ splatActive: active, loadedChunks: arrivals.loadedCount, totalChunks: urls.length });
  return <>
    <output data-testid="readiness" data-phase={phase} data-loaded={arrivals.loadedCount} data-failed={arrivals.failedCount} data-ink={ink} />
    <CockpitSplatLayer urls={urls} transform={transform} active={active} onChunkLoaded={arrivals.markLoaded} onChunkFailed={arrivals.markFailed} />
  </>;
}

function source(url: string): NativeSplatLayerProps {
  const result = native.sources.get(url);
  if (result === undefined) throw new Error(`Native source not mounted: ${url}`);
  return result;
}
function decode(url: string): void { source(url).onLoad?.({ url, splatCount: 100, localBounds: null }); }
function draw(url: string): void { source(url).onRendered?.(url); }

let nowMs = 0;
function advanceFrame(): void { nowMs += 1000; act(() => { frame.current?.(); }); }

beforeEach(() => {
  native.sources.clear(); frame.current = null; frame.reduced = false; frame.invalidate.mockClear(); nowMs = 0;
  vi.spyOn(performance, "now").mockImplementation(() => nowMs);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("cockpit captured-source readiness", () => {
  it("starts the reveal after decode but keeps ink and progress pending until each source actually draws", async () => {
    render(<Choreography urls={["/a.sog", "/b.sog"]} />);
    await waitFor(() => { expect(native.sources.size).toBe(2); });
    expect(source("/a.sog").opacityFn?.()).toBe(0);
    act(() => { decode("/a.sog"); decode("/b.sog"); });
    const readiness = screen.getByTestId("readiness");
    expect(readiness.dataset.phase).toBe("developing");
    expect(readiness.dataset.loaded).toBe("0");
    expect(readiness.dataset.ink).toBe("1");
    advanceFrame();
    expect(source("/a.sog").opacityFn?.()).toBe(1);
    expect(source("/b.sog").opacityFn?.()).toBe(1);
    expect(frame.invalidate).toHaveBeenCalled();
    act(() => { draw("/a.sog"); });
    expect(readiness.dataset.phase).toBe("developing");
    expect(readiness.dataset.loaded).toBe("1");
    expect(readiness.dataset.ink).toBe("0.5");
    act(() => { draw("/b.sog"); });
    expect(readiness.dataset.phase).toBe("resolved");
    expect(readiness.dataset.loaded).toBe("2");
    expect(readiness.dataset.ink).toBe("0");
  });

  it.each([false, true])("reveals already decoded Model sources on activation without claiming a hidden draw (reduced motion=%s)", async (reduced) => {
    frame.reduced = reduced;
    const urls = ["/a.sog"];
    const { rerender } = render(<Choreography urls={urls} active={false} />);
    await waitFor(() => { expect(native.sources.size).toBe(1); });
    const initialOpacity = source("/a.sog").opacityFn;
    act(() => { decode("/a.sog"); });
    advanceFrame();
    expect(source("/a.sog").opacityFn?.()).toBe(0);
    expect(screen.getByTestId("readiness").dataset.loaded).toBe("0");
    rerender(<Choreography urls={urls} active />);
    advanceFrame();
    expect(source("/a.sog").opacityFn).toBe(initialOpacity);
    expect(source("/a.sog").opacityFn?.()).toBe(1);
    expect(screen.getByTestId("readiness").dataset.phase).toBe("developing");
    act(() => { draw("/a.sog"); });
    expect(screen.getByTestId("readiness").dataset.phase).toBe("resolved");
  });

  it("forwards the latest callbacks without changing native callback identities or reporting decode as arrival", async () => {
    const firstLoaded = vi.fn(), latestLoaded = vi.fn(), firstFailed = vi.fn(), latestFailed = vi.fn();
    const urls = ["/a.sog"];
    const { rerender } = render(<CockpitSplatLayer urls={urls} transform={transform} active onChunkLoaded={firstLoaded} onChunkFailed={firstFailed} />);
    await waitFor(() => { expect(native.sources.size).toBe(1); });
    const first = source("/a.sog");
    rerender(<CockpitSplatLayer urls={urls} transform={transform} active onChunkLoaded={latestLoaded} onChunkFailed={latestFailed} />);
    const latest = source("/a.sog");
    expect(latest.onLoad).toBe(first.onLoad);
    expect(latest.onRendered).toBe(first.onRendered);
    expect(latest.onError).toBe(first.onError);
    act(() => { decode("/a.sog"); });
    expect(latestLoaded).not.toHaveBeenCalled();
    advanceFrame();
    act(() => { draw("/a.sog"); });
    expect(latestLoaded).toHaveBeenCalledExactlyOnceWith("/a.sog");
    act(() => { latest.onError?.({ url: "/a.sog", error: new Error("compile failed") }); });
    expect(latestFailed).toHaveBeenCalledExactlyOnceWith("/a.sog");
    expect(firstLoaded).not.toHaveBeenCalled();
    expect(firstFailed).not.toHaveBeenCalled();
  });

  it("settles a partial failure only after the surviving source draws and drops removed URL arrivals", async () => {
    const { rerender } = render(<Choreography urls={["/a.sog", "/b.sog"]} />);
    await waitFor(() => { expect(native.sources.size).toBe(2); });
    act(() => {
      decode("/a.sog");
      source("/b.sog").onError?.({ url: "/b.sog", error: new Error("Malformed SOG") });
    });
    expect(screen.getByTestId("readiness").dataset.phase).toBe("developing");
    expect(screen.getByTestId("readiness").dataset.failed).toBe("1");
    advanceFrame();
    act(() => { draw("/a.sog"); });
    expect(screen.getByTestId("readiness").dataset.phase).toBe("degraded");
    rerender(<Choreography urls={["/c.sog"]} />);
    expect(screen.getByTestId("readiness").dataset.loaded).toBe("0");
    expect(screen.getByTestId("readiness").dataset.failed).toBe("0");
    act(() => { draw("/a.sog"); });
    expect(screen.getByTestId("readiness").dataset.loaded).toBe("0");
  });
});
