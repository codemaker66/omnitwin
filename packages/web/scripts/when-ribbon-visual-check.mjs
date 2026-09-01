// When ribbon visual-verification harness (Day Board S2) — same family as
// visual-check.mjs / day-board-visual-check.mjs: drives its OWN headless
// Chromium, mocks every API the planner cockpit needs, then proves the
// ribbon END TO END in real pixels:
//   1. the ingot, ink/pencil ghosts and hatched guideline buffers render
//      on the day strip inside the cockpit shell;
//   2. a real pointer drag moves the bar 1:1, shows the snapped landing
//      shadow, and the release raises the ink-resists confirm step;
//   3. confirming issues ONE PATCH /bookings/:id carrying startsAt+endsAt
//      and an Idempotency-Key header (the idempotent command path).
// Run from repo root with the web dev server up:
//   node packages/web/scripts/when-ribbon-visual-check.mjs
// Env: BASE_URL (default http://localhost:5173), OUT_DIR (screenshot dir).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";
const OUT = process.env.OUT_DIR ?? join(process.cwd(), "visual-out", "when-ribbon");
mkdirSync(OUT, { recursive: true });

const VENUE_ID = "00000000-0000-4000-8000-000000004003";
const SPACE_ID = "00000000-0000-4000-8000-00000000a001";
const EVENT_ID = "00000000-0000-4000-8000-00000000e001";
const SELF_ID = "00000000-0000-4000-8000-00000000b001";
const INK_GHOST_ID = "00000000-0000-4000-8000-00000000c001";
const PENCIL_GHOST_ID = "00000000-0000-4000-8000-00000000c002";
const MIN = 60_000;

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

const E2E_VENUE = {
  id: VENUE_ID,
  name: "Trades Hall Glasgow",
  slug: "trades-hall",
  address: "85 Glassford Street",
  logoUrl: null,
  brandColour: null,
  timezone: "Europe/London",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const E2E_SPACE = {
  id: SPACE_ID,
  venueId: VENUE_ID,
  name: "Grand Hall",
  slug: "grand-hall",
  widthM: "21",
  lengthM: "31",
  heightM: "10",
  floorPlanOutline: [
    { x: -10.5, z: -15.5 },
    { x: 10.5, z: -15.5 },
    { x: 10.5, z: 15.5 },
    { x: -10.5, z: 15.5 },
  ],
  loadoutCount: 0,
  description: null,
  meshUrl: null,
  thumbnailUrl: null,
  sortOrder: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const E2E_CONFIGURATION = {
  data: {
    id: "cfg-when-ribbon",
    spaceId: SPACE_ID,
    venueId: VENUE_ID,
    userId: null,
    name: "When ribbon walkthrough",
    isPublicPreview: true,
    revision: 1,
    objects: [],
  },
};

/** The linked event: seeded 2h from now so the strip shows a live day. */
const EVENT_START = NOW + 120 * MIN;
const PHASE_GRAPH = {
  data: {
    event: {
      id: EVENT_ID,
      venueId: VENUE_ID,
      createdBy: null,
      name: "Chamber banquet",
      eventType: "dinner",
      status: "draft",
      startsAt: iso(EVENT_START),
      endsAt: iso(EVENT_START + 180 * MIN),
      guestCount: 120,
      clientName: null,
      notes: null,
      createdAt: iso(NOW - 864e5),
      updatedAt: iso(NOW - 864e5),
    },
    phases: [],
    scenarios: [],
    layoutVariants: [],
    configurationLinks: [],
    phaseLayoutSnapshots: [],
  },
};

function bookingEntry(id, startMs, endMs, overrides = {}) {
  return {
    entryType: "booking",
    id,
    spaceId: SPACE_ID,
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

const CALENDAR = {
  data: {
    venueId: VENUE_ID,
    range: { from: iso(NOW - 7 * 864e5), to: iso(NOW + 7 * 864e5) },
    rooms: [{ id: SPACE_ID, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 }],
    entries: [
      bookingEntry(SELF_ID, EVENT_START, EVENT_START + 180 * MIN, {
        eventId: EVENT_ID,
        title: "Chamber banquet",
      }),
      bookingEntry(INK_GHOST_ID, EVENT_START + 420 * MIN, EVENT_START + 540 * MIN, {
        title: "Evening recital",
        eventType: "concert",
      }),
      bookingEntry(PENCIL_GHOST_ID, EVENT_START - 360 * MIN, EVENT_START - 240 * MIN, {
        kind: "hold",
        state: "hold",
        rank: 1,
        title: "Morning hold",
      }),
    ],
    conflicts: {
      conflicts: [],
      checks: {
        inkDoubleBook: { status: "checked" },
        holdOverlap: { status: "checked" },
        turnaround: { status: "checked", uncoveredPairCount: 0, detail: "All gaps covered." },
      },
    },
    turnaroundRules: [
      { spaceId: null, eventType: null, name: "House default", minutes: 90, isActive: true },
      { spaceId: SPACE_ID, eventType: null, name: "Grand Hall", minutes: 120, isActive: true },
    ],
  },
};

/** A schema-complete Booking for the PATCH reply. */
function patchedBooking(startsAt, endsAt) {
  return {
    data: {
      id: SELF_ID,
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      eventId: EVENT_ID,
      kind: "ink",
      status: "active",
      state: "ink",
      title: "Chamber banquet",
      eventType: "dinner",
      startsAt,
      endsAt,
      rank: null,
      jointFlag: false,
      decisionAt: null,
      ownerUserId: null,
      nextAction: null,
      nextActionDueAt: null,
      seriesId: null,
      notes: null,
      createdBy: null,
      enquiryId: null,
      createdAt: iso(NOW - 864e5),
      updatedAt: iso(NOW),
    },
  };
}

const patchRequests = [];

async function installMocks(page) {
  await page.addInitScript((seed) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: seed, writable: false });
  }, {
    id: "visual-staff",
    email: "visual-staff@e2e.test",
    role: "staff",
    venueId: VENUE_ID,
    name: "Visual Staff",
  });

  await page.route(`**/events/${EVENT_ID}/phase-graph`, (route) => {
    void route.fulfill({ json: PHASE_GRAPH });
  });
  await page.route("**/calendar?*", (route) => {
    void route.fulfill({ json: CALENDAR });
  });
  await page.route(`**/bookings/${SELF_ID}`, (route) => {
    const request = route.request();
    if (request.method() === "PATCH") {
      const body = request.postDataJSON() ?? {};
      patchRequests.push({
        idempotencyKey: request.headers()["idempotency-key"] ?? null,
        startsAt: body.startsAt ?? null,
        endsAt: body.endsAt ?? null,
      });
      void route.fulfill({
        json: patchedBooking(body.startsAt ?? iso(EVENT_START), body.endsAt ?? iso(EVENT_START + 180 * MIN)),
        headers: { "idempotency-replay": "false" },
      });
      return;
    }
    void route.continue();
  });

  // The cockpit's own diet of planner APIs, mirrored from visual-check.mjs.
  // The bare collection URL (POST create / GET list) is NOT covered by the
  // `/**` pattern — without this, the planner bootstrap's createPublicConfig
  // hits the real API, whose DB does not know these synthetic ids.
  await page.route("**/public/configurations", (route) => {
    void route.fulfill({ json: E2E_CONFIGURATION });
  });
  await page.route("**/public/configurations/**", (route) => {
    void route.fulfill({ json: E2E_CONFIGURATION });
  });
  await page.route("**/configurations/**", (route) => {
    void route.fulfill({ json: E2E_CONFIGURATION });
  });
  await page.route("**/assets/runtime-packages/latest?*", (route) => {
    void route.fulfill({ json: { data: null } });
  });
  await page.route("**/notifications*", (route) => {
    void route.fulfill({ json: { data: [] } });
  });
  await page.route("**/truth-mode/summary?*", (route) => {
    void route.fulfill({
      json: {
        data: {
          targetType: "configuration",
          targetId: "cfg-when-ribbon",
          source: "Procedural planner preview with mocked visual verification data.",
          confidence: "unknown",
          assumption: "Deterministic test fixture for screenshot review.",
          evidenceStatus: "not_checked",
          reviewGate: "Human review is required before operational use.",
          staleState: "unknown",
          safeWording: ["Runtime asset loaded, not yet verified or signed."],
          humanReviewRequired: true,
          counts: { evidenceItems: 0, checkResults: 0, assumptions: 1, reviewGates: 1, staleEvents: 0 },
        },
      },
    });
  });
  await page.route(`**/venues/${VENUE_ID}/spaces/${SPACE_ID}`, (route) => {
    void route.fulfill({ json: { data: E2E_SPACE } });
  });
  await page.route(`**/venues/${VENUE_ID}/spaces`, (route) => {
    void route.fulfill({ json: { data: [E2E_SPACE] } });
  });
  await page.route(`**/venues/${VENUE_ID}`, (route) => {
    void route.fulfill({ json: { data: { ...E2E_VENUE, spaces: [E2E_SPACE] } } });
  });
  await page.route("**/venues", (route) => {
    void route.fulfill({ json: { data: [E2E_VENUE] } });
  });
}

const failures = [];
function check(label, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures.push(label);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`));
  const network = [];
  page.on("requestfinished", (request) => {
    if (request.url().includes("localhost:30") || request.url().includes("/api")) {
      void request.response().then((response) => {
        network.push(`${request.method()} ${request.url().slice(0, 120)} -> ${response?.status() ?? "?"}`);
      });
    }
  });
  page.on("requestfailed", (request) => {
    network.push(`${request.method()} ${request.url().slice(0, 120)} -> FAILED ${request.failure()?.errorText ?? ""}`);
  });
  await installMocks(page);

  // Deep-link the config code — the sibling harness's proven path: it goes
  // straight to loadConfiguration against the config mocks instead of the
  // auto-create bootstrap (whose venue/space/create diet is a moving
  // target this harness does not need to re-prove).
  await page.goto(`${BASE_URL}/plan/cfg-when-ribbon?eventId=${EVENT_ID}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  const ingot = page.locator("[data-testid='when-ribbon-ingot']");
  try {
    await ingot.waitFor({ timeout: 60_000 });
  } catch (error) {
    // Diagnosability over mystery: say what the page WAS showing.
    const seen = await page.evaluate(() => {
      const ribbonElement = document.querySelector("[data-testid='when-ribbon']");
      const ingotElement = document.querySelector("[data-testid='when-ribbon-ingot']");
      return {
        url: location.href,
        shell: document.querySelector(".cockpit-shell") !== null,
        ribbon: ribbonElement !== null,
        ribbonText: ribbonElement === null ? null : ribbonElement.textContent?.slice(0, 300),
        ribbonRect: ribbonElement === null ? null : JSON.stringify(ribbonElement.getBoundingClientRect()),
        ingotExists: ingotElement !== null,
        ingotRect: ingotElement === null ? null : JSON.stringify(ingotElement.getBoundingClientRect()),
        bodyText: document.body.innerText.slice(0, 300),
      };
    });
    console.error("Ingot never appeared. Page state:", JSON.stringify(seen, null, 2));
    console.error("Console errors:", consoleErrors.slice(0, 10));
    console.error("Network tail:", network.slice(-25));
    await page.screenshot({ path: join(OUT, "when-ribbon-FAILED.png") });
    throw error;
  }
  await page.waitForTimeout(3_000); // let the 3D scene settle behind the ribbon

  // --- 1. the strip renders the world -------------------------------------
  const ariaLabel = await ingot.getAttribute("aria-label");
  check("ingot names the booking and its window", ariaLabel !== null && ariaLabel.includes("Chamber banquet"));
  check("both ghosts render", (await page.locator("[data-testid='when-ribbon-ghost']").count()) === 2);
  check("hatched buffers hug the ink ghost (one each side)", (await page.locator("[data-testid='when-ribbon-buffer']").count()) === 2);

  const geometry = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      return element === null ? null : element.getBoundingClientRect();
    };
    return {
      ribbon: rect("[data-testid='when-ribbon']"),
      stage: rect(".cockpit-stage"),
      bottom: rect("[data-testid='cockpit-bottom']"),
    };
  });
  check(
    "the ribbon docks between the stage and the bottom strip",
    geometry.ribbon !== null && geometry.stage !== null && geometry.bottom !== null &&
      geometry.ribbon.top >= geometry.stage.bottom - 1 &&
      geometry.ribbon.bottom <= geometry.bottom.top + 1,
  );

  await page.screenshot({ path: join(OUT, "when-ribbon-cockpit.png") });

  // --- 2. a real drag: 1:1 bar, snapped shadow, ink-resists confirm --------
  const box = await ingot.boundingBox();
  check("ingot has geometry", box !== null);
  if (box === null) throw new Error("no ingot box");
  const grabX = box.x + box.width / 2;
  const grabY = box.y + box.height / 2;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  // ~90px ≈ 1h20m at this width: far enough to snap, short of the ghost's
  // guideline buffer so the clean "Moved to" path is what we assert.
  for (let step = 1; step <= 5; step += 1) {
    await page.mouse.move(grabX + step * 18, grabY, { steps: 2 });
  }
  const midDrag = await page.evaluate(() => {
    const bar = document.querySelector("[data-testid='when-ribbon-ingot']");
    const shadow = document.querySelector("[data-testid='when-ribbon-shadow']");
    return {
      transform: bar === null ? "" : bar.style.transform,
      hasShadow: shadow !== null,
    };
  });
  check("mid-drag: the bar follows the pointer (transform applied)", midDrag.transform.includes("translateX"));
  check("mid-drag: the snapped landing shadow shows", midDrag.hasShadow);
  await page.screenshot({ path: join(OUT, "when-ribbon-mid-drag.png") });
  await page.mouse.up();

  const confirm = page.locator("[data-testid='when-ribbon-confirm']");
  await confirm.waitFor({ timeout: 10_000 });
  const confirmText = await confirm.textContent();
  check("release raises the ink-resists confirm", confirmText !== null && confirmText.includes("Move the ink to"));
  await page.screenshot({ path: join(OUT, "when-ribbon-confirm.png") });

  // --- 3. confirming writes ONE idempotent PATCH ---------------------------
  await page.getByRole("button", { name: "Move the ink" }).click();
  await page.waitForTimeout(1_500);
  check("exactly one PATCH left the client", patchRequests.length === 1);
  const patch = patchRequests[0];
  check("the PATCH carries startsAt AND endsAt", Boolean(patch?.startsAt) && Boolean(patch?.endsAt));
  check("the PATCH carries an Idempotency-Key", typeof patch?.idempotencyKey === "string" && patch.idempotencyKey.length > 10);
  const movedNotice = await page.locator(".when-ribbon__notice").textContent().catch(() => null);
  check("the ribbon reports the move", movedNotice !== null && movedNotice.includes("Moved to"));
  await page.screenshot({ path: join(OUT, "when-ribbon-moved.png") });
} finally {
  await browser.close();
}

console.log(`\nScreenshots: ${OUT}`);
if (failures.length > 0) {
  console.error(`\n${String(failures.length)} check(s) failed.`);
  process.exit(1);
}
console.log("When ribbon visual check: all green.");
