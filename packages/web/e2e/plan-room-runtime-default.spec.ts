import { test, expect, type Page, type TestInfo } from "@playwright/test";

const API = "http://localhost:3001";
const CONFIG_ID = "e2e-a1-config-001";
const ASSET_VERSION_ID = "10000000-0000-4000-8000-000000000003";

// ---------------------------------------------------------------------------
// E2E: CARD A1 (G1a) — Reception Room runtime default-on
//
// /plan with no config id must bootstrap an anonymous draft into the
// Reception Room (the one room with a built runtime package) and surface an
// honest runtime chip in the cockpit top bar:
//   - package resolves  → evidence-state label + Spark splat layer mounting
//     the REAL captured chunks served from public/splats/reception/
//   - package endpoint 404s → atelier fallback (procedural clay + ink room)
//     with the designed fallback copy. Never a blank canvas.
//
// The API is fully stubbed (page.route) so this spec needs no live backend;
// the splat bytes are the real captured SOG chunks served by Vite.
// ---------------------------------------------------------------------------

const VENUE = {
  id: "e2e-venue-trades",
  name: "Trades Hall",
  slug: "trades-hall-glasgow",
  address: "85 Glassford Street",
  logoUrl: null,
  brandColour: null,
} as const;

const GRAND_HALL_SPACE = {
  id: "e2e-space-grand",
  venueId: VENUE.id,
  name: "Grand Hall",
  slug: "grand-hall",
  widthM: "21",
  lengthM: "10.5",
  heightM: "7",
  floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }],
} as const;

const RECEPTION_ROOM_SPACE = {
  id: "e2e-space-reception",
  venueId: VENUE.id,
  name: "Reception Room",
  slug: "reception-room",
  widthM: "13.4",
  lengthM: "11.2",
  heightM: "3.2",
  floorPlanOutline: [{ x: 0, y: 0 }, { x: 13.4, y: 0 }, { x: 13.4, y: 11.2 }, { x: 0, y: 11.2 }],
} as const;

const PLAN_CONFIG = {
  id: CONFIG_ID,
  spaceId: RECEPTION_ROOM_SPACE.id,
  venueId: VENUE.id,
  userId: null,
  name: "New Layout",
  isPublicPreview: true,
  revision: 1,
  objects: [],
} as const;

// The real captured Reception Room runtime chunks (63 MB total) shipped in
// public/splats/reception/. env.sog is the environment shell, not the room.
const RECEPTION_SOG_CHUNKS = [
  "0_0.sog",
  "0_1_0.sog",
  "0_1_0_5.sog",
  "0_6_0_0.sog",
  "0_7_0_0.sog",
  "0_15_0_0.sog",
  "0_20_0.sog",
] as const;

const ATELIER_FALLBACK_COPY =
  "Captured visual layer not yet available — planning on reviewed geometry";
const LOADED_EVIDENCE_COPY = "Runtime asset loaded, not yet verified/signed.";

function receptionRuntimePackage(origin: string): Record<string, unknown> {
  const chunkUrls = RECEPTION_SOG_CHUNKS.map((chunk) => `${origin}/splats/reception/${chunk}`);
  return {
    id: "e2e-runtime-package-reception",
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    primaryVisualAssetVersionId: ASSET_VERSION_ID,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId: ASSET_VERSION_ID,
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
    },
    evidenceStatus: "unverified",
    runtimeStatus: "internal_ready",
    createdAt: "2026-07-09T22:56:00.000Z",
    updatedAt: "2026-07-09T22:56:00.000Z",
    primaryVisualAssetUrl: chunkUrls[0],
    visualAssetUrls: chunkUrls,
    primaryVisualAssetVersion: {
      id: ASSET_VERSION_ID,
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      captureSessionId: null,
      assetKind: "splat",
      sourceType: "xgrids",
      fileName: "0_0.sog",
      fileExt: ".sog",
      r2Key: "venues/trades-hall/rooms/reception-room/xgrids/0_0.sog",
      externalUrl: null,
      mimeType: "application/octet-stream",
      sha256: "a".repeat(64),
      sizeBytes: 9017864,
      evidenceStatus: "unverified",
      runtimeStatus: "usable",
      notes: null,
      createdAt: "2026-07-09T22:56:00.000Z",
      updatedAt: "2026-07-09T22:56:00.000Z",
    },
  };
}

async function stubPlannerBootstrap(page: Page): Promise<void> {
  await page.route(`${API}/venues`, (route) => {
    void route.fulfill({ json: { data: [VENUE] } });
  });
  await page.route(`${API}/venues/${VENUE.id}/spaces`, (route) => {
    void route.fulfill({ json: { data: [GRAND_HALL_SPACE, RECEPTION_ROOM_SPACE] } });
  });
  await page.route(`${API}/public/configurations`, (route) => {
    void route.fulfill({ json: { data: PLAN_CONFIG } });
  });
  await page.route(`${API}/public/configurations/${CONFIG_ID}`, (route) => {
    void route.fulfill({ json: { data: PLAN_CONFIG } });
  });
  await page.route(`${API}/venues/${VENUE.id}/spaces/${RECEPTION_ROOM_SPACE.id}`, (route) => {
    void route.fulfill({ json: { data: RECEPTION_ROOM_SPACE } });
  });
  await page.route(`${API}/truth-mode/summary*`, (route) => {
    void route.fulfill({
      json: {
        data: {
          targetType: "configuration",
          targetId: CONFIG_ID,
          source: "Planning context - not a measured source of record",
          confidence: "unknown",
          assumption: "Human review required before reliance",
          evidenceStatus: "not_checked",
          reviewGate: "Human review required",
          staleState: "unknown",
          safeWording: ["Planning evidence - human review required before operational reliance."],
          humanReviewRequired: true,
          counts: { evidenceItems: 0, checkResults: 0, assumptions: 0, reviewGates: 0, staleEvents: 0 },
        },
      },
    });
  });
}

async function attachCardScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(name);
  const screenshot = await page.screenshot({ path, fullPage: false });
  expect(screenshot.byteLength).toBeGreaterThan(15_000);
  await testInfo.attach(name, { body: screenshot, contentType: "image/png" });
}

async function attachCanvasScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(name);
  const screenshot = await page.locator("canvas").screenshot({ path });
  expect(screenshot.byteLength).toBeGreaterThan(10_000);
  await testInfo.attach(name, { body: screenshot, contentType: "image/png" });
}

test.describe("CARD A1: /plan Reception Room runtime default", () => {
  // Laptop-class evidence viewport. The runtime chip must be VISIBLE here,
  // not merely present in the DOM (it truncates, never hides — CARD A1).
  test.use({ viewport: { width: 1440, height: 900 } });

  test("atelier fallback: package endpoint 404 → honest chip over the procedural room", async ({ page }, testInfo) => {
    await stubPlannerBootstrap(page);
    // The card's verification asks for the package URL stubbed to a hard 404,
    // not the API's graceful `{ data: null }` empty result.
    await page.route(`${API}/assets/runtime-packages/latest*`, (route) => {
      void route.fulfill({ status: 404, json: { error: "runtime package not found" } });
    });

    const startedAt = Date.now();
    await page.goto("/plan");

    const topbar = page.getByTestId("cockpit-topbar");
    await expect(topbar).toBeVisible({ timeout: 15_000 });
    const runtimeChip = page.getByTestId("cockpit-runtime-chip");
    await expect(runtimeChip).toBeVisible();
    await expect(runtimeChip).toContainText(ATELIER_FALLBACK_COPY);
    await expect(page.locator("canvas")).toBeVisible();
    const interactiveMs = Date.now() - startedAt;

    // 01 §17/§21.1 budget is < 1.5 s on the reference laptop with cached
    // manifests. This local gate is deliberately loose (bootstrap includes
    // anonymous draft creation + navigation); the measured figure is logged
    // for the card's DoD evidence rather than hard-gated here.
    expect(interactiveMs).toBeLessThan(15_000);
    console.log(`[CARD-A1] fallback: chip + interactive canvas in ${String(interactiveMs)}ms`);

    // The bootstrap must have landed in the Reception Room, and the chip
    // must never claim a captured layer that is not there.
    await expect(topbar).toContainText("Reception Room");
    await expect(topbar).not.toContainText(LOADED_EVIDENCE_COPY);

    await attachCardScreenshot(page, testInfo, "card-a1-atelier-fallback.png");
    await attachCanvasScreenshot(page, testInfo, "card-a1-atelier-fallback-canvas.png");
  });

  test("loaded: runtime package resolves → real captured chunks stream with the evidence chip", async ({ page, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const origin = baseURL ?? "http://localhost:5173";
    const sogResponses = new Set<string>();
    page.on("response", (response) => {
      const url = response.url();
      if (url.includes("/splats/reception/") && response.status() === 200) {
        sogResponses.add(url);
      }
    });

    await stubPlannerBootstrap(page);
    await page.route(`${API}/assets/runtime-packages/latest*`, (route) => {
      void route.fulfill({ json: { data: receptionRuntimePackage(origin) } });
    });

    await page.goto("/plan");

    const topbar = page.getByTestId("cockpit-topbar");
    await expect(topbar).toBeVisible({ timeout: 15_000 });
    await expect(topbar).toContainText("Reception Room");
    // Chip flips to the evidence-state label as soon as the package resolves —
    // and it must be visible, not merely present in the DOM.
    const runtimeChip = page.getByTestId("cockpit-runtime-chip");
    await expect(runtimeChip).toBeVisible();
    await expect(runtimeChip).toContainText(LOADED_EVIDENCE_COPY, { timeout: 10_000 });

    // All seven real room chunks must actually stream (63 MB from the local
    // static server) — this is the built runtime, not a fixture.
    await expect
      .poll(() => sogResponses.size, { timeout: 120_000, message: "waiting for all Reception Room SOG chunks" })
      .toBeGreaterThanOrEqual(RECEPTION_SOG_CHUNKS.length);

    // Give Spark a settle window to decode + paint the streamed gaussians
    // before capturing evidence (frameloop is demand-driven).
    await page.waitForTimeout(6_000);
    await expect(page.locator("canvas")).toBeVisible();

    await attachCardScreenshot(page, testInfo, "card-a1-loaded-room.png");
    await attachCanvasScreenshot(page, testInfo, "card-a1-loaded-room-canvas.png");
  });
});
