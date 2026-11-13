import { describe, expect, it } from "vitest";
import type { HallkeeperFloorPlan } from "@omnitwin/types";
import {
  VISITOR_PLAN_PROVENANCE,
  formatVisitorPlanTime,
  generateVisitorPlanPdf,
  summariseVisitorPlanItems,
  visitorPlanFilename,
  type VisitorPlan,
} from "../services/visitor-plan-pdf.js";
import { pdfPageTexts } from "./support/pdf-text.js";

// ---------------------------------------------------------------------------
// The visitor's plan PDF (fix-first item 11). These read PDFKit's real page
// content streams, the same way hallkeeper-pdf-v2.test.ts does, so they see
// exactly the words a recipient sees.
// ---------------------------------------------------------------------------

const pdfPages = pdfPageTexts;

const TABLE_ASSET = "22222222-2222-4222-8222-222222222201";
const CHAIR_ASSET = "22222222-2222-4222-8222-222222222202";
const OBJECT_PREFIX = "33333333-3333-4333-8333-3333333333";

function object(index: number, asset: "table" | "chair"): HallkeeperFloorPlan["objects"][number] {
  return {
    objectId: `${OBJECT_PREFIX}${String(index).padStart(2, "0")}`,
    assetDefinitionId: asset === "table" ? TABLE_ASSET : CHAIR_ASSET,
    name: asset === "table" ? "Round table 1.8 m" : "Banquet chair",
    category: asset,
    x: -6 + index * 0.4, z: asset === "table" ? -1 : 1.5,
    rotationY: 0, scale: 1,
    widthM: asset === "table" ? 1.8 : 0.45,
    depthM: asset === "table" ? 1.8 : 0.45,
    collisionType: asset === "table" ? "cylinder" : "box",
  };
}

const PLAN: VisitorPlan = {
  venueName: "Trades Hall Glasgow",
  venueAddress: "85 Glassford Street, Glasgow G1 1UH",
  timezone: "Europe/London",
  roomName: "Grand Hall",
  planName: null,
  // 13:02 UTC on 17 October 2026 is 14:02 in Glasgow (BST).
  lastChangedAt: new Date("2026-10-17T13:02:00.000Z"),
  floorPlan: {
    coordinateSpace: "real_m_v1",
    outline: [{ x: -10.5, z: -5 }, { x: 10.5, z: -5 }, { x: 10.5, z: 5 }, { x: -10.5, z: 5 }],
    objects: [object(0, "table"), object(1, "table"), object(2, "chair"), object(3, "chair"), object(4, "chair")],
  },
};

describe("visitor plan PDF", () => {
  it("is a real one-page PDF naming the room and the venue", async () => {
    const buf = await generateVisitorPlanPdf(PLAN);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    const pages = pdfPages(buf);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain("Grand Hall");
    expect(pages[0]).toContain("TRADES HALL GLASGOW");
    expect(pages[0]).toContain("85 Glassford Street, Glasgow G1 1UH");
  });

  it("says who drew it and when it last changed, in the venue's clock", async () => {
    const text = pdfPages(await generateVisitorPlanPdf(PLAN)).join("\n");
    expect(text).toContain("Drawn by a visitor; not reviewed by the venue.");
    expect(VISITOR_PLAN_PROVENANCE).toBe("Drawn by a visitor; not reviewed by the venue.");
    expect(text).toContain("Last changed 17 October 2026, 14:02.");
  });

  it("counts what is on the plan by catalogue name, tables first", async () => {
    const text = pdfPages(await generateVisitorPlanPdf(PLAN)).join("\n");
    expect(text).toMatch(/2\nRound table 1\.8 m/u);
    expect(text).toMatch(/3\nBanquet chair/u);
    expect(summariseVisitorPlanItems(PLAN.floorPlan)).toEqual([
      { name: "Round table 1.8 m", category: "table", count: 2 },
      { name: "Banquet chair", category: "chair", count: 3 },
    ]);
  });

  it("shows no prices and offers the events team as the way to a price", async () => {
    const text = pdfPages(await generateVisitorPlanPdf(PLAN)).join("\n");
    expect(text).not.toMatch(/£|\bGBP\b|per cover|estimate/iu);
    expect(text).toContain("Prices, availability and what the room can hold are confirmed by the Trades Hall Glasgow events team");
  });

  it("carries no object or catalogue identifiers anywhere in the file", async () => {
    const buf = await generateVisitorPlanPdf(PLAN);
    const raw = buf.toString("latin1");
    const text = pdfPages(buf).join("\n");
    for (const id of [TABLE_ASSET, CHAIR_ASSET, ...PLAN.floorPlan.objects.map((o) => o.objectId)]) {
      expect(raw).not.toContain(id);
      expect(text).not.toContain(id);
    }
  });

  it("says plainly when nothing is placed yet", async () => {
    const text = pdfPages(await generateVisitorPlanPdf({
      ...PLAN, floorPlan: { ...PLAN.floorPlan, objects: [] },
    })).join("\n");
    expect(text).toContain("No furniture placed yet.");
  });

  it("names the plan when the organiser named it", async () => {
    const text = pdfPages(await generateVisitorPlanPdf({ ...PLAN, planName: "Morrison wedding" })).join("\n");
    expect(text).toContain("Morrison wedding");
  });

  it("continues a long list overleaf with page numbers in the footer", async () => {
    const many: HallkeeperFloorPlan["objects"] = Array.from({ length: 60 }, (_, index) => ({
      ...object(index % 50, "chair"),
      objectId: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
      name: `Catalogue item ${String(index).padStart(2, "0")}`,
      x: -9 + (index % 30) * 0.6,
    }));
    const pages = pdfPages(await generateVisitorPlanPdf({ ...PLAN, floorPlan: { ...PLAN.floorPlan, objects: many } }));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]).toContain("Page 1 of");
    expect(pages[1]).toContain("ON THE PLAN, CONTINUED");
    const all = pages.join("\n");
    for (let index = 0; index < 60; index += 1) {
      expect(all).toContain(`Catalogue item ${String(index).padStart(2, "0")}`);
    }
  });
});

describe("visitor plan wording helpers", () => {
  it("formats the time in the named zone and falls back to a labelled UTC", () => {
    const at = new Date("2026-12-01T09:05:00.000Z");
    expect(formatVisitorPlanTime(at, "Europe/London")).toBe("1 December 2026, 09:05");
    expect(formatVisitorPlanTime(at, "Not/A_Zone")).toBe("1 December 2026, 09:05 UTC");
  });

  it("gives the file a plain, header-safe name", () => {
    expect(visitorPlanFilename("Grand Hall")).toBe("Grand Hall plan.pdf");
    expect(visitorPlanFilename("Saloon \"East\"; rm\r\n")).toBe("Saloon East rm plan.pdf");
    expect(visitorPlanFilename("☃")).toBe("Room plan.pdf");
  });
});
