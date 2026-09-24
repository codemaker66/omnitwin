/**
 * Display-sized WebP copies of images that pages draw far smaller than their
 * sources.
 *
 *   node scripts/build-image-ladders.mjs <repository>
 *
 * <repository> is a checkout whose tools/twin-forge has its dependencies
 * installed; sharp is pinned there. Sources are never modified and remain the
 * files of record. Each output directory gets a provenance.json with the
 * source and variant hashes and every variant's encoding error, measured
 * against the exact Lanczos resample of its source (alpha-premultiplied, the
 * way it is composited).
 *
 * Widths come from the largest box each page draws the image at, measured in
 * Chromium across viewports: 1x, 2x and 3x of that box, never above the
 * source width. `source` keeps the source width for surfaces that need all of
 * it (re-encoded only).
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = process.argv[2];
if (!repository) throw new Error('Usage: node build-image-ladders.mjs <repository-with-twin-forge-dependencies>');
const sharp = createRequire(path.resolve(repository, 'tools/twin-forge/package.json'))('sharp');
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CRESTS = ['bakers', 'barbers', 'coopers', 'cordiners', 'dyers', 'fleshers', 'gardeners', 'hammermen',
  'maltmen', 'masons', 'skinners', 'tailors', 'weavers', 'wrights'];

// libwebp's near_lossless preprocessing at level 60, which moves a channel by
// at most a few levels.
const ENCODINGS = {
  'near-lossless': { options: { nearLossless: true, quality: 60, effort: 6 }, label: 'WebP near-lossless (libwebp near_lossless 60), effort 6' },
};

const SETS = [
  {
    directory: 'public/trades-house-media/assets/crests/ladder',
    purpose: 'Craft quiz crests: the intro rails draw them at most 56 CSS px wide; the result medallion uses the source-width copy.',
    sources: CRESTS.map((crest) => `public/trades-house-media/assets/crests/${crest}.png`),
    widths: [56, 112, 168, 'source'],
    encoding: 'near-lossless',
  },
  {
    directory: 'public/trades-house-media/assets/ladder',
    purpose: 'Craft quiz intro armorial (achievement below 1180 px, arms alone above), drawn at most 216 CSS px wide.',
    sources: ['public/trades-house-media/assets/achievement.png', 'public/trades-house-media/assets/crest-sm.png'],
    widths: [216, 432, 648],
    encoding: 'near-lossless',
  },
  {
    directory: 'src/assets/inventory-style/ladder',
    purpose: 'Inventory illustrations: the list draws them in a box 96 CSS px tall and the featured one in a box at most 360 px tall (object-fit: contain). The lossless full-size WebP beside each PNG stays the widest copy.',
    sources: [
      { path: 'src/assets/inventory-style/chiavari-chair.png', widths: [128, 256, 480, 720] },
      { path: 'src/assets/inventory-style/round-table.png', widths: [288, 576, 1080] },
      { path: 'src/assets/inventory-style/projector.png', widths: [288, 576, 1080] },
    ],
    encoding: 'near-lossless',
  },
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Premultiplied RGBA error: what differs once the pixel is composited. */
function encodingError(reference, decoded) {
  let squared = 0;
  let max = 0;
  for (let index = 0; index < reference.length; index += 4) {
    const alphaA = reference[index + 3] / 255;
    const alphaB = decoded[index + 3] / 255;
    for (let channel = 0; channel < 4; channel += 1) {
      const a = channel === 3 ? reference[index + 3] : reference[index + channel] * alphaA;
      const b = channel === 3 ? decoded[index + 3] : decoded[index + channel] * alphaB;
      squared += (a - b) ** 2;
      max = Math.max(max, Math.abs(a - b));
    }
  }
  const mse = squared / reference.length;
  return { psnrDb: mse === 0 ? null : Number((10 * Math.log10((255 * 255) / mse)).toFixed(2)), maxChannelError: Math.round(max) };
}

for (const set of SETS) {
  const directory = path.join(web, set.directory);
  await fs.mkdir(directory, { recursive: true });
  const encoding = ENCODINGS[set.encoding];
  const images = [];
  for (const entry of set.sources) {
    const source = typeof entry === 'string' ? entry : entry.path;
    const widths = typeof entry === 'string' ? set.widths : entry.widths;
    const input = await fs.readFile(path.join(web, source));
    const metadata = await sharp(input).metadata();
    if (!metadata.width || !metadata.height) throw new Error(`${source} has no dimensions.`);
    const base = path.basename(source, path.extname(source));
    const variants = [];
    for (const requested of widths) {
      const width = requested === 'source' ? metadata.width : requested;
      if (width > metadata.width) throw new Error(`${source} is ${metadata.width} px wide; a ${width} px copy would upscale it.`);
      const pipeline = sharp(input).ensureAlpha();
      const resampled = width === metadata.width ? pipeline : pipeline.resize({ width, kernel: 'lanczos3' });
      const reference = await resampled.raw().toBuffer({ resolveWithObject: true });
      const { width: outWidth, height: outHeight } = reference.info;
      const raw = { width: outWidth, height: outHeight, channels: 4 };
      const hasAlpha = metadata.hasAlpha === true;
      const encoder = hasAlpha ? sharp(reference.data, { raw }) : sharp(reference.data, { raw }).removeAlpha();
      const bytes = await encoder.webp(encoding.options).toBuffer();
      const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer();
      const name = `${base}-${outWidth}.webp`;
      await fs.writeFile(path.join(directory, name), bytes);
      variants.push({
        path: `/${path.posix.join(set.directory.replace(/^public\//u, ''), name)}`,
        width: outWidth, height: outHeight, bytes: bytes.length, sha256: sha256(bytes),
        ...encodingError(reference.data, decoded),
      });
    }
    images.push({
      source: { path: `/${source.replace(/^public\//u, '')}`, width: metadata.width, height: metadata.height, bytes: input.length, sha256: sha256(input) },
      variants,
    });
  }
  const provenance = {
    schemaVersion: 'venviewer.image-ladder.v1',
    generator: 'packages/web/scripts/build-image-ladders.mjs',
    purpose: set.purpose,
    transformation: {
      tool: `sharp ${sharp.versions.sharp} (libvips ${sharp.versions.vips}, libwebp ${sharp.versions.webp})`,
      resize: 'Lanczos3 with premultiplied alpha; aspect ratio kept; no crop; source-width copies are not resampled',
      encoding: encoding.label,
      error: 'psnrDb and maxChannelError compare each decoded copy with the exact resample of its source (premultiplied RGBA; psnrDb is null when identical)',
    },
    images,
  };
  await fs.writeFile(path.join(directory, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  console.log(`${set.directory}: ${images.length} sources, ${images.reduce((n, image) => n + image.variants.length, 0)} copies`);
}
