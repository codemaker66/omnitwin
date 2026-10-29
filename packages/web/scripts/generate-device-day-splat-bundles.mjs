#!/usr/bin/env node
// Generates src/data/generated/device-day-splat-bundles.ts from lane L2's
// device-day staging (D:/claude/device-day-20261028/splat-staging on the
// founder's PC): one folder per timing cut, each with SOG tiles and a
// bundle.json shaped like a shipped Trades Hall bundle entry.
//
//   node scripts/generate-device-day-splat-bundles.mjs <staging root> [out.ts]
//
// Every tile is re-hashed and re-measured from disk and must match its
// bundle.json, and each tile's SH degree is read from its own meta.json, so
// the checked-in allowlist describes exactly the bytes the planner lead
// uploads. Nothing here is hand-edited: rerun after L2 remakes a cut.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";

const IDS = ["l2-1m", "l2-1.5m", "l2-2m", "l2-3m", "l2-2m-sh1"];
const here = dirname(fileURLToPath(import.meta.url));
const root = process.argv[2];
const out = resolve(process.argv[3] ?? join(here, "../src/data/generated/device-day-splat-bundles.ts"));
if (root === undefined) {
  process.stderr.write("usage: generate-device-day-splat-bundles.mjs <staging root> [out.ts]\n");
  process.exit(2);
}

function fail(message) {
  throw new Error(message);
}

function vec3(value, what) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((n) => typeof n === "number" && Number.isFinite(n))) {
    fail(`${what} is not three finite numbers`);
  }
  return value;
}

async function shDegree(bytes) {
  const reader = new ZipReader(new BlobReader(new Blob([bytes])));
  try {
    const entries = await reader.getEntries();
    const meta = entries.find((entry) => entry.filename === "meta.json");
    if (meta === undefined || meta.directory) fail("SOG archive has no meta.json");
    const parsed = JSON.parse(await meta.getData(new TextWriter()));
    if (parsed.version !== 2) fail(`SOG version ${String(parsed.version)} is not 2`);
    return parsed.shN === undefined ? 0 : parsed.shN.bands;
  } finally {
    await reader.close();
  }
}

const bundles = [];
for (const id of IDS) {
  const dir = join(root, id);
  const raw = JSON.parse(readFileSync(join(dir, "bundle.json"), "utf8"));
  if (raw.captureDir !== id) fail(`${id}: captureDir is ${raw.captureDir}`);
  if (raw.roomSlug !== "grand-hall") fail(`${id}: roomSlug is ${raw.roomSlug}`);
  if (raw.splatType !== ".sog") fail(`${id}: splatType is ${raw.splatType}`);
  if (raw.transform?.scale !== 1) fail(`${id}: transform scale is not 1`);
  const tiles = [];
  const degrees = new Set();
  for (const tile of raw.tiles) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.sog$/.test(tile.file)) fail(`${id}: bad tile name ${tile.file}`);
    if (tile.isEnvironment !== false) fail(`${id}: ${tile.file} is marked environment`);
    const bytes = readFileSync(join(dir, tile.file));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== tile.bytes) fail(`${id}: ${tile.file} is ${bytes.length} bytes, bundle says ${tile.bytes}`);
    if (sha256 !== tile.sha256) fail(`${id}: ${tile.file} sha256 differs from bundle.json`);
    degrees.add(await shDegree(bytes));
    tiles.push({
      file: tile.file,
      bytes: tile.bytes,
      sha256,
      splats: tile.splats,
      boundsPlanner: { min: vec3(tile.boundsPlanner.min, "boundsPlanner.min"), max: vec3(tile.boundsPlanner.max, "boundsPlanner.max") },
    });
  }
  if (degrees.size !== 1) fail(`${id}: tiles disagree on SH degree`);
  const totalSplats = tiles.reduce((sum, tile) => sum + tile.splats, 0);
  const totalBytes = tiles.reduce((sum, tile) => sum + tile.bytes, 0);
  if (totalSplats !== raw.totalSplats) fail(`${id}: tile splats sum to ${totalSplats}, bundle says ${raw.totalSplats}`);
  if (totalBytes !== raw.totalBytes) fail(`${id}: tile bytes sum to ${totalBytes}, bundle says ${raw.totalBytes}`);
  const matrix = raw.transformMatrix3x4;
  if (!Array.isArray(matrix) || matrix.length !== 3 || !matrix.every((row) => Array.isArray(row) && row.length === 4)) {
    fail(`${id}: transformMatrix3x4 is not 3x4`);
  }
  bundles.push({
    id,
    roomSlug: raw.roomSlug,
    label: raw.label,
    splatType: raw.splatType,
    shDegree: [...degrees][0],
    totalSplats,
    totalBytes,
    tiles,
    plannerTransform: {
      position: vec3(raw.transform.position, "transform.position"),
      rotation: vec3(raw.transform.rotation, "transform.rotation"),
      scale: 1,
    },
    plannerMatrix3x4: matrix,
    extentM: vec3(raw.extentM, "extentM"),
    alignmentNote: raw.alignmentNote,
    source: {
      cutDaySha256: raw.source.cut_day_sha256,
      keptWeightFrac: raw.source.kept_weight_frac,
      encoder: raw.source.encoder,
    },
    written: raw.written,
  });
}

const header = `// GENERATED FILE - DO NOT EDIT BY HAND.
//
// Produced by packages/web/scripts/generate-device-day-splat-bundles.mjs from
// lane L2's device-day staging (README: timing-only cuts, not look
// candidates). Every tile was re-hashed from disk and matched its bundle.json.
// Tile bytes are not in the repository: they are served from
// <splat base>/trades-hall/device-day/<id>/<file>.
//
// plannerTransform is L2's planner_from_json (T-658): it places a cut in the
// drawn hall's frame (hall-spec.ts). The planner composes it into the shipped
// Grand Hall capture's frame in data/device-day-splat-bundles.ts.

export interface GeneratedDeviceDayTile {
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly splats: number;
  /** The tile's splat-centre bounds after plannerTransform, metres. */
  readonly boundsPlanner: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
}

export interface GeneratedDeviceDayBundle {
  readonly id: string;
  readonly roomSlug: string;
  readonly label: string;
  readonly splatType: ".sog";
  /** Spherical-harmonic degree read from the tiles' own meta.json. */
  readonly shDegree: number;
  readonly totalSplats: number;
  readonly totalBytes: number;
  readonly tiles: readonly GeneratedDeviceDayTile[];
  /** three.js position + Euler XYZ radians: tile frame to the drawn hall's frame. */
  readonly plannerTransform: {
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number];
    readonly scale: 1;
  };
  /** The same transform as L2 wrote it, row-major [R | t]. */
  readonly plannerMatrix3x4: readonly (readonly [number, number, number, number])[];
  readonly extentM: readonly [number, number, number];
  readonly alignmentNote: string;
  readonly source: {
    readonly cutDaySha256: string;
    readonly keptWeightFrac: number;
    readonly encoder: string;
  };
  readonly written: string;
}

export const GENERATED_DEVICE_DAY_BUNDLES: readonly GeneratedDeviceDayBundle[] =
`;

writeFileSync(out, `${header}${JSON.stringify(bundles, null, 2)
  .split("\n").map((line) => `  ${line}`).join("\n")};\n`, "utf8");
process.stdout.write(`wrote ${out}: ${bundles.map((b) => `${b.id} ${b.totalSplats} SH${b.shDegree}`).join(", ")}\n`);
