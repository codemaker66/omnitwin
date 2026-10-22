import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// One keyboard owner (T-671 slice 5; spec 4.5).
//
// Twenty-two handlers used to listen for Escape in the planner, each on its
// own, so one press could cancel the placing and clear the selection at once
// and Esc never left Draw. Now lib/planner-keys.ts owns the press: every other
// file the planner reaches registers a layer or a binding with it. This guard
// walks the planner's real import graph from its page (and the new chrome's
// folder, which slice 6 mounts) and fails on any other file that reads Escape
// or adds a keydown listener of its own.
//
// Each rule is a function over source text, proved against a sample that
// breaks it before it is trusted to find nothing.
// ---------------------------------------------------------------------------

const SRC = resolve("src");
const ENTRY = join(SRC, "pages", "EditorPage.tsx");
const CHROME = join(SRC, "components", "planner-chrome");
const OWNER = "lib/planner-keys.ts";

/** Reads Escape: the key's name as a literal, wherever it is compared or switched on. */
function readsEscape(source: string): boolean {
  return /["'`]Escape["'`]/u.test(source);
}

/** Adds its own keydown listener (the owner's one listener is the only one wanted). */
function listensForKeys(source: string): boolean {
  return /addEventListener\(\s*["'`]keydown["'`]/u.test(source);
}

/**
 * Files that may listen for keydown, each for a reason that is not a shortcut:
 * a focus trap's Tab cycling, and the first deliberate gesture that may make
 * the audio context (spec 9).
 */
const KEYDOWN_ALLOWED: Readonly<Record<string, string>> = {
  "lib/use-focus-trap.ts": "a modal's Tab cycling, not a shortcut",
  "lib/sound-registry.ts": "the first deliberate gesture arms the audio context",
};

/** Files that name Escape without reading a press: the key's spoken name on a key cap. */
const ESCAPE_NAMED: Readonly<Record<string, string>> = {
  "components/planner-chrome/Keys.tsx": "Esc's name for aria-keyshortcuts",
};

const IMPORT = /(?:import|export)\s[^;]*?from\s+["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']\s*\)|import\s+["'](\.[^"']+)["']/gu;

function resolveImport(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec.replace(/\.js$/u, ""));
  for (const candidate of [`${base}.tsx`, `${base}.ts`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function plannerGraph(): Promise<Map<string, string>> {
  const sources = new Map<string, string>();
  const chrome = (await readdir(CHROME))
    .filter((name) => /\.tsx?$/u.test(name))
    .map((name) => join(CHROME, name));
  const pending = [ENTRY, ...chrome];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || sources.has(file)) continue;
    const source = await readFile(file, "utf8");
    sources.set(file, source);
    for (const match of source.matchAll(IMPORT)) {
      const next = resolveImport(file, match[1] ?? match[2] ?? match[3] ?? "");
      if (next !== null && !sources.has(next)) pending.push(next);
    }
  }
  return sources;
}

function srcPath(file: string): string {
  return relative(SRC, file).split(sep).join("/");
}

let graph = new Map<string, string>();

beforeAll(async () => {
  graph = await plannerGraph();
});

describe("the rules", () => {
  it("catch a file that reads Escape or listens for keys", () => {
    expect(readsEscape('if (event.key === "Escape") close();')).toBe(true);
    expect(readsEscape("switch (event.code) { case 'Escape': return; }")).toBe(true);
    expect(readsEscape("// Esc closes the panel")).toBe(false);
    expect(listensForKeys('window.addEventListener("keydown", onKey);')).toBe(true);
    expect(listensForKeys('document.addEventListener( "keydown" , onKey, true);')).toBe(true);
    expect(listensForKeys('window.addEventListener("keyup", onKeyUp);')).toBe(false);
  });
});

describe("the planner's one keyboard owner", () => {
  it("walks the planner's scene, chrome and dialogs", () => {
    const files = [...graph.keys()].map(srcPath);
    expect(files.length).toBeGreaterThan(300);
    for (const expected of [OWNER, "components/SelectionSystem.tsx", "components/CameraRig.tsx", "components/editor/VerticalToolbox.tsx", "components/planner-chrome/Popover.tsx"]) {
      expect(files).toContain(expected);
    }
  });

  it("lets only planner-keys.ts read Escape", () => {
    const offenders = [...graph.entries()]
      .filter(([file, source]) => srcPath(file) !== OWNER && ESCAPE_NAMED[srcPath(file)] === undefined && readsEscape(source))
      .map(([file]) => srcPath(file));
    expect(offenders).toEqual([]);
    expect(readsEscape(graph.get(join(SRC, OWNER)) ?? "")).toBe(true);
  });

  it("lets nothing else add a keydown listener, bar a focus trap and the sound's first gesture", () => {
    const offenders = [...graph.entries()]
      .filter(([file, source]) => srcPath(file) !== OWNER && KEYDOWN_ALLOWED[srcPath(file)] === undefined && listensForKeys(source))
      .map(([file]) => srcPath(file));
    expect(offenders).toEqual([]);
  });
});
