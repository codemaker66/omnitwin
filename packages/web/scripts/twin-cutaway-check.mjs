// Focused real-bundle visual gate for the Trades Hall camera-facing cutaway.
// Run with the dev server already listening:
//   BASE_URL=http://127.0.0.1:5174 OUT_DIR=<absolute-dir> node scripts/twin-cutaway-check.mjs

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const OUT = process.env.OUT_DIR ?? "twin-cutaway-shots";
mkdirSync(OUT, { recursive: true });

async function dragOrbit(page, deltaX) {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("Twin canvas has no bounding box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(x + (deltaX * step) / 12, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(1400);
}

const browser = await chromium.launch();
const report = { ok: false, url: "", title: "", meaningfulContent: false, errors: [], shots: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on("pageerror", (error) => report.errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(`console: ${message.text()}`);
  });
  await page.goto(`${BASE}/venues/trades-hall/twin?node=scan_028&mode=dollhouse`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.getByTestId("twin-node-label").waitFor({ timeout: 30_000 });
  await page.getByTestId("twin-mode-control").waitFor({ timeout: 10_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(3500);

  report.url = page.url();
  report.title = await page.title();
  report.meaningfulContent =
    (await page.locator("canvas").count()) > 0 &&
    (await page.getByTestId("twin-node-label").isVisible()) &&
    (await page.getByRole("radio", { name: "Dollhouse" }).getAttribute("aria-checked")) === "true";
  const overlay = page.locator("vite-error-overlay, #webpack-dev-server-client-overlay");
  if ((await overlay.count()) > 0) report.errors.push("framework error overlay is present");

  for (let heading = 0; heading < 4; heading += 1) {
    const name = `scan028-cutaway-heading-${heading}.png`;
    await page.screenshot({ path: join(OUT, name) });
    report.shots.push(name);
    if (heading < 3) await dragOrbit(page, -420);
  }
  report.ok = report.meaningfulContent && report.errors.length === 0;
} catch (error) {
  report.errors.push(`fatal: ${String(error).slice(0, 500)}`);
} finally {
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
