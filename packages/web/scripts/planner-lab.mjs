// Captures the planner's Grand Hall from the development lab (/dev/planner-lab)
// on this machine's own GPU: screenshots of named views in a mood, and the
// time a frame takes through the post-processing pipeline, per device profile.
//
// Needs the dev server running. Writes PNGs and summary.json to the output
// folder; nothing in the repository.
//   node scripts/planner-lab.mjs --base http://127.0.0.1:5213 --out D:/claude/x \
//     [--profile desktop|tablet|phone|off] [--mood daylight|evening|candlelight] \
//     [--views room,plan,eye] [--frames 120] [--guests 160]
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const BASE = option("base", "http://127.0.0.1:5213");
const OUT = option("out", "D:/claude/grand-hall-planner/captures/latest");
const PROFILE = option("profile", "desktop");
const MOOD = option("mood", "daylight");
const VIEWS = option("views", "room,plan,eye").split(",").filter((view) => view.length > 0);
const FRAMES = Number(option("frames", "120"));
const GUESTS = Number(option("guests", "160"));

/** Camera poses in the hall's frame (metres): position, then the point looked at. */
const POSES = {
  room: [[10.2, 12.6, 13.2], [0, 0.6, 0]],
  plan: [[0, 21.5, 2.3], [0, 0, 0]],
  eye: [[4.2, 2.6, 3.4], [-1.8, 0.2, -1.2]],
  low: [[8.6, 1.5, 3.9], [-2.0, 1.6, -0.8]],
  corner: [[-9.0, 6.5, -4.4], [1.0, 0.4, 0.8]],
};

const DEVICES = {
  desktop: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
  tablet: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  off: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
};

const device = DEVICES[PROFILE];
if (device === undefined) throw new Error(`Unknown profile ${PROFILE}`);
for (const view of VIEWS) if (POSES[view] === undefined) throw new Error(`Unknown view ${view}`);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
});
const summary = { base: BASE, profile: PROFILE, mood: MOOD, guests: GUESTS, captures: [], frames: null, adapter: null };
try {
  const context = await browser.newContext(device);
  const page = await context.newPage();
  page.on("pageerror", (error) => { console.error(`page error: ${error.message}`); });
  await page.goto(`${BASE}/dev/planner-lab?render=${PROFILE}&guests=${GUESTS}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__plannerLab?.ready() === true, undefined, { timeout: 240000, polling: 500 });
  summary.adapter = await page.evaluate(async () => {
    const gpu = navigator.gpu;
    if (gpu === undefined) return "no WebGPU";
    const adapter = await gpu.requestAdapter();
    return adapter === null ? "no adapter" : `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`.trim();
  });
  await page.evaluate((mood) => { window.__plannerLab.setMood(mood); }, MOOD);
  await page.waitForTimeout(2500);
  for (const view of VIEWS) {
    const [position, target] = POSES[view];
    await page.evaluate(({ position, target }) => { window.__plannerLab.pose(position, target); }, { position, target });
    // The planner's glide, then a still frame long enough for temporal refinement.
    await page.waitForFunction(() => window.__plannerLab.cameraState().gliding === false, undefined, { timeout: 15000, polling: 100 });
    await page.waitForTimeout(1500);
    const file = join(OUT, `${PROFILE}-${MOOD}-${view}.png`);
    await page.screenshot({ path: file, type: "png" });
    summary.captures.push({ view, file });
    console.log(`captured ${file}`);
  }
  if (FRAMES > 0) {
    summary.frames = await page.evaluate((frames) => window.__plannerLab.measure(frames, true), FRAMES);
    console.log(`frames: ${JSON.stringify(summary.frames)}`);
    summary.gpu = await page.evaluate((frames) => window.__plannerLab.measureGpu(frames), FRAMES);
    console.log(`gpu: ${JSON.stringify(summary.gpu)}`);
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `summary-${PROFILE}-${MOOD}.json`), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`adapter: ${summary.adapter}`);
