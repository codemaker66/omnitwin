import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { HallkeeperSheetV2Schema, type CalendarBookingEntry, type CalendarResponse } from "@omnitwin/types";
import type { Enquiry } from "../src/api/enquiries.js";
import { CLAUDE_CRAWFORD_DRAFT, CRAWFORD_FACTS } from "./support/platform-sample.js";

// ---------------------------------------------------------------------------
// Product images for venviewer.com/platform, captured from emulated API
// answers the way the end-to-end tests render the app: every image is the
// current product drawing sample data, never a mock-up. One wedding runs
// through them all (Elaine Crawford, 160 guests, the Grand Hall, Saturday
// 5 June 2027), on one day (Thursday 8 October 2026) with one coordinator
// (Catherine Tait). Her layout (support/crawford-layout.json) is the saved
// draft the planner opens and the plan on the hallkeeper's sheet; the
// /platform hero draws the same layout into a photograph of the hall.
// Skipped unless CAPTURE_PLATFORM_DIR names a folder, so no CI run takes it.
// The proposals desk images are taken beside their emulator, in
// proposals-desk.spec.ts.
//
//   $env:CAPTURE_PLATFORM_DIR="D:/captures"; $env:E2E_PORT="5197"
//   pnpm --filter @omnitwin/web exec playwright test platform-captures proposals-desk -g "platform captures"
// ---------------------------------------------------------------------------

const OUT = process.env["CAPTURE_PLATFORM_DIR"];
const API = "http://localhost:3001";

test.skip(OUT === undefined, "Set CAPTURE_PLATFORM_DIR to capture the /platform images.");
test.use({ deviceScaleFactor: 2, launchOptions: { args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] } });
test.describe.configure({ mode: "serial" });

async function capture(page: Page, name: string): Promise<void> {
  if (OUT === undefined) return;
  mkdirSync(OUT, { recursive: true });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({ path: join(OUT, `${name}.png`), animations: "disabled" });
}

const VENUE_ID = "00000000-0000-4000-8000-00000000c001";
const GRAND_HALL = "00000000-0000-4000-8000-00000000c002";
const SALOON = "00000000-0000-4000-8000-00000000c003";
const ROBERT_ADAM = "00000000-0000-4000-8000-00000000c004";
const CONFIG_ID = "10000000-0000-4000-8000-00000000c201";
/** 16:30 in Glasgow on Thursday 8 October 2026. */
const NOW = new Date("2026-10-08T15:30:00.000Z");

const COORDINATOR = {
  id: "00000000-0000-4000-8000-00000000c091",
  email: "catherine@example.com",
  role: "staff",
  platformRole: "none",
  venueId: VENUE_ID,
  name: "Catherine Tait",
} as const;

const GRAND_HALL_SPACE = {
  id: GRAND_HALL, venueId: VENUE_ID, name: "Grand Hall", slug: "grand-hall", widthM: "21", lengthM: "10.5", heightM: "7",
  floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }],
};
const SPACES = [
  GRAND_HALL_SPACE,
  { id: SALOON, venueId: VENUE_ID, name: "Saloon", slug: "saloon", widthM: "12", lengthM: "7", heightM: "5.4", floorPlanOutline: [] },
  { id: ROBERT_ADAM, venueId: VENUE_ID, name: "Robert Adam Room", slug: "robert-adam-room", widthM: "9.7", lengthM: "5.6", heightM: "2.18", floorPlanOutline: [] },
];
const VENUE = { id: VENUE_ID, name: "Trades Hall Glasgow", slug: "trades-hall-glasgow", address: "85 Glassford Street", logoUrl: null, brandColour: null };

async function seedCoordinator(page: Page): Promise<void> {
  await page.addInitScript((user) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: user, writable: false });
    window.localStorage.setItem(`venviewer:diary-welcome-seen:${user.id}`, "1");
  }, COORDINATOR);
}

// ---------------------------------------------------------------------------
// The planner: the Grand Hall laid out by the planner itself for 160 guests
// ---------------------------------------------------------------------------

interface SavedObject {
  readonly id?: string;
  readonly assetDefinitionId: string;
  readonly positionX: number;
  readonly positionY: number;
  readonly positionZ: number;
  readonly rotationX: number;
  readonly rotationY: number;
  readonly rotationZ: number;
  readonly scale: number;
  readonly sortOrder: number;
  readonly metadata?: Record<string, unknown> | null;
}

function placed(objects: readonly SavedObject[]): Record<string, unknown>[] {
  return objects.map((object, index) => ({
    id: object.id ?? `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    configurationId: CONFIG_ID,
    assetDefinitionId: object.assetDefinitionId,
    positionX: String(object.positionX), positionY: String(object.positionY), positionZ: String(object.positionZ),
    rotationX: String(object.rotationX), rotationY: String(object.rotationY), rotationZ: String(object.rotationZ),
    scale: String(object.scale), sortOrder: object.sortOrder, metadata: object.metadata ?? null,
  }));
}

interface LayoutPiece {
  readonly asset: string;
  readonly kind: "round" | "top-table" | "chair";
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
  readonly group: string;
}

/** The Crawford layout as the planner saves it: tables dressed for dinner,
 *  each table grouped with its chairs. */
const CRAWFORD_LAYOUT: readonly SavedObject[] = (JSON.parse(readFileSync(fileURLToPath(new URL("./support/crawford-layout.json", import.meta.url)), "utf8")) as { breakfast: LayoutPiece[] })
  .breakfast.map((piece, index) => ({
    assetDefinitionId: piece.asset,
    positionX: piece.x, positionY: 0, positionZ: piece.z,
    rotationX: 0, rotationY: piece.rotationY, rotationZ: 0,
    scale: 1, sortOrder: index,
    metadata: piece.kind === "chair"
      ? { groupId: `crawford-${piece.group}` }
      : { groupId: `crawford-${piece.group}`, clothed: true, clothStyle: "white", tableSetting: "dinner" },
  }));

/** The catalogue's footprints for the pieces the layout uses. */
const FOOTPRINTS: Readonly<Record<string, { name: string; category: string; widthM: number; depthM: number; collisionType: "box" | "cylinder" }>> = {
  "aec69e97-d577-5931-ba13-8258dbdd9050": { name: "Round Table (White Cloth)", category: "table", widthM: 1.83, depthM: 1.83, collisionType: "cylinder" },
  "b5ff8bd6-2cf9-574e-8102-256b7442313f": { name: "Trestle Table (White Cloth)", category: "table", widthM: 1.83, depthM: 0.76, collisionType: "box" },
  "7f1fb7a2-5210-57b1-9108-11255c059520": { name: "Burgess Turini 18/3", category: "chair", widthM: 0.42, depthM: 0.58, collisionType: "box" },
};

/** Boots /plan on the Grand Hall with the Crawford draft saved. */
async function openPlanner(page: Page): Promise<{ saved: () => SavedObject[] }> {
  let objects: SavedObject[] = [...CRAWFORD_LAYOUT];
  let revision = 1;
  const config = (): Record<string, unknown> => ({
    id: CONFIG_ID, spaceId: GRAND_HALL, venueId: VENUE_ID, userId: null, name: "Crawford wedding",
    isPublicPreview: true, revision, updatedAt: NOW.toISOString(), objects: placed(objects),
  });
  await page.clock.setFixedTime(NOW);
  await page.route(`${API}/**`, (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === "/venues") void route.fulfill({ json: { data: [VENUE] } });
    else if (url.pathname === `/venues/${VENUE_ID}`) void route.fulfill({ json: { data: { ...VENUE, spaces: SPACES } } });
    else if (url.pathname === `/venues/${VENUE_ID}/spaces`) void route.fulfill({ json: { data: SPACES } });
    else if (url.pathname === `/venues/${VENUE_ID}/spaces/${GRAND_HALL}`) void route.fulfill({ json: { data: GRAND_HALL_SPACE } });
    else if (url.pathname === "/public/configurations" && method === "POST") void route.fulfill({ status: 201, json: { data: config() } });
    else if (url.pathname === `/public/configurations/${CONFIG_ID}`) void route.fulfill({ json: { data: config() } });
    else if (url.pathname === `/public/configurations/${CONFIG_ID}/objects/batch`) {
      const body = route.request().postDataJSON() as { objects: SavedObject[] };
      objects = body.objects;
      revision += 1;
      void route.fulfill({ json: { data: { objects: placed(objects), revision } } });
    } else if (url.pathname.startsWith("/assets/runtime-packages")) void route.fulfill({ json: { data: null } });
    else if (url.pathname.startsWith("/truth-mode/summary")) {
      void route.fulfill({ json: { data: {
        targetType: "configuration", targetId: CONFIG_ID, source: "Planning context - not a measured source of record",
        confidence: "unknown", assumption: "Human review required before reliance", evidenceStatus: "not_checked",
        reviewGate: "Human review required", staleState: "unknown",
        safeWording: ["Planning evidence - human review required before operational reliance."], humanReviewRequired: true,
        counts: { evidenceItems: 0, checkResults: 0, assumptions: 0, reviewGates: 0, staleEvents: 0 },
      } } });
    } else void route.fulfill({ status: 404, json: { error: `Not emulated: ${url.pathname}` } });
  });
  await page.goto(`/plan/${CONFIG_ID}`);
  await expect(page.getByTestId("cockpit-shell")).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => document.querySelectorAll("canvas").length), { timeout: 60_000 }).toBe(1);
  return { saved: () => objects };
}

/** The Guests lens with her headcount, so the seats placed read against it. */
async function countGuests(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Guests", exact: true }).first().click();
  await page.getByRole("spinbutton", { name: "Expected guests" }).fill("160");
  await expect(page.getByTestId("guests-seat-summary")).toBeVisible();
}

// ---------------------------------------------------------------------------
// Enquiries: the Crawford enquiry open beside the desk
// ---------------------------------------------------------------------------

function enquiry(n: number, name: string, fields: Partial<Enquiry>): Enquiry {
  const email = `${name.toLowerCase().replace(/^dr /u, "").split(" ")[0] ?? "guest"}@example.com`;
  return {
    id: `00000000-0000-4000-8000-${String(900_000_000_000 + n)}`,
    venueId: VENUE_ID, spaceId: GRAND_HALL, configurationId: null, userId: null,
    name, email, guestEmail: email, guestPhone: null, guestName: null,
    eventType: "wedding", preferredDate: null, estimatedGuests: null, message: null,
    state: "submitted", source: "website", roomChosen: true,
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    ...fields,
  };
}

const CRAWFORD_ENQUIRY = enquiry(1, "Elaine Crawford", {
  source: "planner", configurationId: CONFIG_ID, eventType: "wedding",
  estimatedGuests: CRAWFORD_FACTS.guestCount, preferredDate: CRAWFORD_FACTS.eventDate,
  createdAt: "2026-10-08T13:12:00.000Z", updatedAt: "2026-10-08T13:12:00.000Z",
  message: "We'd love our wedding breakfast and the evening in the Grand Hall, for about 160. Two guests use wheelchairs and two are coeliac. Is Saturday 5 June 2027 free?",
});

const ENQUIRIES: readonly Enquiry[] = [
  CRAWFORD_ENQUIRY,
  enquiry(2, "Dr Aileen Murray", {
    eventType: "dinner", estimatedGuests: 160, preferredDate: "2027-03-12", createdAt: "2026-10-08T10:40:00.000Z", updatedAt: "2026-10-08T10:40:00.000Z",
    message: "Our society's annual dinner: black tie, four courses and a piper. We would also like the Saloon for drinks beforehand.",
  }),
  enquiry(3, "Callum Fraser", {
    source: "phone", spaceId: SALOON, eventType: "Burns supper", estimatedGuests: 60, preferredDate: "2027-01-23",
    createdAt: "2026-10-07T16:05:00.000Z", updatedAt: "2026-10-07T16:05:00.000Z",
    message: "A traditional Burns supper for the rugby club: haggis, the address, the lot.",
  }),
  enquiry(4, "Priya Raman", {
    source: "email", spaceId: ROBERT_ADAM, eventType: "conference", estimatedGuests: 40, preferredDate: "2027-03-04",
    createdAt: "2026-10-07T09:20:00.000Z", updatedAt: "2026-10-07T09:20:00.000Z",
    message: "A day conference: registration from half past eight, a projector and lectern, and lunch for everyone.",
  }),
  enquiry(5, "Tom Baird", {
    source: "walkthrough", roomChosen: false, eventType: "private", estimatedGuests: 60,
    createdAt: "2026-10-05T18:30:00.000Z", updatedAt: "2026-10-05T18:30:00.000Z",
    message: "My dad's 70th next spring, a Saturday evening ideally.",
  }),
  enquiry(6, "Ruth Brennan", {
    state: "under_review", eventType: "Exhibition", estimatedGuests: 200, preferredDate: "2027-10-02",
    createdAt: "2026-10-04T11:00:00.000Z", updatedAt: "2026-10-06T14:00:00.000Z",
    message: "A two-day exhibition of Glasgow silversmiths, with a private view on the first evening.",
  }),
  enquiry(7, "Iain Robertson", {
    state: "approved", eventType: "dinner", estimatedGuests: 90, preferredDate: "2026-11-20",
    createdAt: "2026-09-29T10:15:00.000Z", updatedAt: "2026-10-02T11:00:00.000Z",
    message: "The Merchants' dinner in November, three courses for about ninety.",
  }),
  enquiry(8, "Sophie Tait", {
    state: "approved", source: "planner", configurationId: "00000000-0000-4000-8000-00000000c108", eventType: "wedding",
    estimatedGuests: 120, preferredDate: "2027-08-21", createdAt: "2026-09-27T16:40:00.000Z", updatedAt: "2026-10-01T09:30:00.000Z",
    message: "Ceremony in the Saloon and dinner in the Grand Hall, if both are free.",
  }),
  enquiry(9, "Graham Hunter", {
    state: "rejected", eventType: "corporate", estimatedGuests: 400, preferredDate: "2027-02-11",
    createdAt: "2026-09-25T13:00:00.000Z", updatedAt: "2026-09-26T10:00:00.000Z",
    message: "A product launch for four hundred with a stage and lighting rig.",
  }),
  enquiry(10, "Anna Kowalska", {
    state: "withdrawn", spaceId: SALOON, eventType: "reception", estimatedGuests: 70, preferredDate: "2026-12-12",
    createdAt: "2026-09-24T19:20:00.000Z", updatedAt: "2026-09-30T08:45:00.000Z",
    message: "Christmas drinks for the office, around seventy.",
  }),
];

/** GET /enquiries as the route answers it: by status or states, in the order
 *  asked for, one page at a time, with the total over all pages. */
function enquiryPage(url: URL): { data: Enquiry[]; meta: { total: number; limit: number; offset: number; order: string } } {
  const status = url.searchParams.get("status");
  const states = url.searchParams.get("states")?.split(",").filter((state) => state !== "") ?? null;
  const order = url.searchParams.get("order") ?? "updated_asc";
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const rows = ENQUIRIES
    .filter((row) => (status === null || row.state === status) && (states === null || states.includes(row.state)))
    .sort((a, b) => (order === "created_desc" ? b.createdAt.localeCompare(a.createdAt) : a.updatedAt.localeCompare(b.updatedAt)));
  return { data: rows.slice(offset, offset + limit), meta: { total: rows.length, limit, offset, order } };
}

async function openEnquiries(page: Page): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await seedCoordinator(page);
  await page.route(`${API}/**`, (route) => {
    const url = new URL(route.request().url());
    const single = /^\/enquiries\/([^/]+)(\/history)?$/u.exec(url.pathname);
    if (url.pathname === "/enquiries") {
      void route.fulfill({ json: enquiryPage(url) });
    } else if (single !== null) {
      const row = ENQUIRIES.find((candidate) => candidate.id === single[1]);
      if (row === undefined) void route.fulfill({ status: 404, json: { error: "Enquiry not found", code: "NOT_FOUND" } });
      else void route.fulfill({ json: { data: single[2] === "/history" ? [] : row } });
    } else if (url.pathname === `/venues/${VENUE_ID}` || url.pathname === "/venues") {
      const venue = { ...VENUE, slug: "trades-hall", spaces: SPACES };
      void route.fulfill({ json: { data: url.pathname === "/venues" ? [venue] : venue } });
    } else if (url.pathname === "/notifications/unread-count") {
      void route.fulfill({ json: { data: { unread: 0 } } });
    } else if (url.pathname.startsWith("/notifications")) {
      void route.fulfill({ json: { data: [] } });
    } else {
      void route.fulfill({ status: 404, json: { error: `Not emulated: ${url.pathname}` } });
    }
  });
  await page.goto("/dashboard?view=enquiries");
}

// ---------------------------------------------------------------------------
// The Diary: the week of 5 June 2027, the Crawford wedding held first and a
// second couple waiting on the same date
// ---------------------------------------------------------------------------

function booking(id: string, fields: Partial<CalendarBookingEntry> & { title: string; startsAt: string; endsAt: string }): CalendarBookingEntry {
  const kind = fields.kind ?? "hold";
  return {
    entryType: "booking", id, spaceId: GRAND_HALL, kind, status: "active", state: kind, eventType: null,
    rank: kind === "hold" ? 1 : null, jointFlag: false,
    decisionAt: kind === "hold" ? "2026-10-22T11:00:00.000Z" : null,
    ownerUserId: kind === "hold" ? COORDINATOR.id : null, ownerName: kind === "hold" ? COORDINATOR.name : null,
    nextAction: null, nextActionDueAt: null, eventId: null, seriesId: null, notes: null,
    ...fields,
  };
}

const CRAWFORD_HOLD = booking("00000000-0000-4000-8000-00000000c301", {
  title: "Crawford wedding", eventType: "wedding", clientName: "Elaine Crawford", guestCount: 160,
  startsAt: "2027-06-05T11:00:00.000Z", endsAt: "2027-06-05T22:30:00.000Z",
  nextAction: "Send version 2 of the proposal.", nextActionDueAt: "2026-10-09T09:00:00.000Z",
  notes: "Wedding breakfast and evening. Two guests use wheelchairs.",
});
const HUGHES_HOLD = booking("00000000-0000-4000-8000-00000000c302", {
  title: "Hughes wedding", eventType: "wedding", clientName: "Amy and Rory Hughes", guestCount: 140, rank: 2,
  startsAt: "2027-06-05T11:00:00.000Z", endsAt: "2027-06-05T22:30:00.000Z", decisionAt: "2026-10-29T11:00:00.000Z",
});
const DIARY_WEEK: readonly CalendarBookingEntry[] = [
  CRAWFORD_HOLD,
  HUGHES_HOLD,
  booking("00000000-0000-4000-8000-00000000c303", {
    kind: "ink", title: "Merchants' House dinner", eventType: "dinner", clientName: "The Merchants House of Glasgow", guestCount: 170,
    startsAt: "2027-06-03T17:00:00.000Z", endsAt: "2027-06-03T22:30:00.000Z",
  }),
  booking("00000000-0000-4000-8000-00000000c304", {
    kind: "ink", spaceId: SALOON, title: "Philosophical Society lecture", eventType: "lecture", guestCount: 70,
    startsAt: "2027-06-02T17:30:00.000Z", endsAt: "2027-06-02T20:30:00.000Z",
  }),
  booking("00000000-0000-4000-8000-00000000c305", {
    spaceId: SALOON, title: "Lindsay drinks reception", rank: 1, eventType: "reception",
    startsAt: "2027-06-04T17:00:00.000Z", endsAt: "2027-06-04T21:00:00.000Z", decisionAt: "2026-11-05T11:00:00.000Z",
  }),
  booking("00000000-0000-4000-8000-00000000c306", {
    kind: "internal_block", spaceId: ROBERT_ADAM, title: "Floor polish",
    startsAt: "2027-05-31T07:00:00.000Z", endsAt: "2027-05-31T11:00:00.000Z",
  }),
];

function diaryCalendar(from: string, to: string): CalendarResponse {
  const start = Date.parse(from), end = Date.parse(to);
  return {
    venueId: VENUE_ID,
    range: { from: new Date(start).toISOString(), to: new Date(end).toISOString() },
    rooms: [
      { id: GRAND_HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 },
      { id: SALOON, name: "Saloon", slug: "saloon", sortOrder: 1 },
      { id: ROBERT_ADAM, name: "Robert Adam Room", slug: "robert-adam-room", sortOrder: 2 },
    ],
    entries: DIARY_WEEK.filter((row) => Date.parse(row.startsAt) < end && Date.parse(row.endsAt) > start),
    conflicts: {
      conflicts: [],
      checks: {
        inkDoubleBook: { status: "checked" },
        holdOverlap: { status: "checked" },
        turnaround: { status: "checked", uncoveredPairCount: 0, detail: "Every gap is covered by a turnaround rule." },
      },
    },
    turnaroundRules: [{ spaceId: null, eventType: null, name: "All rooms", minutes: 120, isActive: true }],
    decisionsDue: { holds: [CRAWFORD_HOLD, HUGHES_HOLD], total: 2 },
    nextActionsDue: { holds: [CRAWFORD_HOLD], total: 1 },
    contested: {
      dates: [{ spaceId: GRAND_HALL, startsAt: CRAWFORD_HOLD.startsAt, endsAt: CRAWFORD_HOLD.endsAt, bookings: [CRAWFORD_HOLD, HUGHES_HOLD] }],
      total: 1,
    },
  };
}

async function openDiaryWeek(page: Page): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await seedCoordinator(page);
  await page.route(`${API}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/calendar") {
      void route.fulfill({ json: { data: diaryCalendar(url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? "") } });
    } else if (url.pathname === "/enquiries") {
      void route.fulfill({ json: { data: [] } });
    } else if (url.pathname === `/venues/${VENUE_ID}`) {
      void route.fulfill({ json: { data: { ...VENUE, slug: "trades-hall", spaces: [] } } });
    } else if (url.pathname === `/venues/${VENUE_ID}/turnaround-rules`) {
      void route.fulfill({ json: { data: {
        rules: [{ id: "00000000-0000-4000-8000-00000000c501", venueId: VENUE_ID, spaceId: null, eventType: null, name: "All rooms",
          minutes: 120, isActive: true, confirmedAt: null, updatedByName: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
        rooms: [{ id: GRAND_HALL, name: "Grand Hall" }, { id: SALOON, name: "Saloon" }, { id: ROBERT_ADAM, name: "Robert Adam Room" }],
        eventTypes: ["wedding", "dinner"],
      } } });
    } else if (url.pathname.startsWith("/notifications")) {
      void route.fulfill({ json: { data: [] } });
    } else {
      void route.fulfill({ status: 404, json: { error: `Not emulated: ${url.pathname}` } });
    }
  });
  await page.routeWebSocket(`${API.replace(/^http/u, "ws")}/ws/diary`, (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { type: string };
      if (message.type === "auth") {
        ws.send(JSON.stringify({ type: "hello", venueId: VENUE_ID, presence: [{ userId: COORDINATOR.id, name: COORDINATOR.name, role: "staff" }] }));
      }
    });
  });
  await page.goto(`/diary?date=${CRAWFORD_FACTS.eventDate}`);
  await expect(page.getByRole("heading", { level: 1, name: "The Diary" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Crawford wedding").first()).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// The client's proposal page: version 2, its message as Claude drafted it for
// this sample, and the quote the proposals desk holds
// ---------------------------------------------------------------------------

const SHARE_CODE = "crawfd";
const CLIENT_PROPOSAL = {
  title: "Crawford wedding — Grand Hall",
  status: "sent",
  sentAt: "2026-10-08T10:00:00.000Z",
  venueName: "Trades Hall Glasgow",
  venueSlug: "trades-hall-glasgow",
  venueAddress: "85 Glassford Street, Glasgow G1 1UH",
  preparedAt: "2026-10-08T09:30:00.000Z",
  facts: { ...CRAWFORD_FACTS },
  accepted: null,
  clientMessage: CLAUDE_CRAWFORD_DRAFT,
  capacityNote: "Grand Hall: the venue's published dinner capacity is 180.",
  quote: {
    quoteId: null,
    currency: "GBP",
    lineItems: [
      { description: "Grand Hall hire", quantity: 1, unitAmountMinor: 440_000, lineTotalMinor: 440_000 },
      { description: "Dinner", quantity: 160, unitAmountMinor: 8_750, lineTotalMinor: 1_400_000 },
    ],
    subtotalMinor: 1_840_000,
    totalMinor: 1_840_000,
  },
  version: 2,
};

// ---------------------------------------------------------------------------
// The hallkeeper's sheet for the same wedding, its plan the planner's own
// ---------------------------------------------------------------------------

const SHEET = HallkeeperSheetV2Schema.parse({
  venue: { name: "Trades Hall Glasgow", address: "85 Glassford Street, Glasgow G1 1UH", logoUrl: null, timezone: "Europe/London" },
  space: { name: "Grand Hall", widthM: 21, lengthM: 10.5, heightM: 7 },
  config: { id: CONFIG_ID, name: "Crawford wedding", layoutStyle: "dinner-banquet", guestCount: 160 },
  // Guests from 13:00 (BST), the room set by 11:00.
  timing: { eventStart: "2027-06-05T12:00:00.000Z", setupBy: "2027-06-05T10:00:00.000Z", bufferMinutes: 120 },
  instructions: {
    specialInstructions: "Keep the main-door route clear: two guests use wheelchairs.",
    dayOfContact: { name: COORDINATOR.name, role: "Events team", phone: "0141 496 0123", email: "" },
    phaseDeadlines: [],
    accessNotes: "Florist and band load in at the Glassford Street door from 09:00.",
    accessibility: { hearingLoopRequired: false, hearingLoopZone: null, wheelchairSpaces: 2, stepFreeRouteRequired: true, signLanguageInterpreter: false, largePrintProgrammes: 0, notes: "" },
    dietary: { vegetarian: 6, vegan: 1, glutenFree: 2, nutFree: 0, halal: 0, kosher: 0, otherAllergies: "" },
  },
  phases: [
    { phase: "furniture", zones: [
      { zone: "West wall", rows: [
        { key: "furniture|West wall|6ft trestle, top table|0", name: "6ft trestle, top table", category: "table", qty: 3, afterDepth: 0, isAccessory: false, notes: "End to end, ten places facing the room" },
      ] },
      { zone: "Centre", rows: [
        { key: "furniture|Centre|6ft round table|0", name: "6ft round table", category: "table", qty: 15, afterDepth: 0, isAccessory: false, notes: "" },
        { key: "furniture|Centre|Banquet chair|1", name: "Banquet chair", category: "chair", qty: 160, afterDepth: 1, isAccessory: false, notes: "Ten to each table" },
      ] },
    ] },
    { phase: "dress", zones: [
      { zone: "Centre", rows: [
        { key: "dress|Centre|Ivory tablecloth|0", name: "Ivory tablecloth", category: "decor", qty: 18, afterDepth: 0, isAccessory: true, notes: "" },
        { key: "dress|Centre|Centrepiece|1", name: "Centrepiece", category: "decor", qty: 16, afterDepth: 1, isAccessory: true, notes: "" },
      ] },
    ] },
  ],
  totals: {
    entries: [
      { name: "6ft round table", category: "table", qty: 15 },
      { name: "6ft trestle, top table", category: "table", qty: 3 },
      { name: "Banquet chair", category: "chair", qty: 160 },
      { name: "Centrepiece", category: "decor", qty: 16 },
      { name: "Ivory tablecloth", category: "decor", qty: 18 },
    ],
    totalRows: 5,
    totalItems: 212,
  },
  // The layout as the API freezes it: real metres from the room's centre, each
  // piece at its catalogue footprint.
  floorPlan: {
    coordinateSpace: "real_m_v1",
    outline: [{ x: -10.5, z: -5.25 }, { x: 10.5, z: -5.25 }, { x: 10.5, z: 5.25 }, { x: -10.5, z: 5.25 }],
    objects: CRAWFORD_LAYOUT.map((object, index) => {
      const footprint = FOOTPRINTS[object.assetDefinitionId];
      if (footprint === undefined) throw new Error(`No footprint for ${object.assetDefinitionId}`);
      return {
        objectId: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`, assetDefinitionId: object.assetDefinitionId,
        ...footprint, x: object.positionX, z: object.positionZ, rotationY: object.rotationY, scale: 1,
      };
    }),
  },
  diagramUrl: null,
  webViewUrl: `http://localhost:5173/hallkeeper/${CONFIG_ID}`,
  generatedAt: "2026-10-08T10:00:00.000Z",
  approval: null,
});

async function openSheet(page: Page): Promise<void> {
  const objects = placed(CRAWFORD_LAYOUT);
  await page.addInitScript(() => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: { id: "e2e-user-planner", email: "hallkeeper@example.com", role: "planner", venueId: null, name: "Duty hallkeeper" },
      writable: false,
    });
  });
  await page.route(`${API}/hallkeeper/${CONFIG_ID}/v2`, (route) => { void route.fulfill({ json: { data: SHEET } }); });
  // The venue, which verifies the layout's room; under its database slug the
  // room's supplied architectural drawing is linked, as in production.
  await page.route(`${API}/venues/${VENUE_ID}`, (route) => {
    void route.fulfill({ json: { data: { ...VENUE, spaces: SPACES } } });
  });
  await page.route(`${API}/configurations/${CONFIG_ID}`, (route) => {
    void route.fulfill({ json: { data: {
      id: CONFIG_ID, spaceId: GRAND_HALL, venueId: VENUE_ID, userId: null, name: "Crawford wedding",
      isPublicPreview: false, revision: 3, updatedAt: "2026-10-08T10:00:00.000Z", objects,
    } } });
  });
  await page.route(`${API}/configurations/${CONFIG_ID}/review/available-transitions`, (route) => {
    void route.fulfill({ status: 404, json: { error: "No review record", code: "NOT_FOUND" } });
  });
  await page.route(`${API}/configurations/${CONFIG_ID}/snapshot/latest`, (route) => {
    void route.fulfill({ status: 404, json: { error: "No snapshot", code: "NOT_FOUND" } });
  });
  await page.route(`${API}/hallkeeper/${CONFIG_ID}/progress`, (route) => {
    // Each check mark is the moment it was made.
    void route.fulfill({ json: { data: { configId: CONFIG_ID, checked: {
      "furniture|West wall|6ft trestle, top table|0": "2027-06-05T08:20:00.000Z",
    } } } });
  });
  await page.goto(`/hallkeeper/${CONFIG_ID}`);
  await expect(page.getByRole("main", { name: "Hallkeeper sheet for Crawford wedding at Trades Hall Glasgow" })).toBeVisible({ timeout: 20_000 });
}

test.describe("/platform captures", () => {
  test("the planner with the Crawford layout", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const planner = await openPlanner(page);
    await countGuests(page);
    await expect(page.getByTestId("guests-seat-summary")).toContainText("160");
    // The captured layer is not served here, so the planner shows its model view.
    await page.getByRole("button", { name: "Model", exact: true }).click();
    await expect(page.getByText("Room capture could not load", { exact: false })).toHaveCount(0, { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    await capture(page, "planner");
    expect(planner.saved()).toHaveLength(CRAWFORD_LAYOUT.length);
  });

  test("the Enquiries desk with the Crawford enquiry open", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEnquiries(page);
    await page.getByRole("button", { name: /^Elaine Crawford,/u }).click();
    const panel = page.getByRole("region", { name: "Elaine Crawford" });
    await expect(panel.locator(".enq-facts__room")).toHaveText("Grand Hall");
    await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
    await capture(page, "enquiries");
  });

  test("the Diary week of the wedding", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDiaryWeek(page);
    await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
    await capture(page, "diary");
  });

  test("the client's proposal page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.setFixedTime(NOW);
    await page.route(`${API}/public/proposals/${SHARE_CODE}`, (route) => { void route.fulfill({ json: { data: CLIENT_PROPOSAL } }); });
    await page.goto(`/proposal/${SHARE_CODE}`);
    await expect(page.getByRole("heading", { level: 1, name: CLIENT_PROPOSAL.title })).toBeVisible();
    await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
    await capture(page, "client");
    const accept = page.getByRole("button", { name: /accept/iu }).first();
    await accept.evaluate((element) => { element.scrollIntoView({ block: "center" }); });
    await capture(page, "client-respond");
  });

  test("the hallkeeper's sheet, on a desk and on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.setFixedTime(new Date("2027-06-05T08:30:00.000Z"));
    await openSheet(page);
    await page.getByRole("button", { name: "Event layout" }).click();
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
    await capture(page, "hallkeeper");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole("main", { name: "Hallkeeper sheet for Crawford wedding at Trades Hall Glasgow" })).toBeVisible({ timeout: 20_000 });
    await capture(page, "hallkeeper-phone");
    const plan = page.getByRole("tab", { name: "Plan" }).or(page.getByRole("button", { name: "Plan", exact: true })).first();
    await plan.click();
    await page.waitForTimeout(800);
    await page.getByText(/footprints/u).first().evaluate((element) => { element.scrollIntoView({ block: "start" }); });
    await page.waitForTimeout(500);
    await capture(page, "hallkeeper-phone-plan");
  });
});
