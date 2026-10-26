// Captures the planner's furnished Grand Hall under the real sky at named
// moments, so furniture can be judged in the light it will be seen in: the
// low morning sun through the windows, full morning sun, the chandeliers and
// candles after dark, the full moon, and the street's light with the moon
// down. Each moment sets the hall's clock (hall-time-store) on the
// development lab (/dev/planner-lab), then frames named views.
//
// Needs the dev server running (the clock is set through Vite's module
// graph). Writes PNGs and summary.json to the output folder; nothing in the
// repository.
//   node scripts/furniture-light-frames.mjs --base http://127.0.0.1:5261 --out D:/claude/x \
//     [--profile desktop|tablet|phone] [--guests 180] [--states morning,sun,night,moon,street] \
//     [--views room,table,chair] [--frames 0] [--cpu 1] [--refit 1]
//
// --refit 1 redraws the sun's and moon's shadow map in every measured frame.
// The map is drawn only when asked (hall-sun.ts): after the sun moves or the
// layout changes, so this times what each such change costs.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const BASE = option("base", "http://127.0.0.1:5261");
const OUT = option("out", "D:/claude/furniture-rebuild-20261026/frames/latest");
const PROFILE = option("profile", "desktop");
const GUESTS = Number(option("guests", "180"));
const STATES = option("states", "morning,sun,night,moon,street").split(",").filter((state) => state.length > 0);
const VIEWS = option("views", "room,table,chair").split(",").filter((view) => view.length > 0);
const FRAMES = Number(option("frames", "0"));
const CPU = Number(option("cpu", "1"));
const REFIT = option("refit", "0") === "1";
/** Seat the dinner on another chair: its catalogue slug (the lab furnishes with the planner's default chair). */
const CHAIR = option("chair", "");
/** `wedding` adds the rest of a wedding beside the rounds (see WEDDING). */
const LAYOUT = option("layout", "");

/**
 * Moments over Trades Hall (GMT), chosen from hallSkyAt: the windows face
 * 101° true onto Glassford Street, so only a morning sun high enough to clear
 * the buildings across the street comes in (none does in late October), and
 * 27 October 2026 has a nearly full moon that stands square to the windows
 * late in the evening.
 */
const MOMENTS = {
  // Sun 15.8° up at 91°, square to the windows: golden morning light.
  morning: "2026-08-20T07:00:00Z",
  // Sun 37.5° up at 104°, square to the windows: full morning sun across the floor.
  sun: "2026-06-21T08:30:00Z",
  // Late October morning: the sun 18.7° up, behind the street's buildings.
  autumn: "2026-10-27T10:30:00Z",
  // Sun off the windows: the daylight the scan was made in, no direct sun.
  noon: "2026-10-27T13:00:00Z",
  // Night: chandeliers, frieze lights and the candles lit; moon low in the east.
  night: "2026-10-27T19:00:00Z",
  // The full moon 36° up at 100°, straight at the windows.
  moon: "2026-10-27T21:30:00Z",
  // The moon below the horizon: the city's light from George Square.
  street: "2026-10-30T19:00:00Z",
};

/** Camera poses in the hall's frame (metres): position, then the point looked at. */
const POSES = {
  room: [[10.2, 12.6, 13.2], [0, 0.6, 0]],
  plan: [[0, 21.5, 2.3], [0, 0, 0]],
  eye: [[4.2, 2.6, 3.4], [-1.8, 0.2, -1.2]],
  // One table of the dinner close up (rounds sit on a 3.24 x 3.35 m grid).
  table: [[3.55, 1.45, 1.75], [1.62, 0.62, 0]],
  // A chair at a guest's height, close enough to read its frame and fabric.
  chair: [[2.35, 1.05, 1.55], [1.62, 0.45, 0.62]],
  // Toward the window wall (−z), over the floor where the sun and the moon fall.
  windows: [[1.5, 2.4, 4.6], [-2.0, 0.2, -1.5]],
  // The shadow proof: June 08:30's sun lays a strip across the floor from the
  // middle window (x ≈ −0.25, from the wall to z ≈ 0, read off the plan view),
  // through the east chair of the window row's third round. From the side,
  // the chair and its shadow on the boards; against the light, the shadows
  // running toward the viewer.
  sunchair: [[1.25, 1.05, -1.85], [-0.4, 0.25, -3.05]],
  sunback: [[-0.15, 0.95, -0.55], [-0.35, 0.3, -3.2]],
  // The wedding layout (--layout wedding): across the dance floor to the top table and the bar.
  wedding: [[7.6, 3.3, -1.4], [-1.2, 0.4, 3.6]],
  dance: [[3.4, 1.7, 0.9], [-0.2, 0.1, 3.6]],
  top: [[-5.6, 1.5, 1.4], [-5.6, 0.75, 4.4]],
  bar: [[5.4, 1.5, 1.6], [9.4, 0.8, 3.4]],
};

/**
 * The rest of a wedding beside the lab's rounds (row 3 of the lab's grid is
 * left free by 120 guests): a top table of three white trestles with its
 * chairs facing the room, a four by four dance floor, a two-deck stage, the
 * bar along the end wall, two poseurs and the cake table. Positions in the
 * hall's frame, metres; chairs face −z at rotation 0.
 */
const WEDDING = [
  ...[-7.32, -5.49, -3.66].map((x) => ({ slug: "trestle-6ft-white", x, z: 4.25 })),
  ...[-7.93, -7.32, -6.71, -6.1, -5.49, -4.88, -4.27, -3.66, -3.05].map((x) => ({ slug: "@chair", x, z: 4.88 })),
  ...[-1.365, -0.455, 0.455, 1.365].flatMap((x) => [1.98, 2.89, 3.8, 4.71].map((z) => ({ slug: "dancefloor-panel", x, z }))),
  { slug: "staging-deck-6x4", x: 5.0, z: 4.5 },
  { slug: "staging-deck-6x4", x: 6.83, z: 4.5 },
  { slug: "bar-counter", x: 9.85, z: 3.3, rotationY: Math.PI / 2 },
  { slug: "poseur-table-white", x: 2.75, z: 2.2 },
  { slug: "poseur-table-black", x: 3.2, z: 3.3 },
  { slug: "cake-cutting-table", x: -2.55, z: 2.85 },
];

const DEVICES = {
  desktop: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
  tablet: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

const device = DEVICES[PROFILE];
if (device === undefined) throw new Error(`Unknown profile ${PROFILE}`);
for (const state of STATES) if (MOMENTS[state] === undefined) throw new Error(`Unknown state ${state}`);
for (const view of VIEWS) if (POSES[view] === undefined) throw new Error(`Unknown view ${view}`);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
});
const summary = { base: BASE, profile: PROFILE, guests: GUESTS, cpu: CPU, captures: [], frames: {}, adapter: null };
try {
  const context = await browser.newContext(device);
  const page = await context.newPage();
  page.on("pageerror", (error) => { console.error(`page error: ${error.message}`); });
  if (CPU > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  }
  await page.goto(`${BASE}/dev/planner-lab?render=${PROFILE}&guests=${GUESTS}&sky=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__plannerLab?.ready() === true, undefined, { timeout: 240000, polling: 500 });
  if (CHAIR.length > 0) {
    // Every chair becomes the asked-for one, moved toward its table by half
    // the difference in depth, so its front stays where the ring seats it.
    summary.chair = await page.evaluate(async (slug) => {
      // The page's own module instances: once a module has been hot-updated,
      // Vite serves it with a ?t= stamp, and a bare import would load a
      // second, empty copy of the store.
      const live = (path) => performance.getEntriesByType("resource").map((entry) => entry.name).find((name) => new URL(name).pathname === path) ?? path;
      const { usePlacementStore } = await import(live("/src/stores/placement-store.ts"));
      const { getCatalogueItem, getCatalogueItemBySlug } = await import(live("/src/lib/catalogue.ts"));
      const chair = getCatalogueItemBySlug(slug);
      if (chair === undefined) throw new Error(`No catalogue item ${slug}`);
      const items = usePlacementStore.getState().placedItems;
      const tables = items.filter((item) => getCatalogueItem(item.catalogueItemId)?.category === "table");
      let swapped = 0;
      const next = items.map((item) => {
        const current = getCatalogueItem(item.catalogueItemId);
        if (current?.category !== "chair") return item;
        let nearest = null;
        for (const table of tables) {
          const d = Math.hypot(table.x - item.x, table.z - item.z);
          if (nearest === null || d < nearest.d) nearest = { table, d };
        }
        const shift = (current.depth - chair.depth) / 2;
        let { x, z } = item;
        if (nearest !== null && nearest.d > 1e-6) {
          x += ((nearest.table.x - item.x) / nearest.d) * shift;
          z += ((nearest.table.z - item.z) / nearest.d) * shift;
        }
        swapped += 1;
        return { ...item, catalogueItemId: chair.id, x, z };
      });
      usePlacementStore.setState({ placedItems: next });
      return { slug, swapped };
    }, CHAIR);
    await page.waitForTimeout(2500);
  }
  if (LAYOUT === "wedding") {
    summary.layout = await page.evaluate(async ({ pieces, chair }) => {
      const live = (path) => performance.getEntriesByType("resource").map((entry) => entry.name).find((name) => new URL(name).pathname === path) ?? path;
      const { usePlacementStore } = await import(live("/src/stores/placement-store.ts"));
      const { getCatalogueItemBySlug } = await import(live("/src/lib/catalogue.ts"));
      const { createPlacedItem } = await import(live("/src/lib/placement.ts"));
      const added = [];
      for (const piece of pieces) {
        const slug = piece.slug === "@chair" ? (chair.length > 0 ? chair : "burgess-turini-18-3") : piece.slug;
        const item = getCatalogueItemBySlug(slug);
        if (item === undefined) throw new Error(`No catalogue item ${slug}`);
        added.push(createPlacedItem(item.id, piece.x, piece.z, piece.rotationY ?? 0));
      }
      usePlacementStore.setState({ placedItems: [...usePlacementStore.getState().placedItems, ...added] });
      return { added: added.length };
    }, { pieces: WEDDING, chair: CHAIR });
    await page.waitForTimeout(3000);
  }
  summary.adapter = await page.evaluate(async () => {
    const gpu = navigator.gpu;
    if (gpu === undefined) return "no WebGPU";
    const adapter = await gpu.requestAdapter();
    return adapter === null ? "no adapter" : `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`.trim();
  });
  for (const state of STATES) {
    const at = Date.parse(MOMENTS[state]);
    await page.evaluate(async (time) => {
      const live = (path) => performance.getEntriesByType("resource").map((entry) => entry.name).find((name) => new URL(name).pathname === path) ?? path;
      const { useHallTimeStore } = await import(live("/src/stores/hall-time-store.ts"));
      useHallTimeStore.getState().setTime(time);
    }, at);
    // The sky publishes, the shadow map refits and the mood settles.
    await page.waitForTimeout(2500);
    for (const view of VIEWS) {
      const [position, target] = POSES[view];
      await page.evaluate(({ position, target }) => { window.__plannerLab.pose(position, target); }, { position, target });
      await page.waitForFunction(() => window.__plannerLab.cameraState().gliding === false, undefined, { timeout: 15000, polling: 100 });
      // A still frame, long enough for temporal refinement to converge.
      await page.waitForTimeout(1500);
      const file = join(OUT, `${PROFILE}-${state}-${view}.png`);
      await page.screenshot({ path: file, type: "png" });
      summary.captures.push({ state, view, file });
      console.log(`captured ${file}`);
    }
    if (FRAMES > 0) {
      const refitting = !REFIT ? 0 : await page.evaluate(() => {
        const scene = window.__venPerf.scene;
        const lights = [];
        scene.traverse((object) => { if (object.isDirectionalLight === true && object.castShadow === true) lights.push(object); });
        const previous = scene.onBeforeRender;
        const counts = { frames: 0, redrawn: 0 };
        window.__refitCounts = counts;
        window.__refitRestore = () => { scene.onBeforeRender = previous; };
        scene.onBeforeRender = function (renderer, renderedScene, camera, ...rest) {
          // Only the view's own render, not the shadow pass inside it.
          if (camera.isPerspectiveCamera === true) {
            counts.frames += 1;
            // A request the last frame cleared is a map it drew.
            for (const light of lights) {
              if (light.shadow.needsUpdate === false) counts.redrawn += 1;
              light.shadow.needsUpdate = true;
            }
            // three draws a map at most once a node frame (ShadowNode.updateBefore),
            // and a frame measured in a loop may not pass an animation tick.
            renderer._nodes.nodeFrame.update();
          }
          return previous.call(this, renderer, renderedScene, camera, ...rest);
        };
        return lights.length;
      });
      if (REFIT) console.log(`refitting ${refitting} shadow map(s) every frame`);
      const frames = await page.evaluate((count) => window.__plannerLab.measure(count, true), FRAMES);
      const gpu = await page.evaluate((count) => window.__plannerLab.measureGpu(count), FRAMES);
      if (REFIT) {
        const counts = await page.evaluate(() => { window.__refitRestore?.(); return window.__refitCounts; });
        console.log(`refit: ${counts.redrawn} maps drawn over ${counts.frames} frames`);
      }
      // What a frame draws, and what the furniture's instanced batches hold:
      // triangles seen, and triangles cast into the sun's map.
      const load = await page.evaluate(() => {
        const perf = window.__venPerf;
        if (perf === undefined) return null;
        const render = perf.gl.info?.render ?? {};
        let seen = 0;
        let cast = 0;
        let batches = 0;
        perf.scene.traverse((object) => {
          if (object.isInstancedMesh !== true) return;
          const geometry = object.geometry;
          const triangles = ((geometry.index?.count ?? geometry.getAttribute("position").count) / 3) * object.count;
          const material = Array.isArray(object.material) ? object.material[0] : object.material;
          if (typeof material?.name !== "string" || !material.name.startsWith("crafted:") && !object.name.includes("furniture")) return;
          batches += 1;
          if (material.name === "crafted:shadow-caster" || material.name === "crafted:shadow-sheet") cast += triangles;
          else if (material.name === "crafted:contact") return;
          else {
            seen += triangles;
            if (object.castShadow) cast += triangles;
          }
        });
        return { drawCalls: render.drawCalls ?? render.calls ?? null, triangles: render.triangles ?? null, furnitureBatches: batches, furnitureSeen: seen, furnitureCast: cast };
      });
      summary.frames[state] = { frames, gpu, load };
      console.log(`${state} frames: ${JSON.stringify(frames)} gpu: ${JSON.stringify(gpu)} load: ${JSON.stringify(load)}`);
    }
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `summary-${PROFILE}.json`), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`adapter: ${summary.adapter}`);
