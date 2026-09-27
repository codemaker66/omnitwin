import { expect, test, type Page } from "@playwright/test";
import { CalendarResponseSchema, EventPhaseGraphSchema, HallkeeperSheetSummarySchema } from "@omnitwin/types";
import { unreadableText } from "./support/readability.js";

// ---------------------------------------------------------------------------
// E2E: the Day Board (/hallkeeper/today), roadmap N4.
//
// A board watched all day keeps nothing moving in the corner of the eye: no
// element runs an endless animation, even where the device allows motion.
// Its legend is worded as the slots are, every label reads at 12 px and
// 4.5:1, a finished booking keeps its words at full strength, the rooms with
// nothing on share one line, and the arrow keys step the day. The calendar
// is intercepted before transport with the clock fixed at 13:00 on the day.
// ---------------------------------------------------------------------------

const API = "http://localhost:3001";
const VENUE = "20000000-0000-4000-8000-000000000002";
const ROOMS = [
  ["30000000-0000-4000-8000-000000000001", "Grand Hall", "grand-hall"],
  ["30000000-0000-4000-8000-000000000002", "Saloon", "saloon"],
  ["30000000-0000-4000-8000-000000000003", "North Gallery", "north-gallery"],
  ["30000000-0000-4000-8000-000000000004", "South Gallery", "south-gallery"],
] as const;
/** 13:00 in Glasgow on Saturday 3 October 2026. */
const NOW = new Date("2026-10-03T12:00:00.000Z");
const at = (hhmm: string, day = "2026-10-03"): string => new Date(`${day}T${hhmm}:00.000+01:00`).toISOString();

const EVENT = "60000000-0000-4000-8000-000000000001";
const LAYOUT = "70000000-0000-4000-8000-000000000001";

function booking(id: number, room: 0 | 1 | 2 | 3, title: string, from: string, to: string, eventId: string | null = null): unknown {
  return {
    entryType: "booking", id: `50000000-0000-4000-8000-00000000000${String(id)}`, spaceId: ROOMS[room][0], kind: "ink", status: "active",
    state: "ink", title, eventType: "dinner", startsAt: at(from), endsAt: at(to), rank: null, jointFlag: false, decisionAt: null,
    ownerUserId: null, nextAction: null, nextActionDueAt: null, eventId, seriesId: null, guestCount: 120,
  };
}

/** One room finished and one starting soon, one in its booked window and one
 *  quiet, a changeover short of its rule, and the South Gallery free. */
const DAY = CalendarResponseSchema.parse({
  venueId: VENUE,
  range: { from: at("00:00"), to: at("00:00", "2026-10-04") },
  rooms: ROOMS.map(([id, name, slug], sortOrder) => ({ id, name, slug, sortOrder })),
  entries: [
    booking(1, 0, "Hammermen lunch", "09:00", "11:30"),
    booking(2, 0, "Chamber dinner", "13:05", "16:00"),
    booking(3, 1, "Drinks reception", "12:30", "14:00"),
    booking(4, 1, "Board meeting", "17:30", "19:00"),
    booking(5, 2, "Wedding ceremony", "13:25", "15:00"),
  ],
  conflicts: {
    conflicts: [{
      id: "c1", type: "insufficient_turnaround", severity: "warning", spaceId: ROOMS[1][0],
      entryIds: ["50000000-0000-4000-8000-000000000003", "50000000-0000-4000-8000-000000000004"],
      explanation: "3h 30m between bookings; the rule asks for 4 hours.",
    }],
    checks: {
      inkDoubleBook: { status: "checked" }, holdOverlap: { status: "checked" },
      turnaround: { status: "checked", uncoveredPairCount: 0, detail: "All gaps covered." },
    },
  },
});

/** The Chamber dinner linked to its event, whose one Grand Hall layout has
 *  twelve of its 43 rows checked and must be ready by 16:00. */
const LINKED_DAY = CalendarResponseSchema.parse({
  ...DAY,
  entries: [booking(2, 0, "Chamber dinner", "18:00", "23:00", EVENT)],
  conflicts: { ...DAY.conflicts, conflicts: [] },
});

async function linkTheSheet(page: Page): Promise<void> {
  await page.route(`${API}/calendar?**`, (route) => { void route.fulfill({ json: { data: LINKED_DAY } }); });
  await page.route(`${API}/venues/${VENUE}`, (route) => {
    void route.fulfill({ json: { data: {
      id: VENUE, name: "Trades Hall Glasgow", slug: "trades-hall-glasgow", address: "85 Glassford Street",
      logoUrl: null, brandColour: null, timezone: "Europe/London",
      spaces: ROOMS.map(([id, name, slug]) => ({ id, venueId: VENUE, name, slug, widthM: "20", lengthM: "10", heightM: "7", floorPlanOutline: [] })),
    } } });
  });
  await page.route(`${API}/events/${EVENT}/phase-graph?**`, (route) => {
    void route.fulfill({ json: { data: EventPhaseGraphSchema.parse({
      event: { id: EVENT, venueId: VENUE, createdBy: null, name: "Chamber dinner", eventType: "dinner", status: "ready_for_ops",
        startsAt: at("18:00"), endsAt: at("23:00"), guestCount: 120, clientName: null, notes: null, createdAt: at("09:00"), updatedAt: at("09:00") },
      phases: [], scenarios: [], layoutVariants: [], phaseLayoutSnapshots: [],
      configurationLinks: [{ id: "80000000-0000-4000-8000-000000000001", eventId: EVENT, configurationId: LAYOUT,
        layoutVariantId: null, linkType: "source_configuration", createdAt: at("09:00") }],
    }) } });
  });
  await page.route(`${API}/configurations/summaries?**`, (route) => {
    void route.fulfill({ json: { data: [{ id: LAYOUT, name: "Banquet 120", spaceId: ROOMS[0][0], venueId: VENUE }] } });
  });
  await page.route(`${API}/hallkeeper/${LAYOUT}/summary**`, (route) => {
    void route.fulfill({ json: { data: HallkeeperSheetSummarySchema.parse({
      configId: LAYOUT, readyBy: at("16:00"), eventStart: at("18:00"), total: 43, checked: 12,
    }) } });
  });
}

async function openBoard(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.clock.setFixedTime(NOW);
  await page.addInitScript((venueId) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: { id: "e2e-user-hallkeeper", email: "hallkeeper@e2e.test", role: "hallkeeper", venueId, name: "E2E Hallkeeper" },
      writable: false,
    });
  }, VENUE);
  await page.route(`${API}/calendar?**`, (route) => {
    asked.push(new URL(route.request().url()).searchParams.get("from") ?? "");
    void route.fulfill({ json: { data: DAY } });
  });
  await page.route(`${API}/venues/${VENUE}`, (route) => {
    void route.fulfill({ json: { data: {
      id: VENUE, name: "Trades Hall Glasgow", slug: "trades-hall-glasgow", address: "85 Glassford Street",
      logoUrl: null, brandColour: null, timezone: "Europe/London", spaces: [],
    } } });
  });
  await page.route(`${API}/venues/${VENUE}/requests?**`, (route) => { void route.fulfill({ json: { data: [] } }); });
  await page.route(`${API}/notifications**`, (route) => { void route.fulfill({ json: { data: [] } }); });
  await page.goto("/hallkeeper/today");
  return asked;
}

test.describe("Day Board", () => {
  test("stays still and readable all day, speaks its legend in the slots' words, and steps the day from the keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    const asked = await openBoard(page);
    await expect(page.getByText("Chamber dinner")).toBeVisible();

    // Nothing runs forever, though this device allows motion.
    const endless = await page.evaluate(() => Array.from(document.querySelectorAll(".dayboard *"))
      .flatMap((element) => [getComputedStyle(element), getComputedStyle(element, "::after"), getComputedStyle(element, "::before")])
      .filter((style) => style.animationName !== "none" && style.animationIterationCount === "infinite").length);
    expect(endless).toBe(0);

    // The legend's words are the slots' own.
    const legend = page.getByLabel("What the colours mean");
    for (const label of ["Starting soon", "In booked window", "Scheduled end passed", "Scheduled"]) {
      await expect(legend.getByText(label, { exact: true })).toBeVisible();
      await expect(page.locator(".dayboard-slot-state").getByText(label, { exact: true }).first()).toBeVisible();
    }

    // A finished booking keeps its words; a room with nothing on is one name.
    await expect(page.getByText("Hammermen lunch")).toBeVisible();
    expect(await page.locator(".dayboard-tone-faded").evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
    await expect(page.locator(".dayboard-free")).toHaveText("Also free today: South Gallery.");
    await expect(page.getByRole("region", { name: "South Gallery" })).toHaveCount(0);
    expect(await unreadableText(page, ".dayboard", "day board")).toEqual([]);

    // → reads tomorrow; t comes back to today.
    const reads = asked.length;
    await page.keyboard.press("ArrowRight");
    await expect(page.getByLabel("Day", { exact: true })).toHaveValue("2026-10-04");
    await expect.poll(() => asked.length).toBeGreaterThan(reads);
    await page.keyboard.press("t");
    await expect(page.getByLabel("Day", { exact: true })).toHaveValue("2026-10-03");
  });

  test("shows under each room's sheet when setup must be done and how far its checklist has got", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBoard(page);
    await linkTheSheet(page);
    await page.reload();

    const slot = page.getByRole("region", { name: "Grand Hall" });
    await expect(slot.getByRole("link", { name: /Open setup sheet/u })).toHaveAttribute("href", `/hallkeeper/${LAYOUT}?eventId=${EVENT}`);
    await expect(slot.getByText("Ready by 16:00 · 12 of 43 checked")).toBeVisible();
    const filled = await slot.locator(".dayboard-slot-progress-bar > span").evaluate((bar) => bar.getBoundingClientRect().width / (bar.parentElement?.getBoundingClientRect().width ?? 1));
    expect(filled).toBeCloseTo(12 / 43, 1);
    expect(await unreadableText(page, ".dayboard", "a linked sheet on a phone")).toEqual([]);
  });
});

