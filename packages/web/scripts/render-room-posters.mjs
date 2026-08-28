// Renders a poster for each captured room, from the capture itself.
//
// The front door shows posters, not eight live rooms — eight at once is ~1 GB.
// Rendering them from the real captures means the poster IS the room, covers
// rooms with no photography, and cannot drift from what the viewer shows.
//
// Always shot from INSIDE the room. A capture only ever saw a room's interior,
// so from outside you are looking at the back of a ceiling — noise, not a
// picture of anything. Clipping makes an exterior view possible; it does not
// make it worth looking at.
//
// Two traps this works around, both learned the hard way:
//
//  1. The scene uses frameloop="demand". Once a room finishes loading nothing
//     invalidates, so the compositor never produces another frame and
//     page.screenshot() waits forever. A small drag on the canvas makes
//     OrbitControls invalidate, and the frame lands.
//  2. "Wait until the loading pill is absent" is true BEFORE React mounts it
//     as well as after loading ends, so it returns at t=0 and captures an empty
//     scene. Wait for it to appear first, then to go.
//
// Needs the dev server running with SPLAT_STAGING_ROOT set.
//   node scripts/render-room-posters.mjs [baseUrl] [outDir]
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:5192";
const OUT = process.argv[3] ?? "public/images/rooms";
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

const WIDTH = 1280;
const HEIGHT = 720;

mkdirSync(OUT, { recursive: true });

for (const room of ROOMS) {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  let ok = 0;
  let failed = 0;
  page.on("response", (res) => {
    if (!res.url().includes("/splats/")) return;
    if (res.status() === 200) ok += 1; else failed += 1;
  });

  await page.goto(`${BASE}/room/${room}?bare=1`, { waitUntil: "domcontentloaded" });

  let state = "loaded";
  // Appear, then vanish. Either half alone is a false positive.
  // In bare mode there is no loading pill, so wait on the tiles themselves:
  // every tile the room declares must have come back before the still is taken.
  try {
    await page.waitForFunction(
      () => window.__roomWalk?.complete === true,
      undefined,
      { timeout: 420000 },
    );
  } catch { state = "timeout"; }

  // Make the scene draw a frame; demand-mode will not do it on its own.
  await page.mouse.move(WIDTH / 2, HEIGHT / 2);
  await page.mouse.down();
  await page.mouse.move(WIDTH / 2 + 6, HEIGHT / 2 + 3, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(1200);

  // Read the canvas back rather than screenshotting it. A loaded splat canvas
  // draws on demand, so the compositor never hands Playwright a frame and
  // page.screenshot() waits forever. ?bare=1 turns on preserveDrawingBuffer,
  // which makes toDataURL the one capture path that actually returns.
  let poster = "ok";
  try {
    const data = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      return canvas === null ? null : canvas.toDataURL("image/jpeg", 0.86);
    });
    if (data === null) {
      poster = "no canvas";
    } else {
      writeFileSync(join(OUT, `${room}.jpg`), Buffer.from(data.split(",")[1], "base64"));
    }
  } catch (error) {
    poster = `failed: ${error.message.slice(0, 34)}`;
  }

  console.log(`${room.padEnd(24)} tiles=${ok}/${ok + failed}  ${state.padEnd(8)} poster=${poster}`);
  await browser.close();
}
console.log(`\nPosters in ${OUT}`);
