import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { NativeSplatLayerProps } from "../components/scene/NativeSplatLayer.js";

const layers = vi.hoisted(() => new Map<string, NativeSplatLayerProps>());

// The captures page mounts a native Three canvas and splat layers. Both are stubbed
// so the assertions are about what the page DECIDES — which tiles, which claim
// copy, which room — not about WebGL, which happy-dom cannot provide anyway.
vi.mock("../components/scene/NativeCanvas.js", async () => ({
  NativeCanvas: (await import("@react-three/fiber")).Canvas,
}));
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { readonly children?: React.ReactNode }) => (
    <div data-testid="room-captures-canvas">{children}</div>
  ),
}));

vi.mock("@react-three/drei", () => ({
  OrbitControls: (props: Record<string, unknown>) => (
    <div
      data-testid="orbit-controls"
      data-target={JSON.stringify(props["target"])}
      data-max-distance={String(props["maxDistance"])}
    />
  ),
}));

vi.mock("../components/scene/NativeSplatLayer.js", () => ({
  NativeSplatLayer: (props: NativeSplatLayerProps) => {
    layers.set(props.url, props);
    const { url, position, scale, includeRendererHost } = props;
    return (
    <div
      data-testid="native-splat-layer"
      data-position={JSON.stringify(position)}
      data-scale={String(scale)}
      data-host={String(includeRendererHost)}
    >
      {url}
    </div>
    );
  },
}));

const { RoomCapturesPage } = await import("../pages/RoomCapturesPage.js");
const { roomSplatBundle, roomSplatServedBytes, roomSplatServedSplats } =
  await import("../data/room-splat-bundles.js");

function mount(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/captures/:roomSlug?" element={<RoomCapturesPage />} />
        <Route path="/venues/:venueSlug/captures/:roomSlug?" element={<RoomCapturesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

// vitest runs with globals:false here, so teardown is explicit. Without it
// every render accumulates in the DOM and later assertions see earlier rooms.
afterEach(() => {
  cleanup();
  layers.clear();
  vi.useRealTimers();
});

function mountedUrls(): string[] {
  return screen.getAllByTestId("native-splat-layer").map((node) => node.textContent ?? "");
}

describe("RoomCapturesPage", () => {
  it("keeps activity after decode until every successful tile draws, with failures counted once", () => {
    vi.useFakeTimers();
    mount("/captures/reception-room");
    const sources = [...layers.values()];
    const [failed, ...successful] = sources;
    if (failed === undefined) throw new Error("Expected capture sources");
    act(() => {
      for (const source of sources) source.onLoad?.({ url: source.url, splatCount: 100, localBounds: null });
      failed.onError?.({ url: failed.url, error: new Error("Upload failed") });
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByTestId("captures-status").textContent).toContain(`Loading ${String(sources.length)}/${String(sources.length)} tiles`);
    expect(screen.getByRole("status")).toBeDefined();
    act(() => {
      for (const source of successful) source.onRendered?.(source.url);
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByTestId("captures-status").textContent).toContain("1 tiles failed");
  });

  it("retains draw events that arrive before decode metadata and resets readiness for a different room", () => {
    vi.useFakeTimers();
    mount("/captures/reception-room");
    const previous = [...layers.values()];
    act(() => {
      for (const source of previous) source.onRendered?.(source.url);
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole("status")).toBeDefined();
    act(() => {
      for (const source of previous) source.onLoad?.({ url: source.url, splatCount: 100, localBounds: null });
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Grand Hall/u }));
    act(() => {
      for (const source of previous) {
        source.onLoad?.({ url: source.url, splatCount: 100, localBounds: null });
        source.onRendered?.(source.url);
      }
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole("status").textContent).toContain("Loading 0/");
  });

  it("lists every captured room", () => {
    mount("/captures");
    const rail = screen.getByRole("navigation", { name: "Captured rooms" });
    expect(rail.querySelectorAll("button")).toHaveLength(8);
  });

  it("mounts one layer per tile for the selected room", () => {
    mount("/captures/reception-room");
    const urls = mountedUrls();
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.includes("/trades-hall/reception-room/"))).toBe(true);
  });

  it("mounts exactly one renderer host, on the first tile: a host per tile is a renderer per tile", () => {
    mount("/captures/grand-hall");
    const hosts = [...document.querySelectorAll('[data-testid="native-splat-layer"]')]
      .map((layer) => layer.getAttribute("data-host"));
    expect(hosts.length).toBeGreaterThan(1);
    expect(hosts[0]).toBe("true");
    expect(hosts.slice(1).every((host) => host === "false")).toBe(true);
  });

  it("mounts only the finest level, never a stack of every level", () => {
    mount("/captures/grand-hall");
    const bundle = roomSplatBundle("grand-hall");
    const finest = bundle?.finestLevel ?? 0;
    const byFile = new Map((bundle?.tiles ?? []).map((tile) => [tile.file, tile]));
    const urls = mountedUrls();
    expect(urls).toHaveLength(12);
    for (const url of urls) {
      const tile = byFile.get(url.split("/").pop() ?? "");
      expect(tile, url).toBeDefined();
      if (tile !== undefined && !tile.isEnvironment) expect(tile.lodLevel, url).toBe(finest);
    }
  });

  it("tells the reviewer what is served and what is merely staged", () => {
    mount("/captures/grand-hall");
    const rail = screen.getByRole("navigation", { name: "Captured rooms" });
    const meta = rail.textContent ?? "";
    // 6,019,684 splats / ~107 MB reach a viewer; 24 tiles / 200 MB sit staged.
    expect(meta).toContain(`${roomSplatServedSplats("grand-hall").toLocaleString("en-GB")} splats`);
    expect(meta).toContain(`${(roomSplatServedBytes("grand-hall") / 1024 / 1024).toFixed(0)} MB`);
    expect(meta).toMatch(/12 of 24 tiles/u);
    expect(meta).not.toMatch(/24 tiles staged/u);
    expect(meta).not.toContain("11,487,038");
  });

  it("shows the room named in the URL, not the default", () => {
    mount("/captures/saloon");
    expect(mountedUrls().every((url) => url.includes("/saloon/"))).toBe(true);
  });

  it("falls back to a real room rather than breaking on an unknown slug", () => {
    mount("/captures/not-a-room");
    expect(mountedUrls().every((url) => url.includes("/reception-room/"))).toBe(true);
  });

  it("never scales a capture, because captures and the scene are both metric", () => {
    mount("/captures/reception-room");
    for (const node of screen.getAllByTestId("native-splat-layer")) {
      expect(node.getAttribute("data-scale")).toBe("1");
    }
  });

  it("applies the room's derived transform to every tile of that room", () => {
    mount("/captures/grand-hall");
    const positions = screen.getAllByTestId("native-splat-layer")
      .map((node) => node.getAttribute("data-position"));
    expect(new Set(positions).size).toBe(1);
    expect(positions[0]).not.toBe(JSON.stringify([0, 0, 0]));
  });

  it("states that captures are staged and unregistered", () => {
    mount("/captures/reception-room");
    const claim = screen.getByTestId("captures-claim").textContent ?? "";
    expect(claim).toMatch(/staged/i);
    expect(claim).toMatch(/not yet registered/i);
  });

  it("never lets a capture read as reviewed or certified", () => {
    mount("/captures/reception-room");
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/human reviewed/i);
    expect(body).not.toMatch(/survey-grade/i);
    expect(body).not.toMatch(/photoreal/i);
    expect(body).not.toMatch(/production ready/i);
    expect(body).not.toMatch(/certified/i);
  });

  it("marks a whole-floor capture as still under alignment review", () => {
    mount("/captures/robert-adam-room");
    const rail = screen.getByRole("navigation", { name: "Captured rooms" });
    const button = [...rail.querySelectorAll("button")]
      .find((node) => node.textContent?.includes("Robert Adam") === true);
    expect(button?.textContent).toMatch(/alignment under review/i);
  });

  it("marks a cleanly measured capture as aligned", () => {
    mount("/captures/reception-room");
    const rail = screen.getByRole("navigation", { name: "Captured rooms" });
    const button = [...rail.querySelectorAll("button")]
      .find((node) => node.textContent?.includes("Reception") === true);
    expect(button?.textContent).toMatch(/aligned/i);
    expect(button?.textContent).not.toMatch(/under review/i);
  });

  it("shows how the alignment was derived rather than presenting it as settled", () => {
    mount("/captures/reception-room");
    expect(screen.getByTestId("captures-status").textContent ?? "").toMatch(/derived from/i);
  });

  it("marks the open room for assistive technology", () => {
    mount("/captures/saloon");
    const current = screen.getByRole("navigation", { name: "Captured rooms" })
      .querySelector('[aria-current="true"]');
    expect(current?.textContent).toContain("Saloon");
  });

  it("switching rooms swaps the mounted capture", () => {
    mount("/captures/reception-room");
    expect(mountedUrls().every((url) => url.includes("/reception-room/"))).toBe(true);
    const rail = screen.getByRole("navigation", { name: "Captured rooms" });
    const saloon = [...rail.querySelectorAll("button")]
      .find((node) => node.textContent?.includes("Saloon") === true);
    fireEvent.click(saloon as HTMLElement);
    expect(mountedUrls().every((url) => url.includes("/saloon/"))).toBe(true);
  });

  it("keeps the orbit target inside the room so a drag cannot leave it", () => {
    mount("/captures/reception-room");
    const target = JSON.parse(
      screen.getByTestId("orbit-controls").getAttribute("data-target") ?? "[0,0,0]",
    ) as number[];
    expect(Math.abs(target[2] ?? 0)).toBeLessThan(14.72 / 2);
  });
});
