import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// T-635 N1 — hover never moves the thing under the pointer.
//
// Blake removed hover bounce everywhere (26 September 2026). Lane 1 deleted
// the global scale(1.06) pop, and that unmasked every surface's own hover
// lift. A lift is not only motion nobody asked for: a control that moves 1–2px
// away from a pointer resting near its edge loses the hover, drops back under
// the pointer, regains it and loops. The Craft quiz did exactly that under
// Playwright — "element is not stable" until the test timed out.
//
// Hover may change colour, border and shadow. It may move a descendant that
// is not the hit target (`.card:hover .arrow`). It may not transform the
// hovered element itself, in a stylesheet or from a pointer-enter handler.
// Press feedback (`:active`) and reduced-motion `transform: none` are fine.
// ---------------------------------------------------------------------------

/** Held with the GPU-scoped 3D batch (T-635); the Twin's own sheets. */
const HELD_FOR_3D_BATCH = [/^twin\//];

async function sourceFiles(pattern: RegExp): Promise<readonly (readonly [string, string])[]> {
  const root = resolve("src");
  const out: (readonly [string, string])[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") await walk(full);
      } else if (pattern.test(entry.name)) {
        out.push([full.slice(root.length + 1).replaceAll("\\", "/"), await readFile(full, "utf-8")]);
      }
    }
  }
  await walk(root);
  return out.filter(([path]) => !HELD_FOR_3D_BATCH.some((rule) => rule.test(path)));
}

/** Removes parenthesised groups, so `:not(.a .b)` cannot read as a combinator. */
function withoutParentheses(selector: string): string {
  let out = "";
  let depth = 0;
  for (const char of selector) {
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += char;
  }
  return out;
}

/**
 * True when the element the selector styles is itself the hovered one. A
 * descendant (`.a:hover .b`) or a pseudo-element (`.a:hover::before`) is
 * decoration beside the hit target, not the target.
 */
function hoverTargetsSubject(selector: string): boolean {
  const flat = withoutParentheses(selector).trim();
  const at = flat.lastIndexOf(":hover");
  if (at < 0) return false;
  const rest = flat.slice(at + ":hover".length);
  return !/[\s>+~]/.test(rest) && !rest.includes("::");
}

const MOVES = /(?:^|[;{\s])(?:transform|translate|scale|rotate)\s*:\s*([^;]+)/g;

function movingDeclarations(block: string): readonly string[] {
  return [...block.matchAll(MOVES)]
    .map((match) => (match[1] ?? "").trim())
    .filter((value) => value !== "none" && value !== "none !important");
}

describe("hover moves nothing under the pointer", () => {
  it("recognises the hovered element, not its descendants", () => {
    expect(hoverTargetsSubject(".a:hover")).toBe(true);
    expect(hoverTargetsSubject(".a:hover:not(:disabled)")).toBe(true);
    expect(hoverTargetsSubject(".a:hover:not(.b .c)")).toBe(true);
    expect(hoverTargetsSubject(".a .b:hover")).toBe(true);
    expect(hoverTargetsSubject(".a:hover .b")).toBe(false);
    expect(hoverTargetsSubject(".a:hover > .b")).toBe(false);
    expect(hoverTargetsSubject(".a:hover::before")).toBe(false);
    expect(hoverTargetsSubject(".a:focus-visible")).toBe(false);
  });

  it("no stylesheet transforms a hovered element", async () => {
    const offenders: string[] = [];
    for (const [path, raw] of await sourceFiles(/\.css$/)) {
      const css = raw.replaceAll(/\/\*[\s\S]*?\*\//g, "");
      // Innermost rule blocks: a selector list and its declarations. Rules
      // nested in @media are matched on their own, with their own selectors.
      for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selectors = (rule[1] ?? "").split(",").map((part) => part.trim());
        const moving = movingDeclarations(rule[2] ?? "");
        if (moving.length === 0) continue;
        for (const selector of selectors.filter(hoverTargetsSubject)) {
          offenders.push(`${path}: ${selector} → ${moving.join("; ")}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no pointer-enter handler transforms the element it is on", async () => {
    const offenders: string[] = [];
    for (const [path, text] of await sourceFiles(/\.tsx$/)) {
      const lines = text.split("\n");
      lines.forEach((line, index) => {
        if (!/on(?:Mouse|Pointer)Enter=/.test(line)) return;
        // The handler body: this line and the few that follow it.
        const body = lines.slice(index, index + 8).join("\n");
        const end = body.indexOf("}}");
        const handler = end < 0 ? body : body.slice(0, end);
        for (const match of handler.matchAll(/(?:currentTarget|\bel)\.style\.transform\s*=\s*([^;]+)/g)) {
          const value = (match[1] ?? "").trim();
          if (!/^["'`](?:none)?["'`]$/.test(value)) offenders.push(`${path}:${String(index + 1)} ${value}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
