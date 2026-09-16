/**
 * Front-door image weight (T-616).
 *
 * Re-encodes the venue's supplied room photography into responsive WebP rungs
 * and mints the PWA icon set. Run from the repository root:
 *
 *   node packages/web/scripts/prepare-front-door-images.mjs
 *
 * Every source is a file already tracked in this public repository under
 * packages/web/public/. Nothing is read from a private folder or an external
 * drive, and nothing outside packages/web/public/ is written.
 *
 * Rungs land in public/images/rooms/ladder/ as <basename>-<width>.webp — the
 * same shape as the older public/images/venue/ladder/ rungs, but a directory
 * of their own. That separation is load-bearing: the ladder namespace is flat
 * by basename, and the venue set already holds reception-room-*.webp and
 * robert-adam-room-*.webp cut from DIFFERENT photographs of those two rooms
 * (public/images/venue/*.jpg). Writing the supplied set into the same folder
 * silently overwrites six rungs /fresh renders. Keep the two sets apart.
 *
 * The hero budget is the gate's: every hero rung must come in at or under
 * 300 KB (plan 18, section 2, line 6). The script asserts that rather than
 * trusting the quality setting, and prints the byte size of everything it
 * writes so the figures in the report are measured, not assumed.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const require = createRequire(path.resolve(repoRoot, "tools/twin-forge/package.json"));
const sharp = (await import(pathToFileURL(require.resolve("sharp")))).default;

const publicDir = path.resolve(repoRoot, "packages/web/public");
const ladderDir = path.join(publicDir, "images/rooms/ladder");

/** Hero rungs must clear the gate's 300 KB ceiling. */
const HERO_MAX_BYTES = 300 * 1024;

/**
 * The supplied photography, with the rung widths the page that renders each
 * one actually asks for. `hero: true` applies the 300 KB assertion.
 */
const SOURCES = [
  { file: "images/rooms/supplied/grand-hall.jpeg", widths: [480, 768, 1120, 1536], hero: true },
  { file: "images/rooms/supplied/reception-room.jpeg", widths: [480, 768, 1120, 1536] },
  { file: "images/rooms/supplied/robert-adam-room.jpg", widths: [480, 768, 1120] },
  { file: "images/rooms/supplied/north-gallery.png", widths: [480, 768, 1120] },
  { file: "images/rooms/supplied/south-gallery.png", widths: [480, 768, 1120] },
  { file: "images/rooms/supplied/deacon-conveners-room.png", widths: [480, 768, 1120] },
  { file: "images/rooms/supplied/lady-convenors-room.png", widths: [480, 768, 1120] },
];

/** The PWA and iOS icon set, rendered from the tracked favicon. */
const ICON_SOURCE = "favicon.svg";
const ICONS = [
  { out: "apple-touch-icon.png", size: 180, background: "#f2edda", padding: 0 },
  { out: "icon-192.png", size: 192, background: null, padding: 0 },
  { out: "icon-512.png", size: 512, background: null, padding: 0 },
  { out: "icon-maskable-512.png", size: 512, background: "#f2edda", padding: 0.1 },
];

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function buildLadder() {
  await fs.mkdir(ladderDir, { recursive: true });
  const written = [];
  for (const source of SOURCES) {
    const absolute = path.join(publicDir, source.file);
    const basename = path.basename(source.file).replace(/\.[a-z0-9]+$/i, "");
    const original = await fs.stat(absolute);
    const meta = await sharp(absolute).metadata();
    console.log(
      `\n${source.file} - ${String(meta.width)}x${String(meta.height)}, ${kb(original.size)}`,
    );
    for (const width of source.widths) {
      if (meta.width !== undefined && width > meta.width) {
        // Never upscale: a rung wider than the negative is bytes for nothing.
        console.log(`  ${String(width)}w  skipped (source is ${String(meta.width)}px wide)`);
        continue;
      }
      const out = path.join(ladderDir, `${basename}-${String(width)}.webp`);
      // effort 6 is the slowest encoder setting that still finishes in seconds
      // per image; it buys roughly ten per cent over the default at the same
      // quality number.
      await sharp(absolute)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: source.hero ? 78 : 74, effort: 6 })
        .toFile(out);
      const { size } = await fs.stat(out);
      if (source.hero && size > HERO_MAX_BYTES) {
        throw new Error(
          `${path.basename(out)} is ${kb(size)}, over the ${kb(HERO_MAX_BYTES)} hero ceiling`,
        );
      }
      written.push({ out: path.relative(publicDir, out), size });
      console.log(`  ${String(width)}w  ${kb(size)}  ${path.relative(publicDir, out)}`);
    }
  }
  return written;
}

async function buildIcons() {
  const source = path.join(publicDir, ICON_SOURCE);
  const written = [];
  for (const icon of ICONS) {
    const inner = Math.round(icon.size * (1 - icon.padding * 2));
    const pad = Math.round((icon.size - inner) / 2);
    // density: the source is an SVG, so rasterise straight to the target size
    // rather than scaling up a bitmap rendered at the default 72 dpi.
    let pipeline = sharp(source, { density: 384 }).resize(inner, inner, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
    if (pad > 0) {
      pipeline = pipeline.extend({
        top: pad,
        bottom: icon.size - inner - pad,
        left: pad,
        right: icon.size - inner - pad,
        background: icon.background ?? { r: 0, g: 0, b: 0, alpha: 0 },
      });
    }
    if (icon.background !== null) {
      // Apple ignores transparency and composites on black; give it the
      // register's ivory ground instead of a black square behind the mark.
      pipeline = pipeline.flatten({ background: icon.background });
    }
    const out = path.join(publicDir, icon.out);
    await pipeline.png({ compressionLevel: 9 }).toFile(out);
    const { size } = await fs.stat(out);
    written.push({ out: icon.out, size });
    console.log(`  ${icon.out}  ${String(icon.size)}px  ${kb(size)}`);
  }
  return written;
}

console.log("Rungs");
const rungs = await buildLadder();
console.log("\nIcons");
const icons = await buildIcons();

const total = [...rungs, ...icons].reduce((sum, file) => sum + file.size, 0);
console.log(
  `\n${String(rungs.length)} rungs and ${String(icons.length)} icons written, ${kb(total)} in total.`,
);
