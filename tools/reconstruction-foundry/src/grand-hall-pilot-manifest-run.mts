import { readFileSync, writeFileSync } from "node:fs";

import { computeFoundryIngestManifestSha256 } from "@omnitwin/types";

import {
  buildGrandHallPilotManifest,
  parsePilotHashInventory,
} from "./grand-hall-pilot-manifest.js";

const [inventoryPath, outputPath] = process.argv.slice(2);
if (inventoryPath === undefined || outputPath === undefined) {
  throw new Error("usage: grand-hall-pilot-manifest-run <inventory> <output.json>");
}
const inventory = parsePilotHashInventory(readFileSync(inventoryPath, "utf8"));
const manifest = buildGrandHallPilotManifest(inventory, "2026-07-19T10:21:36.000Z");
const digest = computeFoundryIngestManifestSha256(manifest);
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(
  `assets=${String(manifest.assets.length)} edges=${String(manifest.provenanceEdges.length)}\nmanifestSha256=${digest}\n`,
);
