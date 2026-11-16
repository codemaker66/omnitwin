import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { CANONICAL_ASSETS } from "@omnitwin/types";
import { readPdfPages, squashed, timesOnEachPage, type PdfPage } from "./support/pdf-text.js";
import { unreadableOnPaper } from "./support/readability.js";

// ---------------------------------------------------------------------------
// E2E: the planner's kit, counted (stage 1a, Task 12).
//
// A planner opens a plan's guest list, pastes 180 names, takes the room's 18
// tables, seats everyone and prints the table plan. Blake's done-when test: at
// most 10 clicks and 3 typed fields, and nothing leaves the browser but the
// one read of the plan. The list survives a reload. On paper the table plan,
// guests by table and covers carry their version on every printed page and
// place cards on none, read from Chromium's own PDF, page by page. The API is
// intercepted before transport: the plan read is answered, anything else that
// would leave the app's own origin is refused and still counted.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    /** Set by this spec's init script: the planner's hands, counted in the page. */
    __guestListJourney?: { clicks: number; fields: number; pastes: number; prints: number };
  }
}

const PLAN_ID = "30000000-0000-4000-8000-000000000012";
const PLAN_READ = `/public/configurations/${PLAN_ID}`;
const LIST_ADDRESS = `/plan/${PLAN_ID}/guests?kit=on`;
const PAPER_PATH = `/plan/${PLAN_ID}/guests/paper`;
const CANARY = "CANARY-Q7";
const GUESTS = 180;
const TABLES = 18;
const SEATS = 10;
const CARDS_A_PAGE = 10;
/** A4 at 96 dpi, the width a printed page lays out at. */
const A4_AT_96_DPI = { width: 794, height: 1123 };
const SHEET = "[data-testid='guest-paper-sheet']";
const VERSION_LINE = /^Version \d+ · printed \d{1,2} [A-Z][a-z]+ \d{4}$/u;

// 180 names, one of them the canary: no request may ever carry it.
const FIRST = ["Ailsa", "Brodie", "Catriona", "Duncan", "Eilidh", "Fergus", "Gregor", "Hamish", "Isla", "Jamie",
  "Kirsty", "Lachlan", "Morag", "Niall", "Orla", "Peigi", "Ruaridh", "Seonaid", "Tormod", "Una"];
const LAST = ["Anderson", "Baird", "Campbell", "Docherty", "Ewing", "Fraser", "Gillies", "Henderson", "Irvine", "Jardine",
  "Kerr", "Lennox", "MacLeod", "Nicol", "Ogilvie", "Paterson", "Quinn", "Robertson", "Sinclair", "Thomson",
  "Urquhart", "Wallace", "Young", "Allan", "Buchanan", "Cameron", "Dewar", "Erskine", "Forbes", "Graham"];
const OTHERS = Array.from({ length: GUESTS - 1 }, (_, at) =>
  `${FIRST[at % FIRST.length] ?? ""} ${LAST[Math.floor(at / 6) % LAST.length] ?? ""}`);
const PASTED = [...OTHERS.slice(0, 90), CANARY, ...OTHERS.slice(90)].join("\n");

// The plan in the room: a Grand Hall dinner of 18 six-foot rounds, ten chairs each, from the real catalogue.
function assetId(slug: string): string {
  const asset = CANONICAL_ASSETS.find((candidate) => candidate.slug === slug);
  if (asset === undefined) throw new Error("A fixture slug is missing from the catalogue.");
  return asset.id;
}

const ROUND_TABLE = assetId("round-table-6ft");
const CHAIR = assetId("banquet-chair");

function placed(serial: number, assetDefinitionId: string, groupId: string, x: number, z: number): Record<string, unknown> {
  return {
    id: `30000000-0000-4000-8000-${String(1000 + serial).padStart(12, "0")}`,
    configurationId: PLAN_ID,
    assetDefinitionId,
    positionX: x.toFixed(3),
    positionY: "0",
    positionZ: z.toFixed(3),
    rotationX: "0",
    rotationY: "0",
    rotationZ: "0",
    scale: "1",
    sortOrder: serial,
    metadata: { groupId },
  };
}

const PLAN = {
  id: PLAN_ID,
  venueId: "30000000-0000-4000-8000-000000000001",
  spaceId: "30000000-0000-4000-8000-000000000002",
  userId: null,
  name: "Grand Hall dinner",
  isPublicPreview: true,
  revision: 1,
  objects: Array.from({ length: TABLES }, (_, table) => {
    const [x, z] = [(table % 6) * 3.4, Math.floor(table / 6) * 3.4];
    const group = `dinner-table-${String(table + 1)}`;
    const first = table * (SEATS + 1);
    return [
      placed(first, ROUND_TABLE, group, x, z),
      ...Array.from({ length: SEATS }, (_, seat) => {
        const angle = (2 * Math.PI * seat) / SEATS;
        return placed(first + seat + 1, CHAIR, group, x + 1.3 * Math.cos(angle), z + 1.3 * Math.sin(angle));
      }),
    ];
  }).flat(),
};

// ---------------------------------------------------------------------------
// The network, the hands and the device
// ---------------------------------------------------------------------------

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly body: string;
  readonly headers: string;
}

function appOrigin(baseURL: string | undefined): string {
  if (baseURL === undefined) throw new Error("This spec needs the configured baseURL.");
  return new URL(baseURL).origin;
}

/** Records every request the browser makes; answers the plan read and refuses anything else bound off the app. */
async function keepToTheDevice(context: BrowserContext, app: string): Promise<Sent[]> {
  const sent: Sent[] = [];
  context.on("request", (request) => {
    sent.push({ method: request.method(), url: request.url(), body: request.postData() ?? "", headers: JSON.stringify(request.headers()) });
  });
  await context.route((url) => url.origin !== app, async (route) => {
    const request = route.request();
    if (request.method() === "GET" && new URL(request.url()).pathname === PLAN_READ) {
      await route.fulfill({ json: { data: PLAN } });
      return;
    }
    await route.abort();
  });
  return sent;
}

/** Each request bound off the app's own origin, as "METHOD /path". */
function awayFromTheApp(sent: readonly Sent[], app: string): string[] {
  return sent
    .filter((request) => /^(?:https?|wss?):/u.test(request.url) && new URL(request.url).origin !== app)
    .map((request) => `${request.method} ${new URL(request.url).pathname}`);
}

function watchAddresses(page: Page): string[] {
  const addresses: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame() && /^https?:/u.test(frame.url())) addresses.push(frame.url());
  });
  return addresses;
}

async function handsCounted(page: Page): Promise<{ clicks: number; fields: number; pastes: number; prints: number }> {
  const counted = await page.evaluate(() => window.__guestListJourney ?? null);
  if (counted === null) throw new Error("The page was not counted.");
  return counted;
}

/** What this device keeps for the plan, read from IndexedDB: its guests, and those with a seat. */
async function keptOnDevice(page: Page): Promise<{ readonly guests: number; readonly seated: number } | null> {
  return page.evaluate(async ({ database, store, key }) => {
    if (!(await indexedDB.databases()).some((known) => known.name === database)) return null;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(database);
      opening.onsuccess = () => { resolve(opening.result); };
      opening.onerror = () => { reject(new Error("The guest list database did not open.")); };
    });
    try {
      if (!db.objectStoreNames.contains(store)) return null;
      const row = await new Promise<unknown>((resolve, reject) => {
        const reading = db.transaction(store, "readonly").objectStore(store).get(key);
        reading.onsuccess = () => { resolve(reading.result); };
        reading.onerror = () => { reject(new Error("The guest list could not be read.")); };
      });
      if (typeof row !== "object" || row === null || !("value" in row)) return null;
      const list = row.value;
      if (typeof list !== "object" || list === null || !("guests" in list) || !Array.isArray(list.guests)) return null;
      const guests: unknown[] = list.guests;
      const seated = guests.filter((guest) => typeof guest === "object" && guest !== null && "seat" in guest && guest.seat !== null);
      return { guests: guests.length, seated: seated.length };
    } finally {
      db.close();
    }
  }, { database: "venviewer-guest-lists", store: "lists", key: PLAN_ID });
}

function report(line: string): void {
  process.stdout.write(`[guest list] ${line}\n`);
}

// ---------------------------------------------------------------------------
// The planner's steps
// ---------------------------------------------------------------------------

/** Opens the plan's empty list, pastes the names, takes the room's tables and seats everyone: four clicks, one paste. */
async function seatTheList(page: Page, app: string): Promise<void> {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: app });
  await page.goto(LIST_ADDRESS);
  await page.getByRole("button", { name: "Paste a list", exact: true }).click();
  const box = page.getByRole("textbox", { name: "Paste the names" });
  await expect(box).toBeFocused();
  await page.evaluate(async (text) => { await navigator.clipboard.writeText(text); }, PASTED);
  await page.keyboard.press("ControlOrMeta+V");
  await expect(box).toHaveValue(PASTED);
  await page.getByRole("button", { name: `Add ${String(GUESTS)} guests`, exact: true }).click();
  await page.getByRole("button", { name: `Use the room's ${String(TABLES)} tables`, exact: true }).click();
  await page.getByRole("button", { name: "Seat everyone", exact: true }).click();
  await expect(page.getByText(`${String(GUESTS)} of ${String(GUESTS)} guests have a seat.`, { exact: true })).toBeVisible();
}

/** From the list to the paper, then Print: two clicks. The browser's print is stubbed; the version is recorded. */
async function printTheTablePlan(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Print the table plan", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === PAPER_PATH && url.searchParams.get("kit") === "on");
  await page.getByRole("button", { name: "Print", exact: true }).click();
  await expect(page.getByTestId("guest-paper-tools").getByText(/^Version 1 · printed /u)).toBeVisible();
  await expect.poll(async () => (await handsCounted(page)).prints).toBe(1);
}

async function openSheet(page: Page, label: string, sheet: string): Promise<void> {
  await page.getByRole("navigation", { name: "Sheets" }).getByRole("link", { name: label, exact: true }).click();
  await expect(page.getByTestId("guest-paper-sheet")).toHaveAttribute("data-sheet", sheet);
  await expect(page).toHaveURL((url) => url.searchParams.get("kit") === "on" && url.searchParams.get("sheet") === sheet);
}

// ---------------------------------------------------------------------------
// The paper, read from Chromium's own print
// ---------------------------------------------------------------------------

interface Printed {
  readonly pages: readonly PdfPage[];
  /** The version line as the page tells it after the print. */
  readonly line: string;
}

/** Chromium's PDF of the sheet on screen, page by page, at the sheet's own A4 page size. */
async function printed(page: Page): Promise<Printed> {
  const pdf = await page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: false });
  // Read after printing: the page records a new version as a print begins.
  const line = await page.getByTestId("guest-paper-tools").getByText(VERSION_LINE).textContent();
  return { pages: readPdfPages(pdf), line: line ?? "" };
}

/** The printed pages, by number, that do not carry the version line exactly once. */
function pagesWithoutTheLine(paper: Printed): number[] {
  return timesOnEachPage(paper.pages, paper.line).flatMap((times, at) => (times === 1 ? [] : [at + 1]));
}

/** How each page ends (the running footer is painted last), for a failure's message. */
function pageEnds(paper: Printed): string {
  return paper.pages.map((sheet, at) => `page ${String(at + 1)}: ...${squashed(sheet.text).slice(-100)}`).join("\n");
}

function reportPaper(sheet: string, paper: Printed): void {
  const times = timesOnEachPage(paper.pages, paper.line);
  const on = times.flatMap((count, at) => (count > 0 ? [at + 1] : []));
  report(`${sheet}: ${String(paper.pages.length)} page(s); "${paper.line}" painted per page ${JSON.stringify(times)}, on page(s) [${on.join(", ")}]`);
}

function firstPageOnly(paper: Printed): number[] {
  return paper.pages.map((_, at) => (at === 0 ? 1 : 0));
}

test.describe("the guest list journey", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    // Counts trusted clicks, the fields typed or pasted into and the pastes, and stands in for the print dialog.
    await page.addInitScript(() => {
      const fields = new Set<EventTarget>();
      const hands = { clicks: 0, fields: 0, pastes: 0, prints: 0 };
      window.__guestListJourney = hands;
      window.addEventListener("click", (event) => { if (event.isTrusted) hands.clicks += 1; }, true);
      window.addEventListener("paste", (event) => { if (event.isTrusted) hands.pastes += 1; }, true);
      window.addEventListener("input", (event) => {
        if (!event.isTrusted || event.target === null) return;
        fields.add(event.target);
        hands.fields = fields.size;
      }, true);
      window.print = () => { hands.prints += 1; };
    });
  });

  test("from opening the page to the print dialog in the step budget, and nothing is sent", async ({ page, context, baseURL }) => {
    const app = appOrigin(baseURL);
    const sent = await keepToTheDevice(context, app);
    const addresses = watchAddresses(page);

    await seatTheList(page, app);
    await printTheTablePlan(page);
    // The canary did reach the paper, so its absence from the network means something.
    await expect(page.getByTestId("guest-paper-sheet")).toContainText(CANARY);

    const hands = await handsCounted(page);
    const away = awayFromTheApp(sent, app);
    report(`journey: ${String(hands.clicks)} clicks, ${String(hands.fields)} typed field(s), ${String(hands.pastes)} paste(s), ${String(hands.prints)} print call(s); ${String(sent.length)} requests in all, off the app: ${JSON.stringify(away)}`);
    report(`journey addresses: ${JSON.stringify(addresses.map((address) => new URL(address).pathname + new URL(address).search))}`);

    expect(hands.clicks).toBeLessThanOrEqual(10);
    expect(hands.fields).toBeLessThanOrEqual(3);
    expect(hands.pastes).toBe(1);
    expect(hands.prints).toBe(1);
    expect(sent.filter((request) => request.method !== "GET").map((request) => `${request.method} ${request.url}`)).toEqual([]);
    expect(sent.filter((request) => `${request.url}\n${request.body}\n${request.headers}`.includes(CANARY)).map((request) => request.url)).toEqual([]);
    expect((await context.cookies()).filter((cookie) => `${cookie.name}=${cookie.value}`.includes(CANARY))).toEqual([]);
    expect(away).toEqual([`GET ${PLAN_READ}`]);
    expect(addresses.length).toBeGreaterThan(0);
    expect(addresses.filter((address) => new URL(address).searchParams.get("kit") !== "on")).toEqual([]);
  });

  test("the list is still there after a reload", async ({ page, context, baseURL }) => {
    const app = appOrigin(baseURL);
    await keepToTheDevice(context, app);
    await seatTheList(page, app);
    // The page keeps each change on the device a moment after it is made: reload once the seated list is kept.
    await expect.poll(() => keptOnDevice(page)).toEqual({ guests: GUESTS, seated: GUESTS });

    await page.reload();

    await expect(page.getByText(`${String(GUESTS)} of ${String(GUESTS)} guests have a seat.`, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `Guests ${String(GUESTS)}`, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `Tables ${String(TABLES)}`, exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Paste the names" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Print the table plan", exact: true })).toBeVisible();
  });

  test("the table plan prints readable, on whole A4 pages, with its version on every page", async ({ page, context, baseURL }) => {
    const app = appOrigin(baseURL);
    await keepToTheDevice(context, app);
    await seatTheList(page, app);
    await printTheTablePlan(page);

    await page.setViewportSize(A4_AT_96_DPI);
    await page.emulateMedia({ media: "print" });
    expect(await unreadableOnPaper(page, SHEET, "table plan on paper")).toEqual([]);

    const plan = await printed(page);
    reportPaper("table plan", plan);
    expect(plan.line).toMatch(VERSION_LINE);
    expect(plan.pages.length).toBeGreaterThanOrEqual(2);
    // Whole A4 pages, as the sheet asks: 595 by 842 points.
    expect(plan.pages.map((sheet) => [Math.round(sheet.widthPt), Math.round(sheet.heightPt)])).toEqual(plan.pages.map(() => [595, 842]));
    // The reader reads a known line on a known page: the sheet's title heads the first page only.
    expect(timesOnEachPage(plan.pages, "Table plan")).toEqual(firstPageOnly(plan));
    expect(pagesWithoutTheLine(plan), pageEnds(plan)).toEqual([]);
  });

  test("guests by table and covers carry their version on every printed page, and place cards on none", async ({ page, context, baseURL }) => {
    const app = appOrigin(baseURL);
    await keepToTheDevice(context, app);
    await seatTheList(page, app);
    await printTheTablePlan(page);

    await openSheet(page, "Guests by table", "by-table");
    const byTable = await printed(page);
    reportPaper("guests by table", byTable);
    expect(byTable.line).toMatch(VERSION_LINE);
    expect(byTable.pages.length).toBeGreaterThanOrEqual(2);
    expect(timesOnEachPage(byTable.pages, "Guests by table")).toEqual(firstPageOnly(byTable));
    expect(pagesWithoutTheLine(byTable), pageEnds(byTable)).toEqual([]);

    await openSheet(page, "Covers for the caterer", "covers");
    const covers = await printed(page);
    reportPaper("covers", covers);
    expect(covers.line).toMatch(VERSION_LINE);
    expect(covers.pages.length).toBeGreaterThanOrEqual(1);
    expect(pagesWithoutTheLine(covers), pageEnds(covers)).toEqual([]);

    await openSheet(page, "Place cards", "place-cards");
    const cards = await printed(page);
    reportPaper("place cards", cards);
    expect(cards.line).toMatch(VERSION_LINE);
    // Ten cards a page, and every page read: each carries its cards' tables.
    expect(cards.pages.length).toBe(Math.ceil(GUESTS / CARDS_A_PAGE));
    expect(cards.pages.filter((sheet) => !/table/iu.test(sheet.text)).length).toBe(0);
    expect(timesOnEachPage(cards.pages, cards.line)).toEqual(cards.pages.map(() => 0));
    expect(timesOnEachPage(cards.pages, "Version")).toEqual(cards.pages.map(() => 0));
  });

  test("the check notices a footer that does not repeat", async ({ page, context, baseURL }) => {
    const app = appOrigin(baseURL);
    await keepToTheDevice(context, app);
    await seatTheList(page, app);
    await printTheTablePlan(page);

    // The frame as plain blocks, as Task 10 first built it: the line then prints once, after the last name.
    await page.addStyleTag({
      content: "@media print { .gp-frame, .gp-frame__body, .gp-frame__row, .gp-frame__cell, .gp-running { display: block !important; } }",
    });
    const once = await printed(page);
    reportPaper("table plan, footer not repeating", once);
    expect(once.pages.length).toBeGreaterThanOrEqual(2);
    const missing = pagesWithoutTheLine(once);
    expect(missing[0]).toBe(1);
    expect(missing).toEqual(once.pages.slice(0, -1).map((_, at) => at + 1));
    expect(timesOnEachPage(once.pages, once.line).at(-1)).toBe(1);
  });
});
