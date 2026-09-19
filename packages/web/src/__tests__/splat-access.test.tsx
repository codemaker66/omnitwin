import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { gaussianSplatsAvailable } from "../lib/splat-access.js";
import { NativeSplatLayer } from "../components/scene/NativeSplatLayer.js";
import { RoomsHomePage } from "../pages/RoomsHomePage.js";

let routes: RouteObject[];
beforeAll(async () => {
  vi.stubEnv("DEV", false);
  const { router } = await import("../router.js");
  routes = router.routes;
  router.dispose();
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe("production Gaussian splat hold", () => {
  it.each([
    "/room/grand-hall?bare=1", "/room/saloon?renderer=webgpu",
    "/living-hall", "/captures/grand-hall",
    "/venues/trades-hall/captures/grand-hall", "/dev/trades-hall-visual",
    "/venues/trades-hall/rooms/grand-hall", "/splats/reception/chunk_000.sog",
    "/work-in-progress",
  ])("blocks direct entry at %s without mounting a viewer", async (url) => {
    vi.stubEnv("DEV", false);
    const router = createMemoryRouter(routes, { initialEntries: [url] });
    const { container } = render(<RouterProvider router={router} />);
    expect(await screen.findByRole("heading", { name: "Work in progress", level: 1 })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Try the tour" }).getAttribute("href")).toBe("/tour");
    expect(container.querySelector("canvas")).toBeNull();
    router.dispose();
  });

  it("does not mount a native layer even when a caller supplies an asset URL", () => {
    vi.stubEnv("DEV", false);
    // Mounting the available layer here would fail without an R3F canvas.
    const { container } = render(<NativeSplatLayer url="https://example.com/capture.sog" />);
    expect(container.childElementCount).toBe(0);
    expect(gaussianSplatsAvailable()).toBe(false);
  });

  it("closes every homepage room card and offers the labelled panorama tour", () => {
    vi.stubEnv("DEV", false);
    const router = createMemoryRouter([{ path: "/", element: <RoomsHomePage /> }]);
    const { container } = render(<RouterProvider router={router} />);
    expect(container.querySelector('a[href^="/room/"]')).toBeNull();
    expect(screen.getByText("Gaussian splats · Work in progress")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Try the virtual tour · Work in progress" })).toBeTruthy();
    router.dispose();
  });

  it("keeps the local development renderer available", () => {
    vi.stubEnv("DEV", true);
    expect(gaussianSplatsAvailable()).toBe(true);
  });
});
