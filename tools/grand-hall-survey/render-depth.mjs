// Renders each Grand Hall station's distance cubemap (six faces, float32), the
// occlusion test for projecting its panorama:
//   node $SURVEY/render-depth.mjs 1024 data/depth1024        (run in the work directory)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { openMeasuringPage } from "./page-server.mjs";

const size = Number(process.argv[2] ?? 1024);
const out = process.argv[3] ?? `data/depth${String(size)}`;
mkdirSync(out, { recursive: true });
const manifest = JSON.parse(readFileSync("data/manifest.json", "utf8"));
// Sweeps 0–48 are the Grand Hall.
const nodes = manifest.nodes.filter((node) => Number(node.id.slice(5)) <= 48);
const { page, close } = await openMeasuringPage(process.cwd());
for (const node of nodes) {
  const file = `${out}/${node.id}.f32`;
  if (existsSync(file)) continue;
  const t0 = Date.now();
  const b64 = await page.evaluate(([station, n]) => window.renderCubeDistance(station, n), [node.pose.t, size]);
  writeFileSync(file, Buffer.from(b64, "base64"));
  console.log(node.id, Date.now() - t0, "ms");
}
await close();
