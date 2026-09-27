import { expect, test, type Page } from "@playwright/test";
import type { Enquiry } from "../src/api/enquiries.js";
import type { Opportunity } from "../src/api/crm.js";

// ---------------------------------------------------------------------------
// E2E: the Enquiries desk hands a lead on (roadmap N6).
//
// Create opportunity lands on the deal, selected in the pipeline beside the
// board, and a second press lands on the same deal rather than making another
// or saying one was "opened" somewhere else. The API is emulated as it serves
// the desk and the pipeline, and it answers a second press as the real route
// does: with the deal the first made.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const VENUE_ID = "00000000-0000-4000-8000-000000008101";
const SPACE_ID = "00000000-0000-4000-8000-000000008102";
const ENQUIRY_ID = "00000000-0000-4000-8000-000000008103";
const DEAL_ID = "00000000-0000-4000-8000-000000008104";
const NOW = "2026-09-27T09:00:00.000Z";

const ENQUIRY: Enquiry = {
  id: ENQUIRY_ID, venueId: VENUE_ID, spaceId: SPACE_ID, configurationId: null, userId: null,
  guestEmail: "elaine@handoff.test", guestPhone: null, guestName: "Elaine Fraser", state: "approved",
  name: "Elaine Fraser", email: "elaine@handoff.test", preferredDate: "2027-05-14", eventType: "wedding",
  estimatedGuests: 120, message: "Is Saturday 14 May free?", source: "walkthrough", roomChosen: false,
  createdAt: NOW, updatedAt: NOW,
};

const DEAL: Opportunity = {
  id: DEAL_ID, venueId: VENUE_ID, clientAccountId: null, primaryContactId: null, sourceEnquiryId: ENQUIRY_ID,
  ownerUserId: null, title: "wedding — Elaine Fraser", stage: "new", eventType: "wedding", preferredDate: "2027-05-14",
  guestCount: 120, estimatedValueMinor: 0, currency: "GBP",
  nextAction: "Prepare a proposal draft and confirm room, date, and guest-count assumptions with the client.",
  nextActionDueAt: null, createdAt: NOW, updatedAt: NOW, closedAt: null, deletedAt: null,
};

interface Presses { made: number; answered: string[] }

async function openDesk(page: Page): Promise<Presses> {
  await page.addInitScript(({ venueId }) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: { id: "00000000-0000-4000-8000-000000008191", email: "staff@handoff.test", role: "staff", platformRole: "none", venueId, name: "Staff Handoff" },
      writable: false,
    });
  }, { venueId: VENUE_ID });
  const presses: Presses = { made: 0, answered: [] };
  await page.route(`${API}/**`, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/enquiries") {
      void route.fulfill({ json: { data: [ENQUIRY], meta: { total: 1, limit: 20, offset: 0, order: "created_desc" } } });
    } else if (url.pathname === `/enquiries/${ENQUIRY_ID}/history`) {
      void route.fulfill({ json: { data: [] } });
    } else if (url.pathname === `/enquiries/${ENQUIRY_ID}`) {
      void route.fulfill({ json: { data: ENQUIRY } });
    } else if (url.pathname === `/crm/from-enquiry/${ENQUIRY_ID}` && request.method() === "POST") {
      // The real route makes one deal per enquiry and answers every later
      // press with it.
      const created = presses.made === 0;
      presses.made += 1;
      presses.answered.push(DEAL_ID);
      void route.fulfill({
        status: created ? 201 : 200,
        json: { data: { created, opportunity: DEAL, clientAccount: null, contact: null, followUpTask: null } },
      });
    } else if (url.pathname === "/crm/pipeline") {
      const opportunities = presses.made === 0 ? [] : [DEAL];
      void route.fulfill({ json: { data: {
        opportunities, todayTasks: [], stageCounts: { new: opportunities.length }, pipelineValueMinor: 0, currency: "GBP",
        page: { total: opportunities.length, limit: 50, offset: 0, taskTotal: 0, taskLimit: 50, taskOffset: 0 },
      } } });
    } else if (url.pathname === `/opportunities/${DEAL_ID}`) {
      void route.fulfill({ json: { data: { opportunity: DEAL, activities: [], tasks: [], proposals: [] } } });
    } else if (url.pathname === `/venues/${VENUE_ID}` || url.pathname === "/venues") {
      const venue = { id: VENUE_ID, name: "Trades Hall Glasgow", slug: "trades-hall", address: "85 Glassford Street",
        logoUrl: null, brandColour: null, spaces: [{ id: SPACE_ID, venueId: VENUE_ID, name: "Grand Hall", slug: "grand-hall",
          widthM: "21", lengthM: "10.5", heightM: "7", floorPlanOutline: [] }] };
      void route.fulfill({ json: { data: url.pathname === "/venues" ? [venue] : venue } });
    } else if (url.pathname === "/notifications/unread-count") {
      void route.fulfill({ json: { data: { unread: 0 } } });
    } else if (url.pathname.startsWith("/notifications")) {
      void route.fulfill({ json: { data: [] } });
    } else {
      void route.fulfill({ status: 404, json: { error: `Not mocked: ${url.pathname}` } });
    }
  });
  await page.goto("/dashboard?view=enquiries");
  return presses;
}

async function pressCreateOpportunity(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Elaine Fraser,/u }).click();
  await page.getByRole("region", { name: "Elaine Fraser" }).getByRole("button", { name: "Create opportunity" }).click();
}

test.describe("Enquiries desk, handing a lead on", () => {
  test("Create opportunity lands on the deal, selected in the pipeline, and a second press lands on the same deal", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const presses = await openDesk(page);

    await pressCreateOpportunity(page);
    await expect(page).toHaveURL(new RegExp(`[?&]view=pipeline&opportunity=${DEAL_ID}$`, "u"));
    const detail = page.getByLabel("Opportunity detail");
    await expect(detail.getByRole("heading", { name: DEAL.title })).toBeVisible();
    // The board is beside it, with the deal on it.
    await expect(page.getByTestId(`opportunity-${DEAL_ID}`)).toBeVisible();
    // No notice claims the deal was opened somewhere else.
    await expect(page.getByText("Existing opportunity opened")).toHaveCount(0);

    // Back to the desk, and a second press lands on the same deal.
    await page.goBack();
    await expect(page).toHaveURL(/view=enquiries/u);
    await pressCreateOpportunity(page);
    await expect(page).toHaveURL(new RegExp(`[?&]view=pipeline&opportunity=${DEAL_ID}$`, "u"));
    await expect(page.getByLabel("Opportunity detail").getByRole("heading", { name: DEAL.title })).toBeVisible();
    expect(presses.made).toBe(2);
    expect(presses.answered).toEqual([DEAL_ID, DEAL_ID]);
    await expect(page.getByText("Existing opportunity opened")).toHaveCount(0);
  });
});
