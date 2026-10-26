// ---------------------------------------------------------------------------
// Arrival budget: what the planner's arrival costs the screen (F-01, 26 Oct 2026)
//
// Opens the planner on the fixture layout in a production build and records, from navigation:
//   - every frame the browser presented, from a Chrome trace. A compositor-driven heartbeat (a
//     2 px element animating its transform) keeps a frame due every vsync, so a gap between
//     presented frames is a stall the page could not paint through: the main thread's or the GPU
//     process's (WebGPU pipelines compiled on its thread block it).
//   - every WebGPU shader module and render pipeline, created synchronously or not, with its
//     label, colour targets and samples (one rgba16float target and no samples: the reflection
//     capture's cube).
//   - the main thread: requestAnimationFrame gaps and long tasks.
//   - when the room's first frame was drawn and when its surveyed surfaces settled (the caption).
//
//   node scripts/arrival-budget.mjs --base http://127.0.0.1:4173 [--device phone|desktop] [--throttle 1|4]
//     [--floor empty|three|rounds] [--query ...] [--seconds 16] [--reload] [--out DIR] [--label NAME]
//
// --reload measures a second arrival in the same browser (its shader caches warm). The trace is kept
// beside the result (<label>-<cold|warm>-trace.json) for reading the GPU process's work in a gap.
//
// Build: pnpm exec vite build --mode budget && pnpm exec vite preview --mode budget
// ---------------------------------------------------------------------------

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}
const BASE = option("base", "http://127.0.0.1:4173");
const DEVICE = option("device", "desktop");
const THROTTLE = Number(option("throttle", "1"));
const FLOOR = option("floor", "empty");
const QUERY = option("query", "");
const SECONDS = Number(option("seconds", "16"));
const OUT = option("out", "D:/claude/planner-p5-20261026/arrival");
const LABEL = option("label", "arrival");
const RELOAD = process.argv.includes("--reload");
/** Keep every shader module's code (`--keep-code`), written to <label>-<run>-shaders.json, to diff what compiled twice. */
const KEEP_CODE = process.argv.includes("--keep-code");
/** A frame not presented for longer than this is a stall the user sees (F-01's bar). */
const GAP_MS = 250;

// The fixture: the API the planner reads, stubbed (as scripts/phone-drag-budget.mjs stubs it).
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
  // Fourteen rounds of ten; three (30 chairs, so the next round of ten doubles the chair pool, 32 to 64); or none.
  objects: layoutObjects(FLOOR === "rounds" ? 14 : FLOOR === "three" ? 3 : 0),
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


/** Injected before the page's own scripts. */
function instrument() {
  const tr = { draws: [], raf: [], longtasks: [], shaders: [], pipelines: [], caption: [] };
  window.__arrival = tr;
  // The heartbeat: a compositor animation, so a frame is due every vsync whatever the page draws.
  const beat = () => {
    const style = document.createElement("style");
    style.textContent = "@keyframes arrival-beat{from{transform:translateX(0)}to{transform:translateX(2px)}}"
      + "#arrival-beat{position:fixed;left:0;bottom:0;width:2px;height:2px;background:#808080;z-index:2147483647;"
      + "pointer-events:none;will-change:transform;animation:arrival-beat 0.5s linear infinite alternate}";
    const dot = document.createElement("div");
    dot.id = "arrival-beat";
    document.documentElement.append(style, dot);
  };
  if (document.documentElement !== null) beat(); else document.addEventListener("DOMContentLoaded", beat, { once: true });
  const nativeRaf = window.requestAnimationFrame.bind(window);
  let last = null;
  const tick = (stamp) => { if (last !== null) tr.raf.push([last, stamp - last]); last = stamp; nativeRaf(tick); };
  nativeRaf(tick);
  try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) tr.longtasks.push([entry.startTime, entry.duration]); }).observe({ type: "longtask", buffered: true }); } catch { /* unsupported */ }
  // The room's caption: shown while its surfaces stream in, hidden once they have settled.
  new MutationObserver(() => {
    const caption = document.querySelector("[data-testid=room-resolve-caption]");
    const visible = caption?.getAttribute("data-visible") ?? null;
    const previous = tr.caption.at(-1)?.[1] ?? null;
    if (visible !== previous) tr.caption.push([performance.now(), visible]);
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-visible"] });
  // The trace's clock against the page's: a stamp the trace records at a known page time.
  tr.sync = () => { const t = performance.now(); console.timeStamp(`arrival-sync ${String(t)}`); return t; };
  if (typeof GPUDevice === "undefined") return;
  const createShaderModule = GPUDevice.prototype.createShaderModule;
  tr.code = [];
  GPUDevice.prototype.createShaderModule = function (descriptor, ...rest) {
    tr.shaders.push(performance.now());
    if (window.__arrivalKeepCode === true) tr.code.push([performance.now(), descriptor?.label ?? null, descriptor?.code ?? ""]);
    return createShaderModule.call(this, descriptor, ...rest);
  };
  for (const [name, mode] of [["createRenderPipeline", "sync"], ["createRenderPipelineAsync", "async"]]) {
    const original = GPUDevice.prototype[name];
    GPUDevice.prototype[name] = function (descriptor, ...rest) {
      const t = performance.now();
      try { return original.call(this, descriptor, ...rest); } finally {
        tr.pipelines.push({ t, ms: performance.now() - t, mode, label: descriptor?.label ?? null,
          targets: descriptor?.fragment?.targets?.length ?? 0, samples: descriptor?.multisample?.count ?? 1,
          format: descriptor?.fragment?.targets?.[0]?.format ?? null });
      }
    };
  }
  const current = GPUCanvasContext.prototype.getCurrentTexture;
  GPUCanvasContext.prototype.getCurrentTexture = function (...args) {
    if (this.canvas !== undefined && this.canvas.width * this.canvas.height > 200_000) tr.draws.push(performance.now());
    return current.apply(this, args);
  };
}

const round = (value) => Math.round(value * 10) / 10;
const isCube = (pipeline) => pipeline.targets === 1 && pipeline.samples === 1 && pipeline.format === "rgba16float";

/** The trace's events, and its clock (us) at page time 0. */
function readTrace(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  const events = Array.isArray(parsed) ? parsed : parsed.traceEvents;
  const stamp = events.find((event) => event.name === "TimeStamp" && String(event.args?.data?.message ?? "").startsWith("arrival-sync "));
  const zero = stamp === undefined ? null : stamp.ts - Number(String(stamp.args.data.message).slice("arrival-sync ".length)) * 1000;
  return { events, zero };
}

/** Presented frames (viz's swaps, else the trace's screenshots), in page ms. */
function presentedFrames(events, zero) {
  const swaps = events.filter((event) => event.ph === "X" && /DrawAndSwap$/u.test(event.name));
  const source = swaps.length > 0 ? swaps : events.filter((event) => event.name === "Screenshot");
  return { source: swaps.length > 0 ? "viz swaps" : "screenshots", frames: source.map((event) => (event.ts - zero) / 1000).sort((a, b) => a - b) };
}

/** The GPU process's work inside [from, to] (page ms), summed by task name: what it did in a gap. */
function gpuWork(events, zero, from, to) {
  const gpuPid = events.find((event) => event.name === "process_name" && event.args?.name === "GPU Process")?.pid;
  if (gpuPid === undefined) return [];
  const totals = new Map();
  for (const event of events) {
    if (event.pid !== gpuPid || event.ph !== "X" || typeof event.dur !== "number") continue;
    const start = (event.ts - zero) / 1000;
    if (start < from || start > to) continue;
    const entry = totals.get(event.name) ?? { n: 0, ms: 0 };
    entry.n += 1;
    entry.ms += event.dur / 1000;
    totals.set(event.name, entry);
  }
  return [...totals.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 8).map(([name, entry]) => ({ name, n: entry.n, ms: round(entry.ms) }));
}

async function arrive(browser, page, name) {
  const tracePath = join(OUT, `${LABEL}-${name}-trace.json`);
  await browser.startTracing(page, { path: tracePath, screenshots: true, categories: [
    "devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame",
    "disabled-by-default-devtools.screenshot", "viz", "gpu", "gpu.dawn", "toplevel", "blink.user_timing"] });
  const started = Date.now();
  await page.goto(`${BASE}/plan/${CONFIG_ID}${QUERY === "" ? "" : `?${QUERY}`}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(Math.max(0, SECONDS * 1000 - (Date.now() - started)));
  await page.evaluate(() => window.__arrival.sync());
  await page.waitForTimeout(300);
  await browser.stopTracing();
  const tr = await page.evaluate(() => { const { sync: _sync, ...rest } = window.__arrival; return rest; });
  if (KEEP_CODE) writeFileSync(join(OUT, `${LABEL}-${name}-shaders.json`), JSON.stringify(tr.code));
  const { events, zero } = readTrace(tracePath);
  if (zero === null) throw new Error("The trace has no clock stamp");
  const { source, frames } = presentedFrames(events, zero);
  const firstDraw = tr.draws[0] ?? null;
  const shown = tr.caption.findIndex(([, visible]) => visible === "true");
  const settled = shown < 0 ? null : tr.caption.slice(shown).find(([, visible]) => visible === "false")?.[0] ?? null;
  // Gaps between presented frames from the room's first frame on (before it, the page is still loading).
  const gaps = [];
  for (let index = 1; index < frames.length; index++) {
    const gap = frames[index] - frames[index - 1];
    if (gap > GAP_MS && (firstDraw === null || frames[index] > firstDraw)) gaps.push({ fromMs: round(frames[index - 1]), toMs: round(frames[index]), ms: round(gap) });
  }
  const made = (from, to) => tr.pipelines.filter((pipeline) => pipeline.t >= from && pipeline.t <= to);
  const counted = (list) => ({ sync: list.filter((p) => p.mode === "sync").length, async: list.filter((p) => p.mode === "async").length, cube: list.filter(isCube).length });
  const record = {
    presentedFrom: source, presentedFrames: frames.length,
    firstDrawMs: firstDraw === null ? null : round(firstDraw), surfacesSettledMs: settled === null ? null : round(settled),
    longestGapMs: gaps.reduce((longest, gap) => Math.max(longest, gap.ms), 0),
    unpaintedMs: round(gaps.reduce((sum, gap) => sum + gap.ms, 0)),
    gaps: gaps.map((gap) => ({ ...gap, pipelines: counted(made(gap.fromMs - 50, gap.toMs)),
      longtaskMs: round(tr.longtasks.filter(([t, ms]) => t + ms >= gap.fromMs && t <= gap.toMs).reduce((sum, [, ms]) => sum + ms, 0)),
      gpu: gpuWork(events, zero, gap.fromMs, gap.toMs) })),
    pipelines: counted(tr.pipelines),
    shaderModules: tr.shaders.length,
    longtasks: { n: tr.longtasks.length, ms: round(tr.longtasks.reduce((sum, [, ms]) => sum + ms, 0)), max: round(Math.max(0, ...tr.longtasks.map(([, ms]) => ms))) },
    rafGapsOver250: tr.raf.filter(([, ms]) => ms > GAP_MS).map(([t, ms]) => [round(t), round(ms)]),
    pipelineLog: tr.pipelines.map((p) => [round(p.t), p.mode, round(p.ms), p.label, p.targets, p.samples, p.format]),
  };
  console.log(`${name.padEnd(5)} first draw ${String(record.firstDrawMs)} ms  surfaces settled ${String(record.surfacesSettledMs)} ms  `
    + `longest unpainted ${String(record.longestGapMs)} ms (${String(gaps.length)} gaps over ${String(GAP_MS)} ms, ${String(record.unpaintedMs)} ms in all)  `
    + `pipelines sync/async ${String(record.pipelines.sync)}/${String(record.pipelines.async)} (cube ${String(record.pipelines.cube)})  long tasks ${String(record.longtasks.ms)} ms  [${source}]`);
  for (const gap of record.gaps) {
    console.log(`${name.padEnd(5)}   gap ${String(gap.fromMs)}-${String(gap.toMs)} ms (${String(gap.ms)}): pipelines sync ${String(gap.pipelines.sync)} async ${String(gap.pipelines.async)} cube ${String(gap.pipelines.cube)}; `
      + `long tasks ${String(gap.longtaskMs)} ms; GPU process: ${gap.gpu.slice(0, 3).map((g) => `${g.name} ${String(g.ms)} ms`).join(", ")}`);
  }
  return record;
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chromium", headless: true, args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
const result = { label: LABEL, base: BASE, query: QUERY, device: DEVICE, throttle: THROTTLE, floor: FLOOR, seconds: SECONDS, startedAt: new Date().toISOString(), errors: [], console: [] };
try {
  const context = await browser.newContext(DEVICE === "phone"
    ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (error) => { result.errors.push(error.message.slice(0, 200)); });
  page.on("console", (message) => {
    if ((message.type() === "error" || message.type() === "warning") && result.console.length < 150) result.console.push(`${message.type()}: ${message.text().slice(0, 300)}`);
  });
  await stub(page);
  await page.addInitScript(() => { window.localStorage.setItem("omnitwin_onboarding_seen", "1"); });
  if (KEEP_CODE) await page.addInitScript(() => { window.__arrivalKeepCode = true; });
  await page.addInitScript(instrument);
  if (THROTTLE !== 1) await (await context.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  result.cold = await arrive(browser, page, "cold");
  if (RELOAD) result.warm = await arrive(browser, page, "warm");
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `${LABEL}.json`), `${JSON.stringify(result, null, 2)}\n`);
const worst = Math.max(result.cold?.longestGapMs ?? 0, result.warm?.longestGapMs ?? 0);
console.log(`verdict ${worst <= GAP_MS ? "pass" : "fail"}  (${join(OUT, `${LABEL}.json`)})`);
