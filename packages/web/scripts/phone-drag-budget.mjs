// ---------------------------------------------------------------------------
// The phone drag budget: the planner's main-thread work per frame while a
// finger moves the view or a piece, on an emulated phone, on the real GPU.
//
// Opens the real planner (/plan) on a production build (`vite preview`) with
// fixture API answers (as planner-governor.mjs), on an empty floor or one with
// fourteen rounds of ten, and drags one finger across the room with moves sent
// on a 60 Hz clock, the way a finger reports, whatever the page's pace. Each
// drawn frame is charged the main thread's animation-frame callbacks and input
// listeners since the frame before; render passes, draws, and every shader
// module and pipeline created are counted per frame from the WebGPU calls.
//
// It fails (exit 1) when, during a drag:
//   - frame plus input work at the 95th percentile exceeds the budget: 33 ms
//     at a 4x CPU throttle (this week's bar), 4.2 ms unthrottled;
//   - more than 3 render passes are drawn in a frame (95th percentile);
//   - any shader module or render pipeline is created, from the touch down
//     until 300 ms after the lift.
// A throttled figure is only a measurement on a quiet machine: above 15 %
// system CPU the 4x verdict is reported as unmeasured (the shared-PC rule).
//
//   node scripts/phone-drag-budget.mjs --base http://127.0.0.1:4173 \
//     [--floor empty|rounds] [--throttle 1|4] [--gestures orbit,place] [--out DIR] \
//     [--query pf=leanMotionPipeline] [--label NAME]
// The build needs no Clerk key in a mode other than production:
//   pnpm exec vite build --mode budget && pnpm exec vite preview --mode budget
// ---------------------------------------------------------------------------
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const BASE = option("base", "http://127.0.0.1:4173");
const FLOOR = option("floor", "empty");
const THROTTLE = Number(option("throttle", "1"));
const GESTURES = option("gestures", "orbit,place").split(",").filter(Boolean);
const OUT = option("out", "D:/claude/planner-p-20261025/budget");
const MOVES = Number(option("moves", "90"));
const LABEL = option("label", "run");
/** Appended to the planner's address, e.g. the feature switches (`pf=`, lib/planner-features.ts). */
const QUERY = option("query", "");
/** Main-thread work per frame allowed at the 95th percentile, ms. */
const BUDGET_MS = THROTTLE >= 4 ? 33 : 4.2;
const MAX_PASSES = 3;
const QUIET_CPU = 15;

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

/** Fourteen rounds of ten in four rows across the hall, as a wedding dinner sets them. */
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
    const x = -7.8 + (index % 4) * 5.2;
    const z = -3.6 + Math.floor(index / 4) * 2.6;
    const groupId = `budget-group-${String(index)}`;
    objects.push(object(ROUND_WHITE, x, z, 0, groupId));
    for (let seat = 0; seat < 10; seat++) {
      const angle = seat * (Math.PI * 2 / 10) - Math.PI / 2;
      objects.push(object(TURINI_CHAIR, x + Math.cos(angle) * 1.21, z + Math.sin(angle) * 1.21, Math.PI / 2 - angle, groupId));
    }
  }
  return objects;
}

const CONFIG = {
  id: CONFIG_ID, spaceId: SPACE.id, venueId: VENUE.id, userId: null, name: "Phone drag budget", isPublicPreview: true, revision: 1,
  objects: layoutObjects(FLOOR === "rounds" ? 14 : 0),
};

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

/** Injected before the page's own scripts: what each drawn frame cost the main thread and the GPU API. */
function instrument() {
  const tr = { draws: [], raf: [], input: [], frames: [], longtasks: [] };
  window.__budget = tr;
  const nativeRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => nativeRaf((stamp) => {
    const t = performance.now();
    try { callback(stamp); } finally { tr.raf.push([t, performance.now() - t]); }
  });
  // Every pointer, touch and wheel listener the page adds is timed.
  const timedTypes = new Set(["pointerdown", "pointermove", "pointerup", "pointercancel", "touchstart", "touchmove", "touchend", "wheel", "mousemove", "click"]);
  const wrapped = new WeakMap();
  const timedFor = (listener, key) => {
    let byKey = wrapped.get(listener);
    if (byKey === undefined) { byKey = new Map(); wrapped.set(listener, byKey); }
    let timed = byKey.get(key);
    if (timed === undefined) {
      timed = function timedListener(event) {
        const t = performance.now();
        try { return typeof listener === "function" ? listener.call(this, event) : listener.handleEvent(event); }
        finally { tr.input.push([t, performance.now() - t]); }
      };
      byKey.set(key, timed);
    }
    return timed;
  };
  const capture = (options) => (typeof options === "boolean" ? options : options?.capture === true);
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (listener === null || listener === undefined || !timedTypes.has(type)) return add.call(this, type, listener, options);
    return add.call(this, type, timedFor(listener, `${type}|${String(capture(options))}`), options);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const timed = listener === null || listener === undefined ? undefined : wrapped.get(listener)?.get(`${type}|${String(capture(options))}`);
    return remove.call(this, type, timed ?? listener, options);
  };
  try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) tr.longtasks.push([entry.startTime, entry.duration]); }).observe({ type: "longtask", buffered: true }); } catch { /* unsupported */ }
  if (typeof GPUCanvasContext === "undefined") return;
  const counts = { pass: 0, draw: 0, shader: 0, pipeline: 0 };
  const count = (proto, name, key) => {
    const original = proto?.[name];
    if (typeof original !== "function") return;
    proto[name] = function (...args) { counts[key] += 1; return original.apply(this, args); };
  };
  count(GPUCommandEncoder.prototype, "beginRenderPass", "pass");
  count(GPURenderPassEncoder.prototype, "draw", "draw");
  count(GPURenderPassEncoder.prototype, "drawIndexed", "draw");
  count(GPUDevice.prototype, "createShaderModule", "shader");
  count(GPUDevice.prototype, "createRenderPipeline", "pipeline");
  count(GPUDevice.prototype, "createRenderPipelineAsync", "pipeline");
  tr.counts = () => ({ ...counts });
  const current = GPUCanvasContext.prototype.getCurrentTexture;
  GPUCanvasContext.prototype.getCurrentTexture = function (...args) {
    // The main view only: the largest canvas on the page.
    if (this.canvas !== undefined && this.canvas.width * this.canvas.height > 200_000) {
      const t = performance.now();
      tr.draws.push(t);
      tr.frames.push([t, { ...counts }]);
    }
    return current.apply(this, args);
  };
}

/** System CPU load, %, averaged over the processors (Windows). */
function systemCpu() {
  try {
    const out = execSync("powershell -NoProfile -Command \"(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average\"", { encoding: "utf8" });
    return Number(out.trim());
  } catch { return null; }
}

const quantile = (values, q) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] * 100) / 100;
};

/** Each drawn frame's work, passes and draws between `from` and `until` (page ms). */
function frameStats(tr, from, until) {
  const draws = tr.draws.filter((t) => t >= from && t <= until);
  const work = [];
  for (let index = 1; index < draws.length; index++) {
    const start = draws[index - 1];
    const end = draws[index];
    const inWindow = ([t]) => t > start && t <= end;
    work.push(tr.raf.filter(inWindow).reduce((sum, [, ms]) => sum + ms, 0) + tr.input.filter(inWindow).reduce((sum, [, ms]) => sum + ms, 0));
  }
  const frames = tr.frames.filter(([t]) => t >= from && t <= until);
  const passes = [];
  const drawCalls = [];
  for (let index = 1; index < frames.length; index++) {
    passes.push(frames[index][1].pass - frames[index - 1][1].pass);
    drawCalls.push(frames[index][1].draw - frames[index - 1][1].draw);
  }
  const intervals = draws.slice(1).map((t, index) => t - draws[index]);
  const longtasks = tr.longtasks.filter(([t]) => t >= from && t <= until).map(([, ms]) => ms);
  return { draws: draws.length, work, passes, drawCalls, intervals, longtasks };
}

mkdirSync(OUT, { recursive: true });
const cpuBefore = systemCpu();
const browser = await chromium.launch({ channel: "chromium", headless: true, args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
const result = { label: LABEL, base: BASE, query: QUERY, floor: FLOOR, throttle: THROTTLE, budgetMs: BUDGET_MS, startedAt: new Date().toISOString(), cpuBefore, gestures: {}, errors: [] };
let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" });
  const page = await context.newPage();
  page.on("pageerror", (error) => { result.errors.push(error.message.slice(0, 200)); });
  await stub(page);
  await page.addInitScript(() => { window.localStorage.setItem("omnitwin_onboarding_seen", "1"); });
  await page.addInitScript(instrument);
  await page.goto(`${BASE}/plan/${CONFIG_ID}${QUERY === "" ? "" : `?${QUERY}`}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector('[data-testid="cockpit-shell"]') !== null && window.__budget.draws.length > 0, undefined, { timeout: 120_000, polling: 500 });
  // Let the room arrive and the loop go idle.
  await page.waitForTimeout(14_000);
  result.webgpu = await page.evaluate(() => typeof window.__budget.counts === "function");
  const cdp = await context.newCDPSession(page);
  const box = await page.locator("canvas").first().boundingBox();
  if (box === null) throw new Error("No canvas");
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  const pageNow = () => page.evaluate(() => performance.now());

  /** One finger: down, held `holdMs`, then MOVES moves on a 60 Hz clock across the room, then up. */
  async function drag(name, holdMs) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
    const x0 = box.x + box.width * 0.42;
    const y0 = box.y + box.height * 0.5;
    const x1 = box.x + box.width * 0.62;
    const y1 = box.y + box.height * 0.58;
    const downAt = await pageNow();
    await touch("touchStart", x0, y0);
    if (holdMs > 0) await page.waitForTimeout(holdMs);
    const moveFrom = await pageNow();
    let inFlight = 0;
    const sentAt = Date.now();
    for (let index = 0; index < MOVES; index++) {
      const due = sentAt + index * (1000 / 60);
      while (Date.now() < due || inFlight >= 4) await new Promise((resolve) => { setTimeout(resolve, 2); });
      const f = index / (MOVES - 1);
      inFlight += 1;
      void touch("touchMove", x0 + (x1 - x0) * f, y0 + (y1 - y0) * f).finally(() => { inFlight -= 1; });
    }
    while (inFlight > 0) await new Promise((resolve) => { setTimeout(resolve, 5); });
    const upAt = await pageNow();
    await touch("touchEnd", 0, 0);
    await page.waitForTimeout(300);
    const releaseEnd = await pageNow();
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await page.waitForTimeout(1500);
    const trace = await page.evaluate(() => {
      const tr = window.__budget;
      return { draws: tr.draws, raf: tr.raf, input: tr.input, frames: tr.frames, longtasks: tr.longtasks, counts: tr.counts?.() ?? null };
    });
    const motion = frameStats(trace, moveFrom, upAt);
    // Compiles from the touch down until 300 ms after the lift: the counts at the last frame before
    // the touch, against those at the last frame inside the window.
    const before = trace.frames.filter(([t]) => t < downAt).at(-1)?.[1] ?? null;
    const after = trace.frames.filter(([t]) => t <= releaseEnd).at(-1)?.[1] ?? null;
    const compiled = before === null || after === null ? null : { shaderModules: after.shader - before.shader, pipelines: after.pipeline - before.pipeline };
    const record = {
      holdMs, moves: MOVES, draws: motion.draws,
      workPerFrame: { p50: quantile(motion.work, 0.5), p95: quantile(motion.work, 0.95), max: quantile(motion.work, 1) },
      intervalMs: { p50: quantile(motion.intervals, 0.5), p95: quantile(motion.intervals, 0.95) },
      passesPerFrame: { p50: quantile(motion.passes, 0.5), p95: quantile(motion.passes, 0.95), max: quantile(motion.passes, 1) },
      drawsPerFrame: { p50: quantile(motion.drawCalls, 0.5) },
      compiled,
      longtasks: { n: motion.longtasks.length, max: quantile(motion.longtasks, 1) },
    };
    record.checks = {
      work: record.workPerFrame.p95 !== null && record.workPerFrame.p95 <= BUDGET_MS,
      passes: record.passesPerFrame.p95 !== null && record.passesPerFrame.p95 <= MAX_PASSES,
      compiles: compiled !== null && compiled.shaderModules === 0 && compiled.pipelines === 0,
    };
    result.gestures[name] = record;
    console.log(`${name.padEnd(8)} frames ${String(motion.draws).padStart(4)}  work p50/p95/max ${String(record.workPerFrame.p50)}/${String(record.workPerFrame.p95)}/${String(record.workPerFrame.max)} ms (budget ${String(BUDGET_MS)})  passes p50/p95 ${String(record.passesPerFrame.p50)}/${String(record.passesPerFrame.p95)}  compiled ${JSON.stringify(compiled)}  interval p50 ${String(record.intervalMs.p50)} ms`);
    if (!Object.values(record.checks).every(Boolean)) failed = true;
  }

  if (GESTURES.includes("orbit")) await drag("orbit", 0);
  if (GESTURES.includes("place")) {
    // A round in hand: Add, then the six-foot round.
    await page.getByRole("button", { name: /^add/i }).first().tap({ timeout: 10_000 });
    await page.waitForTimeout(800);
    await page.locator("[data-testid=catalogue-item-round-table-6ft-white]").first().tap({ timeout: 10_000 });
    await page.waitForTimeout(1200);
    await drag("place", 200);
  }
} catch (error) {
  result.errors.push(String(error).slice(0, 300));
  failed = true;
} finally {
  await browser.close();
}
result.cpuAfter = systemCpu();
const loud = [result.cpuBefore, result.cpuAfter].some((cpu) => cpu === null || cpu > QUIET_CPU);
result.verdict = THROTTLE >= 4 && loud
  ? `unmeasured: system CPU ${String(result.cpuBefore)} % / ${String(result.cpuAfter)} % (needs < ${String(QUIET_CPU)} %)`
  : failed ? "fail" : "pass";
const file = join(OUT, `${LABEL}-${FLOOR}-x${String(THROTTLE)}.json`);
writeFileSync(file, JSON.stringify(result, null, 1));
console.log(`verdict ${result.verdict}  (${file})${result.errors.length > 0 ? `  errors: ${result.errors.join(" | ")}` : ""}`);
process.exit(result.verdict === "fail" ? 1 : 0);
