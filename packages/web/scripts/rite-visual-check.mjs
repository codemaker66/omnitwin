// ---------------------------------------------------------------------------
// rite-visual-check — act-by-act screenshot pass for The Rite landing page.
// Standalone Playwright (same pattern as visual-check.mjs): no MCP, no
// permission popups. Needs the web dev server on 5173 (no API required —
// the landing route makes zero API calls).
//
// Usage: node scripts/rite-visual-check.mjs
// Env:   OUT_DIR (screenshot dir), BASE_URL (default http://localhost:5173)
// ---------------------------------------------------------------------------

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const OUT = process.env.OUT_DIR ?? "rite-shots";
mkdirSync(OUT, { recursive: true });

const report = { ok: false, steps: [], errors: [] };

/** Scroll to a multiple of the viewport height and let springs settle. */
async function scrollToVh(page, vh) {
  await page.evaluate((multiple) => {
    window.scrollTo({ top: window.innerHeight * multiple, behavior: "instant" });
  }, vh);
  await page.waitForTimeout(1800); // reveals + drift settle
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => report.errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") report.errors.push(`console: ${m.text()}`);
  });

  // --- Act 0: the threshold (flame settled, line risen) ---
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3200);
  await page.screenshot({ path: join(OUT, "rite-01-threshold.png") });
  report.steps.push("threshold");

  // --- Act I: darkness, light carried onto a fragment ---
  await scrollToVh(page, 1.6);
  await page.mouse.move(430, 320); // over the chandelier fragment
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, "rite-02-darkness-light.png") });
  report.steps.push("darkness + carried light");

  // --- Act II: the dome cut, then the monument ---
  await scrollToVh(page, 3.7);
  await page.screenshot({ path: join(OUT, "rite-03-dome.png") });
  report.steps.push("dome");

  await scrollToVh(page, 4.9);
  await page.screenshot({ path: join(OUT, "rite-04-monument.png") });
  report.steps.push("monument 21");

  // --- Act III: a chapter, then the eight-room index ---
  await page.getByRole("heading", { name: "The Grand Hall", exact: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(2200);
  await page.screenshot({ path: join(OUT, "rite-05-chapter-grand-hall.png") });
  report.steps.push("chapter grand hall");

  await page.getByRole("heading", { name: /Eight rooms/ }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(1400);
  await page.screenshot({ path: join(OUT, "rite-06-index.png") });
  report.steps.push("index");

  // --- The Return: line + CTA, ignited by hover ---
  const cta = page.getByRole("link", { name: /Begin with the room/ });
  await cta.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT, "rite-07-return.png") });
  await cta.hover();
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, "rite-08-cta-ignite.png") });
  report.steps.push("return + ignite");

  // --- Footer ---
  await page.locator("#contact").scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, "rite-09-footer.png") });
  report.steps.push("footer");

  // --- Mobile: threshold + a chapter ---
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await mobile.waitForTimeout(3000);
  await mobile.screenshot({ path: join(OUT, "rite-10-mobile-threshold.png") });
  await mobile.getByRole("heading", { name: "The Grand Hall", exact: true }).scrollIntoViewIfNeeded();
  await mobile.waitForTimeout(2000);
  await mobile.screenshot({ path: join(OUT, "rite-11-mobile-chapter.png") });
  await mobile.close();
  report.steps.push("mobile");

  // --- Reduced motion: the first-class static variant ---
  const still = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await still.emulateMedia({ reducedMotion: "reduce" });
  await still.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60000 });
  await still.waitForTimeout(1500);
  await still.screenshot({ path: join(OUT, "rite-12-static-variant.png"), fullPage: true });
  await still.close();
  report.steps.push("static variant (full page)");

  report.ok = report.errors.length === 0;
} catch (e) {
  report.fatal = String(e).slice(0, 400);
} finally {
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
