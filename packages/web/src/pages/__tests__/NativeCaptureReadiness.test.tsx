import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeSplatLayerProps } from "../../components/scene/NativeSplatLayer.js";

const layers = vi.hoisted(() => new Map<string, NativeSplatLayerProps>());
vi.mock("../../components/scene/NativeSplatLayer.js", () => ({
  NativeSplatLayer: (props: NativeSplatLayerProps) => { layers.set(props.url, props); return null; },
}));
vi.mock("../../components/scene/NativeCanvas.js", async () => {
  const { NativeSplatLayer } = await import("../../components/scene/NativeSplatLayer.js");
  // Mount source lifecycle boundaries only: GPU and camera behavior are tested
  // elsewhere. Preserve nested groups so every expected source participates.
  const sources = (children: ReactNode): ReactNode => Children.map(children, (child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return null;
    if (child.type === NativeSplatLayer) return child;
    return typeof child.type === "string" ? <Fragment>{sources(child.props.children)}</Fragment> : null;
  });
  return { NativeCanvas: ({ children }: { children?: ReactNode }) => <div>{sources(children)}</div> };
});

import FreshWalk from "../fresh/FreshWalk.js";
import { LivingHallScene } from "../living-hall/LivingHallScene.js";

beforeEach(() => { layers.clear(); });
afterEach(cleanup);

function decoded(source: NativeSplatLayerProps): void {
  source.onLoad?.({ url: source.url, splatCount: 100, localBounds: null });
}
function drawn(source: NativeSplatLayerProps): void { source.onRendered?.(source.url); }
function sources(): NativeSplatLayerProps[] { return [...layers.values()]; }

describe("FreshWalk draw readiness", () => {
  it("keeps byte progress separate from its final draw and delivers readiness to the latest callback", () => {
    const previous = vi.fn(), current = vi.fn(), onProgress = vi.fn(), onFailed = vi.fn();
    const view = render(<FreshWalk onLive={previous} onProgress={onProgress} onFailed={onFailed} />);
    const [last, ...earlier] = sources();
    if (last === undefined) throw new Error("Expected capture sources");
    act(() => { sources().forEach(decoded); });
    expect(onProgress.mock.lastCall?.[0]).toBe(onProgress.mock.lastCall?.[1]);
    expect(previous).not.toHaveBeenCalled();
    act(() => { earlier.forEach(drawn); earlier.forEach(drawn); });
    expect(previous).not.toHaveBeenCalled();
    view.rerender(<FreshWalk onLive={current} onProgress={onProgress} onFailed={onFailed} />);
    act(() => { drawn(last); drawn(last); });
    expect(previous).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledOnce();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("retains draw events until all decode metadata arrives", () => {
    const onLive = vi.fn();
    render(<FreshWalk onLive={onLive} onProgress={vi.fn()} onFailed={vi.fn()} />);
    act(() => { sources().forEach(drawn); });
    expect(onLive).not.toHaveBeenCalled();
    act(() => { sources().forEach(decoded); });
    expect(onLive).toHaveBeenCalledOnce();
  });

  it("does not announce a failed capture as live when late callbacks arrive", () => {
    const onLive = vi.fn(), onFailed = vi.fn();
    render(<FreshWalk onLive={onLive} onProgress={vi.fn()} onFailed={onFailed} />);
    const first = sources()[0];
    if (first === undefined) throw new Error("Expected capture sources");
    act(() => {
      first.onError?.({ url: first.url, error: new Error("Upload failed") });
      first.onError?.({ url: first.url, error: new Error("Duplicate error") });
      sources().forEach(decoded);
      sources().forEach(drawn);
    });
    expect(onFailed).toHaveBeenCalledOnce();
    expect(onLive).not.toHaveBeenCalled();
  });
});

describe("LivingHallScene draw readiness", () => {
  const props = { reducedMotion: true, eventType: "wedding", sandboxActive: false, onSandboxExit: vi.fn() } as const;

  it("keeps its poster until every distinct source draws and reports success once", () => {
    const previous = vi.fn(), current = vi.fn();
    const view = render(<LivingHallScene {...props} onSceneLoaded={previous} />);
    const [last, ...earlier] = sources();
    if (last === undefined) throw new Error("Expected capture sources");
    act(() => { sources().forEach(decoded); earlier.forEach(drawn); earlier.forEach(drawn); });
    expect(view.container.querySelector(".lh-scene")?.getAttribute("data-scene-state")).toBe("loading");
    expect(view.container.querySelector(".lh-scene-poster")?.classList.contains("is-sharpened")).toBe(false);
    expect(previous).not.toHaveBeenCalled();
    view.rerender(<LivingHallScene {...props} onSceneLoaded={current} />);
    act(() => { drawn(last); drawn(last); });
    expect(current).toHaveBeenCalledOnce();
    expect(previous).not.toHaveBeenCalled();
    expect(view.container.querySelector(".lh-scene")?.getAttribute("data-scene-state")).toBe("live");
    expect(view.container.querySelector(".lh-scene-poster")?.classList.contains("is-sharpened")).toBe(true);
  });

  it("retains the photograph after failure even when late draws arrive", () => {
    const onSceneLoaded = vi.fn(), onSceneFailed = vi.fn();
    const view = render(<LivingHallScene {...props} onSceneLoaded={onSceneLoaded} onSceneFailed={onSceneFailed} />);
    const first = sources()[0];
    if (first === undefined) throw new Error("Expected capture sources");
    act(() => {
      first.onError?.({ url: first.url, error: new Error("Upload failed") });
      sources().forEach(drawn);
    });
    expect(onSceneFailed).toHaveBeenCalledOnce();
    expect(onSceneLoaded).not.toHaveBeenCalled();
    expect(view.container.querySelector(".lh-scene")?.getAttribute("data-scene-state")).toBe("failed");
    expect(view.container.querySelector(".lh-scene-poster")?.classList.contains("is-sharpened")).toBe(false);
  });
});
