// Captures one surveyed room from the development lab (/dev/surveyed-room) on
// this machine's own GPU: a screenshot of each pose asked for, at a grade.
//
// Needs the dev server running and the room's survey folder under
// packages/web/public. Writes PNGs and summary.json to the output folder;
// nothing in the repository.
//   node scripts/surveyed-room-lab.mjs --room /rooms/saloon/survey-2026-07-11 [--r 1] \
//     [--base http://127.0.0.1:5213] [--out <folder>] [--profile desktop|tablet|phone|office|off] \
//     [--poses overview,plan,eye,ceiling,floor,0,3] [--photos full|half] [--exposure 1] [--glow 1]
//
// A pose is one of the lab's names (overview, plan, eye, ceiling, floor), a
// wall's index in the record (0 is the first wall) or a wall's id. "walls"
// stands for every wall in turn, which is how each strip of the atlas is
// checked for its place and its orientation.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const BASE = option("base", "http://127.0.0.1:5213");
const ROOM = option("room", null);
const REVISION = option("r", "1");
const OUT = option("out", join(tmpdir(), "surveyed-room-lab"));
const PROFILE = option("profile", "desktop");
const POSES = option("poses", "overview,plan,eye,ceiling,floor").split(",").filter((pose) => pose.length > 0);
const PHOTOS = option("photos", null);
const EXPOSURE = Number(option("exposure", "1"));
const GLOW = Number(option("glow", "1"));

const DEVICES = {
  desktop: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
  office: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  tablet: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  off: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
};

if (ROOM === null) throw new Error("Give the survey's public folder: --room /rooms/<slug>/survey-<date>");
const device = DEVICES[PROFILE];
if (device === undefined) throw new Error(`Unknown profile ${PROFILE}`);
if (!Number.isFinite(EXPOSURE) || !Number.isFinite(GLOW)) throw new Error("--exposure and --glow take numbers");
mkdirSync(OUT, { recursive: true });

const query = new URLSearchParams({ base: ROOM, r: REVISION, render: PROFILE });
if (PHOTOS !== null) query.set("photos", PHOTOS);

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
});
const summary = { base: BASE, room: ROOM, revision: REVISION, profile: PROFILE, exposure: EXPOSURE, glow: GLOW, adapter: null, status: null, captures: [], pageErrors: [] };
let failed = false;
try {
  const context = await browser.newContext(device);
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    summary.pageErrors.push(error.message);
    console.error(`page error: ${error.message}`);
  });
  await page.goto(`${BASE}/dev/surveyed-room?${query.toString()}`, { waitUntil: "domcontentloaded" });
  // Ready, or failed: a room that cannot be loaded says so at once instead of timing out.
  await page.waitForFunction(() => {
    const lab = window.__roomLab;
    return lab !== undefined && (lab.ready() === true || lab.status().status === "failed" || lab.status().status === "idle");
  }, undefined, { timeout: 240000, polling: 500 });
  summary.status = await page.evaluate(() => window.__roomLab.status());
  summary.adapter = await page.evaluate(async () => {
    const gpu = navigator.gpu;
    if (gpu === undefined) return "no WebGPU";
    const adapter = await gpu.requestAdapter();
    return adapter === null ? "no adapter" : `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`.trim();
  });
  if (summary.status.status !== "ready") {
    failed = true;
    const failure = summary.status.failure;
    console.error(failure === null
      ? "The lab was given no room (check --room)."
      : `The surveyed room could not be loaded: ${failure.file} (${failure.reason}): ${failure.detail}`);
    await page.screenshot({ path: join(OUT, `${PROFILE}-not-loaded.png`), type: "png" });
  } else {
    const missing = summary.status.photos?.failed ?? [];
    if (missing.length > 0) console.error(`Photographs that could not be loaded (drawn in a plain tone): ${missing.join(", ")}`);
    await page.evaluate(({ exposure, glow }) => {
      window.__roomLab.setExposure(exposure);
      window.__roomLab.setGlow(glow);
    }, { exposure: EXPOSURE, glow: GLOW });
    const poses = POSES.flatMap((pose) => (pose === "walls" ? summary.status.walls.map((_, index) => String(index)) : [pose]));
    for (const pose of poses) {
      const known = await page.evaluate((asked) => window.__roomLab.setPose(/^[0-9]+$/.test(asked) ? Number(asked) : asked), pose);
      if (!known) {
        failed = true;
        console.error(`Unknown pose ${pose}: a name (overview, plan, eye, ceiling, floor), a wall's index or one of ${summary.status.walls.join(", ")}`);
        continue;
      }
      // A still view long enough for temporal anti-aliasing to settle.
      await page.waitForTimeout(1500);
      const file = join(OUT, `${PROFILE}-${pose}.png`);
      await page.screenshot({ path: file, type: "png" });
      summary.captures.push({ pose, file });
      console.log(`captured ${file}`);
    }
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `summary-${PROFILE}.json`), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`adapter: ${summary.adapter}`);
console.log(`summary: ${join(OUT, `summary-${PROFILE}.json`)}`);
if (failed || summary.pageErrors.length > 0) process.exitCode = 1;
