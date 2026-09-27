import { expect, test, type Page } from "@playwright/test";
import { OPPORTUNITY_STAGE_TRANSITIONS, type OpportunityStage } from "@omnitwin/types";
import type { PipelineOpportunity, StageMove } from "../src/api/crm.js";
import {
  collectAccessibilityAudit,
  expectAccessibilityAuditClean,
  watchPageProblems,
} from "./support/accessibility-audit.js";

// ---------------------------------------------------------------------------
// E2E: the pipeline desk (roadmap X1).
//
// The CRM API is emulated in memory over the real stage rules: a move the
// rules forbid is refused with the API's 422, a deal closes as won or lost
// only with a reason (REASON_REQUIRED, as routes/opportunities.ts refuses
// one without), and every move is written to the deal's history. The ledger
// is ordered as the API orders "?order=due": open deals by when their next
// step is due, then won and lost. Nothing about a move is mocked per test.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const VENUE_ID = "00000000-0000-4000-8000-000000009601";
const STAFF_ID = "00000000-0000-4000-8000-000000009691";
const HENDERSON = "00000000-0000-4000-8000-000000009611";
const MERCHANTS = "00000000-0000-4000-8000-000000009612";
const GALA = "00000000-0000-4000-8000-000000009613";
/** 10:00 in Glasgow on Tuesday 6 October 2026. */
const NOW = new Date("2026-10-06T09:00:00.000Z");

const VENUE = {
  id: VENUE_ID, name: "Trades Hall Glasgow", slug: "trades-hall", address: "85 Glassford Street",
  logoUrl: null, brandColour: null, timezone: "Europe/London", spaces: [],
};

interface Emulator {
  readonly deals: Map<string, PipelineOpportunity>;
  readonly history: Map<string, StageMove[]>;
  readonly moves: string[];
}

function deal(id: string, title: string, stage: OpportunityStage, due: string | null, extra: Partial<PipelineOpportunity> = {}): PipelineOpportunity {
  return {
    id, venueId: VENUE_ID, clientAccountId: null, primaryContactId: null, sourceEnquiryId: null, ownerUserId: STAFF_ID,
    title, stage, eventType: "wedding", preferredDate: "2027-06-05", guestCount: 160, estimatedValueMinor: 1_840_000, currency: "GBP",
    nextAction: "Chase their answer on the proposal", nextActionDueAt: due, createdAt: "2026-09-01T09:00:00.000Z",
    updatedAt: "2026-09-30T09:00:00.000Z", closedAt: null, deletedAt: null, contactName: "Ailsa Henderson", ...extra,
  };
}

const CLOSED = new Set<string>(["won", "lost"]);

/** As the API's "?order=due": open by due date (none last), then closed, newest closed first. */
function ordered(deals: Iterable<PipelineOpportunity>): PipelineOpportunity[] {
  return [...deals].filter((row) => row.stage !== "archived").sort((a, b) => {
    const closedA = CLOSED.has(a.stage);
    const closedB = CLOSED.has(b.stage);
    if (closedA !== closedB) return closedA ? 1 : -1;
    if (closedA) return Date.parse(b.closedAt ?? "") - Date.parse(a.closedAt ?? "");
    const dueA = a.nextActionDueAt === null ? Infinity : Date.parse(a.nextActionDueAt);
    const dueB = b.nextActionDueAt === null ? Infinity : Date.parse(b.nextActionDueAt);
    return dueA - dueB;
  });
}

async function openDesk(page: Page, width = 1440, height = 900): Promise<Emulator> {
  await page.setViewportSize({ width, height });
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(({ venueId, staffId }) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: { id: staffId, email: "catherine@pipeline.test", role: "staff", platformRole: "none", venueId, name: "Catherine Tait" },
      writable: false,
    });
  }, { venueId: VENUE_ID, staffId: STAFF_ID });

  const emulator: Emulator = {
    deals: new Map([
      [HENDERSON, deal(HENDERSON, "Henderson wedding", "proposal_sent", "2026-10-02T11:00:00.000Z")],
      [MERCHANTS, deal(MERCHANTS, "Merchants' dinner", "qualified", "2026-10-06T14:00:00.000Z",
        { eventType: "dinner", preferredDate: "2026-11-20", guestCount: 90, estimatedValueMinor: 620_000, contactName: "Iain Robertson",
          nextAction: "Draft the proposal" })],
      [GALA, deal(GALA, "Spring gala", "new", null,
        { eventType: "gala", preferredDate: null, guestCount: null, estimatedValueMinor: 0, contactName: null, nextAction: "Confirm the date" })],
    ]),
    // Before today, the client asked for changes on the Hendersons' first
    // version, and Catherine sent the second: a move nobody at the venue made
    // sits beside one she did.
    history: new Map([[HENDERSON, [
      { id: "00000000-0000-4000-8000-00000000c001", fromStage: "proposal_sent", toStage: "negotiation",
        note: "The client asked for changes to the proposal (version 1).", changedByName: null, createdAt: "2026-09-24T15:00:00.000Z" },
      { id: "00000000-0000-4000-8000-00000000c002", fromStage: "negotiation", toStage: "proposal_sent",
        note: "The proposal (version 2) was sent.", changedByName: "Catherine Tait", createdAt: "2026-09-26T10:00:00.000Z" },
    ]]]),
    moves: [],
  };
  // The Merchants' dinner was quoted at more than its estimate.
  const quotes = new Map([[MERCHANTS, {
    id: "00000000-0000-4000-8000-00000000b001", name: "Merchants' dinner proposal quote", status: "draft", currency: "GBP",
    totalMinor: 645_000, createdAt: "2026-10-05T16:00:00.000Z",
  }]]);

  const summary = (stage: string | null): Record<string, unknown> => {
    const all = [...emulator.deals.values()];
    const rows = ordered(all).filter((row) => stage === null || row.stage === stage);
    const count = (name: string): number => all.filter((row) => row.stage === name).length;
    const value = (name: string): number => all.filter((row) => row.stage === name).reduce((sum, row) => sum + row.estimatedValueMinor, 0);
    const stages = ["new", "qualified", "proposal_drafting", "proposal_sent", "negotiation", "won", "lost", "archived"];
    const open = all.filter((row) => !CLOSED.has(row.stage) && row.stage !== "archived");
    const day = (iso: string): string => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
    const today = day(NOW.toISOString());
    return {
      opportunities: rows,
      todayTasks: [],
      stageCounts: Object.fromEntries(stages.map((name) => [name, count(name)])),
      stageValues: Object.fromEntries(stages.map((name) => [name, value(name)])),
      due: {
        overdue: open.filter((row) => row.nextActionDueAt !== null && day(row.nextActionDueAt) < today).length,
        today: open.filter((row) => row.nextActionDueAt !== null && day(row.nextActionDueAt) === today).length,
      },
      pipelineValueMinor: open.reduce((sum, row) => sum + row.estimatedValueMinor, 0),
      currency: "GBP",
      page: { total: rows.length, limit: 50, offset: 0, taskTotal: 0, taskLimit: 50, taskOffset: 0 },
    };
  };

  await page.route(`${API}/**`, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/crm/pipeline") {
      void route.fulfill({ json: { data: summary(url.searchParams.get("stage")) } });
      return;
    }
    const match = /^\/opportunities\/([0-9a-f-]{36})$/u.exec(path);
    const current = match === null ? undefined : emulator.deals.get(match[1] ?? "");
    if (match !== null && current !== undefined) {
      const id = current.id;
      if (request.method() === "GET") {
        void route.fulfill({ json: { data: {
          opportunity: current, activities: [], tasks: [], proposals: [],
          history: [...(emulator.history.get(id) ?? [])].reverse(), contact: null, room: "Grand Hall",
          latestQuote: quotes.get(id) ?? null,
        } } });
        return;
      }
      if (request.method() === "PATCH") {
        const body = request.postDataJSON() as { stage?: OpportunityStage; note?: string | null; estimatedValueMinor?: number };
        const to = body.stage;
        if (to !== undefined && to !== current.stage) {
          if (!OPPORTUNITY_STAGE_TRANSITIONS[current.stage as OpportunityStage].includes(to)) {
            void route.fulfill({ status: 422, json: { error: `Cannot transition opportunity from ${current.stage} to ${to}`, code: "INVALID_TRANSITION" } });
            return;
          }
          if (CLOSED.has(to) && (body.note ?? "").trim() === "") {
            void route.fulfill({ status: 422, json: { error: "Say why the deal was won or lost.", code: "REASON_REQUIRED" } });
            return;
          }
          emulator.moves.push(`${to}|${body.note ?? ""}`);
          const moves = emulator.history.get(id) ?? [];
          moves.push({ id: `${id.slice(0, -4)}a${String(moves.length).padStart(3, "0")}`, fromStage: current.stage, toStage: to,
            note: body.note ?? null, changedByName: "Catherine Tait", createdAt: NOW.toISOString() });
          emulator.history.set(id, moves);
        }
        const next: PipelineOpportunity = {
          ...current,
          ...(to === undefined ? {} : { stage: to, closedAt: CLOSED.has(to) ? NOW.toISOString() : current.closedAt }),
          ...(body.estimatedValueMinor === undefined ? {} : { estimatedValueMinor: body.estimatedValueMinor }),
          updatedAt: NOW.toISOString(),
        };
        emulator.deals.set(id, next);
        const { contactName: _contactName, ...opportunity } = next;
        void route.fulfill({ json: { data: opportunity } });
        return;
      }
    }
    if (path === `/venues/${VENUE_ID}` || path === "/venues") {
      void route.fulfill({ json: { data: path === "/venues" ? [VENUE] : VENUE } });
    } else if (path === "/notifications/unread-count") {
      void route.fulfill({ json: { data: { unread: 0 } } });
    } else if (path.startsWith("/notifications")) {
      void route.fulfill({ json: { data: [] } });
    } else {
      void route.fulfill({ status: 404, json: { error: `Not emulated: ${path}` } });
    }
  });
  return emulator;
}

function dealRow(page: Page, title: string) {
  return page.locator(`button[data-deal-id][aria-label^="${title},"]`);
}

function groups(page: Page): Promise<string[]> {
  return page.locator(".enq-group").evaluateAll((headings) => headings.map((heading) => heading.firstChild?.textContent ?? ""));
}

test.describe("Pipeline desk", () => {
  test("a booker works what is owed from the keyboard, closing the overdue deal as won with its reason", async ({ page }) => {
    const emulator = await openDesk(page);
    await page.goto("/dashboard?view=pipeline");
    await expect(page.getByRole("main")).toHaveAccessibleName("Pipeline");
    await expect(page.getByTestId("pipeline-summary"))
      .toHaveText("1 deal has a step due today, and 1 is overdue. £24,600.00 is open across 3 deals.");
    await expect.poll(() => groups(page)).toEqual(["Overdue", "Due today", "No date set"]);
    await expect(page.getByRole("button", { name: "Proposal sent, 1, £18,400" })).toBeVisible();

    // The first row is the tab stop; the arrow keys and Enter open a deal.
    const henderson = dealRow(page, "Henderson wedding");
    await expect(henderson).toHaveAttribute("tabindex", "0");
    await henderson.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("region", { name: "Henderson wedding" });
    await expect(panel.getByRole("heading", { level: 2, name: "Henderson wedding" })).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`[?&]opportunity=${HENDERSON}`, "u"));
    await expect(panel.getByText("Overdue by 4 days")).toBeVisible();
    // The client's own act is told in its words; Catherine's names her.
    await expect(panel.getByText("The client asked for changes to the proposal (version 1).")).toBeVisible();
    await expect(panel.getByText("Catherine Tait moved it to Proposal sent.")).toBeVisible();

    // Won asks why before it moves, and offers the common reasons.
    await panel.getByRole("button", { name: "Mark won…" }).click();
    const confirm = page.getByTestId("deal-confirm-won");
    await expect(confirm.getByRole("button", { name: "Mark won" })).toBeDisabled();
    await confirm.getByRole("button", { name: "Accepted the proposal" }).click();
    await expect(confirm.getByRole("textbox", { name: "Why it was won" })).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type(" for 5 June");
    await confirm.getByRole("button", { name: "Mark won" }).click();
    await expect.poll(() => emulator.moves).toEqual(["won|Accepted the proposal for 5 June"]);

    // The deal says so, its history keeps the reason, and the ledger follows it.
    await expect(panel.locator(".enq-panel__status")).toContainText("Won");
    await expect(panel.getByText("Catherine Tait marked it won.")).toBeVisible();
    await expect(panel.getByText("Accepted the proposal for 5 June")).toBeVisible();
    await expect.poll(() => groups(page)).toEqual(["Due today", "No date set", "Won and lost"]);
    await expect(page.getByTestId("pipeline-summary"))
      .toHaveText("1 deal has a step due today. £6,200.00 is open across 2 deals.");

    // Won, it is last on the ledger; k moves to the deal before it, and the
    // address follows.
    await panel.getByRole("heading", { level: 2 }).press("k");
    await expect(page.getByRole("region", { name: "Spring gala" }).getByRole("heading", { level: 2 })).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`[?&]opportunity=${GALA}`, "u"));
  });

  test("the open deal survives a reload through its address, and the desk reads cleanly with it open", async ({ page }) => {
    await openDesk(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);
    await page.goto(`/dashboard?view=pipeline&opportunity=${MERCHANTS}`);
    const panel = page.getByRole("region", { name: "Merchants' dinner" });
    await expect(panel.getByRole("heading", { level: 2, name: "Merchants' dinner" })).toBeVisible();
    await page.reload();
    await expect(panel.getByRole("heading", { level: 2, name: "Merchants' dinner" })).toBeVisible();
    await expect(dealRow(page, "Merchants' dinner")).toHaveAttribute("aria-current", "true");
    // Only the moves Qualified allows: draft a proposal, or mark it lost.
    await expect(panel.getByRole("button", { name: "Draft a proposal" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Mark won…" })).toHaveCount(0);
    // Its latest quote is offered where its value is, for the audit to read.
    await expect(panel.getByText("The latest quote comes to £6,450.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Use £6,450" })).toBeVisible();

    const result = await collectAccessibilityAudit(page, {
      name: "pipeline desk with a deal open", path: "/dashboard?view=pipeline", problems, maxFocusSteps: 16,
    });
    expectAccessibilityAuditClean(result);
  });

  test("on a phone the deal replaces the ledger, Back to the pipeline returns to it, and nothing scrolls sideways", async ({ page }) => {
    await openDesk(page, 390, 844);
    await page.goto("/dashboard?view=pipeline");
    await dealRow(page, "Spring gala").click();
    await expect(page.getByRole("heading", { level: 2, name: "Spring gala" })).toBeFocused();
    await expect(page.getByRole("heading", { level: 1, name: "Pipeline" })).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.getByRole("button", { name: "Back to the pipeline" }).click();
    await expect(dealRow(page, "Spring gala")).toBeFocused();
    await expect(page).not.toHaveURL(/opportunity=/u);
  });
});
