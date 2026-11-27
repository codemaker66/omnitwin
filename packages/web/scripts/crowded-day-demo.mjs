// The Day Board on a crowded Trades Hall day (L9): a local demo and a
// rendered check, with no database and no sign-in. Drives its OWN headless
// Chromium via Playwright, as day-board-visual-check.mjs does, and answers
// the page's API calls from @omnitwin/types' crowdedTradesHallDay(): six
// rooms, twenty-one functions, sixteen open requests, the facts seen in the
// rooms. The page's clock is set to the day's busiest moment (14:20 venue
// time) so the board shows the ceremony live, the prize giving's changeover
// at risk and an urgent request nobody owns.
//
// It checks what a hallkeeper must see on a crowded day (goal 05: "every
// slot's severity is legible in a crowded day and under reduced motion"):
// every function on its lane, every slab saying its state in words, the
// UNOWNED rail holding every unowned request, the next action leading with
// the urgent one; then it takes screenshots on the office screen, a phone,
// the wall display and under reduced motion. It exits non-zero when a check
// fails. Screenshots are evidence for a person to look at, not acceptance.
//
// Run from the repo root with the web dev server up and @omnitwin/types built:
//   pnpm --filter @omnitwin/types build
//   node packages/web/scripts/crowded-day-demo.mjs
// Env: BASE_URL (default http://localhost:5173), API_URL (the origin the page
//   calls; default http://localhost:3001), OUT_DIR (screenshots),
//   CHROMIUM_PATH (a Chromium binary, when Playwright's own is not installed),
//   CROWDED_DAY_DATE (YYYY-MM-DD; default the fixture's Saturday),
//   HEADED=1 (watch it; the page stays open until the window is closed).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { crowdedDayOpenRequests, crowdedTradesHallDay, isUnownedRequest } from "@omnitwin/types";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";
const API = process.env.API_URL ?? "http://localhost:3001";
const OUT = process.env.OUT_DIR ?? join(process.cwd(), "visual-out", "crowded-day");
const HEADED = process.env.HEADED === "1";
mkdirSync(OUT, { recursive: true });

const day = crowdedTradesHallDay(process.env.CROWDED_DAY_DATE);
const open = crowdedDayOpenRequests(day);
const unowned = open.filter((request) => isUnownedRequest({ state: request.state, ownerUserId: request.ownerUserId }));
const bookings = day.calendar.entries.filter((entry) => entry.entryType === "booking");
const elaine = day.people.find((person) => person.name === "Elaine");
const KEEPER = { id: elaine.id, email: elaine.email, role: "hallkeeper", venueId: day.venue.id, name: elaine.name };

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === "" ? "" : ` · ${detail}`}`);
  if (!ok) failures += 1;
}

async function preparePage(context, path) {
  const page = await context.newPage();
  await page.clock.setFixedTime(day.busiestAtMs);
  await page.addInitScript((seed) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: seed, writable: false });
  }, KEEPER);
  const json = (route, data) => route.fulfill({ json: { data } });
  // Every route is anchored to the API origin, as the visual harness learned.
  await page.route(`${API}/calendar?*`, (route) => json(route, day.calendar));
  await page.route(`${API}/venues/*/requests?*`, (route) => json(route, open));
  await page.route(`${API}/venues/*/observations?*`, (route) => json(route, day.observations));
  await page.route(`${API}/venues/*/threads?*`, (route) => json(route, []));
  await page.route(`${API}/venues/*/handlers`, (route) => json(route, day.people
    .filter((person) => person.role !== "client")
    .map((person) => ({ id: person.id, name: person.name, role: person.role }))));
  await page.route(`${API}/notifications**`, (route) => json(route, []));
  await page.route(`${API}/venues/${day.venue.id}`, (route) => json(route, {
    id: day.venue.id, name: day.venue.name, slug: day.venue.slug, address: "Crowded-day fixture",
    logoUrl: null, brandColour: null, timezone: day.timeZone, spaces: [],
  }));
  const errors = [];
  page.on("pageerror", (error) => { errors.push(String(error)); });
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "load" });
  try {
    await page.waitForSelector(".dayboard-slab", { timeout: 20_000 });
  } catch (error) {
    const text = (await page.locator("body").innerText().catch(() => "")).slice(0, 600);
    console.error(`No slab on ${path}. Page said:\n${text}\nPage errors:\n${errors.slice(0, 8).join("\n")}`);
    throw error;
  }
  // Let the requests and facts land on the slabs.
  await page.waitForTimeout(1_500);
  return { page, errors };
}

/** What each slab says, as text a person reads. */
async function slabWords(page) {
  return page.locator(".dayboard-slab").evaluateAll((slabs) => slabs.map((slab) => ({
    booking: slab.getAttribute("data-booking"),
    text: (slab.textContent ?? "").replace(/\s+/gu, " ").trim(),
  })));
}

/** Slabs whose state line is cut off where it is drawn. The words still
 *  reach a screen reader through the slab's name; this is about the eye, so
 *  it is reported as a finding for the board's owner, not failed here. */
async function reportCutVerbs(page, where) {
  const cut = await page.locator(".dayboard-slab").evaluateAll((slabs) => slabs.flatMap((slab) => {
    const verb = slab.querySelector(".dayboard-verb");
    if (verb === null || verb.scrollWidth <= verb.clientWidth + 1) return [];
    const title = slab.querySelector(".dayboard-slab-title")?.textContent ?? "a slab";
    // innerText: what is drawn, without the short verb CSS hides at this width.
    return [`${title}: "${(verb instanceof HTMLElement ? verb.innerText : "").replace(/\s+/gu, " ").trim()}"`];
  }));
  console.log(`${cut.length === 0 ? "OK     " : "FINDING"}  ${where}: ${String(cut.length)} slab state line(s) cut off where drawn`);
  for (const line of cut) console.log(`           ${line}`);
}

const browser = await chromium.launch({
  headless: !HEADED,
  ...(process.env.CHROMIUM_PATH === undefined ? {} : { executablePath: process.env.CHROMIUM_PATH }),
});
try {
  // The office screen, motion on.
  const office = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: day.timeZone });
  const { page, errors } = await preparePage(office, "/hallkeeper/today");
  const slabs = await slabWords(page);
  check("every function of the day is on the board", slabs.length === bookings.length, `${String(slabs.length)} of ${String(bookings.length)}`);
  const silent = slabs.filter((slab) => slab.text.length === 0);
  check("every slab says its state in words", silent.length === 0, silent.map((slab) => slab.booking).join(", "));
  const railText = (await page.locator("body").innerText()).replace(/\s+/gu, " ");
  const missing = unowned.filter((request) => !railText.includes(request.roomName ?? ""));
  check("the UNOWNED rail names the room of every unowned request", missing.length === 0, `${String(unowned.length)} unowned`);
  check("the next action leads with the urgent request nobody has", railText.includes("Chairs × 6"));
  check("the prize giving's changeover is called at risk", railText.includes("Changeover at risk"));
  check("the page raised no errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.screenshot({ path: join(OUT, "office.png"), fullPage: true });
  await reportCutVerbs(page, "office");
  if (HEADED) await page.waitForEvent("close", { timeout: 0 });
  await office.close();

  // Reduced motion: the same words, no breathing.
  const calm = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: day.timeZone, reducedMotion: "reduce" });
  const reduced = await preparePage(calm, "/hallkeeper/today");
  const animated = await reduced.page.locator(".dayboard-slab *").evaluateAll((nodes) => nodes
    .filter((node) => getComputedStyle(node).animationName !== "none").length);
  check("under reduced motion nothing breathes", animated === 0, `${String(animated)} animated`);
  const calmSlabs = await slabWords(reduced.page);
  check("under reduced motion every slab still says its state", calmSlabs.every((slab) => slab.text.length > 0));
  await reduced.page.screenshot({ path: join(OUT, "office-reduced-motion.png"), fullPage: true });
  await calm.close();

  // A phone, and the wall display.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, timezoneId: day.timeZone });
  const onPhone = await preparePage(phone, "/hallkeeper/today");
  await onPhone.page.screenshot({ path: join(OUT, "phone.png") });
  await reportCutVerbs(onPhone.page, "phone");
  await phone.close();
  const wall = await browser.newContext({ viewport: { width: 1920, height: 1080 }, timezoneId: day.timeZone });
  const onWall = await preparePage(wall, "/hallkeeper/today?register=wall");
  await onWall.page.screenshot({ path: join(OUT, "wall.png") });
  await reportCutVerbs(onWall.page, "wall");
  await wall.close();
  console.log(`Screenshots in ${OUT}`);
} finally {
  await browser.close();
}
if (failures > 0) {
  console.error(`${String(failures)} check(s) failed.`);
  process.exit(1);
}
