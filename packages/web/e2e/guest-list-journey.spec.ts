import { createServer, type Socket as NetSocket } from "node:net";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { CANONICAL_ASSETS } from "@omnitwin/types";
import { planLabel } from "../src/lib/guest-list/paper.js";
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
/** What a browser leaves a page on a 1366 x 768, a 1536 x 864 and a 1920 x 1080 laptop screen, its own bars taken off. */
const LAPTOP_WINDOWS = [
  { width: 1366, height: 641 },
  { width: 1536, height: 704 },
  { width: 1920, height: 953 },
] as const;
/** One turn of the wheel, in pixels, and the pause before the next: time for the page to finish scrolling. */
const WHEEL_TURN = 600;
const WHEEL_PAUSE_MS = 300;
const WHEEL_TURNS_MAX = 60;

// 180 names, one of them the canary: no request may ever carry it. One is as long as a name may be, 80
// characters of long words: at a place card's first size it takes five lines and runs into the card's margin.
const LONG_NAME = "Dame Wilhelmina Christabel Constance Featherstonehaugh Cholmondeley Marjoribanks";
const FIRST = ["Ailsa", "Brodie", "Catriona", "Duncan", "Eilidh", "Fergus", "Gregor", "Hamish", "Isla", "Jamie",
  "Kirsty", "Lachlan", "Morag", "Niall", "Orla", "Peigi", "Ruaridh", "Seonaid", "Tormod", "Una"];
const LAST = ["Anderson", "Baird", "Campbell", "Docherty", "Ewing", "Fraser", "Gillies", "Henderson", "Irvine", "Jardine",
  "Kerr", "Lennox", "MacLeod", "Nicol", "Ogilvie", "Paterson", "Quinn", "Robertson", "Sinclair", "Thomson",
  "Urquhart", "Wallace", "Young", "Allan", "Buchanan", "Cameron", "Dewar", "Erskine", "Forbes", "Graham"];
const OTHERS = Array.from({ length: GUESTS - 2 }, (_, at) =>
  `${FIRST[at % FIRST.length] ?? ""} ${LAST[Math.floor(at / 6) % LAST.length] ?? ""}`);
const NAMES = [...OTHERS.slice(0, 45), LONG_NAME, ...OTHERS.slice(45, 89), CANARY, ...OTHERS.slice(89)];
const PASTED = NAMES.join("\n");

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

interface Socket {
  readonly url: string;
  readonly framesSent: string[];
}

interface Traffic {
  readonly requests: Sent[];
  /** Every WebSocket any page opened: requests never include them, and routes do not see them. */
  readonly sockets: Socket[];
}

/**
 * Records every request and every WebSocket the browser opens, from before
 * the first navigation and across reloads; answers the plan read and refuses
 * any other request bound off the app.
 */
async function keepToTheDevice(context: BrowserContext, app: string): Promise<Traffic> {
  const traffic: Traffic = { requests: [], sockets: [] };
  context.on("request", (request) => {
    traffic.requests.push({ method: request.method(), url: request.url(), body: request.postData() ?? "", headers: JSON.stringify(request.headers()) });
  });
  const watchSockets = (page: Page): void => {
    page.on("websocket", (socket) => {
      const opened: Socket = { url: socket.url(), framesSent: [] };
      traffic.sockets.push(opened);
      socket.on("framesent", (frame) => { opened.framesSent.push(frame.payload.toString()); });
    });
  };
  context.pages().forEach(watchSockets);
  context.on("page", watchSockets);
  await context.route((url) => url.origin !== app, async (route) => {
    const request = route.request();
    if (request.method() === "GET" && new URL(request.url()).pathname === PLAN_READ) {
      await route.fulfill({ json: { data: PLAN } });
      return;
    }
    await route.abort();
  });
  return traffic;
}

/** Each request bound off the app's own origin, as "METHOD /path?query": the query is compared too, so the one allowed read cannot carry anything on its end. */
function awayFromTheApp(sent: readonly Sent[], app: string): string[] {
  return sent
    .filter((request) => /^https?:/u.test(request.url) && new URL(request.url).origin !== app)
    .map((request) => `${request.method} ${new URL(request.url).pathname}${new URL(request.url).search}`);
}

/**
 * Each WebSocket opened anywhere but the app's own dev server (its hot-reload
 * socket), matched by exact origin: the app's scheme as ws or wss, its host and port.
 */
function socketsAwayFromTheApp(traffic: Traffic, app: string): string[] {
  const own = app.replace(/^http/u, "ws");
  return traffic.sockets.map((socket) => socket.url).filter((url) => new URL(url).origin !== own);
}

/** Every socket address, or frame sent on a socket, that carries the canary. */
function canaryOnSockets(traffic: Traffic): string[] {
  return traffic.sockets.flatMap((socket) => [socket.url, ...socket.framesSent]).filter((text) => text.includes(CANARY));
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

/** The names a printed sheet lacks, each compared with every space taken out, as a long name wraps. */
function missingFrom(paper: Printed, names: readonly string[]): string[] {
  const text = squashed(paper.pages.map((sheet) => sheet.text).join(""));
  return names.filter((name) => !text.includes(squashed(name)));
}

/** With print media at A4: how many `entry` boxes there are, the running footer's height, and which entries (by number) overlap it. */
async function overTheFooter(page: Page, entry: string): Promise<{ readonly entries: number; readonly footerHeight: number; readonly over: readonly number[] }> {
  return page.evaluate((selector) => {
    const footer = document.querySelector(".gp-running")?.getBoundingClientRect();
    const boxes = [...document.querySelectorAll(selector)].map((node) => node.getBoundingClientRect());
    const over = footer === undefined ? [] : boxes.flatMap((box, at) =>
      box.bottom > footer.top + 0.5 && box.top < footer.bottom - 0.5 && box.right > footer.left + 0.5 && box.left < footer.right - 0.5 ? [at + 1] : []);
    return { entries: boxes.length, footerHeight: footer?.height ?? 0, over };
  }, entry);
}

/**
 * With print media at A4: the place cards, by number, whose name's box does not lie inside the card less its
 * padding (the margin the card keeps clear of its cut marks).
 * The card less its padding is the stricter box, and the right one: a name in the padding already crowds the cut.
 */
async function namesOffTheirCards(page: Page): Promise<{ readonly cards: number; readonly off: readonly number[] }> {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll(".gp-card")];
    const off = cards.flatMap((card, at) => {
      const name = card.querySelector(".gp-card__name")?.getBoundingClientRect();
      const box = card.getBoundingClientRect();
      const inset = getComputedStyle(card);
      const inside = name !== undefined
        && name.top >= box.top + Number.parseFloat(inset.paddingTop) - 0.5
        && name.bottom <= box.bottom - Number.parseFloat(inset.paddingBottom) + 0.5
        && name.left >= box.left + Number.parseFloat(inset.paddingLeft) - 0.5
        && name.right <= box.right - Number.parseFloat(inset.paddingRight) + 0.5;
      return inside ? [] : [at + 1];
    });
    return { cards: cards.length, off };
  });
}

// ---------------------------------------------------------------------------
// The list at a laptop's window, by the wheel
// ---------------------------------------------------------------------------

/** True when the element lies whole inside the window and, in the ledger, inside what the ledger shows. */
async function shownWhole(element: Locator): Promise<boolean> {
  return element.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const ledger = node.closest(".gl-ledger")?.getBoundingClientRect();
    const top = Math.max(0, ledger?.top ?? 0);
    const bottom = Math.min(document.documentElement.clientHeight, ledger?.bottom ?? Number.POSITIVE_INFINITY);
    return box.height > 0 && box.top >= top - 0.5 && box.bottom <= bottom + 0.5;
  });
}

/** True when the page ends where the desk does (with the page's own margin), so the wheel finds no blank beyond it. */
async function pageEndsWithTheDesk(page: Page): Promise<boolean> {
  return page.getByTestId("guest-list-desk").evaluate((desk) => {
    const sheetPage = desk.closest("[data-testid='guest-list-page']") ?? desk;
    const margin = Number.parseFloat(getComputedStyle(sheetPage).paddingBottom);
    const end = Math.max(document.documentElement.clientHeight, desk.getBoundingClientRect().bottom + window.scrollY + margin);
    return document.documentElement.scrollHeight <= Math.ceil(end) + 1;
  });
}

/** The middle of the part of the ledger the window shows, or null when none of it shows. */
async function middleOfWhatShows(ledger: Locator): Promise<{ readonly x: number; readonly y: number } | null> {
  return ledger.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const top = Math.max(0, box.top);
    const bottom = Math.min(document.documentElement.clientHeight, box.bottom);
    return bottom - top < 4 ? null : { x: box.left + box.width / 2, y: (top + bottom) / 2 };
  });
}

/** Turns the wheel under the pointer a turn at a time until `done` holds: the turns it took, or null if it never did. */
async function wheelUntil(page: Page, deltaY: number, done: () => Promise<boolean>): Promise<number | null> {
  for (let turn = 1; turn <= WHEEL_TURNS_MAX; turn += 1) {
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(WHEEL_PAUSE_MS);
    if (await done()) return turn;
  }
  return null;
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
    const traffic = await keepToTheDevice(context, app);
    const sent = traffic.requests;
    const addresses = watchAddresses(page);

    await seatTheList(page, app);
    await printTheTablePlan(page);
    // The canary did reach the paper, so its absence from the network means something.
    await expect(page.getByTestId("guest-paper-sheet")).toContainText(CANARY);

    const hands = await handsCounted(page);
    const away = awayFromTheApp(sent, app);
    report(`journey: ${String(hands.clicks)} clicks, ${String(hands.fields)} typed field(s), ${String(hands.pastes)} paste(s), ${String(hands.prints)} print call(s); ${String(sent.length)} requests in all, off the app: ${JSON.stringify(away)}`);
    report(`journey sockets: ${JSON.stringify(traffic.sockets.map((socket) => new URL(socket.url).origin))}, off the app: ${JSON.stringify(socketsAwayFromTheApp(traffic, app))}`);
    report(`journey addresses: ${JSON.stringify(addresses.map((address) => new URL(address).pathname + new URL(address).search))}`);

    expect(hands.clicks).toBeLessThanOrEqual(10);
    expect(hands.fields).toBeLessThanOrEqual(3);
    expect(hands.pastes).toBe(1);
    expect(hands.prints).toBe(1);
    expect(sent.filter((request) => request.method !== "GET").map((request) => `${request.method} ${request.url}`)).toEqual([]);
    expect(sent.filter((request) => `${request.url}\n${request.body}\n${request.headers}`.includes(CANARY)).map((request) => request.url)).toEqual([]);
    expect((await context.cookies()).filter((cookie) => `${cookie.name}=${cookie.value}`.includes(CANARY))).toEqual([]);
    expect(away).toEqual([`GET ${PLAN_READ}`]);
    expect(socketsAwayFromTheApp(traffic, app)).toEqual([]);
    expect(canaryOnSockets(traffic)).toEqual([]);
    expect(addresses.length).toBeGreaterThan(0);
    expect(addresses.filter((address) => new URL(address).searchParams.get("kit") !== "on")).toEqual([]);
  });

  test("the list is still there after a reload", async ({ page, context, baseURL }) => {
    const app = appOrigin(baseURL);
    const traffic = await keepToTheDevice(context, app);
    await seatTheList(page, app);
    // The page keeps each change on the device a moment after it is made: reload once the seated list is kept.
    await expect.poll(() => keptOnDevice(page)).toEqual({ guests: GUESTS, seated: GUESTS });

    await page.reload();

    await expect(page.getByText(`${String(GUESTS)} of ${String(GUESTS)} guests have a seat.`, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `Guests ${String(GUESTS)}`, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `Tables ${String(TABLES)}`, exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Paste the names" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Print the table plan", exact: true })).toBeVisible();
    // Before and after the reload, no socket went anywhere but the app's own dev server, and none carried a name.
    report(`reload sockets: ${JSON.stringify(traffic.sockets.map((socket) => new URL(socket.url).origin))}`);
    expect(socketsAwayFromTheApp(traffic, app)).toEqual([]);
    expect(canaryOnSockets(traffic)).toEqual([]);
  });

  test("the socket check notices a socket that leaves the app", async ({ page, context, baseURL }) => {
    const app = appOrigin(baseURL);
    const traffic = await keepToTheDevice(context, app);
    // A real listener on this machine, on a port of its own: another origin, and nothing leaves the device. It
    // refuses the handshake; the check is about the socket being opened, not about it connecting.
    const connections = new Set<NetSocket>();
    const listener = createServer((connection) => {
      connections.add(connection);
      connection.on("close", () => { connections.delete(connection); });
      connection.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    });
    await new Promise<void>((resolve) => { listener.listen(0, "127.0.0.1", resolve); });
    try {
      const address = listener.address();
      if (address === null || typeof address === "string") throw new Error("The listener has no port.");
      const stray = `ws://127.0.0.1:${String(address.port)}/${CANARY}`;
      await page.goto(LIST_ADDRESS);
      await expect(page.getByRole("button", { name: "Paste a list", exact: true })).toBeVisible();
      await page.evaluate((url) => { void new WebSocket(url); }, stray);
      await expect.poll(() => socketsAwayFromTheApp(traffic, app)).toEqual([stray]);
      expect(canaryOnSockets(traffic)).toEqual([stray]);
    } finally {
      for (const connection of connections) connection.destroy();
      await new Promise<void>((resolve) => { listener.close(() => { resolve(); }); });
    }
  });

  test("the table plan prints readable, on whole A4 pages, with its version on every page", async ({ page, context, baseURL }) => {
    const app = appOrigin(baseURL);
    await keepToTheDevice(context, app);
    await seatTheList(page, app);
    await printTheTablePlan(page);

    await page.setViewportSize(A4_AT_96_DPI);
    await page.emulateMedia({ media: "print" });
    expect(await unreadableOnPaper(page, SHEET, "table plan on paper")).toEqual([]);
    // One name is as long as a name may be, and the list is still 180.
    expect(Array.from(LONG_NAME).length).toBe(80);
    expect(NAMES.length).toBe(GUESTS);
    // No name's line lies under the version footer.
    const footer = await overTheFooter(page, ".gp-az__entry");
    expect([footer.entries, footer.over]).toEqual([GUESTS, []]);
    expect(footer.footerHeight).toBeGreaterThan(0);

    const plan = await printed(page);
    reportPaper("table plan", plan);
    expect(plan.line).toMatch(VERSION_LINE);
    expect(plan.pages.length).toBeGreaterThanOrEqual(2);
    // Whole A4 pages, as the sheet asks: 595 by 842 points.
    expect(plan.pages.map((sheet) => [Math.round(sheet.widthPt), Math.round(sheet.heightPt)])).toEqual(plan.pages.map(() => [595, 842]));
    // The reader reads a known line on a known page: the sheet's title heads the first page only.
    expect(timesOnEachPage(plan.pages, "Table plan")).toEqual(firstPageOnly(plan));
    expect(pagesWithoutTheLine(plan), pageEnds(plan)).toEqual([]);
    // Every guest is printed, as the plan files them.
    expect(missingFrom(plan, NAMES.map((name) => planLabel(name, "last-word")))).toEqual([]);
  });

  test("guests by table and covers carry their version on every printed page, and place cards on none", async ({ page, context, baseURL }) => {
    const app = appOrigin(baseURL);
    await keepToTheDevice(context, app);
    await seatTheList(page, app);
    await printTheTablePlan(page);
    // The width a printed page lays out at; each sheet is also measured with print media emulated, then the
    // emulation is dropped (media: null): page.pdf() prints with screen styles while screen is emulated.
    await page.setViewportSize(A4_AT_96_DPI);

    await openSheet(page, "Guests by table", "by-table");
    const byTable = await printed(page);
    reportPaper("guests by table", byTable);
    expect(byTable.line).toMatch(VERSION_LINE);
    expect(byTable.pages.length).toBeGreaterThanOrEqual(2);
    expect(timesOnEachPage(byTable.pages, "Guests by table")).toEqual(firstPageOnly(byTable));
    expect(pagesWithoutTheLine(byTable), pageEnds(byTable)).toEqual([]);
    expect(missingFrom(byTable, NAMES)).toEqual([]);
    await page.emulateMedia({ media: "print" });
    const byTableFooter = await overTheFooter(page, ".gp-table__seats li");
    expect([byTableFooter.entries, byTableFooter.over]).toEqual([GUESTS, []]);
    expect(byTableFooter.footerHeight).toBeGreaterThan(0);
    await page.emulateMedia({ media: null });

    await openSheet(page, "Covers for the caterer", "covers");
    const covers = await printed(page);
    reportPaper("covers", covers);
    expect(covers.line).toMatch(VERSION_LINE);
    expect(covers.pages.length).toBeGreaterThanOrEqual(1);
    expect(pagesWithoutTheLine(covers), pageEnds(covers)).toEqual([]);
    await page.emulateMedia({ media: "print" });
    const coversFooter = await overTheFooter(page, ".gp-covers__line");
    expect([coversFooter.entries, coversFooter.over]).toEqual([TABLES, []]);
    expect(coversFooter.footerHeight).toBeGreaterThan(0);
    await page.emulateMedia({ media: null });

    await openSheet(page, "Place cards", "place-cards");
    const cards = await printed(page);
    reportPaper("place cards", cards);
    expect(cards.line).toMatch(VERSION_LINE);
    // Ten cards a page, and every page read: each carries its cards' tables.
    expect(cards.pages.length).toBe(Math.ceil(GUESTS / CARDS_A_PAGE));
    expect(cards.pages.filter((sheet) => !/table/iu.test(sheet.text)).length).toBe(0);
    expect(timesOnEachPage(cards.pages, cards.line)).toEqual(cards.pages.map(() => 0));
    expect(timesOnEachPage(cards.pages, "Version")).toEqual(cards.pages.map(() => 0));
    expect(missingFrom(cards, NAMES)).toEqual([]);
    // Every name lies inside its card, clear of the cut: the longest is set smaller (paper.ts, cardNameStep).
    await page.emulateMedia({ media: "print" });
    await page.evaluate(async () => { await document.fonts.ready; });
    expect(await namesOffTheirCards(page)).toEqual({ cards: GUESTS, off: [] });
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

  test("the wheel takes the list to its last guest and back to the title, at three laptop windows", async ({ page, context, baseURL }) => {
    test.setTimeout(300_000);
    const app = appOrigin(baseURL);
    await keepToTheDevice(context, app);
    await seatTheList(page, app);
    await expect.poll(() => keptOnDevice(page)).toEqual({ guests: GUESTS, seated: GUESTS });

    const found: {
      readonly window: string;
      readonly titleOnOpening: boolean;
      readonly pageEndsWithTheDesk: boolean;
      readonly lastGuestByWheel: boolean;
      readonly titleByWheel: boolean;
    }[] = [];
    for (const size of LAPTOP_WINDOWS) {
      const at = `${String(size.width)} x ${String(size.height)}`;
      await page.setViewportSize(size);
      await page.reload();
      await page.getByRole("button", { name: `Guests ${String(GUESTS)}`, exact: true }).click();
      const ledger = page.getByRole("region", { name: "Guests and tables" });
      const rows = ledger.locator(".gl-guest");
      await expect(rows).toHaveCount(GUESTS);
      const title = page.getByRole("heading", { level: 1, name: "Guest list" });
      // As on opening: the page and the list at their tops (choosing the view may have moved the focus, and the page with it).
      await page.evaluate(() => { window.scrollTo(0, 0); });
      await ledger.evaluate((node) => { node.scrollTop = 0; });
      const titleOnOpening = await shownWhole(title);
      const endsWithTheDesk = await pageEndsWithTheDesk(page);

      // The pointer rests on what shows of the list; from here on only the wheel moves anything.
      const pointer = await middleOfWhatShows(ledger);
      if (pointer === null) {
        report(`${at}: none of the list shows on opening`);
        found.push({ window: at, titleOnOpening, pageEndsWithTheDesk: endsWithTheDesk, lastGuestByWheel: false, titleByWheel: false });
        continue;
      }
      await page.mouse.move(pointer.x, pointer.y);
      const down = await wheelUntil(page, WHEEL_TURN, () => shownWhole(rows.last()));
      const up = await wheelUntil(page, -WHEEL_TURN, () => shownWhole(title));
      report(`${at}: pointer at ${String(Math.round(pointer.x))},${String(Math.round(pointer.y))}; last guest whole after ${String(down ?? "no")} turn(s) down, title whole after ${String(up ?? "no")} turn(s) up; page ends with the desk: ${String(endsWithTheDesk)}`);
      found.push({ window: at, titleOnOpening, pageEndsWithTheDesk: endsWithTheDesk, lastGuestByWheel: down !== null, titleByWheel: up !== null });
    }

    expect(found).toEqual(LAPTOP_WINDOWS.map((size) => ({
      window: `${String(size.width)} x ${String(size.height)}`,
      titleOnOpening: true,
      pageEndsWithTheDesk: true,
      lastGuestByWheel: true,
      titleByWheel: true,
    })));
  });
});
