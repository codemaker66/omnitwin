import { describe, it, expect } from "vitest";
import { generateSheetPdfV2 } from "../services/hallkeeper-pdf-v2.js";
import type { HallkeeperSheetV2 } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Unit tests for the v2 PDF renderer.
//
// We can't visually inspect the rendered output from a test, so we
// verify three things that are cheap and reliable:
//
//   1. The renderer doesn't crash on any combination of optional fields
//      (instructions present / absent, notes present / absent, multi-
//      page with accessories, empty manifest, etc.).
//   2. The PDF magic bytes are present — the output is a real PDF.
//   3. When we add more content (instructions, notes, positions) the
//      byte count is strictly larger than the baseline — a cheap but
//      surprisingly robust way to prove the renderer is actually
//      acting on the extra data rather than silently ignoring it.
// ---------------------------------------------------------------------------

const BASE_SHEET: HallkeeperSheetV2 = {
  config: {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Anderson Wedding Reception",
    guestCount: 120,
    layoutStyle: "dinner-rounds",
  },
  venue: { name: "Trades Hall Glasgow", address: "85 Glassford St, Glasgow G1 1UH", logoUrl: null },
  space: { name: "Grand Hall", widthM: 21, lengthM: 10, heightM: 7 },
  timing: {
    eventStart: "2026-06-15T18:00:00.000Z",
    setupBy: "2026-06-15T16:30:00.000Z",
    bufferMinutes: 90,
  },
  instructions: null,
  phases: [
    {
      phase: "furniture",
      zones: [
        {
          zone: "Centre",
          rows: [
            {
              key: "furniture|Centre|6ft Round Table with 10 chairs|0",
              name: "6ft Round Table with 10 chairs",
              category: "table",
              qty: 8,
              afterDepth: 0,
              isAccessory: false,
              notes: "",
              positions: [],
            },
          ],
        },
      ],
    },
  ],
  totals: {
    entries: [{ name: "6ft Round Table with 10 chairs", category: "table", qty: 8 }],
    totalRows: 1,
    totalItems: 8,
  },
  diagramUrl: null,
  webViewUrl: "http://localhost:5173/hallkeeper/cfg",
  generatedAt: "2026-04-16T10:00:00.000Z",
};

function hasPdfMagic(buf: Buffer): boolean {
  return buf.length >= 4 && buf.slice(0, 4).toString() === "%PDF";
}

describe("generateSheetPdfV2 — baseline", () => {
  it("produces a valid PDF with magic bytes %PDF", async () => {
    const buf = await generateSheetPdfV2(BASE_SHEET);
    expect(hasPdfMagic(buf)).toBe(true);
  });

  it("accepts an empty phases array", async () => {
    const empty: HallkeeperSheetV2 = { ...BASE_SHEET, phases: [], totals: { entries: [], totalRows: 0, totalItems: 0 } };
    const buf = await generateSheetPdfV2(empty);
    expect(hasPdfMagic(buf)).toBe(true);
  });

  it("accepts timing=null", async () => {
    const noTiming: HallkeeperSheetV2 = { ...BASE_SHEET, timing: null };
    const buf = await generateSheetPdfV2(noTiming);
    expect(hasPdfMagic(buf)).toBe(true);
  });
});

describe("generateSheetPdfV2 — instructions block", () => {
  it("renders a PDF with special instructions and is larger than the baseline", async () => {
    const base = await generateSheetPdfV2(BASE_SHEET);
    const withInstructions = await generateSheetPdfV2({
      ...BASE_SHEET,
      instructions: {
        specialInstructions: "Fire exits must remain clear at all times. Board arriving at 6:45pm — please be set up before then. Vegetarian option required on table 3.",
        dayOfContact: null,
        phaseDeadlines: [],
        accessNotes: "",
      },
    });
    expect(hasPdfMagic(withInstructions)).toBe(true);
    expect(withInstructions.length).toBeGreaterThan(base.length);
  });

  it("renders a day-of contact block", async () => {
    const buf = await generateSheetPdfV2({
      ...BASE_SHEET,
      instructions: {
        specialInstructions: "",
        dayOfContact: { name: "Sarah Anderson", role: "Planner", phone: "+44 7700 900123", email: "sarah@anderson.com" },
        phaseDeadlines: [],
        accessNotes: "",
      },
    });
    expect(hasPdfMagic(buf)).toBe(true);
  });

  it("renders access notes", async () => {
    const buf = await generateSheetPdfV2({
      ...BASE_SHEET,
      instructions: {
        specialInstructions: "",
        dayOfContact: null,
        phaseDeadlines: [],
        accessNotes: "Service entrance at south door. Parking in cobbled yard. No vehicles after 15:00.",
      },
    });
    expect(hasPdfMagic(buf)).toBe(true);
  });

  it("renders per-phase deadlines in the timing callout", async () => {
    const buf = await generateSheetPdfV2({
      ...BASE_SHEET,
      instructions: {
        specialInstructions: "",
        dayOfContact: null,
        phaseDeadlines: [
          { phase: "structure", deadline: "2026-06-15T13:00:00.000Z", reason: "" },
          { phase: "furniture", deadline: "2026-06-15T14:30:00.000Z", reason: "" },
          { phase: "dress", deadline: "2026-06-15T16:00:00.000Z", reason: "" },
        ],
        accessNotes: "",
      },
    });
    expect(hasPdfMagic(buf)).toBe(true);
  });

  it("renders the full instructions block without crashing", async () => {
    const buf = await generateSheetPdfV2({
      ...BASE_SHEET,
      instructions: {
        specialInstructions: "Fire exits must remain clear.",
        dayOfContact: { name: "Sarah Anderson", role: "Planner", phone: "+44 7700 900123", email: "sarah@anderson.com" },
        phaseDeadlines: [
          { phase: "furniture", deadline: "2026-06-15T14:30:00.000Z", reason: "" },
        ],
        accessNotes: "Service entrance at south door.",
      },
    });
    expect(hasPdfMagic(buf)).toBe(true);
  });
});

describe("generateSheetPdfV2 — per-row notes", () => {
  it("renders rows with notes at taller heights without crashing", async () => {
    const withNotes: HallkeeperSheetV2 = {
      ...BASE_SHEET,
      phases: [{
        phase: "furniture",
        zones: [{
          zone: "Centre",
          rows: [{
            ...BASE_SHEET.phases[0]!.zones[0]!.rows[0]!,
            notes: "VIP table — reserved for the Anderson family",
          }],
        }],
      }],
    };
    const buf = await generateSheetPdfV2(withNotes);
    expect(hasPdfMagic(buf)).toBe(true);
  });

  it("rendered PDF with notes is strictly larger than one without", async () => {
    const base = await generateSheetPdfV2(BASE_SHEET);
    const withNotes: HallkeeperSheetV2 = {
      ...BASE_SHEET,
      phases: [{
        phase: "furniture",
        zones: [{
          zone: "Centre",
          rows: [{
            ...BASE_SHEET.phases[0]!.zones[0]!.rows[0]!,
            notes: "VIP table — reserved for the Anderson family, needs extra candelabra",
          }],
        }],
      }],
    };
    const withNotesBuf = await generateSheetPdfV2(withNotes);
    expect(withNotesBuf.length).toBeGreaterThan(base.length);
  });
});
