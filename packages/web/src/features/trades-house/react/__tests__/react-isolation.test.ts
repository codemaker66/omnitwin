// The ownership laws for react/ and state/, held at the source level in the
// style of src/__tests__/bundle-splitting.test.ts: nothing here imports the
// instrument, reads a clock, rolls a die, or pulls in Three.js; and the
// production-grade rule (no TODOs, no eslint-disable) holds in the same pass.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FEATURE_ROOT = resolve(import.meta.dirname, "..", "..");
const OWNED_DIRS = ["react", "state"] as const;

const EXPECTED_FILES = [
  "react/react-types.ts",
  "react/pokeable-reducer.ts",
  "react/react.ts",
  "react/haptics.ts",
  "state/run-types.ts",
  "state/prefs-store.ts",
  "state/pokes-store.ts",
  "state/stage-store.ts",
] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/u.test(entry)) out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
}

const sources = OWNED_DIRS.flatMap((dir) => walk(join(FEATURE_ROOT, dir))).map((path) => ({
  path: relative(FEATURE_ROOT, path).replace(/\\/gu, "/"),
  raw: readFileSync(path, "utf8"),
}));

describe("react/ and state/ isolation", () => {
  it("scans the files it is meant to scan (never vacuous)", () => {
    const paths = sources.map((s) => s.path);
    for (const expected of EXPECTED_FILES) expect(paths).toContain(expected);
  });

  it.each(sources.map((s) => [s.path, s] as const))("%s imports nothing from the instrument", (_path, source) => {
    expect(stripComments(source.raw)).not.toMatch(/from\s+["'][^"']*craft-quiz-(?:model|deliberation)/u);
  });

  it.each(sources.map((s) => [s.path, s] as const))("%s reads no clock and rolls no die", (_path, source) => {
    const code = stripComments(source.raw);
    expect(code).not.toMatch(/\bDate\.now\b/u);
    expect(code).not.toMatch(/\bnew\s+Date\b/u);
    expect(code).not.toMatch(/\bMath\.random\b/u);
    expect(code).not.toMatch(/\bperformance\.now\b/u);
  });

  it.each(sources.map((s) => [s.path, s] as const))("%s imports no Three.js", (_path, source) => {
    expect(stripComments(source.raw)).not.toMatch(/from\s+["'](?:three|@react-three\/|@sparkjsdev\/)/u);
  });

  it.each(sources.map((s) => [s.path, s] as const))("%s is production grade: no TODO, no eslint-disable", (_path, source) => {
    expect(source.raw).not.toMatch(/\b(?:TODO|FIXME|XXX)\b/u);
    expect(source.raw).not.toMatch(/eslint-disable/u);
  });
});
