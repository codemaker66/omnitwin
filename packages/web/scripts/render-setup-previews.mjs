// Renders the setup cards' pictures (card-dock Q-21): each card's whole set
// (a round with its ten chairs, Top and Long table as their four-trestle
// sets, a 5 × 5 dance floor) drawn by the planner's own models in the
// furniture lab's neutral studio (/dev/furniture?setup=<card>&pf=tableSets),
// framed as the crafted previews are, so every card shares one light.
//
// Files go to public/models/furniture/setup/<card>/<SETUP_PREVIEW_VERSION>/
// preview.webp (src/lib/crafted-furniture.ts). That folder is served
// immutable, so a change to how a set looks needs a new version, not new
// bytes in the old folder; the script refuses to replace a preview that
// exists unless OVERWRITE=1 is set, which is only right before that version
// has shipped anywhere.
//
// Needs the dev server running. CHROMIUM_PATH may name a Chromium binary when
// Playwright's own browser for this version is not installed.
//   node scripts/render-setup-previews.mjs [baseUrl] [card ...]
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const cardsSource = readFileSync(join(WEB, "src/lib/setup-cards.ts"), "utf8");
const versionSource = readFileSync(join(WEB, "src/lib/crafted-furniture.ts"), "utf8");
const list = /SETUP_CARD_IDS: readonly SetupCardId\[\] = \[([^\]]*)\]/u.exec(cardsSource);
const version = /SETUP_PREVIEW_VERSION = "([a-z0-9-]+)"/u.exec(versionSource);
if (list === null || version === null) throw new Error("Could not read the setup cards and their preview version");
const CARDS = [...list[1].matchAll(/"([a-z0-9-]+)"/gu)].map((match) => match[1]);

const BASE = process.argv[2] ?? "http://localhost:5173";
const selected = process.argv.length > 3 ? process.argv.slice(3) : CARDS;
for (const card of selected) {
  if (!CARDS.includes(card)) throw new Error(`Not a setup card: ${card}`);
}

const SIZE = 800;
const overwrite = process.env.OVERWRITE === "1";
for (const card of selected) {
  const existing = join(WEB, "public/models/furniture/setup", card, version[1], "preview.webp");
  if (existsSync(existing) && !overwrite) {
    throw new Error(`${existing} exists; render a new SETUP_PREVIEW_VERSION, or set OVERWRITE=1 if this version has never shipped`);
  }
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
let failures = 0;
try {
  for (const card of selected) {
    // A fresh context per card, so the address's feature switches are not remembered between them.
    const context = await browser.newContext({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    try {
      await page.goto(`${BASE}/dev/furniture?setup=${card}&pf=tableSets`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__furniturePreview?.ready === true, undefined, { timeout: 180000 });
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
      const folder = join(WEB, "public/models/furniture/setup", card, version[1]);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "preview.webp"), webp);
      console.log(`${card.padEnd(14)} ${webp.length} bytes`);
    } catch (error) {
      failures += 1;
      console.error(`${card.padEnd(14)} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`\n${selected.length - failures}/${selected.length} previews written to public/models/furniture/setup/<card>/${version[1]}/`);
if (failures > 0) process.exitCode = 1;
