import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RoomsHomePage } from "../RoomsHomePage.js";
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
  // T-616 gate line 2: Dashboard, Diary and Hallkeeper each bounced an
  // anonymous visitor into a Clerk login wall. They are gone from the public
  // nav; planning, the composer and Log in are what remains.
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
  });

  it("leads the hero with the venue's photograph, at high fetch priority", () => {
    mount();
    const hero = within(screen.getByRole("region", { name: "The Grand Hall" }));
    const photo = hero.getByRole("img");
    // Gate line 6: the largest-contentful paint of the site, declared as such.
    expect(photo.getAttribute("fetchpriority")).toBe("high");
    expect(photo.getAttribute("srcset")).toContain("/images/rooms/ladder/grand-hall-480.webp");
    expect(hero.getByRole("link", { name: "Ask about a date" }).getAttribute("href"))
      .toBe("#enquire");
    expect(hero.getByRole("link", { name: "Walk the Grand Hall" }).getAttribute("href"))
      .toBe("/room/grand-hall");
  });

  // Gate line 1: /fresh's half of the merge now lives here too.
  it("carries the capacities, the wedding rates and the composer", () => {
    mount();
    expect(screen.getByRole("table")).toBeTruthy();
    // Envelopes, never one number: the house row spans smallest to largest.
    expect(document.body.textContent).toMatch(/40 to 250/u);
    expect(document.body.textContent).toMatch(/Wedding Breakfast and Evening Reception/u);
    expect(screen.getByTestId("enquiry-composer")).toBeTruthy();
  });

  // T-616 / gate line 4: the craft quiz's "Request an introduction" was a
  // mailto whose BODY named the Craft. It now lands here as ?craft=, and the
  // message must carry it — otherwise the replacement silently loses the one
  // fact that made the request an introduction rather than a wedding enquiry.
  it("carries a Craft from the quiz into the message it will send", () => {
    window.history.replaceState({}, "", "/?craft=The%20Hammermen#enquire");
    mount();
    const draft = document.querySelector(".fr-enq-body")?.textContent ?? "";
    expect(draft).toContain("The Hammermen");
    expect(draft).toContain(FRESH_ENQUIRY_CRAFT_PREFIX);
  });

  it("takes no craft from a visitor who did not come from the quiz", () => {
    mount();
    const draft = document.querySelector(".fr-enq-body")?.textContent ?? "";
    expect(draft).not.toContain(FRESH_ENQUIRY_CRAFT_PREFIX);
  });

  it("offers no door onto the unpublished twin, and reaches the composer on this page", () => {
    mount();
    // FRESH_TOUR_ENABLED is false while the twin bundle is off the asset base.
    // The missing manifest comes back as index.html with a 200, so the failure
    // only surfaces when the HTML is parsed as JSON — the exact shape of the
    // bug that left two live CTAs pointing at a door that opened onto nothing.
    // /fresh already hides its tour door; the front door is not the exception.
    expect(FRESH_TOUR_ENABLED).toBe(false);
    expect(screen.queryByRole("link", { name: /Walk the whole building/i })).toBeNull();
    // The composer is on this page now, so the footer no longer sends a
    // visitor to a robots-disallowed sibling to find the form.
    const footer = within(screen.getByRole("navigation", { name: "More" }));
    expect(footer.getByRole("link", { name: "Ask about a date" }).getAttribute("href"))
      .toBe("#enquire");
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
      expect(card.textContent, slug).toMatch(/photographs only for now/iu);
    }
    expect(screen.getByTestId("room-card-saloon").getAttribute("href")).toBe("/room/saloon");
  });

  // T-616 gate line 3: a closed room still offers no door, and a room whose
  // scan did not measure cleanly still prints no dimensions. Only the words a
  // visitor reads have changed.
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
    const underReview = roomsWithSplatBundles()
      .filter((slug) => roomSplatBundle(slug)?.alignmentConfidence !== "confident");
    expect(underReview.length).toBeGreaterThan(0);
    for (const slug of underReview) {
      const card = screen.queryByTestId(`room-card-${slug}`);
      if (card === null) continue;
      expect(/ m(\s|\u00b7|$)/u.test(card.textContent ?? ""), slug).toBe(false);
    }
  });

  it("makes no claim the scans cannot support", () => {
    mount();
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/survey-grade|photoreal|production ready|certified|guaranteed/iu);
    // The capacities carry the venue's own provenance line instead.
    expect(body).toMatch(/a planning guide/iu);
  });

  it("keeps the photography page reachable", () => {
    mount();
    const links = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toContain("/fresh");
  });
});
