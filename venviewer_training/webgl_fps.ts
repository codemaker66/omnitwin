/**
 * webgl_fps.ts — Playwright FPS measurement harness for Venviewer.
 *
 * Loads the viewer page, waits for `window.__VENVIEWER_READY__ === true`,
 * samples requestAnimationFrame for 10 seconds, and writes a JSON report:
 *
 *   {
 *     "target":     <human label, e.g. "trades-hall-on-m1mbp">,
 *     "url":        <viewer URL>,
 *     "browser":    "chromium" | "firefox" | "webkit",
 *     "sample_ms":  <total sampling window in ms>,
 *     "n_frames":   <count>,
 *     "avg_fps":    <average frames per second>,
 *     "p1_fps":     <1st-percentile FPS — worst sustained>,
 *     "p99_ms":     <99th-percentile frame duration in ms>,
 *     "timestamp":  <ISO-8601>
 *   }
 *
 * MUST be run in headed mode on real client hardware:
 *   - M1 MacBook Pro
 *   - RTX 4090 desktop
 *   - real iPhone via BrowserStack (or similar)
 *
 * Headless mode distorts GPU scheduling and produces unrealistic numbers.
 *
 * Env vars (all required):
 *   VIEWER_URL    fully-qualified URL to the viewer page under test
 *   TARGET_NAME   short label written into the JSON output
 *   OUT_PATH      absolute path to write the result JSON
 *
 * Usage:
 *   VIEWER_URL=http://localhost:5173/v/trades-hall \
 *   TARGET_NAME=trades-hall-on-m1mbp \
 *   OUT_PATH=/tmp/fps.json \
 *   npx playwright test venviewer_training/webgl_fps.ts --headed
 */

import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";

declare global {
  // Set by the viewer once the splat/runtime has completed its first frame.
  // `var` is required for a globalThis property declaration.
  var __VENVIEWER_READY__: boolean | undefined;
}

const VIEWER_URL  = process.env.VIEWER_URL  ?? "";
const TARGET_NAME = process.env.TARGET_NAME ?? "unknown";
const OUT_PATH    = process.env.OUT_PATH    ?? "./fps.json";
const SAMPLE_MS   = 10_000;

if (!VIEWER_URL) {
  throw new Error("VIEWER_URL env var required");
}

test("measure WebGL FPS", async ({ page, browserName }) => {
  await page.goto(VIEWER_URL, { waitUntil: "networkidle" });

  // Wait for the viewer to signal it is past first-frame and steady-state.
  // The viewer must set `window.__VENVIEWER_READY__ = true` once initial
  // splat decode + first frame have completed.
  await page.waitForFunction(
    () => globalThis.__VENVIEWER_READY__ === true,
    null,
    { timeout: 60_000 },
  );

  const result = await page.evaluate(async (sampleMs: number) => {
    const frames: number[] = [];
    let last = performance.now();
    const t0 = last;
    return await new Promise<{ frames: number[]; total_ms: number }>(
      (resolve) => {
        function tick(now: number) {
          frames.push(now - last);
          last = now;
          if (now - t0 < sampleMs) {
            requestAnimationFrame(tick);
          } else {
            resolve({ frames, total_ms: now - t0 });
          }
        }
        requestAnimationFrame(tick);
      },
    );
  }, SAMPLE_MS);

  const sorted   = [...result.frames].sort((a, b) => a - b);
  const total_ms = result.total_ms;
  const avg_fps  = (result.frames.length / total_ms) * 1000;
  const p99_idx  = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99));
  const p99_ms   = sorted[p99_idx];
  // 1st-percentile FPS = inverse of 99th-percentile frame ms
  const p1_fps   = 1000 / p99_ms;

  const out = {
    target:    TARGET_NAME,
    url:       VIEWER_URL,
    browser:   browserName,
    sample_ms: total_ms,
    n_frames:  result.frames.length,
    avg_fps:   Number(avg_fps.toFixed(2)),
    p1_fps:    Number(p1_fps.toFixed(2)),
    p99_ms:    Number(p99_ms.toFixed(2)),
    timestamp: new Date().toISOString(),
  };
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`fps result → ${OUT_PATH}`);
  console.log(JSON.stringify(out, null, 2));

  // sanity: refuse to record degenerate measurements
  expect(out.n_frames).toBeGreaterThan(60);
  expect(out.avg_fps).toBeGreaterThan(0);
});
