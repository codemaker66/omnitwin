import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LandingPage } from "../pages/LandingPage.js";

afterEach(() => {
  cleanup();
});

function mount(): void {
  render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

describe("LandingPage — Grand Hall module", () => {
  it("renders the Grand Hall-first hero promise", () => {
    mount();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toMatch(/Design your event inside the real Grand Hall/);
    expect(screen.getByText(/Try a wedding, gala, or conference layout to scale/i)).toBeTruthy();
    expect(screen.getAllByText(/Powered by Venviewer/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders the proof chips without unsupported precision claims", () => {
    mount();
    expect(screen.getByText("To scale")).toBeTruthy();
    expect(screen.getAllByText("Grand Hall").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Draft layout")).toBeTruthy();
    expect(screen.getByText("Sent to Events Team")).toBeTruthy();
    expect(screen.queryByText(/to the centimetre/i)).toBeNull();
    expect(screen.queryByText(/events@tradeshall\.example/i)).toBeNull();
  });

  it("renders the animated planning sequence instead of static feature cards", () => {
    mount();
    expect(screen.getByText("Planrise preview")).toBeTruthy();
    expect(screen.getByText("Choose the mood")).toBeTruthy();
    expect(screen.getByText("Watch the room answer")).toBeTruthy();
    expect(screen.getByText("Step from plan into space")).toBeTruthy();
    expect(screen.getByText("Send a proper draft")).toBeTruthy();
    expect(screen.queryByText("Transparent costing")).toBeNull();
  });

  it("renders venue-specific preset and handoff signals without generic cards", () => {
    mount();
    expect(screen.getByText("3 venue-ready starts")).toBeTruthy();
    expect(screen.getByText("2D and 3D linked")).toBeTruthy();
    expect(screen.getByText("Ready for review")).toBeTruthy();
    expect(document.querySelector(".preset-grid")).toBeNull();
    expect(document.querySelector(".feat-grid")).toBeNull();
  });

  it("keeps the interactive planner preview and real Grand Hall media", () => {
    mount();
    expect(screen.getByLabelText(/Planner preview/i)).toBeTruthy();
    const img = screen.getByAltText(/Trades Hall Grand Hall dressed for an event/i);
    expect(img.getAttribute("src")).toBe("/rooms/Grand-Hall-scaled-opt.jpg");
  });
});

describe("LandingPage — CTAs + nav links", () => {
  it("nav and hero CTAs route to the Grand Hall planner", () => {
    mount();
    const grandHallLinks = screen.getAllByRole("link", { name: /Open.*Grand Hall/i });
    expect(grandHallLinks.length).toBeGreaterThanOrEqual(2);
    for (const link of grandHallLinks) {
      expect(link.getAttribute("href")).toBe("/plan?space=grand-hall");
    }
  });

  it("secondary View in 3D CTAs route to the planner", () => {
    mount();
    const view3dLinks = screen.getAllByRole("link", { name: /View in 3D/i });
    expect(view3dLinks.length).toBeGreaterThanOrEqual(1);
    for (const link of view3dLinks) {
      expect(link.getAttribute("href")).toBe("/plan?space=grand-hall");
    }
  });

  it("nav Sign in routes to /login", () => {
    mount();
    const link = screen.getByRole("link", { name: /Sign in/i });
    expect(link.getAttribute("href")).toBe("/login");
  });
});

describe("LandingPage — document metadata", () => {
  it("updates document.title to the Grand Hall copy", () => {
    mount();
    expect(document.title).toMatch(/Design your Grand Hall event/);
  });

  it("sets a meta description with the venue-planning value proposition", () => {
    mount();
    const meta = document.head.querySelector<HTMLMetaElement>('meta[name="description"]');
    expect(meta?.getAttribute("content") ?? "").toMatch(/Grand Hall/);
    expect(meta?.getAttribute("content") ?? "").toMatch(/events team/);
  });

  it("writes og:title and og:description for link previews", () => {
    mount();
    const ogTitle = document.head.querySelector<HTMLMetaElement>('meta[property="og:title"]');
    const ogDesc = document.head.querySelector<HTMLMetaElement>('meta[property="og:description"]');
    expect(ogTitle?.getAttribute("content") ?? "").toMatch(/Grand Hall/);
    expect(ogDesc?.getAttribute("content") ?? "").toMatch(/Trades Hall/);
  });
});

describe("LandingPage — accessibility", () => {
  it("uses a single <h1>", () => {
    mount();
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
  });

  it("every image has alt text", () => {
    mount();
    const imgs = Array.from(document.querySelectorAll("img"));
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      expect(img.getAttribute("alt")?.length ?? 0).toBeGreaterThan(4);
    }
  });

  it("has a footer landmark with Trades Hall context and Venviewer attribution", () => {
    mount();
    const footers = document.querySelectorAll("footer");
    expect(footers.length).toBe(1);
    const footer = footers[0] as HTMLElement;
    expect(within(footer).getByText(/85 Glassford Street/)).toBeTruthy();
    expect(within(footer).getByText(/Powered by Venviewer/)).toBeTruthy();
  });
});
