import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// The walk chunk carries three + Spark — far beyond jsdom. The page contract
// under test is the poster-first wiring, so the lazy module becomes a stub.
vi.mock("../FreshWalk.js", () => ({
  default: () => <div data-testid="fresh-walk-stub" />,
}));
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

describe("photography — newest set, never repeated", () => {
  it("uses each photograph exactly once across the page", () => {
    render(<FreshPage />);
    const sources = [...document.querySelectorAll("img")]
      .map((img) => img.getAttribute("src"))
      .filter((src): src is string => src !== null && src !== "");
    expect(new Set(sources).size).toBe(sources.length);
  });

  it("carries the Grand Hall's published figures on the page", () => {
    render(<FreshPage />);
    const caps = document.querySelector('[data-room-caps="grand-hall"]');
    const truth = TRADES_HALL_ROOM_CAPACITIES["grand-hall"];
    for (const value of Object.values(truth)) {
      expect(caps?.textContent).toContain(String(value));
    }
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

describe("responsive delivery — nobody downloads the originals", () => {
  it("every content photograph carries a ladder srcset and sizes", () => {
    render(<FreshPage />);
    const content = [...document.querySelectorAll("img")].filter((img) => {
      const src = img.getAttribute("src") ?? "";
      return src.includes("/venue/") || src.includes("facade-art");
    });
    expect(content.length).toBeGreaterThanOrEqual(5);
    for (const img of content) {
      const srcset = img.getAttribute("srcset") ?? "";
      expect(srcset, `missing srcset on ${img.getAttribute("src") ?? ""}`).toMatch(
        / \d+w/,
      );
      expect(img.getAttribute("sizes")).toBeTruthy();
    }
  });

  it("art-directs the hero to the portrait crop on narrow screens", () => {
    render(<FreshPage />);
    const source = document.querySelector(".fr-hero-frame picture source");
    expect(source?.getAttribute("media")).toBe("(max-width: 760px)");
    expect(source?.getAttribute("srcset")).toContain("trades-hall-exterior-portrait-");
  });
});

describe("the enquiry composer", () => {
  it("answers with the snuggest published room and updates as numbers change", () => {
    render(<FreshPage />);
    // Default draft: wedding for 100 — only the Grand Hall's 180 covers it.
    expect(screen.getByText(/The Grand Hall is the right scale/)).toBeTruthy();
    const guests = screen.getByLabelText("Guests");
    fireEvent.change(guests, { target: { value: "40" } });
    expect(screen.getByText(/The North Gallery holds exactly/)).toBeTruthy();
  });

  it("composes the visible email from the draft, openable via mailto", () => {
    render(<FreshPage />);
    expect(screen.getByText("Enquiry — Wedding for 100")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Conference" }));
    expect(screen.getByText("Enquiry — Conference for 100")).toBeTruthy();
    expect(document.querySelector('a.fr-cta[href^="mailto:"]')).toBeTruthy();
  });

  it("sends the top CTAs to the composer, not to a phone link", () => {
    render(<FreshPage />);
    const ctas = screen.getAllByRole("link", { name: "Ask about a date" });
    expect(ctas.length).toBeGreaterThanOrEqual(2);
    for (const cta of ctas) {
      expect(cta.getAttribute("href")).toBe("#enquire");
    }
  });
});

describe("the room dossiers", () => {
  it("opens a dossier whose drawn plan counts exactly the published number", () => {
    render(<FreshPage />);
    const openButtons = screen.getAllByRole("button", { name: "Open the room" });
    expect(openButtons).toHaveLength(FRESH_ROOMS.length);
    const first = openButtons[0];
    expect(first).toBeTruthy();
    if (first === undefined) return;
    fireEvent.click(first);
    const dialog = document.querySelector("dialog.fr-dossier");
    expect(dialog?.hasAttribute("open")).toBe(true);
    // Dinner is the default lens — the Grand Hall draws all 180 covers.
    expect(document.querySelectorAll(".fr-plan-dot")).toHaveLength(
      TRADES_HALL_ROOM_CAPACITIES["grand-hall"].dinner,
    );
    expect(document.querySelectorAll(".fr-plan-table")).toHaveLength(18);
    fireEvent.click(screen.getByRole("button", { name: "Theatre 250" }));
    expect(document.querySelectorAll(".fr-plan-dot")).toHaveLength(250);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.querySelector("dialog.fr-dossier")?.hasAttribute("open")).toBe(
      false,
    );
  });

  it("states the published dimensions for rooms that publish them", () => {
    render(<FreshPage />);
    const buttons = screen.getAllByRole("button", { name: "Open the room" });
    const first = buttons[0];
    if (first === undefined) return;
    fireEvent.click(first);
    expect(screen.getByText(/21 × 10 m · 7 m high/)).toBeTruthy();
    expect(screen.getByText(/a further 7 m under the dome/)).toBeTruthy();
  });
});

describe("walk the room — poster-first", () => {
  it("shows the rendered poster and pays nothing until invited", () => {
    render(<FreshPage />);
    const poster = screen.getByAltText(
      "The Reception Room as a captured scene, rendered by Venviewer — not a photograph",
    );
    expect(poster.getAttribute("src")).toContain("walk-poster");
    expect(screen.getByRole("button", { name: "Step in" })).toBeTruthy();
    expect(screen.queryByTestId("fresh-walk-stub")).toBeNull();
    expect(
      document.querySelector('[data-walk-state="poster"]'),
    ).toBeTruthy();
  });

  it("wakes into loading when WebGL is available", async () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({} as never);
    try {
      render(<FreshPage />);
      fireEvent.click(screen.getByRole("button", { name: "Step in" }));
      expect(document.querySelector('[data-walk-state="loading"]')).toBeTruthy();
      expect(await screen.findByTestId("fresh-walk-stub")).toBeTruthy();
    } finally {
      getContext.mockRestore();
    }
  });

  it("fails honestly when WebGL is unavailable", () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);
    try {
      render(<FreshPage />);
      fireEvent.click(screen.getByRole("button", { name: "Step in" }));
      expect(document.querySelector('[data-walk-state="failed"]')).toBeTruthy();
      expect(screen.queryByTestId("fresh-walk-stub")).toBeNull();
    } finally {
      getContext.mockRestore();
    }
  });
});

describe("the walkthrough — wired from the front door", () => {
  it("offers the whole-building walkthrough from the hero and the walk section", () => {
    render(<FreshPage />);
    const tourLinks = [...document.querySelectorAll('a[href="/tour"]')];
    expect(tourLinks.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("link", { name: "Walk the building" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the walkthrough" })).toBeTruthy();
  });
});

describe("contact — real destinations", () => {
  it("offers phone, email, and a map link under their labels", () => {
    render(<FreshPage />);
    expect(document.querySelector('a[href^="tel:"]')).toBeTruthy();
    expect(document.querySelector('a[href^="mailto:"]')).toBeTruthy();
    expect(document.querySelector('a[href*="maps.google.com"]')).toBeTruthy();
    expect(screen.getByText("Telephone")).toBeTruthy();
    expect(screen.getByText("Email")).toBeTruthy();
    expect(screen.getByText("Visit")).toBeTruthy();
  });
});

describe("theme — the compact cycle control", () => {
  it("cycles auto → light → dark → auto and persists accordingly", () => {
    render(<FreshPage />);
    fireEvent.click(screen.getByRole("button", { name: "Theme: Auto" }));
    expect(window.localStorage.getItem("fresh-theme.v1")).toBe("light");
    fireEvent.click(screen.getByRole("button", { name: "Theme: Light" }));
    expect(window.localStorage.getItem("fresh-theme.v1")).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "Theme: Dark" }));
    expect(screen.getByRole("button", { name: "Theme: Auto" })).toBeTruthy();
    expect(window.localStorage.getItem("fresh-theme.v1")).toBeNull();
  });
});

describe("claim safety", () => {
  it("every string passes the proposal claim guard", () => {
    for (const s of allFreshCopy()) {
      expect(findUnsupportedProposalClaim(s), `claim guard tripped on: ${s}`).toBeNull();
    }
  });
});
