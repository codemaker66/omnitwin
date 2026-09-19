// The request slab — visual verification harness (Ship Friday slice 10).
//
// Drives its own headless Chromium, same family as day-board-visual-check.mjs.
// It proves the things the plan fixes, in the REAL rendered board:
//   1. the slab renders inside Lane 6's reserved region, on the right slot;
//   2. ONE pulse: the dot's animation runs exactly once, and a slot with
//      nothing waiting carries no chrome at all;
//   3. reduced motion: no animation anywhere, and the words still say what is
//      waiting, who asked and how long ago.
// It also presses "Ask for something" and walks a request to Done, so the
// composer and the ladder are exercised rather than described.
//
// Run from the repo root with the web dev server up:
//   node packages/web/scripts/slot-requests-visual-check.mjs
// Env: BASE_URL (default http://localhost:5173), OUT_DIR (screenshot dir).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";
const OUT = process.env.OUT_DIR ?? join(process.cwd(), "visual-out", "slot-requests");
mkdirSync(OUT, { recursive: true });

const VENUE = "00000000-0000-4000-8000-000000000001";
const GRAND_HALL = "00000000-0000-4000-8000-0000000000a1";
const SALOON = "00000000-0000-4000-8000-0000000000a2";
const BOOKING = "00000000-0000-4000-8000-0000000000b1";
const OTHER_BOOKING = "00000000-0000-4000-8000-0000000000b2";
const MIN = 60_000;

function booking(id, spaceId, startOffsetMin, endOffsetMin, title, now) {
  return {
    entryType: "booking", id, spaceId, kind: "ink", status: "active", state: "ink",
    title, eventType: "dinner",
    startsAt: new Date(now + startOffsetMin * MIN).toISOString(),
    endsAt: new Date(now + endOffsetMin * MIN).toISOString(),
    rank: null, jointFlag: false, decisionAt: null, ownerUserId: null,
    nextAction: null, nextActionDueAt: null, eventId: null, seriesId: null,
  };
}

function calendarFixture(now) {
  return {
    venueId: VENUE,
    range: {
      from: new Date(now - 12 * 60 * MIN).toISOString(),
      to: new Date(now + 12 * 60 * MIN).toISOString(),
    },
    rooms: [
      { id: GRAND_HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 },
      { id: SALOON, name: "Saloon", slug: "saloon", sortOrder: 1 },
    ],
    entries: [
      booking(BOOKING, GRAND_HALL, -60, 120, "Chamber banquet", now),
      booking(OTHER_BOOKING, SALOON, 25, 180, "Craft ceilidh", now),
    ],
    conflicts: {
      conflicts: [],
      checks: {
        inkDoubleBook: { status: "checked" },
        holdOverlap: { status: "checked" },
        turnaround: { status: "checked", uncoveredPairCount: 0, detail: "All gaps covered." },
      },
    },
  };
}

function request(id, overrides = {}) {
  const now = Date.now();
  return {
    id,
    venueId: VENUE,
    bookingId: BOOKING,
    eventId: null,
    roomId: GRAND_HALL,
    roomName: "Grand Hall",
    kind: "refreshments",
    quantity: 6,
    urgency: "now",
    detail: "Six more jugs of water on the top table, please.",
    requestedByUserId: null,
    requestedByName: "Elaine",
    requestedByRole: "hallkeeper",
    audienceRoles: ["staff", "hallkeeper", "admin"],
    ownerUserId: null,
    ownerName: null,
    state: "sent",
    outcome: null,
    outcomeNote: null,
    escalationDueAt: new Date(now + 180_000).toISOString(),
    escalatedAt: null,
    acknowledgedAt: null,
    acceptedAt: null,
    resolvedAt: null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    ...overrides,
  };
}

const FRESH = "11111111-1111-4111-8111-111111111111";
const OLDER = "22222222-2222-4222-8222-222222222222";

function snapshot() {
  const settled = new Date(Date.now() - 6 * MIN).toISOString();
  return [
    request(FRESH),
    request(OLDER, {
      kind: "cleaning", quantity: null, urgency: "soon", state: "accepted",
      ownerName: "Fiona", detail: null, createdAt: settled, updatedAt: settled,
      escalationDueAt: null,
    }),
  ];
}

async function preparePage(context) {
  const page = await context.newPage();
  await page.addInitScript((seed) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: seed, writable: false });
  }, {
    id: "visual-hallkeeper",
    email: "visual-hallkeeper@e2e.test",
    role: "hallkeeper",
    platformRole: "none",
    venueId: VENUE,
    name: "Visual Hallkeeper",
  });
  await page.route("**/calendar?*", (route) => {
    void route.fulfill({ json: calendarFixture(Date.now()) });
  });
  let live = snapshot();
  // Regular expressions, not globs: Playwright's URL globs treat `?` as the
  // start of the query string, so `**/requests*` silently stops matching the
  // very URL the client sends (`/venues/<id>/requests?status=open&limit=200`)
  // and the harness would end up measuring an un-mocked page.
  await page.route(/\/venues\/[^/]+\/requests(\?|$)/u, (route) => {
    if (route.request().method() === "GET") {
      void route.fulfill({ json: { data: live } });
      return;
    }
    const body = JSON.parse(route.request().postData() ?? "{}");
    const made = request("33333333-3333-4333-8333-333333333333", {
      kind: body.kind, urgency: body.urgency, quantity: body.quantity ?? null,
      detail: body.detail ?? null, requestedByName: "Visual Hallkeeper",
    });
    live = [made, ...live];
    void route.fulfill({ status: 201, json: { data: made } });
  });
  await page.route(/\/requests\/[0-9a-fA-F-]+$/u, (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    const id = route.request().url().split("/").pop();
    const target = live.find((item) => item.id === id) ?? request(id ?? FRESH);
    const moved = {
      ...target,
      state: body.to,
      ownerName: body.to === "accepted" ? "Visual Hallkeeper" : target.ownerName,
      outcome: body.to === "resolved" ? body.outcome : null,
    };
    live = body.to === "resolved"
      ? live.filter((item) => item.id !== id)
      : live.map((item) => (item.id === id ? moved : item));
    void route.fulfill({ json: { data: moved } });
  });
  await page.goto(`${BASE_URL}/hallkeeper/today`, { waitUntil: "networkidle" });
  await page.waitForSelector(".dayboard-slot", { timeout: 20_000 });
  return page;
}

/** The dot's computed animation, plus how many times it will run. */
function readDot(page) {
  return page.evaluate(() => {
    const dot = document.querySelector(".vv-requests-dot");
    if (dot === null) return null;
    const style = getComputedStyle(dot);
    return {
      motion: dot.getAttribute("data-motion"),
      name: style.animationName,
      iterations: style.animationIterationCount,
      duration: style.animationDuration,
    };
  });
}

/** WCAG contrast between an element's text and the first opaque background
 *  behind it. Measured in the page, so it reflects the cascade rather than a
 *  token somebody hoped was applied. */
function contrastOf(page, selector) {
  return page.evaluate((target) => {
    const element = document.querySelector(target);
    if (element === null) return 0;
    const parse = (value) => {
      const parts = /rgba?\(([^)]+)\)/u.exec(value);
      if (parts === null) return null;
      const numbers = parts[1].split(",").map((part) => Number.parseFloat(part));
      return { r: numbers[0], g: numbers[1], b: numbers[2], a: numbers[3] ?? 1 };
    };
    const luminance = ({ r, g, b }) => {
      const channel = (value) => {
        const scaled = value / 255;
        return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const text = parse(getComputedStyle(element).color);
    if (text === null) return 0;
    let node = element;
    let ground = null;
    while (node !== null && ground === null) {
      const candidate = parse(getComputedStyle(node).backgroundColor);
      if (candidate !== null && candidate.a === 1) ground = candidate;
      node = node.parentElement;
    }
    if (ground === null) ground = { r: 255, g: 255, b: 255, a: 1 };
    const lighter = Math.max(luminance(text), luminance(ground));
    const darker = Math.min(luminance(text), luminance(ground));
    return (lighter + 0.05) / (darker + 0.05);
  }, selector);
}

const failures = [];
function check(label, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures.push(label);
}

const browser = await chromium.launch();
try {
  // ---- Pass 1: the slab on the slot, one pulse ---------------------------
  const context = await browser.newContext({
    viewport: { width: 1680, height: 1050 },
    reducedMotion: "no-preference",
  });
  const page = await preparePage(context);
  await page.waitForSelector(".vv-requests", { timeout: 20_000 });

  const region = page.locator(`[data-slot-requests="${BOOKING}"]`);
  check("the slab is inside Lane 6's reserved region", await region.locator(".vv-requests").count() === 1);
  check("a slot with no requests shows no request chrome",
    (await page.locator(`[data-slot-requests="${OTHER_BOOKING}"] .vv-requests-summary`).count()) === 0);

  const text = await region.innerText();
  check("summary counts what is open and what waits", /2 requests · 1 waiting/u.test(text));
  check("it names what was asked for", text.includes("Refreshments × 6"));
  check("it names who asked and how long ago", /Elaine · (just now|a minute ago|\d+ minutes ago)/u.test(text));
  check("a taken request says who has it", text.includes("Someone is on it") && text.includes("Fiona"));
  check("no developer vocabulary on the surface",
    !/\b(acknowledged|payload|idempotenc|null|undefined)\b/iu.test(text));

  const dot = await readDot(page);
  check(`the dot pulses ONCE (name ${dot?.name ?? "none"}, iterations ${dot?.iterations ?? "-"})`,
    dot !== null && dot.name === "vv-request-arrive" && dot.iterations === "1");

  await page.screenshot({ path: join(OUT, "slot-requests-board.png"), fullPage: true });
  await region.screenshot({ path: join(OUT, "slot-requests-slab.png") });

  // Accept and finish, from the slot.
  await region.getByRole("button", { name: "I’ll do it" }).first().click();
  await page.waitForFunction(() => document.body.innerText.includes("Visual Hallkeeper"), null, { timeout: 10_000 });
  check("accepting from the slot names the person who took it",
    (await region.innerText()).includes("Visual Hallkeeper"));

  await region.getByRole("button", { name: "Finish" }).first().click();
  await region.getByRole("button", { name: "Done" }).first().click();
  await page.waitForFunction(() => !document.body.innerText.includes("Six more jugs"), null, { timeout: 10_000 })
    .catch(() => undefined);
  check("a finished request leaves the slab", !(await region.innerText()).includes("Six more jugs"));
  await region.screenshot({ path: join(OUT, "slot-requests-after-finish.png") });

  // "Ask for something" stands on the slot's ivory card, not inside a forest
  // slab. It once inherited paper-on-forest colours and was invisible there,
  // so its contrast is measured rather than eyeballed.
  const askContrast = await contrastOf(page, ".vv-request-ask");
  check(`"Ask for something" is legible on the slot's own ground (${askContrast.toFixed(2)}:1)`,
    askContrast >= 4.5);

  // The composer: staff create a request from the slot.
  await region.getByRole("button", { name: "Ask for something" }).click();
  await region.getByRole("button", { name: "Room temperature" }).click();
  await region.getByRole("button", { name: "Now", exact: true }).click();
  await region.screenshot({ path: join(OUT, "slot-requests-composer.png") });
  await region.getByRole("button", { name: "Send it" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Room temperature"), null, { timeout: 10_000 });
  check("a request made from the slot appears on the slot",
    (await region.innerText()).includes("Room temperature"));

  await context.close();

  // ---- Pass 2: a phone ----------------------------------------------------
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "no-preference",
  });
  const phonePage = await preparePage(phone);
  await phonePage.waitForSelector(".vv-requests", { timeout: 20_000 });
  const overflow = await phonePage.evaluate(() => document.documentElement.scrollWidth);
  check(`nothing pushes a 390px phone sideways (scrollWidth ${String(overflow)})`, overflow <= 390);
  const smallTargets = await phonePage.evaluate(() => {
    const tooSmall = [];
    for (const button of document.querySelectorAll(".vv-requests button")) {
      const box = button.getBoundingClientRect();
      if (box.height < 44) tooSmall.push(`${button.textContent?.trim() ?? "?"}:${String(Math.round(box.height))}`);
    }
    return tooSmall;
  });
  check(`every action is at least 44px tall (${smallTargets.join(", ") || "all fine"})`, smallTargets.length === 0);
  await phonePage.screenshot({ path: join(OUT, "slot-requests-phone.png"), fullPage: true });
  await phone.close();

  // ---- Pass 3: reduced motion --------------------------------------------
  const reduced = await browser.newContext({
    viewport: { width: 1680, height: 1050 },
    reducedMotion: "reduce",
  });
  const reducedPage = await preparePage(reduced);
  await reducedPage.waitForSelector(".vv-requests", { timeout: 20_000 });
  const reducedDot = await readDot(reducedPage);
  check("reduced motion: the pulse does not happen", reducedDot?.name === "none");
  const reducedText = await reducedPage.locator(`[data-slot-requests="${BOOKING}"]`).innerText();
  check("reduced motion: the words still carry the meaning",
    /2 requests · 1 waiting/u.test(reducedText) && reducedText.includes("Refreshments × 6"));
  await reducedPage.screenshot({ path: join(OUT, "slot-requests-reduced-motion.png"), fullPage: true });
  await reduced.close();
} finally {
  await browser.close();
}

console.log(`\nScreenshots: ${OUT}`);
if (failures.length > 0) {
  console.error(`\n${String(failures.length)} check(s) failed.`);
  process.exit(1);
}
console.log("Slot requests visual check: all green.");
