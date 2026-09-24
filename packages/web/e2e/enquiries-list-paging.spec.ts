import { expect, test, type Page } from "@playwright/test";
import type { Enquiry } from "../src/api/enquiries.js";

// ---------------------------------------------------------------------------
// E2E: the staff Enquiries list with more than one page of enquiries.
//
// GET /enquiries is emulated as the API serves it: a { data, meta } envelope
// of one limit/offset page, newest first (echoing meta.order) when asked for
// order=created_desc. The legacy case mirrors an API that predates `order`:
// it ignores the parameter, keeps least recently updated first and omits
// meta.order, as master's route does while the web deploys ahead of it.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const VENUE_ID = "00000000-0000-4000-8000-000000007001";
const SPACE_ID = "00000000-0000-4000-8000-000000007002";
const DAY_MS = 86_400_000;

function enquiry(n: number): Enquiry {
  const created = Date.UTC(2026, 8, 24, 9) - (57 - n) * DAY_MS;
  return {
    id: `00000000-0000-4000-8000-${String(700_000_000_000 + n)}`,
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    configurationId: null,
    userId: null,
    guestEmail: null,
    guestPhone: null,
    guestName: null,
    state: n % 3 === 0 ? "approved" : "submitted",
    name: `Enquiry ${String(n).padStart(2, "0")}`,
    email: `enquiry${String(n)}@paging.test`,
    preferredDate: null,
    eventType: "Dinner",
    estimatedGuests: 80,
    message: null,
    createdAt: new Date(created).toISOString(),
    // Older enquiries are often the most recently touched.
    updatedAt: new Date(created + ((n * 37) % 23) * DAY_MS).toISOString(),
  };
}

const ENQUIRIES: readonly Enquiry[] = Array.from({ length: 57 }, (_, index) => enquiry(index + 1));
const byUpdated = [...ENQUIRIES].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));

async function seedStaff(page: Page): Promise<void> {
  await page.addInitScript(({ venueId }) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: {
        id: "00000000-0000-4000-8000-000000007091",
        email: "staff@paging.test",
        role: "staff",
        platformRole: "none",
        venueId,
        name: "Staff Paging",
      },
      writable: false,
    });
  }, { venueId: VENUE_ID });
}

/** Emulates the API; returns the query strings of every list request. */
async function mockApi(page: Page, legacy: boolean): Promise<string[]> {
  const listRequests: string[] = [];
  await page.route(`${API}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/enquiries") {
      listRequests.push(url.search);
      const status = url.searchParams.get("status");
      const newestFirst = !legacy && url.searchParams.get("order") === "created_desc";
      const limit = Number(url.searchParams.get("limit") ?? "20");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const rows = ENQUIRIES
        .filter((row) => status === null || row.state === status)
        .sort(newestFirst
          ? (left, right) => right.createdAt.localeCompare(left.createdAt)
          : (left, right) => left.updatedAt.localeCompare(right.updatedAt));
      const meta = legacy
        ? { total: rows.length, limit, offset }
        : { total: rows.length, limit, offset, order: newestFirst ? "created_desc" : "updated_asc" };
      void route.fulfill({ json: { data: rows.slice(offset, offset + limit), meta } });
      return;
    }
    if (url.pathname === `/venues/${VENUE_ID}` || url.pathname === "/venues") {
      const venue = { id: VENUE_ID, name: "Trades Hall Glasgow", slug: "trades-hall", address: "85 Glassford Street",
        logoUrl: null, brandColour: null, spaces: [] };
      void route.fulfill({ json: { data: url.pathname === "/venues" ? [venue] : venue } });
      return;
    }
    if (url.pathname.startsWith("/notifications")) {
      void route.fulfill({ json: { data: [] } });
      return;
    }
    void route.fulfill({ status: 404, json: { error: `Not mocked: ${url.pathname}` } });
  });
  return listRequests;
}

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => { errors.push(error.message); });
  return errors;
}

const cards = (page: Page) => page.getByRole("main").getByRole("button").filter({ hasText: /@paging\.test/u });
const countNote = (page: Page) => page.getByTestId("enquiry-list-count");

test.describe("Staff enquiries list paging", () => {
  test("lists the newest enquiries first, says how many exist and shows more on request", async ({ page }) => {
    const errors = watchPageErrors(page);
    await seedStaff(page);
    const requests = await mockApi(page, false);
    await page.goto("/dashboard?view=enquiries");

    await expect(countNote(page)).toHaveText("Showing 20 of 57 enquiries, newest first");
    await expect(cards(page)).toHaveCount(20);
    await expect(cards(page).first()).toContainText("Enquiry 57");
    expect(requests).toContain("?order=created_desc&limit=20&offset=0");

    await page.getByRole("button", { name: "Show 20 more" }).click();
    await expect(countNote(page)).toHaveText("Showing 40 of 57 enquiries, newest first");
    await expect(cards(page)).toHaveCount(40);
    await expect(cards(page).nth(20)).toContainText("Enquiry 37");
    expect(requests).toContain("?order=created_desc&limit=25&offset=15");

    await page.getByRole("button", { name: "Show 17 more" }).click();
    await expect(countNote(page)).toHaveText("Showing all 57 enquiries, newest first");
    await expect(cards(page)).toHaveCount(57);
    await expect(cards(page).last()).toContainText("Enquiry 01");
    await expect(page.getByTestId("enquiry-list-more")).toHaveCount(0);

    await page.getByRole("button", { name: "Submitted", exact: true }).click();
    await expect(countNote(page)).toHaveText("Showing 20 of 38 submitted enquiries, newest first");
    await expect(cards(page)).toHaveCount(20);
    expect(requests).toContain("?status=submitted&order=created_desc&limit=20&offset=0");
    expect(errors).toEqual([]);
  });

  test("keeps working without an order claim against an API that predates ordering", async ({ page }) => {
    const errors = watchPageErrors(page);
    await seedStaff(page);
    await mockApi(page, true);
    await page.goto("/dashboard?view=enquiries");

    await expect(countNote(page)).toHaveText("Showing 20 of 57 enquiries");
    await expect(cards(page).first()).toContainText(byUpdated[0]?.name ?? "missing fixture");
    await expect(page.getByRole("alert")).toHaveCount(0);

    await page.getByRole("button", { name: "Show 20 more" }).click();
    await expect(countNote(page)).toHaveText("Showing 40 of 57 enquiries");
    await expect(cards(page)).toHaveCount(40);
    expect(errors).toEqual([]);
  });
});
