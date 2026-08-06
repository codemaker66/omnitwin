// retile-filled — stage the NADIR-FILLED equirects into the local bundle.
// Same proven pattern as retile-fixed.mts (the seam-fix regen), pointed at
// the nadir-fill lane's batch output (see docs/handoffs/TWIN-STATUS.md,
// "nadir/floor-cap session"). Local staging only — publication to R2 stays
// the foundry's lane via its runbook.
//
// Run AFTER nadir_fill_batch.py has produced all 149 sweeps:
//   pnpm --filter @omnitwin/twin-forge exec tsx retile-filled.mts
import { readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { convertEquirectTiles } from "./src/equirect-tiles.js";
import { hashBundle } from "./src/hashes.js";

const EQ = "F:/E57/equirect_filled";
const BUNDLE = "C:/Users/blake/omnitwin2/packages/web/public/twin/trades-hall";

const manifest = JSON.parse(await readFile(join(BUNDLE, "manifest.json"), "utf8")) as {
  nodes: { id: string }[];
  contentHashes?: Record<string, string>;
};
const nodeIds = manifest.nodes.map((n) => n.id);

// Refuse a partial staging: every sweep must exist in the filled set.
const missingSrc = nodeIds.filter(
  (id) => !existsSync(join(EQ, `${id}.jpg`)) || !existsSync(join(EQ, `${id}_8192.jpg`)),
);
if (missingSrc.length) {
  console.error(`filled set incomplete: ${missingSrc.length} sweeps missing ` +
    `(e.g. ${missingSrc.slice(0, 5).join(", ")}) — run the batch to completion first.`);
  process.exit(1);
}

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
// EquirectTileReport is {written, skipped} — retile-fixed.mts's `missing`
// field predates the current tiler and crashed this summary once.
console.log(`written=${report.written} skipped=${report.skipped}`);

manifest.contentHashes = await hashBundle(BUNDLE);
await writeFile(join(BUNDLE, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log("manifest contentHashes refreshed; nadir-filled bundle staged.");
