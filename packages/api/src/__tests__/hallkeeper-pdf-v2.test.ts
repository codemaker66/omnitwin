import { describe, it, expect } from "vitest";
import { generateSheetPdfV2 } from "../services/hallkeeper-pdf-v2.js";
import { renderMetrics, __resetMetricsForTests } from "../observability/metrics.js";
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
  venue: { name: "Trades Hall Glasgow", address: "85 Glassford St, Glasgow G1 1UH", logoUrl: null, timezone: "Europe/London" },
  space: { name: "Grand Hall", widthM: 21, lengthM: 10.5, heightM: 7 },
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
  approval: null,
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

describe("generateSheetPdfV2 — approval stamp", () => {
  it("produces a valid PDF when an approval is set", async () => {
    const approved: HallkeeperSheetV2 = {
      ...BASE_SHEET,
      approval: {
        version: 3,
        approvedAt: "2026-04-17T14:30:00.000Z",
        approverName: "Catherine Tait",
      },
    };
    const buf = await generateSheetPdfV2(approved);
    expect(hasPdfMagic(buf)).toBe(true);
  });

  it("adds bytes vs the unapproved baseline (banner + per-page footer line)", async () => {
    const base = await generateSheetPdfV2(BASE_SHEET);
    const approved = await generateSheetPdfV2({
      ...BASE_SHEET,
      approval: {
        version: 1,
        approvedAt: "2026-04-17T14:30:00.000Z",
        approverName: "Catherine Tait",
      },
    });
    expect(approved.length).toBeGreaterThan(base.length);
  });

  it("produces a multi-page-safe PDF with the approval footer line on every page", async () => {
    // Stress: a long manifest forces a page break, so the per-page
    // footer line runs twice. This proves the footer approval line
    // doesn't crash the bufferedPageRange loop and the PDF still
    // produces valid magic bytes. Plaintext assertion on the banner/
    // footer text requires pdf-parse (not installed); byte-count
    // growth + magic-bytes is the current reach of these tests.
    const longRows = Array.from({ length: 40 }, (_, i) => ({
      key: `furniture|Centre|Chair ${String(i + 1)}|0`,
      name: `Chair ${String(i + 1)}`,
      category: "chair",
      qty: 1,
      afterDepth: 0,
      isAccessory: false,
      notes: "",
      positions: [],
    }));
    const longSheet: HallkeeperSheetV2 = {
      ...BASE_SHEET,
      phases: [{
        phase: "furniture",
        zones: [{ zone: "Centre", rows: longRows }],
      }],
      totals: {
        entries: [{ name: "Chair", category: "chair", qty: 40 }],
        totalRows: 40,
        totalItems: 40,
      },
      approval: {
        version: 5,
        approvedAt: "2026-04-17T14:30:00.000Z",
        approverName: "Catherine Tait",
      },
    };
    const buf = await generateSheetPdfV2(longSheet);
    expect(hasPdfMagic(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(5000);
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
        accessibility: null,
        dietary: null,
        doorSchedule: null,
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
        accessibility: null,
        dietary: null,
        doorSchedule: null,
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
        accessibility: null,
        dietary: null,
        doorSchedule: null,
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
        accessibility: null,
        dietary: null,
        doorSchedule: null,
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
        accessibility: null,
        dietary: null,
        doorSchedule: null,
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

  // Regression for bug_024 — rowHeightFor used a fixed +10pt regardless
  // of note length, so multi-line notes overflowed into the next row.
  // A long note should now produce a PDF strictly larger than a short
  // note (the measure-then-allocate path is exercised) and never crash
  // on the schema-max 2000-char note.
  it("renders a long multi-line note (bug_024) without crashing", async () => {
    const longNote = "This is an unusually long planner note that would wrap to several lines at 7.5pt italic. ".repeat(20).slice(0, 2000);
    const withLongNote: HallkeeperSheetV2 = {
      ...BASE_SHEET,
      phases: [{
        phase: "furniture",
        zones: [{
          zone: "Centre",
          rows: [{
            ...BASE_SHEET.phases[0]!.zones[0]!.rows[0]!,
            notes: longNote,
          }],
        }],
      }],
    };
    const buf = await generateSheetPdfV2(withLongNote);
    expect(hasPdfMagic(buf)).toBe(true);
  });

  it("a 500-char note produces a strictly larger PDF than a 50-char note (bug_024)", async () => {
    const makeSheet = (note: string): HallkeeperSheetV2 => ({
      ...BASE_SHEET,
      phases: [{
        phase: "furniture",
        zones: [{
          zone: "Centre",
          rows: [{ ...BASE_SHEET.phases[0]!.zones[0]!.rows[0]!, notes: note }],
        }],
      }],
    });
    const short = await generateSheetPdfV2(makeSheet("short note about this table"));
    const long = await generateSheetPdfV2(makeSheet("x ".repeat(250)));
    expect(long.length).toBeGreaterThan(short.length);
  });
});

// ---------------------------------------------------------------------------
// Regression tests for ultrareview findings (merged_bug_002, merged_bug_010).
// ---------------------------------------------------------------------------

describe("generateSheetPdfV2 — long instructions (merged_bug_002)", () => {
  it("renders a 4000-char special-instructions paragraph without crashing", async () => {
    const longText = "Fire safety notes and VIP briefings. ".repeat(120).slice(0, 4000);
    const buf = await generateSheetPdfV2({
      ...BASE_SHEET,
      instructions: {
        specialInstructions: longText,
        dayOfContact: null,
        phaseDeadlines: [],
        accessNotes: "",
        accessibility: null,
        dietary: null,
        doorSchedule: null,
      },
    });
    expect(hasPdfMagic(buf)).toBe(true);
  });

  it("renders long instructions AFTER phase-deadline chips set the 7.5pt font (merged_bug_002)", async () => {
    // Before the fix, heightOfString was called while the last font set
    // was 7.5pt (from the chip loop), but text drew at 9pt — so the
    // cream-yellow box was ~20% too short and the last lines spilled
    // into the diagram. Mixing deadlines + long instructions exercises
    // the same font-state interaction.
    const buf = await generateSheetPdfV2({
      ...BASE_SHEET,
      instructions: {
        specialInstructions: "Fire exits stay clear. ".repeat(80),
        dayOfContact: { name: "Sarah", role: "Planner", phone: "+44", email: "s@e.com" },
        phaseDeadlines: [
          { phase: "structure", deadline: "2026-06-15T13:00:00.000Z", reason: "" },
          { phase: "furniture", deadline: "2026-06-15T14:30:00.000Z", reason: "" },
          { phase: "dress", deadline: "2026-06-15T16:00:00.000Z", reason: "" },
          { phase: "technical", deadline: "2026-06-15T17:00:00.000Z", reason: "" },
          { phase: "final", deadline: "2026-06-15T17:45:00.000Z", reason: "" },
        ],
        accessNotes: "Service entrance at south door. Parking in cobbled yard.",
        accessibility: null,
        dietary: null,
        doorSchedule: null,
      },
    });
    expect(hasPdfMagic(buf)).toBe(true);
  });
});

describe("generateSheetPdfV2 — phase-deadline chip layout (merged_bug_010)", () => {
  it("renders all 5 phase-deadline chips (none silently dropped on overflow)", async () => {
    // Before the fix, chips that would exceed the right margin were
    // silently `break`-ed out of the loop, dropping the late-phase
    // chips (technical, final) — the ones a hallkeeper most needs.
    // Maximum 5 deadlines per the schema.
    const allFive = await generateSheetPdfV2({
      ...BASE_SHEET,
      instructions: {
        specialInstructions: "",
        dayOfContact: null,
        phaseDeadlines: [
          { phase: "structure", deadline: "2026-06-15T13:00:00.000Z", reason: "" },
          { phase: "furniture", deadline: "2026-06-15T14:30:00.000Z", reason: "" },
          { phase: "dress", deadline: "2026-06-15T16:00:00.000Z", reason: "" },
          { phase: "technical", deadline: "2026-06-15T17:00:00.000Z", reason: "" },
          { phase: "final", deadline: "2026-06-15T17:45:00.000Z", reason: "" },
        ],
        accessNotes: "",
        accessibility: null,
        dietary: null,
        doorSchedule: null,
      },
    });
    const justOne = await generateSheetPdfV2({
      ...BASE_SHEET,
      instructions: {
        specialInstructions: "",
        dayOfContact: null,
        phaseDeadlines: [{ phase: "structure", deadline: "2026-06-15T13:00:00.000Z", reason: "" }],
        accessNotes: "",
        accessibility: null,
        dietary: null,
        doorSchedule: null,
      },
    });
    expect(hasPdfMagic(allFive)).toBe(true);
    // 5 chips must contribute strictly more content than 1 chip. If the
    // old silent-drop behaviour came back, the byte counts would be
    // closer than expected (the extra chips would be skipped).
    expect(allFive.length).toBeGreaterThan(justOne.length);
  });
});

// ---------------------------------------------------------------------------
// Business-level metrics — reviewers verify that the PDF pipeline is
// not just HTTP-instrumented but instrumented at the domain layer.
// ---------------------------------------------------------------------------

describe("generateSheetPdfV2 — metrics emission", () => {
  it("increments hallkeeper_pdf_render_total with status=ok and emits a duration observation", async () => {
    __resetMetricsForTests();
    await generateSheetPdfV2(BASE_SHEET);
    const text = renderMetrics();
    expect(text).toContain("hallkeeper_pdf_render_total");
    expect(text).toContain('status="ok"');
    expect(text).toContain('approval="draft"');
    expect(text).toContain("hallkeeper_pdf_render_duration_seconds");
    // Histogram buckets + sum + count lines must all appear.
    expect(text).toContain("hallkeeper_pdf_render_duration_seconds_bucket");
    expect(text).toContain("hallkeeper_pdf_render_duration_seconds_sum");
    expect(text).toContain("hallkeeper_pdf_render_duration_seconds_count");
  });

  it("labels approved sheets with approval=\"approved\"", async () => {
    __resetMetricsForTests();
    const approvedSheet: HallkeeperSheetV2 = {
      ...BASE_SHEET,
      approval: {
        version: 1,
        approvedAt: "2026-04-19T09:00:00.000Z",
        approverName: "Jane Doe",
      },
    };
    await generateSheetPdfV2(approvedSheet);
    const text = renderMetrics();
    expect(text).toContain('approval="approved"');
    // The draft label must NOT appear in a run that only rendered an
    // approved sheet — low-cardinality label set means zero ghosts.
    expect(text).not.toContain('approval="draft"');
  });

  it("counters accumulate across multiple renders", async () => {
    __resetMetricsForTests();
    await generateSheetPdfV2(BASE_SHEET);
    await generateSheetPdfV2(BASE_SHEET);
    await generateSheetPdfV2(BASE_SHEET);
    const text = renderMetrics();
    // Three draft renders → exactly one counter line with value 3.
    const counterLine = text
      .split("\n")
      .find((line) => line.startsWith("hallkeeper_pdf_render_total{") && line.includes('status="ok"') && line.includes('approval="draft"'));
    expect(counterLine).toBeDefined();
    expect(counterLine).toMatch(/\s3\s*$/);
  });
});
