import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE } from "@omnitwin/types";
import {
  LayoutPlanThumbnail,
  resetTimelineThumbnailRasterCacheForTests,
  setTimelineThumbnailCanvasContextResolverForTests,
  timelineThumbnailRasterCacheSizeForTests,
  type TimelineThumbnailCanvasContext,
} from "../LayoutPlanThumbnail.js";

interface QueuedIdleCallback {
  readonly id: number;
  readonly callback: IdleRequestCallback;
}

interface CanvasContextMock {
  readonly context: TimelineThumbnailCanvasContext;
  readonly clearRect: ReturnType<typeof vi.fn<(x: number, y: number, width: number, height: number) => void>>;
  readonly fillRect: ReturnType<typeof vi.fn<(x: number, y: number, width: number, height: number) => void>>;
  readonly beginPath: ReturnType<typeof vi.fn<() => void>>;
  readonly moveTo: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
  readonly lineTo: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
  readonly closePath: ReturnType<typeof vi.fn<() => void>>;
  readonly fill: ReturnType<typeof vi.fn<() => void>>;
  readonly stroke: ReturnType<typeof vi.fn<() => void>>;
  readonly save: ReturnType<typeof vi.fn<() => void>>;
  readonly translate: ReturnType<typeof vi.fn<(x: number, y: number) => void>>;
  readonly rotate: ReturnType<typeof vi.fn<(angle: number) => void>>;
  readonly ellipse: ReturnType<typeof vi.fn<(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ) => void>>;
  readonly restore: ReturnType<typeof vi.fn<() => void>>;
  readonly drawImage: ReturnType<typeof vi.fn<(image: CanvasImageSource, dx: number, dy: number) => void>>;
}

function createCanvasContextMock(): CanvasContextMock {
  const clearRect = vi.fn<(x: number, y: number, width: number, height: number) => void>();
  const fillRect = vi.fn<(x: number, y: number, width: number, height: number) => void>();
  const beginPath = vi.fn<() => void>();
  const moveTo = vi.fn<(x: number, y: number) => void>();
  const lineTo = vi.fn<(x: number, y: number) => void>();
  const closePath = vi.fn<() => void>();
  const fill = vi.fn<() => void>();
  const stroke = vi.fn<() => void>();
  const save = vi.fn<() => void>();
  const translate = vi.fn<(x: number, y: number) => void>();
  const rotate = vi.fn<(angle: number) => void>();
  const ellipse = vi.fn<CanvasContextMock["context"]["ellipse"]>();
  const restore = vi.fn<() => void>();
  const drawImage = vi.fn<(image: CanvasImageSource, dx: number, dy: number) => void>();
  return {
    context: {
      clearRect,
      fillRect,
      beginPath,
      moveTo,
      lineTo,
      closePath,
      fill,
      stroke,
      save,
      translate,
      rotate,
      ellipse,
      restore,
      drawImage,
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      globalAlpha: 1,
    },
    clearRect,
    fillRect,
    beginPath,
    moveTo,
    lineTo,
    closePath,
    fill,
    stroke,
    save,
    translate,
    rotate,
    ellipse,
    restore,
    drawImage,
  };
}

let idleCallbacks: QueuedIdleCallback[];
let nextIdleId: number;
let canvasContext: CanvasContextMock;

function flushNextIdle(timeRemaining = 50): void {
  const queued = idleCallbacks.shift();
  if (queued === undefined) throw new Error("No idle callback queued");
  queued.callback({
    didTimeout: false,
    timeRemaining: () => timeRemaining,
  });
}

beforeEach(() => {
  idleCallbacks = [];
  nextIdleId = 1;
  canvasContext = createCanvasContextMock();
  resetTimelineThumbnailRasterCacheForTests();
  setTimelineThumbnailCanvasContextResolverForTests(() => canvasContext.context);
  window.requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
    const id = nextIdleId;
    nextIdleId += 1;
    idleCallbacks.push({ id, callback });
    return id;
  });
  window.cancelIdleCallback = vi.fn((id: number) => {
    idleCallbacks = idleCallbacks.filter((queued) => queued.id !== id);
  });
});

afterEach(() => {
  resetTimelineThumbnailRasterCacheForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("LayoutPlanThumbnail idle raster queue", () => {
  it("deduplicates a proof raster, paints one job per idle turn, and reuses its bounded cache", () => {
    const first = render(
      <>
        <LayoutPlanThumbnail
          snapshot={CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE}
          label="Arrival"
          proofKey="plan-v1:arrival:proof-a"
        />
        <LayoutPlanThumbnail
          snapshot={CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE}
          label="Arrival duplicate"
          proofKey="plan-v1:arrival:proof-a"
        />
      </>,
    );
    const canvases = first.container.querySelectorAll("canvas");
    expect(canvases).toHaveLength(2);
    expect(canvases[0]?.getAttribute("data-thumbnail-ready")).toBe("false");
    expect(canvasContext.fillRect).not.toHaveBeenCalled();
    expect(window.requestIdleCallback).toHaveBeenCalledOnce();

    act(() => { flushNextIdle(); });
    expect(canvases[0]?.getAttribute("data-thumbnail-ready")).toBe("true");
    expect(canvases[1]?.getAttribute("data-thumbnail-ready")).toBe("true");
    expect(canvasContext.drawImage).toHaveBeenCalledTimes(2);
    const paintCalls = canvasContext.fillRect.mock.calls.length;
    expect(paintCalls).toBeGreaterThan(0);

    first.unmount();
    const cached = render(
      <LayoutPlanThumbnail
        snapshot={CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE}
        label="Arrival remount"
        proofKey="plan-v1:arrival:proof-a"
      />,
    );
    expect(cached.container.querySelector("canvas")?.getAttribute("data-thumbnail-ready")).toBe("true");
    expect(canvasContext.fillRect.mock.calls.length).toBe(paintCalls);
    expect(window.requestIdleCallback).toHaveBeenCalledOnce();
  });

  it("repaints for a distinct canonical proof key and defers when idle time is short", () => {
    const view = render(
      <LayoutPlanThumbnail
        snapshot={CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE}
        label="Dinner"
        proofKey="plan-v1:dinner:proof-b"
      />,
    );
    act(() => { flushNextIdle(1); });
    expect(canvasContext.fillRect).not.toHaveBeenCalled();
    expect(idleCallbacks).toHaveLength(1);
    act(() => { flushNextIdle(50); });
    expect(canvasContext.fillRect).toHaveBeenCalled();
    expect(view.container.querySelector("canvas")?.getAttribute("data-thumbnail-ready")).toBe("true");
  });

  it("cancels unsubscribed jobs and suspends uncached work during transitions", () => {
    const cancelled = render(
      <LayoutPlanThumbnail
        snapshot={CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE}
        label="Cancelled"
        proofKey="plan-v1:cancelled:proof-c"
      />,
    );
    cancelled.unmount();
    act(() => { flushNextIdle(); });
    expect(canvasContext.fillRect).not.toHaveBeenCalled();

    const paused = render(
      <LayoutPlanThumbnail
        snapshot={CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE}
        label="Paused"
        proofKey="plan-v1:paused:proof-d"
        paused
      />,
    );
    expect(paused.container.querySelector("canvas")?.getAttribute("data-thumbnail-ready")).toBe("false");
    expect(idleCallbacks).toHaveLength(0);
  });

  it("bounds the proof-key raster LRU", () => {
    const view = render(
      <LayoutPlanThumbnail
        snapshot={CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE}
        label="Frame 0"
        proofKey="plan-v1:frame:0"
      />,
    );
    for (let index = 0; index < 26; index += 1) {
      view.rerender(
        <LayoutPlanThumbnail
          snapshot={CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE}
          label={`Frame ${String(index)}`}
          proofKey={`plan-v1:frame:${String(index)}`}
        />,
      );
      act(() => { flushNextIdle(); });
    }
    expect(timelineThumbnailRasterCacheSizeForTests()).toBe(24);
  });

  it("uses the one-job timer fallback when requestIdleCallback is unavailable", () => {
    resetTimelineThumbnailRasterCacheForTests();
    setTimelineThumbnailCanvasContextResolverForTests(() => canvasContext.context);
    Reflect.deleteProperty(window, "requestIdleCallback");
    Reflect.deleteProperty(window, "cancelIdleCallback");
    vi.useFakeTimers();
    const view = render(
      <LayoutPlanThumbnail
        snapshot={CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE}
        label="Fallback"
        proofKey="plan-v1:fallback:proof"
      />,
    );
    expect(canvasContext.fillRect).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(32); });
    expect(canvasContext.fillRect).toHaveBeenCalled();
    expect(view.container.querySelector("canvas")?.getAttribute("data-thumbnail-ready")).toBe("true");
  });
});
