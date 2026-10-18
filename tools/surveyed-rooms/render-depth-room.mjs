// Renders each listed station's distance cubemap (six faces, float32), the occlusion test for
// projecting its panorama: tools/grand-hall-survey/render-depth.mjs with the station list read
// from a file instead of the Grand Hall's "sweeps 0-48".
//   node $ROOMS/render-depth-room.mjs build/stations.json 1024 data/depth1024    (run in the work directory)
// stations.json is a JSON list of station ids; every one must be in data/manifest.json.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { openMeasuringPage } from "../grand-hall-survey/page-server.mjs";

const [stationsFile, sizeArg, outArg] = process.argv.slice(2);
const size = Number(sizeArg ?? 1024);
const out = outArg ?? `data/depth${String(size)}`;
mkdirSync(out, { recursive: true });
const ids = new Set(JSON.parse(readFileSync(stationsFile, "utf8")));
const manifest = JSON.parse(readFileSync("data/manifest.json", "utf8"));
const known = new Set(manifest.nodes.map((node) => node.id));
const missing = [...ids].filter((id) => !known.has(id));
if (missing.length > 0) throw new Error(`stations not in the manifest: ${missing.join(", ")}`);
const nodes = manifest.nodes.filter((node) => ids.has(node.id));
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
