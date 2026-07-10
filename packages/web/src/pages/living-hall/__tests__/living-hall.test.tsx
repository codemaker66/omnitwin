import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { findUnsupportedProposalClaim } from "@omnitwin/types";
import { LivingHallPage } from "../LivingHallPage.js";
import {
  LH_ACTS,
  LH_META_TITLE,
  LH_SANDBOX_START,
  RECEPTION_CAPTURE_RECORD,
  allLivingHallCopy,
} from "../living-hall-copy.js";
import {
  TRADES_HALL_ROOM_CAPACITIES,
  TRADES_HALL_WEDDING_PRICING,
} from "../../../lib/trades-hall-venue-truth.js";

// ---------------------------------------------------------------------------
// The Living Hall — DOM-first document contract (P0). This semantic document
// is the source of truth for every tier: the 3D experience layers onto it,
// Tier C styles it, scrapers and screen readers read it. So the contract is
// structural: one h1, one h2 per act, act nav that resolves, venue figures
// rendered from the venue-truth module, provenance rendered from the capture
// record (which must mirror state/capture_log.json), and claim-guarded copy.
// ---------------------------------------------------------------------------

afterEach(cleanup);

function mount(): void {
  render(
    <MemoryRouter initialEntries={["/living-hall"]}>
      <LivingHallPage />
    </MemoryRouter>,
  );
}

describe("document structure", () => {
  it("has one h1 and one h2 per act", () => {
    mount();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const h2s = screen.getAllByRole("heading", { level: 2 });
    expect(h2s.length).toBe(LH_ACTS.length);
  });

  it("act navigation anchors resolve to real section ids", () => {
    mount();
    for (const act of LH_ACTS) {
      const section = document.getElementById(act.id);
      expect(section, `missing section #${act.id}`).toBeTruthy();
      expect(section?.tagName).toBe("SECTION");
      const navLink = document.querySelector(`.lh-header a[href="#${act.id}"]`);
      expect(navLink, `missing act nav link for #${act.id}`).toBeTruthy();
    }
  });

  it("offers a skip link as the first focusable element", () => {
    mount();
    const first = document.querySelector("a, button");
    expect(first?.getAttribute("href")).toBe("#rooms-and-rates");
  });

  it("sets the document title", () => {
    mount();
    expect(document.title).toBe(LH_META_TITLE);
  });
});

describe("venue truth rendered, never restated", () => {
  it("renders all six rooms with their four published capacities", () => {
    mount();
    for (const [slug, cap] of Object.entries(TRADES_HALL_ROOM_CAPACITIES)) {
      const row = document.querySelector(`[data-room-row="${slug}"]`);
      expect(row, `missing capacity row for ${slug}`).toBeTruthy();
      const text = row?.textContent ?? "";
      for (const value of [cap.theatre, cap.classroom, cap.dinner, cap.reception]) {
        expect(text).toContain(String(value));
      }
    }
  });

  it("renders every published wedding rate with GBP formatting", () => {
    mount();
    expect(screen.getByText("£2,800")).toBeTruthy();
    expect(screen.getByText("£650")).toBeTruthy();
    const seasons = TRADES_HALL_WEDDING_PRICING.seasons;
    const renderedRates = document.querySelectorAll("[data-rate-row]");
    expect(renderedRates.length).toBe(seasons.reduce((n, s) => n + s.rates.length, 0));
  });

  it("renders the capture record for the hero room", () => {
    mount();
    const record = document.querySelector("[data-capture-record]");
    expect(record?.textContent).toContain("PortalCam");
    expect(record?.textContent).toContain("2,002,122");
  });
});

describe("the dressing choice — the visitor owns the goal", () => {
  it("offers three event shapes with exactly one pressed", () => {
    mount();
    const buttons = ["Wedding", "Dinner", "Conference"].map((label) =>
      screen.getByRole("button", { name: label }),
    );
    expect(buttons.filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(1);
  });

  it("re-programs the tick's ceiling from venue truth when the choice changes", () => {
    mount();
    const tick = document.querySelector("[data-dressing-tick]");
    const caps = TRADES_HALL_ROOM_CAPACITIES["reception-room"];
    expect(tick?.textContent).toContain(String(caps.dinner)); // wedding default
    fireEvent.click(screen.getByRole("button", { name: "Conference" }));
    expect(screen.getByRole("button", { name: "Conference" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(tick?.textContent).toContain(String(caps.theatre));
  });

  it("starts the count at zero — seats only exist once the pen draws them", () => {
    mount();
    const tick = document.querySelector("[data-dressing-tick]");
    expect(tick?.textContent?.trim().startsWith("0")).toBe(true);
  });
});

describe("the plan sandbox", () => {
  it("does not offer canvas interaction when WebGL2 is unavailable", () => {
    mount();
    expect(screen.queryByRole("button", { name: LH_SANDBOX_START })).toBeNull();
  });

  it("keeps pointer ownership opt-in at the scene boundary", () => {
    const css = readFileSync(resolve(process.cwd(), "src/pages/living-hall/living-hall.css"), "utf8");
    expect(css).toMatch(/\.lh-scene\s*\{[\s\S]*?pointer-events:\s*none/);
    expect(css).toMatch(/\.lh-scene\.is-interactive\s*\{[\s\S]*?pointer-events:\s*auto/);
  });
});

describe("provenance sync — the page may only claim what the record holds", () => {
  it("mirrors state/capture_log.json exactly", () => {
    // vitest runs with cwd = packages/web; the state dir lives at repo root.
    const statePath = resolve(process.cwd(), "../../state/capture_log.json");
    const log = JSON.parse(readFileSync(statePath, "utf8")) as {
      captures: {
        slug: string;
        capturedAt: string;
        device: string;
        build?: { splatCount: number; builtAt: string };
      }[];
    };
    const reception = log.captures.find((c) => c.slug === "reception-room");
    expect(reception).toBeTruthy();
    expect(RECEPTION_CAPTURE_RECORD.capturedAt).toBe(reception?.capturedAt);
    expect(RECEPTION_CAPTURE_RECORD.device).toBe(reception?.device);
    expect(RECEPTION_CAPTURE_RECORD.splatCount).toBe(reception?.build?.splatCount);
    expect(RECEPTION_CAPTURE_RECORD.builtAt).toBe(reception?.build?.builtAt);
  });
});

describe("claim safety", () => {
  it("every string on the page passes the proposal claim guard", () => {
    for (const s of allLivingHallCopy()) {
      expect(findUnsupportedProposalClaim(s), `claim guard tripped on: ${s}`).toBeNull();
    }
  });

  it("labels the future 3D layer honestly (no fake interactivity claims in the document)", () => {
    const copy = allLivingHallCopy().join(" ").toLowerCase();
    expect(copy).not.toContain("certified");
    expect(copy).not.toContain("photoreal digital twin");
  });
});
