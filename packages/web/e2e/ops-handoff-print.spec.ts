import { expect, test, type Page, type Route } from "@playwright/test";
import { OpsHandoffPackBundleSchema } from "@omnitwin/types";
import { unreadableOnPaper } from "./support/readability.js";

// ---------------------------------------------------------------------------
// E2E: the ops handoff pack on paper (/ops/handoff/:id), roadmap N4.
//
// Printed at A4 width the pack is a function sheet: the app's navigation
// stays on screen, each pick-list line is one row of three columns, the
// overview is one row, and every label reads at 4.5:1 on white paper, as a
// printer that leaves backgrounds out puts it. The page count is Chromium's
// own PDF. The API is intercepted before transport.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const NOW = "2026-10-03T12:00:00.000Z";
const VENUE = "20000000-0000-4000-8000-000000000002";
const PACK = "20000000-0000-4000-8000-000000000201";
const uuid = (n: number): string => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const HASH = "c".repeat(64);
const SETUP = uuid(210);

const PICK_LIST: readonly (readonly [string, string, number])[] = [
  ["Round table, 5 ft 6 in", "table", 18], ["Trestle table, 6 ft", "table", 6], ["Gold Chiavari chair", "chair", 180],
  ["Ivory tablecloth, round", "linen", 18], ["Ivory napkin", "linen", 190], ["Lectern", "staging", 1],
  ["Stage riser, 8 by 4", "staging", 4], ["Easel", "display", 2], ["Cake table", "table", 1],
  ["Cocktail poseur", "table", 8], ["Poseur cover, black", "linen", 8], ["Coat rail", "cloakroom", 3],
];

const BUNDLE = OpsHandoffPackBundleSchema.parse({
  pack: {
    id: PACK, eventId: uuid(202), configId: uuid(203), snapshotId: uuid(204), snapshotHash: HASH, version: 3, status: "compiled",
    sourceLabel: "Approved configuration snapshot v3",
    summary: "Grand Hall dinner, compiled from approved snapshot v3: 12 pick-list lines, 3 tasks, 2 supplier notes.",
    createdBy: null, compiledAt: NOW, updatedAt: NOW,
  },
  taskGroups: [{ id: SETUP, handoffPackId: PACK, title: "Setup tasks", kind: "setup", sortOrder: 0, createdAt: NOW }],
  opsTasks: [
    ["Set 18 round tables", "From the approved Grand Hall dinner layout."],
    ["Dress the top table", "Ivory linen, five covers, facing the room."],
    ["Check the accessible route", "Keep the Glassford Street door route clear."],
  ].map(([title, detail], index) => ({
    id: uuid(220 + index), handoffPackId: PACK, taskGroupId: SETUP, phaseId: null, kind: "setup", title, detail,
    status: "todo", sortOrder: index, dueLabel: "Before doors", sourceRef: "handoff-pack-v3", createdAt: NOW, updatedAt: NOW,
  })),
  furniturePickList: { id: uuid(230), handoffPackId: PACK, title: "Grand Hall pick list", totalItems: 439, createdAt: NOW },
  pickListItems: PICK_LIST.map(([name, category, quantity], index) => ({
    id: uuid(240 + index), pickListId: uuid(230), name, category, quantity, sourcePhase: null, sourceZone: "Grand Hall",
    notes: null, sortOrder: index, createdAt: NOW,
  })),
  supplierInstructions: [
    ["catering", "Caterer's load-in", "Staff entrance only; keep the guest route clear.", "15:30-16:00"],
    ["floral", "Florist", "After the linen check, before centrepieces.", "16:00-16:30"],
  ].map(([category, title, detail, arrivalWindow], index) => ({
    id: uuid(260 + index), handoffPackId: PACK, supplierId: null, category, title, detail, arrivalWindow,
    sourceRef: "supplier notes", sortOrder: index, createdAt: NOW,
  })),
  loadInSequence: [{ id: uuid(270), handoffPackId: PACK, kind: "load_in", stepNumber: 1, title: "Tables and linen", detail: "Tables before linen and florals.", sortOrder: 0, createdAt: NOW }],
  breakdownSequence: [{ id: uuid(271), handoffPackId: PACK, kind: "breakdown", stepNumber: 1, title: "Centrepieces", detail: "Florals out before the linen count.", sortOrder: 0, createdAt: NOW }],
  roomFlipPlans: [],
  beoDocument: {
    id: uuid(280), handoffPackId: PACK, title: "Grand Hall BEO internal handoff",
    body: "Internal BEO from the approved planning snapshot. Guest routes, access notes, supplier arrivals and furniture counts need the venue team's review before the event.",
    sourceSnapshotHash: HASH, safeStatus: "internal_operations_handoff", createdAt: NOW,
  },
  snapshotDiff: {
    id: uuid(290), handoffPackId: PACK, previousSnapshotHash: null, currentSnapshotHash: HASH, addedCount: 1, removedCount: 0, changedCount: 1,
    summary: "One setup row added and the chair count changed since the previous approved snapshot.",
    payload: { added: ["Accessible route check"], removed: [], changed: ["Gold Chiavari chair: 170 -> 180"] }, createdAt: NOW,
  },
});

async function openPack(page: Page): Promise<void> {
  await page.addInitScript((venueId) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: { id: "e2e-user-staff", email: "staff@e2e.test", role: "staff", venueId, name: "E2E Staff" },
      writable: false,
    });
  }, VENUE);
  const json = (route: Route, data: unknown): void => { void route.fulfill({ json: { data } }); };
  await page.route(`${API}/**`, (route) => { void route.fulfill({ status: 404, json: { error: "Not in this fixture", code: "NOT_FOUND" } }); });
  await page.route(`${API}/notifications**`, (route) => {
    json(route, new URL(route.request().url()).pathname.endsWith("unread-count") ? { unread: 0 } : []);
  });
  await page.route(`${API}/venues/${VENUE}`, (route) => {
    json(route, { id: VENUE, name: "Trades Hall Glasgow", slug: "trades-hall-glasgow", address: "85 Glassford Street", logoUrl: null, brandColour: null, timezone: "Europe/London", spaces: [] });
  });
  await page.route(`${API}/ops/handoff-packs/${PACK}`, (route) => { json(route, BUNDLE); });
  await page.route(`${API}/ai/status`, (route) => {
    json(route, { configured: false, provider: null, model: null, disabledReason: "AI drafts are off until a provider is configured." });
  });
  await page.goto(`/ops/handoff/${PACK}`);
  await expect(page.getByRole("heading", { name: "Ops handoff pack" })).toBeVisible();
}

test.describe("Ops handoff pack on paper", () => {
  test("prints as a function sheet at A4 width: no app chrome, one row per pick-list line, and every label legible on white", async ({ page }) => {
    // A4 at 96 dpi, the width a printed page lays out at.
    await page.setViewportSize({ width: 794, height: 1123 });
    await openPack(page);
    await page.emulateMedia({ media: "print" });

    // The app's navigation and the pack's own buttons stay on screen.
    await expect(page.getByRole("navigation", { name: "Staff dashboard" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Print / export" })).toBeHidden();

    // Each pick-list line is one row of three columns, and the overview one row.
    const rows = page.getByRole("table", { name: "Furniture pick list" }).getByRole("row");
    await expect(rows).toHaveCount(PICK_LIST.length + 1);
    const cellTops = await rows.nth(1).getByRole("cell").evaluateAll((cells) => cells.map((cell) => Math.round(cell.getBoundingClientRect().top)));
    expect(cellTops).toHaveLength(3);
    expect(new Set(cellTops).size).toBe(1);
    const metricTops = await page.locator(".ops-handoff-metric").evaluateAll((tiles) => tiles.map((tile) => Math.round(tile.getBoundingClientRect().top)));
    expect(metricTops).toHaveLength(5);
    expect(new Set(metricTops).size).toBe(1);

    // Every label reads on white paper.
    expect(await unreadableOnPaper(page, ".ops-handoff-page", "handoff on paper")).toEqual([]);

    // Chromium's own print: twelve lines and three tasks fit on two sheets.
    const pdf = await page.pdf({ format: "A4", printBackground: false });
    const sheets = (pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/gu) ?? []).length;
    expect(sheets).toBeGreaterThan(0);
    expect(sheets).toBeLessThanOrEqual(2);
  });
});
