import { act, cleanup, render } from "@testing-library/react";
import { useEffect, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SparkSplatLayerProps } from "../../scene/SparkSplatLayer.js";
import type { RoomSplatLadder } from "../../../data/room-splat-bundles.js";

const recorded = vi.hoisted(() => ({ layers: new Map<string, SparkSplatLayerProps>(), invalidate: vi.fn() }));
vi.mock("@react-three/fiber", () => ({
  useFrame: vi.fn(),
  useThree: (select: (state: { invalidate: () => void }) => unknown) => select({ invalidate: recorded.invalidate }),
}));
vi.mock("../../scene/SparkSplatLayer.js", () => ({
  SparkRendererMount: () => <div data-testid="spark-host" />,
  SparkSplatLayer: (props: SparkSplatLayerProps) => {
    recorded.layers.set(props.url, props);
    useEffect(() => () => { recorded.layers.delete(props.url); }, [props.url]);
    return null;
  },
}));
await import("../../scene/SparkSplatLayer.js");
const { CockpitSplatLayer } = await import("../CockpitSplatLayer.js");
const ladder: RoomSplatLadder = {
  environment: [{ url: "sky", file: "sky", tree: false }], coarse: [{ url: "coarse", file: "coarse", tree: false }],
  sharp: [{ url: "fine-a", file: "fine-a", tree: false }, { url: "fine-b", file: "fine-b", tree: false }],
};
const transform = { position: [0, 0, 0] as const, rotation: [0, 0, 0] as const, scale: 1, note: "fixture" };
const urls = ["fine-a", "fine-b", "sky"];
function loaded(url: string): void { recorded.layers.get(url)?.onLoad?.({ url, splatCount: 100, localBounds: null }); }
function tick(): void { act(() => { vi.advanceTimersByTime(400); }); }
async function mount(element: ReactElement) {
  const view = render(element);
  await act(async () => { await vi.dynamicImportSettled(); });
  return view;
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }); recorded.layers.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("CockpitSplatLayer delivery", () => {
  it("starts coarse-first with one independent host and preserves all final URLs", async () => {
    const onChunkLoaded = vi.fn<(url: string) => void>();
    const view = await mount(<CockpitSplatLayer urls={urls} ladder={ladder} transform={transform} active onChunkLoaded={onChunkLoaded} />);
    expect([...recorded.layers.keys()]).toEqual(["sky", "coarse"]);
    expect(view.getAllByTestId("spark-host")).toHaveLength(1);
    expect(recorded.layers.get("coarse")?.opacityFn?.()).toBe(1);
    const coarseHandler = recorded.layers.get("coarse")?.onLoad;
    act(() => { loaded("coarse"); });
    tick();
    expect(onChunkLoaded).not.toHaveBeenCalled();
    expect(recorded.layers.get("coarse")?.onLoad).toBe(coarseHandler);
    expect(recorded.layers.get("fine-a")?.opacityFn?.()).toBe(1);
    expect(window.__plannerSplatDelivery).toMatchObject({ firstDecoded: true, finestSettled: 0, finestTotal: 2 });
    view.rerender(<CockpitSplatLayer urls={[...urls]} ladder={{ ...ladder }} transform={transform} active onChunkLoaded={onChunkLoaded} />);
    expect(recorded.layers.get("coarse")?.onLoad).toBe(coarseHandler);
    act(() => { loaded("fine-a"); loaded("fine-b"); loaded("sky"); });
    tick();
    expect([...recorded.layers.keys()].sort()).toEqual([...urls].sort());
    expect(view.getAllByTestId("spark-host")).toHaveLength(1);
    expect([...recorded.layers.values()].every((p) => p.includeRendererHost === false)).toBe(true);
    expect(onChunkLoaded.mock.calls.map(([url]) => url).sort()).toEqual([...urls].sort());
    expect(window.__plannerSplatDelivery).toMatchObject({ stage: "sharp", finestComplete: true, finestFailed: 0 });
  });

  it("retains cover on finest failure without reporting coarse failures as final failures", async () => {
    const onChunkFailed = vi.fn<(url: string) => void>();
    await mount(<CockpitSplatLayer urls={urls} ladder={ladder} transform={transform} active onChunkFailed={onChunkFailed} />);
    act(() => { recorded.layers.get("coarse")?.onError?.({ url: "coarse", error: new Error("missing") }); });
    tick();
    expect(onChunkFailed).not.toHaveBeenCalled();
    act(() => { loaded("coarse"); loaded("fine-a"); recorded.layers.get("fine-b")?.onError?.({ url: "fine-b", error: new Error("missing") }); });
    tick();
    expect(recorded.layers.has("coarse")).toBe(true);
    expect(onChunkFailed).toHaveBeenCalledExactlyOnceWith("fine-b");
    expect(window.__plannerSplatDelivery).toMatchObject({ firstDecoded: true, finestComplete: true, finestFailed: 1, stage: "sharpening" });
  });

  it("discards late callbacks and telemetry when replacing or unmounting the room", async () => {
    const onChunkLoaded = vi.fn<(url: string) => void>();
    const view = await mount(<CockpitSplatLayer urls={urls} ladder={ladder} transform={transform} active onChunkLoaded={onChunkLoaded} />);
    const stale = recorded.layers.get("sky")?.onLoad;
    view.rerender(<CockpitSplatLayer urls={["registered"]} transform={transform} active onChunkLoaded={onChunkLoaded} />);
    act(() => { stale?.({ url: "sky", splatCount: 100, localBounds: null }); });
    tick();
    expect(onChunkLoaded).not.toHaveBeenCalled();
    expect([...recorded.layers.keys()]).toEqual(["registered"]);
    expect(window.__plannerSplatDelivery?.firstDecoded).toBe(false);
    act(() => { loaded("registered"); });
    tick();
    expect(window.__plannerSplatDelivery?.finestComplete).toBe(true);
    const afterUnmount = recorded.layers.get("registered")?.onLoad;
    view.unmount();
    onChunkLoaded.mockClear();
    act(() => { afterUnmount?.({ url: "registered", splatCount: 100, localBounds: null }); });
    expect(onChunkLoaded).not.toHaveBeenCalled();
    expect(window.__plannerSplatDelivery).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
