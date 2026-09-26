import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

// Photographs the public production pages from a GitHub runner, because the
// development containers cannot reach venviewer.com. Read-only: it opens pages
// and never fills or submits anything. For each page and size it writes a PNG
// and one summary row: the final address, the title and h1, any horizontal
// overflow, and console or page errors.
//
// Run from packages/web so @playwright/test resolves:
//   pnpm --filter @omnitwin/web exec node ../../.github/scripts/photograph-production.mjs <output dir>

// A bare import would resolve from .github/scripts, which has no packages.
const { chromium } = createRequire(resolve(process.cwd(), "package.json"))("@playwright/test");
const base = process.env.PRODUCTION_WEB ?? "https://venviewer.com";
const out = process.argv[2];
if (out === undefined || out.length === 0) throw new Error("usage: photograph-production.mjs <output directory>");

const pages = [
  { name: "front-door", path: "/", fullPage: true },
  { name: "retired-landing", path: "/landing", fullPage: false },
  { name: "not-found", path: "/no-such-page-for-the-receipt", fullPage: false },
  { name: "pricing-signed-out", path: "/pricing", fullPage: false },
];
const sizes = [
  { label: "1440x900", width: 1440, height: 900 },
  { label: "390x844", width: 390, height: 844 },
];

await mkdir(out, { recursive: true });
// CHROMIUM_EXECUTABLE lets a development container use its preinstalled build.
const executablePath = process.env.CHROMIUM_EXECUTABLE;
const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath });
const summary = [];
try {
  for (const size of sizes) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, reducedMotion: "reduce" });
    for (const target of pages) {
      const page = await context.newPage();
      const problems = [];
      page.on("pageerror", (error) => { problems.push(`page error: ${error.message}`); });
      page.on("console", (message) => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });
      try {
        await page.goto(new URL(target.path, base).href, { waitUntil: "load", timeout: 60_000 });
      } catch (error) {
        problems.push(`navigation: ${error instanceof Error ? error.message : String(error)}`);
      }
      await page.waitForTimeout(2_500);
      const file = `${target.name}-${size.label}.png`;
      await page.screenshot({ path: join(out, file), fullPage: target.fullPage });
      const facts = await page.evaluate(() => ({
        title: document.title,
        h1: document.querySelector("h1")?.textContent?.trim() ?? null,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));
      summary.push({ page: target.name, size: size.label, finalUrl: page.url(), ...facts, problems, file });
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
}

await writeFile(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
for (const row of summary) {
  console.log(`- ${row.page} at ${row.size}: ${row.finalUrl}, h1 ${JSON.stringify(row.h1)}, overflow ${String(row.overflowX)} px, ${String(row.problems.length)} problems`);
}
