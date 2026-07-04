import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { TwinTierSchema } from "@omnitwin/types";
import { buildManifest, type RawPoses } from "./build-manifest.js";
import { convertEquirectTiles } from "./equirect-tiles.js";
import { convertTiles } from "./tiles.js";
import { hashBundle } from "./hashes.js";
import { optimizeMesh } from "./mesh.js";

/** Program spec §6 Phase 2: optimized dollhouse GLB must stay ≤ 8 MB. */
const MESH_BUDGET_BYTES = 8 * 1024 * 1024;

const { values } = parseArgs({
  options: {
    cubemaps: { type: "string" },
    // Equirect imagery mode: directory of scan_NNN.jpg world-frame panos
    // (extract_equirect.py). When present it REPLACES --cubemaps.
    equirects: { type: "string" },
    poses: { type: "string" },
    out: { type: "string" },
    venue: { type: "string" },
    name: { type: "string" },
    tier: { type: "string", default: "ops-grade-2cm" },
    overrides: { type: "string" },
    mesh: { type: "string" },
  },
});

function req(name: string, v: string | undefined): string {
  if (v === undefined) throw new Error(`--${name} is required`);
  return v;
}

const posesRaw = JSON.parse(await readFile(req("poses", values.poses), "utf8")) as RawPoses;
const overrides = values.overrides === undefined
  ? undefined
  : (JSON.parse(await readFile(values.overrides, "utf8")) as {
      add?: [string, string][];
      remove?: [string, string][];
    });

// Validate the raw CLI string against the schema's own enum so a typo fails
// with a purposeful message instead of a zod stack from deep inside parse.
const tierResult = TwinTierSchema.safeParse(values.tier);
if (!tierResult.success) {
  throw new Error(
    `--tier must be one of ${TwinTierSchema.options.join(", ")} (got "${String(values.tier)}")`,
  );
}

const out = req("out", values.out);

// Mesh step runs before the manifest so the descriptor can ride along.
const meshResult = values.mesh === undefined ? undefined : await optimizeMesh(values.mesh, out);
if (meshResult !== undefined) {
  process.stdout.write(`mesh: ${String(meshResult.bytes)} bytes from ${meshResult.sourceName}\n`);
  if (meshResult.bytes > MESH_BUDGET_BYTES) {
    process.stdout.write("WARN mesh exceeds 8 MB budget\n");
  }
}

const imagery = values.equirects === undefined ? ("cube-faces" as const) : ("equirect" as const);

const manifest = buildManifest(posesRaw, {
  venueSlug: req("venue", values.venue),
  name: req("name", values.name),
  tier: tierResult.data,
  generatedAt: new Date().toISOString(),
  nav: { overrides },
  imagery,
  ...(meshResult === undefined
    ? {}
    : {
        mesh: {
          path: "mesh/dollhouse.glb" as const,
          bytes: meshResult.bytes,
          sourceName: meshResult.sourceName,
        },
      }),
});
const nodeIds = manifest.nodes.map((n) => n.id);
const onTileProgress = (done: number, total: number): void => {
  if (done % 60 === 0 || done === total) {
    process.stdout.write(`tiles ${String(done)}/${String(total)}\n`);
  }
};
const report =
  values.equirects === undefined
    ? await convertTiles(req("cubemaps", values.cubemaps), out, nodeIds, onTileProgress)
    : await convertEquirectTiles(values.equirects, out, nodeIds, onTileProgress);

manifest.contentHashes = await hashBundle(out);
await writeFile(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));
process.stdout.write(
  `forge complete: ${String(manifest.nodes.length)} nodes, ${String(manifest.edges.length)} edges, ` +
  `${String(report.written)} tiles written, ${String(report.skipped)} skipped, ${String(report.missing.length)} missing\n`,
);
