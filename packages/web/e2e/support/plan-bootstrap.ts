import { expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Shared /plan bootstrap stubs for the CARD A1/A2 planner e2e specs.
//
// Stubs the full anonymous-draft chain (venues → spaces → config create/load →
// space fetch → truth-mode) so the planner boots with no live backend. The
// runtime-package endpoint is deliberately NOT stubbed here — each spec picks
// its own state (404 fallback, empty, or a package streaming the REAL
// Reception Room SOG chunks served from public/splats/reception/).
// ---------------------------------------------------------------------------

export const API = "http://localhost:3001";
export const CONFIG_ID = "e2e-a1-config-001";
export const ASSET_VERSION_ID = "10000000-0000-4000-8000-000000000003";

export const VENUE = {
  id: "e2e-venue-trades",
  name: "Trades Hall",
  slug: "trades-hall-glasgow",
  address: "85 Glassford Street",
  logoUrl: null,
  brandColour: null,
} as const;

export const GRAND_HALL_SPACE = {
  id: "e2e-space-grand",
  venueId: VENUE.id,
  name: "Grand Hall",
  slug: "grand-hall",
  widthM: "21",
  lengthM: "10.5",
  heightM: "7",
  floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }],
} as const;

export const RECEPTION_ROOM_SPACE = {
  id: "e2e-space-reception",
  venueId: VENUE.id,
  name: "Reception Room",
  slug: "reception-room",
  widthM: "13.4",
  lengthM: "11.2",
  heightM: "3.2",
  floorPlanOutline: [{ x: 0, y: 0 }, { x: 13.4, y: 0 }, { x: 13.4, y: 11.2 }, { x: 0, y: 11.2 }],
} as const;

export const PLAN_CONFIG = {
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
export const RECEPTION_SOG_CHUNKS = [
  "0_0.sog",
  "0_1_0.sog",
  "0_1_0_5.sog",
  "0_6_0_0.sog",
  "0_7_0_0.sog",
  "0_15_0_0.sog",
  "0_20_0.sog",
] as const;

export const ATELIER_FALLBACK_COPY =
  "Captured visual layer not yet available — planning on reviewed geometry";
export const LOADED_EVIDENCE_COPY = "Runtime asset loaded, not yet verified/signed.";

export function receptionRuntimePackage(origin: string): Record<string, unknown> {
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

/**
 * Settles the cockpit to a single mounted shell + canvas before capturing
 * evidence. On the local preview build a Clerk-JS failure flip can remount
 * the planner tree once (~15 s in — pre-existing app behavior, tracked as a
 * follow-up); screenshots taken inside that window come back blank.
 */
export async function settleCockpit(page: Page): Promise<void> {
  await expect
    .poll(
      () => page.evaluate(() => {
        const shells = document.querySelectorAll('[data-testid="cockpit-shell"]').length;
        const canvases = document.querySelectorAll("canvas").length;
        return `${String(shells)}|${String(canvases)}`;
      }),
      { timeout: 60_000, message: "waiting for a single settled cockpit shell + canvas" },
    )
    .toBe("1|1");
}

export async function stubPlannerBootstrap(page: Page): Promise<void> {
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
