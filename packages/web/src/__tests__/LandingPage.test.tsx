import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LandingPage } from "../pages/LandingPage.js";

// ---------------------------------------------------------------------------
// LandingPage — smoke coverage that pins the independent, embed-ready
// contract: every marketing claim and CTA survives a render, the four
// rooms are all present with their real images, and the nav links point
// at the correct internal routes (/editor, /login).
// ---------------------------------------------------------------------------

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

describe("LandingPage — copy + structure", () => {
  it("renders the hero headline", () => {
    mount();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toMatch(/See your event.+before you book it/);
  });

  it("renders the trust row with 'Free to plan', '4 rooms', and 'Quote in 24h'", () => {
    mount();
    expect(screen.getByText(/Free to plan/i)).toBeTruthy();
    expect(screen.getByText(/4 rooms, 1–400 guests/i)).toBeTruthy();
    expect(screen.getByText(/Quote in 24h/i)).toBeTruthy();
  });

  it("renders the four-step 'How it works' section", () => {
    mount();
    expect(screen.getByText("Choose your room")).toBeTruthy();
    expect(screen.getByText("Design the layout")).toBeTruthy();
    expect(screen.getByText("Validate & adjust")).toBeTruthy();
    expect(screen.getByText("Get a quote")).toBeTruthy();
  });

  it("renders the six feature cards", () => {
    mount();
    const features = [
      "To-scale floor plans",
      "Instant layout swaps",
      "Capacity & safety checks",
      "Transparent costing",
      "Save & share drafts",
      "Hand off to our team",
    ];
    for (const f of features) {
      expect(screen.getByText(f)).toBeTruthy();
    }
  });

  it("renders the events-team pull quote", () => {
    mount();
    expect(screen.getByText(/six PDFs back and forth/)).toBeTruthy();
    expect(screen.getByText(/Fiona R./)).toBeTruthy();
  });

  it("renders the Trades Hall address in the footer", () => {
    mount();
    expect(screen.getByText(/85 Glassford Street/)).toBeTruthy();
  });
});

describe("LandingPage — rooms gallery", () => {
  it("renders all four rooms with the real photos", () => {
    mount();
    const names = ["The Grand Hall", "The Saloon", "Robert Adam Room", "Reception Room"];
    for (const name of names) {
      expect(screen.getByText(name)).toBeTruthy();
    }
    const expectedPaths = [
      "/rooms/Grand-Hall-scaled-opt.jpg",
      "/rooms/saloon_TH_use.png",
      "/rooms/robert-adam-wedding-opt.jpg",
      "/rooms/reception-wedding-opt.jpg",
    ];
    for (const expectedPath of expectedPaths) {
      const img = document.querySelector<HTMLImageElement>(`img[src="${expectedPath}"]`);
      expect(img).not.toBeNull();
      expect(img?.alt.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("flags the Grand Hall as 'Most booked'", () => {
    mount();
    expect(screen.getByText("Most booked")).toBeTruthy();
  });
});

describe("LandingPage — CTAs + nav links", () => {
  it("nav 'Open planner' routes to /editor", () => {
    mount();
    const openPlanner = screen.getAllByRole("link", { name: /Open planner/i })[0];
    expect(openPlanner).toBeTruthy();
    expect(openPlanner?.getAttribute("href")).toBe("/editor");
  });

  it("nav 'Sign in' routes to /login", () => {
    mount();
    const link = screen.getByRole("link", { name: /Sign in/i });
    expect(link.getAttribute("href")).toBe("/login");
  });

  it("'Choose a room' hero CTA scrolls to #rooms", () => {
    mount();
    // "Choose a room" appears as the hero CTA AND as a footer link; we
    // care that the hero CTA (first match) scrolls to #rooms.
    const ctas = screen.getAllByRole("link", { name: /Choose a room/i });
    expect(ctas.length).toBeGreaterThanOrEqual(1);
    expect(ctas[0]?.getAttribute("href")).toBe("#rooms");
  });

  it("'Open the planner' rooms-CTA + final CTA both route to /editor", () => {
    mount();
    // Matches: "Open the planner with an empty room →" (rooms section),
    // "Open the planner" (final CTA), and the footer column link "Open planner".
    // Filter to the two main-body CTAs by asserting each href is /editor or #contact.
    const plannerCtas = screen.getAllByRole("link", { name: /Open the planner/i });
    const editorCtas = plannerCtas.filter((el) => el.getAttribute("href") === "/editor");
    expect(editorCtas.length).toBeGreaterThanOrEqual(2);
  });
});

describe("LandingPage — document metadata", () => {
  it("updates document.title to the heritage copy", () => {
    mount();
    expect(document.title).toMatch(/Plan your event.+Trades Hall Glasgow/);
  });

  it("sets a meta description with the value proposition", () => {
    mount();
    const meta = document.head.querySelector<HTMLMetaElement>('meta[name="description"]');
    expect(meta?.getAttribute("content") ?? "").toMatch(/Trades Hall Glasgow/);
    expect(meta?.getAttribute("content") ?? "").toMatch(/24 hours/);
  });

  it("writes og:title and og:description for link previews", () => {
    mount();
    const ogTitle = document.head.querySelector<HTMLMetaElement>('meta[property="og:title"]');
    const ogDesc = document.head.querySelector<HTMLMetaElement>('meta[property="og:description"]');
    expect(ogTitle?.getAttribute("content") ?? "").toMatch(/Plan your event/);
    expect(ogDesc?.getAttribute("content") ?? "").toMatch(/Trades Hall/);
  });
});

describe("LandingPage — accessibility", () => {
  it("uses a single <h1>", () => {
    mount();
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
  });

  it("every room card image has alt text", () => {
    mount();
    const imgs = Array.from(document.querySelectorAll("img"));
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      expect(img.getAttribute("alt")?.length ?? 0).toBeGreaterThan(4);
    }
  });

  it("has a footer landmark containing contact info", () => {
    mount();
    const footers = document.querySelectorAll("footer");
    expect(footers.length).toBe(1);
    expect(within(footers[0] as HTMLElement).getByText(/85 Glassford Street/)).toBeTruthy();
  });
});
