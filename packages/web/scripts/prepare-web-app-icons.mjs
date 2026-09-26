/**
 * The site's web-app icons, minted from the tracked favicon (T-616).
 *
 *   node packages/web/scripts/prepare-web-app-icons.mjs
 *
 * Run from the repository root; sharp is pinned in tools/twin-forge. The
 * source is packages/web/public/favicon.svg and nothing outside
 * packages/web/public/ is written. The outputs are the apple-touch-icon and
 * the three icons site.webmanifest names; the script prints the byte size of
 * each so the figures in a report are measured, not assumed.
 *
 * Lane 2 (PR #30) first wrote this as prepare-front-door-images.mjs, which also
 * re-encoded the supplied room photographs into WebP rungs for the front door.
 * Master had meanwhile shipped display-sized ladders of the same photographs
 * (lib/room-posters.ts, public/images/venue/ladder and
 * public/images/rooms/supplied/ladder), which the front door serves and
 * index.html preloads, so that half is not carried: it would have written a
 * second copy of every photograph that nothing references.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const require = createRequire(path.resolve(repoRoot, "tools/twin-forge/package.json"));
const sharp = (await import(pathToFileURL(require.resolve("sharp")).href)).default;

const publicDir = path.resolve(repoRoot, "packages/web/public");

/** The register's ivory ground: what Apple composites the touch icon on. */
const IVORY = "#f2edda";

const ICON_SOURCE = "favicon.svg";
const ICONS = [
  { out: "apple-touch-icon.png", size: 180, background: IVORY, padding: 0 },
  { out: "icon-192.png", size: 192, background: null, padding: 0 },
  { out: "icon-512.png", size: 512, background: null, padding: 0 },
  // Maskable: the platform may crop to a circle, so the mark keeps to the
  // central safe zone on an ivory field.
  { out: "icon-maskable-512.png", size: 512, background: IVORY, padding: 0.1 },
];

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

const source = path.join(publicDir, ICON_SOURCE);
let total = 0;
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
  total += size;
  console.log(`${icon.out}  ${String(icon.size)}px  ${kb(size)}`);
}
console.log(`${String(ICONS.length)} icons written, ${kb(total)} in total.`);
