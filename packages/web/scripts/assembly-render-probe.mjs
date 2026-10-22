// Development probe: which renderer draws happen in each frame of the planner
// lab with the assembly study mounted (to find draws that vary between runs).
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const OUT = process.argv[2];
const browser = await chromium.launch({ channel: "chromium", headless: true, args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist"] });
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:5277/dev/planner-lab?render=desktop&governor=off&sky=1&guests=0&assembly=accio&seed=7", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__plannerLab?.ready() === true && window.__assembly !== undefined, undefined, { timeout: 90000 });
  await page.evaluate(() => { window.__assembly.scene("candlelight", "2026-11-06T20:30:00Z"); window.__assembly.load(); });
  await page.evaluate(() => window.__plannerLab.advance(60));
  await page.evaluate(() => window.__assembly.prepare("accio", 7, { reducedMotion: false }));
  await page.evaluate(() => window.__assembly.freeze(true));
  await page.evaluate(() => window.__assembly.resetPipeline());
  await page.evaluate(() => window.__assembly.alignTemporal(12));
  const log = await page.evaluate(async () => {
    const gl = window.__venPerf.gl;
    const calls = [];
    const originalRender = gl.render;
    gl.render = function (scene, camera) {
      const target = gl.getRenderTarget?.();
      calls.push(`render ${scene?.name || scene?.type} ${camera?.type} target=${target?.texture?.name ?? (target ? "rt" : "canvas")}`);
      return originalRender.call(this, scene, camera);
    };
    const frames = [];
    for (let i = 0; i < 40; i++) {
      calls.length = 0;
      await window.__assembly.frame(i < 20 ? 0 : (i - 20) / 30, 1, 0);
      frames.push([...calls]);
    }
    gl.render = originalRender;
    return frames;
  });
  writeFileSync(OUT, JSON.stringify(log, null, 1));
} finally {
  await browser.close();
}
