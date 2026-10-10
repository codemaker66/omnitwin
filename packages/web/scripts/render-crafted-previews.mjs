// Renders the catalogue preview of each crafted furniture piece from the
// crafted model itself (src/components/meshes/crafted), so the picker and the
// dashboard show what the planner draws.
//
// Each piece is drawn alone in the furniture lab's neutral studio
// (/dev/furniture?preview=<slug>), framed from the front right like the
// supplied previews, at twice the output size, then downsampled and encoded
// as WebP by the browser. Files go to
// public/models/furniture/<slug>/<CRAFTED_PREVIEW_VERSION>/preview.webp; that
// folder is served immutable, so a change to how a piece looks needs a new
// CRAFTED_PREVIEW_VERSION (src/lib/crafted-furniture.ts), not new bytes in
// the old folder. The script refuses to replace a preview that exists unless
// OVERWRITE=1 is set, which is only right before that version has shipped
// anywhere, previews included.
//
// 800 px square: the dashboard's featured inventory picture is 360 CSS px.
//
// Needs the dev server running. CHROMIUM_PATH may name a Chromium binary when
// Playwright's own browser for this version is not installed.
//   node scripts/render-crafted-previews.mjs [baseUrl] [slug ...]
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(WEB, "src/lib/crafted-furniture.ts"), "utf8");
const list = /CRAFTED_FURNITURE_SLUGS = \[([^\]]*)\]/u.exec(source);
const version = /CRAFTED_PREVIEW_VERSION = "([a-z0-9-]+)"/u.exec(source);
if (list === null || version === null) throw new Error("Could not read the crafted slugs and preview version");
const SLUGS = [...list[1].matchAll(/"([a-z0-9-]+)"/gu)].map((match) => match[1]);

const BASE = process.argv[2] ?? "http://localhost:5173";
const selected = process.argv.length > 3 ? process.argv.slice(3) : SLUGS;
for (const slug of selected) {
  if (!SLUGS.includes(slug)) throw new Error(`Not a crafted slug: ${slug}`);
}

const SIZE = 800;
const overwrite = process.env.OVERWRITE === "1";
for (const slug of selected) {
  const existing = join(WEB, "public/models/furniture", slug, version[1], "preview.webp");
  if (existsSync(existing) && !overwrite) {
    throw new Error(`${existing} exists; render a new CRAFTED_PREVIEW_VERSION, or set OVERWRITE=1 if this version has never shipped`);
  }
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
let failures = 0;
try {
  const context = await browser.newContext({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  for (const slug of selected) {
    try {
      await page.goto(`${BASE}/dev/furniture?preview=${slug}`, { waitUntil: "domcontentloaded" });
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
      const folder = join(WEB, "public/models/furniture", slug, version[1]);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "preview.webp"), webp);
      console.log(`${slug.padEnd(26)} ${webp.length} bytes`);
    } catch (error) {
      failures += 1;
      console.error(`${slug.padEnd(26)} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  await browser.close();
}
console.log(`\n${selected.length - failures}/${selected.length} previews written to public/models/furniture/<slug>/${version[1]}/`);
if (failures > 0) process.exitCode = 1;
