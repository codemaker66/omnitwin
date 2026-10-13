// Renders orthographic views of the dollhouse mesh (colour or world position):
//   node $SURVEY/render.mjs $SURVEY/views-walls.json out-walls        (run in the work directory)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { openMeasuringPage } from "./page-server.mjs";

const [viewsFile, out] = process.argv.slice(2);
const views = JSON.parse(readFileSync(viewsFile, "utf8"));
mkdirSync(out, { recursive: true });
const { page, close } = await openMeasuringPage(process.cwd());
for (const view of views) {
  const t0 = Date.now();
  for (const mode of view.modes ?? ["color"]) {
    if (mode === "color") {
      const url = await page.evaluate((v) => window.renderColor(v), view);
      writeFileSync(`${out}/${view.name}.png`, Buffer.from(url.split(",")[1], "base64"));
    } else {
      const b64 = await page.evaluate(([v, m]) => window.renderFloat(v, m), [view, mode]);
      writeFileSync(`${out}/${view.name}.${mode}.f32`, Buffer.from(b64, "base64"));
    }
  }
  writeFileSync(`${out}/${view.name}.json`, JSON.stringify(view));
  console.log(`${view.name} ${String(Date.now() - t0)} ms`);
}
await close();
