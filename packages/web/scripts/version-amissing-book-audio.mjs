// Imported vo_* filenames hash the words, not the recording. Run after Vite
// copies public/: node scripts/version-amissing-book-audio.mjs [output] [source].
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const output = resolve(process.argv[2] ?? join(import.meta.dirname, "../dist/amissing-book"));
const source = resolve(process.argv[3] ?? join(import.meta.dirname, "../public/amissing-book"));
const base = "/amissing-book/";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const index = JSON.parse(readFileSync(join(source, "audio/index.json"), "utf8"));
let voices = 0;
for (const [id, file] of Object.entries(index)) {
  if (!id.startsWith("vo_")) continue;
  if (typeof file !== "string" || !/^vo\/vo_[A-Za-z0-9_]+\.mp3$/u.test(file)) {
    throw new Error(`Unexpected narration path for ${id}`);
  }
  index[id] = `${file}?v=${digest(readFileSync(join(source, "audio", file)))}`;
  voices += 1;
}
if (voices === 0) throw new Error("The Amissing Book has no narration to version");
const manifest = JSON.stringify(index);
const manifestName = `index-${digest(manifest)}.json`;
const html = readFileSync(join(source, "index.html"), "utf8");

function files(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = prefix + entry.name;
    return entry.isDirectory()
      ? files(join(directory, entry.name), `${name}/`)
      : [{ name, bytes: readFileSync(join(directory, entry.name)) }];
  }).sort((a, b) => a.name.localeCompare(b.name, "en"));
}

const assets = files(join(source, "assets"));
// Version the entire module graph together, including cyclic back-imports.
// A query on the entry alone would instantiate that module twice. Include the
// transform itself so changes to it also produce fresh URLs. Source stays intact.
const hash = createHash("sha256").update(readFileSync(import.meta.filename)).update(html).update(manifest);
for (const { name, bytes } of assets) hash.update(name).update("\0").update(bytes);
const revision = hash.digest("hex");
const assetBase = `${base}assets/${revision}/`;
const manifestUrl = `${base}audio/${manifestName}`;
let indexReferences = 0;
const transformed = assets.map(({ name, bytes }) => {
  if (!/\.(?:js|css)$/u.test(name)) return { name, bytes };
  const text = bytes.toString("utf8");
  indexReferences += text.split(`${base}audio/index.json`).length - 1;
  return {
    name,
    bytes: text.replaceAll(`${base}audio/index.json`, manifestUrl)
      .replaceAll(`${base}assets/`, assetBase)
      // Vite's __vite__mapDeps also holds base-relative preload names.
      .replace(/(["'`])assets\//gu, `$1assets/${revision}/`),
  };
});
// An upstream game import that changes the loader contract must fail the build.
if (indexReferences !== 1 || !html.includes(`${base}assets/`)) {
  throw new Error("The Amissing Book entry/manifest references changed; review audio versioning");
}
for (const { name, bytes } of transformed) {
  const target = join(output, "assets", revision, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}
mkdirSync(join(output, "audio"), { recursive: true });
writeFileSync(join(output, "audio", manifestName), manifest);
writeFileSync(join(output, "index.html"), html.replaceAll(`${base}assets/`, assetBase));
console.log(`The Amissing Book: versioned ${voices} voices (${revision.slice(0, 12)})`);
