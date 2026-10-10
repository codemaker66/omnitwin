import { expect, test, type Page, type Route } from "@playwright/test";
import {
  CalendarResponseSchema,
  ClientEventScheduleSchema,
  MessageSchema,
  ThreadSchema,
  VenueRequestSchema,
  type Message,
  type Thread,
  type VenueRequest,
} from "@omnitwin/types";
import { unreadableText } from "./support/readability.js";

// ---------------------------------------------------------------------------
// E2E: requests and conversations on the slot (goal 19 S4), route-mocked.
//
// The hallkeeper's side: a tap on the slot shows the client's ask on a card
// in the paper register, the slot's threads as tabs with the copper badge on
// the one the client can read, the floor's own notes opened on the first
// note and sent under one key, and the longer ladder from the card: I’ll do
// it, hand over to a named colleague. The client's side: the ask in one
// gesture on the live slot, the honest state the house moves it to, read on
// the poll, and the door closed in one sentence when the link is revoked.
// The API is intercepted before transport; the live path (the ring within a
// second over the socket) is proved against the real stack by
// living-timetable-three-identities.spec.ts.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const VENUE = "20000000-0000-4000-8000-000000000002";
const HALL = { id: "30000000-0000-4000-8000-000000000001", name: "Grand Hall", slug: "grand-hall" };
const BOOKING = "50000000-0000-4000-8000-000000000002";
const EVENT = "60000000-0000-4000-8000-000000000001";
const CONFIGURATION = "70000000-0000-4000-8000-000000000001";
const REQUEST = "90000000-0000-4000-8000-000000000001";
const REQUEST_THREAD = "a0000000-0000-4000-8000-000000000001";
const FLOOR_THREAD = "a0000000-0000-4000-8000-000000000002";
const ELAINE = "e0000000-0000-4000-8000-000000000001";
const MORAG = "e0000000-0000-4000-8000-000000000002";
const FIONA = "e0000000-0000-4000-8000-000000000003";
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
    id: REQUEST, venueId: VENUE, bookingId: BOOKING, eventId: EVENT, roomId: HALL.id, roomName: HALL.name,
    kind: "chairs", quantity: 10, urgency: "soon", detail: "Ten more for the top table, please.",
    requestedByUserId: MORAG, requestedByName: "Morag", requestedByRole: "client",
    audienceRoles: ["admin", "manager", "staff", "hallkeeper"], ownerUserId: null, ownerName: null, state: "sent",
    outcome: null, outcomeNote: null, escalationDueAt: null, escalatedAt: null, acknowledgedAt: null, acceptedAt: null,
    resolvedAt: null, threadId: REQUEST_THREAD, handoverToUserId: null, handoverToName: null, handedOverAt: null,
    underwayAt: null, reopenedAt: null, createdAt: at("12:57"), updatedAt: at("12:57"), ...over,
  });
}

function thread(over: Partial<Thread> & Pick<Thread, "id" | "audience" | "subject">): Thread {
  return ThreadSchema.parse({
    venueId: VENUE, bookingId: BOOKING, eventId: EVENT, requestId: null, subjectUserId: null, title: null,
    createdByUserId: null, messageCount: 0, lastMessageAt: null, lastCursor: 0, createdAt: at("12:57"), ...over,
  });
}

function message(over: Partial<Message> & Pick<Message, "id" | "threadId" | "cursor" | "body">): Message {
  return MessageSchema.parse({
    kind: "text", authorUserId: MORAG, authorName: "Morag", authorRole: "client", createdAt: at("12:57"), receipts: [], ...over,
  });
}

const json = (route: Route, data: unknown, status = 200): Promise<void> => route.fulfill({ status, json: { data } });

async function seed(page: Page, user: { readonly id: string; readonly email: string; readonly role: string; readonly venueId: string | null; readonly name: string }): Promise<void> {
  await page.addInitScript((seeded) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: seeded, writable: false });
  }, user);
}

test.describe("Requests and conversations on the slot", () => {
  test("the hallkeeper reads the client's ask on the slot, notes the floor under one key, takes it and hands it over", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 1000 });
    await page.clock.setFixedTime(NOW);
    await seed(page, { id: ELAINE, email: "hallkeeper@e2e.test", role: "hallkeeper", venueId: VENUE, name: "Elaine" });

    // The house, as the API would answer it; the request and its threads move
    // as the hallkeeper presses, so the slab shows the truth it was given.
    let current = request();
    const requestThread = thread({ id: REQUEST_THREAD, audience: "client-facing", subject: "request", requestId: REQUEST, title: "Chairs × 10 · Grand Hall", messageCount: 1, lastCursor: 1 });
    const threads: Thread[] = [requestThread];
    const requestMessages: Message[] = [message({ id: "b0000000-0000-4000-8000-000000000001", threadId: REQUEST_THREAD, cursor: 1, kind: "request", body: "Chairs × 10 · Soon\nTen more for the top table, please." })];
    const floorMessages: Message[] = [];
    const sends: { readonly header: string | null; readonly body: string }[] = [];
    const patches: unknown[] = [];

    await page.route(`${API}/calendar?**`, (route) => json(route, DAY));
    await page.route(`${API}/venues/${VENUE}`, (route) => json(route, {
      id: VENUE, name: "Trades Hall Glasgow", slug: "trades-hall-glasgow", address: "85 Glassford Street",
      logoUrl: null, brandColour: null, timezone: "Europe/London", spaces: [],
    }));
    await page.route(`${API}/notifications**`, (route) => json(route, []));
    await page.route(`${API}/venues/${VENUE}/requests?**`, (route) => json(route, current.state === "resolved" ? [] : [current]));
    await page.route(`${API}/venues/${VENUE}/handlers`, (route) => json(route, [
      { id: ELAINE, name: "Elaine", role: "hallkeeper" }, { id: FIONA, name: "Fiona", role: "staff" }, { id: GRAHAM, name: "Graham", role: "hallkeeper" },
    ]));
    await page.route(`${API}/venues/${VENUE}/threads?**`, (route) => json(route, threads));
    await page.route(`${API}/venues/${VENUE}/threads`, (route) => {
      const floor = thread({ id: FLOOR_THREAD, audience: "staff-private", subject: "booking", createdByUserId: ELAINE, createdAt: at("13:00") });
      threads.push(floor);
      return json(route, floor, 201);
    });
    await page.route(`${API}/threads/${REQUEST_THREAD}/messages?**`, (route) => json(route, {
      thread: requestThread, messages: requestMessages, cursor: requestMessages[requestMessages.length - 1]?.cursor ?? 0, serverNowMs: Date.now(),
    }));
    await page.route(`${API}/threads/${FLOOR_THREAD}/messages?**`, (route) => json(route, {
      thread: threads[1], messages: floorMessages, cursor: floorMessages[floorMessages.length - 1]?.cursor ?? 0, serverNowMs: Date.now(),
    }));
    await page.route(`${API}/threads/${FLOOR_THREAD}/messages`, (route) => {
      const body = route.request().postDataJSON() as { body: string; idempotencyKey: string };
      sends.push({ header: route.request().headers()["idempotency-key"] ?? null, body: body.idempotencyKey });
      const sent = message({
        id: "b0000000-0000-4000-8000-00000000000a", threadId: FLOOR_THREAD, cursor: 2, body: body.body,
        authorUserId: ELAINE, authorName: "Elaine", authorRole: "hallkeeper", createdAt: at("13:00"),
      });
      floorMessages.push(sent);
      return json(route, sent, 201);
    });
    await page.route(`${API}/messages/*/receipt`, (route) => json(route, {
      messageId: "b0000000-0000-4000-8000-000000000001", recipientUserId: ELAINE, recipientName: "Elaine",
      deliveredAt: at("13:00"), readAt: at("13:00"), acknowledgedAt: null,
    }));
    await page.route(`${API}/requests/${REQUEST}`, (route) => {
      const transition = route.request().postDataJSON() as { to: string; toUserId?: string };
      patches.push(transition);
      current = transition.to === "accepted"
        ? request({ state: "accepted", ownerUserId: ELAINE, ownerName: "Elaine", acceptedAt: at("13:00"), updatedAt: at("13:00") })
        : request({ state: "handed-over", ownerUserId: ELAINE, ownerName: "Elaine", acceptedAt: at("13:00"), handoverToUserId: FIONA, handoverToName: "Fiona", handedOverAt: at("13:01"), updatedAt: at("13:01") });
      return json(route, current);
    });

    await page.goto("/hallkeeper/today");
    // The ring is on the slab before the slot is opened.
    const slab = page.locator(`.dayboard-slab[data-booking="${BOOKING}"]`);
    await expect(slab.locator(".dayboard-ring")).toHaveAttribute("data-level", "attention");
    await page.getByRole("button", { name: /^Chamber dinner,/u }).click();
    const slot = page.getByRole("region", { name: "Grand Hall: Chamber dinner" });
    const region = slot.getByRole("region", { name: "Requests for Grand Hall" });

    // The card, in the paper register, with the client's ask and the first steps.
    const card = region.getByRole("listitem").first();
    await expect(card).toContainText("Chairs × 10");
    await expect(card).toContainText("Morag (client)");
    expect(await card.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(255, 253, 248)");
    await expect(card.getByRole("button", { name: "Seen" })).toBeVisible();
    await expect(card.getByRole("button", { name: "I’ll do it" })).toBeVisible();

    // One tab per thread; only the client's wears the badge.
    const floorTab = region.getByRole("tab", { name: "Floor notes" });
    const askTab = region.getByRole("tab", { name: /Chairs × 10/u });
    await expect(floorTab).toHaveAttribute("aria-selected", "true");
    await expect(floorTab.getByText("Client can read this")).toHaveCount(0);
    await expect(askTab.getByText("Client can read this")).toBeVisible();
    await askTab.click();
    await expect(region.getByLabel("Reply to the client")).toBeVisible();
    await expect(region.getByRole("list", { name: "Messages" })).toContainText("Ten more for the top table, please.");

    // The floor's first note opens the floor's thread; a resend is the same key.
    await floorTab.click();
    await region.getByLabel("Note to the floor").fill("Chairs are out; doors at six.");
    await region.getByRole("button", { name: "Send" }).click();
    await expect(region.getByRole("list", { name: "Messages" })).toContainText("Chairs are out; doors at six.");
    expect(sends).toHaveLength(1);
    expect(sends[0]?.header).toBe(sends[0]?.body);
    expect(threads.map((row) => row.audience)).toEqual(["client-facing", "staff-private"]);

    // I’ll do it, then hand it to Fiona by name; never to yourself.
    await card.getByRole("button", { name: "I’ll do it" }).click();
    await expect(card).toContainText("Elaine");
    await card.getByRole("button", { name: "Hand over" }).click();
    const picker = card.getByLabel("Hand to");
    await expect(picker.locator("option")).toHaveText(["Choose a colleague", "Fiona", "Graham"]);
    await picker.selectOption(FIONA);
    await card.getByRole("button", { name: "Hand it over" }).click();
    await expect(card).toContainText("Elaine is handing this to Fiona.");
    expect(patches).toEqual([{ to: "accepted" }, { to: "handed-over", toUserId: FIONA }]);

    expect(await unreadableText(page, ".dayboard-detail", "the open slot")).toEqual([]);
  });

  test("the client asks for ten more chairs on the live slot, reads who has it, and is closed out in one sentence when the link is revoked", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 1000 });
    await page.clock.install({ time: NOW });
    await seed(page, { id: MORAG, email: "client@e2e.test", role: "client", venueId: null, name: "Morag" });

    const schedule = ClientEventScheduleSchema.parse({
      event: { id: EVENT, venueId: VENUE, name: "Chamber dinner", eventType: "dinner", status: "ready_for_ops", startsAt: at("13:05"), endsAt: at("16:00"), guestCount: 120 },
      venue: { id: VENUE, name: "Trades Hall Glasgow", timezone: "Europe/London" },
      scheduleState: "working",
      phases: [],
      layouts: [{ id: CONFIGURATION, name: "Banquet 120", space: { id: HALL.id, name: HALL.name } }],
      slots: [{ bookingId: BOOKING, kind: "ink", title: "Chamber dinner", space: { id: HALL.id, name: HALL.name }, startsAt: at("13:05"), endsAt: at("16:00") }],
    });
    let requests: VenueRequest[] = [];
    let steps: Message[] = [];
    let revoked = false;
    const creates: { readonly header: string | null; readonly body: Record<string, unknown> }[] = [];

    await page.route(`${API}/events/${EVENT}/client-schedule**`, (route) => json(route, schedule));
    await page.route(`${API}/events/${EVENT}/conversation**`, (route) => (revoked
      ? route.fulfill({ status: 403, json: { error: "This conversation is not yours to read.", code: "FORBIDDEN" } })
      : json(route, { eventId: EVENT, threads: [], messages: steps, cursor: steps[steps.length - 1]?.cursor ?? 0, serverNowMs: Date.now() })));
    await page.route(`${API}/events/${EVENT}/requests`, (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        creates.push({ header: route.request().headers()["idempotency-key"] ?? null, body });
        const made = request({ state: "sent", ownerUserId: null, ownerName: null, detail: null, createdAt: at("13:00"), updatedAt: at("13:00") });
        requests = [made];
        return json(route, made, 201);
      }
      return revoked
        ? route.fulfill({ status: 403, json: { error: "This event is not linked to your account.", code: "FORBIDDEN" } })
        : json(route, requests);
    });

    await page.goto(`/events/${EVENT}`);
    const region = page.getByRole("region", { name: "Requests" });
    await region.getByRole("button", { name: "Ask for something" }).click();
    await expect(region.getByRole("button", { name: "Chairs" })).toHaveAttribute("aria-pressed", "true");
    await expect(region.getByLabel("Room and time")).toHaveValue(BOOKING);
    await expect(region.getByLabel("Room and time").locator("option")).toHaveText(["Grand Hall · Sat 3 Oct · 13:05–16:00"]);
    await region.getByLabel("How many").fill("10");
    await region.getByRole("button", { name: "Soon" }).click();
    await region.getByRole("button", { name: "Send it" }).click();

    const list = region.getByRole("list", { name: "Your requests" });
    await expect(list).toContainText("Chairs × 10");
    await expect(list).toContainText("Sent · waiting for the house");
    expect(creates).toHaveLength(1);
    expect(creates[0]?.body).toMatchObject({ bookingId: BOOKING, kind: "chairs", quantity: 10, urgency: "soon" });
    expect(creates[0]?.header).toBe(creates[0]?.body["idempotencyKey"]);

    // The house takes it; the next poll reads the step in the house's words.
    steps = [
      message({ id: "b0000000-0000-4000-8000-000000000011", threadId: REQUEST_THREAD, cursor: 2, kind: "system", authorUserId: null, authorName: "Venviewer", authorRole: "system", body: "Elaine has seen this.", createdAt: at("13:01") }),
      message({ id: "b0000000-0000-4000-8000-000000000012", threadId: REQUEST_THREAD, cursor: 3, kind: "system", authorUserId: null, authorName: "Venviewer", authorRole: "system", body: "Elaine has this.", createdAt: at("13:01") }),
    ];
    await page.clock.runFor(5_100);
    await expect(list).toContainText("Elaine has this.");
    await expect(region.getByRole("status")).toHaveText("Chairs × 10: Elaine has this.");

    // The office revokes the link: the next poll is refused and the door closes.
    revoked = true;
    await page.clock.runFor(5_100);
    await expect(region.getByText("This event is no longer linked to your account.")).toBeVisible();
    await expect(region.getByRole("button", { name: "Ask for something" })).toBeDisabled();

    expect(await unreadableText(page, ".client-requests", "the client's requests")).toEqual([]);
  });
});
