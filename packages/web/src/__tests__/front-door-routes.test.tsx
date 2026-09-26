import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";

// ---------------------------------------------------------------------------
// The public addresses Blake settled on 26 September 2026 (T-616), driven
// through the application's own route table:
//   - the older home page designs leave public addresses (their code stays),
//     and every one of their old links lands on the one front door;
//   - a wrong or expired link meets a designed page that says so, instead of
//     silently becoming the homepage.
// ---------------------------------------------------------------------------

// The first render transforms each lazy page's module graph on demand, which
// takes longer than Testing Library's one-second default on a cold run.
const FIRST_RENDER = { timeout: 15_000 } as const;

let routes: RouteObject[];
beforeAll(async () => {
  const { router } = await import("../router.js");
  routes = router.routes;
  router.dispose();
});
afterEach(() => { cleanup(); });

describe("the retired home pages", () => {
  it.each([
    "/landing",
    "/welcome",
    "/living-hall",
    "/editor",
    "/venues/trades-hall/rooms/reception-room",
    "/venues/trades-hall/rooms/not-a-room",
  ])("send %s to the front door", async (url) => {
    const router = createMemoryRouter(routes, { initialEntries: [url] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("heading", { name: "Grand Hall", level: 1 }, FIRST_RENDER)).toBeTruthy();
    expect(router.state.location.pathname).toBe("/");
    expect(screen.getByTestId("enquiry-composer")).toBeTruthy();
    router.dispose();
  });
});

describe("a link that goes nowhere", () => {
  it("says so, and offers the composer, the front door and the hall's telephone", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/an-old-link-that-has-moved"] });
    render(<RouterProvider router={router} />);
    const page = await screen.findByTestId("not-found", {}, FIRST_RENDER);
    expect(within(page).getByRole("heading", { level: 1, name: "That link has expired or moved" })).toBeTruthy();
    expect(within(page).getByRole("link", { name: "Ask about a date" }).getAttribute("href")).toBe("/#enquire");
    expect(within(page).getByRole("link", { name: "Go to the front door" }).getAttribute("href")).toBe("/");
    expect(within(page).getByRole("link", { name: "0141 552 2418" }).getAttribute("href")).toBe("tel:+441415522418");
    // The address stays what the visitor typed: the page answers it.
    expect(router.state.location.pathname).toBe("/an-old-link-that-has-moved");
    expect(document.title).toBe("Page not found — Trades Hall of Glasgow");
    router.dispose();
  });

  it("asks search engines not to index it, and only while it is showing", async () => {
    const robots = (): string | null => document.head.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null;
    const router = createMemoryRouter(routes, { initialEntries: ["/an-old-link-that-has-moved"] });
    render(<RouterProvider router={router} />);
    await screen.findByTestId("not-found", {}, FIRST_RENDER);
    expect(robots()).toBe("noindex");
    expect(document.head.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
    await act(async () => { await router.navigate("/"); });
    expect(await screen.findByRole("heading", { name: "Grand Hall", level: 1 }, FIRST_RENDER)).toBeTruthy();
    expect(robots()).toBeNull();
    router.dispose();
  });
});
