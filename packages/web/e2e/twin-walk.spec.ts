import { expect, test, type Page, type Route } from "@playwright/test";
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
// default, matching the production pipeline — and every tile request
// (equirect_512/equirect_4096 panos here; face tiles on the legacy test) is
// answered with the same 1×1 WebP, so the suite needs no real capture data
// and no twin-forge output on disk. One test re-routes the cube-faces
// manifest to keep the legacy bundle path rendering.
//
// Keyboard reachability is asserted on the minimap listbox (arrows + Enter):
// the gold nav rings live inside the WebGL canvas and are not DOM-reachable,
// so the minimap options are the twin's accessible navigation path.
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

const VENUE_NAME = TWIN_FIXTURE_MANIFEST_EQUIRECT.name;

const TILE_BYTES = Buffer.from(
  TWIN_FIXTURE_TILE_DATA_URI.slice(TWIN_FIXTURE_TILE_DATA_URI.indexOf(",") + 1),
  "base64",
);

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

test.beforeEach(async ({ page }) => {
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

test("a minimap hop lands on scan_001 and records it in the URL", async ({ page }) => {
  await openTwin(page);

  await page.getByRole("option", { name: "Go to scan 1" }).click();

  // Ceiling allows a full hop spring to settle, with slack to spare.
  await expect(page).toHaveURL(/[?&]node=scan_001/, { timeout: 4_000 });
  await expect(page.getByTestId("twin-node-label")).toHaveText(
    twinNodeLabel("scan_001", VENUE_NAME),
  );
});

test("reduced motion swaps nodes instantly instead of springing", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTwin(page);

  await page.getByRole("option", { name: "Go to scan 1" }).click();

  // Instant swap: no spring window — URL and HUD must change immediately.
  await expect(page).toHaveURL(/[?&]node=scan_001/, { timeout: 1_000 });
  await expect(page.getByTestId("twin-node-label")).toHaveText(
    twinNodeLabel("scan_001", VENUE_NAME),
    { timeout: 1_000 },
  );
});

test("the browser back button walks backward to scan_000", async ({ page }) => {
  await openTwin(page);
  // The walk canonicalises the bare URL to the node underfoot on load.
  await expect(page).toHaveURL(/[?&]node=scan_000/);

  await page.getByRole("option", { name: "Go to scan 1" }).click();
  await expect(page).toHaveURL(/[?&]node=scan_001/, { timeout: 4_000 });

  await page.goBack();
  await expect(page).toHaveURL(/[?&]node=scan_000/);
  await expect(page.getByTestId("twin-node-label")).toHaveText(
    twinNodeLabel("scan_000", VENUE_NAME),
  );
});

test("the minimap listbox walks by keyboard: arrows move, Enter travels", async ({ page }) => {
  await openTwin(page);

  const listbox = page.getByRole("listbox", { name: "Scan positions" });
  await listbox.focus();

  // ArrowRight from scan_000 selects its nearest rightward node, scan_001.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("option", { name: "Go to scan 1" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/[?&]node=scan_001/);
  await expect(page.getByTestId("twin-node-label")).toHaveText(
    twinNodeLabel("scan_001", VENUE_NAME),
  );

  // ArrowDown from the junction selects the branch node, scan_003.
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Go to scan 3" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/[?&]node=scan_003/);
  await expect(page.getByTestId("twin-node-label")).toHaveText(
    twinNodeLabel("scan_003", VENUE_NAME),
  );
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
