// Run of Show visual-verification harness (Command Centre C2) — same family
// as when-ribbon-visual-check.mjs / command-centre-visual-check.mjs: drives
// its OWN headless Chromium (where requestAnimationFrame actually runs —
// the in-app browser pane suspends rAF while hidden, so transport motion
// can only be evidenced here), mocks every API the planner cockpit needs,
// and proves the C2 surface end to end in real pixels:
//   1. the transport renders the event's phase chips with venue-local
//      times: frozen phases as ink plaques, unfrozen as pencilled paper
//      holds (computed paper ground), with the brass playhead present;
//   2. the deep-link auto-preview engages once and "Exit preview" STICKS
//      (regression pin for the engage-key latch);
//   3. clicking another frozen chip runs the spring crossfade — the
//      claim-safe "Visualizing phase change" banner appears and the
//      cockpit's phase binding settles onto the target within the spring
//      bound;
//   4. scrubbing the playhead moves the preview back;
//   5. play walks the event's day — the playhead advances monotonically;
//   6. selecting the dressed table shows the clearance ring label in real
//      metres and the DRESSING section with the persisted linen, place
//      setting, chair style and centrepiece;
//   7. editing the centrepiece issues the batch save carrying the new
//      metadata, and the freeze action posts to the layout-snapshots
//      endpoint with the open configuration.
// Run from repo root with the web dev server up:
//   node packages/web/scripts/run-of-show-visual-check.mjs
// Env: BASE_URL (default http://localhost:5173), OUT_DIR (screenshot dir).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
  CanonicalLayoutSnapshotV0Schema,
  RoomLayoutTimelineResponseSchema,
  EventPhaseGraphSchema,
} from "@omnitwin/types";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";
const OUT = process.env.OUT_DIR ?? "D:\\claude\\run-of-show\\visual-out";
mkdirSync(OUT, { recursive: true });

const VENUE_ID = "00000000-0000-4000-8000-000000004003";
const SPACE_ID = "00000000-0000-4000-8000-00000000a001";
const EVENT_ID = "00000000-0000-4000-8000-00000000e001";
const CONFIG_ID = "00000000-0000-4000-8000-00000000cf01";
const STAFF_ID = "00000000-0000-4000-8000-00000000ff01";
const PHASE_SETUP = "00000000-0000-4000-8000-00000000f001";
const PHASE_LIVE = "00000000-0000-4000-8000-00000000f002";
const PHASE_TEARDOWN = "00000000-0000-4000-8000-00000000f003";
const SNAP_SETUP = "00000000-0000-4000-8000-00000000d001";
const SNAP_LIVE = "00000000-0000-4000-8000-00000000d002";
const CANONICAL_ID = "00000000-0000-4000-8000-00000000ca01";
const TABLE_ASSET = "a1ef4d89-7786-5878-bee1-87b3fac28200"; // round-table-6ft
const CHAIR_ASSET = "4dfcae64-b6e3-54f8-817f-af041edab935"; // banquet-chair
const TABLE_OBJECT = "00000000-0000-4000-8000-00000000ab01";
const CHAIR_OBJECT = "00000000-0000-4000-8000-00000000ab02";

// The wedding day, venue-local Europe/London (BST): setup 09:00, live 13:00.
const DAY = "2026-09-19";
const SETUP_START = `${DAY}T08:00:00.000Z`;
const LIVE_START = `${DAY}T12:00:00.000Z`;
const TEARDOWN_START = `${DAY}T23:30:00.000Z`;
const iso = (value) => new Date(value).toISOString();

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
  lengthM: "10.5",
  heightM: "7",
  floorPlanOutline: [
    { x: -10.5, z: -5.25 },
    { x: 10.5, z: -5.25 },
    { x: 10.5, z: 5.25 },
    { x: -10.5, z: 5.25 },
  ],
  loadoutCount: 0,
  description: null,
  meshUrl: null,
  thumbnailUrl: null,
  sortOrder: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// The open configuration: the DRESSED table at the room's centre (so the
// canvas-centre click selects it) plus one chair.
const TABLE_METADATA = {
  clothed: true,
  clothStyle: "white",
  tableSetting: "dinner",
  chairStyle: "Chiavari gold",
  centerpiece: "low white florals",
  notes: "Top table - bride and groom",
  groupId: null,
};
const wireObject = (id, assetDefinitionId, x, z, sortOrder, metadata) => ({
  id,
  configurationId: CONFIG_ID,
  assetDefinitionId,
  positionX: String(x),
  positionY: "0",
  positionZ: String(z),
  rotationX: "0",
  rotationY: "0",
  rotationZ: "0",
  scale: "1",
  sortOrder,
  metadata,
});
const E2E_CONFIGURATION = {
  data: {
    id: CONFIG_ID,
    spaceId: SPACE_ID,
    venueId: VENUE_ID,
    userId: STAFF_ID,
    name: "Run of Show walkthrough",
    isPublicPreview: false,
    revision: 3,
    objects: [
      wireObject(TABLE_OBJECT, TABLE_ASSET, 0, 0, 0, TABLE_METADATA),
      wireObject(CHAIR_OBJECT, CHAIR_ASSET, 0, -1.35, 1, null),
    ],
  },
};

// --- The phase graph (parsed so drift fails loudly at harness start) -------
const phase = (id, name, startsAt, durationMinutes, sortOrder) => ({
  id,
  eventId: EVENT_ID,
  spaceId: SPACE_ID,
  templateKey: null,
  name,
  sortOrder,
  startsAt,
  durationMinutes,
  guestCount: 120,
  opsTasksCount: 0,
  reviewGatesCount: 0,
  densityStatus: "not_checked",
  densityLabel: "Density not yet checked",
  staffConflictsStatus: "not_checked",
  staffConflictsLabel: "Staffing not yet checked",
  notes: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
});
const PHASE_GRAPH = EventPhaseGraphSchema.parse({
  event: {
    id: EVENT_ID,
    venueId: VENUE_ID,
    createdBy: STAFF_ID,
    name: "Mackenzie-Ross wedding",
    eventType: "wedding",
    status: "in_planning",
    startsAt: LIVE_START,
    endsAt: TEARDOWN_START,
    guestCount: 120,
    clientName: "Mackenzie & Ross",
    notes: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  phases: [
    phase(PHASE_SETUP, "Setup", SETUP_START, 240, 0),
    phase(PHASE_LIVE, "Ceremony & reception", LIVE_START, 690, 1),
    phase(PHASE_TEARDOWN, "Teardown", TEARDOWN_START, 90, 2),
  ],
  scenarios: [],
  layoutVariants: [],
  configurationLinks: [],
  phaseLayoutSnapshots: [],
});

// --- Frozen layouts: same objects, two arrangements ------------------------
function layoutPayload(objectPositions) {
  const base = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE;
  return CanonicalLayoutSnapshotV0Schema.parse({
    ...base,
    configurationId: CONFIG_ID,
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    layoutName: "Run of Show walkthrough",
    createdBy: STAFF_ID,
    venueRuntime: {
      ...base.venueRuntime,
      venueId: VENUE_ID,
      venueSlug: "trades-hall",
      spaceId: SPACE_ID,
      spaceSlug: "grand-hall",
      spaceName: "Grand Hall",
      floorPlanOutline: [
        { x: -10.5, y: -5.25 },
        { x: 10.5, y: -5.25 },
        { x: 10.5, y: 5.25 },
        { x: -10.5, y: 5.25 },
      ],
      spaceDimensions: { width: 21, length: 10.5, height: 7 },
    },
    objects: objectPositions.map(([id, asset, x, z], index) => ({
      objectId: id,
      assetDefinition: asset === TABLE_ASSET
        ? { assetDefinitionId: asset, category: "table", widthM: 1.83, depthM: 1.83, heightM: 0.76, seatCount: 10, collisionType: "cylinder" }
        : { assetDefinitionId: asset, category: "chair", widthM: 0.45, depthM: 0.45, heightM: 0.9, seatCount: 1, collisionType: "box" },
      position: { x, y: 0, z },
      rotation: { x: 0, y: 0, z: 0 },
      scale: 1,
      sortOrder: index,
      groupId: null,
      metadata: null,
    })),
  });
}
const SETUP_PAYLOAD = layoutPayload([
  [TABLE_OBJECT, TABLE_ASSET, -6, -2.2],
  [CHAIR_OBJECT, CHAIR_ASSET, -6, -3.55],
]);
const LIVE_PAYLOAD = layoutPayload([
  [TABLE_OBJECT, TABLE_ASSET, 6, 2.2],
  [CHAIR_OBJECT, CHAIR_ASSET, 6, 3.55],
]);

const availableKeyframe = (snapshotId, payload) => ({
  state: "available",
  snapshotId,
  snapshotStatus: "frozen",
  canonicalSnapshotId: CANONICAL_ID,
  proofDigest: "ab".repeat(32),
  frozenBy: STAFF_ID,
  supersedesSnapshotId: null,
  createdAt: "2026-08-30T10:00:00.000Z",
  frozenAt: "2026-08-30T10:00:00.000Z",
  objectCount: payload.objects.length,
  guestCount: 120,
  payload,
});
const figures = (available) => ({
  guests: available
    ? { value: 120, source: "frozen_snapshot" }
    : { value: 120, source: "phase" },
  // Chair-first canonical seating evidence: one chair, seatCount 1.
  seatedCapacity: available
    ? { state: "available", value: 1, source: "frozen_snapshot", basis: "chair_objects" }
    : { state: "unavailable", reason: "no_valid_frozen_keyframe" },
  staffing: {
    state: "not_checked",
    value: null,
    source: "phase_staff_conflicts",
    staffConflictsStatus: "not_checked",
    staffConflictsLabel: "Staffing not yet checked",
  },
  revenue: available
    ? { state: "unavailable", reason: "no_matching_planning_scenario" }
    : { state: "unavailable", reason: "no_valid_frozen_keyframe" },
});
const timelineFrame = (p, keyframe, endsAtMinutes) => ({
  id: p.id,
  kind: "phase",
  eventId: EVENT_ID,
  eventName: "Mackenzie-Ross wedding",
  eventType: "wedding",
  eventStatus: "in_planning",
  eventGuestCount: 120,
  phaseId: p.id,
  phaseName: p.name,
  templateKey: null,
  sortOrder: p.sortOrder,
  startsAt: p.startsAt,
  endsAt: iso(Date.parse(p.startsAt) + endsAtMinutes * 60_000),
  guestCount: 120,
  opsTasksCount: 0,
  reviewGatesCount: 0,
  densityStatus: "not_checked",
  densityLabel: "Density not yet checked",
  staffConflictsStatus: "not_checked",
  staffConflictsLabel: "Staffing not yet checked",
  keyframe,
  figures: figures(keyframe.state === "available"),
});
const TIMELINE = RoomLayoutTimelineResponseSchema.parse({
  venueId: VENUE_ID,
  spaceId: SPACE_ID,
  timeZone: "Europe/London",
  // The scoped-day contract: venue-local 04:00 -> next-day 04:00. Sept 2026
  // is BST (UTC+1), so the echoed range must be 03:00Z -> 03:00Z, or the
  // client rejects the response as not matching its request.
  from: `${DAY}T03:00:00.000Z`,
  to: `2026-09-20T03:00:00.000Z`,
  range: { scope: "day", anchorDate: DAY, from: `${DAY}T03:00:00.000Z`, to: `2026-09-20T03:00:00.000Z` },
  frames: [
    timelineFrame(PHASE_GRAPH.phases[0], availableKeyframe(SNAP_SETUP, SETUP_PAYLOAD), 240),
    timelineFrame(PHASE_GRAPH.phases[1], availableKeyframe(SNAP_LIVE, LIVE_PAYLOAD), 690),
    timelineFrame(PHASE_GRAPH.phases[2], {
      state: "missing",
      reason: "no_snapshot",
      message: "No saved layout for this phase.",
    }, 90),
  ],
});

const CALENDAR = {
  data: {
    venueId: VENUE_ID,
    range: { from: `${DAY}T00:00:00.000Z`, to: `2026-09-20T00:00:00.000Z` },
    rooms: [{ id: SPACE_ID, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 }],
    entries: [{
      entryType: "booking",
      id: "00000000-0000-4000-8000-00000000b001",
      spaceId: SPACE_ID,
      kind: "ink",
      status: "active",
      state: "ink",
      title: "Mackenzie-Ross wedding",
      eventType: "wedding",
      startsAt: LIVE_START,
      endsAt: TEARDOWN_START,
      rank: null,
      jointFlag: false,
      decisionAt: null,
      ownerUserId: null,
      nextAction: null,
      nextActionDueAt: null,
      eventId: EVENT_ID,
      seriesId: null,
    }],
    conflicts: {
      conflicts: [],
      checks: {
        inkDoubleBook: { status: "checked" },
        holdOverlap: { status: "checked" },
        turnaround: { status: "checked", uncoveredPairCount: 0, detail: "All gaps covered." },
      },
    },
    turnaroundRules: [],
  },
};

const batchSaves = [];
const timelineHits = [];
const freezePosts = [];

async function installMocks(page) {
  await page.addInitScript((seed) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: seed, writable: false });
  }, {
    id: STAFF_ID,
    email: "visual-staff@e2e.test",
    role: "staff",
    venueId: VENUE_ID,
    name: "Visual Staff",
  });

  await page.route(`**/events/${EVENT_ID}/phase-graph`, (route) => {
    void route.fulfill({ json: { data: PHASE_GRAPH } });
  });
  await page.route("**/calendar/layout-timeline?*", (route) => {
    timelineHits.push(route.request().url().slice(-80));
    void route.fulfill({ json: { data: TIMELINE } });
  });
  await page.route("**/calendar?*", (route) => {
    void route.fulfill({ json: CALENDAR });
  });
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
          targetId: CONFIG_ID,
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

  // Write-capturing routes LAST: Playwright matches in reverse registration
  // order, so these must outrank the generic **/configurations/** fallback.
  await page.route(`**/configurations/${CONFIG_ID}/actions`, (route) => {
    const count = (route.request().postDataJSON()?.actions ?? []).length;
    void route.fulfill({ json: { data: { accepted: count, duplicates: 0 } } });
  });
  await page.route(`**/events/${EVENT_ID}/phases/*/layout-snapshots`, (route) => {
    const request = route.request();
    const body = request.postDataJSON() ?? {};
    freezePosts.push({ url: request.url(), configurationId: body.configurationId ?? null });
    void route.fulfill({
      status: 200,
      json: {
        outcome: "created",
        eventId: EVENT_ID,
        phaseId: PHASE_SETUP,
        configurationId: CONFIG_ID,
        snapshotId: SNAP_SETUP,
        snapshotStatus: "frozen",
        frozenAt: iso(Date.now()),
        objectCount: 2,
        guestCount: 120,
      },
    });
  });
  await page.route(`**/configurations/${CONFIG_ID}/objects/batch`, (route) => {
    const body = route.request().postDataJSON() ?? {};
    batchSaves.push(body);
    void route.fulfill({ json: E2E_CONFIGURATION });
  });
}

const failures = [];
function check(label, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures.push(label);
}
const shot = (page, name) => page.screenshot({ path: join(OUT, name), fullPage: false });

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
  await installMocks(page);

  await page.goto(`${BASE_URL}/plan/${CONFIG_ID}?eventId=${EVENT_ID}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  // 1. The transport arrives with the event's phases.
  const dock = page.locator(".cockpit-bottom");
  await dock.waitFor({ timeout: 60_000 });
  const chips = page.locator("button.layout-phase");
  try {
    await chips.first().waitFor({ timeout: 30_000 });
  } catch (error) {
    console.log("DIAG page text:", (await page.locator("body").innerText()).slice(0, 900).replaceAll(String.fromCharCode(10), " | "));
    console.log("DIAG console:", consoleErrors.slice(0, 6).join(String.fromCharCode(10)));
    console.log("DIAG dock present:", await page.locator(".cockpit-bottom").count());
    console.log("DIAG dock text:", (await page.locator(".cockpit-bottom").innerText().catch(() => "(none)")).slice(0, 500).replaceAll(String.fromCharCode(10), " | "));
    console.log("DIAG chip count:", await page.locator("button.layout-phase").count());
    console.log("DIAG timeline hits:", timelineHits);
    throw error;
  }
  check("transport renders three phase chips", await chips.count() === 3);
  const chipText = (await Promise.all(
    (await chips.all()).map((chip) => chip.innerText()),
  )).join(" | ").replaceAll("\n", " ");
  check("chips carry venue-local times (09:00 setup, 13:00 live)", /09:00/.test(chipText) && /13:00/.test(chipText));
  check("frozen chips announce the frozen layout", /frozen layout/i.test(chipText));
  const missingChipCount = await page.locator("button.layout-phase.is-missing").count();
  const filmstripText = ((await page.locator(".layout-filmstrip").innerText().catch(() => "")) ?? "").replaceAll(" ", " ");
  check(
    "the unfrozen phase is honest about it",
    missingChipCount === 1 && /no saved layout/i.test(filmstripText),
  );

  // 2. Materiality: the missing chip wears paper; the playhead thread exists.
  const paperChip = page.locator("button.layout-phase.is-missing").first();
  const paperGround = await paperChip.evaluate((el) => getComputedStyle(el).backgroundImage);
  check("missing chip wears the pencilled paper ground", paperGround.includes("239, 231, 214"));
  const inkChip = page.locator("button.layout-phase.is-frozen:not(.is-active)").first();
  const inkGround = await inkChip.evaluate((el) => getComputedStyle(el).backgroundImage);
  check("frozen chip wears the ink plaque ground", inkGround.includes("35, 32, 28"));
  check("the brass playhead threads the ruler", await page.locator(".layout-ruler__playhead").count() === 1);
  await shot(page, "01-transport-arrival.png");

  // 3. Deep-link auto-preview engaged once; Exit preview STICKS (latch pin).
  const exitButton = page.locator("button.layout-exit-preview");
  check("deep-link auto-preview engaged", await exitButton.count() === 1);
  await exitButton.click();
  await page.waitForTimeout(1600);
  check("exit preview sticks through effect re-runs", await exitButton.count() === 0);

  // 4. Select the dressed table at the room centre: clearance ring + DRESSING.
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  const dressing = page.locator('[aria-label="Selected object dressing and note"]');
  for (const [dx, dy] of [[0, 0], [0, 24], [0, -24], [28, 0], [-28, 0], [0, 48], [0, -48]]) {
    await canvas.click({ position: { x: box.width / 2 + dx, y: box.height / 2 + dy } });
    await page.waitForTimeout(250);
    if (await dressing.count() > 0) break;
  }
  check("selecting the table opens the dressing inspector", await dressing.count() === 1);
  if (await dressing.count() === 1) {
    const panelText = (await dressing.innerText()).replaceAll("\n", " ");
    check("linen and place setting rows render", /linen/i.test(panelText) && /place setting/i.test(panelText));
    const chairValue = await dressing.locator("input").first().inputValue();
    const centreValue = await dressing.locator("input").nth(1).inputValue();
    check("chair style round-trips from metadata", chairValue === "Chiavari gold");
    check("centrepiece round-trips from metadata", centreValue === "low white florals");
    const ringLabel = await page.getByText(/m clearance/).count();
    check("the clearance ring label speaks real metres", ringLabel >= 1);
    await shot(page, "02-dressing-and-ring.png");

    // 5. The centrepiece edit reaches the batch save with its metadata.
    const centreInput = dressing.locator("input").nth(1);
    await centreInput.fill("candelabra with ivy");
    await centreInput.blur();
    await page.waitForTimeout(3500);
    const savedCentre = batchSaves.some((body) => JSON.stringify(body).includes("candelabra with ivy"));
    check("centrepiece edit lands in the batch save metadata", savedCentre);
  }

  // 6. Chip-click crossfade: claim-safe banner + spring settles on target.
  const liveChip = chips.nth(1);
  await liveChip.click();
  const banner = page.getByText(/Visualizing phase change/i).first();
  const bannerSeen = await banner.waitFor({ timeout: 2_000 }).then(() => true).catch(() => false);
  check("crossfade shows the claim-safe motion banner", bannerSeen);
  await shot(page, "03-crossfade-mid.png");
  await page.waitForTimeout(1_300); // KEYFRAME_SPRING_MAX_MS bound + margin
  const activeAfter = await page.locator("button.layout-phase.is-active").first().innerText();
  check("spring settles onto the ceremony phase", /ceremony/i.test(activeAfter));
  await shot(page, "04-crossfade-settled.png");

  // 7. Scrubbing the playhead moves the preview back to setup.
  // Scrub INSIDE the setup phase (its start + 30 min): the range minimum is
  // 04:00 local, which sits before any phase and lands in the schedule gap.
  await page.locator(".layout-ruler__input").evaluate((el, atMs) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, String(atMs));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, Date.parse(SETUP_START) + 30 * 60_000);
  await page.waitForTimeout(1_300);
  const activeAfterScrub = await page.locator("button.layout-phase.is-active").first().innerText();
  check("scrubbing the playhead returns to setup", /setup/i.test(activeAfterScrub));

  // 8. Play walks the event's day: the playhead advances monotonically.
  // Deselect first: the floating dressing panel overlaps the dock's right
  // edge and intercepts pointer events aimed at the transport controls.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const exitAgain = page.locator("button.layout-exit-preview");
  if (await exitAgain.count() > 0) await exitAgain.click();
  await page.waitForTimeout(400);
  const play = page.locator("button.layout-play-button");
  await play.click();
  const readPlayhead = () => page.locator(".layout-ruler__input").evaluate((el) => Number(el.value));
  const p0 = await readPlayhead();
  await page.waitForTimeout(1_200);
  const p1 = await readPlayhead();
  await page.waitForTimeout(1_200);
  const p2 = await readPlayhead();
  check("play advances the playhead monotonically", p1 > p0 && p2 > p1);
  await shot(page, "05-playback.png");
  if ((await play.getAttribute("aria-label")) === "Pause timeline") await play.click();

  // 9. The freeze action posts the open configuration to the ledger path.
  const exitOnce = page.locator("button.layout-exit-preview");
  if (await exitOnce.count() > 0) await exitOnce.click();
  await page.waitForTimeout(600);
  const freeze = page.getByRole("button", { name: /Freeze current saved plan/i });
  const freezeVisible = await freeze.count() > 0;
  check("the freeze action offers the current saved plan", freezeVisible);
  if (freezeVisible) {
    await freeze.click();
    await page.waitForTimeout(1_200);
    check("freeze posts the open configuration", freezePosts.some((post) => post.configurationId === CONFIG_ID));
  }

  // The G4 action-log flusher is fail-open by design (logs, retries, never
  // blocks planning) and its lane is not under test here; its flush noise
  // against the mocked actions endpoint is environment, not defect.
  const fatalConsole = consoleErrors.filter((line) => !/favicon|manifest|401|403|404|action log flush failed|actions/.test(line));
  check("no fatal console errors", fatalConsole.length === 0);
  if (fatalConsole.length > 0) console.log(fatalConsole.slice(0, 6).join("\n"));
} finally {
  await browser.close();
}

console.log(failures.length === 0
  ? `\nRun of Show visual check: ALL PASS (screenshots in ${OUT})`
  : `\nRun of Show visual check: ${String(failures.length)} FAILURE(S)`);
process.exit(failures.length === 0 ? 0 : 1);
