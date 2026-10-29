import { expect, test, type Page, type Route } from "@playwright/test";
import { CalendarResponseSchema, VenueRequestSchema, type VenueRequest } from "@omnitwin/types";
import { unreadableText } from "./support/readability.js";

// ---------------------------------------------------------------------------
// E2E: a request step pressed with no connection (L9), route-mocked.
//
// The hallkeeper presses "I’ll do it" in a corner with no signal. The press
// cannot reach the house, so the card says it is waiting to send, and still
// says what the house last said (nobody owns it yet). The waiting press is
// kept in the browser's own store, so it survives a reload, and goes when the
// connection comes back, under the key it was pressed with, so the house's
// ledger meets it as that press and never as a second one. When someone else
// took it first, the slot says so by name and the press is put away. The
// ledger's side of this (one transition however often a key is sent, the
// refusal of a revoked person) is proved against PostgreSQL by
// requests-offline-replay-postgres.test.ts.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const VENUE = "20000000-0000-4000-8000-000000000002";
const HALL = { id: "30000000-0000-4000-8000-000000000001", name: "Grand Hall", slug: "grand-hall" };
const BOOKING = "50000000-0000-4000-8000-000000000002";
const REQUEST = "90000000-0000-4000-8000-000000000001";
const ELAINE = "e0000000-0000-4000-8000-000000000001";
const MORAG = "e0000000-0000-4000-8000-000000000002";
const GRAHAM = "e0000000-0000-4000-8000-000000000004";
/** 13:00 in Glasgow on Saturday 3 October 2026. */
const NOW = new Date("2026-10-03T12:00:00.000Z");
const at = (hhmm: string, day = "2026-10-03"): string => new Date(`${day}T${hhmm}:00.000+01:00`).toISOString();

const DAY = CalendarResponseSchema.parse({
  venueId: VENUE,
  range: { from: at("00:00"), to: at("00:00", "2026-10-04") },
  rooms: [{ id: HALL.id, name: HALL.name, slug: HALL.slug, sortOrder: 0 }],
  entries: [{
    entryType: "booking", id: BOOKING, spaceId: HALL.id, kind: "ink", status: "active", state: "ink", title: "Chamber dinner",
    eventType: "dinner", startsAt: at("13:05"), endsAt: at("16:00"), rank: null, jointFlag: false, decisionAt: null,
    ownerUserId: null, nextAction: null, nextActionDueAt: null, eventId: null, seriesId: null, guestCount: 120,
  }],
  conflicts: {
    conflicts: [],
    checks: {
      inkDoubleBook: { status: "checked" }, holdOverlap: { status: "checked" },
      turnaround: { status: "checked", uncoveredPairCount: 0, detail: "All gaps covered." },
    },
  },
});

function request(over: Partial<VenueRequest> = {}): VenueRequest {
  return VenueRequestSchema.parse({
    id: REQUEST, venueId: VENUE, bookingId: BOOKING, eventId: null, roomId: HALL.id, roomName: HALL.name,
    kind: "chairs", quantity: 10, urgency: "soon", detail: "Ten more for the top table, please.",
    requestedByUserId: MORAG, requestedByName: "Morag", requestedByRole: "staff",
    audienceRoles: ["admin", "manager", "staff", "hallkeeper"], ownerUserId: null, ownerName: null, state: "sent",
    outcome: null, outcomeNote: null, escalationDueAt: null, escalatedAt: null, acknowledgedAt: null, acceptedAt: null,
    resolvedAt: null, threadId: null, handoverToUserId: null, handoverToName: null, handedOverAt: null,
    underwayAt: null, reopenedAt: null, createdAt: at("12:57"), updatedAt: at("12:57"), ...over,
  });
}

const json = (route: Route, data: unknown, status = 200): Promise<void> => route.fulfill({ status, json: { data } });

interface House {
  current: VenueRequest;
  /** What the step route does with the next press: drop it as a lost signal, take it, or refuse it. */
  answer: "no-signal" | "take" | "taken-by-graham";
  readonly steps: { readonly key: string | null; readonly body: unknown }[];
}

async function openTheHall(page: Page, house: House): Promise<void> {
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.clock.setFixedTime(NOW);
  await page.addInitScript((seeded) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: seeded, writable: false });
  }, { id: ELAINE, email: "hallkeeper@e2e.test", role: "hallkeeper", venueId: VENUE, name: "Elaine" });

  await page.route(`${API}/calendar?**`, (route) => json(route, DAY));
  await page.route(`${API}/venues/${VENUE}`, (route) => json(route, {
    id: VENUE, name: "Trades Hall Glasgow", slug: "trades-hall-glasgow", address: "85 Glassford Street",
    logoUrl: null, brandColour: null, timezone: "Europe/London", spaces: [],
  }));
  await page.route(`${API}/notifications**`, (route) => json(route, []));
  await page.route(`${API}/venues/${VENUE}/requests?**`, (route) => json(route, [house.current]));
  await page.route(`${API}/venues/${VENUE}/threads?**`, (route) => json(route, []));
  await page.route(`${API}/requests/${REQUEST}`, (route) => {
    house.steps.push({ key: route.request().headers()["idempotency-key"] ?? null, body: route.request().postDataJSON() });
    if (house.answer === "no-signal") return route.abort("internetdisconnected");
    if (house.answer === "taken-by-graham") {
      house.current = request({ state: "accepted", ownerUserId: GRAHAM, ownerName: "Graham", acceptedAt: at("13:00") });
      return route.fulfill({ status: 409, json: { error: "Graham has this.", code: "REQUEST_TAKEN", ownerName: "Graham" } });
    }
    house.current = request({ state: "accepted", ownerUserId: ELAINE, ownerName: "Elaine", acceptedAt: at("13:00") });
    return json(route, house.current);
  });

  await page.goto("/hallkeeper/today");
  await page.getByRole("button", { name: /^Chamber dinner,/u }).click();
}

function requestsRegion(page: Page) {
  return page.getByRole("region", { name: "Grand Hall: Chamber dinner" }).getByRole("region", { name: "Requests for Grand Hall" });
}

/** The browser goes offline and comes back: the page hears "online". */
async function signalReturns(page: Page): Promise<void> {
  await page.context().setOffline(true);
  await page.context().setOffline(false);
}

test.describe("A request step pressed with no connection", () => {
  test("waits to send, survives a reload, and goes as the same press when the connection is back", async ({ page }, testInfo) => {
    const house: House = { current: request(), answer: "no-signal", steps: [] };
    await openTheHall(page, house);
    const region = requestsRegion(page);
    const card = region.getByRole("listitem").first();
    await expect(card).toContainText("Chairs × 10");

    await card.getByRole("button", { name: "I’ll do it" }).click();
    await expect(card.getByText("Waiting to send: I’ll do it")).toBeVisible();
    // Not shown as owned: the house has not said so.
    await expect(card.locator(".vv-request-who")).not.toContainText("Elaine");
    await expect(region.getByRole("alert")).toHaveCount(0);
    expect(await unreadableText(page, ".dayboard-detail", "the open slot with a waiting step")).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("waiting-to-send.png") });

    // The phone reloads in the cellar: the press is still kept, and said.
    await page.reload();
    await page.getByRole("button", { name: /^Chamber dinner,/u }).click();
    await expect(requestsRegion(page).getByText("Waiting to send: I’ll do it")).toBeVisible();

    // The signal comes back.
    house.answer = "take";
    await signalReturns(page);
    await expect(requestsRegion(page).getByText("Waiting to send: I’ll do it")).toHaveCount(0);
    await expect(requestsRegion(page).getByRole("listitem").first().locator(".vv-request-who")).toContainText("Elaine");

    // Every send of it was the same press: the same step under the same key;
    // the replays also say the state and owner (nobody) it was pressed against.
    const sent = house.steps;
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(sent[0]?.body).toEqual({ to: "accepted" });
    for (const replay of sent.slice(1)) expect(replay.body).toEqual({ to: "accepted", expectedState: "sent", expectedOwnerUserId: null });
    const key = sent[0]?.key ?? null;
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(sent.every((step) => step.key === key)).toBe(true);
  });

  test("says by name that someone else took it first, and puts the press away", async ({ page }, testInfo) => {
    const house: House = { current: request(), answer: "no-signal", steps: [] };
    await openTheHall(page, house);
    const region = requestsRegion(page);
    const card = region.getByRole("listitem").first();
    await card.getByRole("button", { name: "I’ll do it" }).click();
    await expect(card.getByText("Waiting to send: I’ll do it")).toBeVisible();

    house.answer = "taken-by-graham";
    await signalReturns(page);
    const notice = region.locator(".vv-request-notice");
    await expect(notice).toContainText("Your “I’ll do it” on Chairs × 10 was not sent. Graham has this.");
    await expect(notice).toHaveAttribute("role", "status");
    await expect(region.getByRole("listitem").filter({ hasText: "Morag" }).locator(".vv-request-who")).toContainText("Graham");
    await expect(region.getByText(/Waiting to send/u)).toHaveCount(0);
    expect(await unreadableText(page, ".dayboard-detail", "the open slot with a replay notice")).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("taken-first.png") });

    await notice.getByRole("button", { name: "OK" }).click();
    await expect(region.locator(".vv-request-notice")).toHaveCount(0);
    // Refused once, for good: the press is not sent again.
    const sends = house.steps.length;
    await signalReturns(page);
    await page.waitForTimeout(300);
    expect(house.steps.length).toBe(sends);
  });
});
