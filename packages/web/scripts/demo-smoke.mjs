// The demo path, checked end to end against a running site.
//
//   node packages/web/scripts/demo-smoke.mjs
//
// Written for Monday 2026-09-07: Blake shows Elaine the front door, the Grand
// Hall walk, and the guest planner, in that order (docs/plan/12). This walks
// the same path a few minutes ahead of him and fails loudly if any of it has
// stopped working. It prints one line per check and exits non-zero if any
// check failed, so a scheduled run can page him on failure alone.
//
// env: BASE_URL (default https://venviewer.com), API_URL (default
//      https://api.venviewer.com), THROTTLE_MBPS (default 20, the venue's
//      likely worst case; 0 disables), FIRST_VIEW_BUDGET_MS (default 15000),
//      OUT_DIR (default D:/claude/demo-smoke), HEADLESS (default 1).
//
// Run it from packages/web: a script outside that package cannot resolve
// @playwright/test, which is why the import below is an absolute file URL.
import { chromium } from "file:///C:/Users/blake/omnitwin2/packages/web/node_modules/@playwright/test/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const baseUrl = (process.env.BASE_URL ?? "https://venviewer.com").replace(/\/$/u, "");
const apiUrl = (process.env.API_URL ?? "https://api.venviewer.com").replace(/\/$/u, "");
const mbps = Number(process.env.THROTTLE_MBPS ?? "20");
const firstViewBudgetMs = Number(process.env.FIRST_VIEW_BUDGET_MS ?? "15000");
const outDir = process.env.OUT_DIR ?? "D:/claude/demo-smoke";
const headless = process.env.HEADLESS !== "0";

const checks = [];
/** Record one check. `detail` is what a human needs to act; keep it short. */
function record(name, ok, ms, detail) {
  checks.push({ name, ok, ms, detail });
  process.stdout.write(`${ok ? "ok  " : "FAIL"}  ${name.padEnd(24)} ${String(ms).padStart(7)} ms  ${detail}\n`);
}

async function timed(name, fn) {
  const start = Date.now();
  try {
    const { ok, detail } = await fn();
    record(name, ok, Date.now() - start, detail);
  } catch (error) {
    record(name, false, Date.now() - start, `threw: ${String(error).slice(0, 160)}`);
  }
}

const browser = await chromium.launch({ headless });

/** A fresh page, throttled like the venue's line, collecting page errors. */
async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => { errors.push(String(error).slice(0, 200)); });
  if (mbps > 0) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 40,
      downloadThroughput: (mbps * 1e6) / 8,
      uploadThroughput: (10 * 1e6) / 8,
    });
  }
  return { page, errors };
}

// 1. The API. Everything signed-in depends on it, and it deploys by hand, so
//    it is the thing most likely to be quietly down.
await timed("api health", async () => {
  const response = await fetch(`${apiUrl}/health`);
  return { ok: response.ok, detail: `${apiUrl}/health -> ${String(response.status)}` };
});

// 2. The front door. Act 1 opens here, and its footer copy is the tell that
//    the deployed bundle is the one carrying September's fixes.
await timed("front door", async () => {
  const { page, errors } = await newPage();
  const response = await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const text = await page.evaluate(() => document.body.innerText);
  const status = response === null ? 0 : response.status();
  const hasWalk = text.includes("Walk the whole building");
  await page.close();
  return {
    ok: status === 200 && hasWalk && errors.length === 0,
    detail: `${String(status)}, "Walk the whole building" ${hasWalk ? "present" : "MISSING"}, ${String(errors.length)} page errors`,
  };
});

// 3. The Grand Hall walk: the act that cannot fail. The page's own ledger says
//    when the coarse room is up (firstView) and when the finest level has
//    landed (complete) — never time this from screenshots, which stall the GPU
//    during a load, nor from Playwright's response event, which fires on
//    headers rather than the body.
await timed("grand hall walk", async () => {
  const { page, errors } = await newPage();
  const start = Date.now();
  await page.goto(`${baseUrl}/room/grand-hall`, { waitUntil: "commit" });
  let firstViewMs = null;
  let completeMs = null;
  while (Date.now() - start < 180000 && completeMs === null) {
    const walk = await page.evaluate(() => window.__roomWalk ?? null).catch(() => null);
    if (walk !== null) {
      if (firstViewMs === null && walk.firstView === true) firstViewMs = Date.now() - start;
      if (walk.complete === true) completeMs = Date.now() - start;
    }
    await page.waitForTimeout(200);
  }
  const walk = await page.evaluate(() => window.__roomWalk ?? null).catch(() => null);
  await page.close();
  const inBudget = firstViewMs !== null && firstViewMs <= firstViewBudgetMs;
  return {
    ok: inBudget && completeMs !== null && errors.length === 0,
    detail: firstViewMs === null
      ? `NO FIRST VIEW within 180 s (settled ${String(walk?.settled ?? 0)}/${String(walk?.total ?? 0)})`
      : `first view ${(firstViewMs / 1000).toFixed(1)} s (budget ${String(firstViewBudgetMs / 1000)} s)`
        + `, complete ${completeMs === null ? "NOT REACHED" : `${(completeMs / 1000).toFixed(1)} s`}`
        + `, ${String(errors.length)} page errors`,
  };
});

// 4. The guest planner: Act 2. Opening it signed-out must mint a public draft
//    through the live API, which is what turns the URL into /plan/<code>.
await timed("guest planner draft", async () => {
  const { page, errors } = await newPage();
  await page.goto(`${baseUrl}/plan?space=grand-hall`, { waitUntil: "domcontentloaded" });
  const minted = await page
    .waitForURL(/\/plan\/[A-Za-z0-9-]+/u, { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  const url = page.url();
  await page.close();
  return {
    ok: minted && errors.length === 0,
    detail: minted
      ? `minted ${url.slice(url.indexOf("/plan/"))}, ${String(errors.length)} page errors`
      : `NO DRAFT: still at ${url}`,
  };
});

// 5. The Twin, which the front door's footer links to. It is not one of the
//    three acts, but it is one click from them and must not be broken.
await timed("twin", async () => {
  const { page, errors } = await newPage();
  const response = await page.goto(`${baseUrl}/venues/trades-hall/twin`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(20000);
  const drew = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    return canvas !== null && canvas.width > 100 && canvas.height > 100;
  });
  const status = response === null ? 0 : response.status();
  await page.close();
  return {
    ok: status === 200 && drew && errors.length === 0,
    detail: `${String(status)}, canvas ${drew ? "drawn" : "MISSING"}, ${String(errors.length)} page errors`,
  };
});

await browser.close();

const failed = checks.filter((check) => !check.ok);
const result = {
  startedIso: new Date().toISOString(),
  baseUrl,
  apiUrl,
  throttleMbps: mbps,
  ok: failed.length === 0,
  checks,
};
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/${result.startedIso.replace(/[:.]/gu, "-")}.json`, JSON.stringify(result, null, 1));

process.stdout.write(
  failed.length === 0
    ? `\nDEMO PATH OK against ${baseUrl}\n`
    : `\nDEMO PATH BROKEN against ${baseUrl}: ${failed.map((check) => check.name).join(", ")}\n`,
);
process.exit(failed.length === 0 ? 0 : 1);
