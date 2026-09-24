import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ROOM_CARD_SIZES, RoomsHomePage } from "../RoomsHomePage.js";
import {
  roomSplatBundle,
  roomsWithSplatBundles,
} from "../../data/room-splat-bundles.js";
import { isRoomWalkable } from "../../data/room-walk-exposure.js";

// globals: false in vitest.config, so auto-cleanup is not installed.
afterEach(() => { cleanup(); });

function mount(): void {
  render(<MemoryRouter initialEntries={["/"]}><RoomsHomePage /></MemoryRouter>);
}

describe("RoomsHomePage", () => {
  it("exposes planning, login and each workspace from the public primary navigation", () => {
    mount();
    const nav = within(screen.getByRole("navigation", { name: "Primary" }));
    for (const [name, destination] of [
      ["Plan an event", "/plan?space=grand-hall"],
      ["Dashboard", "/dashboard"],
      ["Diary", "/diary"],
      ["Hallkeeper", "/hallkeeper/today"],
      ["Log in", "/login"],
    ]) {
      expect(nav.getByRole("link", { name }).getAttribute("href")).toBe(destination);
    }
  });

  it("fetches a display-sized hero first, exactly as index.html preloads it", () => {
    mount();
    const heroImage = screen.getByRole("region", { name: "Grand Hall" }).querySelector("img");
    if (heroImage === null) throw new Error("Missing hero image");
    const srcSet = heroImage.getAttribute("srcset") ?? "";
    expect(srcSet).toMatch(/grand-hall-room-480\.webp 480w/u);
    expect(heroImage.getAttribute("sizes")).toBe("100vw");
    expect(heroImage.getAttribute("fetchpriority")).toBe("high");

    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('if (location.pathname === "/")');
    expect(html).toContain(`heroPreload.setAttribute("imagesrcset", "${srcSet}")`);
    expect(html).toContain('heroPreload.setAttribute("imagesizes", "100vw")');
  });

  it("serves the rail's photographs from display-sized sources", () => {
    mount();
    const posters = screen.getAllByRole("img").filter((image) => image.classList.contains("rooms__poster"));
    expect(posters.length).toBeGreaterThan(0);
    for (const poster of posters) {
      expect(poster.getAttribute("srcset"), poster.getAttribute("alt") ?? "").toMatch(/\.webp 480w/u);
      expect(poster.getAttribute("sizes")).toBe(ROOM_CARD_SIZES);
    }
  });

  it("offers furniture planning alongside the Grand Hall walkthrough", () => {
    mount();
    const hero = within(screen.getByRole("region", { name: "Grand Hall" }));
    expect(hero.getByRole("link", { name: "Plan Grand Hall" }).getAttribute("href"))
      .toBe("/plan?space=grand-hall");
    expect(hero.getByRole("link", { name: "Walk the room" }).getAttribute("href"))
      .toBe("/room/grand-hall");
  });

  it("leads from the footer to the whole-building twin and to the enquiry composer, never to a dead anchor", () => {
    mount();
    expect(screen.getByRole("link", { name: "Virtual tour · Work in progress" }).getAttribute("href"))
      .toBe("/venues/trades-hall/twin");
    expect(screen.getByRole("link", { name: /^Enquire/i }).getAttribute("href")).toBe("/fresh#enquire");
    expect(screen.queryByRole("link", { name: /Walkable tour/i })).toBeNull();
  });

  it("offers every captured room", () => {
    mount();
    // The hero is one room; the rail carries the rest.
    const cards = screen.getAllByTestId(/^room-card-/u);
    expect(cards.length).toBe(roomsWithSplatBundles().length - 1);
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  });

  it("sends each walkable room to its own walkthrough rather than streaming them here", () => {
    mount();
    // Eight rooms at once is about a gigabyte; the front door must only link.
    for (const slug of roomsWithSplatBundles()) {
      const card = screen.queryByTestId(`room-card-${slug}`);
      if (card === null) continue;
      if (isRoomWalkable(slug)) {
        expect(card.getAttribute("href"), slug).toBe(`/room/${slug}`);
      } else {
        expect(card.getAttribute("href"), slug).toBeNull();
        expect(card.querySelector("a"), slug).toBeNull();
      }
    }
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("closes the door on the three named rooms, by name", () => {
    mount();
    for (const slug of ["robert-adam-room", "north-gallery", "lady-convenors-room"]) {
      const card = screen.getByTestId(`room-card-${slug}`);
      expect(card.getAttribute("href"), slug).toBeNull();
      expect(card.textContent, slug).toMatch(/not yet walkable/iu);
    }
    expect(screen.getByTestId("room-card-saloon").getAttribute("href")).toBe("/room/saloon");
  });

  it("says a closed room is being aligned, and a review room that its dimensions are withheld", () => {
    mount();
    for (const slug of roomsWithSplatBundles()) {
      const card = screen.queryByTestId(`room-card-${slug}`);
      if (card === null) continue;
      const text = card.textContent ?? "";
      const bundle = roomSplatBundle(slug);
      if (!isRoomWalkable(slug)) {
        expect(text, slug).toMatch(/alignment in review/iu);
        expect(text, slug).toMatch(/not yet walkable/iu);
      } else if (bundle?.alignmentConfidence !== "confident") {
        expect(text, slug).toMatch(/dimensions under review/iu);
      }
    }
  });

  it("prints dimensions only for rooms whose scan measured cleanly", () => {
    mount();
    for (const slug of roomsWithSplatBundles()) {
      const card = screen.queryByTestId(`room-card-${slug}`);
      if (card === null) continue;
      const bundle = roomSplatBundle(slug);
      const text = card.textContent ?? "";
      const hasDimensions = / m(\s|·|$)/u.test(text);
      expect(hasDimensions).toBe(bundle?.alignmentConfidence === "confident" && isRoomWalkable(slug));
    }
  });

  it("keeps capture counts out of the room chooser", () => {
    mount();
    expect(document.body.textContent).not.toMatch(/splats/iu);
  });

  it("says so when a room's alignment is still being worked out", () => {
    mount();
    const underReview = roomsWithSplatBundles()
      .filter((slug) => roomSplatBundle(slug)?.alignmentConfidence !== "confident");
    expect(underReview.length).toBeGreaterThan(0);
    expect(screen.getAllByText(/alignment in review|dimensions under review/iu).length).toBeGreaterThan(0);
  });

  it("makes no claim the scans cannot support", () => {
    mount();
    const body = document.body.textContent ?? "";
    // Dimensions remain estimates; the page makes no survey claim.
    expect(body).not.toMatch(/survey-grade|photoreal|production ready|certified|guaranteed/iu);
    expect(body).toMatch(/Scan dimensions are estimates/iu);
  });

  it("keeps the photography page reachable", () => {
    mount();
    const links = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toContain("/fresh");
  });
});
