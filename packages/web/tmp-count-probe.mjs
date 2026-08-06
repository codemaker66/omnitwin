import { chromium } from "@playwright/test";
const API = "http://localhost:3001";
const ORIGIN = "http://127.0.0.1:4176";
const CONFIG_ID = "e2e-a1-config-001";
const V = { id: "e2e-venue-trades", name: "Trades Hall", slug: "trades-hall-glasgow", address: "85 Glassford Street", logoUrl: null, brandColour: null };
const G = { id: "e2e-space-grand", venueId: V.id, name: "Grand Hall", slug: "grand-hall", widthM: "21", lengthM: "10.5", heightM: "7", floorPlanOutline: [{x:0,y:0},{x:21,y:0},{x:21,y:10.5},{x:0,y:10.5}] };
const R = { id: "e2e-space-reception", venueId: V.id, name: "Reception Room", slug: "reception-room", widthM: "13.4", lengthM: "11.2", heightM: "3.2", floorPlanOutline: [{x:0,y:0},{x:13.4,y:0},{x:13.4,y:11.2},{x:0,y:11.2}] };
const C = { id: CONFIG_ID, spaceId: R.id, venueId: V.id, userId: null, name: "New Layout", isPublicPreview: true, revision: 1, objects: [] };
const AV = "10000000-0000-4000-8000-000000000003";
const CH = ["0_0.sog","0_1_0.sog","0_1_0_5.sog","0_6_0_0.sog","0_7_0_0.sog","0_15_0_0.sog","0_20_0.sog"];
const urls = CH.map((c) => `${ORIGIN}/splats/reception/${c}`);
const pkg = { id: "e2e-rp", venueSlug: "trades-hall", roomSlug: "reception-room", primaryVisualAssetVersionId: AV, semanticMeshAssetVersionId: null, collisionAssetVersionId: null, pointCloudAssetVersionId: null, manifestJson: { schemaVersion: "venviewer.runtime-package.v1", venueSlug: "trades-hall", roomSlug: "reception-room", packageType: "room-runtime", assets: { primaryVisualAssetVersionId: AV, semanticMeshAssetVersionId: null, collisionAssetVersionId: null, pointCloudAssetVersionId: null } }, evidenceStatus: "unverified", runtimeStatus: "internal_ready", createdAt: "2026-07-09T22:56:00.000Z", updatedAt: "2026-07-09T22:56:00.000Z", primaryVisualAssetUrl: urls[0], visualAssetUrls: urls, primaryVisualAssetVersion: { id: AV, venueSlug: "trades-hall", roomSlug: "reception-room", captureSessionId: null, assetKind: "splat", sourceType: "xgrids", fileName: "0_0.sog", fileExt: ".sog", r2Key: "k", externalUrl: null, mimeType: "application/octet-stream", sha256: "a".repeat(64), sizeBytes: 9017864, evidenceStatus: "unverified", runtimeStatus: "usable", notes: null, createdAt: "2026-07-09T22:56:00.000Z", updatedAt: "2026-07-09T22:56:00.000Z" } };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log(`[pageerror] ${String(e).slice(0, 300)}`));
page.on("console", (m) => { if (m.type() === "error") console.log(`[console:error] ${m.text().slice(0, 300)}`); });

await page.route(`${API}/venues`, (r) => r.fulfill({ json: { data: [V] } }));
await page.route(`${API}/venues/${V.id}/spaces`, (r) => r.fulfill({ json: { data: [G, R] } }));
await page.route(`${API}/public/configurations`, (r) => r.fulfill({ json: { data: C } }));
await page.route(`${API}/public/configurations/${CONFIG_ID}`, (r) => r.fulfill({ json: { data: C } }));
await page.route(`${API}/venues/${V.id}/spaces/${R.id}`, (r) => r.fulfill({ json: { data: R } }));
await page.route(`${API}/truth-mode/summary*`, (r) => r.fulfill({ json: { data: { targetType: "configuration", targetId: CONFIG_ID, source: "s", confidence: "unknown", assumption: "a", evidenceStatus: "not_checked", reviewGate: "g", staleState: "unknown", safeWording: ["w"], humanReviewRequired: true, counts: { evidenceItems: 0, checkResults: 0, assumptions: 0, reviewGates: 0, staleEvents: 0 } } } }));
await page.route(`${API}/assets/runtime-packages/latest*`, (r) => r.fulfill({ json: { data: pkg } }));

await page.goto(`${ORIGIN}/plan`);
let prev = "";
for (let t = 1; t <= 45; t++) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => {
    const stages = document.querySelectorAll(".cockpit-stage");
    const phases = Array.from(stages).map((el) => el.getAttribute("data-resolve-phase")).join(",");
    return JSON.stringify({
      url: location.pathname,
      stages: stages.length,
      phases,
      canvases: document.querySelectorAll("canvas").length,
      shells: document.querySelectorAll('[data-testid="cockpit-shell"]').length,
      hosts: document.querySelectorAll(".planner-scene-canvas-host").length,
    });
  }).catch((e) => `evalfail:${String(e).slice(0, 80)}`);
  if (s !== prev) { console.log(`[t+${t}s] ${s}`); prev = s; }
}
await browser.close();
