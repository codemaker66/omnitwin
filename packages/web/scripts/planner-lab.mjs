// Captures the planner's Grand Hall from the development lab (/dev/planner-lab)
// on this machine's own GPU: screenshots of named views in a mood, and the
// time a frame takes through the post-processing pipeline, per device profile.
//
// Needs the dev server running. Writes PNGs and summary.json to the output
// folder; nothing in the repository. The summary says what drew the frames
// (the backend and GPU of the planner's own renderer, read through the lab's
// bridge after each capture) and keeps the page's uncaught errors and the
// console's errors and warnings.
//   node scripts/planner-lab.mjs --base http://127.0.0.1:5213 --out <folder> \
//     [--profile desktop|tablet|phone|off] [--mood daylight|evening|candlelight] \
//     [--views room,plan,eye] [--frames 120] [--guests 160] [--channel chromium|chrome]
//
// Another Trades Hall room, drawn as surveyed from a staged folder, from the planner's own cameras:
//   node scripts/planner-lab.mjs --base http://127.0.0.1:5213 --out <folder> --frames 0 \
//     --space saloon --roomsBase /rooms/saloon/survey-2026-07-11 [--roomsRev 1] \
//     [--views opening,plan,from-fireplace,from-windows,from-front,from-rear]
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const BASE = option("base", "http://127.0.0.1:5213");
const OUT = option("out", join(tmpdir(), "planner-lab"));
const PROFILE = option("profile", "desktop");
const MOOD = option("mood", "daylight");
const VIEWS = option("views", "room,plan,eye").split(",").filter((view) => view.length > 0);
const FRAMES = Number(option("frames", "120"));
// Another Trades Hall room instead of the Grand Hall (`--space saloon`), and its staged survey
// (`--roomsBase /rooms/saloon/survey-2026-07-11 [--roomsRev 1]`), drawn as surveyed in the planner's scene.
const SPACE = option("space", "");
const ROOMS_BASE = option("roomsBase", "");
const ROOMS_REV = option("roomsRev", "1");
const CHANNEL = option("channel", "chromium");
const GUESTS = Number(option("guests", SPACE === "" ? "160" : "0"));

/** Camera poses in the hall's frame (metres): position, then the point looked at. */
const POSES = {
  room: [[10.2, 12.6, 13.2], [0, 0.6, 0]],
  plan: [[0, 21.5, 2.3], [0, 0, 0]],
  eye: [[4.2, 2.6, 3.4], [-1.8, 0.2, -1.2]],
  low: [[8.6, 1.5, 3.9], [-2.0, 1.6, -0.8]],
  corner: [[-9.0, 6.5, -4.4], [1.0, 0.4, 0.8]],
  // One table of the dense dinner close up (rounds sit on a 3.24 x 3.35 m grid).
  table: [[3.55, 1.45, 1.75], [1.62, 0.62, 0]],
  // Standing under the fittings, as the scan's panoramas see them.
  dome: [[3.6, 1.7, 2.6], [0, 4.9, 0]],
  rose: [[3.2, 1.7, 0.3], [6.65, 4.3, 3.0]],
};

const DEVICES = {
  desktop: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
  tablet: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  off: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
};

/**
 * Poses for a room shown by `--space`, in its own frame. "opening" is the planner's own opening
 * view (the camera is left where the planner put it); the four sides look in from beyond each
 * wall, above the ceiling, where a surveyed room's near walls and ceiling are not drawn.
 */
const ROOM_POSES = {
  saloon: {
    opening: null,
    plan: [[0, 17, 1.8], [0, 0, 0]],
    "from-fireplace": [[0, 9, 15], [0, 1.5, 0]],
    "from-windows": [[0, 9, -15], [0, 1.5, 0]],
    "from-front": [[17, 9, 0], [0, 1.5, 0]],
    "from-rear": [[-17, 9, 0], [0, 1.5, 0]],
  },
};

const device = DEVICES[PROFILE];
if (device === undefined) throw new Error(`Unknown profile ${PROFILE}`);
const poses = SPACE === "" ? POSES : ROOM_POSES[SPACE];
if (poses === undefined) throw new Error(`No poses for the room ${SPACE}`);
const views = SPACE === "" || process.argv.includes("--views") ? VIEWS : Object.keys(poses);
for (const view of views) if (poses[view] === undefined) throw new Error(`Unknown view ${view}`);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: CHANNEL,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
});
const summary = { base: BASE, profile: PROFILE, mood: MOOD, guests: GUESTS, captures: [], frames: null, drawnBy: null, pageErrors: [], console: [] };
try {
  const context = await browser.newContext(device);
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    summary.pageErrors.push(error.message);
    console.error(`page error: ${error.message}`);
  });
  // What the page logged as an error or a warning (a WebGPU validation message is one of these, not an uncaught error).
  page.on("console", (message) => {
    const type = message.type();
    if (type === "error" || type === "warning") summary.console.push({ type, text: message.text() });
  });
  const room = SPACE === "" ? "" : `&space=${encodeURIComponent(SPACE)}`;
  const survey = ROOMS_BASE === "" ? "" : `&rooms=surveyed&roomsBase=${encodeURIComponent(ROOMS_BASE)}&roomsRev=${encodeURIComponent(ROOMS_REV)}`;
  await page.goto(`${BASE}/dev/planner-lab?render=${PROFILE}&guests=${GUESTS}${room}${survey}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__plannerLab?.ready() === true, undefined, { timeout: 240000, polling: 500 });
  if (SPACE !== "") {
    // How the room's survey stands: drawn with its photographs counted in, or failed with the file and the reason.
    summary.space = SPACE;
    summary.surveyedRoom = await page.evaluate(() => window.__plannerLab.surveyedRoom());
    console.log(`surveyed room: ${JSON.stringify(summary.surveyedRoom)}`);
  }
  // The backend and GPU of the planner's own renderer, not of an adapter asked for here: that
  // would say only that WebGPU could be had, whatever drew the scene.
  const drawnBy = () => page.evaluate(() => window.__plannerLab.drawnBy());
  summary.drawnBy = await drawnBy();
  // The moods are the Grand Hall's own light; another room is shown as photographed.
  if (SPACE === "") await page.evaluate((mood) => { window.__plannerLab.setMood(mood); }, MOOD);
  await page.waitForTimeout(2500);
  for (const view of views) {
    const pose = poses[view];
    if (pose !== null) {
      const [position, target] = pose;
      await page.evaluate(({ position, target }) => { window.__plannerLab.pose(position, target); }, { position, target });
      // The planner's glide, then a still frame long enough for temporal refinement.
      await page.waitForFunction(() => window.__plannerLab.cameraState().gliding === false, undefined, { timeout: 15000, polling: 100 });
    }
    await page.waitForTimeout(1500);
    const file = join(OUT, `${PROFILE}-${SPACE === "" ? MOOD : SPACE}-${view}.png`);
    await page.screenshot({ path: file, type: "png" });
    // Read again for each capture: a renderer that replaced the first after a lost device may draw with another backend.
    const backend = (await drawnBy())?.backend ?? null;
    summary.captures.push({ view, file, backend });
    console.log(`captured ${file} (${backend ?? "backend unknown"})`);
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
console.log(`drawn by: ${summary.drawnBy === null ? "unknown (no renderer was ready)" : `${summary.drawnBy.backend} on ${summary.drawnBy.gpu ?? "a GPU the browser does not name"}`}`);
const logged = (type) => summary.console.filter((entry) => entry.type === type).length;
console.log(`console: ${logged("error")} errors, ${logged("warning")} warnings; page errors: ${summary.pageErrors.length}`);
