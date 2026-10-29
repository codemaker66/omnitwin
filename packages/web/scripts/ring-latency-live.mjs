// Ring latency on a live deployment (goal 19 D12; Plan 19 L9).
//
// "Request commit to painted ring on every connected staff screen ≤ 1,000 ms
// p95 on the local stack and ≤ 1,500 ms on production, measured by
// timestamps, never felt." The e2e measures it on the local stack against
// Clerk's test instance; production needs real people signed in, and an
// agent may not sign in. So this opens two headed Chromium windows, each in
// its own profile kept on this machine, and waits while a person signs in:
// the HALLKEEPER on /hallkeeper/today and the CLIENT on their event page.
// Then, N times, the client asks for chairs through their own composer and
// the hallkeeper's window stamps the first paint of that request on the
// board, both on THIS machine's clock (two windows, one clock, no skew):
//
//   send → ring = (the ring's first paint) − (the instant "Send it" was pressed)
//
// the same two stamps living-timetable-three-identities.spec.ts takes. Each
// request is tagged "VENVIEWER TEST ring <run> — delete" and asked "When you
// can", so it escalates last; afterwards the hallkeeper's window finishes
// each one "Not needed" (KEEP=1 leaves them). The report says n, every
// sample, p50, p95 and the misses, and names the deployment and browser.
//
// Real people's screens and phones hear these requests: run it on the test
// event, with the floor told, as docs/operations/hallkeeper-day-l9-runbook.md
// says. It writes nothing but requests and their steps.
//
//   EVENT_ID=<the client's test event> node packages/web/scripts/ring-latency-live.mjs
//
// Env: BASE_URL (default https://venviewer.com), EVENT_ID (required unless
//   DRY_RUN), N (default 10), PROFILE_DIR (default ~/.venviewer-ring-latency;
//   keeps the two sign-ins between runs), OUT (a JSON report path),
//   CHROMIUM_PATH (a Chromium binary when Playwright's own is not installed),
//   KEEP=1 (leave the test requests), SIGN_IN_MINUTES (default 15).
//   DRY_RUN=1 rehearses the instrument itself against BASE_URL's dev server
//   (default http://localhost:5173) with the API and the socket mocked; its
//   numbers measure nothing but the instrument.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir, platform, release } from "node:os";
import { join } from "node:path";

const DRY_RUN = process.env.DRY_RUN === "1";
const BASE_URL = process.env.BASE_URL ?? (DRY_RUN ? "http://localhost:5173" : "https://venviewer.com");
const N = Number.parseInt(process.env.N ?? "10", 10);
const PROFILE_DIR = process.env.PROFILE_DIR ?? join(homedir(), ".venviewer-ring-latency");
const SIGN_IN_MS = Number.parseInt(process.env.SIGN_IN_MINUTES ?? "15", 10) * 60_000;
const RING_WAIT_MS = 15_000;
const RUN = new Date().toISOString().slice(0, 16).replace(/[-:T]/gu, "");
const TAG = `VENVIEWER TEST ring ${RUN} — delete`;
if (!Number.isInteger(N) || N < 1 || N > 50) throw new Error("N must be 1 to 50");

// --- The dry run's house: one event, one slot, a socket that tells -----------

const DRY = {
  api: process.env.API_URL ?? "http://localhost:3001",
  venueId: "20000000-0000-4000-8000-000000000002",
  roomId: "30000000-0000-4000-8000-000000000001",
  bookingId: "50000000-0000-4000-8000-000000000002",
  eventId: "60000000-0000-4000-8000-000000000001",
};
const EVENT_ID = DRY_RUN ? DRY.eventId : process.env.EVENT_ID;
if (EVENT_ID === undefined || !/^[0-9a-f-]{36}$/u.test(EVENT_ID)) throw new Error("Set EVENT_ID to the client's test event id");

function dryHouse() {
  const now = Date.now();
  const at = (minutes) => new Date(now + minutes * 60_000).toISOString();
  const requests = [];
  const sockets = new Set();
  const booking = {
    entryType: "booking", id: DRY.bookingId, spaceId: DRY.roomId, kind: "ink", status: "active", state: "ink",
    title: "Instrument rehearsal", eventType: "dinner", startsAt: at(-30), endsAt: at(150), rank: null, jointFlag: false,
    decisionAt: null, ownerUserId: null, nextAction: null, nextActionDueAt: null, eventId: DRY.eventId, seriesId: null,
  };
  const calendar = {
    venueId: DRY.venueId, range: { from: at(-600), to: at(600) },
    rooms: [{ id: DRY.roomId, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 }],
    entries: [booking],
    conflicts: { conflicts: [], checks: { inkDoubleBook: { status: "checked" }, holdOverlap: { status: "checked" }, turnaround: { status: "checked", uncoveredPairCount: 0, detail: "" } } },
  };
  const schedule = {
    event: { id: DRY.eventId, venueId: DRY.venueId, name: "Instrument rehearsal", eventType: "dinner", status: "ready_for_ops", startsAt: booking.startsAt, endsAt: booking.endsAt, guestCount: 80 },
    venue: { id: DRY.venueId, name: "Trades Hall Glasgow", timezone: "Europe/London" },
    scheduleState: "working", phases: [], layouts: [],
    slots: [{ bookingId: DRY.bookingId, kind: "ink", title: "Instrument rehearsal", space: { id: DRY.roomId, name: "Grand Hall" }, startsAt: booking.startsAt, endsAt: booking.endsAt }],
  };
  const tell = (request) => {
    // The server's frame, a moment after the commit, to every board connected.
    setTimeout(() => {
      for (const socket of sockets) {
        socket.send(JSON.stringify({
          type: "request.event", venueId: DRY.venueId, kind: "request.created", requestId: request.id,
          bookingId: request.bookingId, roomId: request.roomId, state: request.state, at: new Date().toISOString(), serverNowMs: Date.now(),
        }));
      }
    }, 40);
  };
  return { calendar, schedule, requests, sockets, tell };
}

function venueRequestFrom(body, by) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), venueId: DRY.venueId, bookingId: body.bookingId ?? DRY.bookingId, eventId: DRY.eventId,
    roomId: DRY.roomId, roomName: "Grand Hall", kind: body.kind, quantity: body.quantity ?? null, urgency: body.urgency,
    detail: body.detail ?? null, requestedByUserId: by.id, requestedByName: by.name, requestedByRole: "client",
    audienceRoles: ["admin", "manager", "staff", "hallkeeper"], ownerUserId: null, ownerName: null, state: "sent",
    outcome: null, outcomeNote: null, escalationDueAt: null, escalatedAt: null, acknowledgedAt: null, acceptedAt: null,
    resolvedAt: null, threadId: null, handoverToUserId: null, handoverToName: null, handedOverAt: null, underwayAt: null,
    reopenedAt: null, createdAt: now, updatedAt: now,
  };
}

async function mockHallkeeper(page, house) {
  const keeper = { id: "e0000000-0000-4000-8000-000000000001", email: "hallkeeper@e2e.test", role: "hallkeeper", venueId: DRY.venueId, name: "Elaine" };
  await page.addInitScript((seed) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    // The rehearsal answers the socket too, so the live channel opens.
    Object.defineProperty(window, "__OMNITWIN_E2E_LIVE__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: seed, writable: false });
  }, keeper);
  const json = (route, data, status = 200) => route.fulfill({ status, json: { data } });
  await page.route(`${DRY.api}/calendar?*`, (route) => json(route, house.calendar));
  await page.route(`${DRY.api}/venues/${DRY.venueId}`, (route) => json(route, {
    id: DRY.venueId, name: "Trades Hall Glasgow", slug: "trades-hall-glasgow", address: "Rehearsal", logoUrl: null, brandColour: null, timezone: "Europe/London", spaces: [],
  }));
  await page.route(`${DRY.api}/notifications**`, (route) => json(route, []));
  await page.route(`${DRY.api}/venues/*/requests?*`, (route) => json(route, house.requests.filter((request) => request.state !== "resolved")));
  await page.route(`${DRY.api}/venues/*/observations?*`, (route) => json(route, []));
  await page.route(`${DRY.api}/venues/*/threads?*`, (route) => json(route, []));
  await page.route(`${DRY.api}/requests/*`, (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    const request = house.requests.find((candidate) => candidate.id === id);
    if (request === undefined) return route.fulfill({ status: 404, json: { error: "Request not found", code: "NOT_FOUND" } });
    const step = route.request().postDataJSON();
    Object.assign(request, { state: step.to, outcome: step.outcome ?? null, resolvedAt: step.to === "resolved" ? new Date().toISOString() : null, ownerUserId: keeper.id, ownerName: keeper.name });
    return json(route, request);
  });
  await page.routeWebSocket(/\/ws\/diary/u, (socket) => {
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "auth") {
        socket.send(JSON.stringify({ type: "hello", venueId: DRY.venueId, presence: [], serverNowMs: Date.now() }));
        house.sockets.add(socket);
      }
      if (message.type === "ping") socket.send(JSON.stringify({ type: "pong", serverNowMs: Date.now() }));
    });
    socket.onClose(() => { house.sockets.delete(socket); });
  });
}

async function mockClient(page, house) {
  const client = { id: "e0000000-0000-4000-8000-000000000002", email: "client@e2e.test", role: "client", venueId: null, name: "Morag" };
  await page.addInitScript((seed) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: seed, writable: false });
  }, client);
  const json = (route, data, status = 200) => route.fulfill({ status, json: { data } });
  await page.route(`${DRY.api}/events/${DRY.eventId}/client-schedule**`, (route) => json(route, house.schedule));
  await page.route(`${DRY.api}/events/${DRY.eventId}/conversation**`, (route) => json(route, {
    eventId: DRY.eventId, threads: [], messages: [], cursor: 0, serverNowMs: Date.now(),
  }));
  await page.route(`${DRY.api}/events/${DRY.eventId}/requests`, (route) => {
    if (route.request().method() !== "POST") return json(route, house.requests.filter((request) => request.requestedByUserId === client.id));
    const made = venueRequestFrom(route.request().postDataJSON(), client);
    house.requests.push(made);
    house.tell(made);
    return json(route, made, 201);
  });
  await page.routeWebSocket(/\/ws\//u, () => { /* a client page has no staff socket */ });
}

// --- The two windows ---------------------------------------------------------

async function windowFor(name) {
  const dir = join(PROFILE_DIR, name);
  mkdirSync(dir, { recursive: true });
  const context = await chromium.launchPersistentContext(dir, {
    headless: DRY_RUN,
    viewport: { width: 1280, height: 900 },
    timezoneId: "Europe/London",
    ...(process.env.CHROMIUM_PATH === undefined ? {} : { executablePath: process.env.CHROMIUM_PATH }),
  });
  return { context, page: context.pages()[0] ?? await context.newPage() };
}

async function waitForPerson(page, what, ready) {
  if (!DRY_RUN) process.stdout.write(`Sign in ${what} in the window that opened (waiting up to ${String(SIGN_IN_MS / 60_000)} min)…\n`);
  await ready.waitFor({ state: "visible", timeout: SIGN_IN_MS });
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

const house = DRY_RUN ? dryHouse() : null;
const keeper = await windowFor("hallkeeper");
const asker = await windowFor("client");
const report = {
  deployment: BASE_URL, dryRun: DRY_RUN, run: RUN, eventId: EVENT_ID, n: 0, samples: [], misses: [],
  machine: `${platform()} ${release()}`, browser: "", clock: "one machine clock for both windows",
};
try {
  if (house !== null) {
    await mockHallkeeper(keeper.page, house);
    await mockClient(asker.page, house);
  }
  report.browser = `Chromium ${keeper.context.browser()?.version() ?? "(persistent context)"}`;
  await keeper.page.goto(`${BASE_URL}/hallkeeper/today`);
  await waitForPerson(keeper.page, "as the HALLKEEPER", keeper.page.locator(".dayboard-slab").first());
  await asker.page.goto(`${BASE_URL}/events/${EVENT_ID}`);
  const requests = asker.page.getByRole("region", { name: "Requests" });
  await waitForPerson(asker.page, "as the CLIENT", requests.getByRole("button", { name: "Ask for something" }));

  for (let index = 1; index <= N; index += 1) {
    // A quantity this board does not show yet, so the first paint is this request's.
    let quantity = index;
    const railText = async () => (await keeper.page.locator(".dayboard-rail-item").allInnerTexts()).join("\n");
    while ((await railText()).includes(`Chairs × ${String(quantity)} ·`)) quantity += N;
    await keeper.page.evaluate((needle) => {
      const stamp = { needle, seenAt: null };
      window.__ringLatency = stamp;
      const seen = () => [...document.querySelectorAll(".dayboard-rail-item")].some((item) => (item.textContent ?? "").includes(needle));
      const observer = new MutationObserver(() => {
        if (stamp.seenAt === null && seen()) { stamp.seenAt = Date.now(); observer.disconnect(); }
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    }, `Chairs × ${String(quantity)} ·`);

    await requests.getByRole("button", { name: "Ask for something" }).click();
    const composer = asker.page.getByRole("form", { name: "Ask the house for something" });
    await composer.getByRole("button", { name: "Chairs", exact: true }).click();
    await composer.getByLabel("How many").fill(String(quantity));
    await composer.getByRole("button", { name: "When you can", exact: true }).click();
    await composer.getByLabel("Anything to add").fill(TAG);
    const answered = asker.page.waitForResponse((response) =>
      response.request().method() === "POST" && response.url().endsWith(`/events/${EVENT_ID}/requests`));
    const sentAt = Date.now();
    await composer.getByRole("button", { name: "Send it" }).click();
    const response = await answered;
    const answeredAt = Date.now();
    if (response.status() !== 201) {
      report.misses.push({ index, quantity, reason: `the API answered ${String(response.status())}` });
      continue;
    }
    let seenAt = null;
    const deadline = Date.now() + RING_WAIT_MS;
    while (seenAt === null && Date.now() < deadline) {
      seenAt = await keeper.page.evaluate(() => window.__ringLatency?.seenAt ?? null);
      if (seenAt === null) await keeper.page.waitForTimeout(25);
    }
    if (seenAt === null) {
      report.misses.push({ index, quantity, reason: `no ring within ${String(RING_WAIT_MS)} ms` });
    } else {
      report.samples.push({ index, quantity, sendToRingMs: seenAt - sentAt, answerToRingMs: seenAt - answeredAt, sendToAnswerMs: answeredAt - sentAt });
      process.stdout.write(`#${String(index)} ring ${String(seenAt - sentAt)} ms after send (${String(seenAt - answeredAt)} ms after the API answered)\n`);
    }
    await asker.page.waitForTimeout(1_500);
  }
} finally {
  report.n = report.samples.length;
  const sorted = report.samples.map((sample) => sample.sendToRingMs).sort((a, b) => a - b);
  report.p50Ms = quantile(sorted, 0.5);
  report.p95Ms = quantile(sorted, 0.95);
  report.maxMs = sorted.at(-1) ?? null;
  report.budgetMs = 1_500;
  report.verdict = report.misses.length === 0 && report.p95Ms !== null && report.p95Ms <= report.budgetMs
    ? "within budget" : "not within budget";

  // Put the test requests away from the hallkeeper's own window.
  if (process.env.KEEP !== "1") {
    try {
      const slab = keeper.page.locator(".dayboard-slab").filter({ has: keeper.page.locator(".dayboard-ring") }).first();
      let left = 0;
      for (let guard = 0; guard < N + 5; guard += 1) {
        const card = keeper.page.locator(".vv-request", { hasText: TAG }).first();
        if (await card.count() === 0) {
          if (guard === 0 && await slab.count() > 0) { await slab.click(); continue; }
          break;
        }
        await card.getByRole("button", { name: "Finish" }).click();
        await card.getByRole("button", { name: "Not needed" }).click();
        await keeper.page.waitForTimeout(500);
        left = await keeper.page.locator(".vv-request", { hasText: TAG }).count();
      }
      report.cleanedUp = left === 0;
    } catch (error) {
      report.cleanedUp = false;
      report.cleanUpError = String(error);
    }
  }
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (process.env.OUT !== undefined) writeFileSync(process.env.OUT, text);
  process.stdout.write(text);
  await keeper.context.close();
  await asker.context.close();
}
