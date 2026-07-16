import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import {
  FIONA,
  GRAHAM,
  fillDrawerTimes,
  openSeededWeek,
  signInCoordinator,
} from "./support/diary-live.js";

// ---------------------------------------------------------------------------
// The Diary, live end-to-end (Slice 4, T-518). No route stubs, no auth
// bypass, no mocks: two coordinators sign in through the real Clerk dev
// instance and work the Board against the API on the local dev database
// (infra/dev-db/ — migrations 0050/0051 applied, Trades Hall week seeded).
//
// Proven here, in order:
//   1. the seeded week renders from the live GET /calendar read model
//   2. the drawer writes a real booking (create → toast → block)
//   3. a public enquiry becomes a pencil via the tray (T-496, live)
//   4. the btree_gist exclusion arbitrates a real two-coordinator ink race
//      (Postgres 23P01 → 409 INK_SLOT_TAKEN → drawer copy) (T-487/T-495)
//   5. the ws live channel: a booking created by one coordinator appears on
//      the other's board without any reload, and presence shows both
//      (T-497)
//
// Serial: the tests share signed-in contexts and build on each other's
// state. Each run uses unique titles + a run-scoped slot so repeated runs
// against the same dev DB do not collide; the race test releases its ink.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

// Unique-per-run tag + a run-scoped free slot inside the seeded week.
// Seeded bookings all start 08:00+, so 00:15–05:45 windows stay clear;
// the minute offset varies per run to dodge leftovers from earlier runs.
const RUN_TAG = new Date().toISOString().slice(11, 19).replace(/:/gu, "");
const SLOT_MINUTE = ((Date.now() >> 6) % 4) * 15;
const slot = (day: string, hour: number, durationMinutes: number): [string, string] => {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const endTotal = hour * 60 + SLOT_MINUTE + durationMinutes;
  return [
    `2026-09-${day}T${pad(hour)}:${pad(SLOT_MINUTE)}`,
    `2026-09-${day}T${pad(Math.floor(endTotal / 60))}:${pad(endTotal % 60)}`,
  ];
};

let contextA: BrowserContext;
let contextB: BrowserContext;
let pageA: Page;
let pageB: Page;

async function coordinatorPage(
  browser: Browser,
  who: typeof FIONA,
): Promise<[BrowserContext, Page]> {
  const context = await browser.newContext({ timezoneId: "Europe/London" });
  const page = await context.newPage();
  await signInCoordinator(page, who);
  return [context, page];
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000); // the first ever run registers both Clerk test users
  [contextA, pageA] = await coordinatorPage(browser, FIONA);
  [contextB, pageB] = await coordinatorPage(browser, GRAHAM);
});

test.afterAll(async () => {
  await contextA.close();
  await contextB.close();
});

test("the seeded Trades Hall week renders from the live calendar", async () => {
  await openSeededWeek(pageA);
  // Seeded rooms as lanes…
  await expect(pageA.getByText("Saloon").first()).toBeVisible();
  // …a seeded ink from db/seed.ts…
  await expect(pageA.getByText("Chamber of Commerce conference").first()).toBeVisible();
  // …the honest turnaround status over real turnaround_rules…
  await expect(pageA.getByText(/Turnaround gaps:/).first()).toBeVisible();
  // …and the claim-safe disclosure.
  await expect(pageA.getByText(/Planning support only/).first()).toBeVisible();
});

test("the drawer writes a real booking into the diary", async () => {
  const title = `House block ${RUN_TAG}`;
  const [starts, ends] = slot("15", 1, 60);

  await pageA.getByRole("button", { name: "New booking" }).click();
  const drawer = pageA.getByRole("dialog", { name: "New booking" });
  await expect(drawer).toBeVisible();

  await drawer.getByLabel("Commitment").selectOption({ label: "House block" });
  await drawer.getByLabel("Room").selectOption({ label: "Robert Adam Room" });
  await drawer.getByLabel("Title", { exact: true }).fill(title);
  await drawer.getByLabel("Event type").fill("maintenance");
  await fillDrawerTimes(drawer, starts, ends);
  await drawer.getByRole("button", { name: "Add to the diary" }).click();

  await expect(pageA.getByText(`Added ${title} to the diary.`)).toBeVisible({ timeout: 15_000 });
  await expect(pageA.getByRole("button", { name: new RegExp(title) })).toBeVisible();
});

test("a public enquiry becomes a pencil through the tray (T-496)", async () => {
  const guest = `Isla Munro ${RUN_TAG}`;
  const [starts, ends] = slot("16", 1, 120);

  // The real public funnel — the same endpoint the website form posts to.
  const apiOrigin = process.env["E2E_API_URL"] ?? "http://localhost:3001";
  const response = await pageA.request.post(`${apiOrigin}/public/enquiries`, {
    data: {
      venueSlug: "trades-hall-glasgow",
      email: `isla.munro+${RUN_TAG}@example.com`,
      name: guest,
      eventType: "ceilidh",
      eventDate: "2026-09-16",
      guestCount: 90,
    },
  });
  expect(response.ok()).toBe(true);

  // A fresh load lists it under Open enquiries.
  await openSeededWeek(pageA);
  const enquiryRow = pageA.locator(".diary-tray-enquiry", { hasText: guest });
  await expect(enquiryRow).toBeVisible({ timeout: 15_000 });
  await enquiryRow.getByRole("button", { name: "Pencil in…" }).click();

  const drawer = pageA.getByRole("dialog", { name: "Pencil in this enquiry" });
  await expect(drawer).toBeVisible();
  await expect(
    pageA.getByText(new RegExp(`Turning ${guest}'s enquiry into a pencil`)),
  ).toBeVisible();

  await fillDrawerTimes(drawer, starts, ends);
  await drawer.getByLabel("Ladder position").fill("1");
  await drawer.getByLabel("Decision date").fill("2026-08-28T12:00");
  await drawer.getByLabel("Next action", { exact: true }).fill(`Call ${guest} with a quote.`);
  await drawer.getByLabel("Next action due").fill("2026-08-21T09:00");
  await drawer.getByRole("button", { name: "Pencil it in" }).click();

  await expect(pageA.getByText(/^Pencilled in /)).toBeVisible({ timeout: 15_000 });
  await expect(pageA.getByRole("button", { name: new RegExp(guest) }).first()).toBeVisible();
});

test("the exclusion constraint arbitrates a live two-coordinator ink race (T-487)", async () => {
  const [starts, ends] = slot("17", 2, 90);
  const titleA = `Ink race winner ${RUN_TAG}`;
  const titleB = `Ink race loser ${RUN_TAG}`;

  await openSeededWeek(pageA);
  await openSeededWeek(pageB);

  // Self-healing: a crashed earlier run can leave its winner ink active in
  // this window — cancel any leftovers through the lifecycle UI first.
  for (let sweep = 0; sweep < 4; sweep += 1) {
    const leftover = pageA.getByRole("button", { name: /^Ink race winner / }).first();
    if (!(await leftover.isVisible().catch(() => false))) break;
    await leftover.focus();
    await pageA.keyboard.press("Enter");
    await expect(pageA.getByRole("dialog", { name: "Booking details" })).toBeVisible();
    await pageA.getByRole("button", { name: "Cancel the ink" }).click();
    await expect(pageA.getByText(/^Cancel the ink: /)).toBeVisible({ timeout: 15_000 });
    await pageA.waitForTimeout(500); // let the refetch settle before re-checking
  }

  // Both coordinators draft an ink for the SAME Saloon slot…
  for (const [page, title] of [
    [pageA, titleA],
    [pageB, titleB],
  ] as const) {
    await page.getByRole("button", { name: "New booking" }).click();
    const drawer = page.getByRole("dialog", { name: "New booking" });
    await expect(drawer).toBeVisible();
    await drawer.getByLabel("Commitment").selectOption({ label: "Inked — confirmed" });
    await drawer.getByLabel("Room").selectOption({ label: "Saloon" });
    await drawer.getByLabel("Title", { exact: true }).fill(title);
    await drawer.getByLabel("Event type").fill("dinner");
    await fillDrawerTimes(drawer, starts, ends);
  }

  // …A lands first…
  await pageA.getByRole("button", { name: "Add to the diary" }).click();
  await expect(pageA.getByText(`Added ${titleA} to the diary.`)).toBeVisible({ timeout: 15_000 });

  // …and when B submits the identical slot, Postgres itself (23P01 → 409
  // INK_SLOT_TAKEN) refuses the double-book and the drawer says so.
  await pageB.getByRole("button", { name: "Add to the diary" }).click();
  await expect(
    pageB.getByText("That slot was just inked by someone else — the board has been refreshed."),
  ).toBeVisible({ timeout: 15_000 });
  await pageB.getByRole("button", { name: "Discard" }).click();

  // Housekeeping so repeated runs find the slot free: cancel the winning ink
  // through the shared lifecycle matrix (also exercises T-495 transitions).
  const winner = pageA.getByRole("button", { name: new RegExp(titleA) }).first();
  await winner.focus();
  await pageA.keyboard.press("Enter");
  await expect(pageA.getByRole("dialog", { name: "Booking details" })).toBeVisible();
  await pageA.getByRole("button", { name: "Cancel the ink" }).click();
  await expect(pageA.getByText(/^Cancel the ink: /)).toBeVisible({ timeout: 15_000 });
});

test("the live channel carries a colleague's booking without a reload (T-497)", async () => {
  const title = `Live wire ${RUN_TAG}`;
  const [starts, ends] = slot("18", 3, 45);

  await openSeededWeek(pageA);
  await openSeededWeek(pageB);

  // Presence: two distinct coordinators on the same venue channel.
  await expect(pageA.getByText("Live · 2")).toBeVisible({ timeout: 20_000 });
  await expect(pageB.getByText("Live · 2")).toBeVisible({ timeout: 20_000 });

  // A creates; B must see it arrive with NO navigation — diary.changed over
  // /ws/diary triggers the refetch (snapshot doctrine).
  await pageA.getByRole("button", { name: "New booking" }).click();
  const drawer = pageA.getByRole("dialog", { name: "New booking" });
  await drawer.getByLabel("Commitment").selectOption({ label: "House block" });
  await drawer.getByLabel("Room").selectOption({ label: "North Gallery" });
  await drawer.getByLabel("Title", { exact: true }).fill(title);
  await drawer.getByLabel("Event type").fill("turnaround");
  await fillDrawerTimes(drawer, starts, ends);
  await drawer.getByRole("button", { name: "Add to the diary" }).click();
  await expect(pageA.getByText(`Added ${title} to the diary.`)).toBeVisible({ timeout: 15_000 });

  await expect(pageB.getByRole("button", { name: new RegExp(title) })).toBeVisible({
    timeout: 15_000,
  });
});
