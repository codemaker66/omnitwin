// Development look for the Grand Assembly studies: opens the planner lab
// (/dev/planner-lab, the planner's own scene in the drawn Grand Hall, no
// backend) and saves stills from named camera poses at chosen hours.
//
//   node scripts/assembly-look.mjs --base http://127.0.0.1:5277 --out D:/claude/x \
//     [--guests 180] [--views a,b] [--hours 20:30,21:30] [--mood candlelight] [--warm]
//
// --warm opens the page with the GPU process disabled (no WebGPU adapter), only
// so Vite transforms the modules before a timed GPU hold. It renders nothing.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const BASE = option("base", "http://127.0.0.1:5277");
const OUT = option("out", "D:/claude/grand-assembly-20261022/looks/latest");
const GUESTS = Number(option("guests", "180"));
const MOOD = option("mood", "candlelight");
const DATE = option("date", "2026-10-23");
const HOURS = option("hours", "20:30").split(",");
const VIEWS = option("views", "end-high,fire-high,window-mid,room,plan,door-eye").split(",");
const QUERY = option("query", "");
const WARM = process.argv.includes("--warm");
const WIDTH = Number(option("width", "1920"));
const HEIGHT = Number(option("height", "1080"));

/** Camera poses in the hall's frame (metres): position, then the point looked at. */
const POSES = {
  "end-high": [[9.7, 4.7, 4.4], [-4.0, 0.4, -1.2]],
  "fire-high": [[-9.7, 4.7, -4.4], [4.0, 0.4, 1.2]],
  "window-mid": [[0.0, 4.4, -4.8], [0.0, 0.6, 2.6]],
  "door-high": [[0.6, 4.6, 4.9], [-1.0, 0.4, -2.4]],
  "door-eye": [[0.4, 1.65, 4.7], [-6.0, 1.0, -1.8]],
  room: [[10.2, 12.6, 13.2], [0, 0.6, 0]],
  plan: [[0, 21.5, 2.3], [0, 0, 0]],
};

mkdirSync(OUT, { recursive: true });
const launchArgs = WARM
  ? ["--disable-gpu", "--disable-software-rasterizer"]
  : ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"];
const browser = await chromium.launch({ channel: "chromium", headless: true, args: launchArgs });
const summary = { base: BASE, guests: GUESTS, mood: MOOD, adapter: null, shots: [], started: new Date().toISOString() };
try {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (error) => { console.error(`page error: ${error.message}`); });
  const url = `${BASE}/dev/planner-lab?render=desktop&governor=off&sky=1&guests=${GUESTS}${QUERY}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
  summary.adapter = await page.evaluate(async () => {
    const gpu = navigator.gpu;
    if (gpu === undefined) return "no WebGPU";
    const adapter = await gpu.requestAdapter();
    return adapter === null ? "no adapter" : `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`.trim();
  });
  console.log(`adapter: ${summary.adapter}`);
  if (WARM) {
    await page.waitForTimeout(Number(option("warm-ms", "45000")));
  } else {
    await page.waitForFunction(() => window.__plannerLab?.ready() === true, undefined, { timeout: 150000, polling: 500 });
    await page.evaluate((mood) => { window.__plannerLab.setMood(mood); }, MOOD);
    for (const hour of HOURS) {
      const at = Date.parse(`${DATE}T${hour}:00+01:00`);
      await page.evaluate(async (time) => {
        const module = await import("/src/stores/hall-time-store.ts");
        module.useHallTimeStore.getState().setTime(time);
      }, at);
      for (const view of VIEWS) {
        const pose = POSES[view];
        if (pose === undefined) throw new Error(`Unknown view ${view}`);
        await page.evaluate(({ position, target }) => { window.__plannerLab.pose(position, target); }, { position: pose[0], target: pose[1] });
        await page.waitForFunction(() => window.__plannerLab.cameraState().gliding === false, undefined, { timeout: 15000, polling: 100 });
        await page.evaluate(() => window.__plannerLab.advance(24));
        const file = join(OUT, `${hour.replace(":", "")}-${view}.png`);
        await page.screenshot({ path: file, type: "png" });
        summary.shots.push({ hour, view, file });
        console.log(`shot ${file}`);
      }
    }
  }
} finally {
  await browser.close();
  summary.finished = new Date().toISOString();
  writeFileSync(join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
}
