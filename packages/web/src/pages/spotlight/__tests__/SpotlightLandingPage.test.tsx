import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({ reducedMotion: false }));
vi.mock("../../landing/useReducedMotion.js", () => ({
  useReducedMotion: () => mocks.reducedMotion,
}));

import { SpotlightLandingPage } from "../SpotlightLandingPage.js";
import {
  SPOTLIGHT_BASE_ALT,
  SPOTLIGHT_CTA_HREF,
  SPOTLIGHT_CTA_LABEL,
  SPOTLIGHT_HEADLINE_ITALIC,
  SPOTLIGHT_HEADLINE_ROMAN,
  SPOTLIGHT_META_TITLE,
  SPOTLIGHT_NAV_LINKS,
  SPOTLIGHT_SIGN_IN_HREF,
  SPOTLIGHT_SIGN_IN_LABEL,
} from "../spotlight-copy.js";

// ---------------------------------------------------------------------------
// SpotlightLandingPage — /welcome render contract. The reveal mechanic itself
// is CSS (mask reading --light-x/--light-y from useCursorLight), so the DOM
// contract is: both image layers present, the decorative one hidden from AT,
// and every advertised action a real link.
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  mocks.reducedMotion = false;
});

function mount(): void {
  render(
    <MemoryRouter initialEntries={["/welcome"]}>
      <SpotlightLandingPage />
    </MemoryRouter>,
  );
}

describe("SpotlightLandingPage — the hero", () => {
  it("renders both headline lines inside a single h1", () => {
    mount();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe(
      `${SPOTLIGHT_HEADLINE_ITALIC}${SPOTLIGHT_HEADLINE_ROMAN}`,
    );
  });

  it("sets the document title", () => {
    mount();
    expect(document.title).toBe(SPOTLIGHT_META_TITLE);
  });

  it("names the base image for assistive tech and hides the reveal twin", () => {
    mount();
    expect(screen.getByRole("img", { name: SPOTLIGHT_BASE_ALT })).toBeTruthy();
    const reveal = document.querySelector(".sp-reveal");
    expect(reveal?.getAttribute("aria-hidden")).toBe("true");
  });

  it("routes the CTA into the planner", () => {
    mount();
    const cta = screen.getByRole("link", { name: new RegExp(SPOTLIGHT_CTA_LABEL) });
    expect(cta.getAttribute("href")).toBe(SPOTLIGHT_CTA_HREF);
  });
});

describe("SpotlightLandingPage — the carried light", () => {
  // Regression: with prefers-reduced-motion on (e.g. Windows "animation
  // effects" off), the reveal froze entirely — the light must still follow
  // the pointer, just directly instead of sprung. Direct mode writes the
  // vars synchronously in the pointermove handler, so this is deterministic.
  it("follows the pointer under reduced motion (direct, unsprung)", () => {
    mocks.reducedMotion = true;
    mount();
    const hero = document.querySelector<HTMLElement>(".sp-hero");
    expect(hero).toBeTruthy();
    fireEvent.pointerMove(window, { clientX: 320, clientY: 640 });
    expect(hero?.style.getPropertyValue("--light-x")).toBe("320px");
    expect(hero?.style.getPropertyValue("--light-y")).toBe("640px");
    expect(hero?.style.getPropertyValue("--light-on")).toBe("1");
  });

  it("keeps the entrance-static class under reduced motion", () => {
    mocks.reducedMotion = true;
    mount();
    expect(document.querySelector(".sp-hero.is-static")).toBeTruthy();
  });
});

describe("SpotlightLandingPage — navigation", () => {
  it("renders every nav link with its destination", () => {
    mount();
    for (const link of SPOTLIGHT_NAV_LINKS) {
      const anchors = screen.getAllByRole("link", { name: link.label });
      expect(anchors.length).toBeGreaterThanOrEqual(1);
      expect(anchors[0]?.getAttribute("href")).toBe(link.href);
    }
    const signIn = screen.getAllByRole("link", { name: SPOTLIGHT_SIGN_IN_LABEL });
    expect(signIn[0]?.getAttribute("href")).toBe(SPOTLIGHT_SIGN_IN_HREF);
  });

  it("marks exactly one pill item as the current page", () => {
    mount();
    const current = document.querySelectorAll('.sp-nav-pill [aria-current="page"]');
    expect(current).toHaveLength(1);
  });

  it("toggles the mobile menu with an accessible expanded state", () => {
    mount();
    const button = screen.getByRole("button", { name: /Menu/i });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".sp-menu.is-open")).toBeTruthy();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes the menu on Escape and returns focus to the trigger", () => {
    mount();
    const button = screen.getByRole("button", { name: /Menu/i });
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });
});
