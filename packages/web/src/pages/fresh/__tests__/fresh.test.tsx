import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { findUnsupportedProposalClaim } from "@omnitwin/types";
import { FreshPage } from "../FreshPage.js";
import { FRESH_ROOMS, allFreshCopy } from "../fresh-copy.js";
import { HALL_LIT_YEARS } from "../../landing/rite-copy.js";
import {
  TRADES_HALL_ROOM_CAPACITIES,
  TRADES_HALL_WEDDING_PRICING,
} from "../../../lib/trades-hall-venue-truth.js";

// ---------------------------------------------------------------------------
// /fresh — pictures-only prototype. Contract: derived years in the headline
// (never hand-typed), venue-truth capacities per photographed room, real
// rates, real contact, theme toggle with honest pressed state, and every
// string through the claim guard.
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("the hero", () => {
  it("derives its years from the calendar, never a fixture", () => {
    render(<FreshPage />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toContain(String(HALL_LIT_YEARS));
  });

  it("has exactly one h1 and a skip link first", () => {
    render(<FreshPage />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const first = document.querySelector("a, button");
    expect(first?.getAttribute("href")).toBe("#rooms");
  });
});

describe("rooms — photographs with the venue's own figures", () => {
  it("renders all four photographed rooms with full published capacities", () => {
    render(<FreshPage />);
    for (const room of FRESH_ROOMS) {
      const caps = document.querySelector(`[data-room-caps="${room.slug}"]`);
      expect(caps, `missing capacities for ${room.slug}`).toBeTruthy();
      const truth = TRADES_HALL_ROOM_CAPACITIES[room.slug];
      for (const value of Object.values(truth)) {
        expect(caps?.textContent).toContain(String(value));
      }
      expect(screen.getByAltText(room.alt)).toBeTruthy();
    }
  });
});

describe("rates — every published rate, formatted", () => {
  it("renders one row per rate across both seasons", () => {
    render(<FreshPage />);
    const rows = document.querySelectorAll("[data-rate-row]");
    const expected = TRADES_HALL_WEDDING_PRICING.seasons.reduce(
      (n, s) => n + s.rates.length,
      0,
    );
    expect(rows).toHaveLength(expected);
    expect(screen.getByText("£2,800")).toBeTruthy();
    expect(screen.getByText("£650")).toBeTruthy();
  });
});

describe("theme — respects the system, remembers the choice", () => {
  it("defaults to auto and persists a manual override", () => {
    render(<FreshPage />);
    const dark = screen.getByRole("button", { name: "Dark" });
    expect(screen.getByRole("button", { name: "Auto" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(dark);
    expect(dark.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[data-theme="dark"]')).toBeTruthy();
    expect(window.localStorage.getItem("fresh-theme.v1")).toBe("dark");
  });
});

describe("contact — real destinations", () => {
  it("offers phone, email, and a map link", () => {
    render(<FreshPage />);
    expect(document.querySelector('a[href^="tel:"]')).toBeTruthy();
    expect(document.querySelector('a[href^="mailto:"]')).toBeTruthy();
    expect(document.querySelector('a[href*="maps.google.com"]')).toBeTruthy();
  });
});

describe("claim safety", () => {
  it("every string passes the proposal claim guard", () => {
    for (const s of allFreshCopy()) {
      expect(findUnsupportedProposalClaim(s), `claim guard tripped on: ${s}`).toBeNull();
    }
  });
});
