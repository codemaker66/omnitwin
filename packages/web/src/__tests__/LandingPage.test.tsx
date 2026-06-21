import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { findUnsupportedProposalClaim } from "@omnitwin/types";
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

function getHeroImage(): HTMLImageElement {
  const image = document.querySelector<HTMLImageElement>(".hero-media-photo img");
  expect(image).not.toBeNull();
  return image as HTMLImageElement;
}

describe("LandingPage — Grand Hall module", () => {
  it("renders the Grand Hall-first hero promise", () => {
    mount();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toMatch(/Design your event for the Grand Hall/);
    expect(screen.getByText(/A cinematic room showcase and live planning draft/i)).toBeTruthy();
    expect(screen.getAllByText(/Powered by Venviewer/i).length).toBeGreaterThanOrEqual(1);
  });

  it("has no dead in-page anchors — every href=\"#id\" resolves to an element with that id", () => {
    mount();
    const hashAnchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'),
    );
    // The page genuinely uses in-page anchors (header nav + footer columns).
    expect(hashAnchors.length).toBeGreaterThan(0);
    // Every hash anchor must resolve to a real section. A dead anchor (e.g. the
    // old footer "#presets" / "#about" links that scrolled nowhere) is below
    // the S+ bar and a regression we never want back.
    const deadTargets = hashAnchors
      .map((anchor) => anchor.getAttribute("href") ?? "")
      .filter((href) => href.length > 1) // ignore a bare "#"
      .filter((href) => document.getElementById(href.slice(1)) === null);
    expect(deadTargets).toEqual([]);
  });

  it("renders the proof chips without unsupported precision claims", () => {
    mount();
    expect(screen.getByText("Client-safe showcase")).toBeTruthy();
    expect(screen.getAllByText("Grand Hall").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Draft layout")).toBeTruthy();
    expect(screen.getAllByText("Human review required").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/to the centimetre/i)).toBeNull();
    expect(screen.queryByText(/events@tradeshall\.example/i)).toBeNull();
  });

  it("wires the cinematic room showcase selector to the planner and evidence copy", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Show Reception Room in public showcase/i }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Reception Room/);
    expect(screen.getByText(/runtime visual is staged internally and unverified/i)).toBeTruthy();
    expect(screen.getByText(/Public route stays on the honest photo fallback/i)).toBeTruthy();
    const img = getHeroImage();
    expect(img.getAttribute("src")).toBe("/images/venue/reception-room.jpg");
    expect(img.style.objectPosition).toBe("center 52%");
  });

  it("surfaces planning-grade hero capacity guidance with SAFE wording (T-429)", () => {
    mount();
    const guidance = screen.getByTestId("hero-capacity-guidance");
    expect(guidance.textContent).toMatch(/Grand Hall is comfortable for around \d+ guests as seated dinner on round tables/);
    expect(guidance.textContent).toContain("Planning estimate");
    expect(guidance.textContent).toContain("human review required");
    expect(guidance.textContent).toContain("final capacity confirmed by the venue team");
    expect(findUnsupportedProposalClaim(guidance.textContent ?? "")).toBeNull();
  });

  it("recomputes hero capacity guidance when the room changes", () => {
    mount();
    const before = screen.getByTestId("hero-capacity-guidance").textContent ?? "";
    expect(before).toContain("Grand Hall is comfortable");

    fireEvent.change(screen.getByLabelText("Choose room"), { target: { value: "reception-room" } });

    const after = screen.getByTestId("hero-capacity-guidance").textContent ?? "";
    expect(after).toContain("Reception Room is comfortable");
    expect(after).not.toBe(before);
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

  it("does not repeat the Grand Hall hero photo inside the Planrise workflow visual", () => {
    mount();
    expect(document.querySelector(".planrise img")).toBeNull();
    expect(document.querySelector(".planrise-mode-card")).not.toBeNull();
  });

  it("renders venue-specific preset and handoff signals without generic cards", () => {
    mount();
    expect(screen.getByText("3 venue-ready starts")).toBeTruthy();
    expect(screen.getByText("2D and 3D linked")).toBeTruthy();
    expect(screen.getByText("Ready for review")).toBeTruthy();
    expect(document.querySelector(".preset-grid")).toBeNull();
    expect(document.querySelector(".feat-grid")).toBeNull();
  });

  it("keeps the interactive planner preview and Grand Hall media", () => {
    mount();
    expect(screen.getByLabelText(/Planner preview/i)).toBeTruthy();
    const tools = screen.getByRole("toolbar", { name: /2D planner tools/i });
    expect(within(tools).getByRole("button", { name: /Select/i })).toBeTruthy();
    expect(within(tools).getByRole("button", { name: /Add/i })).toBeTruthy();
    expect(within(tools).getByRole("button", { name: /Delete/i })).toBeTruthy();
    expect(within(tools).getByRole("button", { name: /Measure/i })).toBeTruthy();
    expect(within(tools).getByRole("button", { name: /Camera/i })).toBeTruthy();
    expect(within(tools).getByRole("button", { name: /Snap/i })).toBeTruthy();
    expect(within(tools).getByRole("button", { name: /Review/i })).toBeTruthy();
    const img = getHeroImage();
    expect(img.getAttribute("alt")).toMatch(/Grand Hall dressed for a candlelit wedding dinner/i);
    expect(img.getAttribute("src")).toBe("/images/venue/grand-hall-room.jpg");
    expect(img.style.objectPosition).toBe("center 48%");
  });

  it("exposes a visible trash action for selected 2D furniture", () => {
    mount();
    const planner = document.querySelector(".planner-embedded");
    expect(planner).not.toBeNull();
    const initialFurniture = planner?.querySelectorAll(".furn").length ?? 0;
    expect(initialFurniture).toBeGreaterThan(0);

    const tools = screen.getByRole("toolbar", { name: /2D planner tools/i });
    fireEvent.click(within(tools).getByRole("button", { name: /Delete/i }));

    const nextFurniture = planner?.querySelectorAll(".furn").length ?? 0;
    expect(nextFurniture).toBe(initialFurniture - 1);
    expect(screen.getAllByRole("button", { name: /Delete item/i }).length).toBeGreaterThanOrEqual(1);
  });

  it("renders the full Trades Hall room selection with client-safe preview links", () => {
    mount();
    const rooms = screen.getByRole("heading", { level: 2, name: /Eight room experiences/i });
    expect(rooms).toBeTruthy();
    expect(screen.getByRole("link", { name: /Explore The Grand Hall/i }).getAttribute("href")).toBe("/venues/trades-hall/rooms/grand-hall");
    expect(screen.getByRole("link", { name: /Enquire about Deacon Convener's Room/i }).getAttribute("href")).toBe("/?room=deacon-convener-room#contact");
    expect(screen.getByRole("link", { name: /Explore Lady Convener's Room/i }).getAttribute("href")).toBe("/venues/trades-hall/rooms/lady-convenors-room");
    expect(screen.getByRole("link", { name: /Explore The Reception Room/i }).getAttribute("href")).toBe("/venues/trades-hall/rooms/reception-room");
    expect(screen.getByRole("link", { name: /Explore The Robert Adam Room/i }).getAttribute("href")).toBe("/venues/trades-hall/rooms/robert-adam-room");
    expect(screen.getByRole("link", { name: /Explore The Saloon/i }).getAttribute("href")).toBe("/venues/trades-hall/rooms/saloon");
    expect(screen.getByRole("link", { name: /Explore The North Gallery/i }).getAttribute("href")).toBe("/venues/trades-hall/rooms/north-gallery");
    expect(screen.getByRole("link", { name: /Explore The South Gallery/i }).getAttribute("href")).toBe("/venues/trades-hall/rooms/south-gallery");
    expect(screen.getByRole("link", { name: /Open The Grand Hall in the planner/i }).getAttribute("href")).toBe("/plan?space=grand-hall");
    expect(screen.getByRole("link", { name: /Open The Saloon in the planner/i }).getAttribute("href")).toBe("/plan?space=saloon");
    expect(screen.getByRole("link", { name: /Open The Robert Adam Room in the planner/i }).getAttribute("href")).toBe("/plan?space=robert-adam-room");
    expect(screen.getByRole("link", { name: /Open The Reception Room in the planner/i }).getAttribute("href")).toBe("/plan?space=reception-room");
    expect(screen.getByAltText(/Saloon set for a candlelit wedding ceremony/i).getAttribute("src")).toBe("/images/venue/saloon-room.jpg");
    expect(screen.getByAltText(/Robert Adam Room ceremony aisle/i).getAttribute("src")).toBe("/images/venue/robert-adam-room.jpg");
    expect(screen.getByAltText(/Reception Room dressed for a wedding ceremony/i).getAttribute("src")).toBe("/images/venue/reception-room.jpg");
    expect(document.body.textContent).toContain("Human review required");
    expect(document.body.textContent).toContain("No public runtime package is exposed");
  });

  it("wires the embedded 2D room selector to the same room slug as the 3D planner", () => {
    mount();
    const selector = screen.getByLabelText("Choose room");
    fireEvent.change(selector, { target: { value: "reception-room" } });
    const receptionPlannerLinks = screen.getAllByRole("link", { name: /Open the Reception Room planner/i });
    expect(receptionPlannerLinks.length).toBeGreaterThanOrEqual(2);
    for (const link of receptionPlannerLinks) {
      expect(link.getAttribute("href")).toBe("/plan?space=reception-room");
    }
    const img = getHeroImage();
    expect(img.getAttribute("alt")).toMatch(/Reception Room dressed/i);
    expect(img.getAttribute("src")).toBe("/images/venue/reception-room.jpg");
    expect(img.style.objectPosition).toBe("center 52%");
    const plannerTitle = document.querySelector(".planner-embedded .chrome .title");
    expect(plannerTitle?.textContent).toMatch(/Reception Room\s*·\s*wedding layout\s*·\s*Draft/i);
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
