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
import { FRESH_ENQUIRY_CRAFT_PREFIX, FRESH_TOUR_ENABLED } from "../fresh/fresh-copy.js";

// globals: false in vitest.config, so auto-cleanup is not installed.
afterEach(() => {
  cleanup();
  // The composer reads window.location.search directly (it must work from both
  // pages that render it, without a router hook), so a test that sets a query
  // has to put the document URL back or it leaks into the next one.
  window.history.replaceState({}, "", "/");
});

function mount(): void {
  render(<MemoryRouter initialEntries={["/"]}><RoomsHomePage /></MemoryRouter>);
}

describe("RoomsHomePage", () => {
  // T-616: Dashboard, Diary and Hallkeeper each bounced an anonymous visitor
  // into a login wall. They are gone from the public nav; planning, the
  // composer and Log in (which takes staff to their workspace) remain.
  it("offers planning, the enquiry composer and login, and no staff route", () => {
    mount();
    const nav = within(screen.getByRole("navigation", { name: "Primary" }));
    for (const [name, destination] of [
      ["Plan an event", "/plan?space=grand-hall"],
      ["Ask about a date", "#enquire"],
      ["Log in", "/login"],
    ]) {
      expect(nav.getByRole("link", { name }).getAttribute("href")).toBe(destination);
    }
    for (const staff of ["Dashboard", "Diary", "Hallkeeper"]) {
      expect(nav.queryByRole("link", { name: staff }), staff).toBeNull();
    }
    expect(document.querySelector('a[href="/dashboard"], a[href="/diary"], a[href^="/hallkeeper"]')).toBeNull();
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

  // Blake, 26 September 2026: one home page carries the Grand Hall
  // photographs, capacities by layout, wedding prices and the enquiry form.
  it("carries the capacities by layout, the wedding rates and the composer", () => {
    mount();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent))
      .toEqual(["Room", "Theatre", "Classroom", "Dinner", "Reception"]);
    const grandHall = within(table).getByRole("row", { name: /The Grand Hall/u });
    expect(within(grandHall).getAllByRole("cell").map((cell) => cell.textContent))
      .toEqual(["Theatre250", "Classroom80", "Dinner180", "Reception250"]);
    // The last row is a range across the rooms, never one number for the building.
    const range = within(table).getByRole("row", { name: /Across the rooms/u });
    expect(within(range).getAllByRole("cell").map((cell) => cell.textContent))
      .toEqual(["Theatre40 to 250", "Classroom18 to 80", "Dinner40 to 180", "Reception40 to 250"]);
    expect(screen.getByRole("heading", { name: "Wedding hire" })).toBeTruthy();
    expect(document.body.textContent).toMatch(/Wedding Breakfast and Evening Reception/u);
    expect(document.body.textContent).toMatch(/£2,900/u);
    expect(document.querySelector("section#enquire")?.contains(screen.getByTestId("enquiry-composer"))).toBe(true);
  });

  it("names each figure's layout only for the phone layout, hidden from assistive technology", () => {
    mount();
    const labels = [...document.querySelectorAll(".rooms__capacityLabel")];
    expect(labels.length).toBe(7 * 4);
    for (const label of labels) expect(label.getAttribute("aria-hidden")).toBe("true");
  });

  // T-616: the craft quiz's "Request an introduction" was a mailto whose BODY
  // named the Craft. It now lands here as ?craft=, and the message must carry
  // it — otherwise the replacement silently loses the one fact that made the
  // request an introduction rather than a wedding enquiry.
  it("carries a Craft from the quiz into the message it will send", () => {
    window.history.replaceState({}, "", "/?craft=THE%20BONNETMAKERS%20%26%20DYERS#enquire");
    mount();
    const draft = document.querySelector(".fr-enq-body")?.textContent ?? "";
    expect(draft).toContain(`${FRESH_ENQUIRY_CRAFT_PREFIX} The Bonnetmakers & Dyers.`);
  });

  it("takes no craft from a visitor who did not come from the quiz", () => {
    mount();
    const draft = document.querySelector(".fr-enq-body")?.textContent ?? "";
    expect(draft).not.toContain(FRESH_ENQUIRY_CRAFT_PREFIX);
  });

  it("ignores a craft parameter that is not a craft name", () => {
    window.history.replaceState({}, "", "/?craft=Call%20me%20on%200800%20000%20000#enquire");
    mount();
    const draft = document.querySelector(".fr-enq-body")?.textContent ?? "";
    expect(draft).not.toContain(FRESH_ENQUIRY_CRAFT_PREFIX);
    expect(draft).not.toContain("0800");
  });

  it("leads from the footer to the tour, the composer on this page and the legal pages, never to a dead anchor", () => {
    mount();
    const footer = within(screen.getByRole("navigation", { name: "More" }));
    expect(footer.getByRole("link", { name: "About the venue" }).getAttribute("href")).toBe("/fresh");
    expect(footer.getByRole("link", { name: "Ask about a date" }).getAttribute("href")).toBe("#enquire");
    // The one switch /fresh already obeys for its own tour door.
    expect(footer.queryByRole("link", { name: "Virtual tour · Work in progress" })?.getAttribute("href") ?? null)
      .toBe(FRESH_TOUR_ENABLED ? "/venues/trades-hall/twin" : null);
    expect(screen.queryByRole("link", { name: /Walkable tour/i })).toBeNull();
    const legal = within(screen.getByRole("navigation", { name: "Legal" }));
    expect(legal.getAllByRole("link").map((link) => link.getAttribute("href")))
      .toEqual(["/privacy", "/terms", "/accessibility"]);
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
      expect(card.textContent, slug).toMatch(/photographs only for now/iu);
    }
    expect(screen.getByTestId("room-card-saloon").getAttribute("href")).toBe("/room/saloon");
  });

  // T-616: a closed room still offers no door, and a room whose scan did not
  // measure cleanly still prints no dimensions. Only the words a visitor reads
  // have changed: no more of our alignment vocabulary on their page.
  it("says a closed room is not open to walk, in a visitor's words", () => {
    mount();
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/alignment/iu);
    expect(body).not.toMatch(/under review/iu);
    for (const slug of roomsWithSplatBundles()) {
      const card = screen.queryByTestId(`room-card-${slug}`);
      if (card === null) continue;
      if (!isRoomWalkable(slug)) {
        expect(card.textContent, slug).toMatch(/photographs only for now/iu);
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

  it("withholds dimensions for every room whose scan did not measure cleanly", () => {
    mount();
    const unmeasured = roomsWithSplatBundles()
      .filter((slug) => roomSplatBundle(slug)?.alignmentConfidence !== "confident");
    expect(unmeasured.length).toBeGreaterThan(0);
    for (const slug of unmeasured) {
      const card = screen.queryByTestId(`room-card-${slug}`);
      if (card === null) continue;
      expect(/ m(\s|·|$)/u.test(card.textContent ?? ""), slug).toBe(false);
    }
  });

  it("makes no claim the scans cannot support", () => {
    mount();
    const body = document.body.textContent ?? "";
    // Dimensions remain estimates; the page makes no survey claim.
    expect(body).not.toMatch(/survey-grade|photoreal|production ready|certified|guaranteed/iu);
    expect(body).toMatch(/Scan dimensions are estimates/iu);
    // The capacities carry the venue's own provenance line.
    expect(body).toMatch(/a planning guide/iu);
  });

  it("keeps the photography page reachable", () => {
    mount();
    const links = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toContain("/fresh");
  });
});
