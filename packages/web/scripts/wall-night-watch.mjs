// The wall night, watched (goal 19 D10 and "the wall display survives the
// night"; Plan 19 L9).
//
// Opens the Day Board's wall register in a headed Chromium window with its
// own profile on this machine, waits while a person signs in as the
// hallkeeper (an agent may not), then leaves it alone and writes down, every
// few minutes until the morning, what a person walking past would see: the
// day the board shows, when it last read the house, whether the stale band is
// up, how many slabs, the page's errors, and the page's memory. A screenshot
// every hour. In the morning it says plainly whether the board rolled to the
// new day at the venue's boundary, how long it was ever stale, whether the
// session survived (the sign-in page never came back), and how memory moved.
//
// It is a desktop Chromium on mains, not the tablet on the wall: it proves
// the session refresh, the rollover, the reconnects and the memory over a
// night, not the tablet's Wake Lock, burn-in or Guided Access, which the
// runbook checks with eyes in the morning.
//
//   node packages/web/scripts/wall-night-watch.mjs
//
// Env: BASE_URL (default https://venviewer.com), HOURS (default 14),
//   EVERY_MINUTES (default 5), PROFILE_DIR (default ~/.venviewer-ring-latency,
//   shared with ring-latency-live.mjs so one sign-in serves both),
//   OUT_DIR (default ./wall-night-<date>), CHROMIUM_PATH,
//   SIGN_IN_MINUTES (default 15).
//   DRY_RUN=1 rehearses the watcher against BASE_URL's dev server (default
//   http://localhost:5173) with a mocked calendar; use with HOURS=0.05 and
//   EVERY_MINUTES=0.25. It watches nothing real.
import { chromium } from "@playwright/test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DRY_RUN = process.env.DRY_RUN === "1";
const BASE_URL = process.env.BASE_URL ?? (DRY_RUN ? "http://localhost:5173" : "https://venviewer.com");
const HOURS = Number(process.env.HOURS ?? "14");
const EVERY_MS = Number(process.env.EVERY_MINUTES ?? "5") * 60_000;
const PROFILE_DIR = process.env.PROFILE_DIR ?? join(homedir(), ".venviewer-ring-latency");
const SIGN_IN_MS = Number(process.env.SIGN_IN_MINUTES ?? "15") * 60_000;
const STAMP = new Date().toISOString().slice(0, 10);
const OUT_DIR = process.env.OUT_DIR ?? join(process.cwd(), `wall-night-${STAMP}`);
if (!(HOURS > 0 && HOURS <= 24) || !(EVERY_MS >= 10_000)) throw new Error("HOURS must be in (0, 24] and EVERY_MINUTES at least 1/6");
mkdirSync(OUT_DIR, { recursive: true });
const LOG = join(OUT_DIR, "readings.jsonl");

async function rehearse(page) {
  const api = process.env.API_URL ?? "http://localhost:3001";
  const venueId = "20000000-0000-4000-8000-000000000002";
  await page.addInitScript((seed) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: seed, writable: false });
  }, { id: "e0000000-0000-4000-8000-000000000001", email: "hallkeeper@e2e.test", role: "hallkeeper", venueId, name: "Elaine" });
  const json = (route, data) => route.fulfill({ json: { data } });
  const now = Date.now();
  await page.route(`${api}/calendar?*`, (route) => json(route, {
    venueId, range: { from: new Date(now - 864e5).toISOString(), to: new Date(now + 864e5).toISOString() },
    rooms: [{ id: "30000000-0000-4000-8000-000000000001", name: "Grand Hall", slug: "grand-hall", sortOrder: 0 }],
    entries: [{
      entryType: "booking", id: "50000000-0000-4000-8000-000000000002", spaceId: "30000000-0000-4000-8000-000000000001",
      kind: "ink", status: "active", state: "ink", title: "Watcher rehearsal", eventType: "dinner",
      startsAt: new Date(now + 36e5).toISOString(), endsAt: new Date(now + 4 * 36e5).toISOString(), rank: null, jointFlag: false,
      decisionAt: null, ownerUserId: null, nextAction: null, nextActionDueAt: null, eventId: null, seriesId: null,
    }],
    conflicts: { conflicts: [], checks: { inkDoubleBook: { status: "checked" }, holdOverlap: { status: "checked" }, turnaround: { status: "checked", uncoveredPairCount: 0, detail: "" } } },
  }));
  await page.route(`${api}/venues/${venueId}`, (route) => json(route, {
    id: venueId, name: "Trades Hall Glasgow", slug: "trades-hall-glasgow", address: "Rehearsal", logoUrl: null, brandColour: null, timezone: "Europe/London", spaces: [],
  }));
  await page.route(`${api}/notifications**`, (route) => json(route, []));
  await page.route(`${api}/venues/*/requests?*`, (route) => json(route, []));
  await page.route(`${api}/venues/*/observations?*`, (route) => json(route, []));
}

/** What a person walking past would see, and what the page knows about itself. */
async function read(page) {
  return page.evaluate(() => {
    const text = (selector) => document.querySelector(selector)?.textContent?.replace(/\s+/gu, " ").trim() ?? null;
    const memory = performance.memory;
    return {
      url: location.pathname + location.search,
      boardDay: text(".dayboard-subtitle"),
      status: text(".dayboard-status"),
      staleBand: text(".dayboard-stale"),
      slabs: document.querySelectorAll(".dayboard-slab").length,
      heapMB: memory === undefined ? null : Math.round(memory.usedJSHeapSize / 1_048_576),
    };
  });
}

const context = await chromium.launchPersistentContext(join(PROFILE_DIR, "wall"), {
  headless: DRY_RUN,
  viewport: { width: 1920, height: 1080 },
  timezoneId: "Europe/London",
  ...(process.env.CHROMIUM_PATH === undefined ? {} : { executablePath: process.env.CHROMIUM_PATH }),
});
const page = context.pages()[0] ?? await context.newPage();
const errors = [];
page.on("pageerror", (error) => { errors.push({ at: new Date().toISOString(), error: String(error).slice(0, 300) }); });
page.on("crash", () => { errors.push({ at: new Date().toISOString(), error: "the page crashed" }); });
const readings = [];
try {
  if (DRY_RUN) await rehearse(page);
  await page.goto(`${BASE_URL}/hallkeeper/today?register=wall`);
  if (!DRY_RUN) process.stdout.write(`Sign in as the HALLKEEPER in the window that opened (waiting up to ${String(SIGN_IN_MS / 60_000)} min); then leave it.\n`);
  await page.locator(".dayboard-slab, .dayboard-subtitle").first().waitFor({ state: "visible", timeout: SIGN_IN_MS });
  const until = Date.now() + HOURS * 3_600_000;
  let nextShot = Date.now();
  while (Date.now() < until) {
    const reading = { at: new Date().toISOString(), ...(await read(page).catch((error) => ({ unreadable: String(error).slice(0, 200) }))), errorsSoFar: errors.length };
    readings.push(reading);
    appendFileSync(LOG, `${JSON.stringify(reading)}\n`);
    if (Date.now() >= nextShot) {
      await page.screenshot({ path: join(OUT_DIR, `wall-${reading.at.slice(11, 16).replace(":", "")}.png`) }).catch(() => undefined);
      nextShot += 3_600_000;
    }
    await page.waitForTimeout(Math.min(EVERY_MS, Math.max(0, until - Date.now())));
  }
} finally {
  const first = readings[0];
  const last = readings.at(-1);
  let staleRun = 0;
  let longestStale = 0;
  for (const reading of readings) {
    staleRun = reading.staleBand === null || reading.staleBand === undefined ? 0 : staleRun + 1;
    longestStale = Math.max(longestStale, staleRun);
  }
  const summary = {
    deployment: BASE_URL,
    dryRun: DRY_RUN,
    from: first?.at ?? null,
    to: last?.at ?? null,
    readings: readings.length,
    everyMinutes: EVERY_MS / 60_000,
    boardDays: [...new Set(readings.map((reading) => reading.boardDay))],
    rolledToNewDay: first !== undefined && last !== undefined && first.boardDay !== last.boardDay,
    longestStaleMinutes: longestStale * (EVERY_MS / 60_000),
    stillOnTheBoard: last?.url?.startsWith("/hallkeeper/today") === true && (last?.slabs ?? 0) > 0,
    heapMB: { first: first?.heapMB ?? null, last: last?.heapMB ?? null, max: Math.max(...readings.map((reading) => reading.heapMB ?? 0)) },
    pageErrors: errors,
    limits: "Desktop Chromium on this machine; the tablet's Wake Lock, burn-in and Guided Access are checked by eye.",
  };
  writeFileSync(join(OUT_DIR, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  await context.close();
}
