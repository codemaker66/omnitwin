import { readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { convertEquirectTiles } from "./src/equirect-tiles.js";
import { hashBundle } from "./src/hashes.js";

const EQ = "F:/E57/equirect_fixed";
const BUNDLE = "C:/Users/blake/omnitwin2/packages/web/public/twin/trades-hall";

const manifest = JSON.parse(await readFile(join(BUNDLE, "manifest.json"), "utf8")) as {
  nodes: { id: string }[];
  contentHashes?: Record<string, string>;
};
const nodeIds = manifest.nodes.map((n) => n.id);

// The tiler skips existing outputs, so drop the old webp tiles first.
for (const id of nodeIds) {
  for (const lod of [512, 4096, 8192]) {
    const p = join(BUNDLE, "tiles", id, `equirect_${lod}.webp`);
    if (existsSync(p)) await rm(p);
  }
}

const report = await convertEquirectTiles(EQ, BUNDLE, nodeIds, (d, t) => {
  if (d % 25 === 0 || d === t) console.log(`  tiles ${d}/${t}`);
});
console.log(`written=${report.written} skipped=${report.skipped} missing=${report.missing.length}`);
if (report.missing.length) console.log("MISSING:", report.missing.slice(0, 10).join(", "));

manifest.contentHashes = await hashBundle(BUNDLE);
await writeFile(join(BUNDLE, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log("manifest contentHashes refreshed; done.");
