// Standalone visual-verification harness — drives its OWN headless Chromium via
// Playwright (no MCP extension, no permission popups), screenshots the cockpit
// lenses, and prints diagnostics. Run from repo root:
//   node packages/web/scripts/visual-check.mjs
// Env: OUT_DIR (screenshot dir), PLAN_URL (planner url).
import { chromium } from "@playwright/test";
import { ZipWriter, Uint8ArrayWriter, TextReader, configure } from "@zip.js/zip.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Buffer } from "node:buffer";

configure({ useWebWorkers: false });

const OUT = process.env.OUT_DIR ?? join(process.cwd(), "visual-out");
const PLAN_URL = process.env.PLAN_URL ?? "http://localhost:5173/plan/46a90419-fc36-43b4-862e-8c90967e7515";
mkdirSync(OUT, { recursive: true });

const LENSES = ["Lighting", "Power", "Rigging", "AV", "Guests", "Flow", "Evidence", "Ops", "Costs", "Share"];

/** Build a minimal self-contained .gdtf: an 8-channel fixture + an embedded glTF triangle. */
async function buildGdtf() {
  const buf = Buffer.alloc(36);
  buf.writeFloatLE(1, 12); // v1.x = 1
  buf.writeFloatLE(1, 28); // v2.y = 1
  const gltf = JSON.stringify({
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ uri: `data:application/octet-stream;base64,${buf.toString("base64")}`, byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }],
    accessors: [{ bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
  });
  const chans = Array.from({ length: 8 }, (_, i) => `<DMXChannel Offset="${i + 1}"/>`).join("");
  const desc = `<?xml version="1.0"?><GDTF DataVersion="1.2"><FixtureType Name="Modeled Spot" LongName="Acme Modeled Spot" Manufacturer="Acme"><PhysicalDescriptions><Properties><Weight Value="7"/></Properties></PhysicalDescriptions><DMXModes><DMXMode Name="8ch"><DMXChannels>${chans}</DMXChannels></DMXMode></DMXModes></FixtureType></GDTF>`;
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("description.xml", new TextReader(desc));
  await writer.add("models/gltf/model.gltf", new TextReader(gltf));
  return Buffer.from(await writer.close());
}

async function clickLens(page, name) {
  await page.locator("button[aria-pressed]", { hasText: new RegExp(`^${name}$`) }).first().click();
}

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const report = { ok: false, steps: [], errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1 });
  page.on("console", (m) => { if (m.type() === "error") report.errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => report.errors.push(`pageerror: ${String(e).slice(0, 200)}`));

  await page.goto(PLAN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  // The cockpit nav rail (lens buttons) appears once a layout loads. If the config
  // isn't in this DB, fall back to "Start a fresh planner draft".
  const navRail = page.locator("button[aria-pressed]").first();
  try {
    await navRail.waitFor({ timeout: 12000 });
  } catch {
    report.steps.push("config not found — starting a fresh draft");
    const fresh = page.getByRole("button", { name: /fresh planner draft/i });
    if (await fresh.count()) {
      await fresh.first().click();
      await navRail.waitFor({ timeout: 60000 });
    } else {
      throw new Error("no nav rail and no fresh-draft button");
    }
  }
  report.steps.push("cockpit loaded");
  await page.waitForTimeout(3000); // let the scene settle

  // --- Slice 4: import a .gdtf with a 3D model into the Lighting lens ---
  await clickLens(page, "Lighting");
  await page.getByTestId("lighting-lens-panel").waitFor({ timeout: 15000 });
  await page.getByTestId("rig-clear").click();
  const tmp = join(OUT, "modeled-spot.gdtf");
  writeFileSync(tmp, await buildGdtf());
  await page.getByTestId("gdtf-file").setInputFiles(tmp);
  await page.getByTestId("gdtf-name").waitFor({ timeout: 15000 });
  await page.getByTestId("fixture-model-preview").waitFor({ timeout: 15000 });
  await page.waitForTimeout(2000); // GLTFLoader.parse + a few auto-rotate frames

  const diag = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="lighting-lens-panel"]');
    const metric = (l) => {
      const e = [...panel.querySelectorAll(".lens-panel__metric-label")].find((x) => x.textContent.trim() === l);
      return e?.nextElementSibling?.textContent?.trim() ?? null;
    };
    const canvas = panel.querySelector('[data-testid="fixture-model-preview"] canvas');
    return {
      name: panel.querySelector('[data-testid="gdtf-name"]')?.textContent?.trim() ?? null,
      channels: metric("DMX channels"),
      hasCanvas: Boolean(canvas),
      canvasW: canvas?.width ?? 0,
      canvasH: canvas?.height ?? 0,
      modelError: Boolean(panel.querySelector('[data-testid="fixture-model-error"]')),
    };
  });
  report.lighting = diag;
  report.steps.push("lighting imported");
  await page.getByTestId("lighting-lens-panel").screenshot({ path: join(OUT, "lens-lighting.png") });
  // The 3D preview element directly (Playwright scrolls it into view first).
  await page.getByTestId("fixture-model-preview").scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.getByTestId("fixture-model-preview").screenshot({ path: join(OUT, "fixture-model.png") });
  // Also a wider shot of the parsed-fixture block (name + preview + controls).
  await page.getByTestId("lighting-lens-panel").screenshot({ path: join(OUT, "lens-lighting-scrolled.png") });

  // --- Screenshot every lens panel for a visual polish review ---
  for (const lens of LENSES) {
    try {
      await clickLens(page, lens);
      await page.waitForTimeout(700);
      const panel = page.locator('.lens-panel, [class*="cockpit-truth-rail"]').first();
      await panel.screenshot({ path: join(OUT, `lens-${lens.toLowerCase()}.png`) });
      report.steps.push(`shot ${lens}`);
    } catch (e) {
      report.steps.push(`SKIP ${lens}: ${String(e).slice(0, 120)}`);
    }
  }

  report.ok = true;
} catch (e) {
  report.fatal = String(e).slice(0, 400);
} finally {
  try {
    const pages = browser.contexts().flatMap((c) => c.pages());
    if (pages[0]) await pages[0].screenshot({ path: join(OUT, "page-full.png"), fullPage: false });
  } catch { /* ignore */ }
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
