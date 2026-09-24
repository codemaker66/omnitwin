import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// package.json declares `"sideEffects": false`, which lets the web bundler drop
// every contract module a route does not import from the barrel instead of
// shipping the whole package to each page. That promise is only true while no
// module does work when it is first evaluated. Declarations such as
// `export const X = z.object(...)` are fine; a bare top-level statement (a
// global Zod error map, a registry write, a log line) would be silently
// removed from bundles, so it must fail here first.

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(TEST_DIR, "../..");
const SOURCE_ROOT = path.join(PACKAGE_ROOT, "src");

const DECLARATION_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.ExportDeclaration,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.EmptyStatement,
]);

async function sourceModules(directory = SOURCE_ROOT): Promise<string[]> {
  const modules: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") modules.push(...await sourceModules(entryPath));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      modules.push(entryPath);
    }
  }
  return modules.sort();
}

describe("@omnitwin/types module side effects", () => {
  it("declares itself side-effect free so bundlers can drop unused modules", async () => {
    const manifest: unknown = JSON.parse(await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf-8"));
    expect(manifest).toMatchObject({ sideEffects: false });
  });

  it("keeps every module's top level to declarations", async () => {
    const files = await sourceModules();
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const source = ts.createSourceFile(file, await readFile(file, "utf-8"), ts.ScriptTarget.Latest, true);
      for (const statement of source.statements) {
        if (DECLARATION_KINDS.has(statement.kind)) continue;
        const { line } = source.getLineAndCharacterOfPosition(statement.getStart(source));
        violations.push(`${path.relative(PACKAGE_ROOT, file)}:${String(line + 1)} ${ts.SyntaxKind[statement.kind]}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
