/**
 * Mirror the Google Fonts faces the web app uses into src/styles/fonts/.
 *
 *   node scripts/self-host-google-fonts.mjs [output-directory]
 *
 * (Behind an HTTP proxy, set NODE_USE_ENV_PROXY=1 so fetch honours HTTPS_PROXY.)
 *
 * The stylesheets below are the exact css2 requests the app used to make. Each
 * is fetched with a desktop Chrome user agent and written back with the same
 * @font-face rules (families, styles, weight ranges, unicode-range subsets,
 * font-display) pointing at local copies of the same woff2 files, which Vite
 * fingerprints at build time.
 *
 * Google Fonts serves some browsers a different build of the same face. Two
 * differ in data those browsers actually render, so their builds are mirrored
 * as override stylesheets that load after the default rules and win:
 *   - Firefox on Windows gets every face without its MVAR table (metric
 *     variations: x-height, underline and strikeout positions);
 *   - macOS gets the static EB Garamond italic instance with its glyph overlap
 *     flags set (WOFF, which carries them), which CoreText uses for overlapping
 *     contours.
 * Apple and Android builds of every other face differ from the default only by
 * a TrueType `prep` program (dropout control, never executed by CoreText or by
 * the forced auto-hinter Chrome uses on Android; Firefox for Android does not
 * hint) and by zero-valued GPOS records, so they are not duplicated. The
 * provenance file records the builds that are not mirrored.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outputDirectory = path.resolve(process.argv[2]
  ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/styles/fonts'));

const STYLESHEETS = {
  site: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,300..700,0..100,0..1;1,9..144,300..700,0..100,0..1&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap',
  cockpit: 'https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600&family=Playfair+Display:wght@400;500;600;700&display=swap',
  quiz: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700&family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500;1,600&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap',
};

const BUILDS = {
  default: {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    servedTo: 'Every browser without an override below.',
  },
  'firefox-windows': {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0',
    servedTo: 'Firefox on Windows.',
    includes: () => true,
  },
  macos: {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
    servedTo: 'macOS browsers, including iPadOS Safari, which identifies as macOS.',
    includes: (face) => face.family === 'EB Garamond' && face.style === 'italic',
  },
};

// google/fonts directory for each family's licence.
const LICENCE_DIRECTORIES = {
  Fraunces: 'fraunces', Newsreader: 'newsreader', Geist: 'geist', 'Geist Mono': 'geistmono',
  Inter: 'inter', 'Playfair Display': 'playfairdisplay',
  Cinzel: 'cinzel', 'Cormorant Garamond': 'cormorantgaramond', 'EB Garamond': 'ebgaramond',
};

const NOT_MIRRORED = [
  'Apple and Android builds of every face except the macOS EB Garamond italic instance: TrueType prep (dropout control) removed and zero-valued GPOS records dropped; neither is used by CoreText, by Chrome for Android (forced auto-hinter) or by Firefox for Android (unhinted).',
  'Static per-weight instances Google sends browsers it does not recognise as variable-font capable (measured 2026-09-24: Opera and Vivaldi on Windows, Yandex, Edge for Android, Firefox on Windows 7/8.1). Those browsers now receive variable faces: Firefox on Windows 7/8.1 the Firefox-on-Windows build, the others the default (Chrome) build.',
  'Instanced ("kit") faces Google sends iPad Safari when it requests mobile sites.',
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const slug = (family) => family.toLowerCase().replace(/[^a-z0-9]+/g, '-');

async function fetchWithRetry(url, userAgent, attempts = 5) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { headers: userAgent === undefined ? {} : { 'user-agent': userAgent } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= attempts) throw new Error(`${url}: ${error instanceof Error ? error.message : String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
}

/** Google's css2 output: a subset comment, then one @font-face block per face. */
function parseFaces(css) {
  const faces = [];
  for (const match of css.matchAll(/\/\* ([\w-]+) \*\/\n@font-face \{\n([^}]*)\}\n/g)) {
    const descriptors = Object.fromEntries([...match[2].matchAll(/^ {2}([\w-]+): (.*);$/gm)].map((m) => [m[1], m[2]]));
    const src = /^url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\) format\('(woff2?)'\)$/.exec(descriptors.src ?? '');
    const family = /^'(.+)'$/.exec(descriptors['font-family'] ?? '')?.[1];
    if (src === null || family === undefined) throw new Error(`Unexpected @font-face block:\n${match[0]}`);
    faces.push({
      block: match[0], subset: match[1], family, style: descriptors['font-style'], weight: descriptors['font-weight'],
      unicodeRange: descriptors['unicode-range'], url: src[1], format: src[2],
    });
  }
  const blocks = faces.map((face) => face.block).join('');
  if (blocks !== css) throw new Error('The stylesheet contains text outside the @font-face blocks this script understands.');
  return faces;
}

const faceKey = (face) => [face.family, face.style, face.weight, face.subset, face.unicodeRange].join('|');

const filesDirectory = path.join(outputDirectory, 'files');
const licenceDirectory = path.join(outputDirectory, 'licences');
await fs.rm(filesDirectory, { recursive: true, force: true });
await fs.rm(licenceDirectory, { recursive: true, force: true });
await fs.mkdir(filesDirectory, { recursive: true });
await fs.mkdir(licenceDirectory, { recursive: true });

const fetchedOn = new Date().toISOString().slice(0, 10);
const files = {};
const fileByUrl = new Map();
const stylesheets = {};
const families = new Set();

async function localFile(face, build) {
  const known = fileByUrl.get(face.url);
  if (known !== undefined) return known;
  const name = `${slug(face.family)}-${face.style}-${face.subset}${build === 'default' ? '' : `.${build}`}.${face.format}`;
  if (Object.hasOwn(files, name)) throw new Error(`${name} would name two different files.`);
  const bytes = await fetchWithRetry(face.url);
  const signature = bytes.subarray(0, 4).toString('latin1');
  if (signature !== (face.format === 'woff2' ? 'wOF2' : 'wOFF')) throw new Error(`${face.url} is not ${face.format}.`);
  await fs.writeFile(path.join(filesDirectory, name), bytes);
  files[name] = { source: face.url, bytes: bytes.length, sha256: sha256(bytes) };
  fileByUrl.set(face.url, name);
  return name;
}

for (const [group, stylesheetUrl] of Object.entries(STYLESHEETS)) {
  const fetched = {};
  for (const [build, { userAgent }] of Object.entries(BUILDS)) {
    const css = (await fetchWithRetry(stylesheetUrl, userAgent)).toString('utf8');
    fetched[build] = { css, faces: parseFaces(css) };
  }
  const defaults = fetched.default.faces;
  stylesheets[group] = { source: stylesheetUrl, css: {} };
  for (const [build, { css, faces }] of Object.entries(fetched)) {
    // Builds must describe the same faces; only the file behind a face may differ.
    if (faces.map(faceKey).join('\n') !== defaults.map(faceKey).join('\n')) {
      throw new Error(`The ${build} build of ${group} describes different faces from the default build.`);
    }
    const selected = build === 'default'
      ? faces
      : faces.filter((face, index) => face.url !== defaults[index].url && BUILDS[build].includes(face));
    if (selected.length === 0) continue;
    let text = '';
    for (const face of selected) {
      families.add(face.family);
      const name = await localFile(face, build);
      text += face.block.replace(face.url, `./files/${name}`);
    }
    const file = build === 'default' ? `${group}.css` : `${group}.${build}.css`;
    const header = `/* Generated by scripts/self-host-google-fonts.mjs from Google Fonts (${build} build, ${fetchedOn}); see provenance.json. */\n`;
    await fs.writeFile(path.join(outputDirectory, file), header + text);
    stylesheets[group].css[build] = { file, faces: selected.length, googleResponseSha256: sha256(Buffer.from(css)) };
  }
}

const licences = {};
for (const family of [...families].sort()) {
  const directory = LICENCE_DIRECTORIES[family];
  if (directory === undefined) throw new Error(`No licence directory is known for ${family}.`);
  const source = `https://raw.githubusercontent.com/google/fonts/main/ofl/${directory}/OFL.txt`;
  const bytes = await fetchWithRetry(source);
  if (!bytes.toString('utf8').includes('SIL OPEN FONT LICENSE Version 1.1')) throw new Error(`${source} is not the OFL.`);
  const file = `licences/${slug(family)}-OFL.txt`;
  await fs.writeFile(path.join(outputDirectory, file), bytes);
  licences[family] = { file, source, sha256: sha256(bytes) };
}

const provenance = {
  schemaVersion: 'venviewer.self-hosted-google-fonts.v1',
  fetchedOn,
  generator: 'packages/web/scripts/self-host-google-fonts.mjs',
  licence: 'SIL Open Font License 1.1; each family\'s licence text is under licences/.',
  builds: Object.fromEntries(Object.entries(BUILDS).map(([build, { userAgent, servedTo }]) => [build, { userAgent, servedTo }])),
  notMirrored: NOT_MIRRORED,
  stylesheets,
  licences,
  files,
};
await fs.writeFile(path.join(outputDirectory, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`${Object.keys(files).length} files, ${Object.values(files).reduce((sum, file) => sum + file.bytes, 0)} bytes, ${Object.keys(licences).length} licences -> ${outputDirectory}`);
