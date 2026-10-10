import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { LAYOUT_STYLES } from "@omnitwin/types";
import { signInCoordinator } from "./support/diary-live.js";
import {
  CLIENT,
  HALLKEEPER,
  OFFICE,
  api,
  awaitClerkSession,
  freeWindow,
  londonDay,
  unwrap,
  type Interval,
} from "./support/living-timetable.js";

// ---------------------------------------------------------------------------
// E2E: the living timetable with three identities (goal 19 S4, T-651).
//
// The sentence the goal is done when: the office inks a slot, the client asks
// for ten more chairs from their event, the copper ring is on the hallkeeper's
// slab within a second, two hands reach for the request and exactly one owns
// it, the client sees who has it, a staff-private note never reaches the
// client, and a revoked plan closes the client's door at once.
//
// This needs the LIVE stack: the disposable Postgres, the API with the Clerk
// test instance, Vite with the pk_test key (recipe in
// docs/sessions/2026-10-10.md). The default e2e run has none of that, so the
// file self-gates with E2E_LIVING_TIMETABLE=1 instead of failing.
//
// Latency is measured by timestamps, never felt: the client's page stamps the
// instant its request is sent and the instant the API answers; a
// MutationObserver on the hallkeeper's board stamps the first paint of the
// ring on that slab. Every page shares the machine's clock.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });
test.skip(
  process.env["E2E_LIVING_TIMETABLE"] !== "1",
  "Live living-timetable stack required — set E2E_LIVING_TIMETABLE=1 (see docs/sessions/2026-10-10.md).",
);

const API = process.env["E2E_API_URL"] ?? "http://localhost:3011";
const RUN_TAG = new Date().toISOString().slice(11, 19).replace(/:/gu, "");
const TITLE = `Three identities ${RUN_TAG}`;
const RING_BUDGET_MS = 1_000;
const CLIENT_SEES_OWNER_MS = 5_000;

interface Run {
  readonly venueId: string;
  readonly spaceId: string;
  readonly eventId: string;
  readonly bookingId: string;
  readonly configurationId: string;
  readonly window: Interval;
}

let officeContext: BrowserContext;
let hallkeeperContext: BrowserContext;
let clientContext: BrowserContext;
let office: Page;
let hallkeeper: Page;
let client: Page;
let run: Run;
let requestId: string;

/** Signs the person in and, once their page holds a Clerk session, hands it
 *  back. A client is parked on the (light) event page rather than the
 *  planner their sign-in lands on, so the page can answer API calls. */
async function signedIn(browser: Browser, who: typeof OFFICE, parkAt?: string): Promise<[BrowserContext, Page]> {
  const context = await browser.newContext({ timezoneId: "Europe/London" });
  const page = await context.newPage();
  await signInCoordinator(page, who);
  if (parkAt !== undefined) await page.goto(parkAt);
  await awaitClerkSession(page);
  return [context, page];
}

/** A nil event id: the client's page renders its not-found state, with Clerk
 *  and the auth store mounted, until the run's event exists. */
const NO_EVENT = "00000000-0000-4000-8000-000000000000";

function expectStatus(outcome: { readonly status: number; readonly body: unknown }, expected: number, what: string): void {
  if (outcome.status !== expected) {
    throw new Error(`${what} -> ${String(outcome.status)}: ${JSON.stringify(outcome.body).slice(0, 400)}`);
  }
}

/** The office makes the run's event, inks its slot today in the Grand Hall
 *  clear of every other booking, and links the client's plan to it. */
async function prepareRun(): Promise<Run> {
  const venues = unwrap(await api(office, API, "GET", "/venues")) as readonly { readonly id: string }[];
  const venueId = venues[0]?.id;
  if (venueId === undefined) throw new Error("the office can see no venue");

  const venue = unwrap(await api(office, API, "GET", `/venues/${venueId}`)) as {
    readonly spaces: readonly { readonly id: string; readonly name: string }[];
  };
  const grandHall = venue.spaces.find((space) => space.name.includes("Grand Hall"));
  if (grandHall === undefined) throw new Error("no Grand Hall at the venue");

  const now = new Date();
  const day = londonDay(now);
  const calendar = unwrap(await api(
    office, API, "GET",
    `/calendar?venueId=${venueId}&from=${new Date(day.startMs).toISOString()}&to=${new Date(day.endMs).toISOString()}`,
  )) as { readonly entries: readonly { readonly spaceId: string; readonly startsAt: string; readonly endsAt: string }[] };
  const taken = calendar.entries
    .filter((entry) => entry.spaceId === grandHall.id)
    .map((entry) => ({ startMs: Date.parse(entry.startsAt), endMs: Date.parse(entry.endsAt) }));
  // Two hours, live now where the room allows, so the slab sits by the NOW plaque.
  const window = freeWindow(taken, day, now.getTime() - 60 * 60_000, 2 * 60 * 60_000);
  if (window === null) throw new Error("no free two-hour window in the Grand Hall today");

  const event = await api(office, API, "POST", "/events", {
    body: {
      venueId, name: TITLE, eventType: "dinner", guestCount: 120,
      startsAt: new Date(window.startMs).toISOString(), endsAt: new Date(window.endMs).toISOString(),
    },
    idempotencyKey: crypto.randomUUID(),
  });
  expectStatus(event, 201, "POST /events");
  // The event's door answers with its phase graph; the row sits under `event`.
  const eventId = (unwrap(event) as { readonly event: { readonly id: string } }).event.id;

  const booking = await api(office, API, "POST", "/bookings", {
    body: {
      venueId, spaceId: grandHall.id, eventId, kind: "ink", title: TITLE,
      startsAt: new Date(window.startMs).toISOString(), endsAt: new Date(window.endMs).toISOString(),
    },
    idempotencyKey: crypto.randomUUID(),
  });
  expectStatus(booking, 201, "POST /bookings");
  const inked = unwrap(booking) as { readonly id: string; readonly eventId: string | null };
  if (inked.eventId !== eventId) throw new Error(`the inked slot is not on the run's event (${String(inked.eventId)})`);
  const bookingId = inked.id;

  const plan = await api(client, API, "POST", "/configurations", {
    body: { venueId, spaceId: grandHall.id, name: `Client plan ${RUN_TAG}`, layoutStyle: LAYOUT_STYLES[0], guestCount: 120 },
    idempotencyKey: crypto.randomUUID(),
  });
  expectStatus(plan, 201, "POST /configurations (client)");
  const configurationId = (unwrap(plan) as { readonly id: string }).id;

  // The client's link, the product's way: the office adopts the client's plan
  // as the event's layout variant, which writes the variant_configuration
  // link that admits the plan's owner (docs/engineering/event-client-access.md).
  // The planner corridor's own link route refuses customer-owned layouts.
  const variant = await api(office, API, "POST", `/events/${eventId}/layout-variants`, {
    body: { configurationId, name: `Client plan ${RUN_TAG}`, status: "draft", guestCount: 120 },
    idempotencyKey: crypto.randomUUID(),
  });
  expectStatus(variant, 201, "POST /events/:id/layout-variants (office, the client's plan)");

  const door = await api(client, API, "GET", `/events/${eventId}/conversation?after=0`);
  expectStatus(door, 200, "GET /events/:id/conversation (client, linked)");

  // The client's own page opens on the linked event.
  await client.goto(`/events/${eventId}`);
  await expect(client.getByRole("heading", { name: TITLE })).toBeVisible({ timeout: 30_000 });
  await awaitClerkSession(client);

  return { venueId, spaceId: grandHall.id, eventId, bookingId, configurationId, window };
}

/** The hallkeeper's board, with the run's slab on it and no ring yet. */
async function openBoard(page: Page): Promise<void> {
  await page.goto("/hallkeeper/today");
  await expect(page.getByRole("button", { name: new RegExp(`^${TITLE},`, "u") })).toBeVisible({ timeout: 30_000 });
}

function slabOf(page: Page) {
  return page.locator(".dayboard-slab", { hasText: TITLE });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000); // three real sign-ins; the first ever registers each device
  [officeContext, office] = await signedIn(browser, OFFICE);
  [hallkeeperContext, hallkeeper] = await signedIn(browser, HALLKEEPER);
  [clientContext, client] = await signedIn(browser, CLIENT, `/events/${NO_EVENT}`);
  run = await prepareRun();
});

test.afterAll(async () => {
  await Promise.all([officeContext.close(), hallkeeperContext.close(), clientContext.close()]);
});

test("the client's request rings the hallkeeper's slab within a second", async () => {
  await openBoard(hallkeeper);
  await expect(slabOf(hallkeeper).locator(".dayboard-ring")).toHaveCount(0);

  // Stamp the first paint of the ring on this slab, before anything is asked.
  await hallkeeper.evaluate((title) => {
    const stamps: { ringSeenAt: number | null } = { ringSeenAt: null };
    (window as { __livingTimetable?: typeof stamps }).__livingTimetable = stamps;
    const seen = (): boolean => Array.from(document.querySelectorAll(".dayboard-slab"))
      .some((slab) => (slab.textContent ?? "").includes(title) && slab.querySelector(".dayboard-ring") !== null);
    new MutationObserver(() => {
      if (stamps.ringSeenAt === null && seen()) stamps.ringSeenAt = Date.now();
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  }, TITLE);

  const asked = await client.evaluate(async (input: { readonly apiOrigin: string; readonly eventId: string; readonly bookingId: string }) => {
    const clerk = (window as { Clerk?: { session?: { getToken: () => Promise<string | null> } } }).Clerk;
    const token = (await clerk?.session?.getToken()) ?? null;
    if (token === null) throw new Error("no Clerk session token in the client's page");
    const key = crypto.randomUUID();
    const sentAt = Date.now();
    const response = await fetch(`${input.apiOrigin}/events/${input.eventId}/requests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ bookingId: input.bookingId, kind: "chairs", quantity: 10, urgency: "soon", idempotencyKey: key }),
    });
    const answeredAt = Date.now();
    const body = (await response.json()) as { readonly data?: { readonly id?: string } };
    return { status: response.status, id: body.data?.id ?? null, sentAt, answeredAt };
  }, { apiOrigin: API, eventId: run.eventId, bookingId: run.bookingId });
  expect(asked.status).toBe(201);
  expect(asked.id).not.toBeNull();
  requestId = asked.id ?? "";

  await expect.poll(
    () => hallkeeper.evaluate(() => (window as { __livingTimetable?: { ringSeenAt: number | null } }).__livingTimetable?.ringSeenAt ?? null),
    { timeout: 10_000, message: "the ring never painted on the hallkeeper's slab" },
  ).not.toBeNull();
  const ringSeenAt = await hallkeeper.evaluate(() => (window as { __livingTimetable?: { ringSeenAt: number | null } }).__livingTimetable?.ringSeenAt ?? 0);
  const fromSend = ringSeenAt - asked.sentAt;
  const fromAnswer = ringSeenAt - asked.answeredAt;
  const measure = `ring painted ${String(fromSend)} ms after the client pressed send (${String(fromAnswer)} ms after the API answered)`;
  test.info().annotations.push({ type: "latency", description: measure });
  await test.info().attach("ring-latency.txt", { body: measure, contentType: "text/plain" });
  expect(fromSend, measure).toBeLessThanOrEqual(RING_BUDGET_MS);

  // The rail names it as the request nobody has.
  await expect(hallkeeper.locator(".dayboard-rail-item", { hasText: "Chairs × 10" })).toBeVisible();
});

test("two hands reach for the request and exactly one owns it; the client sees who", async () => {
  await openBoard(office);
  for (const page of [hallkeeper, office]) {
    await slabOf(page).first().click();
    await expect(page.getByRole("region", { name: new RegExp(`^Grand Hall: ${TITLE}$`, "u") })).toBeVisible();
    await expect(page.locator(".vv-request", { hasText: "Chairs × 10" })).toBeVisible();
  }

  const press = (page: Page) => page.locator(".vv-request", { hasText: "Chairs × 10" })
    .getByRole("button", { name: "I’ll do it" }).click({ timeout: 10_000 });
  const outcomes = await Promise.allSettled([press(hallkeeper), press(office)]);
  expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);

  await expect.poll(async () => {
    const current = unwrap(await api(office, API, "GET", `/requests/${requestId}`)) as { readonly state: string; readonly ownerName: string | null };
    return current.state === "accepted" ? current.ownerName : null;
  }, { timeout: 10_000 }).not.toBeNull();
  const owned = unwrap(await api(office, API, "GET", `/requests/${requestId}`)) as { readonly ownerName: string | null; readonly ownerUserId: string | null };
  expect([HALLKEEPER.name, OFFICE.name]).toContain(owned.ownerName);

  // Exactly one accept in the ledger, however the two presses raced.
  const history = unwrap(await api(office, API, "GET", `/requests/${requestId}/history`)) as readonly { readonly toState: string }[];
  expect(history.filter((step) => step.toState === "accepted")).toHaveLength(1);

  // The loser hears who has it, by name, on the card they pressed (the slab's
  // ring words say it too, but the office layout folds them to a count).
  const loser = owned.ownerName === HALLKEEPER.name ? office : hallkeeper;
  await expect(loser.locator(".vv-request", { hasText: "Chairs × 10" }).getByRole("alert"))
    .toHaveText(`${owned.ownerName ?? ""} has this.`, { timeout: 10_000 });

  // The client sees the same name within five seconds, through their door.
  const seenBy = Date.now();
  await expect.poll(async () => {
    const mine = unwrap(await api(client, API, "GET", `/events/${run.eventId}/requests`)) as readonly { readonly id: string; readonly ownerName: string | null }[];
    return mine.find((request) => request.id === requestId)?.ownerName ?? null;
  }, { timeout: CLIENT_SEES_OWNER_MS }).toBe(owned.ownerName);
  test.info().annotations.push({ type: "latency", description: `client saw the owner ${String(Date.now() - seenBy)} ms after asking` });
  const conversation = unwrap(await api(client, API, "GET", `/events/${run.eventId}/conversation?after=0`)) as {
    readonly messages: readonly { readonly kind: string; readonly body: string }[];
  };
  expect(conversation.messages.some((message) => message.kind === "system" && message.body === `${owned.ownerName ?? ""} has this.`)).toBe(true);
});

test("a staff-private note never reaches the client", async () => {
  const thread = await api(office, API, "POST", `/venues/${run.venueId}/threads`, {
    body: { audience: "staff-private", subject: "booking", bookingId: run.bookingId },
    idempotencyKey: crypto.randomUUID(),
  });
  expect([200, 201]).toContain(thread.status);
  const threadId = (unwrap(thread) as { readonly id: string }).id;
  const note = await api(office, API, "POST", `/threads/${threadId}/messages`, {
    body: { body: `Private: the deposit is still outstanding (${RUN_TAG}).`, idempotencyKey: crypto.randomUUID() },
  });
  expectStatus(note, 201, "POST /threads/:id/messages (office, staff-private)");

  const conversation = unwrap(await api(client, API, "GET", `/events/${run.eventId}/conversation?after=0`)) as {
    readonly threads: readonly { readonly audience: string }[];
    readonly messages: readonly { readonly body: string }[];
  };
  expect(conversation.threads.every((item) => item.audience === "client-facing")).toBe(true);
  expect(conversation.messages.some((message) => message.body.includes("deposit"))).toBe(false);
  expect((await api(client, API, "GET", `/threads/${threadId}/messages?after=0`)).status).toBe(403);
});

test("revoking the client's plan closes their door at once", async () => {
  const revoked = await api(office, API, "DELETE", `/configurations/${run.configurationId}`);
  expect([200, 204]).toContain(revoked.status);

  expect((await api(client, API, "GET", `/events/${run.eventId}/conversation?after=0`)).status).toBe(403);
  const refused = await api(client, API, "POST", `/events/${run.eventId}/requests`, {
    body: { bookingId: run.bookingId, kind: "chairs", quantity: 2, urgency: "routine", idempotencyKey: crypto.randomUUID() },
  });
  expect(refused.status).toBe(403);
});
