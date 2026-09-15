import { expect, test, type Page, type Route } from "@playwright/test";
import { TwinManifestSchema, type TwinManifest } from "@omnitwin/types";
import { ROOM_DISPLAY_NAMES, VERIFIED_ROOM_NODES } from "../src/twin/shell/twin-rooms.js";
import {
  TWIN_FIXTURE_MANIFEST,
  TWIN_FIXTURE_MANIFEST_EQUIRECT,
  TWIN_FIXTURE_TILE_DATA_URI,
} from "../src/twin/__fixtures__/twin-fixture.js";
import {
  TWIN_DISCLOSURE,
  TWIN_ERROR_LINE,
  TWIN_RETRY_LABEL,
  TWIN_TITLE,
  twinNodeLabel,
} from "../src/twin/twin-copy.js";

// ---------------------------------------------------------------------------
// The Twin — walk e2e (Twin Phase 1, Task 11; equirect era 2026-07-04).
//
// Every request the viewer makes is fixture-mocked via page.route: the
// manifest is the four-node twin-fixture bundle — the EQUIRECT variant by
// default, matching the production pipeline (lods [512, 4096, 8192]; the
// 8192 zoom tier is on-demand and never requested here — no test zooms
// below the 50° fov trigger) — and every tile request (equirect panos here;
// face tiles on the legacy test) is answered with the same 1×1 WebP, so the
// suite needs no real capture data and no twin-forge output on disk. One
// test re-routes the cube-faces manifest to keep the legacy bundle path
// rendering.
//
// Keyboard reachability follows the native Rooms dialog (Tab, Enter, Space,
// Escape). The minimap was retired; validated room names are now the accessible
// navigation path. Only navigation tests use a synthetic graph joining those
// validated IDs. Neither graph poses nor fixture pixels claim capture fidelity.
// Google Fonts stylesheets are fulfilled empty: this offline functional suite
// uses fallback fonts and does not qualify production webfont loading.
//
// Console collection only fails on type "error" — headless Chromium logs its
// software-WebGL fallback notices as type "warning", which is expected here.
//
// Conventions follow landing-rite-responsive.spec.ts (viewport sweep, overflow
// helper, runtime error collection). Reuses the running dev server via
// playwright.config.ts. Plan: docs/superpowers/plans/2026-07-02-twin-phase1-walk.md.
// ---------------------------------------------------------------------------

const TWIN_PATH = "/venues/trades-hall/twin";
const MANIFEST_ROUTE = "**/twin/trades-hall/manifest.json";
const TILE_ROUTE = "**/twin/trades-hall/tiles/**";
const MESH_ROUTE = "**/twin/trades-hall/mesh/dollhouse.glb";

const VENUE_NAME = TWIN_FIXTURE_MANIFEST_EQUIRECT.name;

// One viewpoint per validated room, joined from the same oracle as the UI.
// The straight-line graph is synthetic and deliberately contains no roomSlug.
const NAVIGATION_IDS = Object.keys(VERIFIED_ROOM_NODES).sort().filter(
  (id, index, ids) => ids.findIndex(
    (candidate) => VERIFIED_ROOM_NODES[candidate] === VERIFIED_ROOM_NODES[id],
  ) === index,
);
function navigationId(slug: string): string {
  const id = NAVIGATION_IDS.find((candidate) => VERIFIED_ROOM_NODES[candidate] === slug);
  if (id === undefined) throw new Error(`No validated fixture viewpoint for ${slug}`);
  return id;
}
const ENTRY_ID = navigationId("grand-hall");
const SALOON_ID = navigationId("saloon");
const ROBERT_ADAM_ID = navigationId("robert-adam-room");
const NAVIGATION_MANIFEST: TwinManifest = TwinManifestSchema.parse({
  ...TWIN_FIXTURE_MANIFEST_EQUIRECT,
  entryNodeId: ENTRY_ID,
  nodes: NAVIGATION_IDS.map((id, index) => ({
    id, index, floor: 0,
    pose: { q: [1, 0, 0, 0], t: [index * 2.5, 0, 1.5] },
    roomSlug: null,
  })),
  edges: NAVIGATION_IDS.slice(1).map((id, index) => ({
    a: NAVIGATION_IDS[index] ?? id, b: id, distanceM: 2.5,
  })),
});


const TILE_BYTES = Buffer.from(
  TWIN_FIXTURE_TILE_DATA_URI.slice(TWIN_FIXTURE_TILE_DATA_URI.indexOf(",") + 1),
  "base64",
);

/** A valid GLB 2.0 scene with no geometry, used to exercise mesh warm-up. */
function minimalGlbBytes(): Buffer {
  const json = Buffer.from(JSON.stringify({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{}],
  }), "utf8");
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

interface ViewportSpec {
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

const VIEWPORTS: readonly ViewportSpec[] = [
  { label: "320x568 phone", width: 320, height: 568 },
  { label: "390x844 phone", width: 390, height: 844 },
  { label: "768x1024 tablet portrait", width: 768, height: 1024 },
  { label: "1280x800 desktop", width: 1280, height: 800 },
  { label: "2048x1000 desktop", width: 2048, height: 1000 },
];

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "the twin must never overflow horizontally").toBeLessThanOrEqual(1);
}

/**
 * Open the twin and wait for the viewer HUD. The generous timeout absorbs the
 * dev server's cold on-demand transform of the three/R3F chunk on first hit.
 */
async function openTwin(page: Page): Promise<void> {
  await page.goto(TWIN_PATH);
  await expect(page.getByTestId("twin-node-label")).toBeVisible({ timeout: 15_000 });
}

async function openNavigationTwin(page: Page): Promise<void> {
  await page.route(MANIFEST_ROUTE, (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(NAVIGATION_MANIFEST),
  }));
  await page.goto(`${TWIN_PATH}?node=${ENTRY_ID}`);
  await expect(page.getByTestId("twin-node-label")).toHaveText(
    twinNodeLabel(ENTRY_ID, VENUE_NAME), { timeout: 15_000 },
  );
  await expect(page.getByTestId("twin-load-shimmer")).toHaveCount(0);
}

function saloonButton(page: Page) {
  return page.getByRole("button", { name: new RegExp(`^Walk to ${ROOM_DISPLAY_NAMES.saloon}`) });
}

async function walkToSaloon(page: Page): Promise<void> {
  await page.getByTestId("twin-rooms-trigger").click();
  await saloonButton(page).click();
}

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "/* Offline functional fixture. */" }),
  );
  await page.route(MANIFEST_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(TWIN_FIXTURE_MANIFEST_EQUIRECT),
    }),
  );
  await page.route(TILE_ROUTE, (route) =>
    route.fulfill({ status: 200, contentType: "image/webp", body: TILE_BYTES }),
  );
  await page.route(MESH_ROUTE, (route) =>
    route.fulfill({ status: 200, contentType: "model/gltf-binary", body: MESH_BYTES }),
  );
});

test("the twin renders scan_000 with its named landmark, one disclosure, and no errors", async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  await openTwin(page);

  await expect(page).toHaveTitle(TWIN_TITLE);
  await expect(page.getByRole("main", { name: TWIN_TITLE })).toBeVisible();
  await expect(page.getByTestId("twin-stage")).toBeVisible();
  await expect(page.getByTestId("twin-node-label")).toHaveText(
    twinNodeLabel("scan_000", VENUE_NAME),
  );
  await expect(page.getByText(TWIN_DISCLOSURE)).toHaveCount(1);
  await expect(page.getByText(TWIN_DISCLOSURE)).toBeVisible();

  expect(errors).toEqual([]);
});

test("a named-room hop lands at its validated viewpoint and records it in the URL", async ({ page }) => {
  await openNavigationTwin(page);
  await walkToSaloon(page);

  await expect(page).toHaveURL(new RegExp(`[?&]node=${SALOON_ID}`), { timeout: 4_000 });
  await expect(page.getByTestId("twin-node-label")).toHaveText(twinNodeLabel(SALOON_ID, VENUE_NAME));
  await expect(page.getByTestId("twin-rooms-panel")).toHaveCount(0);
});

test("reduced motion swaps named rooms instantly instead of springing", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openNavigationTwin(page);
  await walkToSaloon(page);

  // Keep the original instant-swap ceiling; native room travel must not spring.
  await expect(page).toHaveURL(new RegExp(`[?&]node=${SALOON_ID}`), { timeout: 1_000 });
  await expect(page.getByTestId("twin-node-label")).toHaveText(
    twinNodeLabel(SALOON_ID, VENUE_NAME), { timeout: 1_000 },
  );
});

test("the browser back button returns to the previous validated room", async ({ page }) => {
  await openNavigationTwin(page);
  await expect(page).toHaveURL(new RegExp(`[?&]node=${ENTRY_ID}`));
  await walkToSaloon(page);
  await expect(page).toHaveURL(new RegExp(`[?&]node=${SALOON_ID}`), { timeout: 4_000 });

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`[?&]node=${ENTRY_ID}`));
  await expect(page.getByTestId("twin-node-label")).toHaveText(twinNodeLabel(ENTRY_ID, VENUE_NAME));
});

test("the native Rooms dialog supports Tab, Space, Enter, Escape and return focus", async ({ page }) => {
  await openNavigationTwin(page);
  const trigger = page.getByTestId("twin-rooms-trigger");
  const heading = page.getByRole("heading", { name: "Rooms", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(heading).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("twin-rooms-close")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(saloonButton(page)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page).toHaveURL(new RegExp(`[?&]node=${SALOON_ID}`), { timeout: 4_000 });
  await expect(page.getByTestId("twin-node-label")).toHaveText(twinNodeLabel(SALOON_ID, VENUE_NAME));
  await expect(trigger).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(heading).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("twin-rooms-panel")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`[?&]node=${SALOON_ID}`));

  await page.keyboard.press("Space");
  await expect(heading).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("twin-rooms-row-grand-hall")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("twin-rooms-row-robert-adam-room")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`[?&]node=${ROBERT_ADAM_ID}`), { timeout: 4_000 });
  await expect(page.getByTestId("twin-node-label")).toHaveText(twinNodeLabel(ROBERT_ADAM_ID, VENUE_NAME));
  await expect(trigger).toBeFocused();
});

for (const viewport of VIEWPORTS) {
  test(`the twin holds its composition at ${viewport.label}`, async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openTwin(page);

    await expect(page.getByText(TWIN_DISCLOSURE)).toBeVisible();
    await expectNoHorizontalOverflow(page);

    expect(errors).toEqual([]);
  });
}

test("a legacy cube-faces bundle still renders (imagery default path)", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  // Override the equirect default with the original cube-faces fixture — the
  // manifest carries no imagery field, so the schema default must route the
  // viewer down the FACE_TO_CUBE path, streaming face_256/face_1024 tiles.
  await page.route(MANIFEST_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(TWIN_FIXTURE_MANIFEST),
    }),
  );

  await openTwin(page);
  await expect(page.getByTestId("twin-node-label")).toHaveText(
    twinNodeLabel("scan_000", VENUE_NAME),
  );
  expect(errors).toEqual([]);
});

test("a manifest failure shows the calm error line, and retry recovers", async ({ page }) => {
  const failManifest = (route: Route): Promise<void> =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "twin bundle unavailable" }),
    });
  await page.route(MANIFEST_ROUTE, failManifest);

  await page.goto(TWIN_PATH);
  // Dev builds always report the honest error line; the TWIN_PREPARING_LINE
  // posture applies only to production on the default asset base (Task 12).
  await expect(page.getByText(TWIN_ERROR_LINE)).toBeVisible({ timeout: 15_000 });

  const retry = page.getByRole("button", { name: TWIN_RETRY_LABEL });
  await expect(retry).toBeVisible();

  // Lift only the failure handler; the beforeEach fixture route takes over.
  await page.unroute(MANIFEST_ROUTE, failManifest);
  await retry.click();

  await expect(page.getByTestId("twin-node-label")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("twin-node-label")).toHaveText(
    twinNodeLabel("scan_000", VENUE_NAME),
  );
});
