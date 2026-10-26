// Takes the graphics away from a running view on this machine's GPU, the ways
// a browser does, and checks it comes back without losing anything (L3c):
//   destroy       the WebGPU device is destroyed (three r186 ignores this reason)
//   lose-restore  WEBGL_lose_context loses the context, then restores it
//   lose-never    the context is lost and never handed back
//   gpu-crash     Chrome's GPU process crashes (CDP Browser.crashGpuProcess),
//                 the nearest thing to a real driver reset
//   error-once    one uncaptured WebGPU validation error (a buffer with no usage):
//                 not a loss, so the view must keep drawing
//   errors        an uncaptured error every frame on whichever device the canvas
//                 draws with: one fresh device, then the stopped card, then the
//                 planner's "Continue in 2D" at the same address
// With --backend none (no WebGPU, no WebGL) the planner cannot start at all and
// must offer the same layout in 2D.
// For each it records the recovery phases and how long they took, whether the
// scene graph, camera, layout and selection survived, the pixels before and
// after at the same pose, console errors, and orbit frame intervals before and
// after. Surfaces: the planner (/plan?space=grand-hall, API answered from
// fixtures as the planner e2e specs do), its walk, the room walk
// (/room/grand-hall) and the public tour (/tour, real imagery from
// twin.venviewer.com).
//
// Needs a development server: it reads window.__venPerf.
//   node scripts/graphics-reset.mjs --base http://127.0.0.1:5231 --out D:/claude/l3c-graphics-reset/run \
//     [--surface planner|planner-walk|room-walk|tour] [--backend webgpu|webgl2|none]
//     [--loss destroy|lose-restore|lose-never|gpu-crash|error-once|errors] [--device desktop|phone] [--entry saved|fresh]
//     [--layer as|capture|model]   (the planner's view: as it opens, the captured room's splats, or the drawn hall)
//     [--dpr 1]   (the display's device pixel ratio, default the device's)
//     [--profile] (a CPU profile from the loss until the view settles: what fills each long task)
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const BASE = option("base", "http://127.0.0.1:5231");
const SURFACE = option("surface", "planner");
const BACKEND = option("backend", "webgpu");
const LOSS = option("loss", BACKEND === "none" ? "none" : BACKEND === "webgpu" ? "destroy" : "lose-restore");
const DEVICE = option("device", "desktop");
const ENTRY = option("entry", "saved");
const LAYER = option("layer", "as");
const OUT = option("out", "D:/claude/l3c-graphics-reset/run");
const PROFILE = process.argv.includes("--profile");
const RUN = `${SURFACE}-${BACKEND}-${LOSS}-${DEVICE}${SURFACE.startsWith("planner") && ENTRY === "fresh" ? "-fresh" : ""}${LAYER === "as" ? "" : `-${LAYER}`}${process.argv.includes("--dpr") ? `-dpr${option("dpr", "")}` : ""}`;
const API = "http://localhost:3001";
const CONFIG_ID = "reset-config-0001";
const VENUE = { id: "reset-venue-trades", name: "Trades Hall", slug: "trades-hall-glasgow", address: "85 Glassford Street", logoUrl: null, brandColour: null };
const SPACE = {
  id: "reset-space-grand", venueId: VENUE.id, name: "Grand Hall", slug: "grand-hall",
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
    const groupId = `reset-group-${String(index)}`;
    objects.push(object(ROUND_WHITE, x, z, 0, groupId));
    for (let seat = 0; seat < 10; seat++) {
      const angle = seat * (Math.PI * 2 / 10) - Math.PI / 2;
      objects.push(object(TURINI_CHAIR, x + Math.cos(angle) * 1.21, z + Math.sin(angle) * 1.21, Math.PI / 2 - angle, groupId));
    }
  }
  return objects;
}
const CONFIG = { id: CONFIG_ID, spaceId: SPACE.id, venueId: VENUE.id, userId: null, name: "Wedding dinner", isPublicPreview: true, revision: 1, objects: layoutObjects(12) };

const DEVICES = {
  desktop: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};
const preset = DEVICES[DEVICE];
if (preset === undefined) throw new Error(`Unknown device ${DEVICE}`);
// --dpr: a display whose resting resolution differs from what a view settles at (a 1x office screen).
const DPR = Number(option("dpr", String(preset.deviceScaleFactor)));
const device = { ...preset, deviceScaleFactor: DPR };
mkdirSync(OUT, { recursive: true });

async function stubPlanner(page) {
  await page.route(`${API}/**`, (route) => route.abort());
  await page.route(`${API}/venues`, (route) => route.fulfill({ json: { data: [VENUE] } }));
  await page.route(`${API}/venues/${VENUE.id}`, (route) => route.fulfill({ json: { data: { ...VENUE, spaces: [SPACE] } } }));
  await page.route(`${API}/venues/${VENUE.id}/spaces`, (route) => route.fulfill({ json: { data: [SPACE] } }));
  await page.route(`${API}/venues/${VENUE.id}/spaces/${SPACE.id}`, (route) => route.fulfill({ json: { data: SPACE } }));
  await page.route(`${API}/public/configurations`, (route) => route.fulfill({ status: 201, json: { data: CONFIG } }));
  await page.route(`${API}/public/configurations/${CONFIG_ID}`, (route) => route.fulfill({ json: { data: CONFIG } }));
  await page.route(`${API}/assets/runtime-packages/latest**`, (route) => route.fulfill({ json: { data: null } }));
  await page.route(`${API}/truth-mode/summary*`, (route) => route.fulfill({ json: { data: {
    targetType: "configuration", targetId: CONFIG_ID, source: "Planning context", confidence: "unknown",
    assumption: "Human review required before reliance", evidenceStatus: "not_checked", reviewGate: "Human review required",
    staleState: "unknown", safeWording: ["Planning evidence - human review required before operational reliance."],
    humanReviewRequired: true, counts: { evidenceItems: 0, checkResults: 0, assumptions: 0, reviewGates: 0, staleEvents: 0 },
  } } }));
}

/** Serve a request from a public origin; a slow or failed fetch reaches the page as a network failure. */
async function forward(route, url) {
  try {
    await route.fulfill({ response: await route.fetch({ url, timeout: 120_000 }) });
  } catch {
    await route.abort("failed").catch(() => undefined);
  }
}

/** The rooms' real captures, read from the bucket they are published to (as the e2e capture cache does). */
async function routeCaptures(page) {
  await page.route("**/splats/trades-hall/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await forward(route, `https://pub-2bf1ea54c4c642d3b19067b97c55dc5d.r2.dev${path}`);
  });
}

/** The tour's real imagery, read from the public bucket production serves it from. */
async function routeTour(page) {
  await page.route("**/twin/trades-hall/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/twin/, "");
    await forward(route, `https://twin.venviewer.com${path}`);
  });
}

function sinceStart(startedAt) { return Math.round(performance.now() - startedAt); }

/** Everything that must survive: the scene graph's identity, the camera, the cockpit as a person reads it. */
async function snapshot(page) {
  return page.evaluate(() => {
    const perf = window.__venPerf;
    const canvas = document.querySelector("canvas");
    const ids = [];
    let splatDraws = 0;
    // A splat draw is derived from its sources and is rebuilt for a new device by design.
    perf?.scene.traverse((object) => {
      if (typeof object.splatCount === "number") splatDraws++;
      else ids.push(object.uuid);
    });
    let hash = 0;
    for (const id of ids.join("")) hash = (hash * 31 + id.charCodeAt(0)) >>> 0;
    return {
      sceneUuid: perf?.scene.uuid ?? null,
      sceneObjects: ids.length,
      sceneHash: hash,
      splatDraws,
      cameraUuid: perf?.camera.uuid ?? null,
      position: perf?.camera.position.toArray().map((value) => Math.round(value * 1e4) / 1e4) ?? null,
      quaternion: perf?.camera.quaternion.toArray().map((value) => Math.round(value * 1e4) / 1e4) ?? null,
      backend: canvas?.dataset.backend ?? null,
      restorations: canvas?.dataset.restorations ?? null,
      // The tour's node: data-walk-ready where the build sets it, else the viewpoint it names.
      walkReady: canvas?.dataset.walkReady ?? /Viewpoint \d+/.exec(document.body.innerText)?.[0] ?? null,
      cockpit: document.querySelector('[data-testid="cockpit-shell"]')?.innerText ?? null,
    };
  });
}

async function startFrames(page) {
  await page.evaluate(() => {
    const record = { intervals: [], last: performance.now(), running: true };
    window.__resetFrames = record;
    const tick = (now) => {
      if (!record.running) return;
      record.intervals.push(now - record.last);
      record.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopFrames(page) {
  return page.evaluate(() => {
    const record = window.__resetFrames;
    record.running = false;
    const intervals = record.intervals.slice(1);
    const sorted = [...intervals].sort((a, b) => a - b);
    const at = (q) => Math.round((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0) * 100) / 100;
    return { frames: intervals.length, medianMs: at(0.5), p95Ms: at(0.95), maxMs: at(1), over20ms: intervals.filter((value) => value > 20).length };
  });
}

/** An orbit (planner) or a look (walk, tour) across the view, with its frame intervals. */
async function gesture(page, box) {
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await startFrames(page);
  const button = SURFACE === "planner" ? "right" : "left";
  await page.mouse.move(centre.x - 150, centre.y);
  await page.mouse.down({ button });
  for (let step = 0; step <= 50; step++) {
    await page.mouse.move(centre.x - 150 + step * 6, centre.y + Math.sin(step / 8) * 20);
    await page.waitForTimeout(16);
  }
  await page.mouse.up({ button });
  await page.waitForTimeout(600);
  return stopFrames(page);
}

/** Mean absolute difference (0-255) and share of pixels differing by more than 8 levels. */
async function compareImages(page, before, after) {
  return page.evaluate(async ({ before, after }) => {
    const decode = async (base64) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    const [a, b] = [await decode(before), await decode(after)];
    if (a.length !== b.length) return { comparable: false };
    let sum = 0, differing = 0;
    for (let index = 0; index < a.length; index += 4) {
      const delta = (Math.abs(a[index] - b[index]) + Math.abs(a[index + 1] - b[index + 1]) + Math.abs(a[index + 2] - b[index + 2])) / 3;
      sum += delta;
      if (delta > 8) differing++;
    }
    const pixels = a.length / 4;
    return { comparable: true, meanAbsDiff: Math.round((sum / pixels) * 1000) / 1000, differingShare: Math.round((differing / pixels) * 1e5) / 1e5 };
  }, { before: before.toString("base64"), after: after.toString("base64") });
}

async function triggerLoss(page, browser) {
  await page.evaluate(() => {
    window.__resetOldCanvas = document.querySelector("canvas");
    window.__resetOldRenderer = window.__venPerf?.gl ?? null;
    // The page's own clock for the recovery, independent of when the harness can poll a busy main thread.
    const timeline = { lossAt: performance.now(), shownAt: null, goneAt: null, longTasks: [] };
    window.__resetTimeline = timeline;
    const restoring = () => [...document.querySelectorAll('[role="status"]')].some((node) => node.textContent?.includes("Restoring the 3D view"));
    new MutationObserver(() => {
      const now = performance.now();
      if (restoring()) timeline.shownAt ??= now;
      else if (timeline.shownAt !== null) timeline.goneAt ??= now;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.startTime >= timeline.lossAt) timeline.longTasks.push(Math.round(entry.duration));
        }
      }).observe({ type: "longtask" });
    } catch { /* Long-task timing is optional. */ }
  });
  if (LOSS === "gpu-crash") {
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send("Browser.crashGpuProcess");
    return;
  }
  if (LOSS === "error-once" || LOSS === "errors") {
    await page.evaluate((loss) => {
      // Whichever device the view draws with now, so the errors follow a replacement.
      const device = () => (document.querySelector("canvas") ?? window.__resetOldCanvas)
        ?.getContext("webgpu")?.getConfiguration?.()?.device ?? null;
      if (device() === null) throw new Error("No WebGPU device on this view");
      // A buffer with no usage fails validation outside any error scope: an uncaptured error.
      const invalid = () => { device()?.createBuffer({ size: 4, usage: 0 }); };
      if (loss === "error-once") invalid();
      else window.__resetErrors = setInterval(invalid, 16);
    }, LOSS);
    return;
  }
  await page.evaluate((loss) => {
    const canvas = window.__resetOldCanvas;
    if (canvas === null) throw new Error("No canvas to take the graphics from");
    if (loss === "destroy") {
      // Any WebGPU canvas names its device in its context's configuration; no dev bridge needed.
      const device = window.__venPerf?.gl?.backend?.device ?? canvas.getContext("webgpu")?.getConfiguration?.()?.device;
      if (device === undefined || device === null) throw new Error("No WebGPU device on this view");
      device.destroy();
      return;
    }
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const extension = context?.getExtension("WEBGL_lose_context");
    if (extension === null || extension === undefined) throw new Error("No WEBGL_lose_context on this canvas");
    extension.loseContext();
    if (loss === "lose-restore") setTimeout(() => { extension.restoreContext(); }, 1_000);
  }, LOSS);
}

/** Poll the recovery until the view draws again or says it stopped. */
async function awaitRecovery(page, startedAt) {
  const phases = [];
  let restoringShot = false;
  let cover = null;
  const began = Date.now();
  const deadline = began + 45_000;
  for (;;) {
    const state = await page.evaluate(() => ({
      phase: [
        document.querySelector("[data-graphics-recovery]")?.getAttribute("data-graphics-recovery"),
        document.querySelector("[data-graphics-attempt]")?.getAttribute("data-graphics-attempt"),
      ].filter((part) => part !== null && part !== undefined).join("#") || null,
      restoring: [...document.querySelectorAll('[role="status"]')].some((node) => node.textContent?.includes("Restoring the 3D view")),
      stopped: [...document.querySelectorAll('[role="alert"]')].some((node) => node.textContent?.includes("The 3D view stopped")),
      cover: (() => {
        const node = document.querySelector("[data-graphics-cover]");
        return node === null ? null : { tone: node.getAttribute("data-graphics-cover"), ground: getComputedStyle(node).backgroundColor };
      })(),
      canvasReplaced: document.querySelector("canvas") !== window.__resetOldCanvas,
      rendererReplaced: window.__resetOldRenderer !== null && window.__venPerf?.gl !== window.__resetOldRenderer,
    }));
    const label = `${state.phase ?? "-"}${state.restoring ? "+restoring" : ""}${state.stopped ? "+stopped" : ""}`;
    if (phases.at(-1)?.label !== label) phases.push({ atMs: sinceStart(startedAt), label });
    const sawLoss = phases.some((entry) => entry.label.includes("restoring"));
    cover ??= state.cover;
    // What a person sees while it restores, once.
    if (state.restoring && !restoringShot) {
      restoringShot = true;
      writeFileSync(join(OUT, `${RUN}-restoring.png`), await page.screenshot());
    }
    if (state.stopped) return { outcome: "stopped", phases, ...state, cover };
    // Errors that never stop come back through one fresh device, then stop: wait for the card.
    if (sawLoss && !state.restoring && LOSS !== "errors") return { outcome: "restored", phases, ...state, cover };
    // One error is not a loss: the view keeps drawing, with no cover at all.
    if (LOSS === "error-once" && !sawLoss && Date.now() - began > 6_000) return { outcome: "kept-drawing", phases, ...state, cover };
    if (Date.now() > deadline) return { outcome: "timed-out", phases, ...state };
    await page.waitForTimeout(50);
  }
}

/**
 * Waits until a captured room has finished streaming (its drawn splat count
 * unchanged for six seconds) or says it could not load, and records which: a
 * baseline taken while the sharp level is still arriving measures the arrival.
 */
async function awaitCapture(page) {
  const deadline = Date.now() + 180_000;
  let last = -1;
  let steadySince = Date.now();
  for (;;) {
    const capture = await page.evaluate(() => {
      let splats = 0;
      window.__venPerf?.scene.traverse((object) => {
        if (typeof object.splatCount === "number" && object.visible) splats += object.splatCount;
      });
      return { splats, failed: document.body.innerText.includes("Room capture could not load") };
    });
    if (capture.splats !== last) { last = capture.splats; steadySince = Date.now(); }
    // A view with no capture at all settles too, after longer.
    const steady = Date.now() - steadySince >= (capture.splats > 0 ? 8_000 : 20_000);
    if (steady || capture.failed || Date.now() > deadline) {
      report.capture = { ...capture, steady };
      return;
    }
    await page.waitForTimeout(500);
  }
}

async function openSurface(page) {
  if (SURFACE === "tour") {
    await routeTour(page);
    await page.goto(`${BASE}/tour`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("canvas") !== null
      && document.querySelector('[data-testid="twin-load-shimmer"]') === null
      && /Viewpoint \d+/.test(document.body.innerText), undefined, { timeout: 120_000, polling: 250 });
    await page.waitForTimeout(8_000);
    return;
  }
  await routeCaptures(page);
  if (SURFACE === "room-walk") {
    await page.goto(`${BASE}/room/grand-hall`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector('canvas[data-renderer="three-native"]') !== null, undefined, { timeout: 120_000, polling: 250 });
    await page.waitForTimeout(10_000);
    await awaitCapture(page);
    return;
  }
  await stubPlanner(page);
  // "fresh" is a guest's first visit, which makes an empty draft; "saved" opens
  // the furnished layout that entry redirects to, so a layout must survive.
  await page.goto(ENTRY === "fresh" ? `${BASE}/plan?space=grand-hall` : `${BASE}/plan/${CONFIG_ID}?space=grand-hall`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector('canvas[data-renderer="three-native"]') !== null
    && document.querySelector('[data-testid="cockpit-shell"]') !== null && window.__venPerf !== undefined, undefined, { timeout: 120_000, polling: 250 });
  // Let the hall's photographs and relief arrive and the opening glide finish.
  await page.waitForTimeout(16_000);
  await awaitCapture(page);
  // A ready capture opens with the arrival over the hall; step in as a person does.
  const enter = page.getByRole("button", { name: /^Open planner/ });
  if (await enter.count() > 0 && await enter.first().isVisible()) {
    await enter.first().click();
    await page.waitForTimeout(3_000);
  }
  report.arrivalDismissed = await page.locator("dialog.planner-arrival[open]").count() === 0;
  const toggle = page.getByTestId("hall-capture-toggle");
  if (LAYER !== "as" && await toggle.count() > 0) {
    const showing = await toggle.first().getAttribute("aria-pressed") === "true";
    if (showing !== (LAYER === "capture")) {
      await toggle.first().click();
      await page.waitForTimeout(4_000);
    }
  }
  report.captureShowing = await toggle.count() > 0 ? await toggle.first().getAttribute("aria-pressed") === "true" : null;
  // The planner opens the Grand Hall in its walk (eye level); "planner" measures
  // the overview, "planner-walk" the walk, whichever it opened in.
  const walk = page.getByTestId("planner-walk-toggle");
  if (await walk.count() > 0) {
    const walking = await walk.first().getAttribute("aria-pressed") === "true";
    if (walking !== (SURFACE === "planner-walk")) {
      await walk.first().click();
      await page.waitForTimeout(4_000);
    }
  }
  report.walking = await walk.count() > 0 ? await walk.first().getAttribute("aria-pressed") === "true" : null;
  if (SURFACE !== "planner-walk") {
    // Select a table, so the selection is part of what must survive.
    const box = await page.locator("canvas").first().boundingBox();
    const point = await page.evaluate(() => {
      const camera = window.__venPerf?.camera;
      if (camera === undefined) return null;
      const projected = camera.position.clone().set(-2.4, 0.75, 0).project(camera);
      return { x: (projected.x + 1) / 2, y: (1 - projected.y) / 2 };
    });
    if (box !== null && point !== null) {
      await page.mouse.click(box.x + point.x * box.width, box.y + point.y * box.height);
      await page.waitForTimeout(1_000);
    }
  }
}

/**
 * The main thread's busy stretches in a CPU profile (samples with no idle or
 * GC gap over 5 ms), each over 200 ms with the functions that filled it,
 * counted inclusively: a long task named by what it was doing.
 */
function busyStretches(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const idle = new Set(["(idle)", "(program)", "(garbage collector)"]);
  const label = (node) => `${node.callFrame.functionName || "(anonymous)"} ${node.callFrame.url.replace(/^.*\/(src|node_modules)\//, "$1/").replace(/\?.*$/, "")}:${node.callFrame.lineNumber + 1}`;
  const stretches = [];
  let current = null;
  let at = profile.startTime;
  profile.samples.forEach((id, index) => {
    const delta = profile.timeDeltas[index] ?? 0;
    at += delta;
    const node = nodes.get(id);
    const busy = node !== undefined && !idle.has(node.callFrame.functionName);
    if (!busy) {
      if (current !== null && at - current.lastBusy > 5_000) { stretches.push(current); current = null; }
      return;
    }
    current ??= { start: at, lastBusy: at, inclusive: new Map() };
    current.lastBusy = at;
    const seen = new Set();
    for (let walk = id; walk !== undefined; walk = parents.get(walk)) {
      const name = label(nodes.get(walk));
      if (seen.has(name)) continue;
      seen.add(name);
      current.inclusive.set(name, (current.inclusive.get(name) ?? 0) + delta);
    }
  });
  if (current !== null) stretches.push(current);
  return stretches
    .map((stretch) => ({
      startMs: Math.round((stretch.start - profile.startTime) / 1_000),
      ms: Math.round((stretch.lastBusy - stretch.start) / 1_000),
      top: [...stretch.inclusive].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([name, us]) => `${Math.round(us / 1_000)} ms ${name}`),
    }))
    .filter((stretch) => stretch.ms >= 200);
}

/** A run that has answered its question before the full loss/restore comparison. */
class Done extends Error {}

/** The card's "Continue in 2D": the same layout at the same address, without a reload. */
async function continueIn2d(page) {
  const urlBefore = page.url();
  await page.evaluate(() => { window.__resetSamePage = true; });
  writeFileSync(join(OUT, `${RUN}-card.png`), await page.screenshot());
  const arrival = page.getByRole("button", { name: /^Open planner/ });
  if (await arrival.count() > 0 && await arrival.first().isVisible()) await arrival.first().click();
  const button = page.getByRole("button", { name: "Continue in 2D" });
  if (await button.count() === 0) return { offered: false };
  await button.first().click();
  await page.waitForSelector("main.bp-body", { timeout: 20_000 });
  await page.waitForTimeout(1_500);
  writeFileSync(join(OUT, `${RUN}-2d.png`), await page.screenshot());
  return page.evaluate((before) => ({
    offered: true,
    sameAddress: location.href === before,
    samePage: window.__resetSamePage === true,
    twoD: document.querySelector("main.bp-body") !== null,
    text: document.querySelector("main.bp-body")?.innerText.replace(/\s+/g, " ").slice(0, 300) ?? null,
  }), urlBefore);
}

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
});
const report = { run: RUN, surface: SURFACE, backend: BACKEND, loss: LOSS, device: DEVICE, console: { beforeLoss: [], afterLoss: [] }, pageErrors: [] };
let lossStarted = false;
try {
  const context = await browser.newContext(device);
  if (BACKEND === "webgl2" || BACKEND === "none") {
    // As on a browser without WebGPU: Three negotiates its WebGL2 backend.
    await context.addInitScript(() => { Object.defineProperty(navigator, "gpu", { configurable: true, get: () => undefined }); });
  }
  if (BACKEND === "none") {
    // As on a locked-down machine: no WebGL context either.
    await context.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return /webgl/.test(type) ? null : getContext.call(this, type, ...rest);
      };
    });
  }
  const page = await context.newPage();
  page.on("pageerror", (error) => { report.pageErrors.push({ afterLoss: lossStarted, message: error.message.slice(0, 400) }); });
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    (lossStarted ? report.console.afterLoss : report.console.beforeLoss).push(`${message.type()}: ${message.text().slice(0, 300)}`);
  });

  if (BACKEND === "none") {
    // Nothing can draw: the planner must say so plainly and offer this layout in 2D.
    await stubPlanner(page);
    await routeCaptures(page);
    await page.goto(`${BASE}/plan/${CONFIG_ID}?space=grand-hall`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => [...document.querySelectorAll('[role="alert"]')]
      .some((node) => /couldn.t start/.test(node.textContent ?? "")), undefined, { timeout: 120_000, polling: 250 });
    report.card = await page.evaluate(() => [...document.querySelectorAll('[role="alert"]')]
      .map((node) => node.textContent?.trim().slice(0, 300) ?? ""));
    report.continueIn2d = await continueIn2d(page);
    throw new Done();
  }
  await openSurface(page);
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("No canvas");
  report.before = await snapshot(page);
  report.framesBefore = await gesture(page, box);
  await page.waitForTimeout(3_000);
  // The detail a view streams depends on where it rests: settle at this pose before the baseline.
  if (SURFACE !== "tour") await awaitCapture(page);
  report.atPose = await snapshot(page);
  const shotBefore = await page.screenshot({ clip: box });
  writeFileSync(join(OUT, `${RUN}-before.png`), shotBefore);

  lossStarted = true;
  let profiler = null;
  if (PROFILE) {
    profiler = await page.context().newCDPSession(page);
    await profiler.send("Profiler.enable");
    await profiler.send("Profiler.setSamplingInterval", { interval: 500 });
    await profiler.send("Profiler.start");
  }
  const startedAt = performance.now();
  await triggerLoss(page, browser);
  report.recovery = await awaitRecovery(page, startedAt);
  report.recovery.totalMs = sinceStart(startedAt);
  report.recovery.pageClock = await page.evaluate(() => {
    const timeline = window.__resetTimeline;
    if (timeline === undefined) return null;
    return {
      overlayShownMs: timeline.shownAt === null ? null : Math.round(timeline.shownAt - timeline.lossAt),
      overlayGoneMs: timeline.goneAt === null ? null : Math.round(timeline.goneAt - timeline.lossAt),
      longTasksMs: timeline.longTasks,
    };
  });
  if (LOSS === "errors") {
    // The second device failed the same way: the stopped card, then the same layout in 2D.
    await page.evaluate(() => { clearInterval(window.__resetErrors); });
    report.continueIn2d = await continueIn2d(page);
    throw new Done();
  }
  writeFileSync(join(OUT, `${RUN}-during.png`), await page.screenshot());
  // The replacement rebuilds GPU resources (pipelines, splat snapshots, the hall's environment) as it draws.
  await page.waitForTimeout(SURFACE === "room-walk" ? 20_000 : 10_000);
  if (profiler !== null) {
    const { profile } = await profiler.send("Profiler.stop");
    writeFileSync(join(OUT, `${RUN}.cpuprofile`), JSON.stringify(profile));
    report.longTaskProfile = busyStretches(profile);
  }
  // A view that came back must still be drawing once the rebuilt scene has settled.
  report.settled = await page.evaluate(() => ({
    phase: document.querySelector("[data-graphics-recovery]")?.getAttribute("data-graphics-recovery") ?? null,
    stopped: [...document.querySelectorAll('[role="alert"]')].some((node) => node.textContent?.includes("The 3D view stopped")),
  }));
  report.after = await snapshot(page);
  report.captureAfter = await page.evaluate(() => {
    let splats = 0;
    window.__venPerf?.scene.traverse((object) => {
      if (typeof object.splatCount === "number" && object.visible) splats += object.splatCount;
    });
    return { splats };
  });
  const shotAfter = await page.screenshot({ clip: box });
  writeFileSync(join(OUT, `${RUN}-after.png`), shotAfter);
  report.pixels = await compareImages(page, shotBefore, shotAfter);
  report.framesAfter = await gesture(page, box);
  report.preserved = {
    scene: report.after.sceneUuid === report.atPose.sceneUuid && report.after.sceneHash === report.atPose.sceneHash,
    camera: report.after.cameraUuid === report.atPose.cameraUuid
      && JSON.stringify(report.after.position) === JSON.stringify(report.atPose.position)
      && JSON.stringify(report.after.quaternion) === JSON.stringify(report.atPose.quaternion),
    cockpit: report.after.cockpit === report.atPose.cockpit,
    walkNode: report.after.walkReady === report.atPose.walkReady,
  };
} catch (error) {
  if (!(error instanceof Done)) report.error = error instanceof Error ? error.message : String(error);
} finally {
  writeFileSync(join(OUT, `${RUN}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
console.log(JSON.stringify({
  run: RUN, outcome: report.recovery?.outcome, totalMs: report.recovery?.totalMs, phases: report.recovery?.phases,
  pageClock: report.recovery?.pageClock,
  settled: report.settled, replaced: { canvas: report.recovery?.canvasReplaced, renderer: report.recovery?.rendererReplaced },
  capture: { before: report.capture, after: report.captureAfter, showing: report.captureShowing, arrivalDismissed: report.arrivalDismissed },
  walking: report.walking,
  preserved: report.preserved, pixels: report.pixels, framesBefore: report.framesBefore, framesAfter: report.framesAfter,
  cover: report.recovery?.cover, card: report.card, continueIn2d: report.continueIn2d,
  longTaskProfile: report.longTaskProfile?.map((stretch) => ({ ...stretch, top: stretch.top.slice(0, 12) })),
  consoleAfterLoss: report.console.afterLoss.length,
  // Console lines of a kind the page had not already logged before the loss.
  newConsoleKinds: [...new Set(report.console.afterLoss)].filter((line) => !report.console.beforeLoss.includes(line)),
  pageErrors: report.pageErrors.length, error: report.error,
}, null, 2));
