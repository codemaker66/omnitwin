// ---------------------------------------------------------------------------
// twin-visual-check — screenshot pass for the Twin walkthrough (Phase 1).
// Standalone Playwright, same pattern as rite-visual-check.mjs. Needs the web
// dev server on 5173 AND the forged bundle at public/twin/trades-hall
// (skips gracefully when the bundle is absent — CI machines don't carry it).
//
// Usage: node scripts/twin-visual-check.mjs
// Env:   OUT_DIR (screenshot dir), BASE_URL (default http://localhost:5173)
//
// The scan_000 captures double as the FACE_TO_CUBE calibration reference:
// compare against F:\...\E57\panoramas\scan_000.jpg — doorways must sit where
// the pano shows them and plaque text must not be mirrored.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const OUT = process.env.OUT_DIR ?? "twin-shots";

const bundleManifest = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "public", "twin", "trades-hall", "manifest.json",
);
if (!existsSync(bundleManifest)) {
  console.log(JSON.stringify({
    ok: true,
    skipped: true,
    reason: `no local twin bundle at ${bundleManifest} — run twin-forge first`,
  }));
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
const report = { ok: false, steps: [], errors: [] };

/** Drag horizontally across the canvas to rotate the view by roughly 90°. */
async function dragLook(page, dxPixels) {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("no canvas box");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // Several small moves so pointermove deltas accumulate through the spring.
  const steps = 12;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(cx + (dxPixels * i) / steps, cy, { steps: 1 });
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(1400); // spring settle
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => report.errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") report.errors.push(`console: ${m.text()}`);
  });

  await page.goto(`${BASE}/venues/trades-hall/twin?node=scan_000`, {
    waitUntil: "domcontentloaded", timeout: 60000,
  });
  await page.getByTestId("twin-node-label").waitFor({ timeout: 30000 });
  await page.waitForTimeout(4000); // 1024 LOD faces land
  await page.screenshot({ path: join(OUT, "twin-01-scan000-forward.png") });
  report.steps.push("scan_000 forward (calibration reference)");

  await dragLook(page, -520);
  await page.screenshot({ path: join(OUT, "twin-02-scan000-right.png") });
  report.steps.push("scan_000 rotated right");

  await dragLook(page, -520);
  await page.screenshot({ path: join(OUT, "twin-03-scan000-back.png") });
  report.steps.push("scan_000 rotated back");

  // Look up — the coffered ceiling must flow continuously into all four
  // walls (no crown up here since the 2026-07-04 chirality/cap fix).
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (box !== null) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) {
      await page.mouse.move(cx, cy + (420 * i) / 12, { steps: 1 });
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(1400);
  }
  await page.screenshot({ path: join(OUT, "twin-04-scan000-zenith-crown.png") });
  report.steps.push("zenith ceiling continuity");

  // Look down — swing from the zenith through level to the nadir: the green
  // crown caps the tripod's blind spot and the floor around it must read as
  // a coherent floor view, not a twisted one.
  if (box !== null) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) {
      await page.mouse.move(cx, cy + (-840 * i) / 12, { steps: 1 });
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(1400);
  }
  await page.screenshot({ path: join(OUT, "twin-05-scan000-nadir-floor.png") });
  report.steps.push("nadir floor (tripod crown)");

  // Text chirality EYE GATE (no automated assert): scan_039, turn left to the
  // Coopers memorial window, zoom to min fov. Reviewers MUST verify the etched
  // text ("…leading the procession to the new Trades Hall at the official
  // opening on 15th September 1794") reads LEFT-TO-RIGHT with upright letters.
  // Mirrored text here means the PanoStage handedness fix (scanner-y negation
  // in the sampling direction) has regressed — see twin-basis.ts FACE_TO_CUBE.
  await page.goto(`${BASE}/venues/trades-hall/twin?node=scan_039`, {
    waitUntil: "domcontentloaded", timeout: 60000,
  });
  await page.getByTestId("twin-node-label").waitFor({ timeout: 30000 });
  await page.waitForTimeout(4000); // 1024 LOD faces land
  await dragLook(page, 520); // face the etched window (left of pose forward)
  const chiralityBox = await page.locator("canvas").first().boundingBox();
  if (chiralityBox !== null) {
    const chiralityX = chiralityBox.x + chiralityBox.width / 2;
    const chiralityY = chiralityBox.y + chiralityBox.height / 2;
    await page.mouse.move(chiralityX, chiralityY);
    for (let i = 0; i < 5; i += 1) {
      await page.mouse.wheel(0, -200); // zoom in; -1000 total clamps at MIN_FOV
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(1500); // fov spring settle
  }
  await page.screenshot({ path: join(OUT, "twin-12-text-chirality.png") });
  report.steps.push("text chirality eye gate (scan_039 etched window, min fov)");

  // Reset view, then hop: click the first minimap option that is not the
  // current node (the minimap exposes role="option" dots; the current node is
  // the one carrying aria-selected="true"). Keep the mid-hop capture timing.
  await page.goto(`${BASE}/venues/trades-hall/twin?node=scan_000`, {
    waitUntil: "domcontentloaded", timeout: 60000,
  });
  await page.getByTestId("twin-node-label").waitFor({ timeout: 30000 });
  await page.waitForTimeout(3000);
  const beforeUrl = page.url();
  const hopDot = page.locator('[role="option"][aria-selected="false"]').first();
  await hopDot.click({ timeout: 5000 });
  await page.waitForTimeout(450);
  await page.screenshot({ path: join(OUT, "twin-06-mid-hop.png") });
  await page.waitForTimeout(2200);
  if (page.url() === beforeUrl) {
    report.errors.push("hop did not change the ?node param");
  }
  await page.screenshot({ path: join(OUT, "twin-07-after-hop.png") });
  report.steps.push(`hop (url ${page.url().split("?")[1] ?? "?"})`);

  // Minimap open state + mobile.
  await page.screenshot({ path: join(OUT, "twin-08-minimap.png") });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(`${BASE}/venues/trades-hall/twin`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await mobile.getByTestId("twin-node-label").waitFor({ timeout: 30000 });
  await mobile.waitForTimeout(3500);
  await mobile.screenshot({ path: join(OUT, "twin-09-mobile.png") });
  await mobile.close();
  report.steps.push("minimap + mobile");

  // Dollhouse orbit — the Phase-2 Task-4 VISUAL ALIGNMENT GATE. Judge the
  // capture by eye: gold node dots must sit INSIDE the building volume,
  // ~1.5 m above the floor slabs, none outside the walls. Any uniform offset
  // is calibrated through MESH_OFFSET_M in twin-basis.ts — nowhere else.
  // The manifest may lack a mesh (forge run without --mesh): skip cleanly.
  await page.goto(`${BASE}/venues/trades-hall/twin?mode=dollhouse`, {
    waitUntil: "domcontentloaded", timeout: 60000,
  });
  await page.getByTestId("twin-node-label").waitFor({ timeout: 30000 });
  const modeControl = page.getByTestId("twin-mode-control");
  if ((await modeControl.count()) === 0) {
    report.steps.push("dollhouse skipped — bundle manifest carries no mesh");
  } else {
    await modeControl.waitFor({ timeout: 10000 });
    // The 7 MB GLB streams + meshopt-decodes: give the network up to 20 s,
    // then let the canvas paint settle before the capture.
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => undefined);
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(OUT, "twin-10-dollhouse-orbit.png") });
    report.steps.push("dollhouse orbit (mesh/dot alignment gate)");

    // The dive, surfacing direction (deterministic via the DOM button):
    // walk → Surface → mid-flight frame → settled dollhouse vantage.
    await page.goto(`${BASE}/venues/trades-hall/twin?node=scan_000`, {
      waitUntil: "domcontentloaded", timeout: 60000,
    });
    await page.getByTestId("twin-node-label").waitFor({ timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.getByRole("button", { name: /Surface/ }).click();
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(OUT, "twin-11-dive-mid-flight.png") });
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(OUT, "twin-12-dive-surfaced.png") });
    report.steps.push("surface dive (mid-flight + settled)");
  }

  report.ok = report.errors.length === 0;
} catch (e) {
  report.fatal = String(e).slice(0, 400);
} finally {
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
