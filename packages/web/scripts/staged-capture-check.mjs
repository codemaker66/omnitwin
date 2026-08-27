// Renders each staged Trades Hall room in a real browser and reports what
// actually loaded: tile HTTP results, splats reaching the GPU, and a screenshot.
//
// Needs the dev server running with SPLAT_STAGING_ROOT set:
//   pnpm --filter @omnitwin/web dev --port 5192 --strictPort
//
// Usage: node scripts/staged-capture-check.mjs [baseUrl] [outDir]
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:5192";
const OUT = process.argv[3] ?? "D:/claude/splat-check";
const ROOMS = [
  "reception-room",
  "deacon-conveners-room",
  "saloon",
  "north-gallery",
  "south-gallery",
  "lady-convenors-room",
  "robert-adam-room",
  "grand-hall",
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const results = [];

for (const room of ROOMS) {
  // A small viewport is deliberate: screenshotting a heavy splat canvas stalls
  // on pixel readback, and 1440x900 reliably times out above roughly 8 M
  // splats where 900x560 succeeds. Legibility is worth less than a capture.
  const context = await browser.newContext({ viewport: { width: 900, height: 560 } });
  const page = await context.newPage();
  const tiles = { ok: 0, failed: 0, bytes: 0 };
  page.on("response", (res) => {
    const url = res.url();
    if (!url.includes("/splats/")) return;
    if (res.status() === 200) {
      tiles.ok += 1;
      const len = Number(res.headers()["content-length"] ?? 0);
      if (Number.isFinite(len)) tiles.bytes += len;
    } else {
      tiles.failed += 1;
    }
  });

  await page.goto(`${BASE}/dev/trades-hall-visual?venue=trades-hall&room=${room}&staged=1`, {
    waitUntil: "domcontentloaded",
  });

  // Wait for every tile to report in, or time out and report honestly.
  let status = "timeout";
  try {
    await page.waitForFunction(
      () => /Loading runtime asset chunks \((\d[\d,]*)\/\1\)/.test(document.body.textContent ?? "")
        || /staged from source/i.test(document.body.textContent ?? ""),
      undefined,
      { timeout: 300000 },
    );
    status = "loaded";
  } catch { /* keep timeout */ }

  const info = await page.evaluate(() => {
    const body = document.body.textContent ?? "";
    const chunk = body.match(/Loading runtime asset chunks \([\d,]+\/[\d,]+\)/);
    const splats = body.match(/([\d,]+)\s+splats/i);
    return {
      chunkLine: chunk ? chunk[0] : null,
      splatText: splats ? splats[0] : null,
      claimsReviewed: /human reviewed|survey-grade|photoreal|production ready/i.test(body),
    };
  });

  // Screenshots are best-effort: reading back a heavy splat canvas can stall
  // (see the GPU ReadPixels notes in the e2e rules). The loaded-splat count is
  // the load-bearing evidence; a missing image must not fail the run.
  let shot = false;
  try {
    await page.waitForTimeout(4000);
    await page.screenshot({
      path: join(OUT, `${room}.png`),
      timeout: 120000,
      clip: { x: 0, y: 0, width: 900, height: 560 },
    });
    shot = true;
  } catch { /* keep going */ }
  results.push({ room, status, tiles, screenshot: shot, ...info });
  console.log(
    `${room.padEnd(24)} tiles ok=${String(tiles.ok).padStart(3)} failed=${tiles.failed} ` +
    `${(tiles.bytes / 1024 / 1024).toFixed(0).padStart(4)}MB  ${info.splatText ?? info.chunkLine ?? status}` +
    (info.claimsReviewed ? "  !! CLAIMS REVIEWED" : ""),
  );
  await context.close();
}

writeFileSync(join(OUT, "report.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(`\nScreenshots and report.json in ${OUT}`);
await browser.close();
