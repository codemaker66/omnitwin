// Opens the real planner (/plan) on the Grand Hall with a furnished layout
// and no backend (the API is answered from fixtures, as the planner e2e
// specs do), screenshots the whole cockpit, then orbits, zooms, sweeps a
// marquee and drags a table while recording the browser's frame intervals,
// on this machine's GPU, and logs every render pipeline compiled meanwhile.
//
// Needs a dev server or a `vite preview` of a build. A development build
// publishes its camera, so the tour finds the table itself; for a production
// build pass the page point printed by a development run as --drag-at.
// Writes PNGs and tour-<device>.json to the output folder.
//   node scripts/planner-tour.mjs --base http://127.0.0.1:5213 --out D:/claude/x \
//     [--device desktop|phone] [--tables 12] [--drag-world x,z | --drag-at x,y] [--profile-drag]
//     [--cpu-throttle 4]   (a slower main thread, as on a mid-range phone; the GPU is not slowed)
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const BASE = option("base", "http://127.0.0.1:5213");
const OUT = option("out", "D:/claude/grand-hall-planner/captures/tour");
const DEVICE = option("device", "desktop");
const TABLES = Number(option("tables", "12"));
const PROFILE_DRAG = process.argv.includes("--profile-drag");
const PROFILE_LOAD = process.argv.includes("--profile-load");
const CPU_THROTTLE = Number(option("cpu-throttle", "1"));
const API = "http://localhost:3001";
const CONFIG_ID = "tour-config-0001";
const VENUE = { id: "tour-venue-trades", name: "Trades Hall", slug: "trades-hall-glasgow", address: "85 Glassford Street", logoUrl: null, brandColour: null };
const SPACE = {
  id: "tour-space-grand", venueId: VENUE.id, name: "Grand Hall", slug: "grand-hall",
  widthM: "21", lengthM: "10.5", heightM: "7",
  floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }],
};
// Canonical catalogue identities (packages/types/src/asset-catalogue.ts).
const ROUND_WHITE = "aec69e97-d577-5931-ba13-8258dbdd9050";
const TURINI_CHAIR = "7f1fb7a2-5210-57b1-9108-11255c059520";

function layoutObjects(tables) {
  const objects = [];
  let order = 0;
  const object = (asset, x, z, rotationY, groupId) => ({
    id: `00000000-0000-4000-8000-${String(order + 1).padStart(12, "0")}`,
    configurationId: CONFIG_ID, assetDefinitionId: asset,
    positionX: x.toFixed(3), positionY: "0", positionZ: z.toFixed(3),
    rotationX: "0", rotationY: rotationY.toFixed(4), rotationZ: "0", scale: "1",
    sortOrder: order++, metadata: { groupId, clothed: false },
  });
  for (let index = 0; index < tables; index++) {
    const x = -7.2 + (index % 4) * 4.8;
    const z = -3.2 + Math.floor(index / 4) * 3.2;
    const groupId = `tour-group-${String(index)}`;
    objects.push(object(ROUND_WHITE, x, z, 0, groupId));
    for (let seat = 0; seat < 10; seat++) {
      const angle = seat * (Math.PI * 2 / 10) - Math.PI / 2;
      objects.push(object(TURINI_CHAIR, x + Math.cos(angle) * 1.21, z + Math.sin(angle) * 1.21, Math.PI / 2 - angle, groupId));
    }
  }
  return objects;
}

const CONFIG = { id: CONFIG_ID, spaceId: SPACE.id, venueId: VENUE.id, userId: null, name: "Wedding dinner", isPublicPreview: true, revision: 1, objects: layoutObjects(TABLES) };

const DEVICES = {
  desktop: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};
const device = DEVICES[DEVICE];
if (device === undefined) throw new Error(`Unknown device ${DEVICE}`);
mkdirSync(OUT, { recursive: true });

async function stub(page) {
  await page.route(`${API}/venues`, (route) => route.fulfill({ json: { data: [VENUE] } }));
  await page.route(`${API}/venues/${VENUE.id}`, (route) => route.fulfill({ json: { data: { ...VENUE, spaces: [SPACE] } } }));
  await page.route(`${API}/venues/${VENUE.id}/spaces`, (route) => route.fulfill({ json: { data: [SPACE] } }));
  await page.route(`${API}/venues/${VENUE.id}/spaces/${SPACE.id}`, (route) => route.fulfill({ json: { data: SPACE } }));
  await page.route(`${API}/public/configurations`, (route) => route.fulfill({ json: { data: CONFIG } }));
  await page.route(`${API}/public/configurations/${CONFIG_ID}`, (route) => route.fulfill({ json: { data: CONFIG } }));
  await page.route(`${API}/truth-mode/summary*`, (route) => route.fulfill({ json: { data: {
    targetType: "configuration", targetId: CONFIG_ID, source: "Planning context", confidence: "unknown",
    assumption: "Human review required before reliance", evidenceStatus: "not_checked", reviewGate: "Human review required",
    staleState: "unknown", safeWording: ["Planning evidence - human review required before operational reliance."],
    humanReviewRequired: true, counts: { evidenceItems: 0, checkResults: 0, assumptions: 0, reviewGates: 0, staleEvents: 0 },
  } } }));
}

/** Starts recording requestAnimationFrame intervals in the page. */
async function startFrames(page) {
  await page.evaluate(() => {
    const record = { intervals: [], last: performance.now(), running: true };
    window.__tourFrames = record;
    const tick = (now) => {
      if (!record.running) return;
      record.intervals.push(now - record.last);
      record.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Stops the CPU profiler and returns the 30 functions with the most self time. */
async function stopProfile(profiler) {
  const { profile } = await profiler.send("Profiler.stop");
  const self = new Map();
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const dt = profile.timeDeltas ?? [];
  profile.samples.forEach((id, index) => {
    const node = byId.get(id);
    if (node === undefined) return;
    const { functionName, url, lineNumber } = node.callFrame;
    const key = `${functionName || "(anonymous)"} ${url.split("/").slice(-1)[0]}:${String(lineNumber + 1)}`;
    self.set(key, (self.get(key) ?? 0) + (dt[index] ?? 0) / 1000);
  });
  return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
    .map(([name, ms]) => ({ name, ms: Math.round(ms * 10) / 10 }));
}

/**
 * Where to press to drag a table: --drag-at x,y in page pixels, or else the
 * table at --drag-world x,z (default the second row's second table) projected
 * through the camera a development build publishes. Null when neither works.
 */
async function dragTarget(page, box) {
  const fixed = option("drag-at", null);
  if (fixed !== null) {
    const [x, y] = fixed.split(",").map(Number);
    return { x, y };
  }
  const [worldX, worldZ] = option("drag-world", "-2.4,0").split(",").map(Number);
  const point = await page.evaluate(({ worldX, worldZ }) => {
    const camera = window.__venPerf?.camera;
    if (camera === undefined) return null;
    const projected = camera.position.clone().set(worldX, 0.75, worldZ).project(camera);
    return { x: (projected.x + 1) / 2, y: (1 - projected.y) / 2 };
  }, { worldX, worldZ });
  return point === null ? null : { x: box.x + point.x * box.width, y: box.y + point.y * box.height };
}

async function stopFrames(page) {
  return page.evaluate(() => {
    const record = window.__tourFrames;
    record.running = false;
    const intervals = record.intervals.slice(1);
    const sorted = [...intervals].sort((a, b) => a - b);
    const mean = intervals.reduce((sum, value) => sum + value, 0) / Math.max(1, intervals.length);
    return {
      frames: intervals.length,
      meanMs: Math.round(mean * 100) / 100,
      p95Ms: Math.round((sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 100) / 100,
      maxMs: Math.round((sorted[sorted.length - 1] ?? 0) * 100) / 100,
      over20ms: intervals.filter((value) => value > 20).length,
    };
  });
}

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
});
const report = { device: DEVICE, cpuThrottle: CPU_THROTTLE, tables: TABLES, objects: CONFIG.objects.length, steps: [], consoleErrors: [] };
const consoleErrors = new Map();
try {
  const context = await browser.newContext(device);
  const page = await context.newPage();
  if (CPU_THROTTLE > 1) await (await context.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
  page.on("pageerror", (error) => { console.error(`page error: ${error.message}`); });
  page.on("console", (message) => {
    if (message.text().startsWith("[ghp-trace]")) console.log(message.text());
    if (message.type() !== "error") return;
    const text = message.text().slice(0, 300);
    consoleErrors.set(text, (consoleErrors.get(text) ?? 0) + 1);
  });
  await stub(page);
  // Log every render pipeline the page creates, with the time, so stalls
  // can be traced to the material that compiled during them. Three.js labels
  // a pipeline with its material's id; a development build publishes the
  // scene (window.__venPerf), so the log also names the objects drawing it.
  await page.addInitScript(() => {
    // Main-thread tasks over 50 ms: the stalls a person would feel.
    const longTasks = [];
    window.__tourLongTasks = longTasks;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push({ at: entry.startTime, ms: entry.duration });
      }).observe({ type: "longtask", buffered: true });
    } catch { /* Long-task timing is optional. */ }
    const created = [];
    window.__tourPipelines = created;
    const owners = (label) => {
      const match = /_(\d+)$/.exec(label);
      const scene = window.__venPerf?.scene;
      if (match === null || scene === undefined) return "";
      const id = Number(match[1]);
      const found = [];
      scene.traverse((object) => {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        const material = materials.find((candidate) => candidate?.id === id);
        if (material === undefined) return;
        const path = [];
        for (let node = object; node !== null && node !== scene; node = node.parent) path.unshift(node.name || node.type);
        const colour = material.color?.getHexString?.() ?? "";
        found.push(`${path.slice(-5).join(">")} [${object.geometry?.type ?? ""} #${colour} a${String(material.opacity)}]`);
      });
      return found.slice(0, 2).join(" | ");
    };
    const patch = () => {
      const proto = globalThis.GPUDevice?.prototype;
      if (proto === undefined || proto.__tourPatched === true) return;
      proto.__tourPatched = true;
      for (const name of ["createRenderPipeline", "createRenderPipelineAsync", "createComputePipeline", "createComputePipelineAsync"]) {
        const original = proto[name];
        proto[name] = function (descriptor) {
          const label = descriptor?.label ?? "";
          // What distinguishes two pipelines of one material: topology,
          // culling, sample count, colour targets, depth and vertex layout.
          const state = descriptor?.primitive === undefined ? "" : [
            descriptor.primitive.topology, descriptor.primitive.cullMode ?? "", descriptor.primitive.frontFace ?? "",
            `msaa${String(descriptor.multisample?.count ?? 1)}`,
            `targets${String(descriptor.fragment?.targets?.length ?? 0)}`,
            descriptor.depthStencil?.format ?? "nodepth",
            (descriptor.vertex?.buffers ?? []).map((buffer) => String(buffer?.arrayStride ?? 0)).join("+"),
          ].join("/");
          created.push({ at: performance.now(), kind: name, label, state, owners: owners(label) });
          return original.call(this, descriptor);
        };
      }
    };
    patch();
  });
  const loadProfiler = PROFILE_LOAD ? await context.newCDPSession(page) : null;
  if (loadProfiler !== null) {
    await loadProfiler.send("Profiler.enable");
    await loadProfiler.send("Profiler.setSamplingInterval", { interval: 500 });
    await loadProfiler.send("Profiler.start");
  }
  await page.goto(`${BASE}/plan/${CONFIG_ID}`, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(() => document.querySelectorAll("canvas").length >= 1 && document.querySelector('[data-testid="cockpit-shell"]') !== null, undefined, { timeout: 120000, polling: 500 });
  } catch (error) {
    await page.screenshot({ path: join(OUT, `${DEVICE}-stuck.png`) });
    console.error(`The planner did not open: ${(await page.evaluate(() => document.body.innerText)).slice(0, 600)}`);
    throw error;
  }
  // Let the hall's photographs and relief arrive and the opening glide finish.
  await page.waitForTimeout(16000);
  if (loadProfiler !== null) {
    report.loadProfile = await stopProfile(loadProfiler);
    for (const entry of report.loadProfile) console.log(`load ${String(entry.ms).padStart(8)} ms  ${entry.name}`);
  }
  await page.screenshot({ path: join(OUT, `${DEVICE}-planner.png`) });
  console.log(`captured ${DEVICE}-planner.png`);

  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("No canvas");
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  const settledAt = await page.evaluate(() => performance.now());
  // Orbit: a right-button drag across the stage.
  await startFrames(page);
  await page.mouse.move(centre.x - 200, centre.y);
  await page.mouse.down({ button: "right" });
  for (let step = 0; step <= 60; step++) {
    await page.mouse.move(centre.x - 200 + step * 7, centre.y + Math.sin(step / 10) * 30);
    await page.waitForTimeout(16);
  }
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(600);
  report.steps.push({ step: "orbit", ...(await stopFrames(page)) });
  await page.screenshot({ path: join(OUT, `${DEVICE}-after-orbit.png`) });

  // Zoom in and out with the wheel.
  await startFrames(page);
  for (let step = 0; step < 12; step++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
  await page.waitForTimeout(500);
  for (let step = 0; step < 12; step++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(40); }
  await page.waitForTimeout(600);
  report.steps.push({ step: "zoom", ...(await stopFrames(page)) });

  // Marquee: press on the open floor at the middle of the stage and sweep a
  // selection box across the nearest tables.
  await startFrames(page);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  for (let step = 0; step <= 40; step++) {
    await page.mouse.move(centre.x + step * 4, centre.y + step * 2);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
  report.steps.push({ step: "marquee", ...(await stopFrames(page)) });

  // Select a table and drag it, under the CPU profiler when asked.
  const target = await dragTarget(page, box);
  if (target === null) {
    console.log("drag skipped: pass --drag-at x,y (a production build publishes no camera)");
  } else {
    console.log(`drag target ${String(Math.round(target.x))},${String(Math.round(target.y))}`);
    const profiler = PROFILE_DRAG ? await context.newCDPSession(page) : null;
    if (profiler !== null) {
      await profiler.send("Profiler.enable");
      await profiler.send("Profiler.setSamplingInterval", { interval: 200 });
      await profiler.send("Profiler.start");
    }
    await startFrames(page);
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(300);
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    for (let step = 0; step <= 40; step++) {
      await page.mouse.move(target.x + step * 3, target.y + step);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(700);
    report.steps.push({ step: "drag", ...(await stopFrames(page)) });
    if (profiler !== null) report.dragProfile = await stopProfile(profiler);
  }
  report.latePipelines = await page.evaluate((after) => (window.__tourPipelines ?? []).filter((entry) => entry.at > after)
    .map((entry) => `${String(Math.round(entry.at - after))} ms ${entry.kind} ${entry.label} {${entry.state}} ${entry.owners}`), settledAt);
  for (const line of report.latePipelines) console.log(`pipeline after settle: ${line}`);
  // A material compiled more than once while loading means its render target
  // or pass changed under it (each change recompiles every material).
  report.loadPipelines = await page.evaluate((before) => {
    const loading = (window.__tourPipelines ?? []).filter((entry) => entry.at <= before);
    const counts = new Map();
    for (const entry of loading) counts.set(entry.label, (counts.get(entry.label) ?? 0) + 1);
    const repeated = [...counts.entries()].filter(([, count]) => count > 1);
    const times = loading.map((entry) => entry.at);
    return {
      total: loading.length,
      repeatedMaterials: repeated.length,
      firstMs: Math.round(Math.min(...times)),
      lastMs: Math.round(Math.max(...times)),
      examples: repeated.slice(0, 6).map(([label, count]) => `${label} x${String(count)}`),
      // Per render target (samples/colour targets/depth): how many compiled, when.
      targets: Object.fromEntries([...loading.reduce((byTarget, entry) => {
        const key = entry.state.split("/").slice(3, 6).join("/");
        const seen = byTarget.get(key) ?? { count: 0, firstMs: Infinity, lastMs: 0 };
        byTarget.set(key, { count: seen.count + 1, firstMs: Math.min(seen.firstMs, Math.round(entry.at)), lastMs: Math.max(seen.lastMs, Math.round(entry.at)) });
        return byTarget;
      }, new Map())]),
    };
  }, settledAt);
  console.log(`pipelines while loading: ${JSON.stringify(report.loadPipelines)}`);
  if (process.argv.includes("--dump-load")) {
    const lines = await page.evaluate((before) => (window.__tourPipelines ?? []).filter((entry) => entry.at <= before)
      .map((entry) => `${String(Math.round(entry.at))} ${entry.label} {${entry.state.split("/").slice(3, 6).join("/")}} ${entry.owners}`), settledAt);
    for (const line of lines) console.log(`load pipeline: ${line}`);
  }
  report.longTasks = await page.evaluate((before) => {
    const tasks = window.__tourLongTasks ?? [];
    const summary = (list) => ({
      count: list.length,
      totalMs: Math.round(list.reduce((sum, task) => sum + task.ms, 0)),
      maxMs: Math.round(Math.max(0, ...list.map((task) => task.ms))),
      over100: list.filter((task) => task.ms > 100).map((task) => `${String(Math.round(task.at))}:${String(Math.round(task.ms))}`),
    });
    return { loading: summary(tasks.filter((task) => task.at <= before)), interacting: summary(tasks.filter((task) => task.at > before)) };
  }, settledAt);
  console.log(`long tasks: ${JSON.stringify(report.longTasks)}`);
  for (const entry of report.dragProfile ?? []) console.log(`${String(entry.ms).padStart(8)} ms  ${entry.name}`);

  await page.screenshot({ path: join(OUT, `${DEVICE}-after-drag.png`) });
} finally {
  await browser.close();
}
report.consoleErrors = [...consoleErrors.entries()].sort((a, b) => b[1] - a[1]).map(([text, count]) => ({ count, text }));
for (const { count, text } of report.consoleErrors.slice(0, 8)) console.log(`console.error x${String(count)}: ${text}`);
writeFileSync(join(OUT, `tour-${DEVICE}.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.steps));
