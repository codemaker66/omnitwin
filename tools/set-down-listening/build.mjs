// Builds the listening page: page.ts, with the set-down engine it imports, bundled by Vite's own esbuild into
// one IIFE and inlined into page.html, so the page is a single self-contained file.
//   node tools/set-down-listening/build.mjs [out.html]
// The default output is D:/claude/furniture-sound-20261027/listening/index.html.
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? "D:/claude/furniture-sound-20261027/listening/index.html";
const MARKER = "/*__PAGE_SCRIPT__*/";
/** The Artifact host's limit for a page. */
const LIMIT_BYTES = 16 * 1024 * 1024;

// esbuild is resolved from Vite's own dependency, so the page needs no install of its own.
const web = createRequire(new URL("../../packages/web/package.json", import.meta.url));
const esbuild = createRequire(web.resolve("vite/package.json"))("esbuild");

const result = await esbuild.build({
  entryPoints: [join(here, "page.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "none",
  charset: "utf8",
  write: false,
  logLevel: "warning",
  // The registry's React import is bundled; its production build is the one the planner ships.
  define: { "process.env.NODE_ENV": '"production"' },
});
const script = result.outputFiles[0]?.text;
if (script === undefined) throw new Error("esbuild produced no output");
// A script element ends at the first "</script"; "<!--" would change how the parser reads it.
if (/<\/script|<!--/i.test(script)) throw new Error("the bundle contains </script or <!--, which would break the inlined page");

const template = await readFile(join(here, "page.html"), "utf8");
if (template.split(MARKER).length !== 2) throw new Error(`page.html must hold ${MARKER} exactly once`);
const page = template.replace(MARKER, () => script);
if (/<!doctype|<(html|head|body)[\s>]/i.test(page)) throw new Error("the page must be content only: the Artifact host wraps it");

const bytes = Buffer.byteLength(page, "utf8");
if (bytes >= LIMIT_BYTES) throw new Error(`the page is ${String(bytes)} bytes, over the host's 16 MB`);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, page, "utf8");
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`${out}: ${kb(bytes)} (${kb(gzipSync(page).length)} gzipped; script ${kb(Buffer.byteLength(script, "utf8"))})`);
