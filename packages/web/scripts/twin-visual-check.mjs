// ---------------------------------------------------------------------------
// twin-visual-check — screenshot pass for the Twin walkthrough.
// Standalone Playwright, same pattern as rite-visual-check.mjs. Needs the web
// dev server on 5173 AND the forged bundle at public/twin/trades-hall
// (skips gracefully when the bundle is absent — CI machines don't carry it).
//
// Usage: node scripts/twin-visual-check.mjs
// Env:   OUT_DIR (screenshot dir), BASE_URL (default http://localhost:5173)
//
// EQUIRECT ERA (2026-07-04): the bundle carries one seamless world-frame
// equirect per node (manifest imagery: "equirect"). The waits below cover the
// 512 preview → 4096 base swap (a single texture per node — faster than the
// old six-face set); the 8192 zoom tier streams only after a zoom past the
// 50° fov intent gate, which the chirality step below exercises with its own
// longer wait. The scan_000 captures double as the EQUIRECT_U_FLIP /
// EQUIRECT_U_OFFSET calibration reference: compare against the E57
// workspace's panoramas/scan_000.jpg — same scene composition (note the raw
// equirect JPGs are the horizontal MIRROR of Matterport's flat raster by
// convention; the viewer renders them true). scan_050 — the node whose
// cube-era wall face rendered rotated 90° — is captured at two opposite
// headings: any per-node rotation/seam defect must be visible in neither.
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
  await page.waitForTimeout(4000); // 4096 base equirect lands (512 preview first)
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

  // Text chirality EYE GATE (no automated assert): scan_039 carries the
  // Coopers memorial window — NOTE it is NOT at the equirect default heading
  // (Phase A correction), so the capture shows whatever legible lettering
  // falls at the default heading; reviewers verify ANY etched/painted text
  // reads LEFT-TO-RIGHT with upright letters (drag to the memorial window
  // when in doubt). Mirrored text here means the equirect shader's u-sign
  // has regressed — see EQUIRECT_U_FLIP in twin-basis.ts (cube-era bundles:
  // the PanoStage cube shader's scanner-y negation).
  await page.goto(`${BASE}/venues/trades-hall/twin?node=scan_039`, {
    waitUntil: "domcontentloaded", timeout: 60000,
  });
  await page.getByTestId("twin-node-label").waitFor({ timeout: 30000 });
  await page.waitForTimeout(4000); // 4096 base pano lands
  const chiralityBox = await page.locator("canvas").first().boundingBox();
  if (chiralityBox !== null) {
    const chiralityX = chiralityBox.x + chiralityBox.width / 2;
    const chiralityY = chiralityBox.y + chiralityBox.height / 2;
    await page.mouse.move(chiralityX, chiralityY);
    for (let i = 0; i < 5; i += 1) {
      await page.mouse.wheel(0, -200); // zoom in; -1000 total clamps at MIN_FOV
      await page.waitForTimeout(80);
    }
    // Crossing the 50° fov intent gate starts the 8192 zoom-tier stream —
    // wait for it to land and swap so the capture judges the sharp tier.
    await page.waitForTimeout(4000);
  }
  await page.screenshot({ path: join(OUT, "twin-12-text-chirality.png") });
  report.steps.push("text chirality eye gate (scan_039, min fov, 8192 zoom tier)");

  // scan_050 — the cube-era broken node (one wall face rotated 90° vs its
  // neighbours). Two headings 180° apart: walls must read upright and
  // continuous in BOTH. With per-node equirects this failure class is
  // structurally impossible; these captures are the standing regression eye.
  await page.goto(`${BASE}/venues/trades-hall/twin?node=scan_050`, {
    waitUntil: "domcontentloaded", timeout: 60000,
  });
  await page.getByTestId("twin-node-label").waitFor({ timeout: 30000 });
  await page.waitForTimeout(4000); // 4096 base pano lands
  await page.screenshot({ path: join(OUT, "twin-13-scan050-front.png") });
  await dragLook(page, -520);
  await dragLook(page, -520); // two ~90° right turns = 180°
  await page.screenshot({ path: join(OUT, "twin-14-scan050-back.png") });
  report.steps.push("scan_050 regression eye (two headings 180° apart)");

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
  report.steps.push("minimap + mobile");

  // Mobile HUD gate (polish pass): every HUD piece must be on stage and the
  // page must hold the no-horizontal-overflow invariant at 390×844 — node
  // label, minimap and the two-line disclosure share the frame untangled.
  const hudChecks = [
    ["node label", await mobile.getByTestId("twin-node-label").isVisible()],
    ["minimap", await mobile.locator(".twin-minimap").isVisible()],
    ["disclosure", await mobile.locator(".vv-twin-viewer-disclosure").isVisible()],
  ];
  for (const [piece, visible] of hudChecks) {
    if (!visible) report.errors.push(`mobile HUD missing: ${piece}`);
  }
  const mobileOverflow = await mobile.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  if (mobileOverflow > 1) {
    report.errors.push(`mobile horizontal overflow: ${String(mobileOverflow)}px`);
  }
  await mobile.screenshot({ path: join(OUT, "twin-16-mobile-hud.png") });
  await mobile.close();
  report.steps.push("mobile HUD (label + minimap + disclosure, no overflow)");

  // Dollhouse orbit — the Phase-2 Task-4 VISUAL ALIGNMENT GATE. Judge the
  // capture by eye: gold node dots must sit INSIDE the building volume,
  // ~1.5 m above the floor slabs, none outside the walls. Any uniform offset
  // is calibrated through MESH_OFFSET_M in twin-basis.ts — nowhere else.
  // The manifest may lack a mesh (forge run without --mesh): skip cleanly.
  await page.goto(`${BASE}/venues/trades-hall/twin?node=scan_028&mode=dollhouse`, {
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
    report.steps.push("scan_028 dollhouse orbit (mesh/dot alignment + cutaway gate)");

    // Trades Hall cutaway regression: orbit through three more headings. The
    // camera-facing section must follow the orbit so the near exterior shell
    // stays absent, while the interior, dome, stairs, fixtures, and node dots
    // remain intact from every side.
    for (const [index, delta] of [-420, -420, -420].entries()) {
      await dragLook(page, delta);
      await page.screenshot({
        path: join(OUT, `twin-${17 + index}-scan028-cutaway-heading.png`),
      });
    }
    report.steps.push("scan_028 camera-facing cutaway (four orbit headings)");

    // Plan deliberately disables the vertical cutaway: this checks mode
    // isolation and proves the Dollhouse treatment does not leak elsewhere.
    await page.getByRole("radio", { name: "Plan" }).click();
    await page.waitForTimeout(1800);
    await page.screenshot({ path: join(OUT, "twin-20-scan028-plan.png") });
    if (!page.url().includes("mode=plan")) {
      report.errors.push("Plan mode did not update the URL");
    }
    report.steps.push("scan_028 Plan mode isolation");

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
    await page.screenshot({ path: join(OUT, "twin-15-dive-surfaced.png") });
    report.steps.push("surface dive (mid-flight + settled)");
  }

  report.ok = report.errors.length === 0;
} catch (e) {
  report.fatal = String(e).slice(0, 400);
} finally {
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
