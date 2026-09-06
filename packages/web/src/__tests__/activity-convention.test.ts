import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return /\.(tsx|css)$/.test(entry.name) ? [path] : [];
  }));
  return groups.flat();
}

const WORK_COPY = /^\s*(?:loading|saving|working|searching|submitting|uploading|exporting|generating|sending|signing in)(?:\s|[.…])/i;
const conditionPrinter = ts.createPrinter({ removeComments: true });

function branchConditions(node: ts.Node, boundary: ts.Node, file: ts.SourceFile): ReadonlyMap<string, boolean> {
  const conditions = new Map<string, boolean>();
  function record(expression: ts.Expression, value: boolean): void {
    if (ts.isParenthesizedExpression(expression)) {
      record(expression.expression, value);
      return;
    }
    if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
      record(expression.operand, !value);
      return;
    }
    conditions.set(conditionPrinter.printNode(ts.EmitHint.Expression, expression, file), value);
  }
  for (let current = node; current !== boundary; current = current.parent) {
    const parent = current.parent;
    if (ts.isConditionalExpression(parent)) {
      if (current === parent.whenTrue) record(parent.condition, true);
      if (current === parent.whenFalse) record(parent.condition, false);
    }
    if (ts.isBinaryExpression(parent) && current === parent.right) {
      if (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) record(parent.left, true);
      if (parent.operatorToken.kind === ts.SyntaxKind.BarBarToken) record(parent.left, false);
    }
  }
  return conditions;
}

function isSharedActivity(node: ts.Node): boolean {
  const tag = ts.isJsxElement(node) ? node.openingElement.tagName
    : ts.isJsxSelfClosingElement(node) ? node.tagName : undefined;
  return tag !== undefined && ts.isIdentifier(tag) && (tag.text === "ActivityStatus" || tag.text === "ActivityIndicator");
}

function sharedActivityInScope(node: ts.Node, scope: ts.Node, file: ts.SourceFile): boolean {
  const workConditions = branchConditions(node, scope, file);
  function find(current: ts.Node): boolean {
    if (ts.isFunctionLike(current)) return false;
    if (isSharedActivity(current)) {
      return [...branchConditions(current, scope, file)].every(([condition, value]) => workConditions.get(condition) === value);
    }
    return ts.forEachChild(current, find) ?? false;
  }
  return find(scope);
}

function workHasSharedActivity(node: ts.Node, file: ts.SourceFile): boolean {
  let parent: ts.Node | undefined = node.parent;
  while (parent !== undefined && !ts.isFunctionLike(parent)) {
    if ((ts.isJsxElement(parent) || ts.isJsxFragment(parent)) && sharedActivityInScope(node, parent, file)) return true;
    parent = parent.parent;
  }
  return false;
}

function isRenderedCopy(node: ts.Node): boolean {
  let rendered = ts.isJsxText(node);
  let parent: ts.Node | undefined = node.parent;
  while (parent !== undefined && !ts.isFunctionLike(parent)) {
    if (ts.isJsxAttribute(parent)) return false;
    if (ts.isJsxExpression(parent)) rendered = true;
    parent = parent.parent;
  }
  return rendered;
}

// A syntax-aware guard catches new text-only work views in normal JSX without
// treating image loading="lazy", data state names, comments or errors as work.
// Activity must share a rendered container and be present under the work
// label's own conditions; another operation in the function cannot satisfy it.
function unsharedWorkCopy(path: string, source: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: string[] = [];
  function visit(node: ts.Node): void {
    if ((ts.isJsxText(node) || ts.isStringLiteral(node)) && WORK_COPY.test(node.text)
      && isRenderedCopy(node) && !workHasSharedActivity(node, file)) {
      violations.push(`${path}:${String(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1)} ${node.text.trim().slice(0, 70)}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return violations;
}

describe("mandatory project activity convention", () => {
  it.each([
    ["unrelated saving branch", "function Example({ saving, loading }) { return <>{saving && <ActivityIndicator />}{loading && <p>Loading records...</p>}</>; }"],
    ["opposite conditional branch", "function Example({ loading }) { return loading ? <p>Loading records...</p> : <ActivityIndicator />; }"],
    ["unrelated indicator in the same button", "function Example({ saving, loading }) { return <button>{saving && <ActivityIndicator />}{loading ? 'Loading records...' : 'Load'}</button>; }"],
  ])("rejects work copy with an %s", (_description, source) => {
    expect(unsharedWorkCopy("fixture.tsx", source)).toHaveLength(1);
  });

  it.each([
    ["sibling indicator and heading", "function Example({ loading }) { return loading && <section role='status'><ActivityIndicator /><h2>Loading records...</h2></section>; }"],
    ["shared status", "function Example({ loading }) { return loading && <ActivityStatus>Loading records...</ActivityStatus>; }"],
    ["matching button condition", "function Example({ saving }) { return <button>{saving && <ActivityIndicator />}{saving ? 'Saving records...' : 'Save'}</button>; }"],
    ["matching icon ternary", "function Example({ saving }) { return <button>{saving ? <ActivityIndicator /> : <Check />}{saving ? 'Saving records...' : 'Save'}</button>; }"],
  ])("accepts work copy with a %s", (_description, source) => {
    expect(unsharedWorkCopy("fixture.tsx", source)).toEqual([]);
  });

  it("requires shared activity in components rendering explicit work labels", async () => {
    const violations = (await Promise.all((await sourceFiles("src")).filter((path) => path.endsWith(".tsx")).map(async (path) =>
      unsharedWorkCopy(path, await readFile(path, "utf8")),
    ))).flat();
    expect(violations, "Use ActivityStatus or ActivityIndicator; see .claude/conventions/loading-and-working-motion.md").toEqual([]);
  });

  it("rejects independent loading spin animations", async () => {
    const offenders: string[] = [];
    for (const path of (await sourceFiles("src")).filter((file) => file.endsWith(".css"))) {
      const css = await readFile(path, "utf8");
      if (/@keyframes\s+[\w-]*spin\b/.test(css)) offenders.push(path);
    }
    expect(offenders, "Loading choreography belongs to shared/Activity.css").toEqual([]);
  });

  it("keeps first paint and reduced motion within the shared convention", async () => {
    const html = await readFile("index.html", "utf8");
    const css = await readFile("src/components/shared/Activity.css", "utf8");
    expect(html).toContain('href="/src/components/shared/Activity.css"');
    expect(html).toContain('data-activity-indicator="bootstrap"');
    expect(html).toContain("<noscript>");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.vv-activity-particle\s*\{\s*animation: none/);
  });
});
