// Robustness probe harness for the Venviewer Twin. Drives its own headless
// Chromium, captures console + pageerror + failed requests, runs one scenario
// per invocation, saves screenshots. Run from packages/web:
//   node scripts/twin-robust-probe.mjs <scenario>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.OUT_DIR ??
  "C:/Users/blake/AppData/Local/Temp/claude/c--Users-blake-omnitwin2/e3af228b-ecee-468f-811b-f4ef5913c4b4/scratchpad/ssplus";
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:5173/venues/trades-hall/twin";
const scenario = process.argv[2] ?? "baseline";

const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function wire(page, log) {
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error" || t === "warning") log.console.push(`[${t}] ${m.text()}`.slice(0, 300));
  });
  page.on("pageerror", (e) => log.pageerror.push(String(e).slice(0, 400)));
  page.on("requestfailed", (r) => {
    const f = r.failure();
    log.reqfailed.push(`${r.url().split("/").slice(-3).join("/")} :: ${f ? f.errorText : "?"}`);
  });
}

async function run() {
  const browser = await chromium.launch();
  const log = { console: [], pageerror: [], reqfailed: [], notes: [] };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  wire(page, log);

  const urlNow = () => page.url().replace("http://localhost:5173", "");

  try {
    if (scenario === "baseline") {
      await page.goto(BASE, { waitUntil: "load" });
      await sleep(300);
      log.notes.push(`url after 300ms: ${urlNow()}`);
      await sleep(4000);
      log.notes.push(`url after ~4.3s: ${urlNow()}`);
      const live = await page.locator(".vv-twin-viewer--live").count();
      const shimmer = await page.locator('[data-testid="twin-load-shimmer"]').count();
      log.notes.push(`viewer--live=${live} shimmerPresent=${shimmer}`);
      await shot(page, "01-baseline");
    }

    if (scenario === "invalid-node") {
      await page.goto(`${BASE}?node=scan_999`, { waitUntil: "load" });
      await sleep(500);
      log.notes.push(`url after invalid node: ${urlNow()}`);
      await sleep(3000);
      log.notes.push(`url settled: ${urlNow()}`);
      const label = await page.locator('[data-testid="twin-node-label"]').innerText().catch(() => "(none)");
      log.notes.push(`node label: ${JSON.stringify(label)}`);
      await shot(page, "02-invalid-node");
    }

    if (scenario === "malformed-node") {
      await page.goto(`${BASE}?node=%00%01<script>`, { waitUntil: "load" });
      await sleep(2500);
      log.notes.push(`url after malformed: ${urlNow()}`);
      await shot(page, "02b-malformed-node");
    }

    if (scenario === "deeplink-mid") {
      await page.goto(`${BASE}?node=scan_075`, { waitUntil: "load" });
      await sleep(4000);
      const label = await page.locator('[data-testid="twin-node-label"]').innerText().catch(() => "(none)");
      log.notes.push(`url: ${urlNow()} label: ${JSON.stringify(label)}`);
      await shot(page, "03-deeplink-mid");
    }

    if (scenario === "deeplink-dollhouse-cold") {
      let glbRequested = false;
      await page.route("**/mesh/dollhouse.glb", async (route) => {
        glbRequested = true;
        await sleep(3000);
        await route.continue();
      });
      const t0 = Date.now();
      await page.goto(`${BASE}?mode=dollhouse`, { waitUntil: "load" });
      await sleep(400);
      log.notes.push(`glbRequested=${glbRequested} @${Date.now() - t0}ms url=${urlNow()}`);
      const shimmer = await page.locator('[data-testid="twin-load-shimmer"]').count();
      const anySpinner = await page.locator("text=/loading|preparing/i").count();
      log.notes.push(`during-glb-load: shimmer=${shimmer} spinnerText=${anySpinner}`);
      await shot(page, "04a-dollhouse-cold-loading");
      await sleep(4000);
      await shot(page, "04b-dollhouse-cold-loaded");
      log.notes.push(`url after load: ${urlNow()}`);
    }

    if (scenario === "all-tiles-404") {
      await page.route("**/tiles/**", (route) => route.fulfill({ status: 404, body: "" }));
      await page.goto(BASE, { waitUntil: "load" });
      await sleep(5000);
      const live = await page.locator(".vv-twin-viewer--live").count();
      const shimmer = await page.locator('[data-testid="twin-load-shimmer"]').count();
      const errState = await page.locator(".vv-twin-state[role=alert]").count();
      const canvasBg = await page.evaluate(() => {
        const c = document.querySelector("canvas");
        if (!c) return "(no canvas)";
        const r = c.getBoundingClientRect();
        return `${Math.round(r.width)}x${Math.round(r.height)}`;
      });
      log.notes.push(`ALL-404: viewer--live=${live} shimmerStillPresent=${shimmer} errorState=${errState} canvas=${canvasBg}`);
      await shot(page, "05-all-tiles-404");
    }

    if (scenario === "one-node-404") {
      await page.route("**/tiles/scan_000/**", (route) => route.fulfill({ status: 404, body: "" }));
      await page.goto(BASE, { waitUntil: "load" });
      await sleep(5000);
      const live = await page.locator(".vv-twin-viewer--live").count();
      const shimmer = await page.locator('[data-testid="twin-load-shimmer"]').count();
      const errState = await page.locator(".vv-twin-state[role=alert]").count();
      log.notes.push(`FIRST-NODE-404: viewer--live=${live} shimmerStillPresent=${shimmer} errorState=${errState} url=${urlNow()}`);
      await shot(page, "06-first-node-404");
    }

    if (scenario === "manifest-404") {
      await page.route("**/twin/trades-hall/manifest.json", (route) => route.fulfill({ status: 404, body: "" }));
      await page.goto(BASE, { waitUntil: "load" });
      await sleep(1500);
      const err = await page.locator(".vv-twin-state[role=alert]").innerText().catch(() => "(none)");
      const retry = await page.locator(".vv-twin-retry").count();
      log.notes.push(`MANIFEST-404: errText=${JSON.stringify(err)} retryBtn=${retry}`);
      await shot(page, "07-manifest-404");
    }

    if (scenario === "resize-midhop") {
      await page.goto(`${BASE}?node=scan_040`, { waitUntil: "load" });
      await sleep(4000);
      await page.locator("canvas").click({ position: { x: 720, y: 450 } });
      await page.keyboard.down("w");
      await sleep(60);
      await page.setViewportSize({ width: 700, height: 1000 });
      await sleep(60);
      await page.setViewportSize({ width: 1600, height: 500 });
      await page.keyboard.up("w");
      await sleep(2500);
      await shot(page, "08-resize-midhop");
      log.notes.push(`resize-midhop url=${urlNow()}`);
    }

    if (scenario === "rapid-mode") {
      await page.goto(BASE, { waitUntil: "load" });
      await sleep(3500);
      const before = await page.evaluate(() => history.length);
      const has = await page.locator('[data-testid="twin-mode-control"]').count();
      log.notes.push(`mode-control present=${has}`);
      for (let i = 0; i < 8; i++) {
        await page.locator('[data-testid="twin-mode-control"] button', { hasText: /dollhouse/i }).click().catch(() => {});
        await sleep(120);
        await page.locator('[data-testid="twin-mode-control"] button', { hasText: /walk/i }).click().catch(() => {});
        await sleep(120);
      }
      await sleep(1500);
      const after = await page.evaluate(() => history.length);
      log.notes.push(`history before=${before} after=${after} url=${urlNow()}`);
      await shot(page, "09-rapid-mode");
    }

    if (scenario === "back-forward") {
      await page.goto(BASE, { waitUntil: "load" });
      await sleep(3500);
      for (const n of ["scan_010", "scan_020", "scan_030"]) {
        await page.goto(`${BASE}?node=${n}`, { waitUntil: "commit" });
        await sleep(1200);
      }
      await page.goBack(); await sleep(1200); log.notes.push(`after back1: ${urlNow()}`);
      await page.goBack(); await sleep(1200); log.notes.push(`after back2: ${urlNow()}`);
      await page.goForward(); await sleep(1200); log.notes.push(`after fwd1: ${urlNow()}`);
      await shot(page, "10-back-forward");
    }

    if (scenario === "two-keys") {
      await page.goto(`${BASE}?node=scan_040`, { waitUntil: "load" });
      await sleep(4000);
      await page.locator("canvas").click({ position: { x: 720, y: 450 } });
      await page.keyboard.down("w");
      await page.keyboard.down("d");
      await sleep(2500);
      await page.keyboard.up("d");
      await page.keyboard.up("w");
      await sleep(1000);
      log.notes.push(`two-keys end url=${urlNow()}`);
      await shot(page, "11-two-keys");
    }
    if (scenario === "zoom-8192-missing") {
      // Every 8192 tile 404s; base 4096 serves. Zoom in hard and confirm the
      // pano stays live (graceful degrade) rather than blanking.
      await page.route("**/equirect_8192.webp", (route) => route.fulfill({ status: 404, body: "" }));
      await page.goto(`${BASE}?node=scan_050`, { waitUntil: "load" });
      await sleep(4000);
      const liveBefore = await page.locator(".vv-twin-viewer--live").count();
      // Wheel up to drive fov below the 50deg zoom threshold.
      for (let i = 0; i < 25; i++) { await page.mouse.wheel(0, -120); await sleep(20); }
      await sleep(3000);
      const liveAfter = await page.locator(".vv-twin-viewer--live").count();
      log.notes.push(`ZOOM-8192-404: liveBefore=${liveBefore} liveAfter=${liveAfter}`);
      await shot(page, "12-zoom-8192-missing");
    }

    if (scenario === "midwalk-404") {
      // scan_000 loads fine; block a cluster of nearby nodes so a forward walk
      // lands on a node with no tiles. Characterize the mid-walk black state.
      for (const n of ["scan_001", "scan_002", "scan_003", "scan_004", "scan_005"]) {
        await page.route(`**/tiles/${n}/**`, (route) => route.fulfill({ status: 404, body: "" }));
      }
      await page.goto(BASE, { waitUntil: "load" });
      await sleep(4000);
      const liveStart = await page.locator(".vv-twin-viewer--live").count();
      await page.locator("canvas").click({ position: { x: 720, y: 450 } });
      await page.keyboard.down("w"); await sleep(2500); await page.keyboard.up("w");
      await sleep(2000);
      const label = await page.locator('[data-testid="twin-node-label"]').innerText().catch(() => "(none)");
      const errState = await page.locator(".vv-twin-state[role=alert]").count();
      const shimmer = await page.locator('[data-testid="twin-load-shimmer"]').count();
      log.notes.push(`MIDWALK-404: liveAtStart=${liveStart} endLabel=${JSON.stringify(label)} errState=${errState} shimmerReArmed=${shimmer} url=${urlNow()}`);
      await shot(page, "13-midwalk-404");
    }

  } catch (e) {
    log.notes.push(`SCENARIO THREW: ${String(e).slice(0, 300)}`);
  }

  console.log(JSON.stringify({ scenario, ...log }, null, 2));
  await browser.close();
}

run();
