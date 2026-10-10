// Day Board visual-verification harness (goal 19 S3) — drives its OWN
// headless Chromium via Playwright, same family as visual-check.mjs /
// rite-visual-check.mjs. Verifies the attention system (D3) as rendered:
//   1. motion on:  every state's verb on screen; the breaths RUNNING at
//      their cadences (4 s organisers, 3 s guests, 2 s doors, 4 s live) and
//      phase-locked (every breath shares one animation-delay — the epoch);
//      the copper ring breathing on an unowned request, pulsing on an urgent
//      one, still once owned; the UNOWNED rail and the next-action line;
//   2. reduced motion: every animation computed to "none" while the verbs
//      still carry the full meaning;
//   3. the phone: the sheet wider than the screen and centred on NOW;
//   4. the wall register (?register=wall);
//   5. an open slot, with the request region mounted;
//   6. (goal 19 S4) the open slot's conversation: the request card on the
//      paper register, one tab per thread with the copper badge only on the
//      thread the client can read, on the office sheet and on the phone.
// The calendar, requests and conversation APIs are route-mocked with entries
// relative to Date.now(), so every state is on screen no matter when this runs.
// Run from repo root with the web dev server up:
//   node packages/web/scripts/day-board-visual-check.mjs
// Env: BASE_URL (default http://localhost:5173), OUT_DIR (screenshot dir).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";
/** The API origin the page calls, as the e2e config pins it; mocked below. */
const API = process.env.API_URL ?? "http://localhost:3001";
const OUT = process.env.OUT_DIR ?? join(process.cwd(), "visual-out", "day-board");
mkdirSync(OUT, { recursive: true });

const VENUE = "00000000-0000-4000-8000-000000000001";
const ROOMS = [
  { id: "00000000-0000-4000-8000-0000000000a1", name: "Grand Hall", slug: "grand-hall", sortOrder: 0 },
  { id: "00000000-0000-4000-8000-0000000000a2", name: "Saloon", slug: "saloon", sortOrder: 1 },
  { id: "00000000-0000-4000-8000-0000000000a3", name: "Reception Room", slug: "reception-room", sortOrder: 2 },
  { id: "00000000-0000-4000-8000-0000000000a4", name: "Robert Adam Room", slug: "robert-adam", sortOrder: 3 },
];
const MIN = 60_000;
const B = (n) => `00000000-0000-4000-8000-0000000000b${String(n)}`;
const KEEPER = { id: "visual-hallkeeper", email: "visual-hallkeeper@e2e.test", role: "hallkeeper", venueId: VENUE, name: "Visual Hallkeeper" };

function booking(id, spaceId, startOffsetMin, endOffsetMin, title, eventType, now) {
  return {
    entryType: "booking",
    id,
    spaceId,
    kind: "ink",
    status: "active",
    state: "ink",
    title,
    eventType,
    startsAt: new Date(now + startOffsetMin * MIN).toISOString(),
    endsAt: new Date(now + endOffsetMin * MIN).toISOString(),
    rank: null,
    jointFlag: false,
    decisionAt: null,
    ownerUserId: null,
    nextAction: null,
    nextActionDueAt: null,
    eventId: null,
    seriesId: null,
    guestCount: 120,
  };
}

/** Every state on one board, whatever the wall clock says. */
function calendarFixture(now) {
  const [grand, saloon, reception, adam] = ROOMS.map((room) => room.id);
  return {
    venueId: VENUE,
    range: {
      from: new Date(now - 12 * 60 * MIN).toISOString(),
      to: new Date(now + 12 * 60 * MIN).toISOString(),
    },
    rooms: ROOMS,
    entries: [
      booking(B(1), grand, -60, 120, "Chamber banquet", "dinner", now),
      booking(B(2), saloon, 25, 180, "Craft ceilidh", "ceilidh", now),
      booking(B(3), reception, 50, 240, "Board afternoon", "conference", now),
      booking(B(8), adam, 8, 60, "Press briefing", "conference", now),
      booking(B(5), adam, -300, -120, "Morning assembly", "assembly", now),
      booking(B(4), adam, 300, 420, "Evening recital", "concert", now),
      // Back-to-back pair whose changeover the conflict below flags.
      booking(B(6), saloon, 200, 260, "Turnover pair A", "dinner", now),
      booking(B(7), saloon, 262, 320, "Turnover pair B", "dinner", now),
    ],
    conflicts: {
      conflicts: [
        {
          id: "conflict-turnaround-1",
          type: "insufficient_turnaround",
          severity: "blocking",
          spaceId: saloon,
          entryIds: [B(6), B(7)],
          explanation: "2 minutes between events; this changeover needs 60.",
        },
      ],
      checks: {
        inkDoubleBook: { status: "checked" },
        holdOverlap: { status: "checked" },
        turnaround: { status: "checked", uncoveredPairCount: 1, detail: "One gap uncovered." },
      },
    },
    turnaroundRules: [{ spaceId: null, eventType: null, name: "House", minutes: 60, isActive: true }],
  };
}

function request(id, bookingId, room, fields, now) {
  const createdAt = new Date(now - fields.minutesAgo * MIN).toISOString();
  return {
    id,
    venueId: VENUE,
    bookingId,
    eventId: null,
    roomId: room.id,
    roomName: room.name,
    kind: fields.kind,
    quantity: fields.quantity ?? null,
    urgency: fields.urgency,
    detail: null,
    requestedByUserId: "00000000-0000-4000-8000-0000000000fe",
    requestedByName: "Morag",
    requestedByRole: fields.client ? "client" : "hallkeeper",
    audienceRoles: ["admin", "manager", "staff", "hallkeeper"],
    ownerUserId: fields.owner ? "00000000-0000-4000-8000-0000000000fd" : null,
    ownerName: fields.owner ?? null,
    state: fields.owner ? "accepted" : "sent",
    outcome: null,
    outcomeNote: null,
    escalationDueAt: null,
    escalatedAt: null,
    acknowledgedAt: fields.owner ? createdAt : null,
    acceptedAt: fields.owner ? createdAt : null,
    resolvedAt: null,
    threadId: fields.threadId ?? null,
    handoverToUserId: null,
    handoverToName: null,
    handedOverAt: null,
    underwayAt: null,
    reopenedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

/** An unowned request on the ceilidh (the client's, with its client-facing
 *  thread), an urgent one on the banquet, and one Elaine already has on the
 *  Board afternoon. */
const CLIENT_THREAD = "00000000-0000-4000-8000-0000000000c1";
function requestsFixture(now) {
  return [
    request("00000000-0000-4000-8000-0000000000d1", B(2), ROOMS[1], { kind: "chairs", quantity: 10, urgency: "soon", minutesAgo: 3, client: true, threadId: CLIENT_THREAD }, now),
    request("00000000-0000-4000-8000-0000000000d2", B(1), ROOMS[0], { kind: "temperature", urgency: "now", minutesAgo: 1 }, now),
    request("00000000-0000-4000-8000-0000000000d3", B(3), ROOMS[2], { kind: "av", urgency: "soon", minutesAgo: 12, owner: "Elaine" }, now),
  ];
}

/** The ceilidh's threads: the client's request thread (goal 19 S4). The
 *  floor's own notes do not exist until the first one is written. */
function threadsFixture(bookingId, now) {
  if (bookingId !== B(2)) return [];
  return [{
    id: CLIENT_THREAD, venueId: VENUE, audience: "client-facing", subject: "request", bookingId: B(2), eventId: null,
    requestId: "00000000-0000-4000-8000-0000000000d1", subjectUserId: null, title: "Chairs × 10 · Saloon", createdByUserId: null,
    messageCount: 1, lastMessageAt: new Date(now - 3 * MIN).toISOString(), lastCursor: 1, createdAt: new Date(now - 3 * MIN).toISOString(),
  }];
}

function messagesFixture(threadId, now) {
  if (threadId !== CLIENT_THREAD) return { thread: null, messages: [], cursor: 0, serverNowMs: now };
  const [thread] = threadsFixture(B(2), now);
  return {
    thread,
    messages: [{
      id: "00000000-0000-4000-8000-0000000000e1", threadId: CLIENT_THREAD, cursor: 1, kind: "request",
      authorUserId: "00000000-0000-4000-8000-0000000000fe", authorName: "Morag", authorRole: "client",
      body: "Chairs × 10 · Soon\nTen more for the top table, please.", createdAt: new Date(now - 3 * MIN).toISOString(), receipts: [],
    }],
    cursor: 1,
    serverNowMs: now,
  };
}

async function preparePage(context, path = "/hallkeeper/today") {
  const page = await context.newPage();
  await page.addInitScript((seed) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: seed, writable: false });
  }, KEEPER);
  // Every route is anchored to the API origin: an origin-agnostic glob such
  // as **/notifications** also matched Vite's own /src/api/notifications.ts
  // module URL, and a module served as JSON left the shell unable to mount.
  await page.route(`${API}/calendar?*`, (route) => {
    void route.fulfill({ json: { data: calendarFixture(Date.now()) } });
  });
  await page.route(`${API}/venues/*/requests?*`, (route) => {
    void route.fulfill({ json: { data: requestsFixture(Date.now()) } });
  });
  // The slot's conversation (goal 19 S4): threads by booking, a page of
  // messages by thread, the floor's handlers, and receipts accepted.
  await page.route(`${API}/venues/*/threads?*`, (route) => {
    const bookingId = new URL(route.request().url()).searchParams.get("bookingId") ?? "";
    void route.fulfill({ json: { data: threadsFixture(bookingId, Date.now()) } });
  });
  await page.route(`${API}/threads/*/messages?*`, (route) => {
    const threadId = new URL(route.request().url()).pathname.split("/")[2] ?? "";
    void route.fulfill({ json: { data: messagesFixture(threadId, Date.now()) } });
  });
  await page.route(`${API}/messages/*/receipt`, (route) => {
    void route.fulfill({ json: { data: {
      messageId: "00000000-0000-4000-8000-0000000000e1", recipientUserId: KEEPER.id, recipientName: KEEPER.name,
      deliveredAt: new Date().toISOString(), readAt: new Date().toISOString(), acknowledgedAt: null,
    } } });
  });
  await page.route(`${API}/venues/*/handlers`, (route) => {
    void route.fulfill({ json: { data: [] } });
  });
  await page.route(`${API}/notifications**`, (route) => {
    void route.fulfill({ json: { data: [] } });
  });
  await page.route(`${API}/venues/${VENUE}`, (route) => {
    void route.fulfill({ json: { data: {
      id: VENUE, name: "Trades Hall Glasgow", slug: "trades-hall-glasgow", address: "85 Glassford Street",
      logoUrl: null, brandColour: null, timezone: "Europe/London", spaces: [],
    } } });
  });
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => { consoleErrors.push(String(error)); });
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "load" });
  try {
    await page.waitForSelector(".dayboard-slab", { timeout: 20_000 });
  } catch (error) {
    // Say what the page showed instead, so a failure names itself.
    const text = (await page.locator("body").innerText().catch(() => "")).slice(0, 600);
    console.error(`No slab on ${path}. Page said:\n${text}\nConsole errors:\n${consoleErrors.slice(0, 8).join("\n")}`);
    throw error;
  }
  return page;
}

/** Every slab's state, motion and ring, with the computed animations that
 *  carry them: [{ state, motion, attention, verb, dot, overlay, ring }]. */
async function readSlabs(page) {
  return page.evaluate(() => {
    const last = (value) => value.split(", ").pop() ?? "";
    const readings = [];
    for (const slab of document.querySelectorAll(".dayboard-slab")) {
      const dot = getComputedStyle(slab.querySelector(".dayboard-dot"));
      const overlay = getComputedStyle(slab, "::after");
      const ringElement = slab.querySelector(".dayboard-ring");
      // The halo breathes, not the ring: its words keep their full ink.
      const ring = ringElement === null ? null : getComputedStyle(ringElement, "::after");
      readings.push({
        title: slab.querySelector(".dayboard-slab-title")?.textContent ?? "",
        state: slab.dataset.state ?? "",
        motion: slab.dataset.motion ?? "",
        attention: slab.dataset.attention ?? "",
        verb: slab.querySelector(".dayboard-verb-words")?.textContent ?? "",
        dot: { name: dot.animationName, duration: dot.animationDuration, delay: last(dot.animationDelay) },
        overlay: { name: overlay.animationName, duration: overlay.animationDuration, delay: last(overlay.animationDelay) },
        ring: ring === null ? null : {
          level: ringElement.dataset.level ?? "",
          words: ringElement.querySelector(".dayboard-ring-words")?.textContent ?? "",
          name: last(ring.animationName),
          duration: last(ring.animationDuration),
          delay: last(ring.animationDelay),
        },
      });
    }
    return readings;
  });
}

const failures = [];
function check(label, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures.push(label);
}

const browser = await chromium.launch();
try {
  // ---- Pass 1: motion on -------------------------------------------------
  const motionContext = await browser.newContext({
    viewport: { width: 1680, height: 1050 },
    reducedMotion: "no-preference",
  });
  const page = await preparePage(motionContext);
  // textContent, not innerText: the verbs are uppercased by CSS and the NOW
  // plaque is laid out on two lines; the words themselves are what matter.
  const text = await page.locator(".dayboard").evaluate((board) => board.textContent ?? "");

  check("live verb", /LIVE · \d+ min elapsed/u.test(text));
  check("guests-due verb", /Guests · \d+ min/u.test(text));
  check("organisers-due verb", /Organisers · \d+ min/u.test(text));
  check("doors-soon verb", /Doors · \d+ min/u.test(text));
  check("scheduled verb", /Scheduled \d{1,2}:\d{2}/u.test(text));
  check("done verb", /Ended \d{1,2}:\d{2}/u.test(text));
  check("exception verb says why", /Changeover at risk · /u.test(text));
  check("legend teaches every state in the slots' words", [
    "Scheduled", "Organisers due", "Guests due", "Doors soon", "Live", "Clear-down", "Ended", "Changeover at risk",
  ].every((words) => text.includes(words)));
  check("NOW plaque on the ruler", /NOW\d{1,2}:\d{2}/u.test(text));
  check("short changeovers dimensioned against the rule", (await page.locator(".dayboard-gap.is-short").count()) === 2 && /needs 1 h/u.test(text));
  check("the next action is the urgent request nobody owns", /^Take now:/u.test((await page.locator(".dayboard-next").innerText()).trim()));
  check("UNOWNED rail lists the two requests nobody has", (await page.locator(".dayboard-rail-item").count()) === 2);

  const slabs = await readSlabs(page);
  const byState = Object.fromEntries(slabs.map((slab) => [slab.state, slab]));
  check("every state is on the board", ["live", "guests-due", "organisers-due", "imminent", "scheduled", "done", "exception"].every((state) => state in byState));
  check("two slabs carry the changeover exception", slabs.filter((slab) => slab.state === "exception").length === 2);

  const cadence = { "breath-4s": "4s", "breath-3s": "3s", "breath-2s": "2s", "live-breath": "4s" };
  const breathing = slabs.filter((slab) => slab.motion !== "none");
  check("every slab with a motion breathes on its dot", breathing.length >= 4 && breathing.every((slab) => slab.dot.name === "lt-dot-breath"));
  check("cadences: 4 s organisers, 3 s guests, 2 s doors, 4 s live", breathing.every((slab) => slab.dot.duration === cadence[slab.motion]));
  check("the live slab breathes its overlay at 4 s", byState.live?.overlay.name === "lt-live-breath" && byState.live?.overlay.duration === "4s");
  check("still states do not move", slabs.filter((slab) => slab.motion === "none").every((slab) => slab.dot.name === "none" && slab.overlay.name === "none"));

  const rings = slabs.filter((slab) => slab.ring !== null);
  const ringByLevel = Object.fromEntries(rings.map((slab) => [slab.ring.level, slab.ring]));
  check("an unowned request's halo breathes at 4 s", ringByLevel.attention?.name === "lt-halo-breath" && ringByLevel.attention?.duration === "4s");
  check("an urgent request's halo pulses at 1.5 s", ringByLevel.urgent?.name === "lt-halo-pulse" && ringByLevel.urgent?.duration === "1.5s");
  check("an owned request's ring is still and names its owner", ringByLevel.owned?.name === "none" && ringByLevel.owned?.words === "Elaine has this");

  // Each breath samples its own epoch phase the moment it begins (D3 law 1);
  // breaths that began in the same render differ by the milliseconds between
  // their samples, never by a beat.
  const delaysMs = [
    ...breathing.map((slab) => slab.dot.delay),
    ...(byState.live ? [byState.live.overlay.delay] : []),
    ...rings.filter((slab) => slab.ring.name !== "none").map((slab) => slab.ring.delay),
  ].map((delay) => Math.round(Number.parseFloat(delay) * 1000));
  const spread = delaysMs.length === 0 ? Number.NaN : Math.max(...delaysMs) - Math.min(...delaysMs);
  check(`phase lock: every breath on one epoch phase within 50 ms (spread ${String(spread)} ms over ${String(delaysMs.length)} breaths)`, delaysMs.length >= 5 && spread <= 50);

  await page.screenshot({ path: join(OUT, "motion-on.png"), fullPage: true });

  // ---- Pass 2: reduced motion -------------------------------------------
  const calmContext = await browser.newContext({
    viewport: { width: 1680, height: 1050 },
    reducedMotion: "reduce",
  });
  const calm = await preparePage(calmContext);
  const calmSlabs = await readSlabs(calm);
  check("reduced motion: no dot, overlay or ring animates", calmSlabs.every((slab) =>
    slab.dot.name === "none" && slab.overlay.name === "none" && (slab.ring === null || slab.ring.name === "none")));
  check("reduced motion: the verbs still carry the meaning", calmSlabs.every((slab) => slab.verb.length > 0));
  await calm.screenshot({ path: join(OUT, "reduced-motion.png"), fullPage: true });

  // ---- Pass 3: the phone ---------------------------------------------------
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await preparePage(phoneContext);
  const paged = await phone.locator(".dayboard-lanes").evaluate((lanes) => ({
    wider: lanes.scrollWidth > lanes.clientWidth,
    first: lanes.firstElementChild?.getBoundingClientRect().width ?? 0,
    screen: lanes.clientWidth,
  }));
  check("phone: one lane per screen, swiped between rooms (D7)", paged.wider && Math.round(paged.first) === Math.round(paged.screen)
    && (await phone.locator(".dayboard[data-layout='phone']").count()) === 1 && (await phone.locator(".dayboard-pager button").count()) >= 2);
  await phone.screenshot({ path: join(OUT, "phone.png"), fullPage: true });

  // ---- Pass 4: the wall ----------------------------------------------------
  const wallContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const wall = await preparePage(wallContext, "/hallkeeper/today?register=wall");
  check("wall: the dark register, without the day controls", (await wall.locator(".dayboard[data-register='wall']").count()) === 1
    && (await wall.getByRole("button", { name: "Previous day" }).count()) === 0);
  await wall.screenshot({ path: join(OUT, "wall.png"), fullPage: true });

  // ---- Pass 5: an open slot ------------------------------------------------
  await page.locator(".dayboard-slab[data-state='live']").click();
  const detail = page.locator(".dayboard-detail");
  check("a tap opens the slot to its detail", (await detail.count()) === 1 && /Chamber banquet/u.test(await detail.innerText()));
  check("the request region is mounted in the open slot", (await detail.locator(".vv-requests").count()) === 1);
  await page.screenshot({ path: join(OUT, "open-slot.png"), fullPage: true });

  // ---- Pass 6: the slot's conversation (goal 19 S4) --------------------------
  // The ceilidh carries the client's ask: its card stands on the paper
  // register, the slot shows one tab per thread, and only the client's wears
  // the badge. Checked on the office sheet and on the phone.
  async function conversationChecks(target, label) {
    await target.locator(".dayboard-slab[data-state='guests-due']").click();
    const open = target.locator(".dayboard-detail");
    await open.locator(".vv-conversation-tab").first().waitFor({ timeout: 10_000 });
    const card = open.locator(".vv-request").first();
    const cardGround = await card.evaluate((element) => getComputedStyle(element).backgroundColor);
    check(`${label}: the request card stands on the raised ivory (${cardGround})`, cardGround === "rgb(255, 253, 248)");
    check(`${label}: the card names the client's ask`, /Chairs × 10/u.test(await card.innerText()) && /Morag \(client\)/u.test(await card.innerText()));
    const tabs = open.locator(".vv-conversation-tab");
    const labels = await tabs.evaluateAll((elements) => elements.map((element) => element.textContent ?? ""));
    check(`${label}: one tab per thread, the floor's first`, labels.length === 2 && labels[0] === "Floor notes" && /Chairs × 10/u.test(labels[1] ?? ""));
    const badges = await open.locator(".vv-conversation-tab .vv-thread-badge").evaluateAll((elements) => elements.map((element) => element.closest(".vv-conversation-tab")?.getAttribute("data-audience")));
    check(`${label}: the badge is on the client-facing tab and on no other`, badges.length === 1 && badges[0] === "client-facing");
    check(`${label}: the floor's composer is labelled for the floor`, (await open.getByLabel("Note to the floor").count()) === 1);
    await tabs.nth(1).click();
    await open.getByLabel("Reply to the client").waitFor({ timeout: 10_000 });
    // The composer mounts before the page of messages lands; wait for the words.
    await open.getByText(/Ten more for the top table/u).waitFor({ timeout: 10_000 });
    check(`${label}: the client's thread shows the ask and a composer labelled for the client`,
      /Ten more for the top table/u.test(await open.innerText()) && (await open.locator(".vv-thread-badge--composer").count()) === 1);
  }
  await page.locator(".dayboard-detail-close").click();
  await conversationChecks(page, "office");
  await page.screenshot({ path: join(OUT, "open-slot-conversation.png"), fullPage: true });
  await conversationChecks(phone, "phone");
  await phone.screenshot({ path: join(OUT, "open-slot-phone.png"), fullPage: true });
} finally {
  await browser.close();
}

console.log(failures.length === 0 ? `\nAll Day Board checks passed. Screenshots in ${OUT}` : `\n${String(failures.length)} check(s) failed.`);
process.exit(failures.length === 0 ? 0 : 1);
