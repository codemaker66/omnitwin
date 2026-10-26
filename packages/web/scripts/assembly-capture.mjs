// The Grand Assembly (Accio): deterministic capture and frame cost.
//
// Opens the planner lab (/dev/planner-lab: the planner's own scene in the
// drawn Grand Hall, no backend, no chrome) with the production flag
// `?assembly=accio`, loads the 180-seat dinner (src/floor/assembly/fixture.ts)
// and drives the production Assembly through its development handle
// (window.__assembly, capture-bridge.ts) with the frame loop frozen: time
// moves only in fixed steps this script chooses, never by the wall clock, and
// the post-processing pipeline is rebuilt first so its temporal history starts
// from nothing. Needs the dev server and a WebGPU adapter (the RTX 4090): run
// it under the shared GPU lock.
//
//   node scripts/assembly-capture.mjs --mode clip --out D:/claude/x
//     modes:  look     stills at --times (seconds)
//             clip     every 1/30 s frame to <out>/frames, then the static layout at the
//                      last camera pose (<out>/static.png) unless --no-static
//             measure  frame cost over the playback at 60 fps steps, then the layout at rest
//     options: --seed 7 --profile desktop|phone (measure) --mood candlelight
//              --at 2026-11-06T20:30:00Z --base http://127.0.0.1:5277
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const BASE = option("base", "http://127.0.0.1:5277");
const MODE = option("mode", "look");
const SEED = Number(option("seed", "7"));
const OUT = option("out", `D:/claude/grand-assembly-20261022/runs/accio-${MODE}`);
const PROFILE = option("profile", "desktop");
const MOOD = option("mood", "candlelight");
// A moonless evening: on 23 Oct the near-full moon shines in through the windows as white streaks.
const AT = option("at", "2026-11-06T20:30:00Z");
const TIMES = option("times", "0.4,1.2,2.4,3.6,7.0").split(",").map(Number);
const FPS = Number(option("fps", "30"));
const WARM_FRAMES = Number(option("warm", "192"));
/** Extra still frames after the clip before the settled frame is compared with the static layout (a multiple of 32). */
const SETTLE_FRAMES = Number(option("settle", "128"));
const STATIC = !process.argv.includes("--no-static");

/** Capture at 1920x1080; measure as the planner lab measures desktop and phone (scripts/planner-lab.mjs). */
const DEVICES = {
  capture: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  desktop: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

const device = MODE === "measure" ? DEVICES[PROFILE] : DEVICES.capture;
if (device === undefined) throw new Error(`Unknown profile ${PROFILE}`);
const renderProfile = MODE === "measure" ? PROFILE : "desktop";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
});
const record = {
  base: BASE, mode: MODE, seed: SEED, profile: PROFILE, renderProfile, mood: MOOD, at: AT,
  device, started: new Date().toISOString(), adapter: null, errors: [],
};

async function openStudy(context, reducedMotion) {
  // A transient load failure (a socket refused on a busy machine) gets one fresh page.
  try {
    return await openStudyOnce(context, reducedMotion);
  } catch (error) {
    record.errors.push(`retrying after: ${error instanceof Error ? error.message : String(error)}`);
    for (const page of context.pages()) await page.close();
    return openStudyOnce(context, reducedMotion);
  }
}

async function openStudyOnce(context, reducedMotion) {
  const page = await context.newPage();
  page.on("pageerror", (error) => { record.errors.push(error.message); console.error(`page error: ${error.message}`); });
  page.on("console", (message) => { if (message.type() === "error") record.errors.push(message.text()); });
  const url = `${BASE}/dev/planner-lab?render=${renderProfile}&governor=off&sky=1&guests=0&assembly=accio`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
  record.adapter ??= await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    return adapter === null || adapter === undefined ? "no adapter" : `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`.trim();
  });
  await page.waitForFunction(() => window.__plannerLab?.ready() === true && window.__assembly !== undefined, undefined, { timeout: 75000, polling: 250 });
  await page.evaluate(({ mood, at }) => { window.__assembly.scene(mood, at); window.__assembly.load(); }, { mood: MOOD, at: AT });
  // Let the layout draw (the instanced batches harvest their models) and the mood settle.
  for (let attempt = 0; attempt < 6; attempt++) await page.evaluate(() => window.__plannerLab.advance(20));
  const state = await page.evaluate(({ seed, reducedMotion }) => window.__assembly.prepare(seed, { reducedMotion }), { seed: SEED, reducedMotion });
  if (state.placed === 0 || (!reducedMotion && state.pieces === 0)) throw new Error(`Nothing to assemble: ${JSON.stringify(state)}`);
  await page.evaluate(() => window.__assembly.freeze(true));
  await page.evaluate(() => window.__assembly.resetPipeline());
  // A known phase for the temporal effects: a fixed frame number, the anti-aliasing restarted.
  record.temporal ??= [];
  record.temporal.push(await page.evaluate(() => window.__assembly.alignTemporal()));
  return { page, state };
}

/** Draws `frames` frames at time t, so the temporal history settles on a still pose. */
async function warm(page, t, frames) {
  for (let index = 0; index < frames; index++) await page.evaluate((time) => window.__assembly.frame(time, 1, 0), t);
}

const sessions = new WeakMap();

/**
 * A lossless PNG of the page through the DevTools protocol (faster encoding
 * than page.screenshot), after two animation frames so the compositor has the
 * canvas's newest frame (the frozen frame loop draws nothing on them).
 */
async function shot(page, file) {
  await page.evaluate(() => new Promise((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(() => resolve(null)); }); }));
  let session = sessions.get(page);
  if (session === undefined) {
    session = await page.context().newCDPSession(page);
    sessions.set(page, session);
  }
  const { data } = await session.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true });
  writeFileSync(file, Buffer.from(data, "base64"));
}

/**
 * The static layout, never moved: reduced motion completes the playback at
 * once, at a given camera pose. It draws as many frames after the pipeline's
 * rebuild as the clip did, so the temporal anti-aliasing's jitter is in the
 * same phase (its sequence repeats every 32 frames).
 */
async function captureStatic(context, pose, file, renders) {
  const { page } = await openStudy(context, true);
  await page.evaluate(({ position, target }) => { window.__assembly.look(position, target); }, pose);
  await warm(page, 0, renders);
  const hash = await page.evaluate(() => window.__assembly.transformHash());
  await shot(page, file);
  await page.close();
  return hash;
}

try {
  const context = await browser.newContext(device);
  if (MODE === "look" || MODE === "clip") {
    const { page, state } = await openStudy(context, false);
    record.state = state;
    await warm(page, 0, WARM_FRAMES);
    if (MODE === "look") {
      record.looks = [];
      for (const t of TIMES) {
        // Four frames at 60 fps up to t, so the temporal history follows the motion.
        const result = await page.evaluate((time) => window.__assembly.frame(time, 4, 40), t);
        const file = join(OUT, `look-${t.toFixed(2)}.png`);
        await shot(page, file);
        record.looks.push({ t, file, ...result, state: await page.evaluate(() => window.__assembly.state()) });
        console.log(`look ${t.toFixed(2)} s: ${file}`);
      }
      await page.close();
    } else {
      const framesDir = join(OUT, "frames");
      mkdirSync(framesDir, { recursive: true });
      record.frames = [];
      const count = Math.round(state.clipSeconds * FPS);
      for (let index = 0; index < count; index++) {
        const t = index / FPS;
        // Each captured frame is the second of two drawn at 60 fps, as a 60 Hz display shows it.
        const result = await page.evaluate((time) => window.__assembly.frame(time, 2, 40), t);
        const hash = await page.evaluate(() => window.__assembly.transformHash());
        const file = join(framesDir, `f${String(index).padStart(4, "0")}.png`);
        await shot(page, file);
        record.frames.push({ index, t, hash, ...result });
        if (index % 30 === 0) console.log(`frame ${index}/${count}`);
      }
      record.end = await page.evaluate(() => ({ state: window.__assembly.state(), camera: window.__assembly.camera(), hash: window.__assembly.transformHash() }));
      // The settled room held still a little longer, until its temporal history has only the still frame in it.
      await warm(page, state.clipSeconds, SETTLE_FRAMES);
      await shot(page, join(OUT, "settled.png"));
      record.settledHash = await page.evaluate(() => window.__assembly.transformHash());
      await page.close();
      if (STATIC && record.end.camera.target !== null) {
        record.staticRenders = WARM_FRAMES + 2 * count + SETTLE_FRAMES;
        record.staticHash = await captureStatic(context, { position: record.end.camera.position, target: record.end.camera.target }, join(OUT, "static.png"), record.staticRenders);
        console.log(`static: ${join(OUT, "static.png")}`);
      }
    }
  }
  if (MODE === "measure") {
    const { page, state } = await openStudy(context, false);
    record.state = state;
    await warm(page, 0, WARM_FRAMES);
    record.playback = await page.evaluate((seconds) => window.__assembly.measure({ gpu: true, seconds }), state.clipSeconds);
    console.log(`playback: ${JSON.stringify(record.playback)}`);
    record.after = await page.evaluate(() => window.__assembly.state());
    // The same frames with the layout at rest: the room and the furniture alone.
    await page.evaluate(() => window.__assembly.skip());
    await warm(page, 0, 10);
    record.static = await page.evaluate((seconds) => window.__assembly.measure({ gpu: true, seconds }), state.clipSeconds);
    console.log(`static: ${JSON.stringify(record.static)}`);
    await page.close();
  }
} finally {
  await browser.close();
  record.finished = new Date().toISOString();
  writeFileSync(join(OUT, "run.json"), `${JSON.stringify(record, null, 2)}\n`);
}
