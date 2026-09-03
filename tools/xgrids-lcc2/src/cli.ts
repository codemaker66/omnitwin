import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkAgainstPublished,
  sceneExtentForRoomFrame,
  sceneTransformForRoomFrame,
  walkAlignedFrame,
  walkAlignedTransform,
} from "./align.js";
import { decimateWalk, denseWalkRegion, medoidPose, parseWalkPoses, walkEyeHeight } from "./walk-path.js";
import { TRADES_HALL_CAPTURE_SOURCES, type CaptureSource } from "./capture-sources.js";
import { parseObjVertices, roomFrameFromVertices } from "./obj-bounds.js";
import { parseLcc2Manifest } from "./lcc2-manifest.js";
import { roomBundleFromManifest } from "./room-bundle.js";
import { stageRoomTiles, writeRoomManifest, type RoomManifestEntry } from "./stage.js";
import { buildLodRunner, buildRoomLodTrees, readGeneratedManifest } from "./lod-trees.js";

// ---------------------------------------------------------------------------
// Read-only operator entrypoint for XGRIDS LCC2 captures.
//
//   lcc2 measure  --scans <dir> [--grand-hall <dir>]
//   lcc2 manifest --scans <dir> [--grand-hall <dir>] --out <dir>
//
// `measure` reads only; `manifest` writes small JSON descriptors into the repo.
// Neither ever writes to, renames inside, or deletes from a capture root.
// ---------------------------------------------------------------------------

interface Args {
  readonly command: string;
  readonly scans: string | null;
  readonly grandHall: string | null;
  readonly out: string | null;
  readonly manifest: string | null;
  readonly room: string | null;
  /** Path to Spark's build-lod executable, for the `lod` command. */
  readonly buildLod: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  // `pnpm run <script> -- measure ...` forwards the separator as a literal
  // argument, so drop any leading separators before reading the command.
  const rest = argv.slice(2).filter((arg, index, all) => !(arg === "--" && all.slice(0, index).every((a) => a === "--")));
  const command = rest[0] ?? "";
  const flag = (name: string): string | null => {
    const index = rest.indexOf(`--${name}`);
    if (index === -1) return null;
    return rest[index + 1] ?? null;
  };
  return {
    command,
    scans: flag("scans"),
    grandHall: flag("grand-hall"),
    out: flag("out"),
    manifest: flag("manifest"),
    room: flag("room"),
    buildLod: flag("build-lod"),
  };
}

function rootFor(source: CaptureSource, args: Args): string | null {
  return source.root === "grand-hall" ? args.grandHall : args.scans;
}

interface MeasuredRoom {
  readonly source: CaptureSource;
  readonly captureRoot: string;
  readonly failure: string | null;
  readonly manifestPath: string;
  readonly objPath: string;
  readonly posesPath: string;
}

function resolveRoom(source: CaptureSource, args: Args): MeasuredRoom | null {
  const root = rootFor(source, args);
  if (root === null) return null;
  const captureRoot = join(root, source.captureDir);
  return {
    source,
    captureRoot,
    failure: null,
    manifestPath: join(captureRoot, "lcc2-result", `${source.assetBaseName}.lcc2`),
    objPath: join(captureRoot, "mesh-files", `${source.assetBaseName}.obj`),
    posesPath: join(captureRoot, "lcc2-result", "info", "poses.json"),
  };
}

function selectedSources(args: Args): readonly CaptureSource[] {
  if (args.room === null) return TRADES_HALL_CAPTURE_SOURCES;
  return TRADES_HALL_CAPTURE_SOURCES.filter((source) => source.roomSlug === args.room);
}

export type AlignmentConfidence = "confident" | "review";

/**
 * Whether a derived frame can be wired without a human first looking at it.
 *
 * Retention is the signal that matters: it is the share of the capture that
 * sits inside the derived room. A single-room scan retains nearly all of
 * itself; a whole-floor scan cannot, because most of what was walked is not
 * this room. A published-dimension disagreement is also disqualifying, since it
 * means the frame, the mapping or the published figure is wrong.
 */
export function alignmentConfidence(
  retainedFraction: number,
  verdict: "agrees" | "disagrees" | "unpublished",
): AlignmentConfidence {
  if (verdict === "disagrees") return "review";
  return retainedFraction >= 0.9 ? "confident" : "review";
}

function measure(args: Args): number {
  if (args.scans === null && args.grandHall === null) {
    process.stderr.write("Provide --scans and/or --grand-hall capture roots.\n");
    return 1;
  }

  let failures = 0;
  const pad = (value: string, width: number): string => value.padEnd(width);
  const num = (value: number): string => value.toFixed(2).padStart(7);

  process.stdout.write(
    `${pad("room", 23)} ${pad("tiles", 6)} ${pad("splats", 11)} ${pad("derived WxDxH (m)", 25)} ${pad("keep", 5)} ${pad("confidence", 11)} vs published\n`,
  );

  for (const source of selectedSources(args)) {
    const resolved = resolveRoom(source, args);
    if (resolved === null) {
      process.stdout.write(`${pad(source.roomSlug, 23)} — no capture root supplied for this room\n`);
      continue;
    }

    let manifestRaw: string;
    let objRaw: string;
    try {
      manifestRaw = readFileSync(resolved.manifestPath, "utf8");
      objRaw = readFileSync(resolved.objPath, "utf8");
    } catch (error) {
      failures += 1;
      process.stdout.write(`${pad(source.roomSlug, 23)} UNREADABLE ${String(error)}\n`);
      continue;
    }

    const parsed = parseLcc2Manifest(manifestRaw);
    if (!parsed.ok || parsed.manifest === null) {
      failures += 1;
      process.stdout.write(`${pad(source.roomSlug, 23)} MANIFEST REFUSED — ${parsed.error ?? "unknown"}\n`);
      continue;
    }

    const bundle = roomBundleFromManifest(source.roomSlug, parsed.manifest);
    const allVertices = parseObjVertices(objRaw);
    const crop = source.roomCropM;
    const vertices = crop === null
      ? allVertices
      : allVertices.filter((v) =>
          v[0] >= crop.min[0] && v[0] <= crop.max[0] &&
          v[1] >= crop.min[1] && v[1] <= crop.max[1] &&
          v[2] >= crop.min[2] && v[2] <= crop.max[2]);
    const frame = roomFrameFromVertices(vertices);
    if (frame === null) {
      failures += 1;
      process.stdout.write(`${pad(source.roomSlug, 23)} MESH REFUSED — too sparse to measure honestly\n`);
      continue;
    }

    const [w, h, d] = sceneExtentForRoomFrame(frame);
    const check = checkAgainstPublished(frame, source.publishedExtentM);
    const confidence = alignmentConfidence(frame.retainedFraction, check.verdict);
    if (confidence === "review") failures += 1;

    process.stdout.write(
      `${pad(source.roomSlug, 23)} ${pad(String(bundle.tiles.length), 6)} ${pad(String(parsed.manifest.totalSplats), 11)} ` +
      `${pad(`${num(w)}${num(d)}${num(h)}`, 25)} ${pad(`${(frame.retainedFraction * 100).toFixed(0)}%`, 5)} ` +
      `${pad(confidence, 11)} ${check.verdict}\n`,
    );
    if (check.verdict === "disagrees") process.stdout.write(`${" ".repeat(23)}   ${check.detail}\n`);
    // Only offer the crop remedy when low retention is what flagged the room;
    // a published-dimension disagreement at high retention means something
    // else is wrong, and cropping would not address it.
    if (confidence === "review" && crop === null && frame.retainedFraction < 0.9) {
      process.stdout.write(
        `${" ".repeat(23)}   Only ${(frame.retainedFraction * 100).toFixed(0)}% of the capture sits inside the derived ` +
        `frame — likely a whole-floor scan. Set roomCropM on this source to say where the room is.\n`,
      );
    }
  }

  return failures > 0 ? 1 : 0;
}

const VENUE_SLUG = "trades-hall";

function stage(args: Args): number {
  if (args.out === null) {
    process.stderr.write("Provide --out <staging root> (outside the repository).\n");
    return 1;
  }
  if (args.manifest === null) {
    process.stderr.write("Provide --manifest <path to generated json>.\n");
    return 1;
  }

  const entries: RoomManifestEntry[] = [];
  let failures = 0;

  for (const source of selectedSources(args)) {
    const resolved = resolveRoom(source, args);
    if (resolved === null) {
      process.stdout.write(`${source.roomSlug}: no capture root supplied, skipped
`);
      continue;
    }

    let parsedManifest;
    let objRaw: string;
    try {
      parsedManifest = parseLcc2Manifest(readFileSync(resolved.manifestPath, "utf8"));
      objRaw = readFileSync(resolved.objPath, "utf8");
    } catch (error) {
      failures += 1;
      process.stdout.write(`${source.roomSlug}: UNREADABLE ${String(error)}
`);
      continue;
    }
    if (!parsedManifest.ok || parsedManifest.manifest === null) {
      failures += 1;
      process.stdout.write(`${source.roomSlug}: MANIFEST REFUSED ${parsedManifest.error ?? ""}
`);
      continue;
    }

    const bundle = roomBundleFromManifest(source.roomSlug, parsedManifest.manifest);
    const crop = source.roomCropM;
    const all = parseObjVertices(objRaw);
    const vertices = crop === null
      ? all
      : all.filter((v) =>
          v[0] >= crop.min[0] && v[0] <= crop.max[0] &&
          v[1] >= crop.min[1] && v[1] <= crop.max[1] &&
          v[2] >= crop.min[2] && v[2] <= crop.max[2]);
    const frame = roomFrameFromVertices(vertices);
    if (frame === null) {
      failures += 1;
      process.stdout.write(`${source.roomSlug}: MESH REFUSED, too sparse to measure
`);
      continue;
    }

    const staged = stageRoomTiles(bundle, resolved.captureRoot, args.out, VENUE_SLUG);
    if (staged.failures.length > 0) {
      failures += 1;
      for (const failure of staged.failures) {
        process.stdout.write(`${source.roomSlug}: STAGE FAILED ${failure}
`);
      }
      continue;
    }

    // The scanner's own walk, where the capture recorded one. It defines the
    // room better than the geometry does — the operator stayed inside it.
    let walkFrame: ReturnType<typeof walkAlignedFrame> | null = null;
    try {
      const walk = parseWalkPoses(readFileSync(resolved.posesPath, "utf8"));
      const region = denseWalkRegion(walk);
      const medoid = medoidPose(walk);
      const medianZ = walkEyeHeight(walk);
      if (region !== null && medoid !== null && medianZ !== null) {
        // Face along the room's longer axis from where the scanner stood.
        const spanX = region.max[0] - region.min[0];
        const spanY = region.max[1] - region.min[1];
        const yaw = spanY >= spanX ? 0 : Math.PI / 2;
        walkFrame = walkAlignedFrame(
          frame, region.min, region.max, medianZ, medoid.position, yaw,
        );
        void decimateWalk(walk, 120);
      }
    } catch {
      walkFrame = null;
    }

    const check = checkAgainstPublished(frame, source.publishedExtentM);
    const confidence = alignmentConfidence(frame.retainedFraction, check.verdict);

    entries.push({
      roomSlug: source.roomSlug,
      captureDir: source.captureDir,
      splatType: bundle.splatType,
      totalSplats: bundle.totalSplats,
      totalLevels: bundle.totalLevels,
      splatsByLevel: bundle.splatsByLevel,
      finestLevel: bundle.finestLevel,
      finestLevelSplats: bundle.finestLevelSplats,
      tiles: staged.tiles,
      totalBytes: staged.totalBytes,
      transform: walkFrame === null
        ? sceneTransformForRoomFrame(frame)
        : walkAlignedTransform(frame, walkFrame.centre),
      extentM: walkFrame === null ? sceneExtentForRoomFrame(frame) : walkFrame.extentM,
      spawn: walkFrame?.spawn ?? null,
      bounds: walkFrame?.bounds ?? null,
      eyeHeightM: walkFrame?.eyeHeightM ?? null,
      alignmentConfidence: confidence,
      alignmentNote: walkFrame === null
        ? `Derived from ${source.captureDir} geometry alone, with no recorded walk; ` +
          `${(frame.retainedFraction * 100).toFixed(0)}% of the capture sits inside the frame. ${check.detail}`
        : `Derived from ${source.captureDir}: floor from the room mesh, room from the ` +
          `scanner's own walk. ${check.detail}`,
    });

    process.stdout.write(
      `${source.roomSlug}: staged ${String(staged.tiles.length)} tiles, ` +
      `${(staged.totalBytes / 1024 / 1024).toFixed(0)} MB, alignment ${confidence}\n`,
    );
  }

  writeRoomManifest(args.manifest, entries);
  process.stdout.write(`\nWrote ${String(entries.length)} rooms to ${args.manifest}\n`);
  return failures > 0 ? 1 : 0;
}

/**
 * Builds a prebuilt level-of-detail tree for every served tile already in the
 * staging root, and writes the manifest back with a descriptor per tree.
 * Works without the capture drive: it reads the generated module, not the
 * captures. Re-running is cheap; existing trees are described, not rebuilt.
 */
function lod(args: Args): number {
  if (args.out === null) {
    process.stderr.write("Provide --out <staging root the tiles were staged into>.\n");
    return 1;
  }
  if (args.manifest === null) {
    process.stderr.write("Provide --manifest <path to the generated module>.\n");
    return 1;
  }
  if (args.buildLod === null) {
    process.stderr.write("Provide --build-lod <path to Spark's build-lod executable>.\n");
    return 1;
  }

  const entries = readGeneratedManifest(args.manifest);
  const run = buildLodRunner(args.buildLod);
  let failures = 0;
  const updated = entries.map((entry) => {
    if (args.room !== null && entry.roomSlug !== args.room) return entry;
    const result = buildRoomLodTrees(entry, join(args.out ?? "", VENUE_SLUG, entry.roomSlug), run);
    for (const failure of result.failures) process.stderr.write(`  ${entry.roomSlug}: ${failure}\n`);
    failures += result.failures.length;
    const treeBytes = result.entry.tiles.reduce(
      (sum, tile) => sum + (tile.lod?.bytes ?? 0) + (tile.lod?.chunks.reduce((s, c) => s + c.bytes, 0) ?? 0),
      0,
    );
    process.stdout.write(
      `${entry.roomSlug}: ${String(result.built)} trees built, ${String(result.reused)} reused, ` +
      `${(treeBytes / 1024 / 1024).toFixed(0)} MB under lod/, ${String(result.failures.length)} failures\n`,
    );
    return result.entry;
  });

  writeRoomManifest(args.manifest, updated);
  process.stdout.write(`\nWrote ${String(updated.length)} rooms to ${args.manifest}\n`);
  return failures > 0 ? 1 : 0;
}

function main(): void {
  const args = parseArgs(process.argv);
  switch (args.command) {
    case "measure":
      process.exitCode = measure(args);
      return;
    case "stage":
      process.exitCode = stage(args);
      return;
    case "lod":
      process.exitCode = lod(args);
      return;
    default:
      process.stderr.write(
        [
          "Usage:",
          "  lcc2 measure --scans <dir> [--grand-hall <dir>] [--room <slug>]",
          "  lcc2 stage   --scans <dir> [--grand-hall <dir>] --out <staging root> --manifest <json path>",
          "  lcc2 lod     --out <staging root> --manifest <generated module> --build-lod <exe> [--room <slug>]",
          "",
        ].join("\n"),
      );
      process.exitCode = 1;
  }
}

main();
