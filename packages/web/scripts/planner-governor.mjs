// The planner's frame-rate governor on an emulated phone: opens the real
// planner (/plan) on the Grand Hall with a furnished layout and no backend
// (fixture API answers, as planner-tour.mjs), orbits with one finger for
// --seconds in strokes (--burst seconds, then --rest seconds lifted; --rest 0
// for one unbroken stroke), and every two seconds prints the canvas's pixel
// ratio, what the governor has given up, measured and holds for a still view,
// and the draws, frame updates and updates the GPU's backlog held back, per
// second.
//
// Needs a development server (the governor publishes itself to probes only in
// development builds). --cpu-throttle slows the main thread, as on a phone
// held up by its CPU; --gpu-load keeps the GPU busy from a second page with a
// compute shader of that many loop iterations per invocation (200000 holds the
// planner near 30 frames a second on an RTX 4090), as on one held up by its
// GPU; --off measures without giving anything up.
//   node scripts/planner-governor.mjs --base http://127.0.0.1:5213 \
//     [--cpu-throttle 6] [--gpu-load 200000] [--seconds 45] [--burst 6 --rest 1.5] [--off]
import { chromium } from "@playwright/test";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const BASE = option("base", "http://127.0.0.1:5213");
const THROTTLE = Number(option("cpu-throttle", "1"));
const GPU_LOAD = Number(option("gpu-load", "0"));
const SECONDS = Number(option("seconds", "45"));
const OFF = process.argv.includes("--off");
/** Seconds of each orbit stroke, and of the rest after it (0: one unbroken stroke). */
const BURST = Number(option("burst", "6"));
const REST = Number(option("rest", "1.5"));
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

const CONFIG = { id: CONFIG_ID, spaceId: SPACE.id, venueId: VENUE.id, userId: null, name: "Wedding dinner", isPublicPreview: true, revision: 1, objects: layoutObjects(12) };

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

/** Keeps the GPU busy from its own page: two compute dispatches always in flight. */
async function startGpuLoad(browser, iterations) {
  const page = await (await browser.newContext()).newPage();
  // A loopback origin is a secure context, which WebGPU needs; nothing listens there.
  await page.route("http://127.0.0.1:9/load", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>load</title>" }));
  await page.goto("http://127.0.0.1:9/load");
  const dispatchMs = await page.evaluate(async (loops) => {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    const device = await adapter.requestDevice();
    const module = device.createShaderModule({ code: `
      @group(0) @binding(0) var<storage, read_write> data: array<f32>;
      @compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
        var x = data[id.x];
        for (var i = 0u; i < ${loops}u; i++) { x = fract(sin(x) * 43758.5453 + 0.25); }
        data[id.x] = x;
      }` });
    const buffer = device.createBuffer({ size: 4 * 256 * 1024, usage: GPUBufferUsage.STORAGE });
    const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }] });
    const dispatch = () => {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(1024);
      pass.end();
      device.queue.submit([encoder.finish()]);
      return device.queue.onSubmittedWorkDone();
    };
    await dispatch();
    const started = performance.now();
    await dispatch();
    const single = performance.now() - started;
    window.__loadRunning = true;
    const pump = async () => { while (window.__loadRunning) await dispatch(); };
    void pump();
    void pump();
    return single;
  }, iterations);
  console.log(`GPU load: ${dispatchMs.toFixed(1)} ms a dispatch, two in flight`);
  return () => page.evaluate(() => { window.__loadRunning = false; });
}

const browser = await chromium.launch({ channel: "chromium", headless: true, args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message.slice(0, 200)); });
  await stub(page);
  await page.addInitScript(() => { window.localStorage.setItem("omnitwin_onboarding_seen", "1"); });
  await page.goto(`${BASE}/plan/${CONFIG_ID}${OFF ? "?governor=off" : ""}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector('[data-testid="cockpit-shell"]') !== null && document.querySelectorAll("canvas").length >= 1, undefined, { timeout: 120000, polling: 500 });
  await page.waitForTimeout(14000);
  const cdp = await context.newCDPSession(page);
  if (THROTTLE > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  const stopGpuLoad = GPU_LOAD > 0 ? await startGpuLoad(browser, GPU_LOAD) : null;
  const box = await page.locator("canvas").first().boundingBox();
  if (box === null) throw new Error("No canvas");
  const centre = { x: box.x + box.width / 2, y: box.y + box.height * 0.45 };
  const sample = () => page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const probe = window.__renderGovernor;
    return {
      ratio: canvas === null ? null : canvas.width / Math.max(1, canvas.clientWidth),
      steps: probe?.governor.stepsDown ?? null, finished: probe?.governor.finished ?? null,
      fps: probe?.governor.lastWindowFps ?? null, cpuShare: probe?.governor.lastWindowCpuShare ?? null,
      displayHz: probe?.governor.displayRate ?? null,
      updates: probe?.counts.updates ?? 0, draws: probe?.counts.draws ?? 0, heldBack: probe?.counts.heldBack ?? 0,
      given: probe?.given().join(", ") ?? "",
      waiting: probe?.waiting.rung ?? "",
      now: performance.now(),
    };
  });
  const fixed = (value, digits) => (value === null ? "-" : value.toFixed(digits));
  console.log(`CPU throttle ${String(THROTTLE)}x, GPU load ${String(GPU_LOAD)}, governor ${OFF ? "measuring only" : "on"}, strokes ${REST > 0 ? `${String(BURST)} s with ${String(REST)} s rests` : "unbroken"}`);
  console.log("  s  ratio  steps  fps(window)  cpu share  draws/s  updates/s  held/s  given up                     waiting for a still view");
  // A finger reports at its own rate (here 125 Hz) however slowly the page
  // draws, so moves are sent on a clock, not after each is handled; the
  // browser coalesces them into frames. A few in flight at most.
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  const settle = async () => { while (inFlight > 0) await new Promise((resolve) => { setTimeout(resolve, 20); }); };
  const started = Date.now();
  let angle = 0;
  let inFlight = 0;
  let previous = await sample();
  let nextSampleAt = 2;
  // People orbit in strokes: the finger lifts between them, and the view
  // rests, which is when an effect the governor gave up is applied.
  await touch("touchStart", centre.x + 60, centre.y);
  let fingerDown = true;
  let phaseStarted = Date.now();
  while (Date.now() - started < SECONDS * 1000) {
    const inPhase = (Date.now() - phaseStarted) / 1000;
    if (!fingerDown && inPhase >= REST) {
      await touch("touchStart", centre.x + Math.cos(angle) * 60, centre.y + Math.sin(angle) * 25);
      fingerDown = true;
      phaseStarted = Date.now();
    } else if (fingerDown && REST > 0 && inPhase >= BURST) {
      await settle();
      await touch("touchEnd", 0, 0);
      fingerDown = false;
      phaseStarted = Date.now();
    } else if (fingerDown && inFlight < 4) {
      angle += 0.02;
      inFlight += 1;
      void touch("touchMove", centre.x + Math.cos(angle) * 60, centre.y + Math.sin(angle) * 25).finally(() => { inFlight -= 1; });
    }
    await new Promise((resolve) => { setTimeout(resolve, 8); });
    const elapsed = (Date.now() - started) / 1000;
    if (elapsed < nextSampleAt) continue;
    nextSampleAt += 2;
    const current = await sample();
    const wall = (current.now - previous.now) / 1000;
    const rate = (key) => ((current[key] - previous[key]) / wall).toFixed(0);
    console.log(`${String(Math.round(elapsed)).padStart(3)}  ${fixed(current.ratio, 2).padStart(5)}  ${String(current.steps).padStart(5)}${current.finished ? "*" : " "}  ${fixed(current.fps, 1).padStart(11)}  ${fixed(current.cpuShare, 2).padStart(9)}  ${rate("draws").padStart(7)}  ${rate("updates").padStart(9)}  ${rate("heldBack").padStart(6)}  ${current.given.padEnd(28)} ${current.waiting}`);
    previous = current;
  }
  await settle();
  if (fingerDown) await touch("touchEnd", 0, 0);
  if (stopGpuLoad !== null) await stopGpuLoad();
  console.log(`(* stepping has ended)  display ${fixed(previous.displayHz, 0)} Hz  page errors: ${errors.length === 0 ? "none" : errors.join(" | ")}`);
} finally {
  await browser.close();
}
