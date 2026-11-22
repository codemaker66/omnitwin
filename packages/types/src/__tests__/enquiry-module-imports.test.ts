import { readFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// What the public enquiry schema brings with it (whole-repository audit T-695).
//
// The walkthrough's enquiry form imports `@omnitwin/types/enquiry`, and the
// website's (pages/fresh/FreshEnquiry.tsx) takes a constant defined in it from
// the package root, whose `sideEffects: false` lets a bundler keep only the
// modules that are used: both carry this module and what it imports. A
// bundler keeps every module this one imports for a value: a schema built at
// a module's top level is a call it cannot prove harmless, so tree-shaking
// does not drop it. One small function imported from a large module therefore
// ships that module and everything under it. Measured for `isCalendarDate`
// taken from event-brief-draft.ts: the enquiry module bundled alone went from
// 32 KB to 99 KB, 6 modules to 17, before minifying.
//
// So the lists below are the whole of it. Adding a schema is a decision about
// those forms' bundles; a small helper belongs in a module of its own that
// imports nothing (a leaf, like calendar-date.ts), added to LEAVES. This test
// holds which modules they carry, not their bytes: the built enquiry chunk's
// bytes are held to a budget in packages/web/src/__tests__/twin-chunk-budget.test.ts.
// ---------------------------------------------------------------------------

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The modules the enquiry schema may reach that import nothing at all, so
 * they can bring nothing else with them. A new one is added here, in this one
 * place, and the test below holds it to importing nothing. occasion.ts holds
 * the occasion words (#407), which enquiry.ts re-exports.
 */
const LEAVES: readonly string[] = ["calendar-date.ts", "occasion.ts"];

/** The schemas the enquiry forms need; each imports only zod and the others. */
const SCHEMAS: readonly string[] = ["configuration.ts", "enquiry-funnel.ts", "enquiry.ts", "space.ts", "user.ts", "venue.ts"];

/** The one package these modules may import. */
const PACKAGES: ReadonlySet<string> = new Set(["zod"]);

/** What the enquiry forms must never carry, and why. A name ending in "/" is a folder. */
const NEVER: readonly { readonly module: string; readonly why: string }[] = [
  { module: "event-architect.ts", why: "the Event Architect's schemas, which only the office uses" },
  { module: "evidence-runtime.ts", why: "the evidence runtime under the Event Architect" },
  { module: "event-brief-draft.ts", why: "the event brief, on the Event Architect: one date check from it took the enquiry module from 32 KB to 99 KB" },
  { module: "solver/", why: "the layout solver" },
];

interface ImportOf {
  readonly specifier: string;
  /** `import type` and `export type` are erased by the compiler, so they bring nothing. */
  readonly typeOnly: boolean;
}

/**
 * Every module a source file names, in order, as the compiler parses it (so
 * no comment or string can hide one): imports, side-effect-only ones
 * included, re-exports and dynamic imports. `import { type A }` is a value
 * import: under verbatimModuleSyntax it stays as `import {} from`. A dynamic
 * import whose name is not a plain string is named "(computed)".
 */
function importsIn(source: string): readonly ImportOf[] {
  const found: ImportOf[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push({ specifier: node.moduleSpecifier.text, typeOnly: node.importClause?.isTypeOnly ?? false });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push({ specifier: node.moduleSpecifier.text, typeOnly: node.isTypeOnly });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [named] = node.arguments;
      found.push({ specifier: named !== undefined && ts.isStringLiteralLike(named) ? named.text : "(computed)", typeOnly: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile("module.ts", source, ts.ScriptTarget.Latest, true));
  return found;
}

/** What one of this package's modules (named by its path from src) imports. */
function importsOf(module: string): readonly ImportOf[] {
  return importsIn(readFileSync(resolve(SRC, module), "utf8"));
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

/** Every module of this package reached from `entry` for its values, itself
 *  included, by its path from src. */
function reachedFrom(entry: string): readonly string[] {
  const reached = new Set<string>();
  const queue = [entry];
  for (let module = queue.pop(); module !== undefined; module = queue.pop()) {
    if (reached.has(module)) continue;
    reached.add(module);
    for (const { specifier, typeOnly } of importsOf(module)) {
      if (!typeOnly && isRelative(specifier)) {
        queue.push(posix.join(posix.dirname(module), specifier).replace(/\.js$/u, ".ts"));
      }
    }
  }
  return [...reached].sort();
}

/** Which of NEVER a set of reached modules holds, each with why. */
function neverOnes(reached: readonly string[]): readonly string[] {
  return NEVER
    .filter(({ module }) => reached.some((each) => (module.endsWith("/") ? each.startsWith(module) : each === module)))
    .map(({ module, why }) => `${module}: ${why}`);
}

describe("the public enquiry schema's module", () => {
  const reached = reachedFrom("enquiry.ts");

  it("brings only the modules the enquiry forms' bundles are sized for", () => {
    expect(reached).toEqual([...SCHEMAS, ...LEAVES].sort());
  });

  it("brings nothing the forms must never carry", () => {
    expect(neverOnes(reached)).toEqual([]);
  });

  it("imports no package but zod in any module it brings", () => {
    const strays = reached.flatMap((module) => importsOf(module)
      .filter(({ specifier }) => !isRelative(specifier) && !PACKAGES.has(specifier))
      .map(({ specifier }) => `${module} imports ${specifier}`));
    expect(strays).toEqual([]);
  });

  it("keeps every leaf a leaf: it imports nothing at all", () => {
    const leaves = Object.fromEntries(LEAVES.map((leaf) => [leaf, importsOf(leaf).map(({ specifier }) => specifier)]));
    expect(leaves).toEqual(Object.fromEntries(LEAVES.map((leaf) => [leaf, []])));
  });

  it("reads every import a bundler reads, and no other", () => {
    const source = [
      'import "./register-locales.js";',
      'import { parsePhoneNumber } from "libphonenumber-js";',
      'const marker = "/*";',
      'export { pick } from "./after-a-string.js";',
      "/** A later note. */",
      'import type { OnlyAType } from "./only-types.js";',
      'export type { AlsoAType } from "./more-types.js";',
      'import { type Mixed, kept } from "./mixed.js";',
      '// import { commented } from "./commented-out.js";',
      'const later = (): Promise<unknown> => import("./later.js");',
    ].join("\n");
    expect(importsIn(source)).toEqual([
      { specifier: "./register-locales.js", typeOnly: false },
      { specifier: "libphonenumber-js", typeOnly: false },
      { specifier: "./after-a-string.js", typeOnly: false },
      { specifier: "./only-types.js", typeOnly: true },
      { specifier: "./more-types.js", typeOnly: true },
      { specifier: "./mixed.js", typeOnly: false },
      { specifier: "./later.js", typeOnly: false },
    ]);
  });

  it("follows a module's imports as a bundler does, so the lists above are honest", () => {
    // The event brief sits on the Event Architect: the walk has to find that,
    // and the never-list has to name it.
    const fromBrief = reachedFrom("event-brief-draft.ts");
    expect(fromBrief).toEqual(expect.arrayContaining(["event-architect.ts", "evidence-runtime.ts", "space.ts", "venue.ts"]));
    expect(neverOnes(fromBrief).map((line) => line.split(":")[0])).toEqual(
      expect.arrayContaining(["event-architect.ts", "evidence-runtime.ts", "event-brief-draft.ts"]),
    );
  });
});

// Every screen that shows an event's name bundles event-name.ts, so it holds
// to the same rule: the occasion words and the venue clock, nothing more
// (#407 review, C7). The walk follows what each module brings in turn.
describe("the event name's module", () => {
  it("brings only the occasion words and the venue clock", () => {
    expect(reachedFrom("event-name.ts")).toEqual(["event-name.ts", "occasion.ts", "staff-rota-checks.ts"]);
  });
});
