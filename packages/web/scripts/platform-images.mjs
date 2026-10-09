/**
 * AVIF and WebP images for the /platform page.
 *
 *   node scripts/platform-images.mjs <capture-folder>
 *
 * Sources, all in <capture-folder>: the photographs scripts/platform-hall.mjs
 * renders from the live tour's panoramas (hall-desktop.png, hall-phone.png,
 * hall-night.png, hall-dome.png),
 * and the 2x product captures e2e/platform-captures.spec.ts and the
 * proposals desk capture write. Each story step is served as a crop of its
 * capture showing what the step names, at a size its text can be read: a
 * 4:3 frame for wider screens and a tighter detail for phones, plus the whole
 * capture for the enlarged view. Crops only cut; nothing is redrawn. UI keeps
 * full chroma (4:4:4 AVIF, WebP at high quality) for legible text; the
 * photographs use ordinary photographic settings. Every output is recorded in
 * public/platform/img/provenance.json with its source's SHA-256 and crop.
 *
 * sharp is not a dependency of the web package; it is resolved from the
 * workspace's pnpm store, where the reconstruction tools install it.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const captures = process.argv[2];
if (!captures) throw new Error("Usage: node scripts/platform-images.mjs <capture-folder>");
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repository = path.resolve(web, "..", "..");
const sharp = createRequire(path.join(repository, "node_modules", ".pnpm", "node_modules", "noop.js"))("sharp");
const out = path.join(web, "public", "platform", "img");

const UI = { avif: { quality: 62, effort: 6, chromaSubsampling: "4:4:4" }, webp: { quality: 86, effort: 6, smartSubsample: true } };
const PHOTO = { avif: { quality: 54, effort: 6 }, webp: { quality: 80, effort: 6 } };

// [left, top, width, height] in the 2x capture's pixels.
const SETS = [
  { name: "hall-desktop", source: "hall-desktop.png", widths: [1280, 1920, 2560], encoding: PHOTO },
  { name: "hall-phone", source: "hall-phone.png", widths: [780, 1170], encoding: PHOTO },
  { name: "hall-night", source: "hall-night.png", widths: [1200, 2400], encoding: PHOTO },
  { name: "hall-dome", source: "hall-dome.png", widths: [900, 1800], encoding: PHOTO },
  { name: "step-enquiry", source: "enquiries.png", crop: [1700, 560, 1180, 885], widths: [590, 1180], encoding: UI },
  { name: "step-enquiry-phone", source: "enquiries.png", crop: [1720, 350, 1140, 1450], widths: [570, 1140], encoding: UI },
  { name: "step-diary", source: "diary.png", crop: [1190, 470, 1690, 1268], widths: [845, 1690], encoding: UI },
  { name: "step-diary-phone", source: "diary.png", crop: [1700, 760, 1140, 1040], widths: [570, 1140], encoding: UI },
  { name: "step-planner", source: "planner.png", crop: [640, 190, 1480, 1110], widths: [740, 1480], encoding: UI },
  { name: "step-proposal", source: "proposal-claude-draft.png", crop: [1760, 560, 1100, 825], widths: [550, 1100], encoding: UI },
  { name: "step-proposal-phone", source: "proposal-claude-draft.png", crop: [1870, 650, 980, 640], widths: [490, 980], encoding: UI },
  { name: "step-client", source: "client-respond.png", crop: [640, 215, 1480, 1110], widths: [740, 1480], encoding: UI },
  { name: "step-client-phone", source: "client-respond.png", crop: [700, 560, 1400, 1180], widths: [700, 1400], encoding: UI },
  { name: "step-setup", source: "hallkeeper-phone-plan.png", widths: [390, 780], encoding: UI },
  ...["enquiries", "diary", "planner", "proposal-claude-draft", "client-respond"].map((name) => ({
    name: `full-${name}`, source: `${name}.png`, widths: [2880], encoding: UI,
  })),
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

await fs.mkdir(out, { recursive: true });
for (const stale of await fs.readdir(out)) {
  if (/\.(avif|webp|jpg)$/u.test(stale)) await fs.rm(path.join(out, stale));
}
const files = [];
for (const set of SETS) {
  const sourcePath = path.join(captures, set.source);
  const bytes = await fs.readFile(sourcePath);
  const cropped = set.crop === undefined
    ? bytes
    : await sharp(bytes).extract({ left: set.crop[0], top: set.crop[1], width: set.crop[2], height: set.crop[3] }).png().toBuffer();
  const { width: croppedWidth } = await sharp(cropped).metadata();
  for (const width of set.widths) {
    const target = Math.min(width, croppedWidth);
    for (const format of ["avif", "webp"]) {
      const output = path.join(out, `${set.name}-${String(width)}.${format}`);
      const encoded = await sharp(cropped).resize({ width: target, kernel: "lanczos3" })[format](set.encoding[format]).toBuffer();
      await fs.writeFile(output, encoded);
      const { height } = await sharp(encoded).metadata();
      files.push({
        output: path.relative(web, output).replaceAll(path.sep, "/"),
        source: set.source,
        sourceSha256: sha256(bytes),
        crop: set.crop ?? null,
        width: target,
        height,
        bytes: encoded.length,
      });
    }
  }
}
// The link card: the desktop hero frame with the wedding breakfast drawn on it.
const og = await sharp(path.join(captures, "og-source.png")).resize({ width: 1200, height: 630, fit: "cover", position: "centre" }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
await fs.writeFile(path.join(out, "og-1200.jpg"), og);
files.push({ output: "public/platform/img/og-1200.jpg", source: "og-source.png", sourceSha256: sha256(await fs.readFile(path.join(captures, "og-source.png"))), crop: null, width: 1200, height: 630, bytes: og.length });

await fs.writeFile(path.join(out, "provenance.json"), `${JSON.stringify({
  schemaVersion: 2,
  createdOn: new Date().toISOString().slice(0, 10),
  purpose: "Images on /platform. The hero frames are resampled from scan 44 of the live tour's 149 panoramas (scripts/platform-hall.mjs). Product images are the current app rendering one sample wedding through the end-to-end API emulators (e2e/platform-captures.spec.ts, proposals-desk.spec.ts), cropped and never redrawn; none is a mock-up.",
  files,
}, null, 2)}\n`);
console.log(`${String(files.length)} files, ${String(Math.round(files.reduce((sum, file) => sum + file.bytes, 0) / 1024))} KiB`);
