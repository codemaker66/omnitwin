import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// The splat drag budget: how the room walk paces while a person looks around.
//
// frame-budget-pass.mjs measures the planner and the operational pages under
// SwiftShader with mocked APIs, which is right for a regression gate and blind
// to the thing that makes a captured room lag: six million Gaussians sorted
// and rasterised on a real GPU while the camera turns. This script drives the
// REAL walk route on the REAL GPU (headed Chromium, no software rendering) and
// samples the frame loop during a continuous drag, so the numbers are the ones
// a visitor on this machine would feel.
//
// It measures one configuration per invocation and writes a JSON record, so a
// sweep is a shell loop over SPLAT_BUDGET_LABEL and SPLAT_BUDGET_QUERY. The
// query string is passed through to the route, where the DEV-only splat
// runtime overrides (src/lib/splat-runtime-profile.ts) read it; an empty query
// measures the app exactly as shipped.
//
//   SPLAT_BUDGET_LABEL=baseline node scripts/splat-drag-budget.mjs
//   SPLAT_BUDGET_LABEL=sort50 SPLAT_BUDGET_QUERY="splat=sort:50" node scripts/splat-drag-budget.mjs
// ---------------------------------------------------------------------------

const BASE_URL = process.env.SPLAT_BUDGET_BASE_URL ?? "http://127.0.0.1:5192";
const ROOM = process.env.SPLAT_BUDGET_ROOM ?? "grand-hall";
const LABEL = process.env.SPLAT_BUDGET_LABEL ?? "baseline";
const QUERY = process.env.SPLAT_BUDGET_QUERY ?? "";
const OUT_DIR = process.env.SPLAT_BUDGET_OUT_DIR ?? "D:/claude/splat-perf";
const DRAG_MS = Number(process.env.SPLAT_BUDGET_DRAG_MS ?? "4000");
const SETTLE_MS = Number(process.env.SPLAT_BUDGET_SETTLE_MS ?? "3000");
const REPEATS = Number(process.env.SPLAT_BUDGET_REPEATS ?? "3");
const LOAD_TIMEOUT_MS = Number(process.env.SPLAT_BUDGET_LOAD_TIMEOUT_MS ?? "180000");
const HEADLESS = process.env.SPLAT_BUDGET_HEADLESS === "true";
const WIDTH = Number(process.env.SPLAT_BUDGET_WIDTH ?? "1600");
const HEIGHT = Number(process.env.SPLAT_BUDGET_HEIGHT ?? "900");
const DEVICE_SCALE = Number(process.env.SPLAT_BUDGET_DPR ?? "1");
/** Profile the main thread during the last drag and record the hottest functions. */
const CPU_PROFILE = process.env.SPLAT_BUDGET_CPU_PROFILE === "true";
/**
 * Save the settled view as <label>.png. Uses the route's bare mode, whose
 * canvas keeps its drawing buffer, and reads the canvas back directly: a
 * compositor screenshot of a loaded splat canvas is the known hang that
 * RoomSplatScene's captureReadback comment describes.
 */
const SHOT = process.env.SPLAT_BUDGET_SHOT === "true";
/**
 * Serve each tile's prebuilt level-of-detail tree in place of the tile: the
 * request for <dir>/<name>.sog is redirected to <dir>/lod/<name>-lod.rad.
 * Spark identifies the format from the bytes before it looks at the URL, so
 * this measures the production loading path (build-lod offline) without a
 * manifest change.
 */
const RAD = process.env.SPLAT_BUDGET_RAD === "true";

/** Two 60 Hz frames: one late frame is a hiccup, a run of them is a stutter. */
const DROPPED_FRAME_MS = 33.4;

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function longestRun(values, thresholdMs) {
  let current = 0;
  let longest = 0;
  for (const value of values) {
    current = value > thresholdMs ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function summarize(frames) {
  const average = frames.length === 0 ? 0 : frames.reduce((sum, v) => sum + v, 0) / frames.length;
  return {
    frames: frames.length,
    averageMs: round(average),
    fpsFromAverage: average === 0 ? 0 : round(1000 / average, 1),
    p50Ms: round(percentile(frames, 50)),
    p95Ms: round(percentile(frames, 95)),
    p99Ms: round(percentile(frames, 99)),
    maxMs: round(frames.length === 0 ? 0 : Math.max(...frames)),
    droppedFrames: frames.filter((v) => v > DROPPED_FRAME_MS).length,
    longestSustainedStall: longestRun(frames, DROPPED_FRAME_MS),
  };
}

function median(values) {
  return percentile(values, 50);
}

/**
 * rAF intervals for `durationMs`, sampled inside the page, plus how far the
 * camera's yaw travelled over the sample (absolute radians, summed per tick).
 * Travel rather than displacement: a drag that ends where it began still
 * turned the room the whole way, and must count as movement.
 */
async function sampleFrames(page, durationMs) {
  return page.evaluate(
    (sampleDuration) => new Promise((resolve) => {
      const frames = [];
      let last = performance.now();
      const end = last + sampleDuration;
      let lastYaw = window.__roomCamera?.yaw ?? null;
      let yawTravel = 0;
      const tick = (now) => {
        frames.push(now - last);
        last = now;
        const yaw = window.__roomCamera?.yaw ?? null;
        if (yaw !== null && lastYaw !== null) yawTravel += Math.abs(yaw - lastYaw);
        lastYaw = yaw;
        if (now >= end) {
          resolve({ frames: frames.slice(1), yawTravel });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
    durationMs,
  );
}

/** The hottest functions by self time from a V8 CPU profile, for naming a stall. */
function summarizeCpuProfile(profile) {
  if (!Array.isArray(profile.samples) || !Array.isArray(profile.timeDeltas)) return [];
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const timeByNode = new Map();
  for (let index = 0; index < profile.samples.length; index += 1) {
    const nodeId = profile.samples[index];
    timeByNode.set(nodeId, (timeByNode.get(nodeId) ?? 0) + (profile.timeDeltas[index] ?? 0));
  }
  return [...timeByNode.entries()]
    .map(([nodeId, timeUs]) => {
      const frame = nodes.get(nodeId)?.callFrame ?? {};
      return {
        functionName: frame.functionName || "(anonymous)",
        url: (frame.url || "(internal)").replace(/^.*\/node_modules\//u, ""),
        line: typeof frame.lineNumber === "number" ? frame.lineNumber + 1 : null,
        selfMs: round(timeUs / 1000, 1),
      };
    })
    .filter((entry) => entry.selfMs > 1)
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 16);
}

async function takeLongTasks(page) {
  return page.evaluate(() => {
    const tasks = window.__splatBudgetLongTasks ?? [];
    const copy = [...tasks];
    tasks.length = 0;
    return copy;
  });
}

async function readPageFacts(page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    let gpu = null;
    if (gl !== null) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      gpu = ext === null ? null : String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    }
    const sceneCanvas = document.querySelector("canvas");
    const heap = performance.memory?.usedJSHeapSize ?? null;
    return {
      gpu,
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      canvasCss: sceneCanvas === null
        ? null
        : { width: sceneCanvas.clientWidth, height: sceneCanvas.clientHeight },
      canvasBuffer: sceneCanvas === null
        ? null
        : { width: sceneCanvas.width, height: sceneCanvas.height },
      heapMB: heap === null ? null : Math.round(heap / 1048576),
      walk: window.__roomWalk ?? null,
      camera: window.__roomCamera ?? null,
      profile: window.__splatRuntimeProfile ?? null,
    };
  });
}

/**
 * Drag continuously for `durationMs` along a slow figure-of-eight, so the view
 * keeps turning for the whole sample and the sort never gets to rest.
 */
async function dragFor(page, durationMs, centre) {
  const start = Date.now();
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  let step = 0;
  while (Date.now() - start < durationMs) {
    const t = (Date.now() - start) / 1000;
    const x = centre.x + Math.sin(t * 1.1) * Math.min(320, centre.x * 0.5);
    const y = centre.y + Math.sin(t * 0.7) * 70;
    await page.mouse.move(x, y);
    step += 1;
    await new Promise((resolve) => { setTimeout(resolve, 12); });
  }
  await page.mouse.up();
  return step;
}

async function waitForRoom(page) {
  const closed = await page.getByTestId("room-walk-closed").count();
  if (closed > 0) {
    throw new Error(`room ${ROOM} renders a closed door on this route; nothing to measure`);
  }
  await page.waitForFunction(
    () => window.__roomWalk !== undefined && window.__roomWalk.complete === true,
    undefined,
    { timeout: LOAD_TIMEOUT_MS },
  );
  await page.waitForSelector('[data-testid="walk-loading"]', { state: "detached", timeout: 30_000 })
    .catch(() => undefined);
}

async function saveCanvasReadback(page, file) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    return canvas === null ? null : canvas.toDataURL("image/png");
  });
  if (dataUrl === null) return null;
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  await writeFile(file, Buffer.from(base64, "base64"));
  return file;
}

async function run() {
  const query = [QUERY, SHOT ? "bare=1" : ""].filter((part) => part.length > 0).join("&");
  const url = `${BASE_URL}/room/${ROOM}${query.length > 0 ? `?${query}` : ""}`;
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--ignore-gpu-blocklist", "--disable-background-timer-throttling"],
  });
  const record = {
    label: LABEL,
    room: ROOM,
    url,
    startedAt: new Date().toISOString(),
    viewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: DEVICE_SCALE },
    headless: HEADLESS,
    prebuiltRad: RAD,
    dragMs: DRAG_MS,
    settleMs: SETTLE_MS,
    pageErrors: [],
    facts: null,
    loadMs: null,
    runs: [],
    summary: null,
  };
  try {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: DEVICE_SCALE,
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => { record.pageErrors.push(error.message); });
    page.on("console", (message) => {
      if (message.type() === "error") record.pageErrors.push(message.text());
    });
    await page.addInitScript(() => {
      const tasks = [];
      window.__splatBudgetLongTasks = tasks;
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) tasks.push(Math.round(entry.duration));
        }).observe({ type: "longtask", buffered: true });
      } catch {
        // No long-task observer means no long-task evidence, never a pass.
      }
    });

    if (RAD) {
      await page.route(/\/splats\/.*\.sog(\?.*)?$/u, (route) => {
        const original = route.request().url();
        const rewritten = original.replace(/\/([^/]+)\.sog(\?.*)?$/u, "/lod/$1-lod.rad");
        return route.continue({ url: rewritten });
      });
    }

    const loadStart = Date.now();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForRoom(page);
    record.loadMs = Date.now() - loadStart;
    await page.waitForTimeout(SETTLE_MS);
    await takeLongTasks(page);

    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (box === null) throw new Error("no canvas to drag");
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    record.facts = await readPageFacts(page);
    if (SHOT) {
      await mkdir(OUT_DIR, { recursive: true });
      record.screenshot = await saveCanvasReadback(page, join(OUT_DIR, `${LABEL}.png`));
    }

    const cdp = CPU_PROFILE ? await context.newCDPSession(page) : null;
    if (cdp !== null) await cdp.send("Profiler.enable");

    for (let repeat = 0; repeat < REPEATS; repeat += 1) {
      const profiling = cdp !== null && repeat === REPEATS - 1;
      if (profiling) await cdp.send("Profiler.start");
      const framesPromise = sampleFrames(page, DRAG_MS);
      const moves = await dragFor(page, DRAG_MS, centre);
      const { frames, yawTravel } = await framesPromise;
      const cpuProfile = profiling
        ? summarizeCpuProfile((await cdp.send("Profiler.stop")).profile)
        : undefined;
      const longTasks = await takeLongTasks(page);
      const after = await readPageFacts(page);
      record.runs.push({
        repeat,
        moves,
        yawTravel: round(yawTravel, 3),
        ...(cpuProfile === undefined ? {} : { cpuProfile }),
        heapMB: after.heapMB,
        longTaskCount: longTasks.length,
        longestTaskMs: longTasks.length === 0 ? 0 : Math.max(...longTasks),
        ...summarize(frames),
      });
      await page.waitForTimeout(1500);
    }

    const p95s = record.runs.map((r) => r.p95Ms);
    const fps = record.runs.map((r) => r.fpsFromAverage);
    record.summary = {
      medianP95Ms: round(median(p95s)),
      medianFps: round(median(fps), 1),
      worstP95Ms: round(Math.max(...p95s)),
      totalDropped: record.runs.reduce((sum, r) => sum + r.droppedFrames, 0),
      worstStall: Math.max(...record.runs.map((r) => r.longestSustainedStall)),
      longestTaskMs: Math.max(...record.runs.map((r) => r.longestTaskMs)),
      cameraMoved: record.runs.every((r) => r.yawTravel > 0.05),
    };
    await context.close();
  } finally {
    await browser.close();
  }

  await mkdir(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `${LABEL}.json`);
  await writeFile(file, JSON.stringify(record, null, 2));
  const s = record.summary ?? {};
  console.log(
    `${LABEL}: ${String(s.medianFps)} fps median (p95 ${String(s.medianP95Ms)} ms, worst p95 ${String(s.worstP95Ms)} ms, `
    + `dropped ${String(s.totalDropped)}, stall ${String(s.worstStall)}, long task ${String(s.longestTaskMs)} ms) `
    + `load ${String(record.loadMs)} ms, heap ${String(record.runs.at(-1)?.heapMB)} MB, `
    + `gpu ${String(record.facts?.gpu)}, buffer ${JSON.stringify(record.facts?.canvasBuffer)}, `
    + `errors ${String(record.pageErrors.length)}, moved ${String(s.cameraMoved)} -> ${file}`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
