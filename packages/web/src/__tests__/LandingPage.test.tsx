import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { findUnsupportedProposalClaim } from "@omnitwin/types";
import { LandingPage } from "../pages/LandingPage.js";
import {
  CAPACITY_DISCLOSURE,
  FOOTER_PHONE_HREF,
  RETURN_CTA_HREF,
  RETURN_CTA_LABEL,
  RITE_META_TITLE,
  ROOM_CHAPTERS,
  ROOM_INDEX_CARDS,
  THRESHOLD_LINE,
  enquiryMailtoHref,
} from "../pages/landing/rite-copy.js";

// ---------------------------------------------------------------------------
// LandingPage — The Rite. Render-contract tests for the 2026-07-01 redesign
// (docs/superpowers/specs/2026-07-01-landing-rite-redesign-design.md).
//
// happy-dom has no IntersectionObserver, so useSeen latches immediately and
// the full document renders "seen" — which is exactly the SEO/reader-mode
// guarantee the design makes: all content in the DOM at first paint.
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function mount(): void {
  render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

describe("LandingPage — the threshold", () => {
  it("opens with the threshold line as the page's single h1", () => {
    mount();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe(THRESHOLD_LINE);
  });

  it("sets the document title to the rite's meta title", () => {
    mount();
    expect(document.title).toBe(RITE_META_TITLE);
  });

  it("offers the Enter control", () => {
    mount();
    expect(screen.getByRole("button", { name: /Enter/ })).toBeTruthy();
  });
});

describe("LandingPage — the enquiry funnel has a real destination", () => {
  it("gives the footer the venue's published phone and email", () => {
    mount();
    expect(
      document.querySelector(`a[href="${FOOTER_PHONE_HREF}"]`),
    ).toBeTruthy();
    expect(
      document.querySelector(`.rite-footer-contact a[href^="mailto:"]`),
    ).toBeTruthy();
  });

  it("routes every index Enquire link to a room-contextual mailto", () => {
    mount();
    for (const card of ROOM_INDEX_CARDS) {
      const anchor = document.querySelector(
        `a[aria-label="Enquire about ${card.name}"]`,
      );
      expect(anchor?.getAttribute("href")).toBe(enquiryMailtoHref(card.name));
    }
  });
});

describe("LandingPage — document integrity", () => {
  it("has no dead in-page anchors — every href=\"#id\" resolves", () => {
    mount();
    const hashAnchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'),
    );
    expect(hashAnchors.length).toBeGreaterThan(0);
    const deadTargets = hashAnchors
      .map((anchor) => anchor.getAttribute("href") ?? "")
      .filter((href) => href.length > 1)
      .filter((href) => document.getElementById(href.slice(1)) === null);
    expect(deadTargets).toEqual([]);
  });

  it("keeps the #contact anchor the showcase pages deep-link to", () => {
    mount();
    expect(document.getElementById("contact")).not.toBeNull();
  });

  it("renders no unsupported certainty claims anywhere on the page", () => {
    mount();
    const text = document.body.textContent ?? "";
    expect(findUnsupportedProposalClaim(text)).toBeNull();
  });

  it("credits the platform", () => {
    mount();
    expect(screen.getByText(/Powered by Venviewer/)).toBeTruthy();
  });
});

describe("LandingPage — the four chapters and the index", () => {
  it("renders every chapter with its line and showcase link", () => {
    mount();
    for (const chapter of ROOM_CHAPTERS) {
      expect(screen.getByRole("heading", { name: chapter.name })).toBeTruthy();
      expect(screen.getByText(chapter.line)).toBeTruthy();
    }
  });

  it("pairs the capacities with the SAFE disclosure in every chapter", () => {
    mount();
    expect(screen.getAllByText(CAPACITY_DISCLOSURE)).toHaveLength(
      ROOM_CHAPTERS.length,
    );
  });

  it("lists all eight rooms in the index, none orphaned", () => {
    mount();
    for (const card of ROOM_INDEX_CARDS) {
      expect(
        screen.getByRole("link", { name: `Enquire about ${card.name}` }),
      ).toBeTruthy();
    }
    const exploreLinks = ROOM_INDEX_CARDS.filter((c) => c.routeHref !== null);
    for (const card of exploreLinks) {
      expect(
        screen.getByRole("link", { name: `Explore ${card.name}` }),
      ).toBeTruthy();
    }
  });
});

describe("LandingPage — the return", () => {
  it("hands the will back with one gold CTA into the planner", () => {
    mount();
    const cta = screen.getByRole("link", { name: new RegExp(RETURN_CTA_LABEL) });
    expect(cta.getAttribute("href")).toBe(RETURN_CTA_HREF);
  });

  it("keeps the legal record reachable", () => {
    mount();
    expect(screen.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/legal/terms");
    expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/legal/privacy");
    expect(screen.getByRole("link", { name: "Accessibility" }).getAttribute("href")).toBe("/legal/accessibility");
  });
});
