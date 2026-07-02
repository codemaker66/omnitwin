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

function jsChunks(prefix: string): string[] {
  return readdirSync(ASSETS_DIR).filter(
    (name) => name.startsWith(`${prefix}-`) && name.endsWith(".js"),
  );
}

const hasTwinBuild = existsSync(ASSETS_DIR) && jsChunks("TwinPage").length > 0;

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

  it.skipIf(!hasTwinBuild)("keeps twin modules out of the LandingPage chunk", async () => {
    const chunks = jsChunks("LandingPage");
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      const source = await readFile(resolve(ASSETS_DIR, chunk), "utf-8");
      expect(source, `${chunk} must not bundle twin-basis`).not.toContain("twin-basis");
      expect(source, `${chunk} must not bundle useTwinWalk`).not.toContain("useTwinWalk");
    }
  });
});
