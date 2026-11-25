import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { TwinManifestSchema } from "@omnitwin/types";
import {
  TWIN_FIXTURE_MANIFEST,
  TWIN_FIXTURE_TILE_DATA_URI,
} from "../twin/__fixtures__/twin-fixture.js";

// -----------------------------------------------------------------------------
// Twin chunk budgets + fixture bundle guard (Twin Phase 1, Task 11).
//
// Two gates on the built output (sspp-performance-budget.test.ts pattern,
// pointed at dist/ because chunk size and chunk membership only exist after a
// build):
//   1. The lazy twin route chunk (dist/assets/TwinPage-*.js — TwinPage plus
//      every src/twin module Rollup folds into it) stays ≤ 250 KB gzip. The
//      shared three/react vendor chunks are excluded by construction: vite
//      config manualChunks routes them elsewhere.
//   2. The LandingPage chunk carries no twin module markers — marketing
//      routes never pay for the twin (plan Global Constraints).
//
// dist/ may be absent locally, or stale from a build that predates the twin
// route (then no TwinPage chunk exists). Either way the dist gates skip so
// unit runs stay green; the Task-12 ship pass builds fresh immediately before
// running this test, so the gates always execute where they matter.
//
// The fixture guard runs unconditionally: it re-validates the shared e2e
// fixture bundle under vitest so schema drift or a corrupted mock tile fails
// here, loudly, instead of surfacing as a mysterious e2e timeout.
// -----------------------------------------------------------------------------

const ASSETS_DIR = resolve("dist/assets");
const TWIN_CHUNK_BUDGET_GZIP_BYTES = 250 * 1024;

// The enquiry forms' chunk: Vite names it after @omnitwin/types' enquiry
// module (dist/assets/enquiry-<8-character hash>.js, so not enquiry-fit-* or
// enquiry-desk-format-*). It was 1.79 kB gzip in CI's build of #404. Which
// modules reach it is held in packages/types
// (enquiry-module-imports.test.ts); its bytes are held here, to about 2.5 KB
// gzip (review of #404, Q6).
const ENQUIRY_CHUNK = /^enquiry-[\w-]{8}\.js$/u;
const ENQUIRY_CHUNK_BUDGET_GZIP_BYTES = 2_560;
// The set-down engine's two chunks (T-700): the Worker (dist/assets/set-down.worker-<hash>.js) and the
// driver the scene imports lazily (set-down-driver-<hash>.js). The plan's budget for engine and data is
// one total for both (R101). The first figure was 25 KB. R103 set it at 32 KB: with nothing duplicated,
// the engine as ruled through R102 measured 31,827 B on 22 Nov 2026 (Worker 11,759, driver 20,068).
// The master merges of 23 and 25 Nov brought master's own engine data (the Robert Adam Room's outline,
// the tail bins): 32,424 B (Worker 11,768, driver 20,656), 344 B under it.
// R106 set it at 33 KB (33,792 B) after fix round 2, at 33,287 B (Worker 11,773, driver 21,514), each
// fix built from its commit's own source (gzip of both chunks, as below):
//   R105, a cascade voice judged at its own slot: +185 B;
//   R104, a far variant moved to where its piece lands: +391 B (the driver +386, the Worker +5);
//   the Worker's readiness, refusals on the tap, the bus cleared at every room change, a ghost changing
//     class: +66 B;
//   a contact reads only the supports and the ear, one reporter, dead code out, the nits: +123 B;
//   a piece renamed by a save while it comes down: +117 B;
//   other commits' shifts in the hashed names of the chunks the driver imports: -19 B.
// The menu's new Full line then shifted a hashed name: 33,298 B. Fix round 3 (R107, a variant moved only
// when its pan differs; R108, its slot looked at 1/30 s early) measured 33,253 B (Worker 11,773, driver
// 21,480): -45 B, with 539 B of headroom. Fix round 4 (R109, every voice started from its batch's one anchor;
// R110, a cascade voice spaced from the one landing before it) measured 33,331 B (Worker 11,773, driver
// 21,558): +78 B, with 461 B of headroom. Fix round 5 (R111, voices slotted by position in landing order;
// R112, the anchor at the first contact, re-anchored after an audio stall) measured 33,487 B (Worker 11,773,
// driver 21,714): +156 B, with 305 B of headroom. Fix round 6 (R113, a small set staggered from its last
// slot; R114, a batch anchored again on a new clock epoch or 150 ms behind, logged on the tap) measured
// 33,547 B (Worker 11,773, driver 21,774): +60 B, with 245 B of headroom. R114's epoch and R115's resume
// wait are in the registry's own chunk, outside this budget.
// Of the driver's 21,774 B, 1,370 B are Rollup's 81 hoisted bare imports of chunks the planner has loaded
// already (output.hoistTransitiveImports, a global setting left alone here). Growth past 33 KB needs a
// new ruling.
const SET_DOWN_WORKER_CHUNK = /^set-down\.worker-[\w-]{8}\.js$/u;
const SET_DOWN_TOTAL_BUDGET_GZIP_BYTES = 33 * 1024;

/**
 * The chunks a built chunk imports statically, in every form Rollup writes:
 * bare (`import"./a.js"`), named, namespace, a default with named or a
 * namespace (`import a,{b}from"./b.js"`), and re-exports (`export{c}from`,
 * `export*from`). A dynamic `import("./x.js")` loads later, and is not one.
 */
const STATIC_CHUNK_IMPORT = /\b(?:import\s*(?:(?:[\w$]+\s*,\s*)?(?:\{[^}]*\}|\*\s*as\s*[\w$]+|[\w$]+)\s*from\s*)?|export\s*(?:\*(?:\s*as\s*[\w$]+)?|\{[^}]*\})\s*from\s*)["']\.\/([^"']+\.js)["']/g;

function staticChunkImports(source: string): string[] {
  return [...source.matchAll(STATIC_CHUNK_IMPORT)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

/** Every chunk `roots` reach by static imports, themselves included. */
async function staticChunkClosure(roots: readonly string[]): Promise<Set<string>> {
  const reached = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const chunk = pending.pop();
    if (chunk === undefined || reached.has(chunk)) continue;
    reached.add(chunk);
    pending.push(...staticChunkImports(await readFile(resolve(ASSETS_DIR, chunk), "utf-8")));
  }
  return reached;
}

function jsChunks(prefix: string): string[] {
  return readdirSync(ASSETS_DIR).filter(
    (name) => name.startsWith(`${prefix}-`) && name.endsWith(".js"),
  );
}

const hasTwinBuild = existsSync(ASSETS_DIR) && jsChunks("TwinPage").length > 0;

// CI's Build job builds the bundle and then runs this file with
// REQUIRE_WEB_DIST=1, so there a missing build fails instead of skipping the
// budgets below (T-685: they had skipped in every CI run, since the Test job
// never builds the web app).
const REQUIRE_WEB_DIST = process.env["REQUIRE_WEB_DIST"] === "1";

describe.runIf(REQUIRE_WEB_DIST)("the build these budgets check", () => {
  it("is there, with its twin route chunk", () => {
    expect(hasTwinBuild, `no TwinPage chunk in ${ASSETS_DIR}`).toBe(true);
  });
});

describe("twin fixture bundle", () => {
  it("parse-validates against twin/0 with the walk graph the e2e relies on", () => {
    const manifest = TwinManifestSchema.parse(TWIN_FIXTURE_MANIFEST);
    expect(manifest.venueSlug).toBe("trades-hall");
    expect(manifest.nodes.map((node) => node.id)).toEqual([
      "scan_000",
      "scan_001",
      "scan_002",
      "scan_003",
    ]);
    expect(manifest.edges).toEqual([
      { a: "scan_000", b: "scan_001", distanceM: 2.5 },
      { a: "scan_001", b: "scan_002", distanceM: 2.5 },
      { a: "scan_001", b: "scan_003", distanceM: 2.5 },
    ]);
  });

  it("ships a real WebP as the universal mock tile", () => {
    const prefix = "data:image/webp;base64,";
    expect(TWIN_FIXTURE_TILE_DATA_URI.startsWith(prefix)).toBe(true);
    const bytes = Buffer.from(TWIN_FIXTURE_TILE_DATA_URI.slice(prefix.length), "base64");
    expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
    expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
  });
});

describe("the built-chunk walk", () => {
  it("follows every static form Rollup writes, and no dynamic import", () => {
    const source = [
      `import"./bare.js";`,
      `import{a as b}from"./named.js";`,
      `import*as c from"./namespace.js";`,
      `import d,{e}from"./default-and-named.js";`,
      `import f,*as g from"./default-and-namespace.js";`,
      `import h from "./default.js";`,
      `export{i}from"./reexport.js";`,
      `export*from"./star.js";`,
      `export*as j from"./star-as.js";`,
      `const k=()=>import("./lazy.js");`,
    ].join("\n");
    expect(staticChunkImports(source)).toEqual([
      "bare.js", "named.js", "namespace.js", "default-and-named.js", "default-and-namespace.js", "default.js", "reexport.js", "star.js", "star-as.js",
    ]);
  });
});

describe("twin chunk budgets", () => {
  it.skipIf(!hasTwinBuild)("keeps the twin route chunk within 250 KB gzip", async () => {
    const chunks = jsChunks("TwinPage");
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      const source = await readFile(resolve(ASSETS_DIR, chunk));
      const gzippedBytes = gzipSync(source).byteLength;
      expect(
        gzippedBytes,
        `${chunk} must stay within the twin chunk gzip budget`,
      ).toBeLessThanOrEqual(TWIN_CHUNK_BUDGET_GZIP_BYTES);
    }
  });

  it.skipIf(!hasTwinBuild)("keeps the enquiry forms' chunk within 2.5 KB gzip", async () => {
    const chunks = readdirSync(ASSETS_DIR).filter((name) => ENQUIRY_CHUNK.test(name));
    // Exactly one: with none the module has moved, and this would measure nothing.
    expect(chunks).toHaveLength(1);
    for (const chunk of chunks) {
      const gzippedBytes = gzipSync(await readFile(resolve(ASSETS_DIR, chunk))).byteLength;
      expect(
        gzippedBytes,
        `${chunk} must stay within the enquiry chunk gzip budget`,
      ).toBeLessThanOrEqual(ENQUIRY_CHUNK_BUDGET_GZIP_BYTES);
    }
  });

  it.skipIf(!hasTwinBuild)("keeps the WebGPU renderer chunk out of the twin route's static graph", async () => {
    // The tour renders with a WebGL R3F canvas. Only NativeCanvas surfaces
    // should pay for three.webgpu, TSL and the splat addons.
    expect(jsChunks("three-webgpu").length).toBeGreaterThan(0);
    const reached = await staticChunkClosure(jsChunks("TwinPage"));
    expect([...reached].some((chunk) => chunk.startsWith("three-") && !chunk.startsWith("three-webgpu-"))).toBe(true);
    expect([...reached].filter((chunk) => chunk.startsWith("three-webgpu-"))).toEqual([]);
  });

  // The set-down sound (T-700): the engine and its data load lazily with the
  // planner, in two chunks, which together stay within the plan's budget for
  // "engine and data", 33 KB gzip (R101, R103, R106). The Worker's chunk renders
  // every set-down and tail; the driver's is the scene's half, imported at the
  // planner's first idle (R78). Growth past the budget needs a new ruling.
  it.skipIf(!hasTwinBuild)("keeps the set-down engine's Worker chunk and its driver's chunk within 33 KB gzip together", async () => {
    const workers = readdirSync(ASSETS_DIR).filter((name) => SET_DOWN_WORKER_CHUNK.test(name));
    const drivers = jsChunks("set-down-driver");
    // Exactly one of each: with none the module has moved, and this would measure nothing.
    expect(workers).toHaveLength(1);
    expect(drivers).toHaveLength(1);
    let totalGzippedBytes = 0;
    for (const chunk of [...workers, ...drivers]) {
      totalGzippedBytes += gzipSync(await readFile(resolve(ASSETS_DIR, chunk))).byteLength;
    }
    expect(
      totalGzippedBytes,
      `${[...workers, ...drivers].join(" + ")} must stay within the set-down engine's gzip budget together`,
    ).toBeLessThanOrEqual(SET_DOWN_TOTAL_BUDGET_GZIP_BYTES);
  });

  it.skipIf(!hasTwinBuild)("keeps the set-down driver out of the planner's static chunks (R78)", async () => {
    const editor = jsChunks("EditorPage");
    expect(editor.length).toBeGreaterThan(0);
    const reached = await staticChunkClosure(editor);
    expect([...reached].filter((chunk) => chunk.startsWith("set-down-driver-") || SET_DOWN_WORKER_CHUNK.test(chunk))).toEqual([]);
  });

  // T-616 retargeted this from LandingPage to RoomsHomePage. `/landing` is
  // retired and redirects to `/`, so the router imports LandingPage nowhere,
  // Vite emits no chunk for it, and `jsChunks("LandingPage")` came back empty.
  // The subject was never that one page: it is that the PUBLIC front door must
  // not drag the twin's basis decoder and walk hook into its chunk. `/` is the
  // front door now, so that is the chunk to watch. The `toBeGreaterThan(0)`
  // guard is what caught this instead of letting an empty loop pass — keep it.
  it.skipIf(!hasTwinBuild)("keeps twin modules out of the front door's chunk", async () => {
    const chunks = jsChunks("RoomsHomePage");
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      const source = await readFile(resolve(ASSETS_DIR, chunk), "utf-8");
      expect(source, `${chunk} must not bundle twin-basis`).not.toContain("twin-basis");
      expect(source, `${chunk} must not bundle useTwinWalk`).not.toContain("useTwinWalk");
    }
  });
});
