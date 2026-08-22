import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  TwinManifestSchema,
  type TwinManifest,
  type TwinNavEdge,
  type TwinScanNode,
} from "@omnitwin/types";
import {
  TWIN_FIXTURE_MANIFEST_EQUIRECT,
  TWIN_FIXTURE_TILE_DATA_URI,
} from "../src/twin/__fixtures__/twin-fixture.js";
import {
  TWIN_DISCLOSURE,
  TWIN_MODE_DOLLHOUSE_LABEL,
  TWIN_MODE_GROUP_LABEL,
  TWIN_MODE_PLAN_LABEL,
  TWIN_MODE_WALK_LABEL,
  TWIN_TITLE,
  twinNodeLabel,
} from "../src/twin/twin-copy.js";
import { formatRoomComparison, ROOM_SELECTOR_ORDER } from "../src/twin/shell/room-selector.js";
import {
  lookUpRoom,
  metres,
  ROOM_DISPLAY_NAMES,
  ROOM_TRUTH_PROVENANCE,
} from "../src/twin/shell/twin-rooms.js";

// ---------------------------------------------------------------------------
// /tour — the flagship walkthrough, end to end.
//
// WHY THIS FILE EXISTS. /tour is the most demoed surface in the product and
// until now no e2e spec navigated to it: twin-walk.spec.ts drives the
// venue-scoped /venues/:venueSlug/twin address and stops at Phase 1's minimap,
// which TwinViewer no longer mounts. Every journey a visitor actually takes on
// the short address — walking, switching view mode, opening the Rooms panel,
// reading a room's figures, arriving on a deep link — has been found by a human
// looking. This suite opens the page instead.
//
// EVERY REQUEST IS MOCKED, and that is not a shortcut. Real twin bundles are
// gitignored (`packages/web/public/twin/`), so a spec that leaned on the
// 149-scan capture sitting on a developer's disk would be green there and red
// on any clean checkout. The manifest below is the shared twin-fixture bundle
// with a different scan graph spliced in, so it inherits schema, venue name,
// imagery mode, LOD ladder and mesh descriptor from the one fixture the repo
// already validates — and fails loudly at import if twin/0 drifts.
//
// THE SCAN GRAPH IS CHOSEN, NOT ARBITRARY. Five viewpoints have a
// human-validated room identity (twin/shell/twin-rooms.ts) and the panel and
// dossier are silent at every other one, so the graph carries all five plus
// three unvalidated viewpoints — including scan_003, which is what "shows
// NOTHING" is asserted against. Two storeys, because a single-level graph never
// renders a level heading. Poses are synthetic metres, never capture data.
//
// WALKING IS DRIVEN BY A CLICK ON THE STAGE, not by a DOM control: the gold nav
// rings are three.js meshes and are not DOM-reachable. `?look=` aims the camera
// down the one edge leaving scan_000 first, so the click's travel cone (55°,
// travel.ts) has exactly one candidate and the hop is deterministic rather than
// a guess about where a ring landed in pixels.
//
// Console collection fails on type "error" only — headless Chromium logs its
// software-WebGL notices as warnings. Conventions follow twin-walk.spec.ts and
// landing-rite-responsive.spec.ts (route mocks, runtime error collection).
//
// WHY SOME COPY IS SPELT OUT HERE. Every FIGURE this file asserts is joined at
// read time through twin/shell/twin-rooms.ts and room-selector.ts, which are
// plain TypeScript. The four surfaces that own the remaining strings —
// QuickActions.tsx, RoomSelector.tsx, RoomDossier.tsx — each `import "./*.css"`
// for its side effect, and Playwright's node-side transform cannot load CSS, so
// importing them from a spec is a parse error rather than a choice. Wherever a
// test id or an ARIA property can carry the assertion instead, it does; the
// handful of strings below are the ones worth pinning anyway, and the handoff
// names the exact change that would let them be imported.
// ---------------------------------------------------------------------------

/** RoomSelector.tsx's TWIN_ROOMS_LEVEL_HERE — the visitor's own storey. */
const ROOMS_LEVEL_HERE = "On this level";
/** RoomSelector.tsx's twinRoomsLevelBelow(1) — storeys counted, never named. */
const ROOMS_LEVEL_ONE_BELOW = "One level down";
/** RoomSelector.tsx's TWIN_ROOMS_HERE — the marker on the room underfoot. */
const ROOMS_HERE = "You are here";
/** RoomSelector.tsx's twinRoomsRowLabel: the act, then the row's own figures,
 *  spliced byte for byte so Label in Name (WCAG 2.5.3) holds. */
function roomsRowLabel(roomName: string, comparison: string): string {
  return `Walk to ${roomName} — ${comparison}`;
}
/** RoomDossier.tsx's four stat labels, in the venue's own vocabulary. */
const STAT_DIMENSIONS = "Dimensions";
const STAT_RECEPTION = "Reception";
const STAT_DINNER = "Dinner";
const STAT_CEILING = "Ceiling";

const TOUR_PATH = "/tour";
const MANIFEST_ROUTE = "**/twin/trades-hall/manifest.json";
const TILE_ROUTE = "**/twin/trades-hall/tiles/**";
const MESH_ROUTE = "**/twin/trades-hall/mesh/dollhouse.glb";

const VENUE_NAME = TWIN_FIXTURE_MANIFEST_EQUIRECT.name;

/** Level tripod, as in the shared fixture — the pose's rotation is not under
 *  test here, and an identity quaternion keeps the camera basis readable. */
const LEVEL: TwinScanNode["pose"]["q"] = [1, 0, 0, 0];

function node(
  id: string,
  index: number,
  t: TwinScanNode["pose"]["t"],
  floor: number,
): TwinScanNode {
  return { id, index, pose: { q: LEVEL, t }, floor, roomSlug: null };
}

/**
 * Eight viewpoints over two storeys.
 *
 * Ground (floor 0): the opening run scan_000 → scan_001, the unvalidated branch
 * scan_003, and three validated ones — scan_028 and scan_046 (the two ends of
 * ONE room, which is why the panel must still list four rooms and not five) and
 * scan_058. Basement (floor −1): scan_105 and scan_126.
 *
 * scan_000 → scan_001 runs along +X in the capture frame. twin-basis maps a
 * POINT as [x, z, −y], so that edge points along +X in three.js too, which a
 * camera yaw of −90° faces (YXZ euler, forward = (−sin θ, 0, −cos θ)). That is
 * what makes the click-to-walk test deterministic; moving these two poses, or
 * the yaw the test deep-links, breaks it.
 */
const TOUR_NODES: readonly TwinScanNode[] = [
  node("scan_000", 0, [0, 0, 1.5], 0),
  node("scan_001", 1, [2.5, 0, 1.5], 0),
  node("scan_003", 2, [2.5, -2.5, 1.5], 0),
  node("scan_028", 3, [5, 0, 1.5], 0),
  node("scan_046", 4, [9, 0, 1.5], 0),
  node("scan_058", 5, [5, -3.5, 1.5], 0),
  node("scan_105", 6, [0, -3.5, -2], -1),
  node("scan_126", 7, [3, -3.5, -2], -1),
];

/** One connected graph. scan_000 has exactly ONE neighbour so the opening click
 *  can only mean scan_001; scan_028 borders scan_058 so a Saloon press is a
 *  single hop rather than a four-hop Usher ride the test would have to sit out. */
const TOUR_EDGES: readonly TwinNavEdge[] = [
  { a: "scan_000", b: "scan_001", distanceM: 2.5 },
  { a: "scan_001", b: "scan_003", distanceM: 2.5 },
  { a: "scan_001", b: "scan_028", distanceM: 2.5 },
  { a: "scan_028", b: "scan_046", distanceM: 4 },
  { a: "scan_028", b: "scan_058", distanceM: 3.5 },
  { a: "scan_058", b: "scan_105", distanceM: 5 },
  { a: "scan_105", b: "scan_126", distanceM: 3 },
];

/**
 * The bundle served to every test — the shared equirect fixture with this scan
 * graph spliced in, re-parsed so a twin/0 drift fails at import rather than in
 * the middle of a browser run.
 */
const TOUR_MANIFEST: TwinManifest = TwinManifestSchema.parse({
  ...TWIN_FIXTURE_MANIFEST_EQUIRECT,
  capture: { kind: "matterport-e57", scanCount: TOUR_NODES.length },
  nodes: TOUR_NODES,
  edges: TOUR_EDGES,
});

const TILE_BYTES = Buffer.from(
  TWIN_FIXTURE_TILE_DATA_URI.slice(TWIN_FIXTURE_TILE_DATA_URI.indexOf(",") + 1),
  "base64",
);

/**
 * A valid GLB 2.0 scene with no geometry, so the mesh modes mount their real
 * loader path without a real dollhouse in the repo. The orbit camera is framed
 * from the NODE extent (TwinViewer's nodeExtent), not from the mesh, so an
 * empty scene still produces a real vantage.
 *
 * Duplicated from twin-walk.spec.ts deliberately: both are spec files and
 * neither may export to the other. The extraction belongs in e2e/support/,
 * which this task does not own — see the handoff.
 */
function minimalGlbBytes(): Buffer {
  const json = Buffer.from(
    JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{}] }),
    "utf8",
  );
  const padding = (4 - (json.byteLength % 4)) % 4;
  const jsonChunk = Buffer.concat([json, Buffer.alloc(padding, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(header.byteLength + jsonChunk.byteLength, 8);
  header.writeUInt32LE(jsonChunk.byteLength, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, jsonChunk]);
}

const MESH_BYTES = minimalGlbBytes();

/** Ceiling for anything that waits on the R3F chunk's first cold transform. */
const READY_MS = 20_000;
/** Ceiling for a single hop's spring to settle, with slack to spare. */
const HOP_MS = 8_000;

/**
 * Is this URL something the product serves, as opposed to somebody else's CDN?
 *
 * The distinction is load-bearing rather than fussy. index.html pulls Geist and
 * Fraunces from fonts.gstatic.com, and that host is not always reachable — on
 * this machine `GET …/geistmono/v6/…woff2` answers 404 outright — at which
 * point Chromium logs "Failed to load resource: the server responded with a
 * status of 404 ()" with no URL in the text. That anonymous line is what
 * reddens twin-walk.spec.ts's viewport tests today, and it says nothing about
 * whether the tour works. A console assertion that a third party can flip is
 * not an assertion about this product, so third-party failures are excluded
 * BY ORIGIN and everything first-party is kept, URL and all.
 *
 * Uncaught exceptions are never excluded: a thrown error is ours wherever the
 * script came from.
 */
function isFirstParty(url: string, pageUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(pageUrl).origin;
  } catch {
    // Not a parseable absolute URL (about:blank, a data: line) — treat it as
    // ours rather than quietly dropping it.
    return true;
  }
}

/** Runtime errors from the app itself, with any failed request NAMED. */
function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const source = message.location().url;
    if (source !== "" && !isFirstParty(source, page.url())) return;
    errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    if (!isFirstParty(response.url(), page.url())) return;
    errors.push(`${String(response.status())} ${response.url()}`);
  });
  return errors;
}

/** Open /tour (optionally with a query) and wait for the walk to resolve. */
async function openTour(page: Page, query = ""): Promise<void> {
  await page.goto(`${TOUR_PATH}${query}`);
  await expect(page.getByTestId("twin-stage")).toBeVisible({ timeout: READY_MS });
  await expect(page.getByTestId("twin-node-label")).toBeVisible({ timeout: READY_MS });
}

/**
 * The stage is not merely present — it is holding a live WebGL context with a
 * non-empty drawing buffer.
 *
 * This is the assertion that separates "the HUD rendered" from "the twin
 * rendered": every DOM check in this file passes on a page whose canvas is a
 * dead grey rectangle, which is exactly what a headless run with no GL path
 * produces. Requesting the context that already exists hands back that same
 * context, so this reads the viewer's own renderer rather than making a second.
 */
async function expectLiveStage(page: Page, what: string): Promise<void> {
  await expect(
    page.locator("canvas").first(),
    `${what}: the stage canvas must be on screen`,
  ).toBeVisible();
  const state = await page.evaluate(() => {
    const element = document.querySelector("canvas");
    if (element === null) {
      return { context: false, lost: true, width: 0, height: 0 };
    }
    const gl = element.getContext("webgl2") ?? element.getContext("webgl");
    return {
      context: gl !== null,
      lost: gl === null ? true : gl.isContextLost(),
      width: element.width,
      height: element.height,
    };
  });
  expect(state.context, `${what}: the canvas must hold a WebGL context`).toBe(true);
  expect(state.lost, `${what}: the WebGL context must not be lost`).toBe(false);
  expect(state.width, `${what}: the drawing buffer must have width`).toBeGreaterThan(0);
  expect(state.height, `${what}: the drawing buffer must have height`).toBeGreaterThan(0);
}

/** The dossier's published figures, read as label → rendered value. */
async function dossierStats(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const stats: Record<string, string> = {};
    for (const row of document.querySelectorAll(".vv-twin-dossier-stat")) {
      const label = row.querySelector(".vv-twin-dossier-stat-label")?.textContent ?? "";
      const value = row.querySelector(".vv-twin-dossier-stat-value")?.textContent ?? "";
      stats[label] = value;
    }
    return stats;
  });
}

function modeRadio(page: Page, label: string): Locator {
  return page
    .getByRole("radiogroup", { name: TWIN_MODE_GROUP_LABEL })
    .getByRole("radio", { name: label, exact: true });
}

test.beforeEach(async ({ page }) => {
  await page.route(MANIFEST_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(TOUR_MANIFEST),
    }),
  );
  await page.route(TILE_ROUTE, (route) =>
    route.fulfill({ status: 200, contentType: "image/webp", body: TILE_BYTES }),
  );
  await page.route(MESH_ROUTE, (route) =>
    route.fulfill({ status: 200, contentType: "model/gltf-binary", body: MESH_BYTES }),
  );
});

// — 1. The page opens, the stage paints, the first viewpoint resolves. ————————

test("the tour opens on its first viewpoint with a live stage and no errors", async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  await openTour(page);

  await expect(page).toHaveTitle(TWIN_TITLE);
  await expect(page.getByRole("main", { name: TWIN_TITLE })).toBeVisible();
  await expectLiveStage(page, "the opening walk");

  // The walk resolves to a NAMED viewpoint and canonicalises it into the URL —
  // a spinner that never resolved would also pass "a canvas is visible".
  await expect(page.getByTestId("twin-node-label")).toHaveText(
    twinNodeLabel("scan_000", VENUE_NAME),
  );
  await expect(page).toHaveURL(/[?&]node=scan_000/);

  // The claim-safety line rides the page exactly once.
  await expect(page.getByText(TWIN_DISCLOSURE)).toHaveCount(1);
  await expect(page.getByText(TWIN_DISCLOSURE)).toBeVisible();

  expect(errors, "the tour must open with a clean console").toEqual([]);
});

// — 2. Walking. ——————————————————————————————————————————————————————————————

test("a click on the stage walks to the next viewpoint and relabels the HUD", async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  // Aim the camera down the only edge leaving scan_000. e57PointToThree maps a
  // point as [x, z, −y], so that edge runs along +X in three.js, which a yaw of
  // −90° faces. The click below therefore lands squarely inside scan_001's
  // travel cone, and no other node is inside it at all.
  await openTour(page, "?node=scan_000&look=scan_000%2C-90%2C0%2C75");
  await expect(page.getByTestId("twin-node-label")).toHaveText(
    twinNodeLabel("scan_000", VENUE_NAME),
  );

  const box = await page.getByTestId("twin-stage").boundingBox();
  expect(box, "the stage must have a box to click in").not.toBeNull();
  if (box === null) throw new Error("The tour stage has no geometry to click.");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect(page).toHaveURL(/[?&]node=scan_001/, { timeout: HOP_MS });
  await expect(page.getByTestId("twin-node-label")).toHaveText(
    twinNodeLabel("scan_001", VENUE_NAME),
    { timeout: HOP_MS },
  );
  await expectLiveStage(page, "after the hop");

  // The back button walks back — travel is real history, not a silent mutation.
  await page.goBack();
  await expect(page).toHaveURL(/[?&]node=scan_000/);
  await expect(page.getByTestId("twin-node-label")).toHaveText(
    twinNodeLabel("scan_000", VENUE_NAME),
  );

  expect(errors, "walking must not log an error").toEqual([]);
});

// — 3. Mode switching, and the walk-only chrome. —————————————————————————————

test("walk, dollhouse and plan each render, and walk-only chrome leaves with walk", async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  await openTour(page, "?node=scan_028");

  const quickRail = page.getByTestId("twin-quick-actions");
  const roomsTrigger = page.getByTestId("twin-rooms-trigger");
  const dossier = page.getByTestId("twin-room-dossier");

  // Walk: the rail, the Rooms pill and the dossier are all on the glass.
  await expect(modeRadio(page, TWIN_MODE_WALK_LABEL)).toHaveAttribute("aria-checked", "true");
  await expect(quickRail).toBeVisible();
  await expect(page.getByTestId("twin-quick-plan")).toBeVisible();
  await expect(roomsTrigger).toBeVisible();
  await expect(dossier).toBeVisible();
  await expectLiveStage(page, "walk");

  // Dollhouse: the mesh takes the stage and every walk-only surface is GONE —
  // not merely hidden, which is all a display:none regression would manage.
  await modeRadio(page, TWIN_MODE_DOLLHOUSE_LABEL).click();
  await expect(page).toHaveURL(/[?&]mode=dollhouse/);
  await expect(modeRadio(page, TWIN_MODE_DOLLHOUSE_LABEL)).toHaveAttribute("aria-checked", "true");
  await expect(quickRail).toHaveCount(0);
  await expect(roomsTrigger).toHaveCount(0);
  await expect(dossier).toHaveCount(0);
  // The tape is the mesh modes' own chrome — the other half of the swap.
  await expect(page.getByTestId("twin-measure-trigger")).toBeVisible();
  await expectLiveStage(page, "dollhouse");

  // Plan.
  await modeRadio(page, TWIN_MODE_PLAN_LABEL).click();
  await expect(page).toHaveURL(/[?&]mode=plan/);
  await expect(modeRadio(page, TWIN_MODE_PLAN_LABEL)).toHaveAttribute("aria-checked", "true");
  await expect(quickRail).toHaveCount(0);
  await expect(roomsTrigger).toHaveCount(0);
  await expect(dossier).toHaveCount(0);
  await expectLiveStage(page, "plan");

  // And back: walk is spelt by the ABSENCE of ?mode=, and its chrome returns.
  await modeRadio(page, TWIN_MODE_WALK_LABEL).click();
  await expect(page).not.toHaveURL(/[?&]mode=/);
  await expect(quickRail).toBeVisible();
  await expect(roomsTrigger).toBeVisible();
  await expect(dossier).toBeVisible();
  await expectLiveStage(page, "back in walk");

  expect(errors, "mode switching must not log an error").toEqual([]);
});

// — 4. The room selector. ————————————————————————————————————————————————————

test("the Rooms panel lists the published rooms, marks the one underfoot, and travels", async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  await openTour(page, "?node=scan_028");

  await page.getByTestId("twin-rooms-trigger").click();
  const panel = page.getByTestId("twin-rooms-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("role", "dialog");
  await expect(panel).toHaveAttribute("aria-modal", "true");

  // FOUR rooms, not five: the Grand Hall was validated from both ends and is
  // ONE room. The count is derived from the same frozen join the panel reads,
  // so a sixth validated viewpoint updates this expectation with the panel.
  expect(ROOM_SELECTOR_ORDER.length, "the validated join must publish four rooms").toBe(4);
  for (const slug of ROOM_SELECTOR_ORDER) {
    await expect(
      panel.getByText(ROOM_DISPLAY_NAMES[slug], { exact: true }),
      `the panel must name the ${ROOM_DISPLAY_NAMES[slug]}`,
    ).toBeVisible();
  }

  // The room underfoot is a statement, not a control: marked "You are here",
  // with pressable rows for the other three only (plus the close button).
  const here = panel.getByTestId("twin-rooms-here-grand-hall");
  await expect(here).toBeVisible();
  await expect(here).toContainText(ROOMS_HERE);
  await expect(here).toHaveAttribute("aria-current", "location");
  // Three travellable rooms plus the close button — the room underfoot is a
  // statement, so it is not a control at all, not a disabled one.
  await expect(panel.getByRole("button")).toHaveCount(ROOM_SELECTOR_ORDER.length);
  await expect(panel.getByTestId("twin-rooms-close")).toBeVisible();

  // Both storeys are named relationally — never by the scanner's own bucket.
  await expect(panel.getByTestId("twin-rooms-level")).toHaveText([
    ROOMS_LEVEL_HERE,
    ROOMS_LEVEL_ONE_BELOW,
  ]);

  // The Saloon row carries the venue's own figures, joined rather than
  // restated, and its accessible name splices that same string byte for byte.
  const saloonComparison = formatRoomComparison("scan_058");
  expect(saloonComparison, "the Saloon must publish a comparison line").not.toBeNull();
  if (saloonComparison === null) throw new Error("The Saloon publishes no figures to assert.");
  const saloonRow = panel.getByTestId("twin-rooms-row-saloon");
  await expect(saloonRow).toContainText(saloonComparison);
  await expect(saloonRow).toHaveAttribute(
    "aria-label",
    roomsRowLabel(ROOM_DISPLAY_NAMES.saloon, saloonComparison),
  );

  // Pressing it actually moves the visitor: the panel dismisses first, then the
  // Usher walks the real edge scan_028 → scan_058.
  await saloonRow.click();
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL(/[?&]node=scan_058/, { timeout: HOP_MS });
  await expect(page.getByTestId("twin-node-label")).toHaveText(
    twinNodeLabel("scan_058", VENUE_NAME),
    { timeout: HOP_MS },
  );

  // And the panel now says the Saloon is the room underfoot.
  await page.getByTestId("twin-rooms-trigger").click();
  await expect(page.getByTestId("twin-rooms-here-saloon")).toBeVisible();
  await expect(page.getByTestId("twin-rooms-here-grand-hall")).toHaveCount(0);

  expect(errors, "the Rooms panel must not log an error").toEqual([]);
});

// — 5. The truth rule, made executable. ——————————————————————————————————————

test("the dossier states the venue's own figures at a validated viewpoint", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await openTour(page, "?node=scan_028");

  const room = lookUpRoom("scan_028");
  expect(room, "scan_028 must be a validated viewpoint").not.toBeNull();
  if (room === null) throw new Error("scan_028 has no validated room to assert.");
  const dimensions = room.dimensions;
  expect(dimensions, "the Grand Hall must publish dimensions").not.toBeNull();
  if (dimensions === null) throw new Error("The Grand Hall publishes no dimensions.");

  const dossier = page.getByTestId("twin-room-dossier");
  await expect(dossier).toBeVisible();
  await expect(dossier.getByRole("heading", { name: room.name })).toBeVisible();
  await expect(dossier).toContainText(VENUE_NAME);

  // Every figure is JOINED from the venue-truth module through twin-rooms —
  // nothing here is a literal, which is what keeps the drift gate meaningful.
  const stats = await dossierStats(page);
  expect(stats[STAT_DIMENSIONS]).toBe(
    `${metres(dimensions.lengthM)} × ${metres(dimensions.widthM)} m`,
  );
  expect(stats[STAT_RECEPTION]).toBe(`${String(room.capacities.reception)} standing`);
  expect(stats[STAT_DINNER]).toBe(`${String(room.capacities.dinner)} seated`);
  // The dome qualifier is the single most-asked fact in the building, and its
  // separator is DOM text — "7 ma further…" is the failure this pins shut.
  const note = dimensions.note;
  expect(stats[STAT_CEILING]).toBe(
    note === undefined
      ? `${metres(dimensions.heightM)} m`
      : `${metres(dimensions.heightM)} m — ${note}`,
  );

  // Provenance travels with the figures, verbatim — the dossier's footnote IS
  // this constant, so a reworded claim about someone else's data fails here.
  await expect(dossier).toContainText(ROOM_TRUTH_PROVENANCE);

  expect(errors, "the dossier must not log an error").toEqual([]);
});

test("the tour says NOTHING about the room at an unvalidated viewpoint", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await openTour(page, "?node=scan_003");
  await expect(page.getByTestId("twin-node-label")).toHaveText(
    twinNodeLabel("scan_003", VENUE_NAME),
  );

  // No dossier at all — not an empty one, and not a hedged one. A labelled
  // blank is still a label.
  await expect(page.getByTestId("twin-room-dossier")).toHaveCount(0);

  // And no room name has leaked onto the glass by any other route.
  for (const slug of ROOM_SELECTOR_ORDER) {
    await expect(
      page.getByText(ROOM_DISPLAY_NAMES[slug], { exact: true }),
      `standing at scan_003 the tour must not name the ${ROOM_DISPLAY_NAMES[slug]}`,
    ).toHaveCount(0);
  }

  // The Rooms panel still OFFERS them — offering a room is not claiming to be
  // standing in one — but marks none of them as the room underfoot, and every
  // row is pressable because none is the statement row.
  await page.getByTestId("twin-rooms-trigger").click();
  const panel = page.getByTestId("twin-rooms-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByText(ROOMS_HERE)).toHaveCount(0);
  await expect(panel.getByRole("button")).toHaveCount(ROOM_SELECTOR_ORDER.length + 1);

  expect(errors, "an unvalidated viewpoint must not log an error").toEqual([]);
});

// — 6. Deep links. ———————————————————————————————————————————————————————————

test("a ?node= deep link lands on that viewpoint", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await openTour(page, "?node=scan_028");

  await expect(page.getByTestId("twin-node-label")).toHaveText(
    twinNodeLabel("scan_028", VENUE_NAME),
  );
  await expect(page).toHaveURL(/[?&]node=scan_028/);
  // The address KEEPS the short public form — /tour, never a venue-scoped path.
  expect(new URL(page.url()).pathname).toBe(TOUR_PATH);
  await expectLiveStage(page, "the deep-linked viewpoint");

  expect(errors, "a deep link must not log an error").toEqual([]);
});

test("a ?mode=dollhouse deep link opens in the dollhouse", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await openTour(page, "?node=scan_028&mode=dollhouse");

  await expect(modeRadio(page, TWIN_MODE_DOLLHOUSE_LABEL)).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("twin-quick-actions")).toHaveCount(0);
  await expect(page.getByTestId("twin-measure-trigger")).toBeVisible();
  await expectLiveStage(page, "the deep-linked dollhouse");

  expect(errors, "a mode deep link must not log an error").toEqual([]);
});

test("an unknown ?mode= clamps to the walk and canonicalises the URL", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await openTour(page, "?node=scan_028&mode=teleport");

  await expect(modeRadio(page, TWIN_MODE_WALK_LABEL)).toHaveAttribute("aria-checked", "true");
  // Walk is spelt by absence: the bad param is dropped and ?node= survives.
  await expect(page).not.toHaveURL(/[?&]mode=/);
  await expect(page).toHaveURL(/[?&]node=scan_028/);

  expect(errors, "a tampered mode must not log an error").toEqual([]);
});
