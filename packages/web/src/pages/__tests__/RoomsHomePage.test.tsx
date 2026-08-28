import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RoomsHomePage } from "../RoomsHomePage.js";
import { roomSplatBundle, roomsWithSplatBundles } from "../../data/room-splat-bundles.js";

// globals: false in vitest.config, so auto-cleanup is not installed.
afterEach(() => { cleanup(); });

function mount(): void {
  render(<MemoryRouter initialEntries={["/"]}><RoomsHomePage /></MemoryRouter>);
}

describe("RoomsHomePage", () => {
  it("offers every captured room", () => {
    mount();
    // The hero is one room; the rail carries the rest.
    const cards = screen.getAllByTestId(/^room-card-/u);
    expect(cards.length).toBe(roomsWithSplatBundles().length - 1);
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  });

  it("sends each room to its own walkthrough rather than streaming them here", () => {
    mount();
    // Eight rooms at once is about a gigabyte; the front door must only link.
    for (const slug of roomsWithSplatBundles()) {
      const link = screen.queryByTestId(`room-card-${slug}`);
      if (link === null) continue;
      expect(link.getAttribute("href")).toBe(`/room/${slug}`);
    }
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("prints dimensions only for rooms whose scan measured cleanly", () => {
    mount();
    for (const slug of roomsWithSplatBundles()) {
      const card = screen.queryByTestId(`room-card-${slug}`);
      if (card === null) continue;
      const bundle = roomSplatBundle(slug);
      const text = card.textContent ?? "";
      const hasDimensions = / m(\s|·|$)/u.test(text);
      expect(hasDimensions).toBe(bundle?.alignmentConfidence === "confident");
    }
  });

  it("always states the splat count, which is a count and always true", () => {
    mount();
    for (const slug of roomsWithSplatBundles()) {
      const card = screen.queryByTestId(`room-card-${slug}`);
      if (card === null) continue;
      expect(card.textContent).toMatch(/splats/u);
    }
  });

  it("says so when a room's alignment is still being worked out", () => {
    mount();
    const underReview = roomsWithSplatBundles()
      .filter((slug) => roomSplatBundle(slug)?.alignmentConfidence !== "confident");
    expect(underReview.length).toBeGreaterThan(0);
    expect(screen.getAllByText("Alignment in progress").length).toBeGreaterThan(0);
  });

  it("makes no claim the scans cannot support", () => {
    mount();
    const body = document.body.textContent ?? "";
    // "not a survey" is a disclaimer and welcome; the affirmative claims are not.
    expect(body).not.toMatch(/survey-grade|photoreal|production ready|certified|guaranteed/iu);
    expect(body).toMatch(/not a survey/iu);
  });

  it("keeps the photography page reachable", () => {
    mount();
    const links = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toContain("/fresh");
  });
});
