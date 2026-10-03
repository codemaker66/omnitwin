import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESIGN_IDS } from '../server/card-review-core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../public/trades-hall/cards');
function fail(message) { throw new Error(`Card review release check: ${message}`); }
function file(path) {
  if (typeof path !== 'string' || !path.startsWith('./')) fail('assets must use relative paths');
  const absolute = resolve(root, path);
  const boundary = relative(root, absolute);
  if (boundary.startsWith('..') || isAbsolute(boundary)) fail('asset path leaves the collection');
  if (!statSync(absolute).isFile() || statSync(absolute).size === 0) fail(`missing or empty asset ${path}`);
  return absolute;
}
const designs = JSON.parse(readFileSync(resolve(root, 'designs.json'), 'utf8'));
if (!Array.isArray(designs) || designs.length !== DESIGN_IDS.length) fail('every listed client selection is required');
if (new Set(designs.map(design => design.id)).size !== DESIGN_IDS.length) fail('design IDs must be unique');
for (const id of DESIGN_IDS) if (!designs.some(design => design.id === id)) fail(`missing selected design ${id}`);
for (const design of designs) {
  for (const key of ['title', 'label']) if (typeof design[key] !== 'string' || !design[key].trim()) fail(`${design.id} needs ${key}`);
  for (const key of ['critique', 'improvement']) if (Object.hasOwn(design, key)) fail(`${design.id} exposes internal ${key} notes`);
  file(design.image); file(design.proof);
}
for (const path of ['./index.html','./review.js','./review.css','./api.js','./activity.js','./activity.css','./results.html','./results.js','./results.css']) file(path);
const secrets = ['CARD_REVIEW_DATABASE_URL','CARD_REVIEW_OWNER_TOKEN','CARD_REVIEW_RATE_SECRET']
  .map(key => process.env[key]).filter(value => value && value !== '[SENSITIVE]');
function inspect(directory) {
  for (const entry of readdirSync(directory, {withFileTypes:true})) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) { inspect(path); continue; }
    if (entry.isSymbolicLink()) fail('symbolic links are not public collection assets');
    if (['.html','.js','.json','.css','.md','.txt','.svg'].includes(extname(path))) {
      const source = readFileSync(path, 'utf8');
      if (secrets.some(secret => source.includes(secret))) fail(`private data found in ${relative(root,path)}`);
    }
  }
}
inspect(root);
console.log(`Card review release check passed: ${designs.length} selections, image/proof assets, form and protected results page.`);
