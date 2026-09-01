// Command Centre visual-verification harness (C1) — same family as
// day-board-visual-check.mjs / when-ribbon-visual-check.mjs: drives its own
// headless Chromium against the dev server with the calendar and enquiries
// route-mocked relative to Date.now(), then proves the re-materialised board
// in real pixels:
//   1. photo lane rails with published capacities and utilisation dials;
//   2. ink plaques / paper holds (folded corner, tilt, pin) / the wax
//      CONFLICT stamp; SETUP/LIVE/TEARDOWN bands; the Doors-in countdown;
//   3. dimensioned changeover gaps with the tight pencil note;
//   4. the unplaced clipboard: a real pointer drag of a slip onto a lane
//      opens the convert drawer prefilled with that lane and instant;
//   5. DAY/WEEK/2W (fourteen day columns), Ctrl-K palette find-and-focus,
//      and the drawing-sheet title block.
// Run from repo root with the web dev server up:
//   node packages/web/scripts/command-centre-visual-check.mjs
// Env: BASE_URL (default http://localhost:5173), OUT_DIR (screenshot dir).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";
const OUT = process.env.OUT_DIR ?? join(process.cwd(), "visual-out", "command-centre");
mkdirSync(OUT, { recursive: true });

const VENUE = "00000000-0000-4000-8000-000000000001";
const GRAND = "00000000-0000-4000-8000-0000000000a1";
const SALOON = "00000000-0000-4000-8000-0000000000a2";
const EVENT = "00000000-0000-4000-8000-0000000000e1";
const MIN = 60_000;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

function booking(id, spaceId, startMs, endMs, overrides = {}) {
  return {
    entryType: "booking",
    id,
    spaceId,
    kind: "ink",
    status: "active",
    state: "ink",
    title: "Untitled",
    eventType: "dinner",
    startsAt: iso(startMs),
    endsAt: iso(endMs),
    rank: null,
    jointFlag: false,
    decisionAt: null,
    ownerUserId: null,
    nextAction: null,
    nextActionDueAt: null,
    eventId: null,
    seriesId: null,
    ...overrides,
  };
}

const B = (n) => `00000000-0000-4000-8000-0000000000b${String(n)}`;
const A_START = NOW + 120 * MIN; // Doors in ~2h — inside the countdown window
const A_END = A_START + 180 * MIN;

const CALENDAR = {
  data: {
    venueId: VENUE,
    range: { from: iso(NOW - 12 * 60 * MIN), to: iso(NOW + 12 * 60 * MIN) },
    rooms: [
      { id: GRAND, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 },
      { id: SALOON, name: "Saloon", slug: "saloon", sortOrder: 1 },
    ],
    entries: [
      booking(B(1), GRAND, A_START, A_END, {
        eventId: EVENT,
        title: "Chamber banquet",
        eventName: "Chamber banquet",
        clientName: "The Hartwell Family",
        guestCount: 120,
        notes: "Piper at the door for the arrival.",
      }),
      {
        entryType: "phase",
        id: "00000000-0000-4000-8000-0000000000f1",
        spaceId: GRAND,
        eventId: EVENT,
        eventName: "Chamber banquet",
        name: "Setup",
        startsAt: iso(A_START - 60 * MIN),
        endsAt: iso(A_START),
        sortOrder: 0,
      },
      {
        entryType: "phase",
        id: "00000000-0000-4000-8000-0000000000f2",
        spaceId: GRAND,
        eventId: EVENT,
        eventName: "Chamber banquet",
        name: "Breakdown",
        startsAt: iso(A_END),
        endsAt: iso(A_END + 60 * MIN),
        sortOrder: 1,
      },
      // Next ink: 2h after A's teardown ends — under the Grand Hall's 240m
      // guideline, so the gap dimension carries the tight pencil note.
      booking(B(2), GRAND, A_END + 180 * MIN, A_END + 360 * MIN, {
        title: "Evening recital",
        eventType: "concert",
      }),
      // A pencilled paper hold on the Saloon.
      booking(B(3), SALOON, NOW + 300 * MIN, NOW + 480 * MIN, {
        kind: "hold",
        state: "hold",
        rank: 1,
        title: "MacLeod wedding option",
      }),
      // The wax stamp: two Saloon inks sharing a slot.
      booking(B(4), SALOON, NOW - 240 * MIN, NOW - 60 * MIN, { title: "Morning briefing" }),
      booking(B(5), SALOON, NOW - 180 * MIN, NOW - 120 * MIN, { title: "Double-booked call" }),
    ],
    conflicts: {
      conflicts: [
        {
          id: "ink_double_book:conflict-1",
          type: "ink_double_book",
          severity: "blocking",
          spaceId: SALOON,
          entryIds: [B(4), B(5)],
          explanation: "Two inked bookings share the Saloon this morning.",
        },
      ],
      checks: {
        inkDoubleBook: { status: "checked" },
        holdOverlap: { status: "checked" },
        turnaround: { status: "checked", uncoveredPairCount: 0, detail: "All gaps covered." },
      },
    },
    turnaroundRules: [
      { spaceId: null, eventType: null, name: "House default", minutes: 90, isActive: true },
      { spaceId: GRAND, eventType: null, name: "Grand Hall", minutes: 240, isActive: true },
    ],
  },
};

const ENQUIRIES = {
  data: [
    {
      id: "00000000-0000-4000-8000-0000000000d1",
      venueId: VENUE,
      spaceId: GRAND,
      configurationId: null,
      userId: null,
      guestEmail: null,
      guestPhone: null,
      guestName: null,
      state: "submitted",
      name: "Isla Munro",
      email: "isla@example.com",
      preferredDate: null,
      eventType: "ceilidh",
      estimatedGuests: 90,
      message: "Looking at a winter ceilidh.",
      createdAt: iso(NOW - 3 * 864e5),
      updatedAt: iso(NOW - 864e5),
    },
    {
      id: "00000000-0000-4000-8000-0000000000d2",
      venueId: VENUE,
      spaceId: SALOON,
      configurationId: null,
      userId: null,
      guestEmail: null,
      guestPhone: null,
      guestName: null,
      state: "under_review",
      name: "Fraser & Co",
      email: "events@example.com",
      preferredDate: null,
      eventType: "dinner",
      estimatedGuests: 40,
      message: "Client dinner.",
      createdAt: iso(NOW - 2 * 864e5),
      updatedAt: iso(NOW - 864e5),
    },
  ],
};

async function installMocks(page) {
  await page.addInitScript((seed) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: seed, writable: false });
  }, {
    id: "visual-staff",
    email: "visual-staff@e2e.test",
    role: "staff",
    venueId: VENUE,
    name: "Visual Staff",
  });
  // Exact-pathname predicates, NOT globs: a glob like **/enquiries* also
  // swallows the dev server's /src/api/enquiries.ts MODULE request and
  // feeds it JSON, killing the page's import chain.
  await page.route((url) => url.pathname === "/calendar", (route) => {
    void route.fulfill({ json: CALENDAR });
  });
  await page.route((url) => url.pathname === "/enquiries", (route) => {
    void route.fulfill({ json: ENQUIRIES });
  });
  await page.route((url) => url.pathname === "/notifications", (route) => {
    void route.fulfill({ json: { data: [] } });
  });
  await page.route((url) => url.pathname === `/venues/${VENUE}`, (route) => {
    void route.fulfill({
      json: {
        data: {
          id: VENUE,
          name: "Trades Hall Glasgow",
          slug: "trades-hall",
          address: "85 Glassford Street",
          logoUrl: null,
          brandColour: null,
          timezone: "Europe/London",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });
  });
}

const failures = [];
function check(label, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures.push(label);
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`));
  await installMocks(page);
  await page.goto(`${BASE_URL}/diary?view=day`, { waitUntil: "domcontentloaded", timeout: 60_000 });

  const welcome = page.getByRole("button", { name: /take me to the diary/iu });
  try {
    await welcome.waitFor({ timeout: 5_000 });
    await welcome.click();
  } catch {
    // Already dismissed — fine.
  }

  try {
    await page.locator(".diary-block").first().waitFor({ timeout: 30_000 });
  } catch (error) {
    const seen = await page.evaluate(() => ({
      url: location.href,
      bodyText: document.body.innerText.slice(0, 700),
    }));
    console.error("No blocks. Page state:", JSON.stringify(seen, null, 2));
    console.error("Console errors:", consoleErrors.slice(0, 8));
    await page.screenshot({ path: join(OUT, "command-centre-FAILED.png") });
    throw error;
  }

  // --- 1. rails ------------------------------------------------------------
  const railPhotoLoaded = await page.evaluate(() => {
    const photo = document.querySelector(".diary-rail-photo");
    return photo instanceof HTMLImageElement && photo.naturalWidth > 0;
  });
  check("a lane rail photograph loads", railPhotoLoaded);
  const railText = await page.locator(".diary-lanes .diary-rail").first().innerText();
  check("the rail names the published reception capacity", /reception/iu.test(railText));
  check("the rail carries a utilisation percentage", /%/u.test(railText));

  // --- 2. card materiality -------------------------------------------------
  check("ink plaques render", (await page.locator(".diary-block.is-ink").count()) >= 2);
  check("a paper hold renders", (await page.locator(".diary-block.is-hold").count()) >= 1);
  const holdStyle = await page.locator(".diary-block.is-hold .diary-block-card").first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { clipPath: style.clipPath, tilt: element.dataset["tilt"] ?? "0" };
  });
  check("the hold's folded corner is cut (clip-path polygon)", holdStyle.clipPath.startsWith("polygon"));
  check("the hold lies at its stable tilt", holdStyle.tilt !== "0");
  check("the wax CONFLICT stamp shows", (await page.locator(".diary-block-stamp:visible").count()) >= 1);

  // --- 3. the card face ----------------------------------------------------
  const boardText = await page.locator(".diary-canvas").innerText();
  check("client and guests read on the card", boardText.includes("The Hartwell Family") && boardText.includes("120 guests"));
  check("the Doors-in countdown runs", /Doors in \d/u.test(boardText));
  check("SETUP and TEARDOWN bands label themselves", /setup/iu.test(boardText) && /teardown/iu.test(boardText));

  // --- 4. the dimensioned gap ----------------------------------------------
  check("the changeover gap is dimensioned", (await page.locator(".diary-gap").count()) >= 1);
  const gapText = await page.locator(".diary-gap.is-tight").first().innerText().catch(() => "");
  check("the tight gap carries the pencil guideline note", gapText.includes("guideline"));

  await page.screenshot({ path: join(OUT, "command-centre-board.png"), fullPage: false });

  // --- 5. the clipboard drag-on -------------------------------------------
  const slip = page.locator(".diary-tray-enquiry.is-draggable").first();
  check("the unplaced slips are draggable", (await page.locator(".diary-tray-enquiry.is-draggable").count()) >= 1);
  const slipBox = await slip.boundingBox();
  const lane = page.locator("[data-diary-lane]").first();
  const laneBox = await lane.boundingBox();
  if (slipBox !== null && laneBox !== null) {
    await page.mouse.move(slipBox.x + slipBox.width / 2, slipBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(laneBox.x + 300, laneBox.y + laneBox.height / 2, { steps: 8 });
    const ghostText = await page.locator(".diary-enquiry-ghost").innerText().catch(() => "");
    check("the slip in flight announces its pencil time", /Pencil at \d/u.test(ghostText));
    await page.screenshot({ path: join(OUT, "command-centre-drag.png") });
    await page.mouse.up();
    const drawer = page.locator(".diary-drawer");
    await drawer.waitFor({ timeout: 10_000 });
    const drawerText = await drawer.innerText();
    check("release opens the convert drawer, prefilled from the drop", drawerText.includes("Isla Munro"));
    await page.screenshot({ path: join(OUT, "command-centre-drawer.png") });
    await page.keyboard.press("Escape");
  } else {
    check("slip and lane geometry available for the drag", false);
  }

  // --- 6. 2W + palette + title block ---------------------------------------
  await page.getByRole("button", { name: "2W" }).click();
  await page.waitForTimeout(800);
  check("the fortnight shows fourteen day columns", (await page.locator(".diary-axis-day").count()) === 14);
  check("the fortnight titles itself honestly", (await page.locator(".diary-range-title").innerText()).startsWith("Fortnight of"));

  await page.keyboard.press("Control+k");
  const palette = page.locator(".diary-palette");
  await palette.waitFor({ timeout: 5_000 });
  await page.locator(".diary-palette-input").fill("Hartwell");
  await page.waitForTimeout(300);
  check("the palette finds the booking by CLIENT name", (await palette.innerText()).includes("Chamber banquet"));
  await page.screenshot({ path: join(OUT, "command-centre-palette.png") });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const focusedId = await page.evaluate(() => document.activeElement?.id ?? "");
  check("picking focuses the booking's block", focusedId.startsWith("diary-block-"));

  check("the sheet signs itself (title block)", (await page.locator(".diary-title-block").innerText()).match(/booking command centre/iu) !== null);
} finally {
  await browser.close();
}

console.log(`\nScreenshots: ${OUT}`);
if (failures.length > 0) {
  console.error(`\n${String(failures.length)} check(s) failed.`);
  process.exit(1);
}
console.log("Command Centre visual check: all green.");
