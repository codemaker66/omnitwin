import { expect, test, type Page } from "@playwright/test";
import { CalendarResponseSchema, EventPhaseGraphSchema, HallkeeperSheetSummarySchema } from "@omnitwin/types";
import { unreadableText } from "./support/readability.js";

// ---------------------------------------------------------------------------
// E2E: the Day Board (/hallkeeper/today), goal 19 S3.
//
// The board breathes only where the attention system says (D3): a dot on a
// slab whose moment approaches, the live slab's overlay, a copper ring on a
// request nobody owns; every breath shares one epoch phase, and nothing else
// on the page moves. Its legend is worded as the slots are, every label
// reads at 12 px and 4.5:1 on both registers, a finished booking keeps its
// words at full strength, the rooms with nothing on share one line, the
// arrow keys step the day, a tap opens a slot to its sheet, and reduced
// motion keeps every word and loses every breath. The calendar is
// intercepted before transport with the clock fixed at 13:00 on the day.
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

/** One room finished and one at its doors, one live and one with guests
 *  due, a board meeting still hours off past a changeover short of its
 *  rule, and the South Gallery free. */
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

async function openBoard(page: Page, path = "/hallkeeper/today"): Promise<string[]> {
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
  await page.goto(path);
  return asked;
}

interface Breaths {
  readonly total: number;
  readonly rogue: number;
  readonly delays: readonly string[];
}

/** Every endless animation inside the board, and whether the attention
 *  system sanctions it: a dot on a slab with a motion, the live slab's
 *  overlay, or a ring. */
async function endlessAnimations(page: Page): Promise<Breaths> {
  return page.evaluate(() => {
    const seen: { readonly sanctioned: boolean; readonly delay: string }[] = [];
    const lastDelay = (style: CSSStyleDeclaration): string => style.animationDelay.split(", ").pop() ?? "";
    for (const element of Array.from(document.querySelectorAll(".dayboard *"))) {
      const own = getComputedStyle(element);
      if (own.animationName !== "none" && own.animationIterationCount.includes("infinite")) {
        const sanctioned = (element.classList.contains("dayboard-dot") && element.closest(".dayboard-slab")?.getAttribute("data-motion") !== "none")
          || element.classList.contains("dayboard-ring");
        seen.push({ sanctioned, delay: lastDelay(own) });
      }
      const after = getComputedStyle(element, "::after");
      if (after.animationName !== "none" && after.animationIterationCount.includes("infinite")) {
        seen.push({
          sanctioned: (element.classList.contains("dayboard-slab") && element.getAttribute("data-motion") === "live-breath")
            || element.classList.contains("dayboard-ring"),
          delay: lastDelay(after),
        });
      }
    }
    return { total: seen.length, rogue: seen.filter((entry) => !entry.sanctioned).length, delays: [...new Set(seen.map((entry) => entry.delay))] };
  });
}

test.describe("Day Board", () => {
  test("breathes only where the attention system says, speaks its legend in the slots' words, and steps the day from the keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    const asked = await openBoard(page);
    await expect(page.getByText("Chamber dinner")).toBeVisible();

    // Three dots breathe (doors soon, live, guests due) and the live slab's
    // overlay; nothing else moves, and every breath shares one epoch phase.
    const breaths = await endlessAnimations(page);
    expect(breaths.rogue).toBe(0);
    expect(breaths.total).toBe(4);
    expect(breaths.delays).toHaveLength(1);

    // Every state pairs an icon, a verb and a tone, and the legend is worded
    // as the slots are (D3).
    for (const [state, verb] of [
      ["live", "LIVE · 30 min elapsed"],
      ["imminent", "Doors · 5 min"],
      ["guests-due", "Guests · 25 min"],
      ["scheduled", "Scheduled 17:30"],
      ["done", "Ended 11:30"],
    ] as const) {
      const slab = page.locator(`.dayboard-slab[data-state="${state}"]`);
      await expect(slab).toHaveCount(1);
      await expect(slab.locator(".dayboard-verb-words")).toHaveText(verb);
    }
    const legend = page.getByLabel("What the colours mean");
    for (const label of ["Scheduled", "Organisers due", "Guests due", "Doors soon", "Live", "Clear-down", "Ended", "Changeover at risk"]) {
      await expect(legend.getByText(label, { exact: true })).toBeVisible();
    }

    // One ruler with the present on it, the gaps dimensioned, and the next
    // action the room nearest its moment.
    await expect(page.locator(".dayboard-now-plaque")).toHaveText("NOW13:00");
    await expect(page.locator(".dayboard-gap-words")).toHaveText(["1 h 35", "3 h 30"]);
    await expect(page.locator(".dayboard-next")).toHaveText("Grand Hall · Doors · 5 min");

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

  test("keeps every word and loses every breath under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1000, height: 900 });
    await openBoard(page);
    await expect(page.locator(".dayboard-slab[data-state='live'] .dayboard-verb-words")).toHaveText("LIVE · 30 min elapsed");
    const running = await page.evaluate(() => Array.from(document.querySelectorAll(".dayboard *"))
      .flatMap((element) => [getComputedStyle(element), getComputedStyle(element, "::after"), getComputedStyle(element, "::before")])
      .filter((style) => style.animationName !== "none").length);
    expect(running).toBe(0);
  });

  test("shows one room at a time on a phone, the day running down the screen, and opens a slot to its sheet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBoard(page);
    await expect(page.getByText("Chamber dinner")).toBeVisible();

    // One lane per screen, swiped between rooms (D7): three rooms in use,
    // each lane as wide as the screen, the day running down it.
    await expect(page.locator(".dayboard")).toHaveAttribute("data-layout", "phone");
    await expect(page.locator(".dayboard-pager button")).toHaveCount(3);
    const lanes = await page.locator(".dayboard-lanes").evaluate((element) => ({
      wider: element.scrollWidth > element.clientWidth,
      first: element.firstElementChild?.getBoundingClientRect().width ?? 0,
      screen: element.clientWidth,
    }));
    expect(lanes.wider).toBe(true);
    expect(Math.round(lanes.first)).toBe(Math.round(lanes.screen));
    const slab = page.locator(".dayboard-slab[data-state='imminent']");
    expect((await slab.evaluate((element) => (element as HTMLElement).style.top)).endsWith("%")).toBe(true);
    await expect(page.getByRole("region", { name: "Grand Hall" }).locator(".dayboard-ruler-v .dayboard-now-plaque")).toHaveText("NOW13:00");
    expect(await unreadableText(page, ".dayboard", "the phone")).toEqual([]);

    await linkTheSheet(page);
    await page.reload();
    await page.getByRole("button", { name: /^Chamber dinner,/u }).click();
    const slot = page.getByRole("region", { name: "Grand Hall: Chamber dinner" });
    await expect(slot.getByRole("link", { name: /Open setup sheet/u })).toHaveAttribute("href", `/hallkeeper/${LAYOUT}?eventId=${EVENT}`);
    await expect(slot.getByText("Ready by 16:00 · 12 of 43 checked")).toBeVisible();
    const filled = await slot.locator(".dayboard-slot-progress-bar > span").evaluate((bar) => bar.getBoundingClientRect().width / (bar.parentElement?.getBoundingClientRect().width ?? 1));
    expect(filled).toBeCloseTo(12 / 43, 1);
    expect(await unreadableText(page, ".dayboard", "a linked sheet on a phone")).toEqual([]);
  });

  test("wears the dark register on the wall, without the day controls, readable from across the room", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openBoard(page, "/hallkeeper/today?register=wall");
    await expect(page.getByRole("main", { name: "The Day Board, wall display" })).toBeVisible();
    await expect(page.locator(".dayboard")).toHaveAttribute("data-register", "wall");
    await expect(page.getByRole("button", { name: "Previous day" })).toHaveCount(0);
    await expect(page.locator(".dayboard-slab[data-state='live'] .dayboard-verb-words")).toHaveText("LIVE · 30 min elapsed");
    expect(await unreadableText(page, ".dayboard", "the wall")).toEqual([]);
  });
});
