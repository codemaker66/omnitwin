import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

type InteractionPattern = Readonly<{
  name: string;
  regex: RegExp;
}>;

const SOURCE_ROOT = path.resolve("src");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const SKIPPED_PATH_PARTS = new Set(["__tests__", "test-results"]);

const INTERACTION_PATTERNS: readonly InteractionPattern[] = [
  {
    name: "empty onClick handler",
    regex: /onClick=\{\s*(?:async\s*)?\(\s*\)\s*=>\s*(?:\{\s*\}|undefined|null|void\s+0)\s*\}/g,
  },
  {
    name: "empty direct onClick value",
    regex: /onClick=\{\s*(?:undefined|null)\s*\}/g,
  },
  {
    name: "placeholder href",
    regex: /href=\{?\s*["'`]#["'`]\s*\}?/g,
  },
  {
    name: "javascript href",
    regex: /href=\{?\s*["'`]javascript:/gi,
  },
  {
    name: "placeholder router target",
    regex: /to=\{?\s*["'`]#["'`]\s*\}?/g,
  },
];

function isSkippedPath(filePath: string): boolean {
  return path
    .relative(SOURCE_ROOT, filePath)
    .split(path.sep)
    .some((part) => SKIPPED_PATH_PARTS.has(part));
}

async function listSourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(entryPath);
    if (!entry.isFile()) return [];
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) return [];
    if (isSkippedPath(entryPath)) return [];
    return [entryPath];
  }));
  return files.flat();
}

function lineNumberForIndex(source: string, index: number): number {
  return source.slice(0, index).split(/\r?\n/).length;
}

function relativeSourcePath(filePath: string): string {
  return path.relative(process.cwd(), filePath).split(path.sep).join("/");
}

describe("interaction contract", () => {
  it("does not introduce obvious inert control placeholders", async () => {
    const files = await listSourceFiles(SOURCE_ROOT);
    const findings: string[] = [];

    for (const filePath of files) {
      const source = await readFile(filePath, "utf-8");
      for (const pattern of INTERACTION_PATTERNS) {
        for (const match of source.matchAll(pattern.regex)) {
          const matchIndex = match.index;
          if (matchIndex === undefined) continue;
          findings.push(`${relativeSourcePath(filePath)}:${String(lineNumberForIndex(source, matchIndex))} ${pattern.name}`);
        }
      }
    }

    expect(findings).toEqual([]);
  });
});
