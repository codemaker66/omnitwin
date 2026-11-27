// Photo-match: the planner's modelled front (?facade=1) drawn from photograph A's camera, to lay
// its edges on the photograph's (warp_compare.py, fit_similarity.py; README "The front").
//
// Photograph A (packages/web/public/images/venue/grand-hall-facade-3.jpg, Arcaid, reference only)
// is 1400 x 990 px, focal 895 px, its image plane vertical (a shift lens) with the horizon at row
// 731.1, the camera on the building's axis 4.492 m over the pavement. Its distance is solved, not
// assumed: drawn from 24.01 m in front of the DSM's front line (planner z -7.158), the render's
// edges needed a 1.0305 scale to lie on the photograph's, so the camera stands 24.12 m from the
// links' face (z -6.312), at planner z -30.432, where the same fit returns 1.000.
//
// The planner's orbit keeps a camera 3.6 degrees or more off the horizontal, so the frame is drawn
// pitched down PITCH_DEG by the planner's own pose and frame loop, 2 x 731 px tall with the horizon
// near its middle; warp_compare.py turns it level about the camera's centre and keeps the
// photograph's rows. The front is drawn uncut here only (a camera this low cuts it with the
// window wall).
//
// Needs the web dev server (pnpm --filter @omnitwin/web dev) and installed Chrome: Playwright's
// own headless shell cannot load dxil.dll, so WebGPU fails there and the planner draws on WebGL2.
// Usage: node tools/grand-hall-survey/front/photomatch.mjs --out <dir> [--base http://localhost:5173]
//        [--query "sky=1&guests=0&facade=1"] [--time ISO] [--z -30.432] [--channel chrome]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(new URL("../../../packages/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const out = arg("out", null);
if (out === null) throw new Error("photomatch.mjs: --out <dir> is required");
const base = arg("base", "http://localhost:5173");
const query = arg("query", "sky=1&guests=0&facade=1");
const time = arg("time", "2026-06-21T09:30:00+01:00");
mkdirSync(out, { recursive: true });

const FOCAL = 895;
const WIDTH = 1400;
const HORIZON = 731.1;
const HEIGHT = Math.round(2 * HORIZON);
const PITCH_DEG = 4;
const position = [-0.025, 4.492 - 3.79, Number(arg("z", "-30.432"))];
const reach = 30;
const target = [position[0], position[1] - reach * Math.tan((PITCH_DEG * Math.PI) / 180), position[2] + reach];
const vfovDeg = (2 * Math.atan((HEIGHT / 2) / FOCAL) * 180) / Math.PI;

const browser = await chromium.launch({
  headless: true,
  channel: arg("channel", "chrome"),
  args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--enable-unsafe-webgpu",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
});
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
await page.goto(`${base}/dev/planner-lab?${query}`, { waitUntil: "load" });
await page.waitForFunction(() => window.__plannerLab?.ready?.() === true, null, { timeout: 180_000, polling: 500 });
await page.evaluate(async ({ at, fov }) => {
  const store = await import("/src/stores/hall-time-store.ts");
  store.useHallTimeStore.getState().setTime(Date.parse(at));
  const cut = await import("/src/components/grand-hall/hall-exterior-cut.ts");
  // At every draw, after the planner's own frame has written the window wall's cut: uncut.
  cut.hallFrontCut.onRenderUpdate(() => 100);
  const cam = window.__venPerf.camera;
  cam.fov = fov;
  cam.updateProjectionMatrix();
}, { at: time, fov: vfovDeg });
let held = null;
for (let attempt = 0; attempt < 4 && held === null; attempt++) {
  // The lab's glide starts wherever the camera is: stand it at the pose first.
  await page.evaluate(({ position, target }) => {
    window.__venPerf.camera.position.set(position[0], position[1], position[2]);
    window.__plannerLab.pose(position, target);
  }, { position, target });
  await page.evaluate(() => window.__plannerLab.advance(150));
  const now = await page.evaluate(() => window.__plannerLab.cameraState().position);
  if (Math.hypot(now[0] - position[0], now[1] - position[1], now[2] - position[2]) < 0.05) held = now;
}
// Streamed surfaces arrive in real time, not in stepped frames.
await page.waitForTimeout(4000);
await page.evaluate(() => window.__plannerLab.advance(30));
const camera = await page.evaluate(() => {
  const cam = window.__venPerf.camera;
  cam.updateMatrixWorld();
  const e = cam.matrixWorld.elements;
  // The camera looks down its -z: its forward vector and fov as drawn.
  return { position: [cam.position.x, cam.position.y, cam.position.z], forward: [-e[8], -e[9], -e[10]], fov: cam.fov, aspect: cam.aspect };
});
const backend = await page.evaluate(() => document.querySelector("canvas")?.dataset.backend ?? "none");
await page.screenshot({ path: join(out, "render-full.png") });
writeFileSync(join(out, "camera.json"), JSON.stringify({
  requested: { position, target, vfovDeg, pitchDeg: PITCH_DEG }, held: held !== null, backend, camera, time, query,
  width: WIDTH, height: HEIGHT, focal: FOCAL, horizon: HORIZON,
}, null, 2), "utf-8");
console.log(JSON.stringify({ held: held !== null, backend, camera }));
await browser.close();
if (held === null) process.exitCode = 1;
