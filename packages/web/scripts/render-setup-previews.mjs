// Renders the setup cards' pictures (card-dock Q-21): one per look a card can
// show (a round in each colourway; Top and Long table in each colourway as one
// trestle and as a set; the dance floor), each drawn by the planner's own
// models in the furniture lab's neutral studio, framed as the crafted previews
// are, so every card shares one light. The looks and where their pictures go
// come from the lab page itself (`/dev/furniture?setup-looks`, built from
// setupCardLooks and setupCardPreviewUrl), so this script holds no copy of
// either.
//
// Files go to public/models/furniture/setup-<card>/<SETUP_PREVIEW_VERSION>/
// <look>.webp (src/lib/crafted-furniture.ts). That folder is served
// immutable, so a change to how a look reads needs a new version, not new
// bytes in the old folder; the script refuses to replace a picture that
// exists unless OVERWRITE=1 is set, which is only right before that version
// has shipped anywhere. A look the studio refuses (it would set down nothing,
// or a piece that loads a model file) fails the run.
//
// Needs the dev server running. CHROMIUM_PATH may name a Chromium binary when
// Playwright's own browser for this version is not installed.
//   node scripts/render-setup-previews.mjs [baseUrl] [card/look ...]
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.argv[2] ?? "http://localhost:5173";
const SIZE = 800;
const TIMEOUT = 180000;
const overwrite = process.env.OVERWRITE === "1";

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
let failures = 0;
let selected = [];
try {
  const listContext = await browser.newContext();
  let looks;
  try {
    const listPage = await listContext.newPage();
    await listPage.goto(`${BASE}/dev/furniture?setup-looks`, { waitUntil: "domcontentloaded" });
    await listPage.waitForFunction(() => Array.isArray(window.__setupLooks), undefined, { timeout: TIMEOUT });
    looks = await listPage.evaluate(() => window.__setupLooks);
  } finally {
    await listContext.close();
  }
  const byKey = new Map(looks.map((look) => [look.key, look]));
  const asked = process.argv.length > 3 ? process.argv.slice(3) : looks.map((look) => look.key);
  for (const key of asked) {
    if (!byKey.has(key)) throw new Error(`Not a setup look: ${key} (looks: ${[...byKey.keys()].join(", ")})`);
  }
  selected = asked.map((key) => byKey.get(key));
  for (const { url } of selected) {
    const existing = join(WEB, "public", url);
    if (existsSync(existing) && !overwrite) {
      throw new Error(`${existing} exists; render a new SETUP_PREVIEW_VERSION, or set OVERWRITE=1 if this version has never shipped`);
    }
  }

  for (const { key, url } of selected) {
    let context = null;
    try {
      // A fresh context per look, so nothing one page stores reaches the next.
      context = await browser.newContext({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      await page.goto(`${BASE}/dev/furniture?setup=${encodeURIComponent(key)}`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        () => window.__furniturePreview?.ready === true || typeof window.__furniturePreview?.error === "string",
        undefined,
        { timeout: TIMEOUT },
      );
      const refusal = await page.evaluate(() => window.__furniturePreview?.error ?? null);
      if (refusal !== null) throw new Error(`the studio refused it: ${refusal}`);
      const png = await page.screenshot({ type: "png" });
      const dataUrl = await page.evaluate(async ({ base64, size }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context2d = canvas.getContext("2d");
        if (context2d === null) throw new Error("No 2D context for encoding");
        context2d.imageSmoothingEnabled = true;
        context2d.imageSmoothingQuality = "high";
        context2d.drawImage(image, 0, 0, size, size);
        return canvas.toDataURL("image/webp", 0.86);
      }, { base64: png.toString("base64"), size: SIZE });
      const match = /^data:image\/webp;base64,([A-Za-z0-9+/]+={0,2})$/u.exec(dataUrl);
      if (match === null) throw new Error("The browser did not encode WebP");
      const webp = Buffer.from(match[1], "base64");
      const file = join(WEB, "public", url);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, webp);
      console.log(`${key.padEnd(22)} ${webp.length} bytes`);
    } catch (error) {
      failures += 1;
      console.error(`${key.padEnd(22)} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await context?.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`\n${selected.length - failures}/${selected.length} pictures written under public/models/furniture/setup-<card>/`);
if (failures > 0 || selected.length === 0) process.exitCode = 1;
