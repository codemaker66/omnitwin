// The Lantern is raw WebGL on its own canvas and never Three.js: no file under
// lantern/ may import three, React Three Fiber, drei or Spark, and none may
// reach into the instrument. The river-gate shader, the whole of scene 1's
// light and water, stays under 20 KB raw.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RIVER_GATE_FRAGMENT } from "../presets/river-gate.glsl.js";

const LANTERN_ROOT = resolve(import.meta.dirname, "..");

/** Every shipped source under lantern/; the tests themselves are not policed (this file names what it forbids). */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "__tests__") {
        out.push(...sourceFiles(full));
      }
    } else if (/\.(ts|tsx|css)$/u.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
}

describe("lantern/ — isolation", () => {
  const files = sourceFiles(LANTERN_ROOT);

  it("has the files this test expects to police", () => {
    const names = files.map((file) => file.replace(LANTERN_ROOT, "").replace(/\\/gu, "/"));
    expect(names).toEqual(expect.arrayContaining([
      "/Lantern.tsx",
      "/lantern-program.ts",
      "/lantern-budget.ts",
      "/lantern-types.ts",
      "/lantern.css",
      "/presets/river-gate.glsl.ts",
      "/presets/fire.glsl.ts",
    ]));
  });

  it("imports neither three, React Three Fiber, drei nor Spark anywhere under lantern/", () => {
    for (const file of files) {
      const code = withoutComments(readFileSync(file, "utf8"));
      expect(code, file).not.toMatch(/from\s+["'](?:three|@react-three\/|@sparkjsdev\/|three-stdlib)/u);
      expect(code, file).not.toMatch(/import\(\s*["'](?:three|@react-three\/|@sparkjsdev\/)/u);
    }
  });

  it("imports nothing from the instrument", () => {
    for (const file of files) {
      const code = withoutComments(readFileSync(file, "utf8"));
      expect(code, file).not.toMatch(/craft-quiz-model|craft-quiz-deliberation/u);
    }
  });

  it("keeps the river-gate shader under 20 KB raw", () => {
    const shaderBytes = new TextEncoder().encode(RIVER_GATE_FRAGMENT).byteLength;
    const fileBytes = statSync(join(LANTERN_ROOT, "presets", "river-gate.glsl.ts")).size;
    expect(shaderBytes).toBeLessThan(20 * 1024);
    expect(fileBytes).toBeLessThan(20 * 1024);
  });

  it("writes every preset in GLSL ES 1.00 so WebGL1 can run it too", () => {
    for (const file of files.filter((name) => name.endsWith(".glsl.ts"))) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/#version\s+300/u);
      expect(source, file).toContain("gl_FragColor");
    }
  });
});
