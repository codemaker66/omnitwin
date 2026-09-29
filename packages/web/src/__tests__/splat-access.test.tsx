import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Window as HappyWindow } from "happy-dom";
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
    "/captures/grand-hall",
    "/venues/trades-hall/captures/grand-hall", "/dev/trades-hall-visual",
    "/splats/reception/chunk_000.sog",
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

  // T-616 retired these two addresses with the older home pages: they now
  // forward to the front door, which mounts no viewer either.
  it.each(["/living-hall", "/venues/trades-hall/rooms/grand-hall"])(
    "sends the retired %s to the front door without mounting a viewer",
    async (url) => {
      vi.stubEnv("DEV", false);
      const router = createMemoryRouter(routes, { initialEntries: [url] });
      const { container } = render(<RouterProvider router={router} />);
      // A cold first render transforms the front door's module graph.
      expect(await screen.findByRole("heading", { name: "Grand Hall", level: 1 }, { timeout: 15_000 })).toBeTruthy();
      expect(router.state.location.pathname).toBe("/");
      expect(container.querySelector("canvas")).toBeNull();
      router.dispose();
    },
  );

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

describe("where splats may run (T-639)", () => {
  it("allows local development", () => {
    expect(gaussianSplatsAvailable({ DEV: true, VITE_DEPLOY_ENV: "" })).toBe(true);
  });

  it("allows preview deployments so Blake can judge on his own devices", () => {
    expect(gaussianSplatsAvailable({ DEV: false, VITE_DEPLOY_ENV: "preview" })).toBe(true);
  });

  it.each(["production", "development", "", undefined])("refuses a %s build", (deployEnv) => {
    expect(gaussianSplatsAvailable({ DEV: false, VITE_DEPLOY_ENV: deployEnv })).toBe(false);
  });

  // Defence in depth: a preview build aliased to the product domain must not
  // lift the founder hold there.
  it.each(["venviewer.com", "www.venviewer.com", "VENVIEWER.COM", "venviewer.com."])(
    "refuses a preview build served on %s",
    (host) => {
      expect(gaussianSplatsAvailable({ DEV: false, VITE_DEPLOY_ENV: "preview", HOST: host })).toBe(false);
    },
  );

  it("refuses the product domain even to a development build", () => {
    expect(gaussianSplatsAvailable({ DEV: true, VITE_DEPLOY_ENV: "", HOST: "venviewer.com" })).toBe(false);
  });

  it("allows a preview build on its Vercel preview host", () => {
    expect(gaussianSplatsAvailable({ DEV: false, VITE_DEPLOY_ENV: "preview", HOST: "omnitwin-git-x-codemaker66.vercel.app" })).toBe(true);
  });

  it("allows local development on localhost", () => {
    expect(gaussianSplatsAvailable({ DEV: true, VITE_DEPLOY_ENV: "", HOST: "localhost" })).toBe(true);
  });

  it("does not mistake a lookalike host for the product domain", () => {
    expect(gaussianSplatsAvailable({ DEV: false, VITE_DEPLOY_ENV: "preview", HOST: "notvenviewer.com" })).toBe(true);
  });

  it("reads the page's own host when a caller gives none", () => {
    const happyDom = window.happyDOM as typeof window.happyDOM & Pick<HappyWindow["happyDOM"], "setURL">;
    const original = window.location.href;
    vi.stubEnv("DEV", true);
    try {
      expect(gaussianSplatsAvailable()).toBe(true);
      happyDom.setURL("https://venviewer.com/plan");
      expect(window.location.hostname).toBe("venviewer.com");
      expect(gaussianSplatsAvailable()).toBe(false);
      expect(gaussianSplatsAvailable({ DEV: true })).toBe(false);
    } finally {
      happyDom.setURL(original);
    }
  });
});
