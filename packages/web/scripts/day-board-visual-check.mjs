// Day Board visual-verification harness (Day Board S1) — drives its OWN
// headless Chromium via Playwright, same family as visual-check.mjs /
// rite-visual-check.mjs. Verifies BOTH motion contracts:
//   1. motion on:  pulse/breathe animations RUNNING and phase-locked (every
//      animated chip shares one animation-delay — the epoch);
//   2. reduced motion: every animation computed to "none" while the chip
//      TEXT still carries the full meaning.
// The calendar API is route-mocked with entries relative to Date.now(), so
// every state (live / guests-due / organisers-due / scheduled / done /
// exception) is on screen no matter when this runs.
// Run from repo root with the web dev server up:
//   node packages/web/scripts/day-board-visual-check.mjs
// Env: BASE_URL (default http://localhost:5173), OUT_DIR (screenshot dir).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";
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
  };
}

/** Every state on one board, whatever the wall clock says. */
function calendarFixture(now) {
  const B = (n) => `00000000-0000-4000-8000-0000000000b${String(n)}`;
  const grand = ROOMS[0].id;
  const saloon = ROOMS[1].id;
  const reception = ROOMS[2].id;
  const adam = ROOMS[3].id;
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
      booking(B(4), adam, 300, 420, "Evening recital", "concert", now),
      booking(B(5), adam, -300, -120, "Morning assembly", "assembly", now),
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
          explanation: "2 minutes between events; this changeover needs 90.",
        },
      ],
      checks: {
        inkDoubleBook: { status: "checked" },
        holdOverlap: { status: "checked" },
        turnaround: { status: "checked", uncoveredPairCount: 1, detail: "One gap uncovered." },
      },
    },
  };
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
    venueId: VENUE,
    name: "Visual Hallkeeper",
  });
  await page.route("**/calendar?*", (route) => {
    void route.fulfill({ json: calendarFixture(Date.now()) });
  });
  await page.goto(`${BASE_URL}/hallkeeper/today`, { waitUntil: "networkidle" });
  await page.waitForSelector(".dayboard-slot", { timeout: 20_000 });
  return page;
}

/** Computed animation for every slot chip: [{ state, motion, name, delay }]. */
async function readChipAnimations(page) {
  return page.evaluate(() => {
    const readings = [];
    for (const slot of document.querySelectorAll(".dayboard-slot")) {
      const dot = slot.querySelector(".dayboard-chip-dot");
      const ring = getComputedStyle(dot, "::after");
      const dotStyle = getComputedStyle(dot);
      const running = ring.animationName !== "none" ? ring : dotStyle;
      readings.push({
        state: slot.dataset.state ?? "",
        motion: slot.dataset.motion ?? "",
        name: running.animationName,
        duration: running.animationDuration,
        delay: running.animationDelay,
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
  const text = await page.locator(".dayboard").innerText();

  check("live chip text", /Live · .+left/u.test(text));
  check("guests-due chip text", /Guests · \d+m/u.test(text));
  check("organisers-due chip text", /Organisers · \d+m/u.test(text));
  check("scheduled chip text", /Doors · \d{1,2}:\d{2}/u.test(text));
  check("done chip text", /Ended · \d{1,2}:\d{2}/u.test(text));
  check("exception label", /changeover at risk/iu.test(text));
  check("legend teaches meanings", ["Organisers due", "Guests due", "Live", "Needs attention"].every((w) => text.includes(w)));

  const animated = (await readChipAnimations(page)).filter((c) => c.motion !== "none");
  check("every non-quiet chip animates", animated.length >= 4 && animated.every((c) => c.name.startsWith("dayboard-")));
  const delays = [...new Set(animated.map((c) => c.delay))];
  check(`phase lock: one shared epoch delay (saw ${delays.join(", ") || "none"})`, delays.length === 1);
  const byMotion = Object.fromEntries(animated.map((c) => [c.motion, c.duration]));
  check("cadences: 4s organisers / 3s guests / 1.5s exception / 4s breathe",
    byMotion["pulse-4s"] === "4s" && byMotion["pulse-3s"] === "3s" &&
    byMotion["pulse-fast"] === "1.5s" && byMotion["breathe-4s"] === "4s");

  await page.screenshot({ path: join(OUT, "day-board-motion.png"), fullPage: true });
  await motionContext.close();

  // ---- Pass 2: reduced motion -------------------------------------------
  const reducedContext = await browser.newContext({
    viewport: { width: 1680, height: 1050 },
    reducedMotion: "reduce",
  });
  const reducedPage = await preparePage(reducedContext);
  const reducedChips = await readChipAnimations(reducedPage);
  check("reduced motion: every animation is none", reducedChips.every((c) => c.name === "none"));
  const reducedText = await reducedPage.locator(".dayboard").innerText();
  check("reduced motion: text still carries every state",
    /Live · .+left/u.test(reducedText) && /Guests · \d+m/u.test(reducedText) &&
    /changeover at risk/iu.test(reducedText));

  await reducedPage.screenshot({ path: join(OUT, "day-board-reduced-motion.png"), fullPage: true });
  await reducedContext.close();
} finally {
  await browser.close();
}

console.log(`\nScreenshots: ${OUT}`);
if (failures.length > 0) {
  console.error(`\n${String(failures.length)} check(s) failed.`);
  process.exit(1);
}
console.log("Day Board visual check: all green.");
