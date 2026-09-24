import { expect, test, type Page } from "@playwright/test";
import type { Enquiry } from "../src/api/enquiries.js";

// ---------------------------------------------------------------------------
// E2E: the staff Enquiries desk with more than one page of enquiries.
//
// GET /enquiries is emulated as the API serves it: a { data, meta } envelope
// of one limit/offset page, newest first (echoing meta.order) when asked for
// order=created_desc. The legacy case mirrors an API that predates `order`:
// it ignores the parameter, keeps least recently updated first and omits
// meta.order, as master's route does while the web deploys ahead of it.
// Transitions follow the staff state machine, so a triage run moves real
// counts.
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

const STAFF_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  submitted: ["under_review", "withdrawn"],
  under_review: ["approved", "rejected", "withdrawn"],
};

interface MockedApi {
  /** The query strings of every list request. */
  readonly listRequests: string[];
  /** The body of every accepted status change. */
  readonly transitions: unknown[];
}

/** Emulates the API over a fresh copy of the fixtures. */
async function mockApi(page: Page, legacy: boolean): Promise<MockedApi> {
  const listRequests: string[] = [];
  const transitions: unknown[] = [];
  const enquiries: Enquiry[] = ENQUIRIES.map((row) => ({ ...row }));
  await page.route(`${API}/**`, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const single = /^\/enquiries\/([^/]+)(\/history|\/transition)?$/u.exec(url.pathname);
    if (single !== null) {
      const row = enquiries.find((candidate) => candidate.id === single[1]);
      if (row === undefined) {
        void route.fulfill({ status: 404, json: { error: "Enquiry not found", code: "NOT_FOUND" } });
      } else if (single[2] === "/history") {
        void route.fulfill({ json: { data: [] } });
      } else if (single[2] === "/transition" && request.method() === "POST") {
        const body = request.postDataJSON() as { readonly status: string; readonly note?: string };
        if (!(STAFF_TRANSITIONS[row.state] ?? []).includes(body.status)) {
          void route.fulfill({ status: 422, json: { error: "Cannot transition", code: "INVALID_TRANSITION" } });
          return;
        }
        transitions.push(body);
        row.state = body.status;
        row.updatedAt = new Date().toISOString();
        void route.fulfill({ json: { data: row } });
      } else {
        void route.fulfill({ json: { data: row } });
      }
      return;
    }
    if (url.pathname === "/enquiries") {
      listRequests.push(url.search);
      const status = url.searchParams.get("status");
      const newestFirst = !legacy && url.searchParams.get("order") === "created_desc";
      const limit = Number(url.searchParams.get("limit") ?? "20");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const rows = enquiries
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
        logoUrl: null, brandColour: null, spaces: [{ id: SPACE_ID, venueId: VENUE_ID, name: "Grand Hall", slug: "grand-hall",
          widthM: "21", lengthM: "10.5", heightM: "7", floorPlanOutline: [] }] };
      void route.fulfill({ json: { data: url.pathname === "/venues" ? [venue] : venue } });
      return;
    }
    if (url.pathname.startsWith("/notifications")) {
      void route.fulfill({ json: { data: [] } });
      return;
    }
    void route.fulfill({ status: 404, json: { error: `Not mocked: ${url.pathname}` } });
  });
  return { listRequests, transitions };
}

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => { errors.push(error.message); });
  return errors;
}

const cards = (page: Page) => page.getByRole("main").locator("button[data-enquiry-id]");
const countNote = (page: Page) => page.getByTestId("enquiry-list-count");
const stage = (page: Page, label: string) => page.getByRole("button", { name: new RegExp(`^${label}(, [\\d,]+)?$`, "u") });

test.describe("Staff enquiries list paging", () => {
  test("lists the newest enquiries first, says how many exist and shows more on request", async ({ page }) => {
    const errors = watchPageErrors(page);
    await seedStaff(page);
    const { listRequests: requests } = await mockApi(page, false);
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

    await stage(page, "New").click();
    await expect(countNote(page)).toHaveText("Showing 20 of 38 new enquiries, newest first");
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

  test("triages beside the list: a review starts at once, an approval names its email, and the counts follow", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors = watchPageErrors(page);
    await seedStaff(page);
    const { transitions } = await mockApi(page, false);
    await page.goto("/dashboard?view=enquiries");

    await expect(page.getByRole("button", { name: "New, 38" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Desk overview" })).toBeVisible();
    await stage(page, "New").click();
    await expect(countNote(page)).toHaveText("Showing 20 of 38 new enquiries, newest first");
    await expect(cards(page).first()).toContainText("Enquiry 56");
    await expect(cards(page).first()).toContainText("Grand Hall");

    await cards(page).first().click();
    const opened = page.getByRole("heading", { name: "Enquiry 56", level: 2 });
    await expect(opened).toBeFocused();
    // The requested room is pictured from the venue's own photographs.
    await expect(page.locator(".enq-room-photo img")).toHaveJSProperty("complete", true);
    expect(await page.locator(".enq-room-photo img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    // The list keeps its place beside the open enquiry.
    await expect(page.getByRole("heading", { name: "Enquiries", level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "Start review", exact: true }).click();
    await expect(page.getByRole("button", { name: "Approve…" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New, 37" })).toBeVisible();
    await expect(page.getByRole("button", { name: "In review, 1" })).toBeVisible();
    await expect(cards(page).first()).toContainText("Enquiry 55");

    await page.getByRole("button", { name: "Approve…" }).click();
    const confirm = page.getByRole("group", { name: "Approve Enquiry 56’s enquiry?" });
    await expect(confirm).toContainText("Approving emails enquiry56@paging.test to say the enquiry is approved.");
    await confirm.getByRole("textbox").fill("Deposit invoice sent.");
    await confirm.getByRole("button", { name: "Approve and email" }).click();
    await expect(page.locator(".enq-panel .enq-chip")).toHaveText("Approved");
    await expect(page.getByRole("button", { name: "In review, 0" })).toBeVisible();
    expect(transitions).toEqual([{ status: "under_review" }, { status: "approved", note: "Deposit invoice sent." }]);

    // j opens the enquiry that took its place in the list; Escape returns to that row.
    await page.keyboard.press("j");
    await expect(page.getByRole("heading", { name: "Enquiry 55", level: 2 })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(cards(page).first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(cards(page).nth(1)).toBeFocused();
    expect(errors).toEqual([]);
  });
});
