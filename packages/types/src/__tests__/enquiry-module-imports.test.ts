import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// What the public enquiry schema brings with it (whole-repository audit T-695).
//
// The walkthrough's and the front door's enquiry forms import
// `@omnitwin/types/enquiry` on its own, because both sit in bundles held to a
// byte budget. A bundler keeps every module this one imports for a value: a
// schema built at a module's top level is a call it cannot prove harmless, so
// tree-shaking does not drop it. One small function imported from a large
// module therefore ships that module and everything under it. Measured for
// `isCalendarDate` taken from event-brief-draft.ts: the enquiry module bundled
// alone went from 32 KB to 99 KB, 6 modules to 17, before minifying.
//
// So the list below is the whole of it. Adding to it is a decision about those
// two bundles; a small helper belongs in a module of its own (calendar-date.ts).
// ---------------------------------------------------------------------------

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** `import … from "./x.js"`, `export { … } from "./x.js"` and
 *  `export * from "./x.js"`, each with its `type` keyword when it has one. */
const FROM_THIS_PACKAGE =
  /(?:^|\n)[ \t]*(?:import\s+(type\s+)?[\w*\s{},$]+?\s+from|export\s+(type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from)\s+["']\.\/([^"']+)\.js["']/gu;

/** The package's own modules a source file imports or re-exports for their
 *  values. `import type` is erased by the compiler, so it brings nothing. */
function valueImports(file: string): readonly string[] {
  const code = readFileSync(resolve(SRC, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\/\/[^\n]*/gu, "");
  const found: string[] = [];
  for (const match of code.matchAll(FROM_THIS_PACKAGE)) {
    const typeOnly = match[1] !== undefined || match[2] !== undefined;
    if (!typeOnly && match[3] !== undefined) found.push(`${match[3]}.ts`);
  }
  return found;
}

/** Every module reached from `entry`, itself included. */
function reachedFrom(entry: string): readonly string[] {
  const reached = new Set<string>();
  const queue = [entry];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (reached.has(file)) continue;
    reached.add(file);
    queue.push(...valueImports(file));
  }
  return [...reached].sort();
}

describe("the public enquiry schema's module", () => {
  it("brings only the modules the enquiry forms' bundles are sized for", () => {
    expect(reachedFrom("enquiry.ts")).toEqual([
      "calendar-date.ts",
      "configuration.ts",
      "enquiry-funnel.ts",
      "enquiry.ts",
      "space.ts",
      "user.ts",
      "venue.ts",
    ]);
  });

  it("follows a module's imports as a bundler does, so the list above is honest", () => {
    // The event brief sits on the Event Architect: the walk has to find that.
    expect(reachedFrom("event-brief-draft.ts")).toEqual(
      expect.arrayContaining(["event-architect.ts", "evidence-runtime.ts", "space.ts", "venue.ts"]),
    );
  });
});
