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
// Wait for actual room draw readiness, then ask the development-only capture
// hook to draw the unchanged live camera into a same-device render target.
// Native WebGPU/WebGL readback does not depend on a preserved canvas buffer.
//
// Needs the dev server running with SPLAT_STAGING_ROOT set.
//   node scripts/render-room-posters.mjs [baseUrl] [outDir] [roomSlug ...]
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
const selectedRooms = process.argv.length > 4 ? process.argv.slice(4) : ROOMS;
for (const room of selectedRooms) {
  if (!ROOMS.includes(room)) throw new Error(`Unknown captured room: ${room}`);
}

const WIDTH = 1280;
const HEIGHT = 720;

mkdirSync(OUT, { recursive: true });
let posterFailures = 0;

for (const room of selectedRooms) {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  let ok = 0;
  let failed = 0;
  try {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    page.on("response", (res) => {
      if (!res.url().includes("/splats/")) return;
      if (res.status() === 200) ok += 1; else failed += 1;
    });

    await page.goto(`${BASE}/room/${room}?bare=1`, { waitUntil: "domcontentloaded" });

    await page.waitForFunction(
      () => window.__roomWalk?.complete === true,
      undefined,
      { timeout: 420000 },
    );
    const capture = await page.evaluate(async () => {
      if (!window.__roomWalk?.firstView) {
        throw new Error("Room has not reached its first drawn view");
      }
      if (typeof window.__roomPosterCapture !== "function") {
        throw new Error("Native poster capture requires the development bare-room route");
      }
      const canvas = document.querySelector("canvas");
      if (canvas === null) throw new Error("Room canvas is missing");
      const result = await window.__roomPosterCapture();
      if (result.width !== canvas.width || result.height !== canvas.height) {
        throw new Error("Native poster dimensions do not match the live canvas");
      }
      return result;
    });
    const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(capture.dataUrl);
    if (match === null) throw new Error("Native poster capture returned invalid JPEG data");
    const jpeg = Buffer.from(match[1], "base64");
    if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg.at(-2) !== 0xff || jpeg.at(-1) !== 0xd9) {
      throw new Error("Native poster capture returned an incomplete JPEG");
    }
    writeFileSync(join(OUT, `${room}.jpg`), jpeg);
    console.log(`${room.padEnd(24)} tiles=${ok}/${ok + failed} poster=ok ${capture.width}x${capture.height}`);
  } catch (error) {
    posterFailures += 1;
    console.error(`${room.padEnd(24)} tiles=${ok}/${ok + failed} poster=failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await browser.close();
  }
}
console.log(`\n${selectedRooms.length - posterFailures}/${selectedRooms.length} posters written to ${OUT}`);
if (posterFailures > 0) process.exitCode = 1;
