/**
 * AVIF and WebP images for the /platform page.
 *
 *   node scripts/platform-images.mjs <photo-folder> <capture-folder>
 *
 * Sources: the photographs scripts/platform-hall.mjs renders from the live
 * tour's panoramas into <photo-folder> (hall-desktop.png, hall-phone.png,
 * hall-night.png, hall-dome.png, og-source.png), and the 2x product captures
 * e2e/platform-captures.spec.ts and the proposals desk capture write into
 * <capture-folder>. Each story step is served as a crop of its capture showing
 * what the step names, at a size its text can be read: a 4:5 frame for wider
 * screens and a tighter 3:4 detail for phones, plus the whole capture for the
 * enlarged view. Crops only cut; a crop narrower than its frame is set on the
 * capture's own page colour, and the setup step sets two phone screens side by
 * side. Nothing in a capture is redrawn. UI keeps full chroma (4:4:4 AVIF, WebP
 * at high quality) for legible text; the photographs use photographic
 * settings. Each image marked lqip gets a blurred 24-pixel placeholder written
 * into index.html (data-lqip), shown while it loads. Every output is recorded in
 * public/platform/img/provenance.json with its sources' SHA-256 and crops.
 *
 * sharp is not a dependency of the web package; it is resolved from the
 * workspace's pnpm store, where the reconstruction tools install it.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [photos, captures] = process.argv.slice(2);
if (!photos || !captures) throw new Error("Usage: node scripts/platform-images.mjs <photo-folder> <capture-folder>");
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repository = path.resolve(web, "..", "..");
const sharp = createRequire(path.join(repository, "node_modules", ".pnpm", "node_modules", "noop.js"))("sharp");
const out = path.join(web, "public", "platform", "img");
const pagePath = path.join(web, "public", "platform", "index.html");

const UI = { avif: { quality: 62, effort: 6, chromaSubsampling: "4:4:4" }, webp: { quality: 86, effort: 6, smartSubsample: true } };
const PHOTO = { avif: { quality: 54, effort: 6 }, webp: { quality: 80, effort: 6 } };
/** The lamps alone: mostly black, so small at a quality that keeps the bulbs crisp. */
const GLOW = { avif: { quality: 50, effort: 6 }, webp: { quality: 78, effort: 6 } };
/** The story frame's backdrop (styles.css .stage__frame). */
const FRAME = { r: 233, g: 226, b: 210 };
/** The proposals desk's page colour, sampled beside its panel. */
const DESK_SAGE = { r: 129, g: 144, b: 135 };

// crop: [left, top, width, height] in the source's pixels; pad: widen to a
// width:height ratio on a colour; compose: a named arrangement of captures.
const SETS = [
  { name: "hall-desktop", from: photos, source: "hall-desktop.png", widths: [1280, 1920, 2560], encoding: PHOTO, lqip: true },
  { name: "hall-phone", from: photos, source: "hall-phone.png", widths: [780, 1170], encoding: PHOTO },
  { name: "hall-desktop-glow", from: photos, source: "hall-desktop-glow.png", widths: [1280, 1920, 2560], encoding: GLOW },
  { name: "hall-phone-glow", from: photos, source: "hall-phone-glow.png", widths: [780, 1170], encoding: GLOW },
  { name: "hall-night", from: photos, source: "hall-night.png", widths: [1280, 1920, 2560], encoding: PHOTO, lqip: true },
  { name: "hall-dome", from: photos, source: "hall-dome.png", widths: [1440, 2160, 2880], encoding: PHOTO, lqip: true },
  // Each crop sits wholly inside the sheet or panel it shows (no sliver of
  // the desk behind it, no tilted edge) and is at least as wide as the
  // largest width the page asks of it; a narrower one is set on the desk's
  // own colour to that width.
  { name: "step-enquiry", source: "enquiries.png", crop: [1852, 750, 980, 1400], pad: { ratio: 4 / 5, colour: DESK_SAGE }, widths: [560, 1120], encoding: UI, lqip: true },
  { name: "step-enquiry-phone", source: "enquiries.png", crop: [1884, 770, 848, 1130], widths: [390, 780], encoding: UI },
  { name: "step-diary", source: "diary.png", crop: [1716, 560, 1120, 1400], widths: [560, 1120], encoding: UI, lqip: true },
  { name: "step-diary-phone", source: "diary.png", crop: [1470, 660, 780, 1040], widths: [390, 780], encoding: UI },
  { name: "step-planner", source: "planner.png", crop: [1640, 40, 1240, 1550], widths: [560, 1120], encoding: UI, lqip: true },
  { name: "step-planner-phone", source: "planner.png", crop: [1940, 222, 940, 1253], widths: [390, 780], encoding: UI },
  { name: "step-proposal", source: "proposal-claude-draft.png", crop: [1916, 730, 860, 1400], pad: { ratio: 4 / 5, colour: DESK_SAGE }, widths: [560, 1120], encoding: UI, lqip: true },
  { name: "step-proposal-phone", source: "proposal-claude-draft.png", crop: [1938, 716, 810, 1080], widths: [390, 780], encoding: UI },
  { name: "step-client", source: "client-accepted-full.png", crop: [692, 3372, 1496, 1870], widths: [560, 1120], encoding: UI, lqip: true },
  { name: "step-client-phone", source: "client-accepted-phone-full.png", crop: [0, 30, 780, 1040], widths: [390, 780], encoding: UI },
  { name: "step-setup", compose: "phones", widths: [560, 1120], encoding: UI, lqip: true },
  { name: "step-setup-phone", source: "hallkeeper-phone.png", crop: [0, 260, 780, 1040], widths: [390, 780], encoding: UI },
  ...[["enquiries", "enquiries"], ["diary", "diary"], ["proposal-claude-draft", "proposal-claude-draft"], ["client-accepted", "client-accepted"]].map(([name, source]) => ({
    name: `full-${name}`, source: `${source}.png`, widths: [2880], encoding: UI,
  })),
  // The planner whole, down to its own toolbars: the schedule dock below
  // them belongs to the layout's public link, not to the step.
  { name: "full-planner", source: "planner.png", crop: [0, 0, 2880, 2010], widths: [2880], encoding: UI },
  { name: "full-setup-phones", compose: "phones-full", widths: [1600], encoding: UI },
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = async (folder, name) => {
  const bytes = await fs.readFile(path.join(folder, name));
  return { name, bytes, sha256: sha256(bytes) };
};

/** A phone screen with rounded corners and a hairline edge, as set on the frame. */
async function screen(buffer, width) {
  const resized = await sharp(buffer).resize({ width, kernel: "lanczos3" }).png().toBuffer();
  const { height } = await sharp(resized).metadata();
  const radius = Math.round(width * 0.05);
  const mask = Buffer.from(`<svg width="${String(width)}" height="${String(height)}"><rect width="${String(width)}" height="${String(height)}" rx="${String(radius)}" fill="#fff"/></svg>`);
  const edge = Buffer.from(`<svg width="${String(width)}" height="${String(height)}"><rect x="0.5" y="0.5" width="${String(width - 1)}" height="${String(height - 1)}" rx="${String(radius)}" fill="none" stroke="rgba(23,36,30,0.22)" stroke-width="1.5"/></svg>`);
  const rounded = await sharp(resized).ensureAlpha().composite([{ input: mask, blend: "dest-in" }, { input: edge }]).png().toBuffer();
  return { buffer: rounded, width, height };
}

/** The hallkeeper's sheet on a phone: its first screen beside its plan. */
async function phones(full) {
  const first = await read(captures, "hallkeeper-phone.png");
  const plan = await read(captures, "hallkeeper-phone-plan.png");
  const [left, right] = full
    ? [first.bytes, plan.bytes]
    : [await sharp(first.bytes).extract({ left: 0, top: 0, width: 780, height: 1340 }).png().toBuffer(), await sharp(plan.bytes).extract({ left: 0, top: 380, width: 780, height: 1130 }).png().toBuffer()];
  // Both screens at one scale, side by side, as the phone shows them.
  const [canvasWidth, canvasHeight] = full ? [1740, 1808] : [1120, 1400];
  const [widthA, widthB] = full ? [780, 780] : [500, 500];
  const a = await screen(left, widthA);
  const b = await screen(right, widthB);
  const [leftA, topA, leftB, topB] = full
    ? [60, Math.round((canvasHeight - a.height) / 2), 900, Math.round((canvasHeight - b.height) / 2)]
    : [40, Math.round((canvasHeight - a.height) / 2), 580, Math.round((canvasHeight - b.height) / 2)];
  const buffer = await sharp({ create: { width: canvasWidth, height: canvasHeight, channels: 3, background: FRAME } })
    .composite([{ input: a.buffer, left: leftA, top: topA }, { input: b.buffer, left: leftB, top: topB }])
    .png().toBuffer();
  return { buffer, sources: [first, plan], note: full ? "both phone screens whole, side by side" : "first screen from the top to Keep in view (780x1340); plan screen from the stage tabs to the plan's foot (780x1130 at y 380)" };
}

async function prepare(set) {
  if (set.compose !== undefined) {
    const composed = await phones(set.compose === "phones-full");
    return { buffer: composed.buffer, sources: composed.sources, crop: null, note: composed.note };
  }
  const source = await read(set.from ?? captures, set.source);
  let buffer = set.crop === undefined
    ? source.bytes
    : await sharp(source.bytes).extract({ left: set.crop[0], top: set.crop[1], width: set.crop[2], height: set.crop[3] }).png().toBuffer();
  let note = null;
  if (set.pad !== undefined) {
    const { width, height } = await sharp(buffer).metadata();
    const target = Math.round(height * set.pad.ratio);
    const side = Math.max(0, Math.round((target - width) / 2));
    buffer = await sharp(buffer).extend({ left: side, right: target - width - side, top: 0, bottom: 0, background: set.pad.colour }).png().toBuffer();
    note = `set on the page colour to ${String(target)}x${String(height)}`;
  }
  return { buffer, sources: [source], crop: set.crop ?? null, note };
}

await fs.mkdir(out, { recursive: true });
for (const stale of await fs.readdir(out)) {
  if (/\.(avif|webp|jpg)$/u.test(stale)) await fs.rm(path.join(out, stale));
}
const files = [];
const placeholders = new Map();
for (const set of SETS) {
  const prepared = await prepare(set);
  const { width: preparedWidth } = await sharp(prepared.buffer).metadata();
  for (const width of set.widths) {
    const target = Math.min(width, preparedWidth);
    for (const format of ["avif", "webp"]) {
      const output = path.join(out, `${set.name}-${String(width)}.${format}`);
      const encoded = await sharp(prepared.buffer).resize({ width: target, kernel: "lanczos3" })[format](set.encoding[format]).toBuffer();
      await fs.writeFile(output, encoded);
      const { height } = await sharp(encoded).metadata();
      files.push({
        output: path.relative(web, output).replaceAll(path.sep, "/"),
        sources: prepared.sources.map((source) => ({ file: source.name, sha256: source.sha256 })),
        crop: prepared.crop,
        note: prepared.note,
        width: target,
        height,
        bytes: encoded.length,
      });
    }
  }
  if (set.lqip === true) {
    const tiny = await sharp(prepared.buffer).resize({ width: 24 }).webp({ quality: 40 }).toBuffer();
    placeholders.set(set.name, `data:image/webp;base64,${tiny.toString("base64")}`);
  }
}
// The link card: the desktop hero frame with the wedding breakfast drawn on it.
const ogSource = await read(photos, "og-source.png");
const og = await sharp(ogSource.bytes).resize({ width: 1200, height: 630, fit: "cover", position: "centre" }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
await fs.writeFile(path.join(out, "og-1200.jpg"), og);
files.push({ output: "public/platform/img/og-1200.jpg", sources: [{ file: ogSource.name, sha256: ogSource.sha256 }], crop: null, note: null, width: 1200, height: 630, bytes: og.length });

// Each placeholder, written beside its image's data-lqip name.
let page = await fs.readFile(pagePath, "utf8");
for (const [name, uri] of placeholders) {
  const pattern = new RegExp(`data-lqip="${name}"(?: style="[^"]*")?`, "gu");
  if (!pattern.test(page)) throw new Error(`No data-lqip="${name}" in ${pagePath}`);
  page = page.replace(pattern, `data-lqip="${name}" style="background-image:url(${uri})"`);
}
await fs.writeFile(pagePath, page);

await fs.writeFile(path.join(out, "provenance.json"), `${JSON.stringify({
  schemaVersion: 3,
  createdOn: new Date().toISOString().slice(0, 10),
  purpose: "Images on /platform. The hall photographs are resampled from scans 34, 39 and 44 of the live tour's 149 panoramas (scripts/platform-hall.mjs). Product images are the current app, built for production, rendering one sample wedding through the end-to-end API emulators (e2e/platform-captures.spec.ts, proposals-desk.spec.ts), cropped and never redrawn; none is a mock-up.",
  files,
}, null, 2)}\n`);
console.log(`${String(files.length)} files, ${String(Math.round(files.reduce((sum, file) => sum + file.bytes, 0) / 1024))} KiB, ${String(placeholders.size)} placeholders`);
